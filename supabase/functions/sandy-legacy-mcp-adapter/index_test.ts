import assert from "node:assert/strict";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  type ApiAuthContext,
  type ApiResult,
  createApi,
  createLegacyHandler,
  type InvokeApi,
  legacyToolNames,
} from "./index.ts";
import {
  createOperationHandler,
  type OperationDependencies,
} from "../sandy-operation-api/index.ts";

// Catalogue rows and provider replies in this suite are isolated fixtures.
// Alias coverage does not attest production exposure or authorize a mutation.
type Row = Record<string, unknown>;
const jobId = "11111111-2222-4333-8444-555555555555";
const changeId = "22222222-3333-4444-8555-666666666666";
const key = "synthetic-idempotency-key";
const version = "a".repeat(64);
const ids = [
  "deployment.jobs.get",
  "deployment.jobs.status",
  "google_cloud.vm.status",
  "google_cloud.cloud_run.status",
  "deployment.jobs.approve_read",
  "deployment.jobs.execute",
  "google_cloud.vm.bootstrap_status",
  "google_cloud.vm.service_status",
  "cloud.targets.list",
  "engineering.change.register",
  "engineering.change.status",
  "deployment.jobs.request",
  "engineering.implementation.request",
  "engineering.change.get",
  "video.install.preflight",
  "fixture.echo",
];
function entry(operation: string): Row {
  const schema: Row = {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
  if (operation === "engineering.change.status") {
    Object.assign(schema, {
      properties: {
        change_id: { type: "string", format: "uuid" },
        reason: { type: "string" },
        status: { enum: ["approved", "proposed"] },
      },
      required: ["change_id", "reason", "status"],
      additionalProperties: false,
    });
  }
  if (operation === "deployment.jobs.request") {
    Object.assign(schema, {
      properties: {
        provider: { enum: ["google_cloud", "github", "supabase"] },
        operation: { type: "string" },
        target: { type: "string" },
        idempotency_key: { type: "string", minLength: 12 },
        payload: { type: "object" },
      },
      required: ["provider", "operation", "target", "idempotency_key"],
      additionalProperties: false,
    });
  }
  if (operation === "engineering.change.get") {
    Object.assign(schema, {
      properties: { change_id: { type: "string", format: "uuid" } },
      required: ["change_id"],
      additionalProperties: false,
    });
  }
  if (operation === "fixture.echo") {
    Object.assign(schema, {
      $defs: { value: { type: "string" } },
      properties: { value: { $ref: "#/$defs/value" } },
      required: ["value"],
      additionalProperties: false,
    });
  }
  return {
    operation,
    domain: operation.split(".")[0],
    description: `Canonical fixture ${operation}`,
    api_exposed: true,
    ai_exposed: true,
    executable: true,
    verified: true,
    input_schema: schema,
    output_schema: {
      type: "object",
      properties: { ok: { const: true } },
      required: ["ok"],
    },
  };
}
function fixture(
  options: { rows?: Row[]; result?: (body: Row) => ApiResult } = {},
) {
  let rows = options.rows ?? ids.map(entry);
  let revision = version;
  const calls: { token: string; body: Row; context?: ApiAuthContext }[] = [];
  const invoke: InvokeApi = (token, body, context) => {
    calls.push({ token, body, context });
    if (body.action === "list") {
      return Promise.resolve({
        status: 200,
        result: { ok: true, operations: rows, catalogue_version: revision },
      });
    }
    if (body.action === "describe") {
      return Promise.resolve({
        status: 200,
        result: {
          ok: true,
          operation: rows.find((r) => r.operation === body.operation),
        },
      });
    }
    if (options.result) return Promise.resolve(options.result(body));
    const payload = body.operation === "cloud.targets.list"
      ? {
        ok: true,
        targets: [{ name: "synthetic-target" }],
        result_limit: 200,
        possibly_truncated: false,
      }
      : ["deployment.jobs.get", "deployment.jobs.status"].includes(
          String(body.operation),
        )
      ? {
        ok: true,
        job: {
          id: jobId,
          status: "succeeded",
          ...(body.operation === "deployment.jobs.status"
            ? {
              external_deployment_evidence: {
                event_type: "external_deployment_observed",
              },
              worker_execution_status: "not_executed",
              requires_reconciliation: true,
            }
            : {}),
        },
      }
      : {
        ok: true,
        operation: body.operation,
        echoed_arguments: body.arguments,
      };
    return Promise.resolve({
      status: 200,
      result: {
        ok: true,
        operation: body.operation,
        executed: true,
        result: payload,
      },
    });
  };
  const handler = createLegacyHandler(invoke, {
    resource: "https://sandy.fixture.invalid/functions/v1/sandy-operations-mcp",
    issuer: "https://sandy.fixture.invalid/auth/v1",
  });
  const request = (
    method: string,
    params: Row = {},
    headers: Record<string, string> = {},
  ) =>
    handler(
      new Request(
        "https://sandy.fixture.invalid/functions/v1/sandy-operations-mcp",
        {
          method: "POST",
          headers: {
            authorization: "Bearer fixture.user.jwt",
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "fixture",
            method,
            params,
          }),
        },
      ),
    );
  return {
    calls,
    request,
    handler,
    replace(next: Row[], hash: string) {
      rows = next;
      revision = hash;
    },
  };
}
const text = (body: Row) =>
  JSON.parse((body.result as { content: { text: string }[] }).content[0].text);

