/** Project-scoped Management API reads. Called only by Sandy API after owner authorization. */
const PROJECT = "zmqlyygzqoidkcwdysok";
const routes: Readonly<Record<string, string>> = Object.freeze({
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
        method: "GET",
        redirect: "error",
        headers: {
          authorization: `Bearer ${options.management}`,
          accept: "application/json",
        },
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
