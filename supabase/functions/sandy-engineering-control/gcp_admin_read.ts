/** Owner-only read connection within the existing canonical preflight operation.
 * Runtime callbacks require both normal Owner Auth and Google's signed identity.
 */
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.10.0";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
const audience = "sandy-gcp-admin-readonly-zmqlyygzqoidkcwdysok";
const runtime =
  "sandy-mcp-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com";
const keys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const endpoints = new Set([
  "https://run.googleapis.com/v2/projects/elaborate-haven-511518-a5/locations/europe-west1/services/sandy-engineering-mcp",
  ...["sandy-video", "sandy-windows"].map((vm) =>
    "https://compute.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/" +
    vm
  ),
  ...["6831598645020395570", "8120150462304566315"].map((id) =>
    "https://iap.googleapis.com/v1/projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/" +
    id + ":getIamPolicy"
  ),
  "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sandy-cloud-administrator@elaborate-haven-511518-a5.iam.gserviceaccount.com:generateAccessToken",
]);
type Obj = Record<string, any>;
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
    .test(v);
const fail = (error: string, status = 403) =>
  Response.json({ ok: false, error, executed: false }, { status });
export async function verifyRuntime(token: string, keySet: any = keys) {
  const { payload } = await jwtVerify(token, keySet, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience,
    algorithms: ["RS256"],
  });
  return payload.email === runtime && payload.email_verified === true;
}
export async function handleGcpAdminRead(
  db: any,
  user: Obj,
  admin: Obj,
  token: string,
  b: Obj,
  workerUrl: string | undefined,
  request = fetch,
  verify = verifyRuntime,
): Promise<Response> {
  if (
    admin.role !== "owner" || user.app_metadata?.sandy_engineering_test === true
  ) return fail("administrator_read_owner_authority_required");
  if (b.action === "gcp_admin_read_claim") {
    if (
      Object.keys(b).some((k) =>
        !["action", "admission_id", "grant_id", "request_id", "worker_identity"]
          .includes(k)
      ) ||
      ![b.admission_id, b.grant_id, b.request_id].every(uuid) ||
      typeof b.worker_identity !== "string" || b.worker_identity.length > 10000
    ) return fail("invalid_administrator_read_claim", 400);
    try {
      if (!await verify(b.worker_identity)) {
        return fail("expected_google_runtime_identity_required");
      }
    } catch {
      return fail("expected_google_runtime_identity_required");
    }
    const { data, error } = await db.rpc("sandy_gcp_admin_read_claim", {
      p_actor: user.id,
      p_admission: b.admission_id,
      p_grant: b.grant_id,
      p_request: b.request_id,
    });
    return error || data?.ok !== true
      ? fail("administrator_read_admission_refused")
      : Response.json(data);
  }
  if (
    b.connection !== "sandy-gcp-admin" ||
    Object.keys(b).some((k) => !["action", "connection"].includes(k))
  ) return fail("invalid_administrator_read_request", 400);
  // Configuration selects this fixed service only; callers never supply URLs.
  if (
    !workerUrl ||
    !/^https:\/\/(?:sandy-api-review---)?sandy-engineering-mcp-(?:[a-z0-9]+-ew\.a|1030223524306\.europe-west1)\.run\.app$/
      .test(workerUrl)
  ) {
    return fail("fixed_administrator_worker_configuration_required", 424);
  }
  const { data: admitted, error } = await db.rpc("sandy_gcp_admin_read_admit", {
    p_actor: user.id,
  });
  if (error || !uuid(admitted?.admission_id)) {
    return fail("administrator_read_admission_unavailable", 503);
  }
  let result: Obj, status = 503;
  try {
    const response = await request(
      workerUrl + "/internal/gcp-admin/preflight",
      {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: JSON.stringify(admitted),
        signal: AbortSignal.timeout(90000),
      },
    );
    status = response.status;
    const text = await response.text();
    if (text.length > 40000) throw Error();
    result = JSON.parse(text);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw Error();
    }
    if (
      result.ok === true &&
      (status !== 200 || result.admission_id !== admitted.admission_id ||
        result.runtime_identity !== runtime ||
        result.deployed_runtime_identity !== runtime ||
        result.administrator_identity !==
          "sandy-cloud-administrator@elaborate-haven-511518-a5.iam.gserviceaccount.com" ||
        result.token_issuance_verified !== true || result.IAM_changes !== 0 ||
        result.agents_enrolled !== 0)
    ) throw Error();
    if (result.ok !== true) {
      // Never propagate arbitrary worker bodies or exception text to a client.
      const codes = new Set([
        "protected_API_admission_required",
        "protected_API_admission_refused",
        "google_runtime_metadata_required",
        "deployed_runtime_identity_mismatch",
        "administrator_short_lived_token_issuance_failed",
        "administrator_token_expiry_invalid",
        "administrator_provider_read_failed",
        "deployed_service_identity_mismatch",
        "immutable_vm_identity_mismatch",
        "IAP_policy_etag_required",
        "administrator_connection_unavailable",
      ]);
      result = {
        ok: false,
        error: codes.has(result.error)
          ? result.error
          : "administrator_read_failed",
        provider_http_status: Number.isInteger(result.provider_http_status) &&
            result.provider_http_status >= 100 &&
            result.provider_http_status <= 599
          ? result.provider_http_status
          : null,
        provider_endpoint: endpoints.has(result.provider_endpoint)
          ? result.provider_endpoint
          : null,
        execution_started: result.execution_started === true,
        reconciliation_required: result.execution_started !== false,
        IAM_changes: 0,
        agents_enrolled: 0,
      };
    } else {
      const allowed = [
        "ok",
        "connection",
        "read_only",
        "runtime_identity",
        "administrator_identity",
        "deployed_runtime_identity",
        "latest_ready_revision",
        "runtime_revision",
        "token_issuance_verified",
        "token_expires_at",
        "token_recorded",
        "provider_receipts",
        "targets",
        "IAM_changes",
        "agents_enrolled",
        "admission_id",
      ];
      const expiry = Date.parse(result.token_expires_at);
      if (
        Object.keys(result).some((k) => !allowed.includes(k)) ||
        result.connection !== "sandy-gcp-admin" || result.read_only !== true ||
        result.token_recorded !== false ||
        !Number.isFinite(expiry) || expiry <= Date.now() ||
        expiry > Date.now() + 1810000 ||
        !Array.isArray(result.provider_receipts) ||
        result.provider_receipts.length !== 5 ||
        !result.provider_receipts.every((r: Obj) =>
          r && r.http_status === 200 && endpoints.has(r.endpoint) &&
          Object.keys(r).every((k) => ["endpoint", "http_status"].includes(k))
        ) ||
        !Array.isArray(result.targets) || result.targets.length !== 2 ||
        !result.targets.every((t: Obj, i: number) =>
          t && t.vm_name === ["sandy-video", "sandy-windows"][i] &&
          t.instance_id === ["6831598645020395570", "8120150462304566315"][i] &&
          t.policy_read_verified === true
        )
      ) throw Error();
    }
  } catch {
    result = {
      ok: false,
      error: "administrator_read_outcome_unknown",
      reconciliation_required: true,
    };
  }
  const saved = await db.rpc("sandy_gcp_admin_read_finish", {
    p_actor: user.id,
    p_admission: admitted.admission_id,
    p_succeeded: result.ok === true,
    p_status: status,
    p_result_sha256: await argumentDigest(result),
  });
  if (saved.error || saved.data?.ok !== true) {
    return fail("administrator_read_receipt_state_unknown", 503);
  }
  return Response.json({
    ...result,
    admission_id: admitted.admission_id,
    executed: result.ok === true
      ? true
      : result.reconciliation_required || result.execution_started
      ? null
      : false,
  }, { status: result.ok === true ? 200 : 424 });
}
