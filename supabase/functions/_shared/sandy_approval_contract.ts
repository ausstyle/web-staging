/** Source-required sensitive owner approval cannot be weakened by registry flags. */
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export function approvedOwnerContract(
  entry: unknown,
  expected: { handler: string; is_mutation: boolean; contract_sha256: string },
): boolean {
  if (!object(entry) || !object(entry.error_contract)) return false;
  return entry.handler === expected.handler && entry.api_exposed === true &&
    entry.verified === true && entry.is_mutation === expected.is_mutation &&
    entry.error_contract.contract_sha256 === expected.contract_sha256 &&
    entry.error_contract.requires_approval === true &&
    entry.error_contract.api_key_delegable === false;
}
