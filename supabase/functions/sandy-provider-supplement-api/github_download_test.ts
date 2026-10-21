import assert from "node:assert/strict";
import { type Contract, type Obj, supplementContracts } from "./contracts.ts";
import { requestActionsDownload } from "./github_download.ts";
import { bindingFor, capture } from "./providers.ts";
import {
  bytesDigest,
  Calls,
  type Dependencies,
  type OpaqueSave,
  Refusal,
} from "./runtime.ts";

const contracts = Object.values(supplementContracts).filter((op) =>
  op.kind.startsWith("download_")
);
const actor = "11111111-1111-4111-8111-111111111111",
  admission = "22222222-2222-4222-8222-222222222222";
const argsFor = (op: Contract): Obj => ({
  ...(op.kind.includes("job") || op.kind === "download_step"
    ? { job_id: 12 }
    : {}),
  ...(op.kind === "download_step" ? { step_number: 2 } : {}),
  ...(op.kind.includes("run") || op.kind === "download_attempt"
    ? { run_id: 34 }
    : {}),
  ...(op.kind === "download_attempt" ? { attempt_number: 1 } : {}),
  ...(op.kind === "download_artifact" ? { artifact_id: 56 } : {}),
});
function harness(
  location =
    "https://storageaccount123.blob.core.windows.net/private/synthetic?sig=SIGNED_PRIVATE_FIXTURE",
  storage?: () => Response,
) {
  const requests: { url: string; init: RequestInit }[] = [],
    saved: OpaqueSave[] = [];
  const deps: Dependencies = {
    service: "synthetic-service",
    now: () => Date.parse("2026-10-21T12:00:00Z"),
    authorizeContext: async () => ({ allowed: true }),
    consumeGrant: async () => ({ allowed: true, admission_id: admission }),
    credentialForExecution: async () => "fixture-github-credential",
    finishExecution: async () => ({ allowed: true }),
    fetch: (input, init = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push({ url, init });
      if (requests.length === 1) {
        assert.equal(
          new Headers(init.headers).get("authorization"),
          "Bearer fixture-github-credential",
        );
        assert(
          url.startsWith(
            "https://api.github.com/repos/ausstyle/web-staging/actions/",
          ),
        );
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: {
              location,
              "x-github-request-id": "fixture-source-request",
            },
          }),
        );
      }
      assert.equal(new Headers(init.headers).get("authorization"), null);
      assert.equal(new Headers(init.headers).get("cookie"), null);
      assert.equal(init.credentials, "omit");
      assert.equal(init.referrerPolicy, "no-referrer");
      assert.equal(init.redirect, "manual");
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      return Promise.resolve(
        storage ? storage() : new Response("PRIVATE_PAYLOAD", {
          headers: {
            "content-type": "application/zip",
            "x-ms-request-id": "fixture-storage-request",
            "set-cookie": "never-return-me",
          },
        }),
      );
    },
    saveOpaque: async (value) => {
      saved.push(value);
      return {
        custody_id: crypto.randomUUID(),
        byte_length: value.byte_length,
        sha256: value.payload_sha256,
        media_type: value.media_type,
        expires_at: "2026-10-21T12:05:00Z",
      };
    },
    takeOpaque: async () => {
      throw Error("not used");
    },
  };
  const calls = new Calls(deps, "fixture-github-credential", "github");
  return { deps, calls, requests, saved };
}
Deno.test("Actions download: all5 fixed repo routes complete exactly one unauthenticated documented-host hop into private custody", async () => {
  assert.equal(contracts.length, 5);
  for (const op of contracts) {
    const f = harness(), args = argsFor(op);
    const reply = await requestActionsDownload(op, args, f.calls, f.deps);
    assert.equal(f.requests.length, 2);
    assert.equal(reply.status, 200);
    assert.equal(
      reply.sha256,
      await bytesDigest(new TextEncoder().encode("PRIVATE_PAYLOAD")),
    );
    assert.equal(reply.headers.get("set-cookie"), null);
    assert.equal(reply.headers.get("location"), null);
    assert(
      reply.url.startsWith(
        "https://api.github.com/repos/ausstyle/web-staging/actions/",
      ),
    );
    assert(!reply.url.includes("SIGNED_PRIVATE_FIXTURE"));
    const artifact = await capture(
      reply,
      await bindingFor(
        op,
        args,
        f.deps,
        {
          actor_id: actor,
          tenant_id: null,
          request_id: crypto.randomUUID(),
          grant_id: crypto.randomUUID(),
        },
        admission,
        reply.url,
        "artifact",
      ),
      f.deps,
    );
    assert.equal(artifact.transfer_state, "captured_private");
    assert.equal(artifact.content_returned, false);
    assert.equal(f.saved[0].actor, actor);
    assert.equal(f.saved[0].admission, admission);
    assert.equal(f.saved[0].operation, op.operation);
    assert.equal(f.saved[0].target, f.requests[0].url);
    assert.equal(f.saved[0].payload_sha256, reply.sha256);
    assert.equal(f.calls.last, reply);
    assert(
      !JSON.stringify(artifact).match(
        /SIGNED_PRIVATE_FIXTURE|PRIVATE_PAYLOAD|fixture-github-credential|blob\.core/,
      ),
    );
  }
});
Deno.test("Actions download: exact documented results receiver is accepted; broader GitHub/Azure host suffixes are refused", async () => {
  const op = contracts[0],
    good = harness(
      "https://results-receiver.actions.githubusercontent.com/private/signed?sig=synthetic",
    );
  await requestActionsDownload(op, argsFor(op), good.calls, good.deps);
  assert.equal(good.requests.length, 2);
  for (
    const location of [
      "https://evil.invalid/private",
      "https://storageaccount.blob.core.windows.net.evil.invalid/private",
      "https://a.blob.core.windows.net/private",
      "https://a.b.blob.core.windows.net/private",
      "https://github.com/private",
      "https://api.github.com/private",
      "https://x.actions.githubusercontent.com/private",
      "https://storageaccount.blob.core.windows.net:443/private",
      "https://storageaccount.blob.core.windows.net:444/private",
      "https://user@storageaccount.blob.core.windows.net/private",
      "http://storageaccount.blob.core.windows.net/private",
      "https://storageaccount.blob.core.windows.net/private#fragment",
      "https://storageaccount.blob.core.windows.net/private#",
      "https://127.0.0.1/private",
      "https://storageaccount.blob.core.windows.net./private",
      "https://storageaccount.blob.core.windows.net/private?x=%0a",
    ]
  ) {
    const f = harness(location);
    await assert.rejects(
      () => requestActionsDownload(op, argsFor(op), f.calls, f.deps),
      Refusal,
    );
    assert.equal(f.requests.length, 1, location);
  }
});
Deno.test("Actions download: extra redirect, expiry, partial/error status and oversized signed location never fetch another URL", async () => {
  const op = contracts[0];
  for (const status of [301, 302, 307, 308, 401, 403, 404, 429, 500, 206]) {
    const f = harness(
      undefined,
      () =>
        new Response("private error body", {
          status,
          headers: {
            location: "https://unapproved.invalid/next?secret=never-output",
          },
        }),
    );
    await assert.rejects(
      () => requestActionsDownload(op, argsFor(op), f.calls, f.deps),
      (error) =>
        error instanceof Refusal && !error.message.includes("private error"),
    );
    assert.equal(f.requests.length, 2);
    assert.equal(f.saved.length, 0);
  }
  const huge = harness(
    "https://storageaccount.blob.core.windows.net/private?sig=" +
      "x".repeat(8192),
  );
  await assert.rejects(
    () => requestActionsDownload(op, argsFor(op), huge.calls, huge.deps),
    Refusal,
  );
  assert.equal(huge.requests.length, 1);
});
Deno.test("Actions download: decoded byte size and declared length fail closed; short streams never become complete private artifacts", async () => {
  const op = contracts[0];
  for (
    const make of [
      () => new Response(new Uint8Array(1048577)),
      () => new Response("x", { headers: { "content-length": "1048577" } }),
      () => new Response("x", { headers: { "content-length": "10" } }),
      () => new Response("x", { headers: { "content-length": "invalid" } }),
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array([1]));
              c.error(Error("private stream failure"));
            },
          }),
        ),
    ]
  ) {
    const f = harness(undefined, make);
    await assert.rejects(
      () => requestActionsDownload(op, argsFor(op), f.calls, f.deps),
      Refusal,
    );
    assert.equal(f.saved.length, 0);
  }
});
Deno.test("Actions download: direct200 capture makes only the fixed authenticated API request", async () => {
  const f = harness(), op = contracts[0];
  f.deps.fetch = (_input, init = {}) => {
    f.requests.push({ url: String(_input), init });
    return Promise.resolve(new Response("direct private response"));
  };
  const reply = await requestActionsDownload(op, argsFor(op), f.calls, f.deps);
  assert.equal(f.requests.length, 1);
  assert.equal(reply.status, 200);
  assert.equal(
    reply.sha256,
    await bytesDigest(new TextEncoder().encode("direct private response")),
  );
});
