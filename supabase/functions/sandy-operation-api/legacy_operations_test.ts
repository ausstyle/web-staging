import {
  buildLegacyOperationRequest,
  executeLegacyOperation,
  isLegacyOperation,
  legacyContractMatches,
  legacyOperationContracts,
  type LegacyOperationDependencies,
  requiresLegacyUserJWT,
} from "./legacy_operations.ts";

type ObjectValue = Record<string, unknown>;
const actor = "11111111-1111-4111-8111-111111111111";
const change = "22222222-2222-4222-8222-222222222222";
const job = "33333333-3333-4333-8333-333333333333";
const other = "44444444-4444-4444-8444-444444444444";
const userToken = "test.customer.session";
const service = "test.internal.service";
const anon = "test.public.anon";
function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message = "values differ") {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}
function harness(payload: unknown = { ok: true }, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const rpcCalls: { name: string; args: ObjectValue }[] = [];
  const dependencies: LegacyOperationDependencies = {
    base: "https://project.supabase.co",
    service,
    anon,
    principal: { id: actor, role: "owner", enabled: true },
    rpc: (name, args) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: true, error: null });
    },
    fetch: ((url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(Response.json(payload, { status }));
    }) as typeof fetch,
  };
  return { dependencies, calls, rpcCalls };
}
async function body(response: Response): Promise<ObjectValue> {
  return await response.json();
}

// Exercise every admitted contract, including optional keys which could otherwise
// silently become unrestricted routing or target selectors in a thin adapter.
function example(schema: ObjectValue, field = ""): unknown {
  if(Array.isArray(schema.oneOf))return example(schema.oneOf[0],field);
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.type === "object") {
    return Object.fromEntries(
      Object.entries((schema.properties ?? {}) as ObjectValue)
        .map(([name, child]) => [name, example(child as ObjectValue, name)]),
    );
  }
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return true;
  if (schema.type === "integer") return schema.minimum ?? 1;
  if (schema.format === "uuid") return field === "job_id" ? job : change;
  if (field === "build_id") return "build-12345678";
  if (field === "function_slug") return "sandy-test-function";
  if (field === "model_id") return "test/model";
  return "x".repeat(Math.max(Number(schema.minLength ?? 1), 1));
}

Deno.test("every installed legacy contract selects a fixed application endpoint and identity", () => {
  const { dependencies } = harness();
  equal(Object.keys(legacyOperationContracts).length, 66);
  for (
    const [operation, contract] of Object.entries(legacyOperationContracts)
  ) {
    assert(isLegacyOperation(operation));
    const args = example(contract.input_schema);
    const request = buildLegacyOperationRequest(
      dependencies,
      userToken,
      operation,
      args,
    );
    if (contract.authentication === "rpc") {
      equal(request, null, operation);
      continue;
    }
    assert(request, `${operation}: valid contract example rejected`);
    equal(
      request.url,
      `${dependencies.base}/functions/v1/${contract.handler}`,
      operation,
    );
    equal(request.init.method, "POST");
    equal(request.init.redirect, "error");
    const headers = new Headers(request.init.headers);
    equal(
      headers.get("authorization"),
      `Bearer ${contract.authentication === "user" ? userToken : service}`,
    );
    equal(
      headers.get("apikey"),
      contract.authentication === "user" ? anon : service,
    );
    const sent = JSON.parse(String(request.init.body));
    equal(sent.action, contract.action, operation);
    if (operation === "github.job.reconcile") {
      equal(
        sent.reconcile_external,
        true,
      );
    }
    equal(requiresLegacyUserJWT(operation), contract.authentication === "user");
  }
  assert(!isLegacyOperation("toString"));
  assert(!isLegacyOperation("google_cloud.arbitrary_tool"));
});

Deno.test("action, owner, target, credential and reconciliation overrides are rejected before execution", async () => {
  const { dependencies, calls, rpcCalls } = harness();
  for (
    const extra of [
      { action: "create_windows" },
      { project_id: "another-tenant" },
      { target: "production" },
      { owner_id: other },
      { backend: "https://attacker.example" },
      { authorization: "Bearer injected" },
      { reconcile_external: false },
    ]
  ) {
    const response = await executeLegacyOperation(
      dependencies,
      userToken,
      "google_cloud.vm.status",
      extra,
    );
    equal(response.status, 400);
  }
  equal(calls.length, 0);
  equal(rpcCalls.length, 0);
  const oversized = await executeLegacyOperation(
    dependencies,
    userToken,
    "engineering.change.test",
    {
      change_id: change,
      test_name: "bounded evidence",
      outcome: "passed",
      evidence: { text: "x".repeat(20000) },
    },
  );
  equal(oversized.status, 400);
  equal(calls.length, 0);
});