Deno.test("legacy adapter discovers canonical schemas and all 16 compatibility aliases dynamically", async () => {
  const f = fixture();
  const body = await (await f.request("tools/list")).json();
  const tools = body.result.tools as Row[];
  for (const name of legacyToolNames) {
    assert.ok(tools.some((tool) => tool.name === name), name);
  }
  const canonical = tools.find((tool) => tool.name === "fixture.echo")!;
  assert.deepEqual(canonical.inputSchema, entry("fixture.echo").input_schema);
  assert.deepEqual(canonical.outputSchema, entry("fixture.echo").output_schema);
  assert.deepEqual(
    tools.find((tool) => tool.name === "engineering_change_register")!
      .inputSchema,
    entry("engineering.change.register").input_schema,
  );
  const approval = tools.find((tool) =>
    tool.name === "engineering_change_approve"
  )!.inputSchema as Row;
  assert.deepEqual(approval.required, ["change_id", "reason"]);
  assert.equal("status" in (approval.properties as Row), false);
  const worker = tools.find((tool) => tool.name === "vm_install_worker")!
    .inputSchema as Row;
  assert.deepEqual(worker.required, ["idempotency_key"]);
  assert.deepEqual(Object.keys(worker.properties as Row), ["idempotency_key"]);
  assert.equal(body.result._meta.sandy_catalogue_version, version);
  assert.deepEqual(body.result._meta.sandy_compatibility_gaps, []);
  const ajv = new Ajv({ strict: true, validateFormats: true });
  for (const [name, format] of Object.entries(fullFormats)) {
    ajv.addFormat(name, format);
  }
  for (const tool of tools) ajv.compile(tool.inputSchema as object);
  const execute = ajv.compile(
    tools.find((tool) => tool.name === "operations_execute")!
      .inputSchema as object,
  );
  assert.equal(
    execute({ operation: "fixture.echo", arguments: { value: "valid" } }),
    true,
  );
  assert.equal(
    execute({ operation: "fixture.echo", arguments: { value: 12 } }),
    false,
  );
});

