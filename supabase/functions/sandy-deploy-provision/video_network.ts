/** Existing-VM administrative prerequisite. Every provider URL and effect is
 * fixed server-side; only an actual current owner-approved network scope admits
 * execution. Provider acceptance, observed state and unknown outcomes differ. */
type Obj = Record<string, unknown>;
type Db = { rpc(name: string, args: Obj): PromiseLike<{ data: unknown; error: unknown }> };
type Dependencies = { db: Db; token: string; fetch: typeof fetch };
const PROJECT = "elaborate-haven-511518-a5", REGION = "europe-west1", ZONE = "europe-west1-b";
const BASE = `https://compute.googleapis.com/compute/v1/projects/${PROJECT}`;
const SELF = `https://www.googleapis.com/compute/v1/projects/${PROJECT}`;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object = (value: unknown): value is Obj => !!value && typeof value === "object" && !Array.isArray(value);
const reply = (status: number, body: Obj) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function prepareVideoNetwork(deps: Dependencies, input: Obj): Promise<Response> {
  if (Object.keys(input).some(k => !["action", "change_id", "request_id"].includes(k)) ||
      typeof input.change_id !== "string" || !UUID.test(input.change_id) ||
      typeof input.request_id !== "string" || !UUID.test(input.request_id)) {
    return reply(400, { ok: false, error: "invalid_video_network_request", mutation_attempted: false, configuration_verified: false });
  }
  let admission: Obj | undefined;
  try {
    const result = await deps.db.rpc("sandy_video_network_prepare_authorize", { p_change_id: input.change_id, p_request_id: input.request_id });
    if (!result.error && object(result.data)) admission = result.data;
  } catch { /* fixed denial below; no raw database error */ }
  if (!admission) return reply(503, { ok: false, error: "network_authorization_unavailable", mutation_attempted: false, configuration_verified: false });
  if (admission.ok !== true || typeof admission.admission_id !== "number" || !Number.isSafeInteger(admission.admission_id)) {
    return reply(403, { ok: false, error: "existing_owner_approved_video_network_scope_required", mutation_attempted: false, configuration_verified: false });
  }
  let attempted = false, accepted = false;
  let operation: string | undefined, subnetName: string | undefined, prior: boolean | undefined;
  const complete = async (status: number, observation: Obj): Promise<Response> => {
    let recorded = false;
    try {
      const result = await deps.db.rpc("sandy_video_network_prepare_record", { p_admission_id: admission!.admission_id, p_result: observation });
      recorded = !result.error && object(result.data) && result.data.ok === true;
    } catch { /* a provider change must not become a misleading success */ }
    if (!recorded) return reply(503, { ok: false, error: "network_audit_outcome_unknown", mutation_attempted: attempted, configuration_verified: false, reconciliation_required: true, automatic_retry: false });
    return reply(status, { ok: status < 300, request_id: input.request_id, ...observation, automatic_retry: false,
      iam_changed: false, public_ip_added: false, firewall_changed: false, nat_created: false, paid_resource_created: false });
  };
  const observation = (phase: string, extra: Obj = {}): Obj => ({ phase, mutation_attempted: attempted, accepted,
    ...(operation ? { operation_name: operation } : {}), ...(subnetName ? { subnetwork: subnetName } : {}),
    ...(prior === undefined ? {} : { prior_private_google_access: prior }), configuration_verified: false,
    reconciliation_required: phase === "unknown" || phase === "accepted", ...extra });
  const request = async (url: string, method = "GET", body?: Obj) => {
    const response = await deps.fetch(url, { method, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { authorization: "Bearer " + deps.token, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined });
    const value: unknown = await response.json();
    if (!object(value)) throw Error("provider_invalid_json");
    return { response, value };
  };
  const rejected = async (status: number, value: Obj) => {
    const provider = object(value.error) ? value.error : {};
    const code = typeof provider.status === "string" && /^[A-Z_]{1,60}$/.test(provider.status) ? provider.status : "GOOGLE_API_REJECTED";
    const message = typeof provider.message === "string" ? provider.message.replaceAll(deps.token, "[REDACTED]").replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]").replace(/eyJ[A-Za-z0-9._-]{15,}|ya29\.[A-Za-z0-9._-]{10,}/g, "[REDACTED]").slice(0, 500) : "";
    return await complete(502, observation(accepted || status >= 500 && attempted ? "unknown" : "failed", { error: "video_network_provider_rejected", google_http: status, google_error_status: code, google_error_message: message }));
  };
  try {
    const vm = await request(`${BASE}/zones/${ZONE}/instances/sandy-video`);
    if (!vm.response.ok) return await rejected(vm.response.status, vm.value);
    if (vm.value.id !== "6831598645020395570" || vm.value.name !== "sandy-video" || vm.value.zone !== `${SELF}/zones/${ZONE}` || vm.value.status !== "RUNNING" ||
        !Array.isArray(vm.value.networkInterfaces) || vm.value.networkInterfaces.length !== 1 || !object(vm.value.networkInterfaces[0])) {
      return await complete(409, observation("failed", { error: "fixed_running_video_vm_required" }));
    }
    const ref = vm.value.networkInterfaces[0].subnetwork;
    const prefix = `${SELF}/regions/${REGION}/subnetworks/`;
    if (typeof ref !== "string" || !ref.startsWith(prefix) || !/^[a-z][a-z0-9-]{0,62}$/.test(ref.slice(prefix.length))) {
      return await complete(409, observation("failed", { error: "fixed_project_vm_subnetwork_required" }));
    }
    subnetName = ref.slice(prefix.length);
    const endpoint = `${BASE}/regions/${REGION}/subnetworks/${subnetName}`;
    const subnet = await request(endpoint);
    if (!subnet.response.ok) return await rejected(subnet.response.status, subnet.value);
    const bound = (value: Obj) => value.name === subnetName && value.selfLink === ref && value.region === `${SELF}/regions/${REGION}` && typeof value.privateIpGoogleAccess === "boolean";
    if (!bound(subnet.value)) return await complete(409, observation("failed", { error: "subnetwork_identity_or_state_unverified" }));
    prior = subnet.value.privateIpGoogleAccess as boolean;
    if (prior) return await complete(200, observation("observed", { private_google_access_enabled: true, configuration_verified: true }));
    attempted = true;
    const changed = await request(endpoint + "/setPrivateIpGoogleAccess", "POST", { privateIpGoogleAccess: true });
    if (!changed.response.ok) return await rejected(changed.response.status, changed.value);
    accepted = true;
    if (typeof changed.value.name !== "string" || !/^operation-[A-Za-z0-9-]{1,180}$/.test(changed.value.name) ||
        changed.value.region !== `${SELF}/regions/${REGION}` || changed.value.targetLink !== ref) {
      return await complete(503, observation("unknown", { error: "network_operation_identity_unverified" }));
    }
    operation = changed.value.name;
    const checked = await request(endpoint);
    if (!checked.response.ok) return await rejected(checked.response.status, checked.value);
    if (!bound(checked.value)) return await complete(503, observation("unknown", { error: "subnetwork_readback_identity_unverified" }));
    // The independently read desired state is sufficient even while Google's
    // regional operation is still reconciling. This does not prove guest egress.
    if (checked.value.privateIpGoogleAccess === true) return await complete(200, observation("observed", { private_google_access_enabled: true, configuration_verified: true }));
    return await complete(202, observation("accepted", { private_google_access_enabled: false }));
  } catch {
    return await complete(503, observation(attempted ? "unknown" : "failed", { error: attempted ? "video_network_mutation_outcome_unknown" : "video_network_provider_unavailable" }));
  }
}
