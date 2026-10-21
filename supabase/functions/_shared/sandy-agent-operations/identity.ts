// A service credential authenticates an automation caller, never a customer
// session. Contexts are process-local capabilities and cannot be supplied in JSON.
export type AgentDb = any;
export type AgentPrincipal = Readonly<{
  kind: "auth_user" | "trusted_runtime";
  customerId: string;
  authUserId: string | null;
  taskId: string | null;
  controllerOwner: boolean;
  requestText: string;
}>;
type RuntimeProof = Readonly<{ serviceCaller: boolean }>;
const runtimeProofs = new WeakSet<object>();
const principals = new WeakSet<object>();
export type RuntimeConversationTask = Readonly<{
  kind: "trusted_runtime";
  customerId: string | null;
  authUserId: null;
  taskId: string;
  channel: string;
  requestId: string;
  requestText: string;
}>;
const conversationTasks = new WeakSet<object>();
export const isRuntimeConversationTask = (value: unknown): value is RuntimeConversationTask =>
  value !== null && typeof value === "object" && conversationTasks.has(value);
const uuid = (v: unknown): v is string => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function principal(value: AgentPrincipal): AgentPrincipal {
  const context = Object.freeze(value);
  principals.add(context);
  return context;
}
export const isAgentPrincipal = (value: unknown): value is AgentPrincipal =>
  value !== null && typeof value === "object" && principals.has(value);

/** The exact v4 service/temporary hashed QA authentication policy. */
export async function authenticateRuntime(
  request: Request,
  db: AgentDb,
  serviceCredential: string,
  now = Date.now(),
): Promise<RuntimeProof | null> {
  if (!serviceCredential) return null;
  const serviceCaller = request.headers.get("authorization") ===
    "Bearer " + serviceCredential;
  if (!serviceCaller) {
    const token = request.headers.get("x-sandy-qa-token") || "";
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest(
      "SHA-256", new TextEncoder().encode(token),
    ))).map((v) => v.toString(16).padStart(2, "0")).join("");
    const { data, error } = await db.from("sandy_runtime_test_credentials")
      .select("token_sha256,expires_at").eq("id", 1).maybeSingle();
    if (error || !data || data.token_sha256 !== digest ||
      !(Date.parse(data.expires_at) > now)) return null;
  }
  const proof = Object.freeze({ serviceCaller });
  runtimeProofs.add(proof);
  return proof;
}

/** Bind a previously authenticated automation to the task it actually reserved.
 * A forged customer/task in an HTTP body cannot create this capability. */
export async function bindRuntimeTask(
  proof: RuntimeProof,
  db: AgentDb,
  expected: { taskId: string; customerId: string; channel: string; requestId: string },
): Promise<AgentPrincipal | null> {
  if (!runtimeProofs.has(proof) || !uuid(expected.taskId) ||
    !uuid(expected.customerId)) return null;
  const { data, error } = await db.from("sandy_agent_tasks")
    .select("id,customer_id,channel,request_id,status,user_request")
    .eq("id", expected.taskId).eq("customer_id", expected.customerId).maybeSingle();
  if (error || !data || data.id !== expected.taskId ||
    data.customer_id !== expected.customerId || data.channel !== expected.channel ||
    data.request_id !== expected.requestId ||
    !["queued", "running"].includes(data.status)) return null;
  return principal({ kind: "trusted_runtime", customerId: data.customer_id,
    authUserId: null, taskId: data.id, controllerOwner: false,
    requestText: String(data.user_request || "") });
}

/** An internal conversation can have no customer, exactly as the original
 * fallback runtimes permit. This separate capability cannot pass isAgentPrincipal
 * or authorize any customer operation, even when its customer ID is non-null. */
export async function bindRuntimeConversationTask(
  proof: RuntimeProof,
  db: AgentDb,
  expected: { taskId: string; customerId: string | null; channel: string; requestId: string },
): Promise<RuntimeConversationTask | null> {
  if (!runtimeProofs.has(proof) || !uuid(expected.taskId) ||
    (expected.customerId !== null && !uuid(expected.customerId))) return null;
  const { data, error } = await db.from("sandy_agent_tasks")
    .select("id,customer_id,channel,request_id,status,user_request")
    .eq("id", expected.taskId).maybeSingle();
  if (error || !data || data.id !== expected.taskId ||
    data.customer_id !== expected.customerId || data.channel !== expected.channel ||
    data.request_id !== expected.requestId || !["queued", "running"].includes(data.status)) return null;
  const capability = Object.freeze({ kind: "trusted_runtime" as const,
    customerId: data.customer_id, authUserId: null, taskId: data.id,
    channel: data.channel, requestId: data.request_id, requestText: String(data.user_request || "") });
  conversationTasks.add(capability);
  return capability;
}

/** Same confirmed portal-account/primary-address contract as sandy-workspace.
 * Body-supplied customer IDs, service credentials and QA tokens are irrelevant. */
export async function authenticatePortalUser(
  request: Request,
  db: AgentDb,
  auth: { auth: { getUser: (token: string) => Promise<any> } },
  forbiddenServiceCredential: string,
): Promise<AgentPrincipal | null> {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "");
  if (!match || !match[1] || match[1] === forbiddenServiceCredential ||
    request.headers.has("x-sandy-api-key")) return null;
  const { data, error } = await auth.auth.getUser(match[1]);
  const user = data?.user;
  if (error || !uuid(user?.id) || !user.email || !user.email_confirmed_at) return null;
  const account = await db.from("sandy_memory_portal_accounts")
    .select("customer_id").eq("auth_user_id", user.id).is("revoked_at", null).maybeSingle();
  if (account.error || !uuid(account.data?.customer_id)) return null;
  const address = await db.from("email_customer_addresses")
    .select("normalized_email").eq("customer_id", account.data.customer_id)
    .eq("is_primary", true).maybeSingle();
  if (address.error || address.data?.normalized_email !== user.email.toLowerCase()) return null;
  const owner = await db.from("sandy_controller_admins").select("role,enabled")
    .eq("auth_user_id", user.id).eq("enabled", true).maybeSingle();
  if (owner.error) return null;
  return principal({ kind: "auth_user", customerId: account.data.customer_id,
    authUserId: user.id, taskId: null, controllerOwner: owner.data?.role === "owner",
    requestText: "" });
}
