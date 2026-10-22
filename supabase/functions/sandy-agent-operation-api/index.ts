import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { agentContractMatches, agentOperationContracts, validAgentInput } from "../_shared/sandy-agent-operations/contracts.ts";
import { authenticatePortalUser } from "../_shared/sandy-agent-operations/identity.ts";
import { AgentServices, executeAgentOperation } from "../_shared/sandy-agent-operations/service.ts";
import { JsonRequestError, requestJson } from "../_shared/sandy_api_protocol.ts";

const reply = (status: number, body: unknown) => Response.json(body, {
  status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
export type AgentApiDependencies = AgentServices & {
  serviceCredential: string;
  auth: { auth: { getUser: (token: string) => Promise<any> } };
};
export function createAgentOperationHandler(deps: AgentApiDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return reply(405, { ok: false, error: "post_required", executed: false });
    let dispatched = false;
    try {
      const user = await authenticatePortalUser(request, deps.db, deps.auth, deps.serviceCredential);
      if (!user) return reply(401, { ok: false, error: "confirmed_portal_user_required", executed: false });
      let body: any;
      try { body = await requestJson(request, 32000); }
      catch (error) {
        return reply(error instanceof JsonRequestError ? error.status : 400, {
          ok: false, error: error instanceof JsonRequestError && error.status === 413
            ? "request_too_large" : "invalid_json", executed: false,
        });
      }
      if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((name) => !["operation", "arguments", "channel"].includes(name)) ||
        typeof body.operation !== "string" || !Object.hasOwn(agentOperationContracts, body.operation) ||
        ![undefined, "api", "mcp"].includes(body.channel) || !validAgentInput(body.operation, body.arguments))
        return reply(400, { ok: false, error: "invalid_agent_operation_request", executed: false });
      const contract = agentOperationContracts[body.operation];
      const registered = await deps.db.from("sandy_operation_registry")
        .select("operation,handler,permission_scope,is_mutation,input_schema,output_schema,api_exposed,ai_exposed,verified")
        .eq("operation", body.operation).maybeSingle();
      if (registered.error) return reply(503, { ok: false, error: "operation_catalogue_unavailable", executed: false });
      if (!registered.data || !agentContractMatches(body.operation, registered.data))
        return reply(503, { ok: false, error: "agent_operation_contract_mismatch", executed: false });
      if (registered.data.api_exposed !== true || (body.channel === "mcp" && registered.data.ai_exposed !== true))
        return reply(403, { ok: false, error: "agent_operation_not_exposed", executed: false });
      if (contract.is_mutation && registered.data.verified !== true)
        return reply(403, { ok: false, error: "unverified_mutation_disabled", executed: false });
      dispatched = true;
      const outcome = await executeAgentOperation(user, body.operation, body.arguments, deps);
      return reply(outcome.status, outcome.body);
    } catch {
      return reply(503, { ok: false, error: "agent_authorization_or_service_unavailable",
        executed: dispatched ? null : false, ...(dispatched ? { reconciliation_required: true } : {}) });
    }
  };
}
if (import.meta.main) {
  const base = Deno.env.get("SUPABASE_URL") || "";
  const serviceCredential = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anon = Deno.env.get("SANDY_SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!base || !serviceCredential || !anon) Deno.serve(() => reply(503, { ok: false, error: "agent_configuration_missing", executed: false }));
  else {
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    Deno.serve(createAgentOperationHandler({
      base, serviceCredential, db: createClient(base, serviceCredential, options),
      auth: createClient(base, anon, options), composioKey: Deno.env.get("COMPOSIO_API_KEY") || "",
      openaiKey: Deno.env.get("OPENAI_API_KEY") || "", integrationToken: Deno.env.get("SANDY_INTEGRATION_API_TOKEN") || "",
    }));
  }
}
