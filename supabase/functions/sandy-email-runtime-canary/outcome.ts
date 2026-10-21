import { runtimeReplyOutcome } from "../_shared/sandy-executive/outcome.ts";

/** Shadow comparison only. Reuse the web/runtime truth contract; no candidate
 * is delivered, retried, or promoted to the authoritative email draft here. */
export function emailCandidateOutcome(httpOk: boolean, payload: unknown) {
  const outcome = runtimeReplyOutcome(httpOk, payload);
  return {
    ready: outcome.delivered && outcome.recordStatus === "completed",
    candidate: outcome.response,
    completion: outcome.metadata,
  };
}
