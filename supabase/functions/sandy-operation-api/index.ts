import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

/**
 * Sandy API operation gateway v1.
 * Source of truth is sandy_api_operations, not MCP. No external provider call occurs here.
 * Supports read-only discovery and explicitly registered read-only handler delegation.
 * Mutations remain disabled until each backend executor is implemented and tested.
 */
const base = Deno.env.get("SUPABASE_URL") ?? "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const db = createClient(base, service, { auth: { persistSession: false } });
const reply = (status: number, data: unknown) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const allowedHandlers: Record<string, { functionName: string; action: string }> = {
  "engineering.preflight": { functionName: "sandy-engineering-control", action: "preflight" },
  "deployment.management.preflight": { functionName: "sandy-deployment-api", action: "management_preflight" },
};
function validOperation(s: unknown): s is string {
  return typeof s === "string" && /^[a-z][a-z0-9_.-]{2,100}$/.test(s);
}
Deno.serve(async (request) => {
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (!base || !service) return reply(503, { error: "api_configuration_missing" });
  const bearer = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return reply(401, { error: "authentication_required" });
  const { data: { user }, error: authError } = await db.auth.getUser(bearer);
  if (authError || !user) return reply(401, { error: "invalid_identity" });
  const { data: admin, error: roleError } = await db.from("sandy_controller_admins")
    .select("role,enabled").eq("auth_user_id", user.id).eq("enabled", true).maybeSingle();
  if (roleError) return reply(503, { error: "authorisation_unavailable" });
  if (!admin) return reply(403, { error: "controller_administrator_required" });
  let body: Record<string, unknown>;
  try { const value = await request.json(); if (!value || Array.isArray(value) || typeof value !== "object") throw Error(); body = value; }
  catch { return reply(400, { error: "invalid_request" }); }
  const action = body.action;
  if (action === "list") {
    const { data, error } = await db.from("sandy_api_operations")
      .select("operation,domain,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ai_exposed,verified,last_verified_at")
      .eq("api_exposed", true).order("operation").limit(300);
    if (error) return reply(503, { error: "operation_registry_unavailable" });
    return reply(200, { ok: true, operations: data ?? [] });
  }
  if (action !== "describe" && action !== "execute") return reply(400, { error: "unknown_action" });
  if (!validOperation(body.operation)) return reply(400, { error: "invalid_operation" });
  const operation = body.operation;
  const { data: entry, error } = await db.from("sandy_api_operations")
    .select("operation,domain,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ai_exposed,verified,last_verified_at")
    .eq("operation", operation).maybeSingle();
  if (error) return reply(503, { error: "operation_registry_unavailable" });
  if (!entry?.api_exposed) return reply(404, { error: "operation_not_registered" });
  if (action === "describe") return reply(200, { ok: true, operation: entry });
  if (!entry.ai_exposed || entry.is_mutation || !allowedHandlers[operation]) {
    return reply(422, { ok: false, error: "executor_not_implemented_or_not_enabled", operation, executed: false });
  }
  const args = body.arguments;
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args) || Object.keys(args as object).length)) {
    return reply(400, { error: "operation_accepts_no_arguments" });
  }
  const handler = allowedHandlers[operation];
  // Engineering Control requires an actual authenticated controller user's JWT.
  const token = handler.functionName === "sandy-engineering-control" ? bearer : service;
  let response: Response;
  try {
    response = await fetch(`${base}/functions/v1/${handler.functionName}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ action: handler.action }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return reply(502, { error: "upstream_unavailable", executed: false });
  }
  const result = await response.json().catch(() => ({ error: "upstream_invalid_json" }));
  return reply(response.status, { operation, executed: true, upstream_status: response.status, result });
});
