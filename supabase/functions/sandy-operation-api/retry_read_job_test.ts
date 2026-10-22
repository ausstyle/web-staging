import assert from "node:assert/strict";
import { requestReadJobRetry, type RetryRpcClient } from "./retry_read_job.ts";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const source = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const child = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const receipt = () => ({
  ok: true,
  accepted: true,
  executed: false,
  request_state: "recorded",
  source_job_id: source,
  retry_job_id: child,
  retry_job_status: "approved",
  reused: false,
  retry_depth: 1,
  dispatch_required: true,
});
function harness(data: unknown = receipt(), error: unknown = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: RetryRpcClient = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data, error });
    },
  };
  return { calls, db };
}
function assertUnknown(
  actual: Awaited<ReturnType<typeof requestReadJobRetry>>,
) {
  assert.deepEqual(actual, {
    status: 503,
    body: {
      ok: false,
      error: "retry_outcome_unknown",
      accepted: null,
      executed: null,
      reconciliation_required: true,
    },
  });
}

Deno.test("retry admission derives the fixed RPC actor from authenticated identity", async () => {
  const { db, calls } = harness({
    ...receipt(),
    secret_diagnostic: "do-not-expose",
  });
  const result = await requestReadJobRetry(db, owner.toUpperCase(), {
    job_id: source.toUpperCase(),
  });
  assert.deepEqual(calls, [{
    name: "sandy_api_retry_read_deployment_job",
    args: { p_job_id: source, p_actor_id: owner },
  }]);
  assert.deepEqual(result, { status: 202, body: receipt() });
  assert.equal("secret_diagnostic" in result.body, false);
  assert.equal(result.body.executed, false);
  assert.equal(result.body.dispatch_required, true);
});

Deno.test("retry admission rejects caller-supplied actors and execution overrides before RPC", async () => {
  const { db, calls } = harness();
  for (
    const args of [
      null,
      [],
      {},
      { job_id: "invalid" },
      { job_id: source, actor_id: owner },
      { job_id: source, approved_by: owner },
      { job_id: source, execute: true },
      { job_id: source, target: "another-target" },
    ]
  ) {
    const result = await requestReadJobRetry(db, owner, args);
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "invalid_retry_arguments");
    assert.equal(result.body.executed, false);
  }
  assert.equal(calls.length, 0);
});

Deno.test("retry admission validates authenticated identity before database access", async () => {
  const { db, calls } = harness();
  const result = await requestReadJobRetry(db, "unverified-user", {
    job_id: source,
  });
  assert.equal(result.status, 401);
  assert.equal(result.body.error, "invalid_identity");
  assert.equal(calls.length, 0);
});

Deno.test("replayed retry receipt reports current child status without claiming this request executed it", async () => {
  for (
    const status of [
      "pending_approval",
      "approved",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ]
  ) {
    const data = {
      ...receipt(),
      retry_job_status: status,
      reused: true,
      dispatch_required: status === "approved",
    };
    const { db } = harness(data);
    const result = await requestReadJobRetry(db, owner, { job_id: source });
    assert.deepEqual(result, { status: 202, body: data });
    assert.equal(result.body.request_state, "recorded");
    assert.equal(result.body.executed, false);
  }
});

Deno.test("classified RPC refusals remain refusals and discard diagnostic bodies", async () => {
  for (
    const [error, status] of [
      ["owner_required", 403],
      ["job_not_found", 404],
      ["only_failed_jobs_can_retry", 409],
      ["retry_operation_not_supported", 422],
      ["retry_requires_outcome_reconciliation", 409],
      ["failure_not_classified_retryable", 409],
      ["original_approval_not_current", 403],
      ["retry_limit_reached", 429],
      ["approved_target_snapshot_missing", 409],
      ["registered_target_required", 409],
      ["approved_job_scope_changed", 409],
      ["approved_target_scope_changed", 409],
      ["retry_idempotency_collision", 409],
    ] as const
  ) {
    const { db } = harness({
      ok: false,
      error,
      http_status: status,
      diagnostic: "private",
    });
    const result = await requestReadJobRetry(db, owner, { job_id: source });
    assert.deepEqual(result, {
      status,
      body: { ok: false, error, accepted: false, executed: false },
    });
  }
});

Deno.test("lost RPC response is an unknown durable outcome rather than a claimed rejection", async () => {
  const throwing: RetryRpcClient = {
    rpc() {
      throw new Error("private transport detail");
    },
  };
  assertUnknown(await requestReadJobRetry(throwing, owner, { job_id: source }));
  const { db } = harness(null, { message: "private SQL detail" });
  assertUnknown(await requestReadJobRetry(db, owner, { job_id: source }));
  const malformedTransport = {
    rpc: () => Promise.resolve(null),
  } as unknown as RetryRpcClient;
  assertUnknown(
    await requestReadJobRetry(malformedTransport, owner, { job_id: source }),
  );
});

Deno.test("malformed success or unrecognized database response cannot claim retry acceptance", async () => {
  const malformed = [
    null,
    [],
    { ok: false, error: "private unexpected error", http_status: 500 },
    { ok: false, error: "owner_required", http_status: 200 },
    { ...receipt(), accepted: false },
    { ...receipt(), executed: true },
    { ...receipt(), request_state: "completed" },
    { ...receipt(), source_job_id: child },
    { ...receipt(), retry_job_id: source },
    { ...receipt(), retry_job_id: "invalid" },
    { ...receipt(), reused: "false" },
    { ...receipt(), retry_depth: 0 },
    { ...receipt(), retry_depth: 4 },
    { ...receipt(), retry_depth: 1.1 },
    { ...receipt(), retry_job_status: "complete" },
    { ...receipt(), dispatch_required: false },
    { ...receipt(), retry_job_status: "running", dispatch_required: true },
  ];
  for (const data of malformed) {
    const { db } = harness(data);
    assertUnknown(await requestReadJobRetry(db, owner, { job_id: source }));
  }
});
