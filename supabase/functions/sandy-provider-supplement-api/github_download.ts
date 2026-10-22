/**
 * One unauthenticated download hop from a fixed GitHub Actions API response.
 * Host policy: docs/sandy-api/provider-download-host-policy.md.
 * The signed URL is private, never a parameter or field in an operation result.
 */
import { type Contract, type Obj, REPOSITORY } from "./contracts.ts";
import {
  bytesDigest,
  Calls,
  type Dependencies,
  fail,
  integer,
  Refusal,
  type Reply,
} from "./runtime.ts";

const MAX_BYTES = 1048576;
const MAX_LOCATION_BYTES = 8192;
export const actionsDownloadHostPolicy = Object.freeze({
  documentation_source:
    "https://raw.githubusercontent.com/github/docs/main/data/reusables/actions/runner-essential-communications.md",
  documentation_sha256:
    "0122590a135e29ae6aae87fe2aaa46504516896237a360844c21c6a3ea9accfd",
  exact_host: "results-receiver.actions.githubusercontent.com",
  storage_account_host_pattern:
    "^[a-z0-9]{3,24}\\.blob\\.core\\.windows\\.net$",
  max_bytes: MAX_BYTES,
  max_redirects_followed: 1,
});

function downloadLocation(raw: string | null): URL {
  if (
    !raw || raw.includes("#") ||
    new TextEncoder().encode(raw).length > MAX_LOCATION_BYTES ||
    /[\x00-\x20\x7f\\]/.test(raw) || /%0[ad]/i.test(raw)
  ) fail("provider_download_location_invalid", 502);
  let location: URL;
  try {
    location = new URL(raw);
  } catch {
    return fail("provider_download_location_invalid", 502);
  }
  // Compare the raw authority as well: URL normalizes an explicitly written443
  // to an empty port and may otherwise hide disallowed syntax from this check.
  const authority = /^https:\/\/([^/?#]*)/.exec(raw)?.[1];
  if (
    location.protocol !== "https:" || location.username || location.password ||
    location.port || location.hash || authority !== location.hostname ||
    !(location.hostname === actionsDownloadHostPolicy.exact_host ||
      /^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(location.hostname))
  ) fail("provider_download_host_policy_refused", 502);
  return location;
}

function sourceURL(op: Contract, args: Obj): URL {
  if (op.provider !== "github") {
    fail("provider_download_operation_refused", 400);
  }
  let path: string;
  switch (op.kind) {
    case "download_job":
      path = `actions/jobs/${integer(args.job_id)}/logs`;
      break;
    case "download_step":
      path = `actions/jobs/${integer(args.job_id)}/steps/${
        integer(args.step_number, 1000)
      }/logs`;
      break;
    case "download_attempt":
      path = `actions/runs/${integer(args.run_id)}/attempts/${
        integer(args.attempt_number, 10000)
      }/logs`;
      break;
    case "download_run":
      path = `actions/runs/${integer(args.run_id)}/logs`;
      break;
    case "download_artifact":
      path = `actions/artifacts/${integer(args.artifact_id)}/zip`;
      break;
    default:
      return fail("provider_download_operation_refused", 400);
  }
  return new URL(`https://api.github.com/repos/${REPOSITORY}/${path}`);
}

/** Only call after the current exact owner grant has actually been consumed. */
export async function requestActionsDownload(
  op: Contract,
  args: Obj,
  calls: Calls,
  deps: Pick<Dependencies, "fetch">,
): Promise<Reply> {
  const source = sourceURL(op, args), started = performance.now();
  const initial = await calls.request(source, "GET", undefined, undefined, [
    200,
    302,
  ]);
  if (initial.status === 200) return initial;
  const location = downloadLocation(initial.headers.get("location"));
  const remainingMs = Math.min(
    30000,
    Math.max(1, 60000 - (performance.now() - started)),
  );
  let reply: Response;
  try {
    // Construct every option afresh. No inherited Authorization, cookie, GitHub
    // credential, request body, caller headers or signed URL is relayed onward.
    reply = await (deps.fetch ?? fetch)(location, {
      method: "GET",
      headers: { accept: "application/octet-stream" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "manual",
      signal: AbortSignal.timeout(Math.ceil(remainingMs)),
    });
  } catch {
    throw new Refusal("provider_download_request_failed", 502);
  }
  const id = [
    reply.headers.get("x-ms-request-id"),
    reply.headers.get("x-github-request-id"),
  ]
    .find((value) => value && /^[\x20-\x7e]{1,200}$/.test(value)) ?? null;
  if (reply.status !== 200) {
    await reply.body?.cancel().catch(() => undefined);
    throw new Refusal(
      reply.status >= 300 && reply.status < 400
        ? "provider_download_extra_redirect_refused"
        : reply.status === 403 || reply.status === 401
        ? "provider_download_location_expired_or_refused"
        : "provider_download_http_error",
      502,
      reply.status,
      id,
    );
  }
  const rawLength = reply.headers.get("content-length");
  if (
    rawLength !== null &&
    (!/^[0-9]{1,15}$/.test(rawLength) || Number(rawLength) > MAX_BYTES)
  ) {
    await reply.body?.cancel().catch(() => undefined);
    throw new Refusal("provider_download_size_limit", 502, reply.status, id);
  }
  const reader = reply.body?.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > MAX_BYTES) {
          await reader.cancel();
          throw new Refusal(
            "provider_download_size_limit",
            502,
            reply.status,
            id,
          );
        }
        chunks.push(part.value);
      }
    } catch (error) {
      if (error instanceof Refusal) throw error;
      throw new Refusal(
        "provider_download_response_incomplete",
        502,
        reply.status,
        id,
      );
    } finally {
      reader.releaseLock();
    }
  }
  if (
    rawLength !== null && !reply.headers.has("content-encoding") &&
    length !== Number(rawLength)
  ) {
    throw new Refusal(
      "provider_download_response_incomplete",
      502,
      reply.status,
      id,
    );
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const result: Reply = {
    status: 200,
    id,
    bytes,
    sha256: await bytesDigest(bytes),
    // Preserve the immutable approved API resource. The private signed URL and
    // arbitrary response headers are absent even from this internal receipt.
    url: source.toString(),
    headers: new Headers({
      "content-type": reply.headers.get("content-type") ??
        "application/octet-stream",
    }),
  };
  calls.last = result;
  return result;
}
