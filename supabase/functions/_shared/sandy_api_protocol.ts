/** Canonical JSON protocol v1 shared by admissions, leases and executors. */
export function canonicalJson(value: unknown): string {
  let nodes = 0;
  function encode(item: unknown, depth: number): string {
    if (++nodes > 100000 || depth > 64) {
      throw new Error("json_complexity_limit");
    }
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") {
      return JSON.stringify(item);
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) {
        if (!Object.hasOwn(item,index)) throw new Error("non_json_value");
      }
      return "[" + item.map((entry) => encode(entry, depth + 1)).join(",") +
        "]";
    }
    if (
      item && typeof item === "object" &&
      [Object.prototype, null].includes(Object.getPrototypeOf(item))
    ) {
      return "{" + Object.keys(item).sort().map((key) =>
        JSON.stringify(key) + ":" +
        encode((item as Record<string, unknown>)[key], depth + 1)
      ).join(",") + "}";
    }
    throw new Error("non_json_value");
  }
  return encode(value, 0);
}

export async function argumentDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export class JsonRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

/** Bound actual bytes, including chunked bodies and dishonest Content-Length. */
export async function requestJson(
  request: Request,
  limit = 1024 * 1024,
): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    throw new JsonRequestError(413, "request_size_limit");
  }
  if (!request.body) throw new JsonRequestError(400, "invalid_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new JsonRequestError(413, "request_size_limit");
      }
      chunks.push(part.value);
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const part of chunks) {
      data.set(part, offset);
      offset += part.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch (error) {
    if (error instanceof JsonRequestError) throw error;
    throw new JsonRequestError(400, "invalid_request");
  } finally {
    reader.releaseLock();
  }
}
