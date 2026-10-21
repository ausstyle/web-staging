import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import { commerceOperations } from "./contracts.ts";
type Obj = Record<string, unknown>;
export type CommerceDependencies = {
  base: string;
  anon: string;
  service: string;
  fetch: typeof fetch;
  authenticate?: (
    bearer: string,
  ) => Promise<{ id: string; emailConfirmed: boolean } | null>;
  rpc?: (name: string, args: Obj, bearer: string) => Promise<Obj>;
};
const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const reply = (status: number, data: unknown) =>
  Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const empty = () => ({
  item: null,
  items: [],
  changed: false,
  next_cursor: null,
  possibly_truncated: false,
  source: "internal_commerce_records",
  payment_executed: false,
  provider_verified: false,
});
export function createCommerceHandler(
  deps: CommerceDependencies,
): (request: Request) => Promise<Response> {
  const ajv = new Ajv({
    strict: false,
    allErrors: false,
    formats: fullFormats,
  });
  const inputs = new Map(
    Object.values(commerceOperations).map(
      (o) => [o.operation, ajv.compile(o.input_schema)],
    ),
  );
  const outputs = new Map(
    Object.values(commerceOperations).map(
      (o) => [o.operation, ajv.compile(o.output_schema)],
    ),
  );
  async function remote(url: string, bearer: string, args?: Obj): Promise<Obj> {
    let response: Response;
    try {
      response = await deps.fetch(url, {
        method: args ? "POST" : "GET",
        headers: {
          authorization: "Bearer " + bearer,
          apikey: deps.anon,
          "content-type": "application/json",
        },
        body: args ? JSON.stringify(args) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new JsonRequestError(503, "commerce_backend_unavailable");
    }
    const result = await requestJson(
      new Request(
        "https://bounded.invalid",
        { method: "POST", body: response.body, duplex: "half" } as RequestInit,
      ),
      600000,
    ).catch(() => null);
    if (url.endsWith("/auth/v1/user") && [401, 403].includes(response.status)) {
      throw new JsonRequestError(401, "actual_customer_session_required");
    }
    if (!response.ok || !object(result)) {
      throw new JsonRequestError(503, "commerce_backend_unavailable");
    }
    return result;
  }
  const authenticate = deps.authenticate || (async (bearer: string) => {
    const user = await remote(deps.base + "/auth/v1/user", bearer).catch(
      (error) => {
        if (error instanceof JsonRequestError && error.status === 401) {
          return null;
        }
        throw error;
      },
    );
    return user && uuid(user.id) && user.email_confirmed_at &&
        user.is_anonymous !== true && user.role === "authenticated"
      ? { id: user.id, emailConfirmed: true }
      : null;
  });
  const rpc = deps.rpc ||
    ((name, args, bearer) =>
      remote(deps.base + "/rest/v1/rpc/" + name, bearer, args));
  return async (request) => {
    let operation = "";
    let requestId: string | null = null;
    let admission: Obj | null = null;
    let executionStarted = false;
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
      const token = /^Bearer ([^\s]+)$/i.exec(
        request.headers.get("authorization") || "",
      )?.[1];
      if (!token || token === deps.anon || token === deps.service) {
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
        !object(body) || Object.keys(body).some((k) =>
          !["operation", "arguments", "channel", "request_id", "approval_id"]
            .includes(k)
        ) || typeof body.operation !== "string" || !object(body.arguments)
      ) {
        return reply(400, { ok: false, error: "invalid_commerce_request" });
      }
      operation = body.operation;
      const op = commerceOperations[operation];
      if (!op) {
        return reply(404, {
          ok: false,
          error: "unsupported_commerce_operation",
        });
      }
      const args = body.arguments;
      if (!inputs.get(operation)!(args)) {
        return reply(400, { ok: false, error: "invalid_commerce_arguments" });
      }
      const channel = body.channel ?? "api";
      if (channel !== "api" && channel !== "mcp") {
        return reply(400, { ok: false, error: "invalid_commerce_channel" });
      }
      if (body.approval_id !== undefined && !uuid(body.approval_id)) {
        return reply(400, { ok: false, error: "invalid_commerce_approval_id" });
      }
      requestId = op.is_mutation
        ? String(args.idempotency_key)
        : body.request_id === undefined
        ? crypto.randomUUID()
        : String(body.request_id);
      if (
        !uuid(requestId) ||
        body.request_id !== undefined && body.request_id !== requestId
      ) {
        return reply(400, { ok: false, error: "stable_request_id_required" });
      }
      let result: Obj;
      if (operation === "commerce.executions.get") {
        result = await rpc("sandy_commerce_get_receipt", {
          p_request_id: args.request_id,
          p_channel: channel,
        }, token);
      } else {
        const canonical = canonicalJson(args);
        admission = await rpc("sandy_commerce_admit", {
          p_operation: operation,
          p_arguments: args,
          p_canonical_arguments: canonical,
          p_request_id: requestId,
          p_channel: channel,
          p_approval_id: body.approval_id || null,
        }, token);
        if (
          admission.ok !== true ||
          admission.allowed === false && admission.reused !== true
        ) {
          return reply(Number(admission.http_status) || 403, admission);
        }
        if (admission.reused === true) {
          result = {
            ok: true,
            admission_id: admission.admission_id,
            request_id: requestId,
            request_state: "replayed",
            executed: admission.executed ?? null,
            result: object(admission.receipt) ? admission.receipt : empty(),
            reconciliation_required: [
              "admitted",
              "consumed",
              "accepted",
              "unknown",
            ].includes(String(admission.state)),
          };
        } else {
          if (!uuid(admission.admission_id) || !uuid(admission.grant_id)) {
            return reply(502, {
              ok: false,
              error: "invalid_commerce_admission",
              executed: false,
            });
          }
          executionStarted = true;
          result = await rpc("sandy_commerce_execute", {
            p_admission_id: admission.admission_id,
            p_grant_id: admission.grant_id,
            p_arguments: args,
            p_canonical_arguments: canonical,
            p_channel: channel,
          }, token);
        }
      }
      if (result.ok !== true) {
        return reply(Number(result.http_status) || 503, result);
      }
      const output = { ...result, operation, contract_version: op.version };
      if (!outputs.get(operation)!(output)) {
        return reply(502, {
          ok: false,
          error: "commerce_response_contract_mismatch",
          request_id: requestId,
          executed: executionStarted ? null : false,
          reconciliation_required: executionStarted,
        });
      }
      return reply(200, output);
    } catch (error) {
      return reply(error instanceof JsonRequestError ? error.status : 503, {
        ok: false,
        error: error instanceof JsonRequestError
          ? error.code
          : "commerce_execution_unavailable",
        operation: operation || null,
        request_id: requestId,
        admission_id: admission?.admission_id || null,
        executed: executionStarted ? null : false,
        reconciliation_required: executionStarted,
      });
    }
  };
}
if (import.meta.main) {
  const base = Deno.env.get("SUPABASE_URL") || "";
  if (base !== "https://zmqlyygzqoidkcwdysok.supabase.co") {
    throw new Error("fixed_project_configuration_required");
  }
  Deno.serve(
    createCommerceHandler({
      base,
      anon: Deno.env.get("SUPABASE_ANON_KEY") || "",
      service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      fetch,
    }),
  );
}
