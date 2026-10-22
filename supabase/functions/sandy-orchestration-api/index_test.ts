import assert from "node:assert/strict";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  createOrchestrationHandler,
  handleOrchestrationAction,
  type ObjectValue,
  requestLegacyDeploymentJob,
  type RpcClient,
  runWorker,
  validatePlan,
} from "./index.ts";
import { orchestrationContracts } from "./contracts.ts";
import providerCatalogue from "../sandy-provider-operation-api/contracts.json" with {
  type: "json",
};
const reviewedProviderCatalogue = providerCatalogue as unknown as {
  operations: ObjectValue[];
};
const actor = "10000000-0000-4000-8000-000000000001",
  job = "10000000-0000-4000-8000-000000000002",
  plan = "10000000-0000-4000-8000-000000000003";
const worker = "10000000-0000-4000-8000-000000000004",
  lease = "10000000-0000-4000-8000-000000000005",
  dispatch = "10000000-0000-4000-8000-000000000006";
const service = "fixture-internal-service-secret";
const entry = {
  operation: "supabase.projects.get",
  handler: "sandy-provider-read-api",
  permission_scope: "infrastructure:read",
  is_mutation: false,
  api_exposed: true,
  ai_exposed: true,
  verified: false,
  registry_revision: "a".repeat(64),
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  output_schema: {
    type: "object",
    required: ["ok"],
    properties: { ok: { const: true } },
  },
};
const steps = [{ key: "identity", operation: entry.operation, arguments: {} }, {
  key: "dependent",
  operation: entry.operation,
  depends_on: ["identity"],
}];
function database(
  answer: (name: string, args: ObjectValue) => unknown | Promise<unknown>,
) {
  const calls: { name: string; args: ObjectValue }[] = [];
  const db: RpcClient = {
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve(answer(name, args)).then((data) => ({
        data,
        error: null,
      }));
    },
  };
  return { db, calls };
}
const admission = {
  ok: true,
  accepted: true,
  executed: false,
  request_state: "recorded",
  plan_id: plan,
  reused: false,
  dispatch_required: true,
  jobs: [{ job_id: job, step_key: "operation", state: "queued" }],
};
Deno.test("plan validation checks live schemas and scope, normalizes dependencies and admits no side effects", async () => {
  const result = await validatePlan({ steps }, [entry], "api");
  assert.equal(result.valid, true);
  assert.equal(result.provider_dry_run_performed, false);
  assert.equal(result.cost_estimate.monetary_total, null);
  assert.equal(result.cost_estimate.pricing_status, "unavailable");
  assert.equal(result.blast_radius.provider_writes, false);
  assert.equal(result.tenant_execution_supported, false);
  assert.deepEqual(result.steps.map((step) => step.key), [
    "dependent",
    "identity",
  ]);
  assert.equal(result.steps[0].input_sha256, await argumentDigest({}));
  assert.equal(result.steps[0].registry_revision, entry.registry_revision);
});
Deno.test("invalid, cyclic, missing, duplicated, unknown or mutation plan members fail closed", async () => {
  for (
    const [input, catalogue, expected] of [
      [
        {
          steps: [{
            key: "a",
            operation: entry.operation,
            depends_on: ["missing"],
          }],
        },
        [entry],
        "missing_dependency",
      ],
      [
        {
          steps: [{ key: "a", operation: entry.operation, depends_on: ["b"] }, {
            key: "b",
            operation: entry.operation,
            depends_on: ["a"],
          }],
        },
        [entry],
        "plan_cycle",
      ],
      [{ steps: [steps[0], steps[0]] }, [entry], "duplicate_step_key"],
      [
        {
          steps: [{
            key: "a",
            operation: entry.operation,
            arguments: { project_id: "forged" },
          }],
        },
        [entry],
        "invalid_operation_arguments",
      ],
      [{ steps }, [{ ...entry, is_mutation: true }], "operation_not_delegated"],
      [
        { steps },
        [{ ...entry, handler: "arbitrary-provider" }],
        "operation_not_delegated",
      ],
      [{ steps }, [{
        ...entry,
        input_schema: { type: "object", $async: true },
      }], "operation_contract_unavailable"],
      [{ steps }, [entry, entry], "operation_catalogue_invalid"],
      [{ steps, actor_id: actor }, [entry], "invalid_plan"],
    ] as const
  ) {
    const result = await validatePlan(input, catalogue, "api");
    assert.equal(result.valid, false);
    assert.ok(
      result.blockers.some((blocker) => blocker.code === expected),
      expected,
    );
  }
  const apiOnly = { ...entry, ai_exposed: false };
  assert.equal((await validatePlan({ steps }, [apiOnly], "api")).valid, true);
  assert.equal((await validatePlan({ steps }, [apiOnly], "mcp")).valid, false);
});
Deno.test("execution admission fetches server-authorized catalogue then one transactional RPC with actor and canonical input hash", async () => {
  const h = database((name) =>
    name === "sandy_orch_catalogue"
      ? { ok: true, operations: [entry] }
      : admission
  );
  const reply = await handleOrchestrationAction(
    h.db,
    actor,
    "operation_enqueue",
    { operation: entry.operation, idempotency_key: "fixture-idempotency-0001" },
    "mcp",
  );
  assert.equal(reply.status, 202);
  const body = await reply.json();
  assert.equal(body.executed, false);
  assert.equal(body.request_state, "recorded");
  assert.deepEqual(h.calls.map((call) => call.name), [
    "sandy_orch_catalogue",
    "sandy_orch_admit",
  ]);
  assert.equal(h.calls[1].args.p_actor_id, actor);
  assert.equal(h.calls[1].args.p_channel, "mcp");
  const stored = h.calls[1].args.p_steps as ObjectValue[];
  assert.equal(stored[0].input_sha256, await argumentDigest({}));
  assert.equal(stored[0].registry_revision, entry.registry_revision);
  assert.equal(JSON.stringify(h.calls).includes(service), false);
});
Deno.test("owner denial, validation failure, actor overrides and unknown receipt do not become accepted execution", async () => {
  const denied = database(() => ({
    ok: false,
    error: "owner_required",
    http_status: 403,
  }));
  assert.equal(
    (await handleOrchestrationAction(denied.db, actor, "plan_execute", {
      steps,
      idempotency_key: "fixture-owner-denied",
    })).status,
    403,
  );
  assert.equal(denied.calls.length, 1);
  const h = database((name) =>
    name === "sandy_orch_catalogue"
      ? { ok: true, operations: [entry] }
      : { ...admission, executed: true }
  );
  const override = await handleOrchestrationAction(
    h.db,
    actor,
    "operation_enqueue",
    {
      operation: entry.operation,
      idempotency_key: "fixture-actor-override",
      actor_id: "forged",
    },
  );
  assert.equal(override.status, 400);
  assert.equal(h.calls.length, 0);
  const unknown = await handleOrchestrationAction(
    h.db,
    actor,
    "operation_enqueue",
    { operation: entry.operation, idempotency_key: "fixture-unknown-receipt" },
  );
  const body = await unknown.json();
  assert.equal(unknown.status, 503);
  assert.equal(body.accepted, null);
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
  const lost: RpcClient = {
    rpc: () => {
      throw Error("private-diagnostic-credential");
    },
  };
  const lostReply = await requestLegacyDeploymentJob(lost, actor, {
    provider: "google_cloud",
    operation: "get_vm",
    target: "fixture-target",
    idempotency_key: "fixture-lost-response",
  });
  assert.equal(lostReply.status, 503);
  assert.equal((await lostReply.text()).includes("private-diagnostic"), false);
});
Deno.test("owned status/event/cancel/retry requests bind actor and validate cursors before fixed RPCs", async () => {
  const h = database(() => ({
    ok: true,
    job_id: job,
    state: "queued",
    accepted: true,
    executed: false,
    reused: true,
  }));
  const invalid = await handleOrchestrationAction(h.db, actor, "job_events", {
    job_id: job,
    after: -1,
  });
  assert.equal(invalid.status, 400);
  assert.equal(h.calls.length, 0);
  await handleOrchestrationAction(h.db, actor, "job_events", {
    job_id: job,
    after: 9,
    limit: 2,
  });
  assert.deepEqual(h.calls[0], {
    name: "sandy_orch_events_page",
    args: { p_actor_id: actor, p_job_id: job, p_after: 9, p_limit: 2 },
  });
  const retried = await handleOrchestrationAction(h.db, actor, "job_retry", {
    job_id: job,
  });
  assert.equal(retried.status, 202);
  assert.equal(h.calls[1].name, "sandy_orch_retry");
});
Deno.test("legacy request is one fixed transactional RPC and never inserts directly or claims provider execution", async () => {
  const h = database(() => ({
    ok: true,
    accepted: true,
    executed: false,
    job_id: job,
    state: "pending_approval",
    reused: false,
    dispatch_required: false,
  }));
  const args = {
    provider: "google_cloud",
    operation: "get_vm",
    target: "fixture-target",
    idempotency_key: "fixture-legacy-request",
  };
  const reply = await requestLegacyDeploymentJob(h.db, actor, args);
  assert.equal(reply.status, 202);
  assert.deepEqual(h.calls, [{
    name: "sandy_api_request_legacy_deployment_job",
    args: { p_actor_id: actor, p_request: { ...args, payload: {} } },
  }]);
  assert.equal((await reply.json()).executed, false);
  assert.equal(
    (await requestLegacyDeploymentJob(h.db, actor, {
      ...args,
      actor_id: "forged",
    })).status,
    400,
  );
  assert.equal(h.calls.length, 1);
});
function workerHarness(
  options: {
    failFetch?: boolean;
    loseFinish?: boolean;
    queuedResult?: boolean;
    responseStatus?: number;
  } = {},
) {
  const h = database((name) => {
    if (name === "sandy_orch_claim") {
      return {
        ok: true,
        claims: [{ job_id: job, lease_token: lease, worker_id: worker }],
      };
    }
    if (name === "sandy_orch_attempt_receipt") {
      return {
        ok: true,
        started: true,
        dispatch_id: dispatch,
        state: "running",
      };
    }
    if (name === "sandy_orch_finish") {
      if (options.loseFinish) throw Error("private-db-diagnostic");
      return {
        ok: true,
        job_id: job,
        reused: false,
        receipt_outcome: options.failFetch
          ? "unknown"
          : options.queuedResult
          ? "failed"
          : options.responseStatus
          ? "retryable"
          : "succeeded",
        state: options.failFetch || options.responseStatus
          ? "queued"
          : options.queuedResult
          ? "failed"
          : "succeeded",
      };
    }
    throw Error("unexpected RPC");
  });
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (options.failFetch) throw Error("private-network-diagnostic");
    return Promise.resolve(
      Response.json(
        options.queuedResult
          ? { ok: true, accepted: true, executed: false }
          : options.responseStatus
          ? { ok: false, executed: true }
          : {
            ok: true,
            executed: true,
            result: { ok: true, metadata: "fixture" },
          },
        { status: options.responseStatus ?? 200 },
      ),
    );
  }) as typeof fetch;
  return {
    ...h,
    callsHttp: calls,
    dependencies: {
      db: h.db,
      base: "https://project.supabase.co",
      service,
      anon: "fixture-anon",
      fetch: fetcher,
    },
  };
}
Deno.test("worker uses only canonical API with private lease proof and persists one dispatch-ID-bound response", async () => {
  const h = workerHarness();
  const result = await runWorker(h.dependencies, { worker_id: worker });
  assert.equal(result.ok, true);
  assert.equal(h.callsHttp.length, 1);
  assert.equal(
    h.callsHttp[0].url,
    "https://project.supabase.co/functions/v1/sandy-operation-api/v1/internal/execute",
  );
  assert.deepEqual(JSON.parse(String(h.callsHttp[0].init?.body)), {
    job_id: job,
    lease_token: lease,
    worker_id: worker,
  });
  assert.equal(
    new Headers(h.callsHttp[0].init?.headers).get("authorization"),
    "Bearer " + service,
  );
  assert.deepEqual(h.calls.map((call) => call.name), [
    "sandy_orch_claim",
    "sandy_orch_attempt_receipt",
    "sandy_orch_finish",
  ]);
  assert.equal(h.calls[2].args.p_dispatch_id, dispatch);
  assert.equal(h.calls[2].args.p_outcome, "succeeded");
  for (const secret of [lease, service, "fixture-anon"]) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});
