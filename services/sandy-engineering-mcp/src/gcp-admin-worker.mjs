// Sandy API provider worker colocated with the MCP transport. MCP never calls
// this implementation directly; Engineering Control owns admission and receipts.
import { Compute, Impersonated } from "google-auth-library";
export const project = "elaborate-haven-511518-a5";
export const runtimeAccount = `sandy-mcp-runtime@${project}.iam.gserviceaccount.com`;
export const administratorAccount = `sandy-cloud-administrator@${project}.iam.gserviceaccount.com`;
export const workerAudience = "sandy-gcp-admin-readonly-zmqlyygzqoidkcwdysok";
const control = "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-engineering-control";
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export class AdminReadFailure extends Error {
  constructor(code, status = 424, providerStatus = null, endpoint = null) { super(code); this.status = status; this.providerStatus = providerStatus; this.endpoint = endpoint; }
}
export function metadataConnection(request = fetch, source = new Compute(), impersonate = options => new Impersonated(options)) {
  return async () => {
    // Explicit metadata credentials: never GoogleAuth ADC discovery, a JSON key,
    // an email environment variable or the caller's Google credential.
    const response = await request("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email", {
      headers: { "Metadata-Flavor": "Google" }, redirect: "error", signal: AbortSignal.timeout(5000)
    });
    if (!response.ok || response.headers.get("metadata-flavor") !== "Google") throw new AdminReadFailure("google_runtime_metadata_required");
    const principal = (await response.text()).trim();
    if (principal !== runtimeAccount) throw new AdminReadFailure("deployed_runtime_identity_mismatch");
    return { principal, identityToken: () => source.fetchIdToken(workerAudience),
      administrator: () => impersonate({ sourceClient: source, targetPrincipal: administratorAccount,
        targetScopes: ["https://www.googleapis.com/auth/cloud-platform"], delegates: [], lifetime: 1800 }) };
  };
}
export async function readAdministrator(connection, now = Date.now) {
  const admin = connection.administrator();
  try { await admin.getAccessToken(); }
  catch (e) { throw new AdminReadFailure("administrator_short_lived_token_issuance_failed", 424,
    Number.isInteger(e?.response?.status) ? e.response.status : null,
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${administratorAccount}:generateAccessToken`); }
  const remaining = Number(admin.credentials?.expiry_date) - now();
  if (!Number.isFinite(remaining) || remaining < 60000 || remaining > 1810000) throw new AdminReadFailure("administrator_token_expiry_invalid");
  const receipts = [];
  const read = async (url, data) => {
    try {
      const r = await admin.request({ url, method: data ? "POST" : "GET", ...(data ? { data } : {}),
        timeout: 15000, retry: false, maxRedirects: 0, maxContentLength: 262144, responseType: "json" });
      receipts.push({ endpoint: url, http_status: r.status });
      return r.data;
    } catch (e) { throw new AdminReadFailure("administrator_provider_read_failed", 424,
      Number.isInteger(e?.response?.status) ? e.response.status : null, url); }
  };
  const service = await read(`https://run.googleapis.com/v2/projects/${project}/locations/europe-west1/services/sandy-engineering-mcp`);
  if (service.template?.serviceAccount !== runtimeAccount) throw new AdminReadFailure("deployed_service_identity_mismatch");
  const targets = [];
  for (const [name, id, port] of [["sandy-video", "6831598645020395570", 22], ["sandy-windows", "8120150462304566315", 5986]]) {
    const vm = await read(`https://compute.googleapis.com/compute/v1/projects/${project}/zones/europe-west1-b/instances/${name}`);
    if (String(vm.id) !== id || vm.name !== name) throw new AdminReadFailure("immutable_vm_identity_mismatch");
    const policy = await read(`https://iap.googleapis.com/v1/projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/${id}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } });
    if (typeof policy.etag !== "string" || !policy.etag) throw new AdminReadFailure("IAP_policy_etag_required");
    targets.push({ vm_name: name, instance_id: id, port, policy_read_verified: true, etag: policy.etag,
      target_bindings: (policy.bindings ?? []).filter(b => b.members?.includes(`serviceAccount:sandy-computer@${project}.iam.gserviceaccount.com`))
        .map(b => ({ role: b.role, condition: b.condition ?? null })) });
  }
  return { ok: true, connection: "sandy-gcp-admin", read_only: true, runtime_identity: connection.principal,
    administrator_identity: administratorAccount, deployed_runtime_identity: service.template.serviceAccount,
    latest_ready_revision: service.latestReadyRevision ?? null, token_issuance_verified: true,
    runtime_revision: process.env.K_REVISION ?? null,
    token_expires_at: new Date(admin.credentials.expiry_date).toISOString(), token_recorded: false,
    provider_receipts: receipts, targets, IAM_changes: 0, agents_enrolled: 0 };
}
export function createAdminReadWorker({ connect = metadataConnection(), request = fetch } = {}) {
  return async (req, res) => {
    const bearer = req.get("authorization");
    const b = req.body;
    if (!/^Bearer [A-Za-z0-9._~-]+$/.test(bearer ?? "") || !b || typeof b !== "object" || Array.isArray(b) ||
      Object.keys(b).some(k => !["admission_id", "grant_id", "request_id"].includes(k)) ||
      ![b.admission_id, b.grant_id, b.request_id].every(uuid)) return res.status(403).json({ ok: false, error: "protected_API_admission_required" });
    let claimed = false;
    try {
      const connection = await connect();
      const identity = await connection.identityToken();
      const claim = await request(control, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { authorization: bearer, "content-type": "application/json" },
        body: JSON.stringify({ action: "gcp_admin_read_claim", ...b, worker_identity: identity }) });
      const allowed = await claim.json();
      if (!claim.ok || allowed.ok !== true || allowed.admission_id !== b.admission_id) {
        return res.status(403).json({ ok: false, error: "protected_API_admission_refused" });
      }
      claimed = true;
      return res.status(200).json({ ...await readAdministrator(connection), admission_id: b.admission_id });
    } catch (e) {
      return res.status(e instanceof AdminReadFailure ? e.status : 503).json({ ok: false,
        error: e instanceof AdminReadFailure ? e.message : "administrator_connection_unavailable",
        provider_http_status: e instanceof AdminReadFailure ? e.providerStatus : null,
        provider_endpoint: e instanceof AdminReadFailure ? e.endpoint : null,
        execution_started: claimed, provider_reads_may_have_executed: claimed,
        IAM_changes: 0, agents_enrolled: 0 });
    }
  };
}
