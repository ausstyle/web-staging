import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  argumentDigest,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import { createBoundedValidatorCache } from "../sandy-provider-operation-api/validator_cache.ts";
import { type Contract, type Obj } from "./contracts.ts";
import { type VerifiedProviderBindings } from "./scope.ts";
export { argumentDigest, JsonRequestError, requestJson };
export const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type Context = {
  actor_id: string;
  tenant_id: null;
  request_id: string;
  grant_id: string;
  admission_id?: string;
  credential_id?: string | null;
};
export type Policy = {
  allowed: boolean;
  reused?: boolean;
  admission_id?: string;
  error?: string;
  http_status?: number;
};
export type Finish = {
  admission_id: string;
  outcome: "succeeded" | "accepted" | "failed" | "unknown";
  provider_http_status: number | null;
  provider_request_id: string | null;
  result_sha256: string;
};
export type OpaqueBinding = {
  actor: string;
  admission: string;
  operation: string;
  scope_sha256: string;
  input_sha256: string;
  binding_sha256: string;
  target: string;
  kind: "cursor" | "artifact" | "redirect";
};
export type OpaqueSave = OpaqueBinding & {
  payload_base64: string;
  payload_sha256: string;
  byte_length: number;
  media_type: string;
};
export type OpaqueReceipt = {
  custody_id: string;
  byte_length: number;
  sha256: string;
  media_type: string;
  expires_at: string;
};
export type Dependencies = {
  service: string;
  fetch?: typeof fetch;
  now?: () => number;
  bindings?: VerifiedProviderBindings;
  credentialForExecution: (
    op: Contract,
    context: { actorId: string; admissionId: string; operation: string },
  ) => Promise<string>;
  authorizeContext: (context: Context, op: Contract) => Promise<Policy>;
  consumeGrant: (
    r: Context & {
      operation: string;
      input_sha256: string;
      contract_sha256: string;
      scope_sha256: string;
    },
  ) => Promise<Policy>;
  finishExecution: (r: Finish) => Promise<Policy>;
  saveOpaque: (value: OpaqueSave) => Promise<OpaqueReceipt>;
  // Resolving consumes the opaque handle. Retry requires a fresh scan/capture;
  // no caller can substitute a token or arbitrary provider URL.
  takeOpaque: (binding: OpaqueBinding, id: string) => Promise<Uint8Array>;
};
export class Refusal extends Error {
  constructor(
    public code: string,
    public status = 424,
    public providerStatus: number | null = null,
    public providerId: string | null = null,
    public mayHaveExecuted = false,
  ) {
    super(code);
  }
}
export function fail(code: string, status = 424): never {
  throw new Refusal(code, status);
}
export const response = (status: number, value: Obj) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
export const refusal = (status: number, code: string, extra: Obj = {}) =>
  response(status, {
    ok: false,
    error: code,
    executed: extra.request_may_have_executed === true ||
        code === "execution_receipt_state_unknown"
      ? null
      : false,
    reconciliation_required: extra.request_may_have_executed === true ||
      code === "execution_receipt_state_unknown",
    ...extra,
  });
const cache = createBoundedValidatorCache(() => {
  const engine = new Ajv({
    strict: true,
    strictTypes: false,
    strictRequired: false,
    allowUnionTypes: true,
    allErrors: false,
    validateFormats: true,
    inlineRefs: false,
    meta: false,
    validateSchema: false,
  });
  for (const [name, value] of Object.entries(fullFormats)) {
    engine.addFormat(name, value);
  }
  return engine;
});
export const validate = (schema: Obj, value: unknown): boolean =>
  cache.get(schema, schema)(value) === true;
export const text = (v: unknown, max = 200): string =>
  typeof v === "string" && v.length > 0 && v.length <= max
    ? v
    : fail("provider_response_schema_mismatch", 502);
export const record = (v: unknown): Obj =>
  object(v) ? v : fail("provider_response_schema_mismatch", 502);
export const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= max
    ? v
    : fail("provider_response_schema_mismatch", 502);
export const optionalText = (v: unknown, max = 2000): string | null =>
  v === undefined || v === null ? null : text(v, max);
