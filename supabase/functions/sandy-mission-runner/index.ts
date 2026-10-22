import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { authenticateMissionPlanner, bindMissionPlanningJob } from "../_shared/sandy-agent-operations/worker_mission_planning_identity.ts";
import { executeMissionPlanning } from "../_shared/sandy-agent-operations/worker_mission_planning.ts";
const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export function createMissionPlannerHandler(deps: { env: (name: string) => string | undefined; db?: any; fetch?: typeof fetch }) {
  return async (request: Request) => {
    if (request.method !== "POST") return send(405, { error: "POST required" });
    const proof = authenticateMissionPlanner(request, deps.env("EMAIL_AI_RENEWAL_KEY") || "");
    if (!proof) return send(401, { error: "unauthorized" });
    const key = deps.env("SUPABASE_SERVICE_ROLE_KEY") || "", url = deps.env("SUPABASE_URL") || "", ai = deps.env("OPENAI_API_KEY") || "";
    if (!key || !url || !ai) return send(503, { error: "worker_not_configured" });
    const db = deps.db ?? createClient(url, key, { auth: { persistSession: false } });
    const { data: jobs, error } = await db.from("sandy_mission_runs").select("*").eq("state", "queued").eq("stage", "plan").order("created_at", { ascending: true }).limit(3);
    if (error) return send(503, { error: "queue_read_failed", code: error.code });
    const outcomes = [];
    for (const row of jobs || []) {
      const job = await bindMissionPlanningJob(proof, db, { runId: row.id, customerId: row.customer_id, missionId: row.mission_task_id });
      if (!job) continue;
      const result = await executeMissionPlanning(job, {}, { db, openaiKey: ai, fetch: deps.fetch }); outcomes.push(result.legacy);
    }
    return send(200, { ok: true, processed: outcomes.length, outcomes });
  };
}
if (import.meta.main) Deno.serve(createMissionPlannerHandler({ env: name => Deno.env.get(name) }));
