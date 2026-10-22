import assert from "node:assert/strict";
import {
  githubSourceDelivery,
  SourceDeliveryError,
} from "./sandy_github_source_delivery.ts";
const path = "supabase/functions/example/index.ts";
async function blob(text: string) {
  const bytes = new TextEncoder().encode(text),
    header = new TextEncoder().encode(`blob ${bytes.length}\0`),
    all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-1", all)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const raw = async (text: string) => ({
  path,
  type: "file",
  sha: await blob(text),
  size: text.length,
  encoding: "base64",
  content: btoa(text) + "\n",
});
Deno.test("repository source ranges reconstruct an immutable file larger than legacy inline bounds", async () => {
  const text = "reviewed source\n".repeat(6000), provider = await raw(text);
  let joined = "";
  let offset = 0;
  let digest: unknown;
  do {
    const r = await githubSourceDelivery(
      provider,
      { path: { path }, range: { offset, max_bytes: 65536 } },
      "PRIVATE",
      (() => {
        throw Error("Unexpected URL");
      }) as typeof fetch,
    );
    assert.equal(r.offset, offset);
    assert.equal(r.total_size, text.length);
    digest ??= r.source_sha256;
    assert.equal(r.source_sha256, digest);
    joined += atob(String(r.content));
    offset = r.next_offset as number;
  } while (offset !== null);
  assert.equal(joined, text);
  await assert.rejects(
    () => githubSourceDelivery(provider, { path: { path } }, "PRIVATE", fetch),
    (e: unknown) => e instanceof SourceDeliveryError && e.status === 413,
  );
});
Deno.test("repository fallback reads only the pinned GitHub blob and rejects changed content", async () => {
  const provider = await raw("fixture text\n");
  const metadata = { ...provider, encoding: "none", content: "" };
  let calls = 0;
  const request = (async (url, init) => {
    calls++;
    assert.equal(
      String(url),
      `https://api.github.com/repos/ausstyle/web-staging/git/blobs/${provider.sha}`,
    );
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    return Response.json(provider);
  }) as typeof fetch;
  const result = await githubSourceDelivery(
    metadata,
    { path: { path } },
    "PRIVATE",
    request,
  );
  assert.equal(atob(String(result.content)), "fixture text\n");
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      githubSourceDelivery(
        { ...provider, sha: "a".repeat(40) },
        { path: { path } },
        "PRIVATE",
        request,
      ),
    (e: unknown) =>
      e instanceof SourceDeliveryError &&
      e.code === "repository_source_integrity_failed",
  );
  await assert.rejects(() =>
    githubSourceDelivery(
      provider,
      { path: { path: "other.ts" } },
      "PRIVATE",
      request,
    )
  );
});
Deno.test("repository credential material is refused before any text range is returned", async () => {
  const text = "ordinary prefix\n" +
    JSON.stringify({
      client_secret: "synthetic-private-material-that-must-not-leave-source",
    }) + "\n";
  const provider = await raw(text);
  await assert.rejects(
    () =>
      githubSourceDelivery(
        provider,
        { path: { path }, range: { offset: 0, max_bytes: 4 } },
        "PRIVATE",
        fetch,
      ),
    (e: unknown) => e instanceof SourceDeliveryError && e.status === 403,
  );
});

Deno.test("readonly dotfiles and CI definitions are delivered, credential paths and traversal are refused", async () => {
  for (
    const name of [
      ".gitignore",
      ".github/workflows/sandy-runtime-release-checks.yml",
      "nested/.editorconfig",
    ]
  ) {
    const provider = { ...await raw("reviewed public source\n"), path: name };
    const result = await githubSourceDelivery(
      provider,
      { path: { path: name } },
      "PRIVATE",
      fetch,
    );
    assert.equal(atob(String(result.content)), "reviewed public source\n");
  }
  for (
    const name of [
      ".env",
      "nested/.env.production",
      ".git/config",
      "secrets/service-account.json",
      "../outside",
      "nested/../outside",
      "/absolute",
      "folder//file",
      "encoded%2fpath",
      "key.pem",
    ]
  ) {
    const provider = { ...await raw("not released\n"), path: name };
    await assert.rejects(
      () =>
        githubSourceDelivery(
          provider,
          { path: { path: name } },
          "PRIVATE",
          fetch,
        ),
      (e: unknown) => e instanceof SourceDeliveryError && e.status === 422,
    );
  }
});
