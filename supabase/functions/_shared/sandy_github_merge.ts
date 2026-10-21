/** Classify an already schema-validated GitHub merge response. HTTP200 alone
 * does not establish a merge. The raw provider message is never projected. */
export function classifyGithubMergeResult(
  value: unknown,
): "merged" | "refused" | "unknown" {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "unknown";
  }
  const merged = (value as Record<string, unknown>).merged;
  return merged === true ? "merged" : merged === false ? "refused" : "unknown";
}
