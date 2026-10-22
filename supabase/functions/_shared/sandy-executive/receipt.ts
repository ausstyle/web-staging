import { confirmationOutcome } from "./outcome.ts";

export type ReceiptDisposition =
  | "returned"
  | "pending"
  | "failed"
  | "partial"
  | "unknown";
const pending = new Set([
  "PROPOSED",
  "QUEUED",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_EXTERNAL",
  "WAITING",
  "ACCEPTED",
  "PENDING",
  "AWAITING_CONFIRMATION",
]);
const failed = new Set([
  "FAILED",
  "VERIFIED_FAILURE",
  "CANCELLED",
  "CANCELED",
  "REJECTED",
  "DENIED",
  "UNAVAILABLE",
  "INVALID_DRAFT",
  "CONNECTION_UNAVAILABLE",
  "BLOCKED",
  "EXPIRED",
]);
const unknown = new Set([
  "UNKNOWN",
  "UNKNOWN_OUTCOME",
  "UNCERTAIN",
  "SENDING",
  "RECORDED_SENT_UNVERIFIED",
  "AWAITING_SENT_VERIFICATION",
]);
const returned = new Set([
  "VERIFIED_SUCCESS",
  "SUCCEEDED",
  "COMPLETED",
  "SENT",
]);

/** Interpret the existing API truth states and legacy application outputs.
 * "returned" only permits reasoning from a result; it is not an independent
 * verifier or permission to claim an entire mission is complete. Authority and
 * domain evidence still belong to the existing API executor. */
export function classifyToolReceipt(
  receipt: Record<string, any>,
): ReceiptDisposition {
  const raw = receipt.state;
  const state = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (
    receipt.reconciliation_required === true || receipt.executed === null ||
    unknown.has(state)
  ) return "unknown";
  if (
    (raw !== undefined && raw !== null &&
      (!state || typeof raw !== "string")) ||
    (state && !pending.has(state) && !failed.has(state) &&
      !returned.has(state) && state !== "PARTIAL")
  ) return "unknown";
  if (
    receipt.error || receipt.ok === false || receipt.success === false ||
    receipt.accepted === false || failed.has(state)
  ) return "failed";
  if (state === "PARTIAL") return "partial";
  if (
    pending.has(state) || receipt.approval_pending === true ||
    receipt.awaiting_confirmation === true ||
    receipt.requires_client_review === true
  ) return "pending";
  if (receipt.accepted === true && !returned.has(state)) return "pending";
  // The one existing legacy send state has its own established receipt rule.
  if (state === "SENT" && !confirmationOutcome(receipt).verified) {
    return "unknown";
  }
  return "returned";
}
