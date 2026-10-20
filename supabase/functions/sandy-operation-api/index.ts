import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.57.0";

/**
 * Sandy API owns discovery, permissions and dispatch. Registry metadata alone
 * never enables an executor or certifies a production deployment.
 */
export type OperationDependencies = {
  base: string;
  service: string;
  anon: string;
  db: Pick<SupabaseClient, "auth" | "from">;
  fetch?: typeof fetch;
};
const reply = (status: number, data: unknown) =>
  Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const allowedHandlers = Object.freeze({
  "engineering.preflight": {
    functionName: "sandy-engineering-control",
    action: "preflight",
  },
  "deployment.management.release": {
    functionName: "sandy-deployment-api",
    action: "engineering_release",
  },
});
const registryColumns =
  "operation,domain,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ai_exposed,verified,last_verified_at";
function validOperation(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_.-]{2,100}$/.test(value);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function enabledEntry(
  entry: unknown,
): entry is Record<string, unknown> & {
  operation: keyof typeof allowedHandlers;
} {
  return isObject(entry) && typeof entry.operation === "string" &&
    Object.hasOwn(allowedHandlers, entry.operation) &&
    entry.handler === "sandy-operation-api" && entry.api_exposed === true &&
    entry.ai_exposed === true;
}
function ownerOnly(operation: string) {
  return operation === "deployment.management.release";
}
async function upstreamResult(operation: string, response: Response) {
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return reply(502, {
      ok: false,
      operation,
      executed: true,
      upstream_status: response.status,
      error: "upstream_invalid_json",
    });
  }
  if (!isObject(result)) {
    return reply(502, {
      ok: false,
      operation,
      executed: true,
      upstream_status: response.status,
      error: "upstream_invalid_response",
      result,
    });
  }
  const ok = response.ok && result.ok === true && result.error == null;
  return reply(response.ok && !ok ? 502 : response.status, {
    ok,
    operation,
    executed: true,
    upstream_status: response.status,
    result,
    ...(!ok
      ? {
        error: typeof result.error === "string"
          ? result.error
          : "upstream_operation_failed",
      }
      : {}),
  });
}

export function createOperationHandler(dependencies: OperationDependencies) {
  const { base, service, anon, db } = dependencies;
  const fetchBackend = dependencies.fetch ?? fetch;
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return reply(405, { error: "method_not_allowed" });
    }
    if (!base || !service) {
      return reply(503, { error: "api_configuration_missing" });
    }
    const bearer = (request.headers.get("authorization") ?? "").match(
      /^Bearer\s+(.+)$/i,
    )?.[1];
    if (!bearer) return reply(401, { error: "authentication_required" });
    const { data: { user }, error: authError } = await db.auth.getUser(bearer);
    if (authError || !user) return reply(401, { error: "invalid_identity" });
    const { data: admin, error: roleError } = await db.from(
      "sandy_controller_admins",
    )
      .select("role,enabled").eq("auth_user_id", user.id).eq("enabled", true)
      .maybeSingle();
    if (roleError) return reply(503, { error: "authorisation_unavailable" });
    if (!admin) {
      return reply(403, { error: "controller_administrator_required" });
    }
    let body: Record<string, unknown>;
    try {
      const value = await request.json();
      if (!isObject(value)) throw Error();
      body = value;
    } catch {
      return reply(400, { error: "invalid_request" });
    }
    if (body.action === "list") {
      const { data, error } = await db.from("sandy_operation_registry")
        .select(registryColumns).eq("api_exposed", true)
        .in("operation", Object.keys(allowedHandlers)).order("operation");
      if (error) return reply(503, { error: "operation_registry_unavailable" });
      const entries: unknown[] = data ?? [];
      const operations = entries.filter(enabledEntry)
        .filter((entry) =>
          !ownerOnly(entry.operation) || admin.role === "owner"
        )
        // executable means an enabled source dispatch exists, not production verification.
        .map((entry) => ({ ...entry, executable: true }));
      return reply(200, { ok: true, operations });
    }
    if (body.action !== "describe" && body.action !== "execute") {
      return reply(400, { error: "unknown_action" });
    }
    if (!validOperation(body.operation)) {
      return reply(400, { error: "invalid_operation" });
    }
    const operation = body.operation;
    const { data: storedEntry, error } = await db.from(
      "sandy_operation_registry",
    )
      .select(registryColumns).eq("operation", operation).maybeSingle();
    if (error) return reply(503, { error: "operation_registry_unavailable" });
    const entry: unknown = storedEntry;
    if (!isObject(entry) || entry.api_exposed !== true) {
      return reply(404, { error: "operation_not_registered" });
    }
    if (!enabledEntry(entry)) {
      return reply(422, {
        ok: false,
        error: "executor_not_implemented_or_not_enabled",
        operation,
        executed: false,
      });
    }
    if (ownerOnly(operation) && admin.role !== "owner") {
      return reply(403, { error: "owner_required", executed: false });
    }
    if (body.action === "describe") {
      return reply(200, {
        ok: true,
        operation: { ...entry, executable: true },
      });
    }
    const handler = allowedHandlers[entry.operation];
    if (operation === "deployment.management.release") {
      const args = body.arguments;
      if (
        !isObject(args) || Object.keys(args).some((key) =>
          !["function_slug", "source_ref", "change_id"].includes(key)
        ) ||
        typeof args.function_slug !== "string" ||
        !["sandy-operation-api", "sandy-api-mcp"].includes(
          args.function_slug,
        ) ||
        args.source_ref !== "main" || typeof args.change_id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          args.change_id,
        )
      ) {
        return reply(400, {
          error: "invalid_release_parameters",
          executed: false,
        });
      }
      let response: Response;
      try {
        response = await fetchBackend(
          `${base}/functions/v1/${handler.functionName}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${service}`,
              apikey: anon,
              "content-type": "application/json",
            },
            body: JSON.stringify({ action: handler.action, ...args }),
            signal: AbortSignal.timeout(45000),
          },
        );
      } catch {
        return reply(502, {
          ok: false,
          error: "release_backend_unavailable",
          executed: false,
        });
      }
      return upstreamResult(operation, response);
    }
    const args = body.arguments;
    if (
      args !== undefined && (!isObject(args) || Object.keys(args).length !== 0)
    ) {
      return reply(400, {
        error: "operation_accepts_no_arguments",
        executed: false,
      });
    }
    let response: Response;
    try {
      // Engineering Control must receive the authenticated controller user's JWT.
      response = await fetchBackend(
        `${base}/functions/v1/${handler.functionName}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearer}`,
            apikey: anon,
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: handler.action }),
          signal: AbortSignal.timeout(20000),
        },
      );
    } catch {
      return reply(502, {
        ok: false,
        error: "upstream_unavailable",
        executed: false,
      });
    }
    return upstreamResult(operation, response);
  };
}

if (import.meta.main) {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!base || !service) {
    Deno.serve(() => reply(503, { error: "api_configuration_missing" }));
  } else {
    const db = createClient(base, service, { auth: { persistSession: false } });
    Deno.serve(createOperationHandler({ base, service, anon, db }));
  }
}
