import type { PolicyDb } from "../sandy-operation-api/access_policy.ts";
export type GithubVerificationRequest = {
  admission_id: string;
  canonical_arguments: string;
  proof: Record<string, unknown>;
};
export function createGithubVerificationClient(db: PolicyDb) {
  return async (r: GithubVerificationRequest) => {
    try {
      const { data, error } = await db.rpc("sandy_api_verify_github_mutation", {
        p_admission_id: r.admission_id,
        p_canonical_arguments: r.canonical_arguments,
        p_proof: r.proof,
      });
      const v = data as Record<string, unknown> | null;
      if (
        error || !v || v.ok !== true || v.admission_id !== r.admission_id ||
        v.state !== "succeeded" || typeof v.reused !== "boolean" ||
        typeof v.verification_sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(v.verification_sha256)
      ) return { allowed: false };
      return { allowed: true, verification_sha256: v.verification_sha256 };
    } catch {
      return { allowed: false };
    }
  };
}