Deno.test("disabled, non-owner and invalid principals cannot reach any backend or scope RPC", async () => {
  for (
    const principal of [
      { id: actor, role: "owner", enabled: false },
      { id: actor, role: "admin", enabled: true },
      { id: "invalid", role: "owner", enabled: true },
    ]
  ) {
    const { dependencies, calls, rpcCalls } = harness();
    dependencies.principal = principal;
    const result = await executeLegacyOperation(
      dependencies,
      userToken,
      "google_cloud.iam.runtime_prepare",
      { change_id: change },
    );
    equal(result.status, 403);
    equal((await body(result)).executed, false);
    equal(calls.length, 0);
    equal(rpcCalls.length, 0);
  }
});

Deno.test("customer-session services reject administrative and anonymous keys as customer credentials", async () => {
  const { dependencies, calls } = harness();
  for (const token of ["", service, anon, "Bearer header", "unsafe\nvalue"]) {
    const result = await executeLegacyOperation(
      dependencies,
      token,
      "engineering.models.readiness",
      {},
    );
    equal(result.status, 503);
    equal((await body(result)).executed, false);
  }
  equal(calls.length, 0);
  for (
    const base of [
      "http://project.supabase.co",
      "https://user:pass@project.supabase.co",
      "https://project.supabase.co/functions",
      "https://project.supabase.co/?override=yes",
    ]
  ) {
    equal(
      buildLegacyOperationRequest(
        { ...dependencies, base },
        userToken,
        "google_cloud.vm.status",
        {},
      ),
      null,
    );
  }
});

Deno.test("provider mutations require the exact approved change scope before internal service delegation", async () => {
  for (const mode of ["false", "error", "throw"] as const) {
    const { dependencies, calls, rpcCalls } = harness();
    dependencies.rpc = (name, args) => {
      rpcCalls.push({ name, args });
      if (mode === "throw") throw new Error(service);
      return Promise.resolve({
        data: mode === "false" ? false : true,
        error: mode === "error" ? { message: service } : null,
      });
    };
    const response = await executeLegacyOperation(
      dependencies,
      userToken,
      "google_cloud.iam.runtime_prepare",
      { change_id: change },
    );
    equal(response.status, mode === "false" ? 403 : 503);
    assert(!(await response.text()).includes(service));
    equal(calls.length, 0);
    equal(rpcCalls, [{
      name: "sandy_api_legacy_operation_scope",
      args: {
        p_actor_id: actor,
        p_change_id: change,
        p_operation: "google_cloud.iam.runtime_prepare",
      },
    }]);
  }
  const { dependencies, calls, rpcCalls } = harness({
    ok: true,
    prepared: true,
  });
  equal(
    (await executeLegacyOperation(
      dependencies,
      userToken,
      "google_cloud.iam.runtime_prepare",
      { change_id: change },
    )).status,
    200,
  );
  equal(rpcCalls.length, 1);
  equal(
    new Headers(calls[0].init.headers).get("authorization"),
    `Bearer ${service}`,
  );
});

Deno.test("engineering response adaptation preserves scoped changes and rejects cross-change job results", async () => {
  const { dependencies, calls } = harness({
    change: { id: change, status: "approved" },
  });
  const response = await executeLegacyOperation(
    dependencies,
    userToken,
    "engineering.change.status",
    { change_id: change, status: "approved" },
  );
  equal(response.status, 200);
  equal((await body(response)).ok, true);
  equal(
    new Headers(calls[0].init.headers).get("authorization"),
    `Bearer ${userToken}`,
  );
  for (
    const returned of [
      { id: job, engineering_change_id: other, status: "approved" },
      { id: other, engineering_change_id: change, status: "approved" },
      { id: job, status: "approved" },
    ]
  ) {
    const h = harness({ job: returned });
    const failed = await executeLegacyOperation(
      h.dependencies,
      userToken,
      "engineering.job.approve",
      { change_id: change, job_id: job },
    );
    equal(failed.status, 502);
    equal(
      (await body(failed)).error,
      "legacy_backend_invalid_or_unscoped_response",
    );
  }
  const foreignRegistration = harness({
    change: { id: change, requested_by: other },
  });
  const registration = example(
    legacyOperationContracts["engineering.change.register"].input_schema,
  );
  equal(
    (await executeLegacyOperation(
      foreignRegistration.dependencies,
      userToken,
      "engineering.change.register",
      registration,
    )).status,
    502,
  );
});

