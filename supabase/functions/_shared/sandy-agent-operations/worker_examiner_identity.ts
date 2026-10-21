// Preserve the existing service automation bearer as a distinct internal proof;
// it grants no customer/Controller identity or owner/customer API authority.
export type ExaminerProof = Readonly<{ kind: "trusted_internal_worker"; worker: "sandy-examiner-live-review" }>;
const proofs = new WeakSet<object>();
const same = (a: string, b: string) => { if (!a || a.length !== b.length) return false; let diff=0; for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i); return diff===0; };
export function authenticateExaminer(request: Request, automationSecret: string): ExaminerProof | null {
 if (!automationSecret || !same(request.headers.get("authorization") || "", "Bearer " + automationSecret)) return null;
 const proof=Object.freeze({kind:"trusted_internal_worker" as const,worker:"sandy-examiner-live-review" as const});proofs.add(proof);return proof;
}
export const isExaminerProof = (value: unknown): value is ExaminerProof => !!value && typeof value === "object" && proofs.has(value);
