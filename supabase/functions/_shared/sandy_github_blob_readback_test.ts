import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyGithubReadback } from "./sandy_github_readback.ts";
const op = "github.git.blobs.create";
function fixture(content: string, encoding = "utf-8") {
  const bytes = Buffer.from(content, encoding === "base64" ? "base64" : "utf8");
  const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes)
    .digest("hex");
  return {
    body: { content, encoding },
    raw: { sha },
    observed: {
      sha,
      encoding: "base64",
      size: bytes.length,
      content: bytes.toString("base64"),
    },
    bytes,
  };
}
Deno.test("immutable blobs verify exact UTF-8, binary, empty and maximum bytes with fixed GET", async () => {
  for (
    const f of [
      fixture("hello 🌍\n"),
      fixture("\ufeffBOM"),
      fixture("AP+A", "base64"),
      fixture(""),
      fixture("x".repeat(65536)),
    ]
  ) {
    let count = 0;
    const got = await verifyGithubReadback(
      op,
      { body: f.body },
      f.raw,
      "fixture",
      (url, init) => {
        count++;
        assert.equal(
          url,
          `https://api.github.com/repos/ausstyle/web-staging/git/blobs/${f.raw.sha}`,
        );
        assert.equal(init?.method, "GET");
        assert.equal(init?.redirect, "error");
        return Promise.resolve(Response.json(f.observed));
      },
    );
    assert.equal(count, 1);
    assert.equal(got.verified, true);
    if (got.verified) {
      assert.deepEqual(got.proof, {
        version: 1,
        kind: "github_blob",
        repository: "ausstyle/web-staging",
        blob_sha: f.raw.sha,
        byte_length: f.bytes.length,
        content_sha256: createHash("sha256").update(f.bytes).digest("hex"),
        read_http_status: 200,
      });
    }
  }
});
Deno.test("blob verification rejects input and response identity mismatches before any GET", async () => {
  const f = fixture("hello");
  for (
    const body of [
      { content: "x".repeat(65537) },
      { content: "a", encoding: "rot13" },
      { content: "%%%", encoding: "base64" },
      { content: "\ud800" },
      { content: 12 },
    ]
  ) {
    let calls = 0;
    const r = await verifyGithubReadback(op, { body }, f.raw, "fixture", () => {
      calls++;
      throw Error();
    });
    assert.equal(r.verified, false);
    assert.equal(calls, 0);
  }
  const bad = await verifyGithubReadback(
    op,
    { body: f.body },
    { sha: "a".repeat(40) },
    "fixture",
    () => {
      throw Error("unexpected GET");
    },
  );
  assert.equal(bad.verified, false);
});
Deno.test("blob proof cannot accept wrong bytes, size, encoding, SHA or provider refusal", async () => {
  const f = fixture("hello");
  for (
    const patch of [{ content: btoa("other") }, { size: 6 }, {
      encoding: "utf-8",
    }, { sha: "a".repeat(40) }]
  ) {
    const r = await verifyGithubReadback(
      op,
      { body: f.body },
      f.raw,
      "fixture",
      () => Promise.resolve(Response.json({ ...f.observed, ...patch })),
    );
    assert.equal(r.verified, false);
  }
  let calls = 0;
  const r = await verifyGithubReadback(
    op,
    { body: f.body },
    f.raw,
    "fixture",
    () => {
      calls++;
      return Promise.resolve(new Response("", { status: 403 }));
    },
  );
  assert.deepEqual(r, { verified: false, reason: "github_readback_http_403" });
  assert.equal(calls, 1);
});
