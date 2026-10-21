/** Private issuer for the dedicated workload. Official Auth OTP verification
 * produces normal short-lived sessions; no human session is minted or stored. */
export type EngineeringUser = { id: string; email?: string; role?: string; is_anonymous?: boolean; app_metadata?: Record<string, unknown> };
export interface EngineeringAuth {
  admin: {
    generateLink(args: { type: "magiclink"; email: string }): Promise<{ data: { properties?: { hashed_token?: string } }; error: unknown }>;
    signOut?(jwt: string, scope: "local"): Promise<{ error: unknown }>;
  };
  verifyOtp(args: { type: "magiclink"; token_hash: string }): Promise<{ data: { session?: { access_token: string } | null }; error: unknown }>;
  getUser(token: string): Promise<{ data: { user: EngineeringUser | null }; error: unknown }>;
}
export type Workload = { userId: string; epoch: number; bootstrapGeneration: number };
export type IssuedSession = { token: string; sessionId: string; expiresAt: number; workload: Workload };
export type SessionDependencies = {
  // A separate client prevents verifyOtp from replacing the service DB session.
  auth(): EngineeringAuth;
  register(userId: string, sessionId: string, epoch: number, expiresAt: string): Promise<boolean>;
  retire(userId: string, sessionId: string): Promise<boolean>;
  now?: () => number;
  acquire?(workload: Workload): Promise<string | null>;
  release?(userId: string, leaseId: string): Promise<void>;
  pause?(milliseconds: number): Promise<void>;
};
const EMAIL = "sandy-engineering-test@sandy-ai.internal";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function createEngineeringSessionProvider(deps: SessionDependencies) {
  const now = deps.now ?? Date.now;
  let cached: IssuedSession | undefined;
  let inflight: { scope: string; value: Promise<IssuedSession> } | undefined;
  const scope = (w: Workload) => `${w.userId}:${w.epoch}:${w.bootstrapGeneration}`;
  async function mint(workload: Workload): Promise<IssuedSession> {
    let lease: string | null = null;
    if (deps.acquire) {
      for (let attempt = 0; attempt < 20 && !lease; attempt++) {
        lease = await deps.acquire(workload);
        if (!lease) await (deps.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(250);
      }
      if (!lease) throw Error("engineering_auth_issue_busy");
    }
    try {
    const auth = deps.auth();
    const link = await auth.admin.generateLink({ type: "magiclink", email: EMAIL });
    const hash = link.data.properties?.hashed_token;
    if (link.error || !hash) throw Error("engineering_auth_issue_failed");
    const result = await auth.verifyOtp({ type: "magiclink", token_hash: hash });
    const token = result.data.session?.access_token;
    if (result.error || !token) throw Error("engineering_auth_issue_failed");
    const verified = await auth.getUser(token), user = verified.data.user;
    if (verified.error || !user || user.id !== workload.userId || user.email !== EMAIL || user.role !== "authenticated" ||
      user.is_anonymous === true || user.app_metadata?.sandy_engineering_test !== true || user.app_metadata?.sandy_engineering_epoch !== workload.epoch) {
      throw Error("engineering_auth_identity_invalid");
    }
    let claims: Record<string, unknown>;
    try { const decoded = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); if (!object(decoded)) throw Error(); claims = decoded; }
    catch { throw Error("engineering_auth_claims_invalid"); }
    const meta = claims.app_metadata;
    if (claims.sub !== workload.userId || claims.role !== "authenticated" || claims.aud !== "authenticated" || !uuid(claims.session_id) ||
      typeof claims.exp !== "number" || claims.exp * 1000 <= now() + 60000 || claims.exp * 1000 > now() + 3900000 ||
      !object(meta) || meta.sandy_engineering_test !== true || meta.sandy_engineering_epoch !== workload.epoch) throw Error("engineering_auth_claims_invalid");
    const expiresAt = claims.exp * 1000;
    if (!await deps.register(workload.userId, claims.session_id, workload.epoch, new Date(expiresAt).toISOString())) throw Error("engineering_auth_registration_denied");
    const previous = cached;
    const issued = { token, sessionId: claims.session_id, expiresAt, workload };
    // Old proofs are revoked in Sandy before their Auth refresh session is retired.
    if (previous && previous.sessionId !== issued.sessionId) {
      if (!await deps.retire(previous.workload.userId, previous.sessionId)) throw Error("engineering_auth_retirement_failed");
      await auth.admin.signOut?.(previous.token, "local").catch(() => ({ error: true }));
    }
    cached = issued;
    return issued;
    } finally { if (lease) await deps.release?.(workload.userId, lease).catch(() => {}); }
  }

  return {
    async get(workload: Workload): Promise<IssuedSession> {
      if (!uuid(workload.userId) || !Number.isSafeInteger(workload.epoch) || workload.epoch < 1 ||
        !Number.isSafeInteger(workload.bootstrapGeneration) || workload.bootstrapGeneration < 1) throw Error("engineering_workload_invalid");
      const key = scope(workload);
      if (cached && scope(cached.workload) === key && cached.expiresAt > now() + 60000) return cached;
      if (inflight && inflight.scope !== key) throw Error("engineering_credential_generation_changed");
      if (!inflight) {
        const value = mint(workload).finally(() => { inflight = undefined; });
        inflight = { scope: key, value };
      }
      return await inflight.value;
    },
    invalidate() { if (cached) cached.expiresAt = 0; },
  };
}
