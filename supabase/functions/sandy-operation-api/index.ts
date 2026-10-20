import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.57.0";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";

/**
 * Sandy API owns discovery, permissions and dispatch. Registry metadata alone
 * never enables an executor or certifies a production deployment.
 */
export type OperationDependencies = {
  base: string;
  service: string;
  anon: string;
  db: Pick<SupabaseClient, "auth" | "from" | "rpc">;
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
const infrastructureOperations = [
  "supabase.functions.list",
  "supabase.functions.get",
  "supabase.project.status",
  "system.registry.list",
  "system.registry.describe",
  "system.registry.summary",
  "deployment.jobs.get",
  "deployment.jobs.list",
  "deployment.jobs.events",
  "deployment.audit.list",
  "engineering.changes.list",
  "engineering.change.detail",
  "engineering.change.events",
  "engineering.change.tests",
  "engineering.change.artifacts",
] as const;
const providerReadOperations = [
  "supabase.db.migrations.list",
  "supabase.database.inspect",
  "supabase.schema.tables.list",
  "supabase.schema.functions.list",
  "supabase.schema.indexes.list",
  "supabase.database.connections.list",
  "supabase.projects.get",
  "supabase.project.health",
  "supabase.branches.list",
  "supabase.branches.get",
  "supabase.network.restrictions.get",
  "supabase.domains.get",
  "supabase.functions.secrets.list",
  "supabase.backups.list",
] as const;
const customerReadOperations = [
  "tasks.list",
  "tasks.get",
  "calendar.list",
  "calendar.get",
  "calendar.conflicts",
  "files.list",
  "files.get",
  "files.search",
] as const;
const isCustomerRead = (operation: string) =>
  customerReadOperations.includes(
    operation as typeof customerReadOperations[number],
  );
// This is an installed executor map, not a second schema or discovery catalogue.
// Existing registry contracts and exposure flags remain authoritative.
const allowedHandlers: Readonly<
  Record<string, { functionName: string; action?: string }>
> = Object.freeze({
  "deployment.jobs.cancel": {
    functionName: "sandy-operation-api",
    action: "cancel_pending_job",
  },
  ...Object.fromEntries(customerReadOperations.map((operation) => [operation, {
    functionName: "sandy-operations-api",
  }])),
  ...Object.fromEntries(providerReadOperations.map((operation) => [operation, {
    functionName: "sandy-provider-read-api",
  }])),
  ...Object.fromEntries(
    infrastructureOperations.map((operation) => [operation, {
      functionName: "sandy-infrastructure-read",
    }]),
  ),
  "engineering.preflight": {
    functionName: "sandy-engineering-control",
    action: "preflight",
  },
  "deployment.management.release": {
    functionName: "sandy-deployment-api",
    action: "engineering_release",
  },
});
const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
function schemaValid(schema: unknown, value: unknown): boolean | null {
  if (
    !isObject(schema) || schema.type !== "object" || schema.$async !== undefined
  ) return null;
  try {
    // No coercion, defaults, remote references, or schema-controlled code execution.
    // Do not cache arbitrary mutable registry schemas across requests.
    const validate = ajv.compile(schema);
    const valid = validate(value);
    ajv.removeSchema(schema);
    return valid === true;
  } catch {
    return null;
  }
}
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
    (entry.handler === "sandy-operation-api" ||
      entry.handler === allowedHandlers[entry.operation].functionName) &&
    entry.api_exposed === true &&
    (entry.ai_exposed === true ||
      infrastructureOperations.includes(
        entry.operation as typeof infrastructureOperations[number],
      ) ||
      providerReadOperations.includes(
        entry.operation as typeof providerReadOperations[number],
      ));
}
function ownerOnly(operation: string) {
  return operation === "deployment.management.release" ||
    operation === "deployment.jobs.cancel" ||
    infrastructureOperations.includes(
      operation as typeof infrastructureOperations[number],
    ) ||
    providerReadOperations.includes(
      operation as typeof providerReadOperations[number],
    );
}
async function upstreamResult(
  operation: string,
  response: Response,
  outputSchema: unknown,
) {
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
  if (ok && schemaValid(outputSchema, result) !== true) {
    return reply(502, {
      ok: false,
      operation,
      executed: true,
      upstream_status: response.status,
      error: "upstream_output_schema_mismatch",
    });
  }
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
    const url = new URL(request.url);
    const path = url.pathname.replace(
      /^\/functions\/v1\/sandy-operation-api/,
      "",
    );
    let routedBody: Record<string, unknown> | undefined;
    const describePath = path.match(
      /^\/v1\/capabilities\/([a-z][a-z0-9_.-]{2,100})$/,
    );
    const executePath = path.match(
      /^\/v1\/operations\/([a-z][a-z0-9_.-]{2,100}):execute$/,
    );
    const jobPath = path.match(/^\/v1\/jobs\/([a-f0-9-]{36})(\/events)?$/i);
    const cancelPath = path.match(
      /^\/v1\/jobs\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):cancel$/i,
    );
    if (request.method === "GET") {
      if (path === "/v1/capabilities") routedBody = { action: "list" };
      else if (describePath) {
        routedBody = { action: "describe", operation: describePath[1] };
      } else if (jobPath) {
        const job_id = jobPath[1];
        if (
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
            .test(job_id)
        ) {
          return reply(400, { error: "invalid_job_id" });
        }
        routedBody = {
          action: "execute",
          operation: jobPath[2]
            ? "deployment.jobs.events"
            : "deployment.jobs.get",
          arguments: { job_id },
        };
      } else return reply(405, { error: "method_not_allowed" });
    } else if (request.method !== "POST") {
      return reply(405, { error: "method_not_allowed" });
    } else if (path !== "" && path !== "/" && !executePath && !cancelPath) {
      return reply(404, { error: "route_not_found" });
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
    let body: Record<string, unknown>;
    try {
      const value = routedBody ?? await request.json();
      if (!isObject(value)) throw Error();
      body = executePath
        ? {
          action: "execute",
          operation: executePath[1],
          arguments: value.arguments ?? {},
        }
        : value;
      if (
        executePath && Object.keys(value).some((key) => key !== "arguments")
      ) throw Error();
      if (cancelPath) {
        if (Object.keys(value).length) throw Error();
        body = {
          action: "execute",
          operation: "deployment.jobs.cancel",
          arguments: { job_id: cancelPath[1] },
        };
      }
    } catch {
      return reply(400, { error: "invalid_request" });
    }
    // Reuse the existing customer-access directory; never trust a caller's
    // customer_id. The downstream customer handler independently verifies the
    // same user session and scopes every resource query to that tenant.
    let tenantAccess = false;
    const customerRequest = typeof body.operation === "string" &&
      isCustomerRead(body.operation);
    if (
      typeof user.email === "string" &&
      (customerRequest || body.action === "list" || !admin)
    ) {
      const { data: access, error: accessError } = await db.from(
        "sandy_agenda_access",
      )
        .select("customer_id").eq("email", user.email.toLowerCase()).eq(
          "enabled",
          true,
        ).maybeSingle();
      if (accessError && customerRequest) {
        return reply(503, { error: "tenant_authorisation_unavailable" });
      }
      tenantAccess = !accessError && typeof access?.customer_id === "string";
    }
    if (!admin && !tenantAccess) {
      return reply(403, { error: "controller_administrator_required" });
    }
    if (body.action === "list") {
      const { data, error } = await db.from("sandy_operation_registry")
        .select(registryColumns).eq("api_exposed", true)
        .in("operation", Object.keys(allowedHandlers)).order("operation");
      if (error) return reply(503, { error: "operation_registry_unavailable" });
      const entries: unknown[] = data ?? [];
      const operations = entries.filter(enabledEntry)
        .filter((entry) =>
          isCustomerRead(entry.operation) ? tenantAccess : !!admin
        )
        .filter((entry) =>
          !ownerOnly(entry.operation) || admin?.role === "owner"
        )
        // executable means an enabled source dispatch exists, not production verification.
        .map((entry) => ({ ...entry, executable: true }));
      const bytes = new TextEncoder().encode(JSON.stringify(operations));
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      const catalogue_version = Array.from(
        digest,
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      return reply(200, { ok: true, operations, catalogue_version });
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
    if (body.channel === "mcp" && entry.ai_exposed !== true) {
      return reply(403, {
        error: "operation_not_mcp_exposed",
        executed: false,
      });
    }
    if (!enabledEntry(entry)) {
      return reply(422, {
        ok: false,
        error: "executor_not_implemented_or_not_enabled",
        operation,
        executed: false,
      });
    }
    if (isCustomerRead(operation) ? !tenantAccess : !admin) {
      return reply(403, {
        error: isCustomerRead(operation)
          ? "customer_access_required"
          : "controller_administrator_required",
        executed: false,
      });
    }
    if (ownerOnly(operation) && admin?.role !== "owner") {
      return reply(403, { error: "owner_required", executed: false });
    }
    if (body.action === "describe") {
      return reply(200, {
        ok: true,
        operation: { ...entry, executable: true },
      });
    }
    const handler = allowedHandlers[entry.operation];
    const inputValidation = schemaValid(
      entry.input_schema,
      body.arguments ?? {},
    );
    if (inputValidation !== true) {
      return reply(inputValidation === null ? 503 : 400, {
        error: inputValidation === null
          ? "operation_schema_unavailable"
          : "invalid_operation_arguments",
        executed: false,
      });
    }
    if (schemaValid(entry.output_schema, {}) === null) {
      return reply(503, {
        error: "operation_schema_unavailable",
        executed: false,
      });
    }
    if (operation === "deployment.jobs.cancel") {
      if (entry.verified !== true) {
        return reply(424, {
          error: "operation_requires_live_verification",
          executed: false,
        });
      }
      const { data, error } = await Promise.resolve().then(() => db.rpc("sandy_api_cancel_deployment_job", {
        p_job_id: (body.arguments as Record<string, unknown>).job_id,
        p_actor_id: user.id,
      })).catch(() => ({ data: null, error: true }));
      if (error) {
        return reply(502, {
          error: "cancellation_outcome_unknown",
          executed: null,
          reconciliation_required: true,
        });
      }
      if (!isObject(data) || data.ok !== true) {
        return reply(
          isObject(data) && [403, 404, 409].includes(Number(data.http_status))
            ? Number(data.http_status)
            : 503,
          {
            ok: false,
            error: isObject(data) && typeof data.error === "string"
              ? data.error
              : "cancellation_unavailable",
            executed: false,
          },
        );
      }
      if (schemaValid(entry.output_schema, data) !== true) {
        return reply(502, {
          error: "cancellation_result_invalid",
          executed: null,
          reconciliation_required: true,
        });
      }
      return reply(200, { ok: true, operation, executed: true, result: data });
    }
    if (handler.functionName === "sandy-operations-api") {
      if (
        entry.is_mutation !== false ||
        entry.permission_scope !== `${operation.split(".")[0]}:read`
      ) {
        return reply(503, {
          error: "customer_executor_contract_conflict",
          executed: false,
        });
      }
      try {
        const response = await fetchBackend(
          `${base}/functions/v1/sandy-operations-api`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${bearer}`,
              apikey: anon,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              operation,
              arguments: body.arguments ?? {},
            }),
            signal: AbortSignal.timeout(20000),
          },
        );
        return upstreamResult(operation, response, entry.output_schema);
      } catch {
        return reply(502, {
          ok: false,
          error: "upstream_unavailable",
          executed: false,
        });
      }
    }
    if (
      ["sandy-infrastructure-read", "sandy-provider-read-api"].includes(
        handler.functionName,
      )
    ) {
      if (entry.is_mutation !== false) {
        return reply(503, {
          error: "read_executor_contract_conflict",
          executed: false,
        });
      }
      // These are global infrastructure records. Never grant a tenant caller
      // the service credential; only the already authenticated Controller admin
      // reaches this fixed read-only handler through this gateway.
      const args = body.arguments ?? {};
      if (
        !isObject(args) ||
        (args.limit !== undefined &&
          (!Number.isInteger(args.limit) || Number(args.limit) < 1 ||
            Number(args.limit) > 200))
      ) {
        return reply(400, {
          error: "invalid_operation_arguments",
          executed: false,
        });
      }
      try {
        const response = await fetchBackend(
          `${base}/functions/v1/${handler.functionName}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${service}`,
              apikey: anon,
              "content-type": "application/json",
            },
            body: JSON.stringify({ operation, arguments: args }),
            signal: AbortSignal.timeout(20000),
          },
        );
        return upstreamResult(operation, response, entry.output_schema);
      } catch {
        return reply(502, {
          ok: false,
          error: "upstream_unavailable",
          executed: false,
        });
      }
    }
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
          executed: null,
          reconciliation_required: true,
        });
      }
      return upstreamResult(operation, response, entry.output_schema);
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
    return upstreamResult(operation, response, entry.output_schema);
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
