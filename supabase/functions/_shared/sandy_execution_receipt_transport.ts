/** Metadata around a validated provider response, not a replacement output
 * contract. Only fixed authenticated backend responses supply this header. */
import { githubMutationSemantics } from "./sandy_github_mutation_semantics.ts";
export const verifiedExecutionHeader = "x-sandy-verified-execution";
export type GithubReadbackReason =
  | "github_readback_unsupported"
  | "github_readback_not_confirmed"
  | "github_readback_transport_unavailable"
  | "github_readback_response_limit"
  | "github_readback_invalid_json"
  | "github_readback_http_error"
  | `github_readback_http_${
    | 400
    | 401
    | 403
    | 404
    | 408
    | 409
    | 422
    | 429
    | 500
    | 502
    | 503
    | 504}`;
export type VerifiedExecution = {
  admission_id: string;
  state: "succeeded";
  effect_verified: true;
  verification_sha256: string;
} | {
  admission_id: string;
  state: "accepted";
  effect_verified: false;
  reconciliation_required: true;
  verification_error:
    | GithubReadbackReason
    | "github_verification_receipt_unavailable";
};
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function verifiedExecutionHeaders(
  value: VerifiedExecution,
): Record<string, string> {
  return { [verifiedExecutionHeader]: btoa(JSON.stringify(value)) };
}
export function readVerifiedExecution(
  response: Response,
  operation: string,
  admission: unknown,
): VerifiedExecution | null {
  if (
    !Object.hasOwn(githubMutationSemantics, operation) || !uuid(admission)
  ) return null;
  const header = response.headers.get(verifiedExecutionHeader);
  if (!header || header.length > 512) return null;
  try {
    const v = JSON.parse(atob(header));
    if (!v || v.admission_id !== admission) return null;
    if (
      Object.keys(v).sort().join(",") ===
        "admission_id,effect_verified,state,verification_sha256" &&
      v.state === "succeeded" && v.effect_verified === true &&
      /^[a-f0-9]{64}$/.test(v.verification_sha256)
    ) return v;
    if (
      Object.keys(v).sort().join(",") ===
        "admission_id,effect_verified,reconciliation_required,state,verification_error" &&
      v.state === "accepted" && v.effect_verified === false &&
      v.reconciliation_required === true &&
      [
        "github_readback_not_confirmed",
        "github_readback_unsupported",
        "github_readback_transport_unavailable",
        "github_readback_response_limit",
        "github_readback_invalid_json",
        "github_readback_http_error",
        "github_verification_receipt_unavailable",
        ...[400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504].map((
          status,
        ) => `github_readback_http_${status}`),
      ].includes(v.verification_error)
    ) return v;
    return null;
  } catch {
    return null;
  }
}
