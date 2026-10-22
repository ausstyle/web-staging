import assert from "node:assert/strict";
import { createGithubPublicationBoundary } from "./sandy_github_publication_boundary.ts";
const anchor = "a".repeat(40), main = "b".repeat(40), desired = "c".repeat(40);
const tree = (commit: string) =>
  ({
    [anchor]: "d".repeat(40),
    [main]: "e".repeat(40),
    [desired]: "f".repeat(40),
  })[commit];
const entry = (path: string, sha: string, mode = "100644", type = "blob") => ({
  path,
  sha: sha.repeat(40),
  mode,
  type,
});
const workflow = entry(".github/workflows/release.yml", "1"),
  credential = entry(".env.production", "2"),
  newWorkflow = entry(".github/workflows/owner-security.yml", "3");
function fixture(
  candidate: unknown[],
  mode = "standing_engineering",
  options: { truncated?: boolean; unavailable?: boolean } = {},
) {
  const calls: string[] = [];
  const db = {
    rpc: (name: string) => {
      assert.equal(name, "sandy_engineering_github_publication_context");
      return Promise.resolve({
        data: {
          ok: true,
          mode,
          repository: "ausstyle/web-staging",
          baseline_commit: anchor,
          delegation_id: "10000000-0000-4000-8000-000000000001",
          version: 4,
        },
        error: options.unavailable ? {} : null,
      });
    },
  };
  const request = (async (value, init) => {
    const url = String(value);
    calls.push(url);
    assert.ok(
      url.startsWith("https://api.github.com/repos/ausstyle/web-staging/git/"),
    );
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    if (url.endsWith("ref/heads/main")) {
      return Response.json({
        ref: "refs/heads/main",
        object: { type: "commit", sha: main },
      });
    }
    const commit = [anchor, main, desired].find((s) =>
      url.endsWith("commits/" + s)
    );
    if (commit) {
      return Response.json({ sha: commit, tree: { sha: tree(commit) } });
    }
    const source = [anchor, main, desired].find((s) =>
      url.endsWith("trees/" + tree(s) + "?recursive=1")
    );
    assert.ok(source);
    return Response.json({
      sha: tree(source!),
      truncated: options.truncated ?? false,
      tree: source === desired
        ? candidate
        : source === main
        ? [workflow, credential, newWorkflow]
        : [workflow, credential],
    });
  }) as typeof fetch;
  return { boundary: createGithubPublicationBoundary(db, request), calls };
}
const request = {
  admission_id: "admitted",
  operation: "github.refs.update",
  arguments: {
    path: { ref: "heads/engineering/source" },
    body: { sha: desired, force: false },
  },
  token: "PRIVATE",
};
Deno.test("source publication permits code changes while retaining every approved protected file", async () => {
  const f = fixture([
    workflow,
    credential,
    newWorkflow,
    entry("app/source.ts", "4"),
  ]);
  assert.deepEqual(await f.boundary(request), { allowed: true });
  assert.equal(f.calls.length, 7);
});
Deno.test("indirect tree omission, replacement, mode changes and credential additions cannot bypass source boundaries", async () => {
  for (
    const candidate of [
      [],
      [workflow, credential],
      [workflow, newWorkflow],
      [{ ...workflow, sha: "9".repeat(40) }, credential, newWorkflow],
      [{ ...workflow, mode: "120000" }, credential, newWorkflow],
      [workflow, credential, newWorkflow, entry("service-account.json", "9")],
    ]
  ) {
    const result = await fixture(candidate).boundary(request);
    assert.deepEqual(result, {
      allowed: false,
      error: "engineering_protected_source_denied",
      http_status: 403,
    });
  }
});
Deno.test("missing private context and truncated source observations fail closed", async () => {
  for (const options of [{ unavailable: true }, { truncated: true }]) {
    assert.deepEqual(
      await fixture(
        [workflow, credential, newWorkflow],
        "standing_engineering",
        options,
      ).boundary(request),
      {
        allowed: false,
        error: "engineering_source_boundary_unavailable",
        http_status: 503,
      },
    );
  }
});
Deno.test("only a trusted explicit owner approval preserves its existing separate authority path", async () => {
  const f = fixture([], "explicit_owner_approval");
  assert.deepEqual(await f.boundary(request), { allowed: true });
  assert.equal(f.calls.length, 0);
  assert.equal(
    (await fixture([], "caller_invented_approval").boundary(request)).allowed,
    false,
  );
});
Deno.test("standing source boundaries reject protected references and forced updates before provider reads", async () => {
  for (
    const args of [{
      path: { ref: "heads/main" },
      body: { sha: desired, force: false },
    }, {
      path: { ref: "heads/engineering/source" },
      body: { sha: desired, force: true },
    }]
  ) {
    const f = fixture([workflow, credential, newWorkflow]);
    assert.equal(
      (await f.boundary({ ...request, arguments: args })).allowed,
      false,
    );
    assert.equal(f.calls.length, 0);
  }
});