Deno.test("every legacy alias routes through discovery or canonical execution with the actual user token", async () => {
  const cases: [string, Row, string | null, Row?][] = [
    ["operations_list", { domain: "engineering", limit: 2 }, null],
    ["operations_describe", { operation: "engineering.change.get" }, null],
    ["operations_status", { job_id: jobId }, "deployment.jobs.get"],
    [
      "operations_execute",
      { operation: "video.install.preflight", arguments: {} },
      "video.install.preflight",
      {},
    ],
    ["deployment_status", { job_id: jobId }, "deployment.jobs.status"],
    ["cloud_vm_status", {}, "google_cloud.vm.status"],
    ["cloud_run_status", {}, "google_cloud.cloud_run.status"],
    [
      "deployment_approve_read",
      { job_id: jobId },
      "deployment.jobs.approve_read",
    ],
    ["deployment_execute", { job_id: jobId }, "deployment.jobs.execute"],
    ["vm_bootstrap_status", {}, "google_cloud.vm.bootstrap_status"],
    ["vm_service_status", {}, "google_cloud.vm.service_status"],
    ["vm_install_worker", { idempotency_key: key }, "deployment.jobs.request", {
      provider: "google_cloud",
      operation: "install_worker",
      target: "sandy-deploy",
      payload: { installer: "restricted_deployment_worker_v1" },
      idempotency_key: key,
    }],
    ["cloud_targets", {}, "cloud.targets.list"],
    ["engineering_change_register", {
      title: "Synthetic fixture",
      idempotency_key: key,
    }, "engineering.change.register"],
    [
      "engineering_change_approve",
      { change_id: changeId, reason: "Synthetic fixture approval" },
      "engineering.change.status",
      {
        change_id: changeId,
        reason: "Synthetic fixture approval",
        status: "approved",
      },
    ],
    [
      "deployment_request",
      {
        provider: "google_cloud",
        operation: "get_vm",
        target: "synthetic-target",
        idempotency_key: key,
      },
      "deployment.jobs.request",
      {
        provider: "google_cloud",
        operation: "get_vm",
        target: "synthetic-target",
        idempotency_key: key,
        payload: {},
      },
    ],
  ];
  assert.deepEqual(
    new Set(cases.map(([name]) => name)),
    new Set(legacyToolNames),
  );
  for (const [name, args, operation, translated] of cases) {
    const f = fixture();
    const body =
      await (await f.request("tools/call", { name, arguments: args })).json();
    assert.equal(body.result.isError, false, name);
    assert.ok(f.calls.every((call) => call.token === "fixture.user.jwt"));
    const executions = f.calls.filter((call) => call.body.action === "execute");
    if (operation) {
      assert.deepEqual(executions.map((call) => call.body), [{
        action: "execute",
        channel: "mcp",
        operation,
        arguments: translated ?? args,
      }]);
    } else assert.equal(executions.length, 0);
    if (name === "cloud_targets") {
      assert.deepEqual(text(body), [{ name: "synthetic-target" }]);
    }
    if (name === "deployment_status") {
      assert.equal(text(body).requires_reconciliation, true);
    }
    if (name === "operations_list") {
      assert.equal(text(body).count, 2);
      assert.equal(
        text(body).catalogue_scope,
        "caller_authorized_executable_mcp_operations",
      );
      assert.ok(
        text(body).unavailable_metadata.includes("edge_function_inventory"),
      );
    }
  }
});

Deno.test("legacy deployment request forms translate fixed Engineering Control context without direct execution", async () => {
  const cases: [Row, string, Row][] = [
    [
      {
        provider: "supabase",
        operation: "register_change",
        target: "sandy-engineering-control",
        idempotency_key: key,
        payload: { title: "Synthetic fixture" },
      },
      "engineering.change.register",
      { title: "Synthetic fixture", idempotency_key: key },
    ],
    [
      {
        provider: "supabase",
        operation: "approve_change",
        target: "sandy-engineering-control",
        idempotency_key: key,
        payload: { change_id: changeId, reason: "Synthetic fixture" },
      },
      "engineering.change.status",
      { change_id: changeId, reason: "Synthetic fixture", status: "approved" },
    ],
    [
      {
        provider: "supabase",
        operation: "get_change",
        target: "sandy-engineering-control",
        idempotency_key: key,
        payload: { change_id: changeId },
      },
      "engineering.change.get",
      { change_id: changeId },
    ],
    [
      {
        provider: "github",
        operation: "update_file",
        target: "synthetic-target",
        idempotency_key: key,
        payload: { engineering_change_id: changeId, synthetic: true },
      },
      "engineering.implementation.request",
      {
        change_id: changeId,
        provider: "github",
        operation: "update_file",
        target: "synthetic-target",
        idempotency_key: key,
        payload: { engineering_change_id: changeId, synthetic: true },
      },
    ],
  ];
  for (const [args, operation, expected] of cases) {
    const f = fixture();
    const body = await (await f.request("tools/call", {
      name: "deployment_request",
      arguments: args,
    })).json();
    assert.equal(body.result.isError, false);
    assert.deepEqual(f.calls.at(-1)!.body, {
      action: "execute",
      channel: "mcp",
      operation,
      arguments: expected,
    });
  }
  for (
    const [name, args] of [
      ["engineering_change_approve", {
        change_id: changeId,
        reason: "Synthetic fixture",
        status: "proposed",
      }],
      ["vm_install_worker", { idempotency_key: key, target: "other-target" }],
      ["deployment_request", {
        provider: "supabase",
        operation: "approve_change",
        target: "sandy-engineering-control",
        idempotency_key: key,
        payload: { change_id: changeId, action: "execute_job" },
      }],
    ]
  ) {
    const f = fixture();
    assert.equal(
      (await f.request("tools/call", { name, arguments: args })).status,
      400,
    );
    assert.equal(
      f.calls.filter((call) => call.body.action === "execute").length,
      0,
    );
  }
});

