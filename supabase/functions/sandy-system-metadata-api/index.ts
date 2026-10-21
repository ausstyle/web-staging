import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import { systemMetadataOperations } from "./contracts.ts";
import { systemMetadataExecutionScope } from "./gateway.ts";
type Obj = Record<string, unknown>;
export type SystemMetadataDependencies = {
  base: string;
  service: string;
  fetch: typeof fetch;
  rpc?: (args: Obj) => Promise<Obj>;
};
const object = (x: unknown): x is Obj =>
  !!x && typeof x === "object" && !Array.isArray(x);
const uuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
/** Internal service transport only. The shared RPC independently proves the real
 * current owner admission; a service key never becomes a customer identity. */
export function createSystemMetadataHandler(
  deps: SystemMetadataDependencies,
): (request: Request) => Promise<Response> {
  const ajv = new Ajv({ strict: false, formats: fullFormats }),
    inputs = new Map(
      Object.values(systemMetadataOperations).map(
        (o) => [o.operation, ajv.compile(o.input_schema)],
      ),
    ),
    outputs = new Map(
      Object.values(systemMetadataOperations).map(
        (o) => [o.operation, ajv.compile(o.output_schema)],
      ),
    );
  const rpc = deps.rpc || (async (args: Obj) => {
    let response: Response;
    try {
      response = await deps.fetch(
        deps.base + "/rest/v1/rpc/sandy_system_metadata_execute",
        {
          method: "POST",
          headers: {
            authorization: "Bearer " + deps.service,
            apikey: deps.service,
            "content-type": "application/json",
          },
          body: JSON.stringify(args),
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        },
      );
    } catch {
      throw new JsonRequestError(503, "system_metadata_backend_unavailable");
    }
    const result = await requestJson(
      new Request(
        "https://bounded.invalid",
        { method: "POST", body: response.body, duplex: "half" } as RequestInit,
      ),
      400000,
    ).catch(() => null);
    if (!response.ok || !object(result)) {
      throw new JsonRequestError(503, "system_metadata_backend_unavailable");
    }
    return result;
  });
  return async (request) => {
    let dispatched = false;
    try {
      if (request.method !== "POST") {
        return reply(405, {
          ok: false,
          error: "method_not_allowed",
          executed: false,
        });
      }
      if (
        !deps.service ||
        request.headers.get("authorization") !== "Bearer " + deps.service ||
        request.headers.has("x-api-key")
      ) {
        return reply(401, {
          ok: false,
          error: "internal_service_transport_required",
          executed: false,
        });
      }
      const body = await requestJson(request, 50000);
      const fields = [
        "operation",
        "arguments",
        "actor_id",
        "tenant_id",
        "credential_id",
        "request_id",
        "grant_id",
        "admission_id",
        "channel",
      ];
      if (
        !object(body) || Object.keys(body).some((k) => !fields.includes(k)) ||
        typeof body.operation !== "string" || !object(body.arguments) ||
        !["actor_id", "request_id", "grant_id", "admission_id"].every((k) =>
          uuid(body[k])
        ) || body.tenant_id !== null || body.credential_id !== null
      ) {
        return reply(400, {
          ok: false,
          error: "exact_owner_admission_required",
          executed: false,
        });
      }
      const operation = body.operation,
        op = systemMetadataOperations[operation],
        args = body.arguments;
      if (!op) {
        return reply(404, {
          ok: false,
          error: "unsupported_system_metadata_operation",
          executed: false,
        });
      }
      if (!inputs.get(operation)!(args)) {
        return reply(400, {
          ok: false,
          error: "invalid_system_metadata_arguments",
          executed: false,
        });
      }
      const channel = body.channel ?? "api";
      if (channel !== "api" && channel !== "mcp") {
        return reply(400, {
          ok: false,
          error: "invalid_system_metadata_channel",
          executed: false,
        });
      }
      dispatched = true;
      const result = await rpc({
        p_operation: operation,
        p_arguments: args,
        p_canonical_arguments: canonicalJson(args),
        p_canonical_scope: canonicalJson(
          systemMetadataExecutionScope(operation, args),
        ),
        p_actor_id: body.actor_id,
        p_request_id: body.request_id,
        p_admission_id: body.admission_id,
        p_grant_id: body.grant_id,
        p_channel: channel,
      });
      if (result.ok !== true) {
        const known = new Set([
          "internal_service_transport_required",
          "invalid_system_metadata_arguments",
          "genuine_current_owner_admission_required",
          "system_metadata_contract_or_exposure_changed",
          "system_metadata_exact_scope_required",
          "system_metadata_target_or_receipt_not_found",
          "invalid_system_metadata_arguments_or_response_size",
          "execution_grant_scope_denied",
          "execution_grant_used_or_expired",
          "execution_contract_changed",
          "mutation_requires_verified_auth_approval",
          "scoped_mutation_approval_required",
          "owner_required",
        ]);
        const status = Number(result.http_status);
        return reply(
          [400, 401, 403, 404, 409, 413, 424, 429, 503].includes(status)
            ? status
            : 503,
          {
            ok: false,
            error: typeof result.error === "string" && known.has(result.error)
              ? result.error
              : "system_metadata_execution_unavailable",
            executed: result.executed === null ? null : false,
            reconciliation_required: result.executed === null,
          },
        );
      }
      const sameUuid = (a: unknown, b: unknown) =>
        typeof a === "string" && typeof b === "string" &&
        a.toLowerCase() === b.toLowerCase();
      const actualResult = object(result.result) ? result.result : {};
      const receipt = object(actualResult.item) ? actualResult.item : {};
      if (
        !sameUuid(result.admission_id, body.admission_id) ||
        !sameUuid(result.request_id, body.request_id) ||
        (operation === "system.operation_status" &&
          !sameUuid(receipt.request_id, args.request_id))
      ) {
        return reply(502, {
          ok: false,
          error: "system_metadata_response_identity_mismatch",
          executed: null,
          reconciliation_required: true,
        });
      }
      if (!outputs.get(operation)!(result)) {
        return reply(502, {
          ok: false,
          error: "system_metadata_response_contract_mismatch",
          executed: null,
          reconciliation_required: true,
        });
      }
      return reply(200, result);
    } catch (error) {
      return reply(error instanceof JsonRequestError ? error.status : 503, {
        ok: false,
        error: error instanceof JsonRequestError
          ? error.code
          : "system_metadata_execution_unavailable",
        executed: dispatched ? null : false,
        reconciliation_required: dispatched,
      });
    }
  };
}
if (import.meta.main) {
  const base = Deno.env.get("SUPABASE_URL") || "";
  if (base !== "https://zmqlyygzqoidkcwdysok.supabase.co") {
    throw Error("fixed_project_configuration_required");
  }
  Deno.serve(
    createSystemMetadataHandler({
      base,
      service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      fetch,
    }),
  );
}
