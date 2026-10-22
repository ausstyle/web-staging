/** Private workload runner. A revocable Vault-backed bootstrap credential is
 * machine authentication only. Every execution uses a fresh/cached normal
 * Supabase Auth workload session through Sandy MCP -> Sandy API. Tokens are
 * never returned, and this function implements no provider operations. */
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { argumentDigest, requestJson } from "../_shared/sandy_api_protocol.ts";
import { createEngineeringSessionClient } from "../_shared/sandy_engineering_session_client.ts";
import {
  type IssuedSession,
  type Workload,
} from "../_shared/sandy_engineering_session.ts";
import policy from "../sandy-operation-api/engineering_identity_policy.json" with {
  type: "json",
};
import vmReadPolicy from "../sandy-operation-api/engineering_vm_read_policy.json" with {
  type: "json",
};
import { workloadControlActions } from "../sandy-engineering-control/workload.ts";
type Obj = Record<string, unknown>;
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
async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export type RuntimeDependencies = {
  resolve(digest: string): Promise<unknown>;
  session(workload: Workload): Promise<IssuedSession>;
  invalidate?(): void;
  mcp(token: string, message: Obj): Promise<{ status: number; body: unknown }>;
  control?(
    token: string,
    body: Obj,
  ): Promise<{ status: number; body: unknown }>;
};
function preDispatchAuthFailure(
  result: { status: number; body: unknown },
  method: unknown,
): boolean {
  if (
    (method === "tools/list" || method === "initialize") &&
    [401, 403].includes(result.status)
  ) return true;
  if (
    result.status === 401 && object(result.body) &&
    !Object.hasOwn(result.body, "result")
  ) return true;
  try {
    if (
      !object(result.body) || !object(result.body.result) ||
      !Array.isArray(result.body.result.content)
    ) return false;
    const content = result.body.result.content[0];
    if (!object(content) || typeof content.text !== "string") return false;
    const envelope = JSON.parse(content.text), detail = envelope.result;
    return [401, 403].includes(envelope.status) && object(detail) &&
      !detail.admission_id && detail.executed !== true &&
      detail.executed !== null &&
      detail.reconciliation_required !== true &&
      [
        "invalid_identity",
        "invalid_engineering_auth_session",
        "engineering_identity_not_authorized",
      ].includes(String(detail.error));
  } catch {
    return false;
  }
}
function stableExecutionRequest(message: Obj): Obj {
  if (message.method !== "tools/call" || !object(message.params)) {
    return message;
  }
  const params = message.params, args = params.arguments ?? {};
  if (!object(args)) return message;
  if (Object.hasOwn(args, "__sandy_execution")) return message;
  return {
    ...message,
    params: {
      ...params,
      arguments: {
        __sandy_execution: { request_id: crypto.randomUUID() },
        arguments: args,
      },
    },
  };
}
export function createEngineeringRuntime(deps: RuntimeDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return reply(405, { error: "method_not_allowed" });
    }
    const credential = request.headers.get("authorization")?.match(
      /^Bearer ([A-Za-z0-9_-]{43,128})$/,
    )?.[1];
    if (!credential) {
      return reply(401, { error: "runtime_authentication_required" });
    }
    let resolved: unknown;
    const credentialHash = await digest(credential);
    try {
      resolved = await deps.resolve(credentialHash);
    } catch {
      return reply(503, { error: "runtime_authorization_unavailable" });
    }
    if (
      !object(resolved) || resolved.ok !== true ||
      !uuid(resolved.identity_user_id) ||
      !Number.isSafeInteger(resolved.credential_epoch) ||
      !Number.isSafeInteger(resolved.bootstrap_generation) ||
      resolved.policy_sha256 !== await argumentDigest(policy)
    ) return reply(403, { error: "invalid_runtime_credential" });
    let message: unknown;
    try {
      message = await requestJson(request, 1550000);
    } catch {
      return reply(400, { error: "invalid_runtime_request" });
    }
    if (
      !object(message) || message.jsonrpc !== "2.0" ||
      !["initialize", "tools/list", "tools/call", "engineering/control"]
        .includes(
          String(message.method),
        ) ||
      !Object.hasOwn(message, "id")
    ) return reply(400, { error: "invalid_runtime_request" });
    const params = message.params;
    const controlCall = message.method === "engineering/control";
    if (
      controlCall &&
      (!deps.control || !object(params) ||
        !workloadControlActions.includes(params.action as any) ||
        (params.action === "register" &&
          (typeof params.idempotency_key !== "string" ||
            params.idempotency_key.length < 1 ||
            params.idempotency_key.length > 160)))
    ) {
      return reply(403, {
        error: "engineering_control_scope_denied",
        executed: false,
      });
    }
    if (
      message.method === "tools/call" &&
      (!object(params) || typeof params.name !== "string" ||
        !policy.operations.includes(params.name) &&
          !vmReadPolicy.operations.includes(params.name) &&
          params.name !== "system.execution.get" &&
          !/^(github|supabase|gcp)\.[a-z0-9_.]{1,100}$/.test(params.name))
    ) return reply(403, { error: "engineering_operation_scope_denied" });
    let session: IssuedSession;
    try {
      session = await deps.session({
        userId: resolved.identity_user_id,
        epoch: Number(resolved.credential_epoch),
        bootstrapGeneration: Number(resolved.bootstrap_generation),
      });
    } catch {
      return reply(503, {
        error: "engineering_session_unavailable",
        executed: false,
        automatic_retry: false,
      });
    }
    try {
      const stableMessage = stableExecutionRequest(message);
      const privateValues = [credential, session.token];
      const dispatch = (token: string) =>
        controlCall
          ? deps.control!(token, params as Obj)
          : deps.mcp(token, stableMessage);
      let result = await dispatch(session.token);
      if (deps.invalidate && preDispatchAuthFailure(result, message.method)) {
        const current = await deps.resolve(credentialHash);
        if (
          !object(current) || current.ok !== true ||
          current.identity_user_id !== resolved.identity_user_id ||
          current.policy_sha256 !== resolved.policy_sha256
        ) {
          return reply(403, {
            error: "invalid_runtime_credential",
            executed: false,
          });
        }
        deps.invalidate();
        session = await deps.session({
          userId: resolved.identity_user_id,
          epoch: Number(current.credential_epoch),
          bootstrapGeneration: Number(current.bootstrap_generation),
        });
        privateValues.push(session.token);
        result = await dispatch(session.token);
      }
      // Defensive transport redaction as well as the API's provider projections.
      let serialized = JSON.stringify(result.body);
      for (const secret of privateValues) {
        serialized = serialized.split(secret).join("[REDACTED]");
      }
      return reply(result.status, JSON.parse(serialized));
    } catch {
      // Never replay a provider mutation after an uncertain transport outcome.
      return reply(503, {
        error: "engineering_runtime_unavailable",
        executed: null,
        reconciliation_required: true,
        automatic_retry: false,
      });
    }
  };
}
async function boundedResponse(response: Response): Promise<unknown> {
  if (!response.body) throw Error("runtime_mcp_invalid_response");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 2300000) {
        await reader.cancel();
        throw Error("runtime_mcp_response_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
if (import.meta.main) {
  const base = Deno.env.get("SUPABASE_URL") ?? "",
    service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!base || !service || !anon) {
    Deno.serve(() => reply(503, { error: "runtime_configuration_missing" }));
  } else {
    const db = createClient(base, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const rpc = async (name: string, args: Obj) => {
      const r = await db.rpc(name, args);
      if (r.error) throw Error("runtime_policy_unavailable");
      return r.data;
    };
    const sessions = createEngineeringSessionClient(base, service);
    Deno.serve(createEngineeringRuntime({
      resolve: (hash) =>
        rpc("sandy_engineering_resolve_bootstrap", { p_sha256: hash }),
      session: (workload) => sessions.get(workload),
      invalidate: () => sessions.invalidate(),
      control: async (token, body) => {
        const r = await fetch(
          `${base}/functions/v1/sandy-engineering-control`,
          {
            method: "POST",
            redirect: "error",
            headers: {
              authorization: `Bearer ${token}`,
              apikey: anon,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
          },
        );
        return { status: r.status, body: await boundedResponse(r) };
      },
      mcp: async (token, message) => {
        const r = await fetch(`${base}/functions/v1/sandy-api-mcp`, {
          method: "POST",
          redirect: "error",
          headers: {
            authorization: `Bearer ${token}`,
            apikey: anon,
            "content-type": "application/json",
          },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(90000),
        });
        return { status: r.status, body: await boundedResponse(r) };
      },
    }));
  }
}