Deno.test("model readiness has explicit bounded results and the canary reports a real failed test", async () => {
  const ready = harness({
    policy: {},
    routes: Array.from({ length: 201 }, (_, i) => ({ id: i })),
    intelligence_readiness: [],
  });
  const response = await executeLegacyOperation(
    ready.dependencies,
    userToken,
    "engineering.models.readiness",
    {},
  );
  equal(response.status, 200);
  const result = await body(response);
  equal((result.routes as unknown[]).length, 200);
  equal(result.result_limit, 200);
  equal(result.possibly_truncated, true);
  const args = {
    change_id: change,
    model_id: "test/model",
    case_key: "simple_reasoning",
  };
  for (const functional_pass of [true, false]) {
    const h = harness({
      functional_pass,
      model_id: args.model_id,
      case_key: args.case_key,
      test_id: job,
      provider_http_status: 200,
      provider_error: service,
    });
    const canary = await executeLegacyOperation(
      h.dependencies,
      userToken,
      "engineering.models.canary",
      args,
    );
    equal(canary.status, functional_pass ? 200 : 422);
    const receipt = await body(canary);
    equal(receipt.functional_pass, functional_pass);
    if (!functional_pass) equal(receipt.error, "model_canary_failed");
    assert(!JSON.stringify(receipt).includes(service));
    equal(h.rpcCalls[0].args.p_operation, "engineering.models.canary");
  }
  const foreign = harness({
    functional_pass: true,
    model_id: "wrong/model",
    case_key: args.case_key,
  });
  equal(
    (await executeLegacyOperation(
      foreign.dependencies,
      userToken,
      "engineering.models.canary",
      args,
    )).status,
    502,
  );
});

Deno.test("read RPCs use the authenticated actor and fixed record ID and preserve missing-job failures", async () => {
  const { dependencies, calls, rpcCalls } = harness();
  dependencies.rpc = (name, args) => {
    rpcCalls.push({ name, args });
    return Promise.resolve({
      data: name === "sandy_api_legacy_cloud_targets"
        ? {
          ok: true,
          targets: [],
          result_limit: 200,
          possibly_truncated: false,
        }
        : { ok: false, error: "job_not_found", http_status: 404 },
      error: null,
    });
  };
  equal(
    (await executeLegacyOperation(dependencies, "", "cloud.targets.list", {}))
      .status,
    200,
  );
  equal(
    (await executeLegacyOperation(dependencies, "", "deployment.jobs.status", {
      job_id: job,
    })).status,
    404,
  );
  equal(rpcCalls, [
    { name: "sandy_api_legacy_cloud_targets", args: { p_actor_id: actor } },
    {
      name: "sandy_api_legacy_deployment_status",
      args: { p_actor_id: actor, p_job_id: job },
    },
  ]);
  equal(calls.length, 0);
  dependencies.rpc = () =>
    Promise.resolve({ data: { ok: true, job: { id: other } }, error: null });
  equal(
    (await executeLegacyOperation(dependencies, "", "deployment.jobs.status", {
      job_id: job,
    })).status,
    502,
  );
});

Deno.test("dispatch acceptance, unknown write outcome and malformed responses never become verified execution", async () => {
  const accepted = harness({
    ok: true,
    execution: "dispatched_unverified",
    job_id: job,
    workflow: "fixed.yml",
    verification_required: true,
  }, 202);
  const args = { change_id: change, job_id: job };
  const dispatch = await executeLegacyOperation(
    accepted.dependencies,
    userToken,
    "engineering.job.execute",
    args,
  );
  equal(dispatch.status, 202);
  const dispatchBody = await body(dispatch);
  equal(dispatchBody.execution, "dispatched_unverified");
  equal(dispatchBody.verification_required, true);
  assert(!Object.hasOwn(dispatchBody, "verified"));
  const lost = harness();
  lost.dependencies.fetch = (() => {
    throw new Error(`network lost with ${service}`);
  }) as typeof fetch;
  const unknown = await executeLegacyOperation(
    lost.dependencies,
    userToken,
    "engineering.job.execute",
    args,
  );
  equal(unknown.status, 502);
  equal(await body(unknown), {
    ok: false,
    error: "legacy_backend_outcome_unknown",
    executed: null,
    reconciliation_required: true,
  });
  const malformed = harness();
  malformed.dependencies.fetch = (() =>
    Promise.resolve(
      new Response("not json", { status: 200 }),
    )) as typeof fetch;
  const malformedResponse = await executeLegacyOperation(
    malformed.dependencies,
    userToken,
    "engineering.job.execute",
    args,
  );
  equal(malformedResponse.status, 502);
  equal((await body(malformedResponse)).reconciliation_required, true);
  const failed = harness({ ok: false, error: service });
  const failedResponse = await executeLegacyOperation(
    failed.dependencies,
    userToken,
    "engineering.job.execute",
    args,
  );
  equal(failedResponse.status, 502);
  assert(!(await failedResponse.text()).includes(service));
});

