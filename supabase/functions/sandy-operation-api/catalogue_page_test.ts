import assert from "node:assert/strict";
import { cataloguePage } from "../_shared/sandy_catalogue_page.ts";
import { operationRequestPath } from "./request_path.ts";
import { parseApiJobRoute } from "./api_job_routes.ts";

Deno.test("all catalogue records and exact schemas traverse bounded pages without omission or duplicates", () => {
  const records = Array.from({ length: 2568 }, (_, i) => ({
    operation: `fixture.operation.${i}`,
    input_schema: { type: "object", properties: { index: { const: i } } },
  }));
  const collected: typeof records = [];
  let cursor: string | undefined;
  do {
    const page = cataloguePage(records, "a".repeat(64), 100, cursor);
    if (!page.ok) throw Error(page.error);
    assert.ok(page.operations.length <= 100);
    collected.push(...page.operations as typeof records);
    cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(collected, records);
  assert.equal(new Set(collected.map((r) => r.operation)).size, 2568);
});

Deno.test("catalogue transfer bounds count UTF8 bytes and refuse a single oversized entry", () => {
  const record = {
    operation: "fixture.unicode",
    description: "🐨".repeat(1000),
  };
  const page = cataloguePage(
    [record, record],
    "b".repeat(64),
    100,
    undefined,
    7000,
  );
  if (!page.ok) throw Error(page.error);
  assert.equal(page.operations.length, 1);
  assert.ok(page.next_cursor);
  assert.deepEqual(
    cataloguePage([record], "b".repeat(64), 1, undefined, 3000),
    {
      ok: false,
      status: 503,
      error: "catalogue_entry_size_limit",
    },
  );
});

Deno.test("malformed and stale cursors cannot silently omit catalogue records", () => {
  const rows = [{ operation: "fixture.one" }, { operation: "fixture.two" }];
  for (
    const [limit, cursor] of [
      [0, undefined],
      [101, undefined],
      [1.5, undefined],
      [1, "bad"],
      [1, null],
    ]
  ) {
    assert.equal(cataloguePage(rows, "a".repeat(64), limit, cursor).ok, false);
  }
  for (const cursor of [`sc1.${"b".repeat(64)}.1`, `sc1.${"a".repeat(64)}.2`]) {
    assert.deepEqual(cataloguePage(rows, "a".repeat(64), 1, cursor), {
      ok: false,
      status: 409,
      error: "catalogue_changed_restart_discovery",
    });
  }
});

Deno.test("public and Edge function paths preserve canonical routes and reject lookalike prefixes", async () => {
  const id = "10000000-0000-4000-8000-000000000001";
  for (
    const prefix of [
      "",
      "/sandy-operation-api",
      "/functions/v1/sandy-operation-api",
    ]
  ) {
    assert.equal(
      operationRequestPath(prefix + "/v1/capabilities"),
      "/v1/capabilities",
    );
    assert.deepEqual(
      await parseApiJobRoute(
        new Request("https://edge.invalid" + prefix + "/v1/jobs/" + id),
      ),
      {
        ok: true,
        value: { jobId: id, action: "get" },
      },
    );
  }
  for (
    const bad of [
      "/sandy-operation-api-other",
      "/functions/v1/sandy-operation-api-other",
      "/x/sandy-operation-api",
    ]
  ) {
    assert.equal(operationRequestPath(bad), bad);
  }
});
