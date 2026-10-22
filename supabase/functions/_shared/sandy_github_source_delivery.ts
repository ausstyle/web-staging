/** Existing GitHub source operation: immutable provider reads and bounded text
 * ranges. No caller URL, redirect, filesystem access or separate credentials. */
import {
  repositoryBlobMatches,
  repositoryText,
} from "./sandy_repository_text.ts";
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
export class SourceDeliveryError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}
function encode(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 16384) {
    text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  }
  return btoa(text);
}
const hash = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
export async function githubSourceDelivery(
  raw: unknown,
  args: Obj,
  token: string,
  request: typeof fetch,
): Promise<Obj> {
  if (
    !object(raw) || raw.type !== "file" || typeof raw.path !== "string" ||
    !object(args.path) || raw.path !== args.path.path ||
    typeof raw.sha !== "string" || !/^[a-f0-9]{40}$/.test(raw.sha) ||
    typeof raw.size !== "number" || raw.size < 0 || raw.size > 8 * 1024 * 1024
  ) {
    throw new SourceDeliveryError("repository_source_not_supported", 422);
  }
  let body = raw;
  if (raw.encoding !== "base64") {
    const response = await request(
      `https://api.github.com/repos/ausstyle/web-staging/git/blobs/${raw.sha}`,
      {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new SourceDeliveryError("repository_blob_read_failed", 502);
    }
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const p = await reader.read();
        if (p.done) break;
        size += p.value.length;
        if (size > 12 * 1024 * 1024) {
          await reader.cancel();
          throw new SourceDeliveryError("repository_source_too_large", 413);
        }
        parts.push(p.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let pos = 0;
    for (const part of parts) {
      bytes.set(part, pos);
      pos += part.length;
    }
    const data = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      !object(data) || data.sha !== raw.sha || data.size !== raw.size ||
      data.encoding !== "base64"
    ) throw new SourceDeliveryError("repository_blob_binding_failed", 502);
    body = data;
  }
  let source: { bytes: Uint8Array; text: string };
  try {
    source = repositoryText(body.content, "base64", 8 * 1024 * 1024);
  } catch {
    throw new SourceDeliveryError("repository_source_material_refused", 403);
  }
  if (
    source.bytes.length !== raw.size ||
    !(await repositoryBlobMatches(source.bytes, raw.sha))
  ) throw new SourceDeliveryError("repository_source_integrity_failed", 502);
  let result: Obj = {
    path: raw.path,
    sha: raw.sha,
    size: raw.size,
    type: "file",
    encoding: "base64",
  };
  if (object(args.range)) {
    const offset = args.range.offset ?? 0,
      maximum = args.range.max_bytes ?? 65536;
    if (
      !Number.isSafeInteger(offset) || Number(offset) < 0 ||
      Number(offset) > source.bytes.length || !Number.isSafeInteger(maximum) ||
      Number(maximum) < 1 || Number(maximum) > 65536
    ) {
      throw new SourceDeliveryError("repository_source_range_invalid", 416);
    }
    const end = Math.min(source.bytes.length, Number(offset) + Number(maximum)),
      part = source.bytes.subarray(Number(offset), end);
    result = {
      ...result,
      size: part.length,
      content: encode(part),
      offset,
      total_size: source.bytes.length,
      next_offset: end < source.bytes.length ? end : null,
      content_sha256: await hash(part),
      source_sha256: await hash(source.bytes),
    };
  } else {
    if (source.bytes.length > 65536) {
      throw new SourceDeliveryError("repository_source_range_required", 413);
    }
    result.content = encode(source.bytes);
  }
  return result;
}
