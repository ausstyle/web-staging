import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  admitExecution,
  consumeExecutionGrant,
  type ExecutionAdmission,
  type ExecutionAdmissionInput,
  finishExecution,
  type PolicyDb,
} from "./access_policy.ts";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const reply = (status: number, body: unknown) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
/** Admission, rate limits, a one-use grant and durable result evidence surround
 * the same executor used by ordinary requests. A provider handler consumes and
 * finishes its own grant at the last trusted boundary; other handlers do so here.
 */
export async function governedExecution(
  db: PolicyDb,
  input: ExecutionAdmissionInput,
  execute: (admission: ExecutionAdmission) => Promise<Response>,
  providerOwnsGrant = false,
): Promise<Response> {
  const admitted = await admitExecution(db, input);
  if (!admitted.ok) return reply(admitted.status, {
    ok: false, operation: input.operation, error: admitted.error, executed: false,
    request_id: input.requestId,
    ...(admitted.reconciliationRequired ? { reconciliation_required: true } : {}),
  });
  const admission = admitted.value;
  const receipt = { request_id: input.requestId, admission_id: admission.admissionId };
  if (!providerOwnsGrant) {
    const consumed = await consumeExecutionGrant(db, admission);
    if (!consumed.ok) return reply(consumed.status, {
      ok: false, operation: input.operation, error: consumed.error,
      executed: false, ...receipt,
      ...(consumed.reconciliationRequired ? { reconciliation_required: true } : {}),
    });
  }
  let response: Response;
  let body: Record<string, unknown>;
  try {
    response = await execute(admission);
    const result: unknown = await response.json();
    if (!object(result)) throw Error("invalid_handler_response");
    body = result;
  } catch {
    response = reply(502, {});
    body = { ok: false, operation: input.operation, error: "execution_outcome_unknown", executed: null, reconciliation_required: true };
  }
  if (!providerOwnsGrant) {
    // Queue acceptance records intent; it cannot certify a provider outcome.
    const outcome = body.executed === null || body.reconciliation_required === true
      ? "unknown"
      : response.ok && body.ok === true
      ? body.accepted === true && body.executed === false ? "accepted" : "succeeded"
      : "failed";
    const providerStatus = Number.isInteger(body.upstream_status) &&
        Number(body.upstream_status) >= 100 && Number(body.upstream_status) <= 599
      ? Number(body.upstream_status)
      : null;
    const providerRequestId = typeof body.provider_request_id === "string" &&
        /^[A-Za-z0-9_.:/-]{1,200}$/.test(body.provider_request_id)
      ? body.provider_request_id : null;
    const finished = await finishExecution(db, admission.admissionId, outcome,
      providerStatus, providerRequestId, await argumentDigest(body));
    if (!finished.ok) return reply(503, {
      ...body, ...receipt, ok: false, error: finished.error,
      reconciliation_required: true,
    });
  }
  return reply(response.status, { ...body, ...receipt });
}
