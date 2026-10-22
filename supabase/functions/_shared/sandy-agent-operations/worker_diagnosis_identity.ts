// Dedicated existing reliability automation identity. It is never a customer,
// Controller owner, runtime principal, or credential that can execute tools.
export const autoImproveSource = Object.freeze({
  runtime: "sandy-auto-improve",
  sourceSha256: "7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74",
  archivedVersion: 11,
  inspectedVersion: 12,
});
export type AutoImproveWorkerProof = Readonly<{ kind: "trusted_internal_worker"; worker: "sandy-auto-improve" }>;
export type AutoImproveJob = Readonly<{ jobId: string; sourceSha256: string }>;
const proofs = new WeakSet<object>();
const jobs = new WeakMap<object, { sourceType: string; sourceRef: string; problem: string }>();
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export const autoImproveSourceTypes = Object.freeze(["qa_failure", "edge_error", "customer_feedback", "manual", "system_awareness"]);
export function authenticateAutoImproveWorker(request: Request, serviceCredential: string, automationSecret: string): AutoImproveWorkerProof | null {
  if (!serviceCredential || !automationSecret || request.headers.get("authorization") !== "Bearer " + automationSecret) return null;
  const proof = Object.freeze({ kind: "trusted_internal_worker" as const, worker: "sandy-auto-improve" as const });
  proofs.add(proof); return proof;
}
export async function bindAutoImproveJob(proof: AutoImproveWorkerProof, db: any, expected: { jobId: string; sourceType: string; sourceRef: string; problem: string }): Promise<AutoImproveJob | null> {
  if (!proof || !proofs.has(proof) || !uuid(expected.jobId) || !autoImproveSourceTypes.includes(expected.sourceType) ||
    expected.sourceRef.length < 1 || expected.sourceRef.length > 180 || expected.problem.length < 15 || expected.problem.length > 3200) return null;
  const { data, error } = await db.from("sandy_auto_improve_runs").select("id,source_type,source_ref,problem,status").eq("id", expected.jobId).maybeSingle();
  if (error || !data || data.id !== expected.jobId || data.status !== "queued" || data.source_type !== expected.sourceType || data.source_ref !== expected.sourceRef || data.problem !== expected.problem) return null;
  const job = Object.freeze({ jobId: data.id, sourceSha256: autoImproveSource.sourceSha256 });
  jobs.set(job, { sourceType: data.source_type, sourceRef: data.source_ref, problem: data.problem }); return job;
}
export function autoImproveJobBinding(job: AutoImproveJob) {
  const facts = job && typeof job === "object" ? jobs.get(job) : undefined;
  return facts ? Object.freeze({ ...facts }) : null;
}
