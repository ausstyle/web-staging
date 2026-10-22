/** Exact pinned-service transport; no caller-controlled host, redirect or retry. */
import { type Contract } from "./contracts.ts";
import {
  bytesDigest,
  type Dependencies,
  fail,
  Refusal,
  type Reply,
} from "../sandy-provider-supplement-api/runtime.ts";
const HOSTS = new Set([
  "compute.googleapis.com",
  "container.googleapis.com",
  "monitoring.googleapis.com",
  "cloudkms.googleapis.com",
  "backupdr.googleapis.com",
]);
export class SensitiveCalls {
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
      url.protocol !== "https:" || !HOSTS.has(url.host) ||
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
