/** Repository text only. This is a refusal guard, not a claim that arbitrary
 * unreviewed content can be proven secret-free by pattern matching. */
export function recognizableRepositoryCredential(text: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sbp_[A-Za-z0-9]{20,})|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|["'](?:private_key|client_secret|service_role_key|refresh_token|access_token|api_key)["']\s*:\s*["'][^"']{16,}/m
    .test(text);
}
export function repositoryText(
  content: unknown,
  encoding = "base64",
  maximum = 65536,
): { bytes: Uint8Array; text: string } {
  if (
    typeof content !== "string" ||
    content.length > Math.ceil(maximum * 1.4) + 4096
  ) throw Error("repository_text_limit");
  const bytes = encoding === "base64"
    ? Uint8Array.from(atob(content.replace(/\s/g, "")), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(content);
  if (bytes.length > maximum) throw Error("repository_text_limit");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ||
    recognizableRepositoryCredential(text)
  ) throw Error("repository_source_material_refused");
  return { bytes, text };
}
export async function repositoryBlobMatches(
  bytes: Uint8Array,
  sha: unknown,
): Promise<boolean> {
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha)) return false;
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`),
    joined = new Uint8Array(header.length + bytes.length);
  joined.set(header);
  joined.set(bytes, header.length);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-1", joined)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("") === sha;
}

/** Reviewed source paths, including dotfiles and CI definitions. Repository
 * internals and credential files remain unavailable; mutations use a separate
 * stricter policy and never gain authority from this read-only predicate. */
export function repositorySourcePath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 1024 &&
    /^(?:(?!\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+\/)*(?!\.{1,2}$)[A-Za-z0-9_.-]+$/
      .test(path) &&
    !/(?:^|\/)(?:\.env[^/]*|\.git)(?:\/|$)|(?:^|\/)[^/]*(?:credential|private.?key|service.?account)[^/]*\.json$|\.(?:pem|key|p12|pfx)$/i
      .test(path);
}
