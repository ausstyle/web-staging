import assert from "node:assert/strict";
import { verifyGithubReadback } from "./sandy_github_readback.ts";
import {
  readVerifiedExecution,
  verifiedExecutionHeaders,
} from "./sandy_execution_receipt_transport.ts";
const commit = "a".repeat(40),
  blob = "b".repeat(40),
  tree = "c".repeat(40),
  parent = "d".repeat(40);
const path = "engineering-smoke/test.txt", content = btoa("fixture\n");
const args = { path: { path }, body: { content, branch: "fixture" } };
const raw = {
  commit: { sha: commit },
  content: { sha: blob },
  download_url: "https://untrusted.invalid/credential",
};
Deno.test("GitHub content verification reads the immutable revision on the fixed provider and returns only digest evidence", async () => {
  let calls = 0;
  const result = await verifyGithubReadback(
    "github.files.update",
    args,
    raw,
    "PRIVATE",
    (async (url, init) => {
      calls++;
      assert.equal(
        String(url),
        `https://api.github.com/repos/ausstyle/web-staging/contents/${path}?ref=${commit}`,
      );
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      return Response.json({
        path,
        sha: blob,
        size: 8,
        type: "file",
        encoding: "base64",
        content,
      });
    }) as typeof fetch,
  );
  assert.equal(calls, 1);
  assert.equal(result.verified, true);
  if (result.verified) {
    assert.equal(result.proof.byte_length, 8);
    assert.equal(JSON.stringify(result).includes(content), false);
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  }
});
Deno.test("GitHub readback mismatch, failure and unsafe target do not verify or retry a write", async () => {
  for (
    const response of [
      () =>
        Response.json({
          path,
          sha: blob,
          size: 8,
          type: "file",
          encoding: "base64",
          content: btoa("changed\n"),
        }),
      () => Response.json({}, { status: 403 }),
      () =>
        Response.json({
          path: "wrong",
          sha: blob,
          size: 8,
          type: "file",
          encoding: "base64",
          content,
        }),
    ]
  ) {
    const result = await verifyGithubReadback(
      "github.files.update",
      args,
      raw,
      "PRIVATE",
      (async () => response()) as typeof fetch,
    );
    assert.equal(result.verified, false);
  }
  let calls = 0;
  const refused = await verifyGithubReadback(
    "github.files.update",
    { ...args, path: { path: "../secret" } },
    raw,
    "PRIVATE",
    (async () => {
      calls++;
      throw Error();
    }) as typeof fetch,
  );
  assert.equal(refused.verified, false);
  assert.equal(calls, 0);
});
Deno.test("GitHub padded base64 with provider trailing newlines verifies actual bytes", async () => {
  for (
    const text of [
      "one!",
      "two!!",
      "Sandy engineering fixture machine verified\n",
    ]
  ) {
    const encoded = btoa(text);
    const result = await verifyGithubReadback(
      "github.files.update",
      { ...args, body: { ...args.body, content: encoded } },
      raw,
      "PRIVATE",
      (async () =>
        Response.json({
          path,
          sha: blob,
          size: text.length,
          type: "file",
          encoding: "base64",
          content: encoded + "\n",
        })) as typeof fetch,
    );
    assert.equal(result.verified, true);
    if (result.verified) assert.equal(result.proof.byte_length, text.length);
  }
});
Deno.test("GitHub detached commit verification binds message, tree and ordered parents", async () => {
  const args = {
    body: { tree, parents: [parent], message: "isolated fixture" },
  };
  for (const mismatch of [false, true]) {
    const result = await verifyGithubReadback(
      "github.commit",
      args,
      { sha: commit },
      "PRIVATE",
      (async (url) => {
        assert.equal(
          String(url),
          `https://api.github.com/repos/ausstyle/web-staging/git/commits/${commit}`,
        );
        return Response.json({
          sha: commit,
          tree: { sha: tree },
          parents: [{ sha: mismatch ? commit : parent }],
          message: "isolated fixture",
        });
      }) as typeof fetch,
    );
    assert.equal(result.verified, !mismatch);
    if (result.verified) {
      assert.match(String(result.proof.parents_sha256), /^[a-f0-9]{64}$/);
    }
  }
});
Deno.test("GitHub immutable readback retries transient visibility, never permission failures or mutations", async () => {
  for (const status of [404, 503, 403]) {
    let calls = 0;
    const result = await verifyGithubReadback(
      "github.files.update",
      args,
      raw,
      "PRIVATE",
      (async (_url, init) => {
        calls++;
        assert.equal(init?.method, "GET");
        return calls === 1 ? Response.json({}, { status }) : Response.json({
          path,
          sha: blob,
          size: 8,
          type: "file",
          encoding: "base64",
          content,
        });
      }) as typeof fetch,
    );
    assert.equal(calls, status === 403 ? 1 : 2);
    assert.equal(result.verified, status !== 403);
    if (!result.verified) {
      assert.equal(result.reason, "github_readback_http_403");
    }
  }
});
Deno.test("GitHub exhausted transient readbacks report the actual bounded error without exposing response bodies", async () => {
  let calls = 0;
  const result = await verifyGithubReadback(
    "github.commit",
    { body: { tree, parents: [parent], message: "fixture" } },
    { sha: commit },
    "PRIVATE",
    (async () => {
      calls++;
      return Response.json({ message: "PRIVATE upstream detail" }, {
        status: 404,
      });
    }) as typeof fetch,
  );
  assert.equal(calls, 3);
  assert.deepEqual(result, {
    verified: false,
    reason: "github_readback_http_404",
  });
});
Deno.test("verified receipt metadata binds admission and operation; pending verification remains explicit", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const proof = {
    admission_id: id,
    state: "succeeded" as const,
    effect_verified: true as const,
    verification_sha256: "f".repeat(64),
  };
  const response = new Response(null, {
    headers: verifiedExecutionHeaders(proof),
  });
  assert.deepEqual(readVerifiedExecution(response, "github.commit", id), proof);
  assert.equal(
    readVerifiedExecution(response, "supabase.sql.execute", id),
    null,
  );
  assert.equal(
    readVerifiedExecution(
      response,
      "github.commit",
      "20000000-0000-4000-8000-000000000001",
    ),
    null,
  );
  const pending = {
    admission_id: id,
    state: "accepted" as const,
    effect_verified: false as const,
    reconciliation_required: true as const,
    verification_error: "github_readback_not_confirmed" as const,
  };
  assert.deepEqual(
    readVerifiedExecution(
      new Response(null, { headers: verifiedExecutionHeaders(pending) }),
      "github.commit",
      id,
    ),
    pending,
  );
});
