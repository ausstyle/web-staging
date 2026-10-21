import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { authenticateMissionExecutor, bindMissionWorkProductJob } from "../_shared/sandy-agent-operations/worker_mission_identity.ts";
import { executeMissionWorkProduct } from "../_shared/sandy-agent-operations/worker_mission.ts";
type Dependencies = { db: any; renewalSecret: string; base: string; serviceCredential: string; openaiKey: string; fetch?: typeof fetch };
const send = (status: number, value: unknown) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
export function createMissionExecutorHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return send(405, { error: "POST required" });
    const proof = authenticateMissionExecutor(req, deps.renewalSecret);
    if (!proof) return send(401, { error: "unauthorized" });
    if (!deps.base || !deps.serviceCredential || !deps.openaiKey) return send(503, { error: "configuration_missing" });
    const { data: jobs, error } = await deps.db.from("sandy_mission_runs").select("*").eq("stage", "execute").eq("state", "queued").order("created_at", { ascending: true }).limit(2);
    if (error) return send(503, { error: error.code });
    const results: Record<string, unknown>[] = [];
    for (const queued of jobs || []) {
      const job = await bindMissionWorkProductJob(proof, deps.db, { runId: queued.id, customerId: queued.customer_id, missionId: queued.mission_task_id });
      if (!job) continue;
      const outcome = await executeMissionWorkProduct(job, {}, deps); results.push(outcome.legacy);
    }
    return send(200, { ok: true, processed: results.length, results });
  };
}
if (import.meta.main) {
  const base = Deno.env.get("SUPABASE_URL") || "", serviceCredential = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const db = base && serviceCredential ? createClient(base, serviceCredential, { auth: { persistSession: false } }) : null;
  Deno.serve(createMissionExecutorHandler({ db, base, serviceCredential, renewalSecret: Deno.env.get("EMAIL_AI_RENEWAL_KEY") || "", openaiKey: Deno.env.get("OPENAI_API_KEY") || "" }));
}