Deno.test("worker never mistakes queue acceptance, timeout or rejected provider response for completed execution", async () => {
  for (
    const options of [{ failFetch: true }, { queuedResult: true }, {
      responseStatus: 503,
    }]
  ) {
    const h = workerHarness(options);
    const result = await runWorker(h.dependencies, { worker_id: worker });
    assert.equal(h.callsHttp.length, 1);
    assert.notEqual(h.calls[2].args.p_outcome, "succeeded");
    assert.equal(h.calls[2].args.p_result, null);
    assert.equal(JSON.stringify(result).includes("private-"), false);
  }
  const h = workerHarness({ loseFinish: true });
  const result = await runWorker(h.dependencies, { worker_id: worker });
  assert.equal(result.ok, false);
  assert.equal(
    (result.results as { state: string }[])[0].state,
    "receipt_persistence_unknown",
  );
  assert.equal(h.callsHttp.length, 1);
});
Deno.test("service endpoint rejects user sessions, actor overrides and worker option abuse before any RPC", async () => {
  const h = workerHarness();
  const handler = createOrchestrationHandler(h.dependencies);
  const send = (authorization: string, body: unknown) =>
    handler(
      new Request("https://local.invalid", {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (await send("Bearer actual-user-session", {
      action: "plan_validate",
      actor_id: actor,
      arguments: { steps },
    })).status,
    401,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(
    (await send("Bearer " + service, {
      action: "worker_run",
      arguments: { limit: 500 },
    })).status,
    503,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(
    (await send("Bearer " + service, {
      action: "plan_validate",
      actor_id: actor,
      forged: true,
      arguments: { steps },
    })).status,
    400,
  );
  assert.equal(h.calls.length, 0);
});
Deno.test("every published orchestration schema compiles strictly and truthful validation/admission receipts match", async () => {
  const validator = new Ajv({
    strict: true,
    allErrors: false,
    validateFormats: true,
  });
  for (const [name, format] of Object.entries(fullFormats)) {
    validator.addFormat(name, format);
  }
  for (const contract of orchestrationContracts) {
    validator.compile(contract.input_schema);
    validator.compile(contract.output_schema);
  }
  const report = await validatePlan({ steps }, [entry], "api");
  assert.equal(
    validator.validate(
      orchestrationContracts.find((contract) =>
        contract.operation === "orchestration.plans.validate"
      )!.output_schema,
      report,
    ),
    true,
  );
  assert.equal(
    validator.validate(
      orchestrationContracts.find((contract) =>
        contract.operation === "orchestration.operations.enqueue"
      )!.output_schema,
      admission,
    ),
    true,
  );
  assert.equal(
    validator.validate(
      orchestrationContracts.find((contract) =>
        contract.operation === "orchestration.operations.enqueue"
      )!.output_schema,
      { ...admission, executed: true },
    ),
    false,
  );
  const jobSchema =
    orchestrationContracts.find((contract) =>
      contract.operation === "orchestration.jobs.get"
    )!.output_schema;
  const status = {
    ok: true,
    job: {
      id: job,
      plan_id: plan,
      step_key: "identity",
      operation: entry.operation,
      state: "succeeded",
      attempts: 1,
      max_attempts: 3,
      latest_attempt: {
        attempt: 1,
        dispatch_id: dispatch,
        started_at: "2026-10-20T00:00:00Z",
        finished_at: "2026-10-20T00:00:01Z",
        outcome: "succeeded",
        provider_request_id: "synthetic-request",
        execution_admission_id: null,
      },
      result: { ok: true },
      error_code: null,
      created_at: "2026-10-20T00:00:00Z",
      started_at: "2026-10-20T00:00:00Z",
      finished_at: "2026-10-20T00:00:01Z",
      provider_execution_completed: true,
      rollback_available: false,
    },
  };
  assert.equal(validator.validate(jobSchema, status), true);
  assert.equal(
    validator.validate(jobSchema, {
      ...status,
      job: {
        ...status.job,
        latest_attempt: { ...status.job.latest_attempt, lease_token: lease },
      },
    }),
    false,
  );
});

Deno.test("duplicate claims and malformed completion acknowledgements cannot create success or replay dispatch", async () => {
  const calls: string[] = [];
  const duplicate = database(() => ({
    ok: true,
    claims: [{ job_id: job, lease_token: lease, worker_id: worker }, {
      job_id: job,
      lease_token: lease,
      worker_id: worker,
    }],
  }));
  const denied = await runWorker({
    db: duplicate.db,
    base: "https://project.supabase.co",
    service,
    fetch: (async (input) => {
      calls.push(String(input));
      return Response.json({});
    }) as typeof fetch,
  }, { worker_id: worker, limit: 2 });
  assert.equal(denied.ok, false);
  assert.equal(calls.length, 0);
  const h = workerHarness();
  const original = h.db.rpc;
  h.db.rpc = (name, args) =>
    name === "sandy_orch_finish"
      ? Promise.resolve({ data: { ok: true, state: "succeeded" }, error: null })
      : original(name, args);
  const malformed = await runWorker(h.dependencies, { worker_id: worker });
  assert.equal(malformed.ok, false);
  assert.equal(
    (malformed.results as { state: string }[])[0].state,
    "receipt_persistence_unknown",
  );
  assert.equal(h.callsHttp.length, 1);
});

Deno.test("reviewed provider-read DAG steps use the actual Discovery schemas and reject invalid arguments", async () => {
  const contracts = [
    "supabase.project.config.auth.get",
    "gcp.compute.instances.get",
  ].map((operation) => {
    const contract = reviewedProviderCatalogue.operations.find((candidate) =>
      candidate.operation === operation
    )!;
    assert.equal(contract.is_mutation, false);
    assert.equal(contract.requires_grant, false);
    assert.equal(contract.requires_cost_approval, false);
    assert.equal(contract.sensitive, false);
    return {
      ...contract,
      operation,
      handler: "sandy-provider-operation-api",
      registry_revision: "d".repeat(64),
    };
  });
  const report = await validatePlan(
    {
      steps: [{ key: "project", operation: contracts[0].operation }, {
        key: "vm",
        operation: contracts[1].operation,
        arguments: { path: { instance: "sandy-fixture" } },
        depends_on: ["project"],
      }],
    },
    contracts,
    "api",
  );
  assert.equal(report.valid, true);
  assert.equal(report.steps.length, 2);
  assert.equal(report.provider_dry_run_performed, false);
  const invalid = await validatePlan(
    {
      steps: [{
        key: "vm",
        operation: contracts[1].operation,
        arguments: {
          path: { instance: "sandy-fixture", external_project: "unreviewed" },
        },
      }],
    },
    contracts,
    "api",
  );
  assert.equal(invalid.valid, false);
  assert.equal(invalid.blockers[0].code, "invalid_operation_arguments");
});

Deno.test("worker recognizes audited provider observations and binds their real admission without accepting asynchronous receipts", async () => {
  for (const state of ["observed", "accepted"] as const) {
    const calls: { name: string; args: ObjectValue }[] = [];
    const db: RpcClient = {
      rpc(name, args) {
        calls.push({ name, args });
        return Promise.resolve({
          error: null,
          data: name === "sandy_orch_claim"
            ? {
              ok: true,
              claims: [{ job_id: job, lease_token: lease, worker_id: worker }],
            }
            : name === "sandy_orch_attempt_receipt"
            ? { ok: true, started: true, dispatch_id: dispatch }
            : {
              ok: true,
              job_id: job,
              reused: false,
              receipt_outcome: state === "observed" ? "succeeded" : "failed",
              state: state === "observed" ? "succeeded" : "failed",
            },
        });
      },
    };
    const result = await runWorker({
      db,
      base: "https://project.supabase.co",
      service,
      fetch: (async () =>
        Response.json({
          ok: true,
          executed: true,
          admission_id: plan,
          provider_http_status: 200,
          request_state: state,
          result: { name: "sandy-fixture", status: "RUNNING" },
        })) as typeof fetch,
    }, { worker_id: worker });
    assert.equal(result.ok, true);
    assert.equal(
      calls[2].args.p_outcome,
      state === "observed" ? "succeeded" : "failed",
    );
    assert.equal(calls[2].args.p_execution_admission_id, plan);
    if (state === "accepted") assert.equal(calls[2].args.p_result, null);
  }
});