Deno.test("disabled or missing canonical capabilities report explicit gaps and cannot fall back to privileged handlers", async () => {
  const f = fixture({
    rows: ids.map((name) => ({
      ...entry(name),
      ...(name === "deployment.jobs.get"
        ? { ai_exposed: false }
        : name === "deployment.jobs.request"
        ? { executable: false }
        : name === "engineering.change.status"
        ? { api_exposed: false }
        : {}),
    })),
  });
  const listed = await (await f.request("tools/list")).json();
  const tools = listed.result.tools as Row[];
  for (
    const name of [
      "operations_status",
      "vm_install_worker",
      "engineering_change_approve",
    ]
  ) {
    assert.equal(tools.some((tool) => tool.name === name), false);
    assert.ok(
      listed.result._meta.sandy_compatibility_gaps.some((gap: Row) =>
        gap.name === name && gap.reason === "canonical_operation_unavailable"
      ),
    );
    const body = await (await f.request("tools/call", {
      name,
      arguments: name === "vm_install_worker"
        ? { idempotency_key: key }
        : { job_id: jobId },
    })).json();
    assert.equal(body.result.isError, true);
    assert.equal(text(body).error, "canonical_operation_unavailable");
    assert.equal(text(body).executed, false);
  }
  const unknown =
    await (await f.request("tools/call", { name: "unregistered.operation" }))
      .json();
  assert.equal(text(unknown).error, "canonical_operation_unavailable");
  assert.equal(f.calls.some((call) => call.body.action === "execute"), false);
});

Deno.test("catalogue refresh changes schemas and version metadata before each invocation", async () => {
  const f = fixture();
  const first = await (await f.request("tools/list")).json();
  const changed = entry("fixture.echo");
  changed.input_schema = {
    type: "object",
    properties: { count: { type: "integer" } },
    required: ["count"],
  };
  f.replace([changed], "b".repeat(64));
  const next = await (await f.request("tools/list", {
    _meta: {
      sandy_catalogue_version: first.result._meta.sandy_catalogue_version,
    },
  })).json();
  assert.equal(next.result._meta.sandy_catalogue_changed, true);
  assert.equal(next.result._meta.sandy_catalogue_version, "b".repeat(64));
  assert.deepEqual(
    next.result.tools.find((tool: Row) => tool.name === "fixture.echo")
      .inputSchema,
    changed.input_schema,
  );
  const denied =
    await (await f.request("tools/call", { name: "cloud_vm_status" })).json();
  assert.equal(text(denied).operation, "google_cloud.vm.status");
  assert.equal(
    f.calls.filter((call) => call.body.action === "execute").length,
    0,
  );
});

