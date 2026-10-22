/** Compatibility reuses the canonical provider engine with the original operation
 * identity. Pure material validation never changes the admitted arguments. */
import {
  argumentDigest,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  createProviderOperationHandler,
  type ProviderDependencies,
} from "../sandy-provider-operation-api/index.ts";
import { legacyProviderContracts } from "./provider_contracts.ts";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const fail = (status: number, error: string) =>
  Response.json({ ok: false, error, executed: false }, { status });
async function sha256(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function createLegacyProviderHandler(deps: ProviderDependencies) {
  const canonical = createProviderOperationHandler(
    deps,
    legacyProviderContracts,
  );
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return fail(405, "method_not_allowed");
    if (
      !deps.service ||
      request.headers.get("authorization") !== `Bearer ${deps.service}` ||
      request.headers.has("x-api-key")
    ) return fail(403, "internal_service_transport_required");
    let body: unknown;
    try {
      body = await requestJson(request.clone(), 155000);
    } catch (error) {
      return fail(
        error instanceof JsonRequestError ? error.status : 400,
        error instanceof JsonRequestError ? error.code : "invalid_request",
      );
    }
    if (
      !object(body) || body.tenant_id !== null || body.credential_id !== null
    ) return fail(403, "actual_owner_session_admission_required");
    if (body.operation === "supabase.apply_migration") {
      const args = object(body.arguments) ? body.arguments : {};
      const material = object(args.body) ? args.body : {};
      if (
        typeof material.query !== "string" ||
        args.migration_ref !== await sha256(material.query)
      ) return fail(400, "migration_ref_must_match_exact_sql_sha256");
    }
    const result = await canonical(request);
    if (result.ok) return result;
    const value = await result.clone().json().catch(() => null);
    if (
      object(value) && (value.request_state === "unknown" ||
        [
          "execution_receipt_state_unknown",
          "provider_response_unavailable",
          "provider_response_contract_mismatch",
        ].includes(String(value.error)))
    ) {
      return Response.json({
        ...value,
        executed: null,
        reconciliation_required: true,
      }, { status: result.status, headers: result.headers });
    }
    return result;
  };
}
export { argumentDigest };
