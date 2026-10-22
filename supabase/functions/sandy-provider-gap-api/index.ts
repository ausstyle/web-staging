/** Fixed-provider gap executor. User sessions are authenticated by Sandy API. */
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createCredentialConsumer } from "../_shared/sandy_credential_consumer.ts";
import {
  createMachineAccessToken,
  type MachineAuth,
} from "../_shared/sandy_machine_identity.ts";
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import { gapContracts, type Obj } from "./contracts.ts";
import {
  argumentDigest,
  Calls,
  type Context,
  type Dependencies,
  fail,
  type Finish,
  gapExecutionScope,
  JsonRequestError,
  object,
  type PackageProof,
  type Policy,
  Refusal,
  refusal,
  requestJson,
  response,
  type ScopeBinding,
  UUID,
  validate,
  validateContext,
} from "./runtime.ts";
import { parsePackageRestoreBindings } from "./scope.ts";
export { parsePackageRestoreBindings } from "./scope.ts";
import { executeGithub, executeSerial, executeSupabase } from "./providers.ts";
export { gapContracts } from "./contracts.ts";
export {
  type Dependencies,
  gapExecutionScope,
  type ScopeBinding,
} from "./runtime.ts";
export function normalizeGapReceipt(request: Finish, value: unknown): Policy {
  if (
    !object(value) || value.ok !== true ||
    value.admission_id !== request.admission_id ||
    value.state !== request.outcome || typeof value.reused !== "boolean"
  ) {
    return {
      allowed: false,
      error: "execution_receipt_state_unknown",
      http_status: 503,
    };
  }
  return {
    allowed: true,
    admission_id: request.admission_id,
    reused: value.reused,
  };
}
export function validateGapContracts(): number {
  for (const op of Object.values(gapContracts)) {
    validate(op.operation + ":input", op.input_schema, {});
    validate(op.operation + ":output", op.output_schema, {});
  }
  return Object.keys(gapContracts).length;
}
export function createGapHandler(
  deps: Dependencies,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return refusal(405, "method_not_allowed");
    if (
      !deps.service ||
      req.headers.get("authorization") !== `Bearer ${deps.service}`
    ) return refusal(403, "service_authorization_required");
    let body: unknown;
    try {
      body = await requestJson(req, 150000);
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
      ? gapContracts[body.operation]
      : undefined;
    if (!op) return refusal(404, "operation_not_implemented");
    const args = body.arguments ?? {};
    if (
      !object(args) || !validate(op.operation + ":input", op.input_schema, args)
    ) return refusal(400, "invalid_operation_arguments");
    if (!validateContext(body)) {
      return refusal(400, "invalid_execution_context");
    }
    if (body.tenant_id !== null) {
      return refusal(403, "infrastructure_owner_scope_required");
    }
    const context: Context = body;
    let permission: Policy;
    try {
      permission = await deps.authorizeContext(context, op);
    } catch {
      return refusal(503, "execution_policy_unavailable");
    }
    if (!permission.allowed || permission.reused) {
      return refusal(
        permission.http_status ?? 403,
        permission.error ?? "execution_policy_refused",
      );
    }
    if (context.credential_id && !op.api_key_delegable) {
      return refusal(403, "api_key_operation_not_delegable");
    }
    let grant: Policy;
    try {
      grant = await deps.consumeGrant({
        ...context,
        operation: op.operation,
        input_sha256: await argumentDigest(args),
        contract_sha256: op.contract_sha256,
        scope_sha256: await argumentDigest(
          gapExecutionScope(op.operation, deps.packageRestoreBindings),
        ),
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
      status: number | null = calls?.last?.status ?? null,
      id: string | null = calls?.last?.id ?? null,
    ): Promise<boolean> => {
      try {
        const receipt = await deps.finishExecution({
          admission_id: admission,
          outcome,
          provider_http_status: status,
          provider_request_id: id,
          result_sha256: await argumentDigest(result),
        });
        return receipt.allowed === true && receipt.reused !== true;
      } catch {
        return false;
      }
    };
    try {
      let token: string;
      try {
        token = deps.credentialForExecution
          ? await deps.credentialForExecution(op, {
            actorId: context.actor_id,
            admissionId: admission,
            operation: op.operation,
          })
          : op.provider === "supabase"
          ? deps.management ?? ""
          : op.provider === "github"
          ? deps.github ?? ""
          : await deps.getGcpAccessToken?.() ?? "";
      } catch {
        fail("provider_credential_unavailable", 424);
      }
      if (!token!) fail("provider_credential_unavailable", 424);
      calls = new Calls(deps, token!, op.provider);
      const value = op.provider === "supabase"
        ? await executeSupabase(op, args, calls, (deps.now ?? Date.now)())
        : op.provider === "gcp"
        ? await executeSerial(args, calls)
        : await executeGithub(op, args, calls, deps, context, admission);
      const last = (op.is_mutation ? calls.mutationReceipt : calls.last) ??
        fail("provider_receipt_missing", 502);
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
        result: value.result,
        possibly_truncated: value.truncated,
      };
      if (!validate(op.operation + ":output", op.output_schema, output)) {
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
        calls?.last?.status ?? null,
        calls?.last?.id ?? null,
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
      if (!recorded) {
        return refusal(503, "execution_receipt_state_unknown", {
          admission_id: admission,
          request_may_have_executed: unknown,
        });
      }
      return refusal(unknown ? 503 : error.status, error.code, {
        admission_id: admission,
        provider_http_status: error.providerStatus ?? calls?.last?.status ??
          null,
        request_may_have_executed: unknown,
      });
    }
  };
}
if (import.meta.main) {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    db = createClient(Deno.env.get("SUPABASE_URL") ?? "", service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const legacy = {
    supabase_management: () =>
      Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN") ?? "",
    github_api: () =>
      Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN") ??
        Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN") ?? "",
    gcp_access_token: createMachineAccessToken(
      db.auth as unknown as MachineAuth,
    ),
  };
  const credentials = createCredentialConsumer({ db, legacy });
  const policy = async (name: string, args: Obj): Promise<Policy> => {
    const { data, error } = await db.rpc(name, args);
    return error
      ? {
        allowed: false,
        error: "execution_policy_unavailable",
        http_status: 503,
      }
      : data as Policy;
  };
  Deno.serve(createGapHandler({
    service,
    packageRestoreBindings: parsePackageRestoreBindings(
      Deno.env.get("SANDY_GITHUB_PACKAGE_RESTORE_BINDINGS_JSON"),
    ),
    credentialForExecution: (op, execution) =>
      credentials(
        op.provider === "supabase"
          ? "supabase_management"
          : op.provider === "github"
          ? "github_api"
          : "gcp_access_token",
        execution,
        (value) => Promise.resolve(value),
      ),
    authorizeContext: async (context, op) => {
      const [owner, registry] = await Promise.all([
        db.from("sandy_controller_admins").select("auth_user_id").eq(
          "auth_user_id",
          context.actor_id,
        ).eq("role", "owner").eq("enabled", true).maybeSingle(),
        db.from("sandy_operation_registry").select(
          "handler,api_exposed,verified,is_mutation,error_contract",
        ).eq("operation", op.operation).maybeSingle(),
      ]);
      if (owner.error || registry.error) {
        return {
          allowed: false,
          error: "execution_policy_unavailable",
          http_status: 503,
        };
      }
      const row = registry.data;
      if (
        !owner.data || !row || row.handler !== "sandy-provider-gap-api" ||
        row.api_exposed !== true || row.is_mutation !== op.is_mutation ||
        row.error_contract?.contract_sha256 !== op.contract_sha256
      ) {
        return {
          allowed: false,
          error: "execution_contract_not_enabled",
          http_status: 403,
        };
      }
      if (op.requires_approval && !row.verified) {
        return {
          allowed: false,
          error: "verified_execution_contract_required",
          http_status: 403,
        };
      }
      return { allowed: true };
    },
    consumeGrant: (r) =>
      policy("sandy_api_consume_execution_grant", {
        p_grant_id: r.grant_id,
        p_actor_id: r.actor_id,
        p_tenant_id: r.tenant_id,
        p_operation: r.operation,
        p_input_sha256: r.input_sha256,
        p_request_id: r.request_id,
        p_contract_sha256: r.contract_sha256,
        p_scope_sha256: r.scope_sha256,
      }),
    finishExecution: async (r) => {
      const { data, error } = await db.rpc("sandy_api_finish_execution", {
        p_admission_id: r.admission_id,
        p_outcome: r.outcome,
        p_provider_http_status: r.provider_http_status,
        p_provider_request_id: r.provider_request_id,
        p_result_sha256: r.result_sha256,
      });
      return error ? { allowed: false } : normalizeGapReceipt(r, data);
    },
    savePackageProof: async (admission, args, proof) => {
      const { error } = await db.rpc("sandy_provider_save_package_proof", {
        p_admission: admission,
        p_arguments_canonical: canonicalJson(args),
        p_proof: proof,
      });
      if (error) fail("package_identity_evidence_write_failed", 503);
    },
    loadPackageProof: async (admission, args) => {
      const { data, error } = await db.rpc(
        "sandy_provider_load_package_proof",
        { p_admission: admission, p_arguments_canonical: canonicalJson(args) },
      );
      if (error) fail("package_identity_evidence_lookup_failed", 503);
      return data as PackageProof | null;
    },
  }));
}