Deno.test("API failures and ambiguous or rejected admissions remain errors; recorded admission preserves nonexecution", async () => {
  const cases: [ApiResult, boolean][] = [
    [{
      status: 200,
      result: { ok: false, executed: true, error: "provider_denied" },
    }, true],
    [{
      status: 503,
      result: {
        ok: false,
        executed: null,
        accepted: null,
        error: "outcome_unknown",
      },
    }, true],
    [{
      status: 200,
      result: {
        ok: true,
        executed: true,
        result: { ok: true, accepted: false },
      },
    }, true],
    [{
      status: 202,
      result: {
        ok: true,
        accepted: true,
        executed: false,
        request_state: "recorded",
        source_job_id: changeId,
        retry_job_id: jobId,
        retry_job_status: "approved",
        retry_depth: 1,
        reused: false,
        dispatch_required: true,
      },
    }, false],
    [{
      status: 202,
      result: {
        ok: true,
        accepted: true,
        executed: false,
        job_id: jobId,
        state: "pending_approval",
        reused: false,
        dispatch_required: false,
      },
    }, false],
    [
      { status: 202, result: { ok: true, accepted: true, executed: false } },
      true,
    ],
    [{ status: 200, result: { ok: true, executed: true } }, true],
  ];
  for (const [result, expectedError] of cases) {
    const f = fixture({ result: () => result });
    const body = await (await f.request("tools/call", {
      name: "operations_execute",
      arguments: { operation: "fixture.echo", arguments: { value: "test" } },
    })).json();
    assert.equal(body.result.isError, expectedError);
    assert.deepEqual(body.result._meta.sandy_api, result);
    if (!expectedError) {
      assert.equal(body.result.structuredContent.executed, false);
      assert.ok(
        text(body).request_state === "recorded" ||
          text(body).state === "pending_approval",
      );
    }
  }
});

Deno.test("private API key context is forwarded only to canonical API beside its public platform authorization", async () => {
  const f = fixture();
  const response = await f.request("tools/call", {
    name: "operations_execute",
    arguments: { operation: "fixture.echo", arguments: { value: "test" } },
  }, {
    authorization: "Bearer fixture.public.anon.jwt",
    "x-sandy-api-key": "fixture-private-scoped-key",
  });
  assert.equal(response.status, 200);
  assert.ok(
    f.calls.every((call) =>
      call.token === "fixture.public.anon.jwt" &&
      call.context?.apiKey === "fixture-private-scoped-key"
    ),
  );
  assert.equal(
    (await response.text()).includes("fixture-private-scoped-key"),
    false,
  );
  assert.equal(
    (await f.request("tools/list", {}, { "x-sandy-api-key": "" })).status,
    401,
  );
  const requests: Request[] = [];
  const api = createApi(
    "https://sandy.fixture.invalid",
    "fixture-anon-key",
    (async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ ok: true });
    }) as typeof fetch,
  );
  await api("fixture.public.anon.jwt", { action: "list" }, {
    apiKey: "fixture-private-scoped-key",
  });
  assert.equal(
    requests[0].url,
    "https://sandy.fixture.invalid/functions/v1/sandy-operation-api",
  );
  assert.equal(
    requests[0].headers.get("authorization"),
    "Bearer fixture.public.anon.jwt",
  );
  assert.equal(
    requests[0].headers.get("x-sandy-api-key"),
    "fixture-private-scoped-key",
  );
  assert.equal(requests[0].redirect, "error");
});

Deno.test("health, OAuth metadata and malformed RPC/auth boundaries cannot execute operations", async () => {
  const f = fixture();
  const health = await f.handler(
    new Request("https://sandy.fixture.invalid?health=1"),
  );
  assert.equal((await health.json()).execution, "sandy-api-only");
  const metadata = await f.handler(
    new Request(
      "https://sandy.fixture.invalid/.well-known/oauth-protected-resource",
    ),
  );
  assert.equal(
    (await metadata.json()).authorization_servers[0],
    "https://sandy.fixture.invalid/auth/v1",
  );
  assert.equal(
    (await f.handler(
      new Request("https://sandy.fixture.invalid", {
        method: "POST",
        body: "{}",
      }),
    )).status,
    401,
  );
  for (
    const body of [
      "not-json",
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "deployment_execute", arguments: { job_id: jobId } },
      }),
      " ".repeat(65537),
    ]
  ) {
    const response = await f.handler(
      new Request("https://sandy.fixture.invalid", {
        method: "POST",
        headers: { authorization: "Bearer fixture.user.jwt" },
        body,
      }),
    );
    assert.ok([400, 413].includes(response.status));
  }
  assert.equal(f.calls.length, 0);
});

