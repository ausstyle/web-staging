/** Private fixed-provider adapters. Sandy API authenticates normal owner sessions. */
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { approvedOwnerContract } from "../_shared/sandy_approval_contract.ts";
import { createCredentialConsumer } from "../_shared/sandy_credential_consumer.ts";
import {
  createMachineAccessToken,
  type MachineAuth,
} from "../_shared/sandy_machine_identity.ts";
import { parseProviderBindings } from "../sandy-provider-operation-api/configured_scopes.ts";
import { type Contract, type Obj, sensitiveContracts } from "./contracts.ts";
import { execute } from "./providers.ts";
import { SensitiveCalls as Calls } from "./transport.ts";
import {
  argumentDigest,
  type Context,
  decode64,
  type Dependencies,
  type Finish,
  JsonRequestError,
  object,
  type Policy,
  Refusal,
  refusal,
  requestJson,
  response,
  UUID,
  validate,
} from "../sandy-provider-supplement-api/runtime.ts";
import { sensitiveExecutionScope } from "./scope.ts";
export { sensitiveContracts } from "./contracts.ts";
export { sensitiveExecutionScope } from "./scope.ts";
export type { Dependencies } from "../sandy-provider-supplement-api/runtime.ts";
export function sensitiveContractEnabled(
  entry: unknown,
  op: Pick<Contract, "is_mutation" | "contract_sha256" | "permission_scope">,
): boolean {
  return approvedOwnerContract(entry, {
    handler: "sandy-provider-sensitive-api",
    is_mutation: op.is_mutation,
    contract_sha256: op.contract_sha256,
  }) && object(entry) && entry.permission_scope === op.permission_scope &&
    object(entry.error_contract) &&
    entry.error_contract.requires_grant === true;
}
export function normalizeReceipt(r: Finish, data: unknown): Policy {
  return object(data) && data.ok === true &&
      data.admission_id === r.admission_id &&
      data.state === r.outcome && data.reused === false
    ? { allowed: true, admission_id: r.admission_id, reused: false }
    : {
      allowed: false,
      error: "execution_receipt_state_unknown",
      http_status: 503,
    };
}
export function createSensitiveHandler(
  deps: Dependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return refusal(405, "method_not_allowed");
    if (
      !deps.service ||
      request.headers.get("authorization") !== `Bearer ${deps.service}`
    ) return refusal(403, "service_authorization_required");
    let body: unknown;
    try {
      body = await requestJson(request, 1550000);
    } catch (e) {
      return refusal(
        e instanceof JsonRequestError ? e.status : 400,
        e instanceof JsonRequestError ? e.code : "invalid_request",
      );
    }
    if (
      !object(body) || Object.keys(body).some((k) =>
        ![
          "operation",
          "arguments",
          "actor_id",
          "tenant_id",
          "request_id",
          "grant_id",
          "admission_id",
          "credential_id",
        ].includes(k)
      )
    ) return refusal(400, "invalid_request");
    const op = typeof body.operation === "string"
      ? sensitiveContracts[body.operation]
      : undefined;
    if (!op) return refusal(404, "operation_not_implemented");
    const args = body.arguments ?? {};
    if (!object(args) || !validate(op.input_schema, args)) {
      return refusal(400, "invalid_operation_arguments");
    }
    if (
      typeof body.actor_id !== "string" || !UUID.test(body.actor_id) ||
      typeof body.request_id !== "string" || !UUID.test(body.request_id) ||
      typeof body.grant_id !== "string" || !UUID.test(body.grant_id) ||
      body.tenant_id !== null ||
      body.admission_id !== undefined &&
        (typeof body.admission_id !== "string" ||
          !UUID.test(body.admission_id)) ||
      body.credential_id !== undefined && body.credential_id !== null
    ) return refusal(400, "normal_owner_execution_context_required");
    const context = body as Obj & Context;
    let scope: Obj;
    try {
      scope = sensitiveExecutionScope(op.operation, deps.bindings);
    } catch (e) {
      return refusal(
        424,
        e instanceof Error &&
          /^verified_[a-z_]+_scope_binding_required$/.test(e.message)
          ? e.message
          : "provider_scope_configuration_invalid",
      );
    }
    let policy: Policy;
    try {
      policy = await deps.authorizeContext(context, op);
    } catch {
      return refusal(503, "execution_policy_unavailable");
    }
    if (!policy.allowed || policy.reused) {
      return refusal(
        policy.http_status ?? 403,
        policy.error ?? "execution_policy_refused",
      );
    }
    let grant: Policy;
    try {
      grant = await deps.consumeGrant({
        ...context,
        operation: op.operation,
        input_sha256: await argumentDigest(args),
        contract_sha256: op.contract_sha256,
        scope_sha256: await argumentDigest(scope),
      });
    } catch {
      return refusal(503, "execution_grant_state_unknown");
    }
    if (
      !grant.allowed || grant.reused || !grant.admission_id ||
      !UUID.test(grant.admission_id)
    ) {
      return refusal(
        grant.http_status ?? 409,
        grant.error ?? "execution_grant_refused",
      );
    }
    const admission = grant.admission_id;
    let calls: Calls | undefined;
    const finish = async (
      outcome: Finish["outcome"],
      result: unknown,
      status = calls?.last?.status ?? null,
      id = calls?.last?.id ?? null,
    ) => {
      try {
        const value = await deps.finishExecution({
          admission_id: admission,
          outcome,
          provider_http_status: status,
          provider_request_id: id,
          result_sha256: await argumentDigest(result),
        });
        return value.allowed === true && value.reused !== true;
      } catch {
        return false;
      }
    };
    try {
      let token: string;
      try {
        token = await deps.credentialForExecution(op, {
          actorId: context.actor_id,
          admissionId: admission,
          operation: op.operation,
        });
      } catch {
        throw new Refusal("provider_credential_unavailable", 424);
      }
      if (!token) throw new Refusal("provider_credential_unavailable", 424);
      calls = new Calls(deps, token, op.provider);
      const result = await execute(op, args, calls, deps, context, admission);
      const last = op.is_mutation ? calls.mutationReceipt : calls.last;
      if (!last) throw new Refusal("provider_receipt_missing", 502);
      const output = {
        ok: true,
        operation: op.operation,
        contract_version: "1.0.0",
        provider: op.provider,
        request_state: op.is_mutation ? "accepted" : "observed",
        executed: true,
        admission_id: admission,
        provider_http_status: last.status,
        provider_request_id: last.id,
        result,
      };
      if (!validate(op.output_schema, output)) {
        throw new Refusal(
          "provider_output_contract_mismatch",
          502,
          last.status,
          last.id,
          calls.mutationDispatched,
        );
      }
      if (
        !await finish(
          op.is_mutation ? "accepted" : "succeeded",
          output,
          last.status,
          last.id,
        )
      ) {
        return refusal(503, "execution_receipt_state_unknown", {
          admission_id: admission,
          request_may_have_executed: calls.mutationDispatched,
        });
      }
      return response(200, output);
    } catch (e) {
      const error = e instanceof Refusal ? e : new Refusal(
        "provider_execution_state_unknown",
        503,
        null,
        null,
        calls?.mutationDispatched ?? false,
      );
      const unknown = error.mayHaveExecuted ||
        !!(calls?.mutationReceipt && calls.mutationReceipt.status >= 200 &&
          calls.mutationReceipt.status < 300);
      const recorded = await finish(
        unknown ? "unknown" : "failed",
        { error: error.code, request_may_have_executed: unknown },
        error.providerStatus ?? calls?.last?.status ?? null,
        error.providerId ?? calls?.last?.id ?? null,
      );
      return refusal(
        !recorded || unknown ? 503 : error.status,
        !recorded ? "execution_receipt_state_unknown" : error.code,
        {
          admission_id: admission,
          request_may_have_executed: unknown,
          provider_http_status: error.providerStatus ?? calls?.last?.status ??
            null,
        },
      );
    }
  };
}
if (import.meta.main) {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const credentials = createCredentialConsumer({
    db,
    legacy: {
      supabase_management: () =>
        Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN") ?? "",
      github_api: () =>
        Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN") ??
          Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN") ?? "",
      gcp_access_token: createMachineAccessToken(
        db.auth as unknown as MachineAuth,
      ),
    },
  });
  const rpc = async (name: string, args: Obj): Promise<unknown> => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw Error("private_state_unavailable");
    return data;
  };
  Deno.serve(createSensitiveHandler({
    service,
    bindings: parseProviderBindings(
      Deno.env.get("SANDY_PROVIDER_VERIFIED_BINDINGS_JSON"),
    ),
    credentialForExecution: (op, context) =>
      credentials(
        op.provider === "supabase"
          ? "supabase_management"
          : op.provider === "github"
          ? "github_api"
          : "gcp_access_token",
        context,
        (value) => Promise.resolve(value),
      ),
    authorizeContext: async (context, op) => {
      const [owner, registry] = await Promise.all([
        db.from("sandy_controller_admins").select("auth_user_id").eq(
          "auth_user_id",
          context.actor_id,
        ).eq("role", "owner").eq("enabled", true).maybeSingle(),
        db.from("sandy_operation_registry").select(
          "handler,api_exposed,verified,is_mutation,permission_scope,error_contract",
        ).eq("operation", op.operation).maybeSingle(),
      ]);
      const row = registry.data;
      if (owner.error || registry.error) {
        return {
          allowed: false,
          error: "execution_policy_unavailable",
          http_status: 503,
        };
      }
      if (
        !owner.data || !sensitiveContractEnabled(row, op)
      ) {
        return {
          allowed: false,
          error: "verified_execution_contract_required",
          http_status: 403,
        };
      }
      return { allowed: true };
    },
    consumeGrant: async (r) =>
      await rpc("sandy_api_consume_execution_grant", {
        p_grant_id: r.grant_id,
        p_actor_id: r.actor_id,
        p_tenant_id: null,
        p_operation: r.operation,
        p_input_sha256: r.input_sha256,
        p_request_id: r.request_id,
        p_contract_sha256: r.contract_sha256,
        p_scope_sha256: r.scope_sha256,
      }) as Policy,
    finishExecution: async (r) =>
      normalizeReceipt(
        r,
        await rpc("sandy_api_finish_execution", {
          p_admission_id: r.admission_id,
          p_outcome: r.outcome,
          p_provider_http_status: r.provider_http_status,
          p_provider_request_id: r.provider_request_id,
          p_result_sha256: r.result_sha256,
        }),
      ),
    saveOpaque: async (value) =>
      await rpc("sandy_provider_supplement_save_opaque", {
        p_context: value,
      }) as Awaited<ReturnType<Dependencies["saveOpaque"]>>,
    takeOpaque: async (binding, id) => {
      const result = await rpc("sandy_provider_supplement_take_opaque", {
        p_context: binding,
        p_id: id,
      });
      if (!object(result) || typeof result.payload_base64 !== "string") {
        throw Error("opaque_state_invalid");
      }
      return decode64(result.payload_base64);
    },
  }));
}
