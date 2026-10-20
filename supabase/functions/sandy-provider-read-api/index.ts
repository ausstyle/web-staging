/** Project-scoped Management API reads. Called only by Sandy API after owner authorization. */
const PROJECT = "zmqlyygzqoidkcwdysok";
const metadataQueries: Readonly<
  Record<string, { query: string; fields: string[]; limit?: number }>
> = Object.freeze({
  "supabase.db.migrations.list": {
    query:
      "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 200",
    fields: ["version", "name"],
  },
  "supabase.database.inspect": {
    query:
      "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name LIMIT 200",
    fields: ["schema_name"],
  },
  "supabase.schema.tables.list": {
    query:
      "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT 1000",
    fields: ["table_schema", "table_name", "table_type"],
  },
  "supabase.schema.functions.list": {
    query:
      "SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS result FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY p.proname, p.oid LIMIT 1000",
    fields: ["schema", "name", "arguments", "result"],
  },
  "supabase.schema.indexes.list": {
    query:
      "SELECT schemaname, tablename, indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname LIMIT 1000",
    fields: ["schemaname", "tablename", "indexname"],
  },
  "supabase.schema.views.list": {
    query:
      "SELECT schemaname AS schema, viewname AS name FROM pg_views WHERE schemaname = 'public' ORDER BY viewname LIMIT 1000",
    fields: ["schema", "name"],
    limit: 1000,
  },
  "supabase.schema.materialized_views.list": {
    query:
      "SELECT schemaname AS schema, matviewname AS name, ispopulated AS populated, hasindexes AS has_indexes FROM pg_matviews WHERE schemaname = 'public' ORDER BY matviewname LIMIT 1000",
    fields: ["schema", "name", "populated", "has_indexes"],
    limit: 1000,
  },
  "supabase.schema.triggers.list": {
    query:
      "SELECT n.nspname AS schema, c.relname AS table_name, t.tgname AS name, t.tgenabled::text AS enabled, (t.tgtype::integer & 4) <> 0 AS on_insert, (t.tgtype::integer & 16) <> 0 AS on_update, (t.tgtype::integer & 8) <> 0 AS on_delete, (t.tgtype::integer & 32) <> 0 AS on_truncate FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname LIMIT 1000",
    fields: [
      "schema",
      "table_name",
      "name",
      "enabled",
      "on_insert",
      "on_update",
      "on_delete",
      "on_truncate",
    ],
    limit: 1000,
  },
  "supabase.schema.constraints.list": {
    query:
      "SELECT n.nspname AS schema, c.relname AS table_name, k.conname AS name, k.contype::text AS type, k.condeferrable AS deferrable, k.condeferred AS initially_deferred, k.convalidated AS validated FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' ORDER BY c.relname, k.conname LIMIT 1000",
    fields: [
      "schema",
      "table_name",
      "name",
      "type",
      "deferrable",
      "initially_deferred",
      "validated",
    ],
    limit: 1000,
  },
  "supabase.schema.types.list": {
    query:
      "SELECT n.nspname AS schema, t.typname AS name, t.typtype::text AS type, t.typcategory::text AS category FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typelem = 0 ORDER BY t.typname LIMIT 1000",
    fields: ["schema", "name", "type", "category"],
    limit: 1000,
  },
  "supabase.schema.extensions.list": {
    query:
      "SELECT e.extname AS name, n.nspname AS schema, e.extversion AS version, e.extrelocatable AS relocatable FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY e.extname LIMIT 200",
    fields: ["name", "schema", "version", "relocatable"],
    limit: 200,
  },
  "supabase.database.roles.list": {
    query:
      "SELECT rolname AS name, rolcanlogin AS can_login, rolinherit AS inherit, rolcreaterole AS create_role, rolcreatedb AS create_database, rolreplication AS replication, rolbypassrls AS bypass_rls, rolconnlimit AS connection_limit FROM pg_roles ORDER BY rolname LIMIT 1000",
    fields: [
      "name",
      "can_login",
      "inherit",
      "create_role",
      "create_database",
      "replication",
      "bypass_rls",
      "connection_limit",
    ],
    limit: 1000,
  },
  "supabase.database.grants.list": {
    query:
      "SELECT object_schema, object_name, object_type, grantor, grantee, privilege_type, is_grantable FROM (SELECT table_schema AS object_schema, table_name AS object_name, 'table'::text AS object_type, grantor, grantee, privilege_type, is_grantable = 'YES' AS is_grantable FROM information_schema.table_privileges WHERE table_schema = 'public' UNION ALL SELECT routine_schema, routine_name, 'routine'::text, grantor, grantee, privilege_type, is_grantable = 'YES' FROM information_schema.routine_privileges WHERE routine_schema = 'public' UNION ALL SELECT object_schema, object_name, object_type::text, grantor, grantee, privilege_type, is_grantable = 'YES' FROM information_schema.usage_privileges WHERE object_schema = 'public') g ORDER BY object_type, object_schema, object_name, grantor, grantee, privilege_type LIMIT 1000",
    fields: [
      "object_schema",
      "object_name",
      "object_type",
      "grantor",
      "grantee",
      "privilege_type",
      "is_grantable",
    ],
    limit: 1000,
  },
  "supabase.database.default_privileges.list": {
    query:
      "SELECT owner.rolname AS owner_role, CASE WHEN d.defaclnamespace = 0 THEN NULL ELSE n.nspname END AS schema, d.defaclobjtype::text AS object_type, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee, a.privilege_type, a.is_grantable FROM pg_default_acl d JOIN pg_roles owner ON owner.oid = d.defaclrole LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles grantee ON grantee.oid = a.grantee WHERE d.defaclnamespace = 0 OR n.nspname = 'public' ORDER BY owner.rolname, n.nspname NULLS FIRST, d.defaclobjtype, a.grantee, a.privilege_type LIMIT 1000",
    fields: [
      "owner_role",
      "schema",
      "object_type",
      "grantee",
      "privilege_type",
      "is_grantable",
    ],
    limit: 1000,
  },
  "supabase.database.rls.policies.list": {
    query:
      "SELECT schemaname AS schema, tablename AS table_name, policyname AS name, permissive, roles::text[] AS roles, cmd AS command FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname LIMIT 1000",
    fields: ["schema", "table_name", "name", "permissive", "roles", "command"],
    limit: 1000,
  },
  "supabase.database.locks.list": {
    query:
      "SELECT locktype AS lock_type, mode, granted, count(*)::integer AS count FROM pg_locks GROUP BY locktype, mode, granted ORDER BY locktype, mode, granted LIMIT 200",
    fields: ["lock_type", "mode", "granted", "count"],
    limit: 200,
  },
  "supabase.database.cron.jobs.list": {
    query:
      "SELECT jobid::text AS job_id, jobname AS name, schedule, active FROM cron.job ORDER BY jobid LIMIT 200",
    fields: ["job_id", "name", "schedule", "active"],
    limit: 200,
  },
  "supabase.database.connections.list": {
    query:
      "SELECT state, wait_event_type, count(*)::integer AS count FROM pg_stat_activity GROUP BY state, wait_event_type ORDER BY state NULLS LAST, wait_event_type NULLS LAST LIMIT 200",
    fields: ["state", "wait_event_type", "count"],
  },
});
const routes: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(
    Object.keys(metadataQueries).map((
      operation,
    ) => [operation, "/database/query"]),
  ),
  "supabase.projects.get": "",
  "supabase.project.health": "/health?services=auth,db,rest,storage,realtime",
  "supabase.branches.list": "/branches",
  "supabase.branches.get": "/branches/",
  "supabase.network.restrictions.get": "/network-restrictions",
  "supabase.domains.get": "/custom-hostname",
  "supabase.functions.secrets.list": "/secrets",
  "supabase.backups.list": "/database/backups",
});
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const pick = (value: unknown, keys: string[]): ObjectValue => {
  if (!object(value)) throw Error("invalid_provider_response");
  return Object.fromEntries(
    keys.filter((key) => key in value).map((key) => [key, value[key]]),
  );
};
function projectResult(operation: string, data: unknown): unknown {
  if (Object.hasOwn(metadataQueries, operation)) {
    if (!Array.isArray(data)) throw Error("invalid_provider_response");
    return data.slice(0, metadataQueries[operation].limit ?? data.length).map((
      value,
    ) => pick(value, metadataQueries[operation].fields));
  }
  const branch = (value: unknown) =>
    pick(value, [
      "id",
      "name",
      "project_ref",
      "parent_project_ref",
      "is_default",
      "git_branch",
      "persistent",
      "status",
      "created_at",
      "updated_at",
    ]);
  if (operation === "supabase.projects.get") {
    if (!object(data) || (data.id !== PROJECT && data.ref !== PROJECT)) {
      throw Error("project_identity_mismatch");
    }
    return pick(data, ["id", "ref", "name", "region", "status", "created_at"]);
  }
  if (operation === "supabase.branches.get") return branch(data);
  if (
    operation === "supabase.branches.list" ||
    operation === "supabase.functions.secrets.list" ||
    operation === "supabase.project.health"
  ) {
    if (!Array.isArray(data)) throw Error("invalid_provider_response");
    return data.map((value) =>
      operation === "supabase.branches.list" ? branch(value) : pick(
        value,
        operation === "supabase.functions.secrets.list"
          ? ["name", "updated_at"]
          : ["name", "healthy", "status"],
      )
    );
  }
  if (operation === "supabase.network.restrictions.get") {
    const result = pick(data, [
      "entitlement",
      "status",
      "updated_at",
      "applied_at",
    ]);
    for (const key of ["config", "old_config"]) {
      if (object(data) && object(data[key])) {
        result[key] = pick(data[key], ["dbAllowedCidrs", "dbAllowedCidrsV6"]);
      }
    }
    return result;
  }
  if (operation === "supabase.domains.get") {
    return pick(data, ["status", "custom_hostname"]);
  }
  if (operation === "supabase.backups.list") {
    if (!object(data) || !Array.isArray(data.backups)) {
      throw Error("invalid_provider_response");
    }
    return {
      ...pick(data, ["region", "walg_enabled", "pitr_enabled"]),
      backups: data.backups.map((value) =>
        pick(value, ["id", "is_physical_backup", "status", "inserted_at"])
      ),
    };
  }
  throw Error("operation_not_implemented");
}
export function createProviderReadHandler(options: {
  service: string;
  management: string;
  fetch?: typeof fetch;
}) {
  const requestProvider = options.fetch ?? fetch;
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, body: unknown) =>
      Response.json(body, {
        status,
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    if (request.method !== "POST") {
      return reply(405, { error: "method_not_allowed" });
    }
    if (
      !options.service ||
      request.headers.get("authorization") !== `Bearer ${options.service}`
    ) {
      return reply(403, { error: "service_authorization_required" });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return reply(400, { error: "invalid_request" });
    }
    if (
      !object(body) || typeof body.operation !== "string" ||
      !Object.hasOwn(routes, body.operation)
    ) {
      return reply(404, { error: "operation_not_implemented" });
    }
    const operation = body.operation;
    const args = body.arguments ?? {};
    const branchRead = operation === "supabase.branches.get";
    if (
      !object(args) ||
      Object.keys(args).some((key) => key !== "name" || !branchRead) ||
      (branchRead &&
        (typeof args.name !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(args.name)))
    ) {
      return reply(400, { error: "invalid_operation_arguments" });
    }
    if (!options.management) {
      return reply(424, { error: "management_credential_unavailable" });
    }
    const url = `https://api.supabase.com/v1/projects/${PROJECT}${
      routes[operation]
    }${branchRead ? encodeURIComponent(String(args.name)) : ""}`;
    try {
      const response = await requestProvider(url, {
        method: Object.hasOwn(metadataQueries, operation) ? "POST" : "GET",
        redirect: "error",
        headers: {
          authorization: `Bearer ${options.management}`,
          accept: "application/json",
          ...(Object.hasOwn(metadataQueries, operation)
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(Object.hasOwn(metadataQueries, operation)
          ? {
            body: JSON.stringify({
              query: metadataQueries[operation].query,
              read_only: true,
            }),
          }
          : {}),
        signal: AbortSignal.timeout(20000),
      });
      const provider_request_id = response.headers.get("x-request-id") ??
        response.headers.get("sb-request-id");
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        if (
          response.status === 400 && object(failure) && object(failure.error) &&
          failure.error.code === "entitlement_required"
        ) {
          return reply(424, {
            ok: false,
            operation,
            error: "provider_entitlement_required",
            upstream_status: response.status,
            provider_request_id,
          });
        }
        // Do not return provider error bodies, credentials, or redirect targets.
        return reply(
          response.status === 404 ? 404 : response.status === 429 ? 429 : 502,
          {
            ok: false,
            operation,
            error: "provider_query_failed",
            upstream_status: response.status,
            provider_request_id,
          },
        );
      }
      const text = await response.text();
      if (text.length > 2_000_000) {
        return reply(502, { error: "provider_response_too_large" });
      }
      const result = projectResult(operation, JSON.parse(text));
      return reply(200, {
        ok: true,
        contract_version: "1.0.0",
        operation,
        project_id: PROJECT,
        result,
        ...(metadataQueries[operation]?.limit !== undefined
          ? {
            result_limit: metadataQueries[operation].limit,
            possibly_truncated: Array.isArray(result) &&
              result.length >= metadataQueries[operation].limit!,
          }
          : {}),
        observed_at: new Date().toISOString(),
        provider_request_id,
      });
    } catch {
      return reply(502, {
        ok: false,
        operation,
        error: "provider_response_unavailable",
      });
    }
  };
}
if (import.meta.main) {
  Deno.serve(createProviderReadHandler({
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    management: Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN") ?? "",
  }));
}
