import {
  argumentDigest,
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import { createRegistrySchemaValidator } from "../sandy-operation-api/registry_schema_validator.ts";
import { composioReadOperations } from "./contracts.ts";
import {
  ComposioReadError,
  emptyReadResult,
  executeComposioRead,
  type Obj,
  object,
} from "./providers.ts";
export type ComposioReadDependencies = {
  base: string;
  anon: string;
  service: string;
  key: string;
  fetch: typeof fetch;
  authenticate?: (
    token: string,
  ) => Promise<{ id: string; confirmed: boolean } | null>;
  rpc?: (
    name: string,
    args: Obj,
    bearer: string,
    service: boolean,
  ) => Promise<Obj>;
};
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
export function createComposioReadHandler(deps: ComposioReadDependencies) {
  const validator = createRegistrySchemaValidator();
  const remote = async (
    url: string,
    token: string,
    body?: Obj,
    service = false,
  ): Promise<Obj> => {
    let response: Response;
    try {
      response = await deps.fetch(url, {
        method: body ? "POST" : "GET",
        redirect: "error",
        headers: {
          authorization: "Bearer " + token,
          apikey: service ? deps.service : deps.anon,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new JsonRequestError(503, "composio_policy_unavailable");
    }
    if (url.endsWith("/auth/v1/user") && [401, 403].includes(response.status)) {
      throw new JsonRequestError(401, "actual_customer_session_required");
    }
    const value = await requestJson(
      new Request(
        "https://bounded.invalid",
        { method: "POST", body: response.body, duplex: "half" } as RequestInit,
      ),
      300000,
    ).catch(() => null);
    if (!response.ok || !object(value)) {
      throw new JsonRequestError(503, "composio_policy_unavailable");
    }
    return value;
  };
  const rpc = deps.rpc ??
    ((name, args, bearer, service) =>
      remote(deps.base + "/rest/v1/rpc/" + name, bearer, args, service));
  const authenticate = deps.authenticate ?? (async (token: string) => {
    const u = await remote(deps.base + "/auth/v1/user", token);
    return uuid(u.id) && u.email_confirmed_at && u.is_anonymous !== true &&
        u.role === "authenticated"
      ? { id: u.id, confirmed: true }
      : null;
  });
  return async (request: Request): Promise<Response> => {
    let bound: Obj | null = null,
      operation = "",
      requestId = "",
      finished = false;
    const finish = async (
      outcome: string,
      providerStatus: number | null,
      digest: string,
    ) => {
      if (!bound) throw new Error("missing_private_dispatch");
      let proof: Obj;
      try {
        proof = await rpc(
          "sandy_composio_read_finish",
          {
            p_admission_id: bound.admission_id,
            p_claim_id: bound.claim_id,
            p_actor: bound.actor_id,
            p_outcome: outcome,
            p_provider_status: providerStatus,
            p_result_sha256: digest,
          },
          deps.service,
          true,
        );
      } catch {
        throw new JsonRequestError(503, "execution_receipt_state_unknown");
      }
      if (
        proof.ok !== true || proof.admission_id !== bound.admission_id ||
        proof.request_id !== requestId || proof.state !== outcome ||
        proof.result_sha256 !== digest
      ) throw new JsonRequestError(503, "execution_receipt_state_unknown");
      finished = true;
    };
    try {
      if (request.method !== "POST") {
        return reply(405, {
          ok: false,
          error: "method_not_allowed",
          executed: false,
        });
      }
      const token = /^Bearer ([^\s]+)$/i.exec(
        request.headers.get("authorization") ?? "",
      )?.[1];
      if (
        request.headers.has("x-api-key") || !token || token === deps.service ||
        token === deps.anon
      ) {
        return reply(401, {
          ok: false,
          error: "actual_customer_session_required",
          executed: false,
        });
      }
      const user = await authenticate(token);
      if (!user?.confirmed || !uuid(user.id)) {
        return reply(401, {
          ok: false,
          error: "actual_confirmed_customer_session_required",
          executed: false,
        });
      }
      const body = await requestJson(request, 32000);
      if (
        !object(body) || Object.keys(body).some((k) =>
          !["operation", "arguments", "channel", "request_id"].includes(k)
        ) || typeof body.operation !== "string" || !object(body.arguments) ||
        !uuid(body.request_id)
      ) {
        return reply(400, {
          ok: false,
          error: "invalid_composio_request",
          executed: false,
        });
      }
      operation = body.operation;
      requestId = body.request_id;
      const op = composioReadOperations[operation],
        args = body.arguments,
        channel = body.channel ?? "api";
      if (!op) {
        return reply(404, {
          ok: false,
          error: "unsupported_composio_read_operation",
          executed: false,
        });
      }
      if (
        !["api", "mcp"].includes(String(channel)) ||
        validator.isValid(op.input_schema, args) !== true
      ) {
        return reply(400, {
          ok: false,
          error: "invalid_composio_arguments",
          executed: false,
        });
      }
      const canonical = canonicalJson(args);
      const admission = await rpc(
        "sandy_composio_read_admit",
        {
          p_operation: operation,
          p_arguments: args,
          p_canonical_arguments: canonical,
          p_request_id: requestId,
          p_channel: channel,
        },
        token,
        false,
      );
      if (admission.ok !== true) {
        return reply(Number(admission.http_status) || 403, {
          ...admission,
          executed: false,
        });
      }
      if (admission.reused === true) {
        if (
          !uuid(admission.admission_id) || admission.request_id !== requestId
        ) {
          return reply(503, {
            ok: false,
            error: "composio_receipt_binding_invalid",
            executed: null,
            reconciliation_required: true,
          });
        }
        const result = {
          ...emptyReadResult(
            typeof args.profile_id === "string" ? args.profile_id : null,
          ),
          result_sha256: admission.result_sha256 ?? null,
        };
        const output = {
          ok: true,
          operation,
          contract_version: "1.0.0",
          request_id: requestId,
          admission_id: admission.admission_id,
          request_state: "replayed",
          executed: admission.executed ?? null,
          reconciliation_required: !["succeeded", "failed", "rejected"]
            .includes(String(admission.state)),
          result,
        };
        if (validator.isValid(op.output_schema, output) !== true) {
          return reply(503, {
            ok: false,
            error: "composio_receipt_contract_invalid",
            executed: null,
            reconciliation_required: true,
          });
        }
        return reply(200, output);
      }
      if (
        !uuid(admission.admission_id) || !uuid(admission.grant_id) ||
        admission.actor_id !== user.id || !uuid(admission.tenant_id) ||
        admission.request_id !== requestId
      ) {
        return reply(503, {
          ok: false,
          error: "composio_admission_binding_invalid",
          executed: false,
        });
      }
      if (!deps.key) {
        return reply(424, {
          ok: false,
          error: "composio_provider_configuration_required",
          executed: false,
        });
      }
      const binding = await rpc(
        "sandy_composio_read_bind",
        {
          p_admission_id: admission.admission_id,
          p_grant_id: admission.grant_id,
          p_actor: user.id,
          p_arguments: args,
          p_canonical_arguments: canonical,
          p_channel: channel,
        },
        deps.service,
        true,
      );
      if (binding.ok !== true) {
        return reply(Number(binding.http_status) || 403, {
          ...binding,
          executed: false,
        });
      }
      if (
        binding.admission_id !== admission.admission_id ||
        binding.actor_id !== user.id ||
        binding.tenant_id !== admission.tenant_id ||
        binding.operation !== operation || binding.request_id !== requestId ||
        !uuid(binding.claim_id)
      ) {
        return reply(503, {
          ok: false,
          error: "composio_dispatch_binding_invalid",
          executed: null,
          reconciliation_required: true,
        });
      }
      bound = binding;
      const provider = await executeComposioRead(
        deps,
        operation,
        args,
        binding,
      );
      const output = {
        ok: true,
        operation,
        contract_version: "1.0.0",
        request_id: requestId,
        admission_id: binding.admission_id,
        request_state: "observed",
        executed: true,
        reconciliation_required: false,
        result: provider.result,
      };
      if (validator.isValid(op.output_schema, output) !== true) {
        throw new ComposioReadError(
          "composio_output_contract_invalid",
          502,
          provider.providerStatus,
          true,
        );
      }
      await finish(
        "succeeded",
        provider.providerStatus,
        String(provider.result.result_sha256),
      );
      return reply(200, output);
    } catch (error) {
      const attempted = error instanceof ComposioReadError && error.attempted;
      if (bound && !finished) {
        if (
          error instanceof JsonRequestError &&
          error.code === "execution_receipt_state_unknown"
        ) {
          return reply(503, {
            ok: false,
            error: error.code,
            operation,
            request_id: requestId,
            executed: null,
            reconciliation_required: true,
          });
        }
        try {
          await finish(
            attempted ? "unknown" : "failed",
            error instanceof ComposioReadError ? error.providerStatus : null,
            await argumentDigest({
              error: error instanceof ComposioReadError
                ? error.code
                : "composio_read_failed",
            }),
          );
        } catch {
          return reply(503, {
            ok: false,
            error: "execution_receipt_state_unknown",
            operation,
            request_id: requestId,
            executed: null,
            reconciliation_required: true,
          });
        }
      }
      return reply(
        error instanceof ComposioReadError || error instanceof JsonRequestError
          ? error.status
          : 503,
        {
          ok: false,
          error: error instanceof ComposioReadError
            ? error.code
            : error instanceof JsonRequestError
            ? error.code
            : "composio_read_unavailable",
          operation,
          request_id: requestId,
          executed: attempted ? null : false,
          reconciliation_required: attempted,
        },
      );
    }
  };
}
if (import.meta.main) {
  Deno.serve(createComposioReadHandler({
    base: "https://zmqlyygzqoidkcwdysok.supabase.co",
    anon: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    key: Deno.env.get("COMPOSIO_API_KEY") ?? "",
    fetch,
  }));
}
