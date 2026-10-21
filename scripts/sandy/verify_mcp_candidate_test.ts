import { strict as assert } from "node:assert";
import { candidateUrl } from "./verify_mcp_candidate.ts";

Deno.test("release acceptance uses only the tagged endpoint of the exact preserved Sandy service", () => {
  const before = { service: "sandy-engineering-mcp", project: "elaborate-haven-511518-a5", source_commit_candidate: "a".repeat(40),
    url: "https://sandy-engineering-mcp-fixture-ew.a.run.app" };
  const after = { status: { traffic: [{ tag: "sandy-api-review", url: "https://sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app" }] } };
  assert.equal(candidateUrl(before, after, "a".repeat(40)), "https://sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app/mcp");
  for (const url of ["https://outside.invalid", "https://user:password@sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app",
    "https://sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app/other", "http://sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app",
    "https://sandy-api-review---sandy-engineering-mcp-other.a.run.app"]) {
    assert.throws(() => candidateUrl(before, { status: { traffic: [{ tag: "sandy-api-review", url }] } }, "a".repeat(40)));
  }
  assert.throws(() => candidateUrl({ ...before, project: "other" }, after));
  assert.throws(() => candidateUrl(before, after, "b".repeat(40)));
});
