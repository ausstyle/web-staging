import assert from "node:assert/strict";
import {
  type ApiJobIdentity,
  type ApiJobRoute,
  executeApiJobRoute,
  parseApiJobRoute,
  resolveApiJobRoute,
} from "./api_job_routes.ts";
import type { PolicyDb } from "./access_policy.ts";
const actor = "10000000-0000-4000-8000-000000000001";
const job = "10000000-0000-4000-8000-000000000002";
const credential = "10000000-0000-4000-8000-000000000003";
const approval = "10000000-0000-4000-8000-000000000004";
const source = "10000000-0000-4000-8000-000000000005";
const user: ApiJobIdentity = { kind: "user", actorId: actor, channel: "api" };
const request = (suffix = "", method = "GET", body?: unknown) =>
  new Request(
    `https://project.supabase.co/functions/v1/sandy-operation-api/v1/jobs/${job}${suffix}`,
    { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
  );
function mock(data: unknown, error: unknown = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: PolicyDb = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data, error });
    },
  };
  return { db, calls };
}
function found(
  kind: "durable" | "legacy",
  action: ApiJobRoute["action"],
  extra = {},
) {
  return {
    ok: true,
    job_id: job,
    job_kind: kind,
    operation: action === "rollback"
      ? "system.lifecycle.compensate"
      : `${kind === "durable" ? "orchestration" : "deployment"}.jobs.${action}`,
    ...extra,
  };
}
Deno.test("job URLs parse fixed methods, bounded cursors and explicit compensation approval without actor overrides", async () => {
  assert.deepEqual(await parseApiJobRoute(request()), {
    ok: true,
    value: { jobId: job, action: "get" },
  });
  assert.deepEqual(
    await parseApiJobRoute(request("/events?after=20&limit=50")),
    { ok: true, value: { jobId: job, action: "events", after: 20, limit: 50 } },
  );
  for (const action of ["cancel", "retry"] as const) {
    assert.deepEqual(
      await parseApiJobRoute(request(`:${action}`, "POST", {})),
      { ok: true, value: { jobId: job, action } },
    );
  }
  assert.deepEqual(
    await parseApiJobRoute(
      request(":rollback", "POST", { compensation_approval_id: approval }),
    ),
    {
      ok: true,
      value: {
        jobId: job,
        action: "rollback",
        compensationApprovalId: approval,
      },
    },
  );
  const rejected = [
    request("?actor_id=caller"),
    request("/events?after=9007199254740992"),
    request("/events?after=-1"),
    request("/events?after=1&after=2"),
    request("/events?limit=201"),
    request(":cancel", "POST", { actor_id: actor }),
    request(":retry", "POST", { operation: "other.provider.write" }),
    request(":rollback", "POST", {
      compensation_approval_id: approval,
      source_request_id: source,
    }),
    request(":rollback", "POST", {}),
  ];
  for (const invalid of rejected) {
    assert.equal((await parseApiJobRoute(invalid)).ok, false);
  }
  assert.deepEqual(await parseApiJobRoute(request(":cancel")), {
    ok: false,
    status: 405,
    error: "method_not_allowed",
  });
  assert.deepEqual(
    await parseApiJobRoute(new Request("https://test/v1/jobs/not-a-uuid")),
    { ok: false, status: 400, error: "invalid_job_id" },
  );
  assert.deepEqual(
    await parseApiJobRoute(new Request("https://test/v1/capabilities")),
    { ok: true, value: null },
  );
});
Deno.test("both job families select only existing canonical handlers and immutable job identifiers", async () => {
  for (const kind of ["durable", "legacy"] as const) {
    for (const action of ["get", "events", "cancel", "retry"] as const) {
      const h = mock(found(kind, action));
      const result = await resolveApiJobRoute(h.db, user, {
        jobId: job,
        action,
      });
      assert.deepEqual(result, {
        ok: true,
        value: {
          operation: `${
            kind === "durable" ? "orchestration" : "deployment"
          }.jobs.${action}`,
          arguments: { job_id: job },
          jobId: job,
          jobKind: kind,
        },
      });
      assert.deepEqual(h.calls, [{
        name: "sandy_api_resolve_job_route",
        args: {
          p_actor_id: actor,
          p_job_id: job,
          p_action: action,
          p_channel: "api",
          p_credential_id: null,
          p_allowed_operations: null,
        },
      }]);
    }
  }
});
Deno.test("key and lease contexts preserve exact operation allowlists and channel rather than widening family scope", async () => {
  const context: ApiJobIdentity = {
    ...user,
    kind: "api_key",
    channel: "mcp",
    credentialId: credential,
    allowedOperations: ["deployment.jobs.get"],
  };
  const h = mock(found("legacy", "get"));
  assert.equal(
    (await resolveApiJobRoute(h.db, context, { jobId: job, action: "get" })).ok,
    true,
  );
  assert.equal(h.calls[0].args.p_channel, "mcp");
  assert.equal(h.calls[0].args.p_credential_id, credential);
  assert.deepEqual(h.calls[0].args.p_allowed_operations, [
    "deployment.jobs.get",
  ]);
  assert.deepEqual(
    await resolveApiJobRoute(mock(found("durable", "get")).db, context, {
      jobId: job,
      action: "get",
    }),
    { ok: false, status: 404, error: "job_not_found" },
  );
  for (const action of ["cancel", "retry", "rollback"] as const) {
    const noCall = mock(found("legacy", action));
    assert.equal(
      (await resolveApiJobRoute(noCall.db, context, {
        jobId: job,
        action,
        compensationApprovalId: approval,
      })).ok,
      false,
    );
    assert.equal(noCall.calls.length, 0);
  }
  for (
    const invalid of [{ ...context, tenantId: job }, {
      ...context,
      credentialId: undefined,
    }, { ...context, allowedOperations: [] }]
  ) {
    const noCall = mock(found("legacy", "get"));
    assert.deepEqual(
      await resolveApiJobRoute(noCall.db, invalid, {
        jobId: job,
        action: "get",
      }),
      { ok: false, status: 404, error: "job_not_found" },
    );
    assert.equal(noCall.calls.length, 0);
  }
});
Deno.test("durable progress passes bounded cursor metadata while legacy cursors fail explicitly", async () => {
  const route: ApiJobRoute = {
    jobId: job,
    action: "events",
    after: 77,
    limit: 200,
  };
  const result = await resolveApiJobRoute(
    mock(found("durable", "events")).db,
    user,
    route,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.arguments, {
      job_id: job,
      after: 77,
      limit: 200,
    });
  }
  assert.deepEqual(
    await resolveApiJobRoute(mock(found("legacy", "events")).db, user, route),
    { ok: false, status: 422, error: "legacy_event_cursor_unavailable" },
  );
  assert.deepEqual(
    await resolveApiJobRoute(mock(found("legacy", "events")).db, user, {
      ...route,
      after: 0,
    }),
    { ok: false, status: 400, error: "legacy_event_limit_exceeded" },
  );
});
Deno.test("rollback uses only the server-linked snapshot request and actual separate approval", async () => {
  const route: ApiJobRoute = {
    jobId: job,
    action: "rollback",
    compensationApprovalId: approval,
  };
  const result = await resolveApiJobRoute(
    mock(found("legacy", "rollback", { source_request_id: source })).db,
    user,
    route,
  );
  assert.deepEqual(result, {
    ok: true,
    value: {
      operation: "system.lifecycle.compensate",
      arguments: {
        source_request_id: source,
        compensation_approval_id: approval,
      },
      jobId: job,
      jobKind: "legacy",
    },
  });
  assert.deepEqual(
    await resolveApiJobRoute(
      mock({
        ok: false,
        error: "job_rollback_snapshot_required",
        http_status: 424,
      }).db,
      user,
      route,
    ),
    { ok: false, status: 424, error: "job_rollback_snapshot_required" },
  );
  const missingProof = await resolveApiJobRoute(
    mock(found("durable", "rollback")).db,
    user,
    route,
  );
  assert.deepEqual(missingProof, {
    ok: false,
    status: 503,
    error: "job_routing_response_invalid",
  });
});
Deno.test("not-found, hidden and changed contracts cannot fall back to a different job family", async () => {
  for (const error of ["job_not_found", "ambiguous_job_id"]) {
    const status = error === "job_not_found" ? 404 : 409;
    assert.deepEqual(
      await resolveApiJobRoute(
        mock({ ok: false, error, http_status: status }).db,
        user,
        { jobId: job, action: "get" },
      ),
      { ok: false, status, error },
    );
  }
  for (
    const data of [
      found("legacy", "get", { job_id: actor }),
      found("legacy", "get", { arbitrary_url: "https://provider.invalid" }),
      { ok: false, error: "postgres_private_detail", http_status: 500 },
      null,
    ]
  ) {
    const result = await resolveApiJobRoute(mock(data).db, user, {
      jobId: job,
      action: "get",
    });
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes("private_detail"), false);
  }
  const wrongOperation = await resolveApiJobRoute(
    mock(found("durable", "cancel")).db,
    user,
    { jobId: job, action: "get" },
  );
  assert.deepEqual(wrongOperation, {
    ok: false,
    status: 404,
    error: "job_not_found",
  });
});
Deno.test("job routes invoke the same canonical pipeline once and preserve its exact refusal or receipt", async () => {
  let calls = 0;
  const response = await executeApiJobRoute(
    mock(found("durable", "cancel")).db,
    user,
    { jobId: job, action: "cancel" },
    async (operation, args) => {
      calls++;
      assert.equal(operation, "orchestration.jobs.cancel");
      assert.deepEqual(args, { job_id: job });
      return Response.json({
        ok: false,
        error: "operation_requires_live_verification",
        executed: false,
      }, { status: 424 });
    },
  );
  assert.equal(response.status, 424);
  assert.equal(calls, 1);
  const unknown = await executeApiJobRoute(
    mock(found("legacy", "retry")).db,
    user,
    { jobId: job, action: "retry" },
    () => {
      calls++;
      throw Error("private-provider-error");
    },
  );
  assert.equal(unknown.status, 502);
  const body = await unknown.json();
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
  assert.equal(calls, 2);
  const missing = await executeApiJobRoute(
    mock({ ok: false, error: "job_not_found", http_status: 404 }).db,
    user,
    { jobId: job, action: "get" },
    () => {
      throw Error("must not call");
    },
  );
  assert.equal(missing.status, 404);
});