export async function bytesDigest(value: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function encode64(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 16384) {
    raw += String.fromCharCode(...bytes.subarray(i, i + 16384));
  }
  return btoa(raw);
}
export function decode64(value: unknown, max = 1048576): Uint8Array {
  if (
    typeof value !== "string" || value.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) fail("invalid_content_encoding", 400);
  let raw: string;
  try {
    raw = atob(value);
  } catch {
    return fail("invalid_content_encoding", 400);
  }
  if (raw.length > max) fail("content_size_limit", 413);
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  if (encode64(bytes) !== value) fail("noncanonical_content_encoding", 400);
  return bytes;
}
export type Reply = {
  status: number;
  id: string | null;
  bytes: Uint8Array;
  headers: Headers;
  sha256: string;
  url: string;
};
const HOSTS: Record<Contract["provider"], ReadonlySet<string>> = {
  supabase: new Set(["api.supabase.com"]),
  github: new Set(["api.github.com"]),
  gcp: new Set([
    "cloudresourcemanager.googleapis.com",
    "cloudbilling.googleapis.com",
    "compute.googleapis.com",
    "artifactregistry.googleapis.com",
    "storage.googleapis.com",
  ]),
};
export class Calls {
  last: Reply | null = null;
  mutationReceipt: Reply | null = null;
  mutationDispatched = false;
  constructor(
    private deps: Dependencies,
    private token: string,
    readonly provider: Contract["provider"],
  ) {}
  async request(
    url: URL,
    method = "GET",
    body?: BodyInit,
    contentType?: string,
    accepted = [200],
    max = 1048576,
  ): Promise<Reply> {
    if (
      url.protocol !== "https:" || !HOSTS[this.provider].has(url.host) ||
      url.username || url.password || url.hash || /[\r\n]/.test(url.toString())
    ) fail("provider_scope_mismatch", 403);
    const mutation = method !== "GET" && method !== "HEAD";
    if (mutation) this.mutationDispatched = true;
    let res: Response;
    try {
      res = await (this.deps.fetch ?? fetch)(url, {
        method,
        body,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json",
          ...(contentType ? { "content-type": contentType } : {}),
          ...(this.provider === "github"
            ? { "x-github-api-version": "2022-11-28" }
            : {}),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Refusal(
        mutation
          ? "provider_execution_state_unknown"
          : "provider_request_failed",
        mutation ? 503 : 502,
        null,
        null,
        mutation,
      );
    }
    const id = [
      res.headers.get("x-request-id"),
      res.headers.get("x-github-request-id"),
      res.headers.get("x-goog-request-id"),
      res.headers.get("sb-request-id"),
    ]
      .find((x) => x && /^[\x20-\x7e]{1,200}$/.test(x)) ?? null;
    const reader = res.body?.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > max) {
            await reader.cancel();
            throw new Refusal(
              "provider_response_size_limit",
              502,
              res.status,
              id,
              mutation,
            );
          }
          chunks.push(part.value);
        }
      } catch (e) {
        if (e instanceof Refusal) throw e;
        throw new Refusal(
          "provider_response_incomplete",
          502,
          res.status,
          id,
          mutation,
        );
      } finally {
        reader.releaseLock();
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.length;
    }
    const reply = {
      status: res.status,
      id,
      bytes,
      headers: res.headers,
      sha256: await bytesDigest(bytes),
      url: url.toString(),
    };
    this.last = reply;
    if (mutation) this.mutationReceipt = reply;
    if (!accepted.includes(res.status)) {
      throw new Refusal(
        res.status >= 300 && res.status < 400
          ? "provider_redirect_refused"
          : [401, 403].includes(res.status)
          ? "provider_authorization_refused"
          : res.status === 402
          ? "provider_usage_entitlement_required"
          : res.status === 404
          ? "provider_resource_unavailable"
          : res.status === 429
          ? "provider_rate_limited"
          : "provider_http_error",
        res.status === 429 ? 429 : 424,
        res.status,
        id,
        mutation && res.status >= 500,
      );
    }
    return reply;
  }
}
export function json(reply: Reply): Obj {
  try {
    return record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(reply.bytes)),
    );
  } catch (e) {
    if (e instanceof Refusal) throw e;
    throw new Refusal(
      "provider_response_schema_mismatch",
      502,
      reply.status,
      reply.id,
    );
  }
}
