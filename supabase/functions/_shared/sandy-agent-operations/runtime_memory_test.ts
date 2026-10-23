import assert from "node:assert/strict";
import { loadRuntimeMemory } from "./runtime_memory.ts";
const customer = "10000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000001";
const id = "30000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-10-24T12:00:00Z"), before = "2026-10-23T12:00:00Z";
const row = { id, owner_customer_id: customer, state: "active", channel: "whatsapp", content: "Invoice_INV_123 from the verified source", occurred_at: before };
function database(patch: Record<string, any> = {}) {
  const calls: any[] = [], counts: Record<string, number> = {};
  const settings = { enabled: true, consent_at: before, updated_at: before, ...patch.settings };
  return { calls, from(table: string) {
    const filters: any[] = [];
    const result = async (single = false) => {
      counts[table] = (counts[table] || 0) + 1;
      calls.push({ table, filters: structuredClone(filters) });
      if (patch.throwTable === table) throw Error("private database failure");
      if (patch.errorTable === table) return { data: null, error: { code: "private" } };
      if (table === "sandy_memory_settings") return { data: counts[table] === 2 && patch.afterSettings ? patch.afterSettings : settings, error: null };
      if (table === "sandy_memory_rejected_facts") return { data: counts[table] === 2 && patch.afterCorrections ? patch.afterCorrections : patch.corrections || [], error: null };
      assert.equal(table, "sandy_memory_archive");
      return { data: counts[table] === 2 && patch.readback ? patch.readback : patch.rows || [row], error: null };
    };
    const q: any = { select: (fields: string) => { filters.push(["select", fields]); return q; }, eq: (key: string, value: unknown) => { filters.push(["eq", key, value]); return q; }, in: (key: string, value: unknown) => { filters.push(["in", key, value]); return q; }, ilike: (key: string, value: unknown) => { filters.push(["ilike", key, value]); return q; }, order: (...args: any[]) => { filters.push(["order", ...args]); return q; }, limit: (value: number) => { filters.push(["limit", value]); return q; }, maybeSingle: () => result(true), then: (resolve: any) => result().then(resolve) };
    return q;
  } };
}
const correction = { id, rejected_value: "the OLD value", corrected_value: "the new value", rejected_at: before };
Deno.test("current memory requires verified consent before querying any content", async () => {
  for (const settings of [{ enabled: false }, { consent_at: null }, { consent_at: "2027-01-01T00:00:00Z" }]) {
    const db = database({ settings }), result = await loadRuntimeMemory(customer, "Invoice", db, now);
    assert.ok(result.error); assert.equal(db.calls.length, 1); assert.equal(db.calls[0].table, "sandy_memory_settings");
    assert.equal(JSON.stringify(result).includes(row.content), false);
  }
});
Deno.test("literal identifiers survive LIKE escaping and results retain channel provenance", async () => {
  const db = database(), result = await loadRuntimeMemory(customer, "INV_123%", db, now);
  assert.deepEqual(result.records, [{ id, channel: "whatsapp", content: row.content, occurred_at: before }]);
  const archiveCalls = db.calls.filter((c: any) => c.table === "sandy_memory_archive");
  assert.ok(archiveCalls[0].filters.some((f: any) => f[0] === "ilike" && f[2] === "%INV\\_123\\%%"));
  assert.ok(archiveCalls.every((c: any) => c.filters.some((f: any) => f[0] === "eq" && f[1] === "owner_customer_id" && f[2] === customer)));
  assert.equal(db.calls.filter((c: any) => c.table === "sandy_memory_settings").length, 2);
});
Deno.test("foreign or inactive results fail closed even if an adapter ignores filters", async () => {
  for (const change of [{ owner_customer_id: other }, { state: "forgotten" }]) {
    const result = await loadRuntimeMemory(customer, "Invoice", database({ rows: [{ ...row, ...change }] }), now);
    assert.equal(result.error, "memory_lookup_unscoped_response"); assert.equal(result.records, undefined);
  }
});
Deno.test("forgetting and source changes before independent readback suppress all snippets", async () => {
  for (const readback of [[], [{ ...row, content: "changed" }], [{ ...row, state: "forgotten" }]]) {
    const result = await loadRuntimeMemory(customer, "Invoice", database({ readback }), now);
    assert.equal(result.error, "memory_source_changed"); assert.equal(result.records, undefined);
  }
});
Deno.test("a recorded literal correction is not returned from stale archived messages", async () => {
  const result = await loadRuntimeMemory(customer, "value", database({ rows: [{ ...row, content: "A past assertion: THE  old VALUE." }], corrections: [correction] }), now);
  assert.deepEqual(result, { records: [] });
  const current = await loadRuntimeMemory(customer, "value", database({ rows: [{ ...row, content: "the new value" }], corrections: [correction] }), now);
  assert.equal(current.records[0].content, "the new value");
});
Deno.test("correction during lookup requires a fresh request rather than stale context", async () => {
  const result = await loadRuntimeMemory(customer, "Invoice", database({ afterCorrections: [correction] }), now);
  assert.equal(result.error, "memory_corrections_changed"); assert.equal(result.records, undefined);
});
Deno.test("unbounded or unavailable rejection coverage is not reported as empty memory", async () => {
  const result = await loadRuntimeMemory(customer, "Invoice", database({ corrections: Array.from({ length: 201 }, () => correction) }), now);
  assert.equal(result.error, "memory_correction_coverage_unavailable");
});
Deno.test("revocation and consent revision changes during lookup suppress the response", async () => {
  for (const afterSettings of [{ enabled: false }, { enabled: true, consent_at: before, updated_at: "2026-10-24T11:00:00Z" }]) {
    const result = await loadRuntimeMemory(customer, "Invoice", database({ afterSettings }), now);
    assert.equal(result.error, "memory_settings_changed"); assert.equal(result.records, undefined);
  }
});
Deno.test("content is bounded after validation; genuine empty lookup remains distinct from failure", async () => {
  const result = await loadRuntimeMemory(customer, "Invoice", database({ rows: [{ ...row, content: "x".repeat(3000) }] }), now);
  assert.equal(result.records[0].content.length, 900);
  assert.deepEqual(await loadRuntimeMemory(customer, "Invoice", database({ rows: [] }), now), { records: [] });
  for (const table of ["sandy_memory_settings", "sandy_memory_archive", "sandy_memory_rejected_facts"]) {
    const failure = await loadRuntimeMemory(customer, "Invoice", database({ errorTable: table }), now);
    assert.ok(failure.error); assert.equal(failure.records, undefined);
  }
});
Deno.test("invalid identity and query cannot access storage", async () => {
  for (const [cid, query] of [["invalid", "Invoice"], [customer, "  "], [customer, "x".repeat(181)]]) {
    const db = database(); assert.equal((await loadRuntimeMemory(cid, query, db, now)).error, "memory_lookup_input_invalid"); assert.equal(db.calls.length, 0);
  }
});
