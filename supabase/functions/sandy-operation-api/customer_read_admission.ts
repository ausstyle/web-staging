import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import type {
  ExecutionAdmission,
  PolicyDb,
  PolicyResult,
} from "./access_policy.ts";
import { governedExecution } from "./governed_execution.ts";

// Reviewed existing read contracts only. New handlers require an explicit review
// here and in the database boundary; registry flags cannot expand this grant.
export const admittedCustomerReads = Object.freeze([
  "tasks.list",
  "tasks.get",
  "calendar.list",
  "calendar.get",
  "agenda.overview",
  "calendar.client.overview",
  "agenda.pins.list",
  "calendar.client.timezone.get",
]);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const failure = (
  status: number,
  error: string,
  reconciliationRequired = false,
): PolicyResult<never> => ({
  ok: false,
  status,
  error,
  ...(reconciliationRequired ? { reconciliationRequired: true } : {}),
});
async function rpc(
  db: PolicyDb,
  name: string,
  args: Record<string, unknown>,
): Promise<PolicyResult<Record<string, unknown>>> {
  try {
    const { data, error } = await db.rpc(name, args);
    if (error || !object(data)) {
      return failure(503, "customer_read_admission_unavailable", true);
    }
    if (data.ok !== true) {
      const status = Number(data.http_status);
      return failure(
        [400, 403, 404, 409, 429].includes(status) ? status : 503,
        typeof data.error === "string" &&
          /^customer_read_[a-z_]+$|^request_id_conflict$|^admission_already_recorded$/
            .test(data.error)
          ? data.error
          : "customer_read_admission_refused",
      );
    }
    return { ok: true, value: data };
  } catch {
    return failure(503, "customer_read_admission_unavailable", true);
  }
}
/** Normal-JWT admission and consumption use authenticated PostgREST. The gateway
 * service client only settles the existing shared digest-only execution receipt.
 * No actor, tenant, grant or operation authority is taken from request arguments.
 */
export function governedCustomerRead(
  serviceDb: PolicyDb,
  authenticatedDb: PolicyDb,
  actorId: string,
  operation: string,
  args: unknown,
  requestId: string,
  contractSha256: string,
  channel: "api" | "mcp",
  execute: () => Promise<Response>,
): Promise<Response> {
  return governedExecution(
    serviceDb,
    {
      actorId,
      tenantId: null,
      operation,
      arguments: args,
      requestId,
      contractSha256,
      scope: { channel },
    },
    async () => {
      const response = await execute();
      // These contracts are synchronous reads. Queue acceptance cannot be called a
      // completed read or settled as succeeded by the common receipt machinery.
      const body = await response.clone().json();
      if (object(body) && body.accepted === true) {
        return Response.json({
          ok: false,
          error: "customer_read_unexpected_acceptance",
          executed: null,
          reconciliation_required: true,
        }, { status: 502 });
      }
      return response;
    },
    false,
    {
      async admit(input) {
        if (
          !uuid(actorId) || !uuid(requestId) ||
          !admittedCustomerReads.includes(operation) ||
          !/^[a-f0-9]{64}$/.test(contractSha256)
        ) return failure(400, "customer_read_invalid_admission");
        let inputSha256: string;
        try {
          inputSha256 = await argumentDigest(input.arguments);
        } catch {
          return failure(400, "customer_read_invalid_admission");
        }
        const result = await rpc(
          authenticatedDb,
          "sandy_api_admit_customer_read",
          {
            p_operation: operation,
            p_request_id: requestId,
            p_input_sha256: inputSha256,
            p_contract_sha256: contractSha256,
            p_channel: channel,
          },
        );
        if (!result.ok) return result;
        const v = result.value;
        if (
          v.allowed !== true || v.reused !== false || v.state !== "admitted" ||
          v.executed !== false ||
          v.actor_id !== actorId || !uuid(v.tenant_id) ||
          !uuid(v.admission_id) || !uuid(v.grant_id) ||
          typeof v.scope_sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(v.scope_sha256) ||
          typeof v.expires_at !== "string" ||
          !(Date.parse(v.expires_at) > Date.now())
        ) {
          return failure(503, "customer_read_admission_outcome_unknown", true);
        }
        return {
          ok: true,
          value: {
            actorId,
            tenantId: v.tenant_id,
            admissionId: v.admission_id,
            grantId: v.grant_id,
            requestId,
            operation,
            inputSha256,
            contractSha256,
            scopeSha256: v.scope_sha256,
            expiresAt: v.expires_at,
          },
        };
      },
      async consume(admission: ExecutionAdmission) {
        const result = await rpc(
          authenticatedDb,
          "sandy_api_consume_customer_read",
          {
            p_grant_id: admission.grantId,
            p_operation: admission.operation,
            p_request_id: admission.requestId,
            p_input_sha256: admission.inputSha256,
            p_contract_sha256: admission.contractSha256,
            p_channel: channel,
          },
        );
        if (!result.ok) return result;
        return result.value.allowed === true && result.value.reused === false &&
            result.value.admission_id === admission.admissionId
          ? { ok: true, value: { admissionId: admission.admissionId } }
          : failure(503, "customer_read_grant_outcome_unknown", true);
      },
    },
  );
}
