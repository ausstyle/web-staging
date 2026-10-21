/** Normalize private SQL receipt identity without importing any provider catalogue. */
export function normalizePrivateFinishReceipt(
  request: { admission_id: string; outcome: string },
  value: unknown,
): {
  allowed: boolean;
  admission_id?: string;
  reused?: boolean;
  error?: string;
  http_status?: number;
} {
  const row = value as Record<string, unknown> | null;
  if (
    !row || typeof row !== "object" || Array.isArray(row) || row.ok !== true ||
    row.admission_id !== request.admission_id ||
    row.state !== request.outcome || typeof row.reused !== "boolean"
  ) {
    return {
      allowed: false,
      error: "execution_receipt_state_unknown",
      http_status: 503,
    };
  }
  return {
    allowed: true,
    admission_id: request.admission_id,
    reused: row.reused,
  };
}