Deno.test("legacy generic schemas preserve absolute self references, nested resources and literal instance annotations", async () => {
  const schema = {
    $id: "https://schema.fixture.invalid/echo",
    type: "object",
    $defs: {
      text: { type: "string", minLength: 2 },
      nested: {
        $id: "inner",
        type: "object",
        properties: {
          value: { $ref: "https://schema.fixture.invalid/echo#/$defs/text" },
        },
        required: ["value"],
        additionalProperties: false,
      },
    },
    properties: {
      value: { $ref: "https://schema.fixture.invalid/echo#/$defs/text" },
      nested: { $ref: "inner" },
      literal: {
        const: {
          $id: "literal-instance-id",
          $ref: "literal-instance-reference",
        },
      },
    },
    required: ["value", "nested", "literal"],
    additionalProperties: false,
  };
  const f = fixture({
    rows: [{ ...entry("fixture.echo"), input_schema: schema }],
  });
  const tools = (await (await f.request("tools/list")).json()).result
    .tools as Row[];
  assert.deepEqual(
    tools.find((tool) => tool.name === "fixture.echo")!.inputSchema,
    schema,
  );
  const source = new Ajv({ strict: true }).compile(schema);
  const translated = new Ajv({ strict: true }).compile(
    tools.find((tool) => tool.name === "operations_execute")!
      .inputSchema as object,
  );
  const valid = {
    value: "valid",
    nested: { value: "valid" },
    literal: { $id: "literal-instance-id", $ref: "literal-instance-reference" },
  };
  for (
    const args of [valid, { ...valid, value: 1 }, {
      ...valid,
      nested: { value: "x" },
    }, {
      ...valid,
      literal: { $id: "changed", $ref: "literal-instance-reference" },
    }]
  ) {
    assert.equal(
      translated({ operation: "fixture.echo", arguments: args }),
      source(args),
    );
  }
});

Deno.test("legacy deployment schemas retain canonical implementation constraints and omit unavailable rerouted forms", async () => {
  const implementation = {
    ...entry("engineering.implementation.request"),
    input_schema: {
      type: "object",
      properties: {
        change_id: { type: "string", format: "uuid" },
        provider: { const: "github" },
        operation: { const: "update_file" },
        target: { const: "approved-target" },
        idempotency_key: { type: "string", minLength: 12 },
        payload: { type: "object", maxProperties: 3 },
      },
      required: [
        "change_id",
        "provider",
        "operation",
        "target",
        "idempotency_key",
      ],
      additionalProperties: false,
    },
  };
  const f = fixture({ rows: [implementation] });
  const tools = (await (await f.request("tools/list")).json()).result
    .tools as Row[];
  const ajv = new Ajv({ strict: true });
  for (const [name, format] of Object.entries(fullFormats)) {
    ajv.addFormat(name, format);
  }
  const validate = ajv.compile(
    tools.find((tool) => tool.name === "deployment_request")!
      .inputSchema as object,
  );
  const valid = {
    provider: "github",
    operation: "update_file",
    target: "approved-target",
    idempotency_key: key,
    payload: { engineering_change_id: changeId, synthetic: true },
  };
  assert.equal(validate(valid), true);
  for (
    const args of [
      { ...valid, provider: "supabase" },
      { ...valid, operation: "unsupported" },
      { ...valid, target: "unapproved" },
      { ...valid, idempotency_key: "x" },
      {
        ...valid,
        payload: { engineering_change_id: changeId, a: 1, b: 2, c: 3 },
      },
    ]
  ) assert.equal(validate(args), false);
  const generic = fixture({ rows: [entry("deployment.jobs.request")] });
  const genericTools = (await (await generic.request("tools/list")).json())
    .result.tools as Row[];
  const available = ajv.compile(
    genericTools.find((tool) => tool.name === "deployment_request")!
      .inputSchema as object,
  );
  assert.equal(
    available({ ...valid, provider: "google_cloud", operation: "get_vm" }),
    true,
  );
  assert.equal(
    available(valid),
    false,
    "GitHub writes require the missing engineering implementation contract",
  );
  assert.equal(
    available({
      ...valid,
      provider: "supabase",
      operation: "approve_change",
      target: "sandy-engineering-control",
    }),
    false,
  );
});

