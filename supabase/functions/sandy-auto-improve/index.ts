import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { authenticateAutoImproveWorker, bindAutoImproveJob, autoImproveSourceTypes } from "../_shared/sandy-agent-operations/worker_diagnosis_identity.ts";
import { executeWorkerDiagnosis } from "../_shared/sandy-agent-operations/worker_diagnosis.ts";
type Dependencies = { db: any; serviceCredential: string; automationSecret: string; openaiKey: string; fetch?: typeof fetch };
const out = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
/** Compatibility adapter for the existing dedicated automation caller. It
 * reserves a real job; all proposal work uses the named governed application
 * service. Customer, Controller and generic service credentials grant no proof. */
export function createAutoImproveHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return out(405, { error: "POST required" });
    const proof = authenticateAutoImproveWorker(req, deps.serviceCredential, deps.automationSecret);
    if (!proof) return out(403, { error: "unauthorised" });
    let body: any; try { body = await req.json(); } catch { return out(400, { error: "invalid JSON" }); }
    const sourceType = String(body?.source_type || "").slice(0, 40), sourceRef = String(body?.source_ref || "").slice(0, 180), problem = String(body?.problem || "").slice(0, 3200);
    if (!autoImproveSourceTypes.includes(sourceType) || !sourceRef || problem.length < 15) return out(400, { error: "source_type,source_ref,problem required" });
    const reserved = await deps.db.from("sandy_auto_improve_runs").upsert({ source_type: sourceType, source_ref: sourceRef, problem, status: "queued" }, { onConflict: "source_type,source_ref", ignoreDuplicates: true }).select("id").maybeSingle();
    if (reserved.error) return out(500, { error: "reserve_failed", code: reserved.error.code });
    const id = reserved.data?.id || null;
    if (!id) {
      const prior = await deps.db.from("sandy_auto_improve_runs").select("id,status").eq("source_type", sourceType).eq("source_ref", sourceRef).maybeSingle();
      if (prior.error || !prior.data) return out(503, { error: "prior_diagnosis_lookup_failed" });
      // Legacy failed-after-one-hour replay could repeat a paid request after
      // its result was lost. Existing jobs never start a second request.
      if (["failed", "analysing"].includes(prior.data.status)) return out(409, { error: "diagnosis_outcome_requires_reconciliation", id: prior.data.id, status: prior.data.status, already_registered: true, reconciliation_required: true });
      return out(200, { ok: true, status: prior.data.status, already_registered: true });
    }
    const capability = await bindAutoImproveJob(proof, deps.db, { jobId: id, sourceType, sourceRef, problem });
    if (!capability) return out(503, { error: "diagnosis_job_binding_failed", id });
    const outcome = await executeWorkerDiagnosis(capability, {}, deps);
    return out(outcome.status, outcome.legacy);
  };
}
if (import.meta.main) {
  const serviceCredential = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const automationSecret = Deno.env.get("SANDY_AUTO_IMPROVE_KEY") || Deno.env.get("EMAIL_AI_INTERNAL_KEY") || "";
  const url = Deno.env.get("SUPABASE_URL") || "";
  const db = url && serviceCredential && automationSecret ? createClient(url, serviceCredential, { auth: { persistSession: false } }) : null;
  Deno.serve(createAutoImproveHandler({ db, serviceCredential, automationSecret, openaiKey: Deno.env.get("OPENAI_API_KEY") || "" }));
}
