import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  argumentDigest,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  type GapContract,
  GCP_PROJECT,
  GCP_ZONE,
  type Obj,
  PROJECT,
  REPOSITORY,
} from "./contracts.ts";
import { gapExecutionScope, type ScopeBinding } from "./scope.ts";
export { gapExecutionScope, type ScopeBinding } from "./scope.ts";
export const object = (value: unknown): value is Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Context = {
  actor_id: string;
  tenant_id: string | null;
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
export type PackageProof = {
  repository_id: number;
  package_id: number;
  package_type: string;
  package_name: string;
  version_id: number | null;
  response_sha256: string;
  observed_at: string;
  provider_request_id: string | null;
};
export type Dependencies = {
  service: string;
  management?: string;
  github?: string;
  getGcpAccessToken?: () => Promise<string>;
  fetch?: typeof fetch;
  now?: () => number;
  credentialForExecution?: (
    operation: GapContract,
    execution: { actorId: string; admissionId: string; operation: string },
  ) => Promise<string>;
  functionAnonKey?: string;
  validateInvocationSession?: (
    session: string,
    actor: string,
  ) => Promise<boolean>;
  projectCreationMaterial?: (admission: string, args: Obj) => Promise<string>;
  authorizeContext: (
    context: Context,
    operation: GapContract,
  ) => Promise<Policy>;
  consumeGrant: (
    request: Context & {
      operation: string;
      input_sha256: string;
      contract_sha256: string;
      scope_sha256: string;
    },
  ) => Promise<Policy>;
  finishExecution: (request: Finish) => Promise<Policy>;
  // Server-only bindings. Never supplied in an operation's JSON arguments.
  packageRestoreBindings?: ScopeBinding[];
  savePackageProof?: (
    admissionId: string,
    args: Obj,
    proof: PackageProof,
  ) => Promise<void>;
  loadPackageProof?: (
    admissionId: string,
    args: Obj,
  ) => Promise<PackageProof | null>;
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
export const fail = (code: string, status = 424): never => {
  throw new Refusal(code, status);
};
export const response = (status: number, body: Obj) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
export const refusal = (status: number, code: string, extra: Obj = {}) =>
  response(status, { ok: false, error: code, ...extra });
const ajv = new Ajv({
  strict: true,
  strictTypes: false,
  strictRequired: false,
  allowUnionTypes: true,
  validateFormats: true,
});
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const validations = new Map<string, ReturnType<typeof ajv.compile>>();
export function validate(key: string, schema: Obj, value: unknown): boolean {
  let fn = validations.get(key);
  if (!fn) {
    fn = ajv.compile(schema);
    validations.set(key, fn);
  }
  return !!fn(value);
}
export function validateContext(value: Obj): value is Obj & Context {
  return typeof value.actor_id === "string" && UUID.test(value.actor_id) &&
    typeof value.request_id === "string" && UUID.test(value.request_id) &&
    typeof value.grant_id === "string" && UUID.test(value.grant_id) &&
    (value.tenant_id === null ||
      typeof value.tenant_id === "string" && UUID.test(value.tenant_id)) &&
    (value.admission_id === undefined ||
      typeof value.admission_id === "string" &&
        UUID.test(value.admission_id)) &&
    (value.credential_id === undefined || value.credential_id === null ||
      typeof value.credential_id === "string" &&
        UUID.test(value.credential_id));
}
export { argumentDigest, JsonRequestError, requestJson };
/** Known credential patterns only. This is not a promise to classify arbitrary secrets. */
export function redact(value: string, max = 20000): string {
  return value.replace(
    /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?(?:-----END (?:[A-Z ]*PRIVATE KEY)-----|$)/g,
    "[REDACTED_PRIVATE_KEY]",
  )
    .replace(/\bBearer\s+[A-Za-z0-9_.~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
      "[REDACTED_JWT]",
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sbp_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED_CREDENTIAL]",
    )
    .replace(
      /((?:"|')(?:password|passwd|secret|client[_-]?secret|secret[_-]?access[_-]?key|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization)(?:"|')\s*:\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,\r\n}]+)/gi,
      '$1"[REDACTED]"',
    )
    .replace(
      /(\b(?:password|passwd|secret|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization)\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@").slice(
      0,
      max,
    );
}
export const text = (v: unknown, max = 200): string =>
  typeof v === "string" && v.length <= max
    ? v
    : fail("provider_response_schema_mismatch", 502);
export const numeric = (v: unknown): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0
    ? v
    : fail("provider_response_schema_mismatch", 502);
export const nullableText = (v: unknown, max = 200): string | null =>
  v === null || v === undefined ? null : text(v, max);
export const obj = (v: unknown): Obj =>
  object(v) ? v : fail("provider_response_schema_mismatch", 502);
export const list = (v: unknown, max = 100): unknown[] =>
  Array.isArray(v) && v.length <= max
    ? v
    : fail("provider_response_schema_mismatch", 502);
export const bool = (v: unknown): boolean =>
  typeof v === "boolean" ? v : fail("provider_response_schema_mismatch", 502);
export type ProviderReply = {
  status: number;
  id: string | null;
  body: unknown;
  headers: Headers;
  sha256: string;
};
export class Calls {
  last: ProviderReply | null = null;
  mutationReceipt: ProviderReply | null = null;
  mutationDispatched = false;
  constructor(
    private deps: Dependencies,
    private token: string,
    readonly provider: GapContract["provider"],
  ) {}
  async request(
    url: URL,
    method = "GET",
    payload?: Obj,
    invocation?: { session: string; anonKey: string; requestId: string },
  ): Promise<ProviderReply> {
    const hosts = {
      supabase: "api.supabase.com",
      github: "api.github.com",
      gcp: "compute.googleapis.com",
    };
    const functionHost = this.provider === "supabase" &&
      invocation !== undefined;
    if (
      url.protocol !== "https:" ||
      url.host !==
        (functionHost ? `${PROJECT}.supabase.co` : hosts[this.provider]) ||
      url.username || url.password || url.hash
    ) fail("provider_scope_mismatch", 403);
    if (
      functionHost && (method !== "POST" || url.search ||
        !/^\/functions\/v1\/[a-z][a-z0-9-]{2,90}$/.test(url.pathname) ||
        !invocation!.session || !invocation!.anonKey ||
        !UUID.test(invocation!.requestId))
    ) {
      fail("function_invocation_scope_mismatch", 403);
    }
    const mutation = method !== "GET" &&
      !(this.provider === "github" && url.pathname === "/graphql" &&
        typeof payload?.query === "string" &&
        !payload.query.trimStart().startsWith("mutation"));
    if (mutation) this.mutationDispatched = true;
    let r: Response;
    try {
      r = await (this.deps.fetch ?? fetch)(url, {
        method,
        headers: {
          authorization: `Bearer ${invocation?.session ?? this.token}`,
          ...(invocation
            ? {
              apikey: invocation.anonKey,
              "x-sandy-request-id": invocation.requestId,
              "idempotency-key": invocation.requestId,
            }
            : {}),
          accept: "application/json",
          ...(this.provider === "github"
            ? { "x-github-api-version": "2022-11-28" }
            : {}),
          ...(payload ? { "content-type": "application/json" } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
        redirect: "error",
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
      r.headers.get("x-request-id"),
      r.headers.get("x-github-request-id"),
      r.headers.get("x-goog-request-id"),
      r.headers.get("sb-request-id"),
    ].find((x) => x && /^[\x20-\x7e]{1,200}$/.test(x)) ?? null;
    const reader = r.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 3 * 1024 * 1024) {
            await reader.cancel();
            throw new Refusal(
              "provider_response_size_limit",
              502,
              r.status,
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
          r.status,
          id,
          mutation,
        );
      } finally {
        reader.releaseLock();
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    const raw = new TextDecoder().decode(bytes);
    let body: unknown = null;
    if (raw && !invocation) {
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Refusal(
          "provider_response_schema_mismatch",
          502,
          r.status,
          id,
          mutation,
        );
      }
    }
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const reply = { status: r.status, id, body, headers: r.headers, sha256 };
    this.last = reply;
    if (mutation) this.mutationReceipt = reply;
    if (!r.ok) {
      const code = r.status === 401 || r.status === 403
        ? "provider_authorization_refused"
        : r.status === 404
        ? "provider_resource_unavailable"
        : r.status === 402
        ? "provider_usage_entitlement_required"
        : r.status === 429
        ? "provider_rate_limited"
        : "provider_http_error";
      throw new Refusal(
        code,
        r.status === 429 ? 429 : 424,
        r.status,
        id,
        mutation && r.status >= 500,
      );
    }
    return reply;
  }
}
export function nextPage(reply: ProviderReply, path: string): number | null {
  const link = reply.headers.get("link");
  if (!link) return null;
  for (const item of link.split(",")) {
    const m = item.match(/^\s*<([^>]+)>;\s*rel="next"\s*$/);
    if (m) {
      const u = new URL(m[1]);
      if (
        u.protocol !== "https:" || u.host !== "api.github.com" ||
        u.pathname !== path
      ) fail("provider_pagination_scope_mismatch", 502);
      const p = Number(u.searchParams.get("page"));
      if (!Number.isSafeInteger(p) || p < 1 || p > 10000) {
        fail("provider_pagination_schema_mismatch", 502);
      }
      return p;
    }
  }
  return null;
}
export function restoreBinding(
  deps: Dependencies,
  args: Obj,
  repoId: number,
): ScopeBinding {
  const binding = deps.packageRestoreBindings?.find((b) =>
    b.verified === true && b.repository === REPOSITORY &&
    b.owner === "ausstyle" && b.repository_id === repoId &&
    b.package_type === args.package_type &&
    b.package_name === args.package_name && b.exclusive_namespace === true &&
    /^[a-f0-9]{64}$/.test(b.attestation_sha256) &&
    Number.isFinite(Date.parse(b.expires_at)) &&
    Date.parse(b.expires_at) > (deps.now ?? Date.now)()
  );
  return binding ??
    fail("verified_exclusive_package_namespace_binding_required", 424);
}