Deno.test("lost canonical execution responses report an unknown outcome without retrying or claiming nonexecution", async () => {
  const calls: Row[] = [];
  const handler = createLegacyHandler(async (_token, body) => {
    calls.push(body);
    if (body.action === "list") {
      return {
        status: 200,
        result: {
          ok: true,
          operations: [entry("deployment.jobs.execute")],
          catalogue_version: version,
        },
      };
    }
    throw new TypeError("private-fixture-error-never-exposed");
  });
  const response = await handler(
    new Request("https://mcp.fixture.invalid", {
      method: "POST",
      headers: { authorization: "Bearer fixture.user.jwt" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "deployment_execute", arguments: { job_id: jobId } },
      }),
    }),
  );
  const body = await response.json();
  assert.equal(body.result.isError, true);
  assert.deepEqual(text(body), {
    ok: false,
    error: "sandy_api_outcome_unknown",
    operation: "deployment.jobs.execute",
    executed: null,
    reconciliation_required: true,
  });
  assert.deepEqual(calls.map((call) => call.action), ["list", "execute"]);
  assert.equal(JSON.stringify(body).includes("private-fixture-error"), false);
});

Deno.test("legacy adapter composes with the real Sandy API gateway and retains independent owner authorization", async () => {
  for (const role of ["owner", "administrator"]) {
    const backend: Request[] = [], identities: string[] = [];
    const registered = {
      ...entry("video.install.preflight"),
      handler: "sandy-deploy-provision",
      permission_scope: "infrastructure:read",
      is_mutation: false,
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    };
    const db = {
      auth: {
        getUser(token: string) {
          identities.push(token);
          return Promise.resolve({
            data: { user: { id: changeId } },
            error: null,
          });
        },
      },
      from(table: string) {
        let rows: Row[] = table === "sandy_operation_registry"
          ? [registered]
          : [{ role, enabled: true, auth_user_id: changeId }];
        const q = {
          select: (_: string) => q,
          eq(key: string, value: unknown) {
            rows = rows.filter((r) => r[key] === value);
            return q;
          },
          in(key: string, values: unknown[]) {
            rows = rows.filter((r) => values.includes(r[key]));
            return q;
          },
          order: (_: string) => q,
          maybeSingle: () =>
            Promise.resolve({ data: rows[0] ?? null, error: null }),
          then(
            resolve: (value: unknown) => unknown,
            reject?: (reason: unknown) => unknown,
          ) {
            return Promise.resolve({ data: rows, error: null }).then(
              resolve,
              reject,
            );
          },
        };
        return q;
      },
    } as unknown as OperationDependencies["db"];
    const gateway = createOperationHandler({
      base: "https://sandy.fixture.invalid",
      service: "fixture-internal-service",
      anon: "fixture-anon",
      db,
      fetch: (async (input, init) => {
        backend.push(new Request(input, init));
        return Response.json({
          ok: true,
          installation_authorized: false,
          livekit_verified: false,
        });
      }) as typeof fetch,
    });
    const api = createApi(
      "https://sandy.fixture.invalid",
      "fixture-anon",
      ((input, init) => gateway(new Request(input, init))) as typeof fetch,
    );
    const legacy = createLegacyHandler(api);
    const result = await (await legacy(
      new Request("https://mcp.fixture.invalid", {
        method: "POST",
        headers: { authorization: "Bearer fixture.real.user.jwt" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "operations_execute",
            arguments: {
              operation: "video.install.preflight",
              arguments: {},
            },
          },
        }),
      }),
    )).json();
    assert.ok(identities.every((token) => token === "fixture.real.user.jwt"));
    assert.equal(result.result.isError, role !== "owner");
    assert.equal(backend.length, role === "owner" ? 1 : 0);
    if (backend.length) {
      assert.equal(
        backend[0].url,
        "https://sandy.fixture.invalid/functions/v1/sandy-deploy-provision",
      );
      assert.equal(
        backend[0].headers.get("authorization"),
        "Bearer fixture-internal-service",
      );
      assert.deepEqual(await backend[0].json(), {
        action: "video_install_preflight",
      });
    }
  }
});
