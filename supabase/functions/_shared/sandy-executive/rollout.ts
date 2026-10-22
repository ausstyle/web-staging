/** Server configuration only; no HTTP request can enroll a tenant. Empty or
 * malformed configuration preserves the captured production policy. */
export function executiveCanaryEnabled(
  customerId: string | null,
  configured: string | undefined,
): boolean {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!customerId || !uuid.test(customerId) || !configured?.trim()) {
    return false;
  }
  const ids = configured.split(",").map((value) => value.trim());
  return ids.length <= 100 && ids.every((value) => uuid.test(value)) &&
    ids.some((value) => value.toLowerCase() === customerId.toLowerCase());
}
