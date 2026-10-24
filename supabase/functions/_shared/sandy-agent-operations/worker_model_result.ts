type ModelPayload = Record<string, any> & { id: string; status: "completed"; output: Record<string, any>[] };
const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A plausible draft is not evidence that a paid model request finished.
 * Reuse this envelope gate before mission planning, clarification review and
 * work-product parsing. Domain verification still decides whether the actual
 * completed output is usable; this does not certify an external action.
 * Nonterminal, cancelled and unrecognised envelopes remain reconcilable through
 * the existing durable receipt and must not publish a plan or customer review.
 */
export function completedWorkerModelPayload(value: unknown): value is ModelPayload {
  return object(value) && typeof value.id === "string" &&
    value.id.trim().length > 0 && value.id.length <= 512 &&
    value.status === "completed" && value.error == null &&
    value.incomplete_details == null && Array.isArray(value.output) &&
    value.output.length <= 200 && value.output.every(object);
}
