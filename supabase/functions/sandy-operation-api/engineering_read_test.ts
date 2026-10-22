import assert from "node:assert/strict";
import {
  buildEngineeringReadRequest,
  type EngineeringReadOperation,
  engineeringReadTransportFailure,
  isEngineeringReadOperation,
  normalizeEngineeringReadResponse,
} from "./engineering_read.ts";

const changeId = "11111111-2222-4333-8444-555555555555";
const jobId = "22222222-3333-4444-8555-666666666666";
const rowId = "33333333-4444-4555-8666-777777777777";
const actorId = "44444444-5555-4666-8777-888888888888";
const time = "2026-10-20T21:50:00.000Z";
const summary = {
  id: changeId,
  title: "Synthetic read contract fixture",
  status: "approved",
  risk: "low",
  created_at: time,
  updated_at: time,
  verified_at: null,
};
const change = {
  ...summary,
  problem: "Synthetic fixture only",
  expected_behavior: "Passive read returns existing records",
  scope: [],
  regression_rules: [],
  acceptance_criteria: [],
  requested_by: actorId,
  idempotency_key: null,
  change_purpose: null,
  feature_improvement: null,
};
const job = {
  id: jobId,
  engineering_change_id: changeId,
  created_at: time,
  updated_at: time,
  requested_by: "synthetic-fixture",
  provider: "supabase",
  operation: "read",
  target: "synthetic-fixture",
  payload: { synthetic_fixture: true },
  idempotency_key: "synthetic-read-fixture-key",
  status: "pending_approval",
  approved_by: null,
  approved_at: null,
  started_at: null,
  finished_at: null,
  result: null,
  error: null,
};
const detail = {
  change,
  events: [{
    id: 1,
    change_id: changeId,
    event_type: "synthetic-fixture",
    actor: actorId,
    detail: { test: true },
    occurred_at: time,
  }],
  artifacts: [{
    id: rowId,
    change_id: changeId,
    artifact_type: "synthetic-fixture",
    target: "synthetic-fixture",
    before_ref: null,
    after_ref: null,
    rollback_strategy: "synthetic-fixture",
    rollback_notes: null,
    metadata: { test: true },
    created_at: time,
  }],
  tests: [{
    id: rowId,
    change_id: changeId,
    test_name: "synthetic-fixture",
    outcome: "passed",
    evidence: { test: true },
    checked_at: time,
    created_at: time,
  }],
  rollbacks: [{
    id: rowId,
    change_id: changeId,
    requested_by: actorId,
    reason: "synthetic-fixture",
    status: "requested",
    plan: [],
    created_at: time,
    updated_at: time,
  }],
};

Deno.test("Engineering read builder binds fixed endpoint/actions and forwards only the real user context", () => {
  for (
    const [operation, action, args] of [
      ["engineering.change.list", "list", {}],
      ["engineering.change.get", "get", { change_id: changeId }],
      ["engineering.job.status", "job_status", {
        change_id: changeId,
        job_id: jobId,
      }],
    ] as [EngineeringReadOperation, string, Record<string, unknown>][]
  ) {
    const built = buildEngineeringReadRequest(
      "https://sandy.fixture.invalid",
      "fixture-anon-key",
      "fixture.real.user.jwt",
      operation,
      args,
    );
    assert.ok(built);
    assert.equal(
      built.url,
      "https://sandy.fixture.invalid/functions/v1/sandy-engineering-control",
    );
    assert.equal(built.init.method, "POST");
    assert.equal(built.init.redirect, "error");
    assert.equal(
      new Headers(built.init.headers).get("authorization"),
      "Bearer fixture.real.user.jwt",
    );
    assert.equal(
      new Headers(built.init.headers).get("apikey"),
      "fixture-anon-key",
    );
    assert.deepEqual(JSON.parse(String(built.init.body)), { action, ...args });
    assert.equal(
      String(built.init.body).includes("fixture.real.user.jwt"),
      false,
    );
  }
});

Deno.test("Engineering reads reject action overrides, scope omission, alternate endpoints and write operation identifiers", () => {
  for (
    const [operation, args] of [
      ["engineering.change.list", { limit: 1 }],
      ["engineering.change.get", {}],
      ["engineering.change.get", { change_id: "not-a-uuid" }],
      ["engineering.change.get", {
        change_id: changeId,
        action: "execute_job",
      }],
      ["engineering.job.status", { job_id: jobId }],
      ["engineering.job.status", { change_id: changeId }],
      ["engineering.job.status", {
        change_id: changeId,
        job_id: jobId,
        target: "other",
      }],
      ["engineering.job.execute", { change_id: changeId, job_id: jobId }],
      ["constructor", {}],
    ]
  ) {
    assert.equal(
      buildEngineeringReadRequest(
        "https://sandy.fixture.invalid",
        "anon",
        "user.jwt",
        operation,
        args,
      ),
      null,
    );
  }
  for (
    const base of [
      "http://sandy.fixture.invalid",
      "https://user:password@sandy.fixture.invalid",
      "https://sandy.fixture.invalid/other",
      "https://sandy.fixture.invalid?op=execute_job",
    ]
  ) {
    assert.equal(
      buildEngineeringReadRequest(
        base,
        "anon",
        "user.jwt",
        "engineering.change.list",
        {},
      ),
      null,
    );
  }
  assert.equal(isEngineeringReadOperation("engineering.job.execute"), false);
  assert.equal(isEngineeringReadOperation("toString"), false);
});

