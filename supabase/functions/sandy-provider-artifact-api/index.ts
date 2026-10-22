/** One-use owner-approved delivery of explicitly classified provider downloads. */
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { approvedOwnerContract } from "../_shared/sandy_approval_contract.ts";
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import {
  argumentDigest,
  bytesDigest,
  decode64,
  type Finish,
  object,
  type Policy,
  refusal,
  requestJson,
  response,
  UUID,
  validate,
} from "../sandy-provider-supplement-api/runtime.ts";
import {
  ARTIFACT_OPERATION,
  artifactContract,
  artifactExecutionScope,
  type Obj,
} from "./contracts.ts";
type Context = {
  actor_id: string;
  tenant_id: null;
  request_id: string;
  grant_id: string;
  operation: string;
  arguments: Obj;
};
export type ArtifactDependencies = {
  service: string;
  authorizeContext: (context: Context) => Promise<Policy>;
  consumeGrant: (
    context: Context & {
      input_sha256: string;
      contract_sha256: string;
      scope_sha256: string;
    },
  ) => Promise<Policy>;
  deliver: (
    actor: string,
    admission: string,
    argumentsCanonical: string,
    scopeCanonical: string,
  ) => Promise<unknown>;
  finishExecution: (receipt: Finish) => Promise<Policy>;
};
export class DeliveryRefusal extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export const artifactContractEnabled = (entry: unknown) =>
  approvedOwnerContract(entry, {
    handler: artifactContract.handler,
    is_mutation: false,
    contract_sha256: artifactContract.contract_sha256,
  }) && object(entry) && entry.permission_scope === "infrastructure:write" &&
  object(entry.error_contract) && entry.error_contract.requires_grant === true;
