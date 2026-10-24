import hostingAccounts from "./hosting_accounts.json" with { type: "json" };
import { provisioningOperations } from "./provisioning_operations.ts";
/** Existing Sandy API application service: normal customer Auth -> scoped RPC.
 * No service-role credential, caller-selected tenant, provider URL or SQL. */
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { requestJson } from "../_shared/sandy_api_protocol.ts";
import { onboardingOperations } from "./gateway.ts";
type Obj = Record<string, unknown>;
export type Dependencies = { base: string; anon: string; fetch: typeof fetch };
const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const failure = (status: number, error: string) =>
  reply(status, { ok: false, error, executed: false });
const ajv = new Ajv({ strict: true, formats: fullFormats });
const inputs = new Map(
  Object.values(onboardingOperations).map(
    (c) => [c.operation, ajv.compile(c.input_schema)],
  ),
);
const outputs = new Map(
  Object.values(onboardingOperations).map(
    (c) => [c.operation, ajv.compile(c.output_schema)],
  ),
);
export function createOnboardingHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return failure(405, "method_not_allowed");
    if (
      deps.base !== "https://zmqlyygzqoidkcwdysok.supabase.co" || !deps.anon
    ) return failure(503, "onboarding_configuration_unavailable");
    const bearer = request.headers.get("authorization")?.match(
      /^Bearer ([A-Za-z0-9._~-]{30,12000})$/i,
    )?.[1];
    if (!bearer || bearer === deps.anon) {
      return failure(401, "user_session_required");
    }
    let body: unknown;
    try {
      body = await requestJson(request, 76000);
    } catch {
      return failure(400, "invalid_onboarding_request");
    }
    if (
      !object(body) ||
      Object.keys(body).some((k) =>
        !["operation", "arguments", "request_id", "channel"].includes(k)
      ) || typeof body.operation !== "string" ||
      !Object.hasOwn(onboardingOperations, body.operation) ||
      !object(body.arguments) ||
      !inputs.get(body.operation)?.(body.arguments) ||
      body.request_id !== undefined && !uuid(body.request_id) ||
      body.channel !== undefined &&
        !["api", "mcp"].includes(String(body.channel))
    ) return failure(400, "invalid_onboarding_arguments");
    const headers = {
      authorization: "Bearer " + bearer,
      apikey: deps.anon,
      "content-type": "application/json",
    };
    let user: unknown;
    try {
      const response = await deps.fetch(deps.base + "/auth/v1/user", {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 401 || response.status === 403) {
        return failure(401, "user_session_invalid");
      }
      if (!response.ok) return failure(503, "authentication_unavailable");
      user = await response.json();
    } catch {
      return failure(503, "authentication_unavailable");
    }
    if (
      !object(user) || !uuid(user.id) || user.role !== "authenticated" ||
      user.is_anonymous === true || !user.email_confirmed_at ||
      typeof user.email !== "string" ||
      object(user.app_metadata) &&
        user.app_metadata.sandy_engineering_test === true
    ) return failure(403, "verified_customer_session_required");
    const requestId = body.request_id ?? crypto.randomUUID();
    const unknown = (error: string) =>
      reply(503, {
        ok: false,
        error,
        executed: null,
        request_id: requestId,
        automatic_retry: false,
        reconciliation_required: true,
      });
    try {
      const response = await deps.fetch(
        deps.base + "/rest/v1/rpc/" +
          (Object.hasOwn(hostingAccounts, body.operation)
            ? "sandy_hosting_account_execute"
            : Object.hasOwn(provisioningOperations, body.operation)
            ? "sandy_customer_provisioning_execute"
            : "sandy_customer_onboarding_execute"),
        {
          method: "POST",
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify({
            p_operation: body.operation,
            p_arguments: body.arguments,
            p_request_id: requestId,
          }),
        },
      );
      if (response.status === 401 || response.status === 403) {
        return failure(401, "user_session_invalid");
      }
      if (!response.ok) return unknown("onboarding_receipt_unavailable");
      const result: unknown = await response.json();
      if (!object(result)) return unknown("invalid_onboarding_result");
      if (result.ok !== true) {
        const allowed = new Set([
          "user_session_required",
          "verified_customer_session_required",
          "invalid_onboarding_request",
          "invalid_onboarding_arguments",
          "request_id_conflict",
          "onboarding_rate_limit",
          "customer_access_revoked",
          "primary_channel_verification_required",
          "identity_link_conflict",
          "onboarding_required",
          "invalid_hosting_arguments",
          "hosting_account_plan_conflict",
          "hosting_account_not_found",
          "identity_already_bound",
          "onboarding_version_conflict",
          "verified_customer_access_required",
          "invalid_provisioning_request",
          "invalid_provisioning_arguments",
          "provisioning_rate_limit",
          "provisioning_transaction_failed",
          "provisioning_previous_attempt_failed",
          "provisioning_job_not_found",
          "provisioning_template_unavailable",
          "invalid_provisioning_template",
          "provisioning_feature_not_entitled",
          "provisioning_policy_denied",
          "existing_resource_reconciliation_required",
          "provisioning_resource_quota_exceeded",
          "provisioning_plan_not_found",
          "provisioning_plan_stale",
          "provisioning_policy_changed",
          "provisioning_resource_changed",
          "customer_resource_not_found",
          "resource_identity_mismatch",
          "decommissioned_resource_reappeared",
          "explicit_data_deletion_required",
          "resource_version_conflict",
          "resource_recovery_requires_manual_investigation",
          "resource_reconciliation_required",
          "workspace_record_not_found",
          "workspace_record_version_conflict",
          "workspace_storage_quota_exceeded",
        ]);
        const error =
          typeof result.error === "string" && allowed.has(result.error)
            ? result.error
            : "onboarding_failed";
        const status = Number(result.http_status);
        return reply(
          [400, 401, 403, 404, 409, 429, 503].includes(status) ? status : 502,
          {
            ok: false,
            error,
            executed: false,
            ...(uuid(result.job_id) ? { job_id: result.job_id } : {}),
            ...(typeof result.request_id === "string" && uuid(result.request_id)
              ? { request_id: result.request_id }
              : {}),
            ...(result.automatic_retry === false
              ? { automatic_retry: false }
              : {}),
          },
        );
      }
      if (result.request_id !== requestId) {
        return unknown("invalid_onboarding_result");
      }
      if (outputs.get(body.operation)?.(result) !== true) {
        return unknown("invalid_onboarding_result");
      }
      return reply(200, result);
    } catch {
      return unknown("onboarding_outcome_unknown");
    }
  };
}
if (import.meta.main) {
  Deno.serve(
    createOnboardingHandler({
      base: Deno.env.get("SUPABASE_URL") ?? "",
      anon: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      fetch,
    }),
  );
}
