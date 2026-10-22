import assert from "node:assert/strict";
import {
  loadTemporalContext,
  temporalContextBundle,
} from "./temporal_context.ts";
const CUSTOMER = "10000000-0000-4000-8000-000000000001";
const FOREIGN = "20000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-10-21T12:00:00Z");
const BEFORE = "2026-10-20T12:00:00Z";
const AFTER = "2026-10-22T12:00:00Z";
const id = (n: number) =>
  "30000000-0000-4000-8000-" + String(n).padStart(12, "0");
const fact = (patch: Record<string, any> = {}) => ({
  id: id(1),
  customer_id: CUSTOMER,
  subject_type: "person",
  subject_id: "person-one",
  predicate: "preferred_language",
  value: "English",
  state: "confirmed",
  confidence: 0.9,
  access_scope: "private",
  sensitivity: "normal",
  review_status: "approved",
  observed_at: BEFORE,
  recorded_at: BEFORE,
  source_channel: "web",
  source_ref: "fixture-web-turn",
  valid_from: BEFORE,
  valid_until: null,
  expires_at: null,
  supersedes_id: null,
  ...patch,
});
function database(patch: Record<string, any> = {}) {
  const requests: any[] = [];
  const current = { enabled: true, consent_at: BEFORE, updated_at: BEFORE };
  let settingsReads = 0;
  return {
    requests,
    from(table: string) {
      assert.equal(table, "sandy_memory_settings");
      const query: any = {
        select: (fields: string) => {
          assert.equal(fields, "enabled,consent_at,updated_at");
          return query;
        },
        eq: (key: string, value: string) => {
          assert.equal(key, "customer_id");
          assert.equal(value, CUSTOMER);
          return query;
        },
        maybeSingle: async () => {
          settingsReads++;
          requests.push({ kind: "settings" });
          return patch.settingsError
            ? { error: { code: "unavailable" }, data: null }
            : {
              data: settingsReads === 2 && patch.after
                ? patch.after
                : { ...current, ...patch.settings },
              error: null,
            };
        },
      };
      return query;
    },
    rpc: async (name: string, args: any) => {
      requests.push({ kind: "rpc", name, args });
      if (patch.throwRpc) throw Error("fixture failure");
      return {
        data: patch.rows ?? [fact()],
        error: patch.rpcError ? { code: "unavailable" } : null,
      };
    },
  };
}
Deno.test("temporal context retains distinct subjects, fact IDs and source references", () => {
  const bundle = temporalContextBundle(CUSTOMER, [
    fact(),
    fact({ id: id(2), subject_id: "person-two", value: "Italian" }),
  ], NOW);
  assert.equal(bundle.status, "available");
  assert.equal(bundle.facts.length, 2);
  assert.deepEqual(
    bundle.facts.map((f) => [f.subject_id, f.value, f.source_ref]),
    [
      ["person-one", "English", "fixture-web-turn"],
      ["person-two", "Italian", "fixture-web-turn"],
    ],
  );
});
Deno.test("foreign, sensitive, rejected and unsupported-scope records never enter context", () => {
  const rows = [
    fact(),
    ...[
      { customer_id: FOREIGN },
      { sensitivity: "sensitive" },
      { review_status: "rejected" },
      { review_status: "pending" },
      { state: "retracted" },
      { state: "disputed" },
      { access_scope: "unrecognized" },
      { source_ref: "" },
      { confidence: "0.9" },
    ].map((p, i) => fact({ ...p, id: id(i + 2), value: "DO_NOT_INCLUDE" })),
  ];
  const bundle = temporalContextBundle(CUSTOMER, rows, NOW);
  assert.equal(bundle.facts.length, 1);
  assert.equal(bundle.status, "partial");
  assert.equal(JSON.stringify(bundle).includes("DO_NOT_INCLUDE"), false);
  assert.equal(JSON.stringify(bundle).includes(FOREIGN), false);
});
Deno.test("expired, future and malformed temporal evidence is omitted", () => {
  const rows = [
    { expires_at: BEFORE },
    { valid_until: BEFORE },
    { valid_from: AFTER },
    { recorded_at: AFTER },
    { observed_at: AFTER },
    { expires_at: "invalid" },
    { recorded_at: null },
  ].map((p, i) => fact({ ...p, id: id(i + 1) }));
  const bundle = temporalContextBundle(CUSTOMER, rows, NOW);
  assert.equal(bundle.facts.length, 0);
  assert.equal(bundle.status, "partial");
  assert.equal(bundle.omitted, rows.length);
});
Deno.test("a recorded correction or rejection suppresses the prior fact", () => {
  for (const state of ["confirmed", "rejected"]) {
    const bundle = temporalContextBundle(CUSTOMER, [
      fact({ value: "OLD_VALUE" }),
      fact({
        id: id(2),
        supersedes_id: id(1),
        state,
        value: "CORRECTED_VALUE",
      }),
    ], NOW);
    assert.equal(JSON.stringify(bundle).includes("OLD_VALUE"), false);
    assert.equal(bundle.facts.length, state === "confirmed" ? 1 : 0);
  }
});
Deno.test("a foreign or future row cannot suppress a current customer's fact", () => {
  for (const patch of [{ customer_id: FOREIGN }, { recorded_at: AFTER }]) {
    const bundle = temporalContextBundle(CUSTOMER, [
      fact(),
      fact({ ...patch, id: id(2), supersedes_id: id(1) }),
    ], NOW);
    assert.equal(bundle.facts.length, 1);
    assert.equal(bundle.facts[0].id, id(1));
  }
});
Deno.test("context budget keeps whole JSON facts and reports omissions", () => {
  const rows = [
    fact({ value: "OVERSIZED".repeat(1500) }),
    ...Array.from(
      { length: 8 },
      (_, i) => fact({ id: id(i + 2), value: "v".repeat(400) }),
    ),
  ];
  const bundle = temporalContextBundle(CUSTOMER, rows, NOW, 1800);
  const encoded = JSON.stringify(bundle);
  assert.ok(encoded.length <= 1800);
  assert.equal(bundle.status, "partial");
  assert.ok(bundle.facts.length > 0);
  assert.ok(bundle.omitted > 0);
  assert.deepEqual(JSON.parse(encoded), bundle);
  for (const f of bundle.facts) assert.equal(f.source_ref, "fixture-web-turn");
});
Deno.test("bounded projection does not claim exhaustive memory coverage", () => {
  const bundle = temporalContextBundle(
    CUSTOMER,
    Array.from({ length: 40 }, (_, i) => fact({ id: id(i + 1) })),
    NOW,
  );
  assert.equal(bundle.status, "partial");
  assert.equal(bundle.coverage, "bounded_current_temporal_projection");
});
Deno.test("disabled or unverified consent performs no temporal read", async () => {
  for (
    const settings of [{ enabled: false }, { consent_at: null }, {
      consent_at: AFTER,
    }, { updated_at: AFTER }]
  ) {
    const db = database({ settings });
    const bundle = await loadTemporalContext(CUSTOMER, db, NOW);
    assert.equal(bundle.facts.length, 0);
    assert.equal(
      bundle.status,
      settings.enabled === false ? "disabled" : "unavailable",
    );
    assert.deepEqual(db.requests, [{ kind: "settings" }]);
  }
});
Deno.test("authorized load uses the existing customer-scoped RPC and rechecks consent", async () => {
  const db = database();
  const bundle = await loadTemporalContext(CUSTOMER, db, NOW);
  assert.equal(bundle.status, "available");
  assert.equal(bundle.facts.length, 1);
  assert.deepEqual(db.requests, [
    { kind: "settings" },
    {
      kind: "rpc",
      name: "sandy_temporal_current",
      args: {
        p_customer_id: CUSTOMER,
        p_at: new Date(NOW).toISOString(),
        p_limit: 40,
      },
    },
    { kind: "settings" },
  ]);
});
Deno.test("revocation or changed settings during retrieval suppress the response", async () => {
  for (
    const after of [
      { enabled: false, consent_at: BEFORE, updated_at: BEFORE },
      { enabled: true, consent_at: BEFORE, updated_at: AFTER },
    ]
  ) {
    const db = database({ after });
    const bundle = await loadTemporalContext(CUSTOMER, db, NOW);
    assert.equal(bundle.status, "unavailable");
    assert.equal(bundle.reason, "memory_settings_changed");
    assert.equal(bundle.facts.length, 0);
  }
});
Deno.test("lookup failures are unavailable, while an authorized empty result is available", async () => {
  for (
    const patch of [{ settingsError: true }, { rpcError: true }, {
      throwRpc: true,
    }]
  ) {
    const bundle = await loadTemporalContext(CUSTOMER, database(patch), NOW);
    assert.equal(bundle.status, "unavailable");
    assert.equal(bundle.facts.length, 0);
  }
  const empty = await loadTemporalContext(
    CUSTOMER,
    database({ rows: [] }),
    NOW,
  );
  assert.equal(empty.status, "available");
  assert.equal(empty.facts.length, 0);
});
Deno.test("invalid customer input cannot query a memory store", async () => {
  const db = database();
  assert.equal(
    (await loadTemporalContext("not-an-identity", db, NOW)).status,
    "unavailable",
  );
  assert.deepEqual(db.requests, []);
});

Deno.test("one customer temporal projection preserves separate cross-channel provenance",async()=>{
 const rows=["web","email","whatsapp","voice"].map((source_channel,i)=>fact({id:id(i+1),source_channel,source_ref:"verified-source-"+source_channel}));
 const db=database({rows});const result=await loadTemporalContext(CUSTOMER,db,NOW);
 assert.equal(result.status,"available");assert.deepEqual(result.facts.map(x=>x.source_channel),["web","email","whatsapp","voice"]);
 assert.equal(db.requests.filter(x=>x.kind==="settings").length,2);assert.equal(db.requests.filter(x=>x.kind==="rpc").length,1);
});