Deno.test("Engineering normalization accepts complete passive payloads and preserves records without inventing verification", async () => {
  for (
    const [operation, args, payload] of [
      ["engineering.change.list", {}, { changes: [summary] }],
      ["engineering.change.get", { change_id: changeId }, detail],
      ["engineering.job.status", { change_id: changeId, job_id: jobId }, {
        job,
      }],
    ] as [
      EngineeringReadOperation,
      Record<string, unknown>,
      Record<string, unknown>,
    ][]
  ) {
    const response = await normalizeEngineeringReadResponse(
      operation,
      args,
      Response.json(payload),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: true, contract_version: "1.0.0", ...payload });
    assert.equal("verified" in body, false);
    assert.equal("executed" in body, false);
  }
});

Deno.test("Engineering normalization refuses partial histories, foreign linked rows, job scope mismatch and list overflow", async () => {
  const cases: [EngineeringReadOperation, Record<string, unknown>, unknown][] =
    [
      ["engineering.change.list", {}, { changes: [{ id: changeId }] }],
      ["engineering.change.list", {}, {
        changes: Array.from({ length: 101 }, () => summary),
      }],
      ["engineering.change.get", { change_id: changeId }, { change }],
      ["engineering.change.get", { change_id: changeId }, {
        ...detail,
        change: { ...change, id: rowId },
      }],
      ["engineering.change.get", { change_id: changeId }, {
        ...detail,
        events: [{ ...detail.events[0], change_id: rowId }],
      }],
      ["engineering.change.get", { change_id: changeId }, {
        ...detail,
        artifacts: [{ ...detail.artifacts[0], change_id: rowId }],
      }],
      ["engineering.change.get", { change_id: changeId }, {
        ...detail,
        tests: [{ ...detail.tests[0], change_id: rowId }],
      }],
      ["engineering.change.get", { change_id: changeId }, {
        ...detail,
        rollbacks: [{ ...detail.rollbacks[0], change_id: rowId }],
      }],
      ["engineering.job.status", { change_id: changeId, job_id: jobId }, {
        job: { ...job, engineering_change_id: rowId },
      }],
      ["engineering.job.status", { change_id: changeId, job_id: jobId }, {
        job: { ...job, id: rowId },
      }],
      ["engineering.job.status", { change_id: changeId, job_id: jobId }, {
        job: { id: jobId, engineering_change_id: changeId },
      }],
    ];
  for (const [operation, args, payload] of cases) {
    const response = await normalizeEngineeringReadResponse(
      operation,
      args,
      Response.json(payload),
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).ok, false);
  }
});

Deno.test("Engineering missing change/job objects produce precise not-found results", async () => {
  for (
    const [operation, args, payload, expected] of [
      ["engineering.change.get", { change_id: changeId }, {
        ...detail,
        change: null,
      }, "engineering_change_not_found"],
      ["engineering.job.status", { change_id: changeId, job_id: jobId }, {
        job: null,
      }, "engineering_job_not_found"],
    ] as [EngineeringReadOperation, Record<string, unknown>, unknown, string][]
  ) {
    for (const status of [200, 404]) {
      const response = await normalizeEngineeringReadResponse(
        operation,
        args,
        Response.json(payload, { status }),
      );
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { ok: false, error: expected });
    }
  }
  const missingChange = await normalizeEngineeringReadResponse(
    "engineering.job.status",
    { change_id: changeId, job_id: jobId },
    Response.json({ error: "Change not found" }, { status: 404 }),
  );
  assert.equal(missingChange.status, 404);
  assert.deepEqual(await missingChange.json(), {
    ok: false,
    error: "engineering_change_not_found",
  });
});

Deno.test("Engineering failed, redirected or malformed responses never become successful reads or leak upstream details", async () => {
  for (
    const response of [
      Response.json({ error: "fixture-private-provider-detail" }),
      Response.json({ changes: [], ok: false }),
      Response.json({
        changes: [],
        unexpected: "fixture-private-provider-detail",
      }),
      Response.json({ error: "fixture-private-provider-detail" }, {
        status: 403,
      }),
      Response.json({ error: "fixture-private-provider-detail" }, {
        status: 500,
      }),
      new Response("fixture-private-provider-detail", { status: 302 }),
      new Response("fixture-private-provider-detail", { status: 200 }),
    ]
  ) {
    const result = await normalizeEngineeringReadResponse(
      "engineering.change.list",
      {},
      response,
    );
    assert.ok(result.status >= 400);
    const text = await result.text();
    assert.equal(JSON.parse(text).ok, false);
    assert.equal(text.includes("fixture-private-provider-detail"), false);
  }
  assert.deepEqual(engineeringReadTransportFailure(), {
    ok: false,
    error: "engineering_read_outcome_unknown",
    executed: null,
  });
});