export function createArtifactHandler(deps: ArtifactDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return refusal(405, "method_not_allowed");
    if (
      !deps.service ||
      request.headers.get("authorization") !== `Bearer ${deps.service}`
    ) return refusal(403, "service_authorization_required");
    let body: unknown;
    try {
      body = await requestJson(request, 16000);
    } catch {
      return refusal(400, "invalid_request");
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
    if (body.operation !== ARTIFACT_OPERATION) {
      return refusal(404, "operation_not_implemented");
    }
    if (
      !object(body.arguments) ||
      !validate(artifactContract.input_schema, body.arguments)
    ) return refusal(400, "invalid_operation_arguments");
    if (
      typeof body.actor_id !== "string" || !UUID.test(body.actor_id) ||
      body.tenant_id !== null || body.credential_id != null ||
      typeof body.request_id !== "string" || !UUID.test(body.request_id) ||
      typeof body.grant_id !== "string" || !UUID.test(body.grant_id) ||
      body.admission_id !== undefined &&
        (typeof body.admission_id !== "string" || !UUID.test(body.admission_id))
    ) return refusal(400, "normal_owner_execution_context_required");
    const context = body as Context,
      args = body.arguments,
      scope = artifactExecutionScope(ARTIFACT_OPERATION, args);
    let policy: Policy;
    try {
      policy = await deps.authorizeContext(context);
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
        input_sha256: await argumentDigest(args),
        scope_sha256: await argumentDigest(scope),
        contract_sha256: artifactContract.contract_sha256,
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
    const finish = async (outcome: Finish["outcome"], value: unknown) => {
      try {
        const receipt = await deps.finishExecution({
          admission_id: admission,
          outcome,
          provider_http_status: null,
          provider_request_id: null,
          result_sha256: await argumentDigest(value),
        });
        return receipt.allowed && !receipt.reused;
      } catch {
        return false;
      }
    };
    try {
      const result = await deps.deliver(
        context.actor_id,
        admission,
        canonicalJson(args),
        canonicalJson(scope),
      );
      if (!object(result) || typeof result.content_base64 !== "string") {
        throw Error("private_delivery_receipt_invalid");
      }
      const bytes = decode64(result.content_base64);
      if (
        typeof result.custody_id !== "string" ||
        result.custody_id.toLowerCase() !==
          String(args.custody_id).toLowerCase() ||
        result.sha256 !== args.expected_sha256 ||
        result.source_operation !== args.source_operation ||
        result.source_input_sha256 !== args.source_input_sha256 ||
        result.source_scope_sha256 !== args.source_scope_sha256 ||
        result.byte_length !== bytes.length ||
        await bytesDigest(bytes) !== result.sha256
      ) throw Error("private_delivery_receipt_invalid");
      const output = {
        ok: true,
        operation: ARTIFACT_OPERATION,
        contract_version: "1.0.0",
        request_state: "delivered",
        executed: true,
        admission_id: admission,
        result,
        reconciliation_required: false,
      };
      if (!validate(artifactContract.output_schema, output)) {
        throw Error("private_delivery_receipt_invalid");
      }
      if (!await finish("succeeded", output)) {
        return refusal(503, "execution_receipt_state_unknown", {
          admission_id: admission,
          request_may_have_executed: true,
        });
      }
      return response(200, output);
    } catch (error) {
      const failed = error instanceof DeliveryRefusal,
        code = failed ? error.code : "artifact_delivery_outcome_unknown";
      const recorded = await finish(failed ? "failed" : "unknown", {
        error: code,
      });
      return refusal(
        failed && recorded ? 409 : 503,
        recorded ? code : "execution_receipt_state_unknown",
        {
          admission_id: admission,
          request_may_have_executed: !failed || !recorded,
        },
      );
    }
  };
}
if (import.meta.main) {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    db = createClient(Deno.env.get("SUPABASE_URL") ?? "", service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const rpc = async (name: string, args: Obj) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw Error("private_state_unavailable");
    return data;
  };
  const known = new Set([
    "artifact_delivery_context_invalid",
    "artifact_delivery_owner_admission_required",
    "artifact_delivery_current_contract_required",
    "artifact_delivery_source_class_required",
    "artifact_delivery_binding_expired_or_used",
    "artifact_delivery_source_contract_changed",
    "artifact_delivery_source_not_succeeded",
    "artifact_delivery_integrity_failed",
    "artifact_delivery_credential_material_refused",
  ]);
  Deno.serve(
    createArtifactHandler({
      service,
      authorizeContext: async (context) => {
        const [owner, row] = await Promise.all([
          db.from("sandy_controller_admins").select("auth_user_id").eq(
            "auth_user_id",
            context.actor_id,
          ).eq("role", "owner").eq("enabled", true).maybeSingle(),
          db.from("sandy_operation_registry").select(
            "handler,api_exposed,verified,is_mutation,permission_scope,error_contract",
          ).eq("operation", ARTIFACT_OPERATION).maybeSingle(),
        ]);
        return owner.error || row.error
          ? {
            allowed: false,
            http_status: 503,
            error: "execution_policy_unavailable",
          }
          : owner.data && artifactContractEnabled(row.data)
          ? { allowed: true }
          : {
            allowed: false,
            http_status: 403,
            error: "verified_execution_contract_required",
          };
      },
      consumeGrant: async (r) =>
        await rpc("sandy_api_consume_execution_grant", {
          p_grant_id: r.grant_id,
          p_actor_id: r.actor_id,
          p_tenant_id: null,
          p_operation: ARTIFACT_OPERATION,
          p_input_sha256: r.input_sha256,
          p_request_id: r.request_id,
          p_contract_sha256: r.contract_sha256,
          p_scope_sha256: r.scope_sha256,
        }) as Policy,
      deliver: async (actor, admission, argumentsCanonical, scopeCanonical) => {
        const { data, error } = await db.rpc(
          "sandy_provider_artifact_deliver",
          {
            p_actor: actor,
            p_admission: admission,
            p_arguments_canonical: argumentsCanonical,
            p_scope_canonical: scopeCanonical,
          },
        );
        if (error) {
          if (
            error.code === "P0001" && known.has(error.message)
          ) throw new DeliveryRefusal(error.message);
          throw Error("private_delivery_state_unknown");
        }
        return data;
      },
      finishExecution: async (r) => {
        const v = await rpc("sandy_api_finish_execution", {
          p_admission_id: r.admission_id,
          p_outcome: r.outcome,
          p_provider_http_status: null,
          p_provider_request_id: null,
          p_result_sha256: r.result_sha256,
        });
        return object(v) && v.ok === true &&
            v.admission_id === r.admission_id && v.state === r.outcome &&
            v.reused === false
          ? { allowed: true }
          : { allowed: false };
      },
    }),
  );
}