Deno.test("response scrubbing removes credentials while retaining truthful credential-presence diagnostics", async () => {
  const h = harness({
    ok: true,
    google_cloud_read: false,
    supabase_write: false,
    github_update_file_implemented: false,
    github_push_files_implemented: false,
    github_write_live_tested: false,
    executor_ready: false,
    management_credentials: { github: false, supabase: true },
    nested: [{
      access_token: "unrelated-secret",
      note: `unexpected ${service} ${anon} ${userToken}`,
      authorization: "Bearer another.token",
    }],
  });
  const response = await executeLegacyOperation(
    h.dependencies,
    userToken,
    "deployment.executor.capabilities",
    {},
  );
  equal(response.status, 200);
  const result = await body(response);
  equal(result.management_credentials, { github: false, supabase: true });
  const serialized = JSON.stringify(result);
  for (
    const credential of [
      service,
      anon,
      userToken,
      "unrelated-secret",
      "another.token",
    ]
  ) assert(!serialized.includes(credential));
});

Deno.test("contract matching preserves approval and execution scopes and classifies persisted verification as a mutation", () => {
  for (
    const operation of [
      "engineering.job.approve",
      "engineering.job.execute",
      "engineering.rollback.verify",
    ]
  ) {
    const c = legacyOperationContracts[operation];
    assert(legacyContractMatches(operation, c));
    assert(
      !legacyContractMatches(operation, {
        ...c,
        handler: "caller-picked-backend",
      }),
    );
    assert(!legacyContractMatches(operation, { ...c, is_mutation: false }));
    assert(
      !legacyContractMatches(operation, {
        ...c,
        permission_scope: "engineering:read",
      }),
    );
  }
  equal(
    legacyOperationContracts["engineering.job.approve"].permission_scope,
    "engineering:approve",
  );
  equal(
    legacyOperationContracts["engineering.job.execute"].permission_scope,
    "engineering:execute",
  );
  equal(
    legacyOperationContracts["engineering.rollback.verify"].is_mutation,
    true,
  );
});

Deno.test("service-authenticated diagnostics use a matching API key and customer routes retain their anonymous application key", async () => {
  const h = harness({ ok: true, http_status: 200, granted: [], missing: [] });
  h.dependencies.fetch =
    (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (
        headers.get("authorization") === "Bearer " + service &&
        headers.get("apikey") !== service
      ) return Response.json({ message: "Invalid JWT" }, { status: 401 });
      return Response.json({
        ok: true,
        http_status: 200,
        granted: [],
        missing: [],
      });
    }) as typeof fetch;
  const response = await executeLegacyOperation(
    h.dependencies,
    userToken,
    "video.osconfig.permissions",
    {},
  );
  assert(response.status === 200, await response.clone().text());
});

Deno.test("provider denials retain the actual bounded error while scrubbing credentials", async () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGljc2lnbmF0dXJl";
  const h = harness({
    ok: false,
    http_status: 403,
    error_status: "PERMISSION_DENIED",
    error_message: "requires osconfig.osPolicyAssignments.list; " + service +
      " Bearer " + jwt,
  }, 403);
  const response = await executeLegacyOperation(
    h.dependencies,
    userToken,
    "video.osconfig.policy_preflight",
    {},
  );
  equal(response.status, 403);
  const result = await body(response);
  equal(result.upstream_status, 403);
  assert(
    (result.upstream_error as ObjectValue).error_status === "PERMISSION_DENIED",
  );
  const text = JSON.stringify(result);
  assert(text.includes("osconfig.osPolicyAssignments.list"));
  assert(!text.includes(service));
  assert(!text.includes(jwt));
  assert(!text.includes("eyJhbGci"));
});
Deno.test('fixed IAP job variants reuse the Engineering request operation and reject arbitrary Google requests',()=>{
 const {dependencies}=harness();
 const fixed={change_id:'52d56740-59c8-4db1-b7e6-a137c7699b86',provider:'google_cloud',operation:'iap.repair.plan',target:'sandy-iap-repair:elaborate-haven-511518-a5:sandy-video+sandy-windows',idempotency_key:'fixture-iap-job-001',payload:{}};
 for(const mode of ['plan','apply','rollback']){
  const args={...fixed,operation:'iap.repair.'+mode,payload:mode==='plan'?{}:{parent_admission_id:job}};
  assert(buildLegacyOperationRequest(dependencies,userToken,'engineering.implementation.request',args));
 }
 for(const args of [{...fixed,operation:'setIamPolicy'},{...fixed,target:'other-vm'},{...fixed,payload:{url:'https://evil.invalid'}},{...fixed,change_id:change}])equal(buildLegacyOperationRequest(dependencies,userToken,'engineering.implementation.request',args),null);
 equal(Object.keys(legacyOperationContracts).length,66,'job variants must not expand operation catalogue');
});
