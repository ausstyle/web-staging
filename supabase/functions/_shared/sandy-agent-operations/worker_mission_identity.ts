export const missionExecutorSource = Object.freeze({ runtime: "sandy-mission-executor", archivedVersion: 7, inspectedVersion: 8,
  sourceSha256: "6f6b7ce3d1bca03d9637c46a3535c4f288efef4c3a5532cc8a6ef5a6de3b0dc4" });
export type MissionWorkerProof = Readonly<{ kind: "trusted_internal_worker"; worker: "sandy-mission-executor" }>;
export type MissionWorkProductJob = Readonly<{ runId: string; customerId: string; missionId: string }>;
const proofs = new WeakSet<object>(), jobs = new WeakSet<object>();
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
function same(a: string, b: string) { if (!a || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
export function authenticateMissionExecutor(request: Request, renewalSecret: string): MissionWorkerProof | null {
  if (!same(request.headers.get("x-email-ai-renewal-key") || "", renewalSecret)) return null;
  const proof = Object.freeze({ kind: "trusted_internal_worker" as const, worker: "sandy-mission-executor" as const }); proofs.add(proof); return proof;
}
export async function bindMissionWorkProductJob(proof: MissionWorkerProof, db: any, expected: { runId: string; customerId: string; missionId: string }): Promise<MissionWorkProductJob | null> {
  if (!proof || !proofs.has(proof) || !uuid(expected.runId) || !uuid(expected.customerId) || !uuid(expected.missionId)) return null;
  const { data, error } = await db.from("sandy_mission_runs").select("id,customer_id,mission_task_id,stage,state").eq("id", expected.runId).maybeSingle();
  if (error || !data || data.id !== expected.runId || data.customer_id !== expected.customerId || data.mission_task_id !== expected.missionId || data.stage !== "execute" || data.state !== "queued") return null;
  const job = Object.freeze({ ...expected }); jobs.add(job); return job;
}
export const isMissionWorkProductJob = (value: unknown): value is MissionWorkProductJob => !!value && typeof value === "object" && jobs.has(value);
