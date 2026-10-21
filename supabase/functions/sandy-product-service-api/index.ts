import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import { productOperations } from "./contracts.ts";
import {
  emptyResult,
  executeProductProvider,
  missingProviderConfiguration,
  type ProviderDependencies,
} from "./providers.ts";
type Obj = Record<string, unknown>;
export type ProductDependencies = ProviderDependencies & {
  anon: string;
  authenticate?: (
    bearer: string,
  ) => Promise<{ id: string; emailConfirmed: boolean } | null>;
  rpc?: (
    name: string,
    args: Obj,
    bearer: string,
    service: boolean,
  ) => Promise<Obj>;
};
const obj = (v: unknown): v is Obj =>
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
export function createProductHandler(
  deps: ProductDependencies,
): (request: Request) => Promise<Response> {
  const ajv = new Ajv({
    allErrors: false,
    strict: false,
    formats: fullFormats,
  });
  const inputs = new Map(
    Object.values(productOperations).map(
      (op) => [op.operation, ajv.compile(op.input_schema)],
    ),
  );
  const outputs = new Map(
    Object.values(productOperations).map(
      (op) => [op.operation, ajv.compile(op.output_schema)],
    ),
  );
  async function remoteJson(
    url: string,
    token: string,
    body?: Obj,
    service = false,
  ): Promise<Obj> {
    let r: Response;
    try {
      r = await deps.fetch(url, {
        method: body ? "POST" : "GET",
        headers: {
          authorization: "Bearer " + token,
          apikey: service ? deps.service : deps.anon,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new JsonRequestError(503, "product_backend_unavailable");
    }
    const data = await requestJson(
      new Request(
        "https://bounded.invalid",
        { method: "POST", body: r.body, duplex: "half" } as RequestInit,
      ),
      600000,
    ).catch(() => null);
    if (!r.ok || !obj(data)) {
      throw new JsonRequestError(503, "product_backend_unavailable");
    }
    return data;
  }
  const rpc = deps.rpc ||
    ((name, args, bearer, service) =>
      remoteJson(deps.base + "/rest/v1/rpc/" + name, bearer, args, service));
  const authenticate = deps.authenticate || (async (bearer: string) => {
    const user = await remoteJson(deps.base + "/auth/v1/user", bearer).catch(
      () => null,
    );
    return user && uuid(user.id) && user.email_confirmed_at &&
        user.is_anonymous !== true
      ? { id: user.id, emailConfirmed: true }
      : null;
  });
  return async (request) => {
    let dispatched = false;
    let operation = "";
    let admission: Obj | null = null;
    let requestId: string | null = null;
    try {
      if (request.method !== "POST") {
        return reply(405, { ok: false, error: "method_not_allowed" });
      }
      if (request.headers.has("x-api-key")) {
        return reply(401, {
          ok: false,
          error: "actual_customer_session_required",
        });
      }
      const auth = request.headers.get("authorization") || "";
      const token = /^Bearer ([^\s]+)$/i.exec(auth)?.[1];
      if (!token || token === deps.service || token === deps.anon) {
        return reply(401, {
          ok: false,
          error: "actual_customer_session_required",
        });
      }
      const user = await authenticate(token);
      if (!user?.emailConfirmed || !uuid(user.id)) {
        return reply(401, {
          ok: false,
          error: "actual_confirmed_customer_session_required",
        });
      }
      const body = await requestJson(request, 100000);
      if (
        !obj(body) || Object.keys(body).some((k) =>
          !["operation", "arguments", "channel", "request_id", "approval_id"]
            .includes(k)
        ) || typeof body.operation !== "string" || !obj(body.arguments)
      ) {
        return reply(400, { ok: false, error: "invalid_product_request" });
      }
      operation = body.operation;
      const op = productOperations[operation];
      if (!op) {
        return reply(404, {
          ok: false,
          error: "unsupported_product_operation",
        });
      }
      const args = body.arguments;
      if (!inputs.get(operation)!(args)) {
        return reply(400, { ok: false, error: "invalid_product_arguments" });
      }
      const channel = body.channel ?? "api";
      if (channel !== "api" && channel !== "mcp") {
        return reply(400, { ok: false, error: "invalid_product_channel" });
      }
      if (body.approval_id !== undefined && !uuid(body.approval_id)) {
        return reply(400, { ok: false, error: "invalid_approval_id" });
      }
      requestId = op.is_mutation
        ? String(args.idempotency_key)
        : typeof body.request_id === "string"
        ? body.request_id
        : crypto.randomUUID();
      if (
        !uuid(requestId) ||
        body.request_id !== undefined && body.request_id !== requestId
      ) {
        return reply(400, { ok: false, error: "stable_request_id_required" });
      }
      if (op.executor === "receipt") {
        const result = await rpc(
          "sandy_product_get_receipt",
          { p_request_id: args.request_id, p_channel: channel },
          token,
          false,
        );
        if (result.ok !== true) {
          return reply(Number(result.http_status) || 403, result);
        }
        const output = {
          ...result,
          operation,
          contract_version: op.contract_version,
        };
        if (!outputs.get(operation)!(output)) {
          return reply(502, {
            ok: false,
            error: "product_response_contract_mismatch",
            executed: false,
          });
        }
        return reply(200, output);
      }
      const missing = missingProviderConfiguration(op, deps);
      if (missing.length) {
        return reply(424, {
          ok: false,
          error: "provider_configuration_required",
          requirements: missing,
          executed: false,
        });
      }
      const canonical = canonicalJson(args);
      admission = await rpc(
        "sandy_product_admit",
        {
          p_operation: operation,
          p_arguments: args,
          p_canonical_arguments: canonical,
          p_request_id: requestId,
          p_channel: channel,
          p_approval_id: body.approval_id || null,
        },
        token,
        false,
      );
      if (
        admission.ok !== true ||
        admission.allowed === false && admission.reused !== true
      ) {
        return reply(Number(admission.http_status) || 403, admission);
      }
      if (admission.reused === true) {
        const output = {
          ok: true,
          operation,
          contract_version: op.contract_version,
          request_id: requestId,
          admission_id: admission.admission_id,
          request_state: "replayed",
          executed: admission.executed ?? null,
          result: obj(admission.receipt) ? admission.receipt : emptyResult(),
          reconciliation_required: [
            "admitted",
            "consumed",
            "accepted",
            "unknown",
          ].includes(String(admission.state)),
        };
        if (!outputs.get(operation)!(output)) {
          return reply(502, {
            ok: false,
            error: "product_response_contract_mismatch",
            executed: null,
            request_id: requestId,
          });
        }
        return reply(200, output);
      }
      if (!uuid(admission.admission_id) || !uuid(admission.grant_id)) {
        return reply(502, {
          ok: false,
          error: "invalid_product_admission",
          executed: false,
        });
      }
      let result: Obj;
      const grantArgs = {
        p_admission_id: admission.admission_id,
        p_grant_id: admission.grant_id,
        p_arguments: args,
        p_canonical_arguments: canonical,
        p_channel: channel,
      };
      if (op.executor === "db") {
        dispatched = true;
        result = await rpc("sandy_product_execute_db", grantArgs, token, false);
      } else {
        dispatched = true;
        const bound = await rpc(
          "sandy_product_bind_provider",
          grantArgs,
          token,
          false,
        );
        if (bound.ok !== true) {
          return reply(Number(bound.http_status) || 403, bound);
        }
        if (
          !obj(bound.context) || bound.actor_id !== user.id ||
          !(bound.tenant_id === null || uuid(bound.tenant_id))
        ) {
          return reply(502, {
            ok: false,
            error: "invalid_product_provider_binding",
            executed: false,
          });
        }
        dispatched = true;
        const provider = await executeProductProvider(op, args, bound.context, {
          tenant: bound.tenant_id as string | null,
          actor: user.id,
          requestId,
        }, deps);
        result = await rpc(
          "sandy_product_finish_provider",
          {
            p_admission_id: admission.admission_id,
            p_grant_id: admission.grant_id,
            p_actor_id: user.id,
            p_tenant_id: bound.tenant_id,
            p_result: provider.result,
            p_outcome: provider.outcome,
            p_provider_http_status: provider.httpStatus,
            p_private_context: provider.privateContext || {},
          },
          deps.service,
          true,
        );
        if (result.ok !== true) {
          return reply(503, {
            ok: false,
            error: "provider_receipt_requires_reconciliation",
            request_id: requestId,
            executed: null,
            reconciliation_required: true,
          });
        }
        if (provider.error) {
          return reply(provider.responseStatus || 502, {
            ok: false,
            error: provider.error,
            request_id: requestId,
            admission_id: admission.admission_id,
            executed: provider.executed ??
              (provider.outcome === "unknown" ? null : true),
            reconciliation_required: provider.outcome === "unknown",
            result: result.result,
          });
        }
      }
      if (result.ok !== true) {
        return reply(Number(result.http_status) || 503, result);
      }
      const output = {
        ...result,
        operation,
        contract_version: op.contract_version,
      };
      if (!outputs.get(operation)!(output)) {
        return reply(502, {
          ok: false,
          error: "product_response_contract_mismatch",
          request_id: requestId,
          executed: op.is_mutation ? null : false,
          reconciliation_required: op.is_mutation,
        });
      }
      return reply(200, output);
    } catch (error) {
      const code = error instanceof JsonRequestError
        ? error.code
        : "product_execution_unavailable";
      return reply(error instanceof JsonRequestError ? error.status : 503, {
        ok: false,
        error: code,
        operation: operation || null,
        request_id: requestId,
        executed: dispatched ? null : false,
        reconciliation_required: dispatched,
        admission_id: admission?.admission_id || null,
      });
    }
  };
}
if (import.meta.main) {
  const env = (key: string) => Deno.env.get(key);
  const base = env("SUPABASE_URL") || "";
  if (base !== "https://zmqlyygzqoidkcwdysok.supabase.co") {
    throw new Error("fixed_project_configuration_required");
  }
  Deno.serve(
    createProductHandler({
      base,
      service: env("SUPABASE_SERVICE_ROLE_KEY") || "",
      anon: env("SUPABASE_ANON_KEY") || "",
      env,
      fetch,
    }),
  );
}
