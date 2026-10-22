import { strict as assert } from "node:assert";
import {
  type EngineeringDependencies,
  engineeringFixtureArguments,
  engineeringPolicy,
  engineeringProofFor,
  engineeringRequest,
  engineeringVmReadPolicy,
} from "./engineering_identity.ts";
import { AjvJsonSchemaValidator } from "npm:@modelcontextprotocol/sdk@1.32.1/validation/ajv";
import { gapContracts } from "../sandy-provider-gap-api/contracts.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
const MACHINE = "10000000-0000-4000-8000-000000000001",
  OWNER = "10000000-0000-4000-8000-000000000002",
  SESSION = "10000000-0000-4000-8000-000000000003",
  APPROVAL = "10000000-0000-4000-8000-000000000004";
const user = {
  id: MACHINE,
  app_metadata: { sandy_engineering_test: true, sandy_engineering_epoch: 1 },
};
const token = (patch: Record<string, unknown> = {}) =>
  "verified-by-caller." +
  btoa(
    JSON.stringify({
      sub: MACHINE,
      aud: "authenticated",
      role: "authenticated",
      session_id: SESSION,
      exp: Date.now() / 1000 + 3600,
      app_metadata: user.app_metadata,
      ...patch,
    }),
  ) + ".signature";
const fileArgs = {
  path: { path: engineeringPolicy.github_path },
  body: {
    branch: engineeringPolicy.github_branch,
    sha: "a".repeat(40),
    content: btoa("Sandy engineering fixture machine verified\n"),
    message: "Sandy machine fixture",
  },
};
const msg = (operation = "github.files.update", args: unknown = fileArgs) => ({
  action: "execute",
  channel: "mcp",
  operation,
  arguments: args,
});
const req = (body: unknown = msg(), headers: Record<string, string> = {}) =>
  new Request("https://project.invalid/functions/v1/sandy-operation-api", {
    method: "POST",
    headers: { authorization: "Bearer actual.verified.workload", ...headers },
    body: JSON.stringify(body),
  });
async function harness(patch: Partial<EngineeringDependencies> = {}) {
  const state = {
    rpc: [] as { name: string; args: Record<string, unknown> }[],
    delegated: 0,
    proof: undefined as unknown,
    headers: new Headers(),
    resolved: {
      ok: true,
      identity_user_id: MACHINE,
      owner_authority_id: OWNER,
      session_id: SESSION,
      credential_epoch: 1,
      policy_sha256: await argumentDigest(engineeringPolicy),
      operations: engineeringPolicy.operations,
    },
  };
  const deps: EngineeringDependencies = {
    db: {
      rpc: async (name, args) => {
        state.rpc.push({ name, args });
        return {
          data: name === "sandy_engineering_resolve_identity"
            ? state.resolved
            : { ok: true, approval_id: APPROVAL },
          error: null,
        };
      },
    },
    entry: async (operation) => ({
      operation,
      api_exposed: true,
      ai_exposed: true,
      verified: true,
      error_contract: { contract_sha256: "b".repeat(64) },
      input_schema: { type: "object" },
    }),
    contractMatches: () => true,
    argumentsValid: () => true,
    delegate: async (request, credential) => {
      state.delegated++;
      state.proof = engineeringProofFor(credential);
      state.headers = request.headers;
      return Response.json({ ok: true, result: { ok: true } });
    },
    ...patch,
  };
  return {
    state,
    call: (request = req(), claims = token()) =>
      engineeringRequest(deps, request, user, claims),
  };
}
async function standingHarness(
  active = true,
  refuse = false,
  owns = true,
  inactiveReason?: string,
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const h = await harness({
    executionScope: () => ({
      provider: "github",
      repository: "ausstyle/web-staging",
    }),
    entry: async (operation) => ({
      operation,
      api_exposed: true,
      ai_exposed: true,
      verified: false,
      error_contract: { contract_sha256: "b".repeat(64) },
      input_schema: { type: "object" },
    }),
    db: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return {
          error: null,
          data: name === "sandy_engineering_resolve_identity"
            ? {
              ok: true,
              identity_user_id: MACHINE,
              owner_authority_id: OWNER,
              session_id: SESSION,
              credential_epoch: 1,
              policy_sha256: await argumentDigest(engineeringPolicy),
              operations: engineeringPolicy.operations,
            }
            : name === "sandy_engineering_resolve_standing"
            ? {
              ok: active,
              ...(inactiveReason
                ? { policy_present: true, error: inactiveReason }
                : {}),
              identity_user_id: MACHINE,
              owner_authority_id: OWNER,
              session_id: SESSION,
              delegation_id: APPROVAL,
              version: 1,
              expires_at: new Date(Date.now() + 60000).toISOString(),
              operations: [
                "github.repos.get",
                "github.files.update",
                "github.git.trees.create",
                "github.git.blobs.create",
                "system.execution.get",
              ],
            }
            : name === "sandy_engineering_owns_execution"
            ? { ok: true, owned: owns }
            : refuse
            ? {
              ok: false,
              http_status: 403,
              error: "engineering_policy_blocked",
            }
            : {
              ok: true,
              authorization_id: APPROVAL,
              authorization_state: "authorized_by_policy",
            },
        };
      },
    },
  });
  return { ...h, calls };
}
Deno.test("standing authorization reaches the same canonical delegate with policy evidence, not a fabricated approval", async () => {
  const h = await standingHarness(),
    response = await h.call(req(msg("github.repos.get", {})));
  assert.equal(response.status, 200);
  assert.equal(h.state.delegated, 1);
  assert.ok(
    h.calls.some((c) =>
      c.name === "sandy_engineering_prepare_delegated" &&
      c.args.p_canonical_scope ===
        '{"provider":"github","repository":"ausstyle/web-staging"}'
    ),
  );
  assert.equal(
    h.calls.some((c) => c.name === "sandy_engineering_prepare_execution"),
    false,
  );
  assert.deepEqual(
    (h.state.proof as { standingOperations: string[] }).standingOperations,
    [
      "github.repos.get",
      "github.files.update",
      "github.git.trees.create",
      "github.git.blobs.create",
      "system.execution.get",
    ],
  );
});
Deno.test("inactive or policy-refused standing authority cannot use the old fixture grant for broader execution", async () => {
  for (const [active, refuse] of [[false, false], [true, true]]) {
    const h = await standingHarness(active, refuse),
      response = await h.call(req(msg("github.repos.get", {})));
    assert.equal(response.status, 403);
    assert.equal(h.state.delegated, 0);
  }
});
Deno.test("credential material cannot be committed through standing source execution", async () => {
  const h = await standingHarness();
  const response = await h.call(
    req(
      msg("github.files.update", {
        ...fileArgs,
        body: {
          ...fileArgs.body,
          content: btoa(
            JSON.stringify({
              client_secret:
                "synthetic-private-material-that-must-not-be-published",
            }),
          ),
        },
      }),
    ),
  );
  assert.equal(response.status, 403);
  assert.equal(h.state.delegated, 0);
  assert.equal(
    h.calls.some((c) => c.name === "sandy_engineering_prepare_delegated"),
    false,
  );
});
Deno.test("verified workload gets only an explicit scoped delegation with immutable exact approval headers", async () => {
  const h = await harness(), r = await h.call();
  assert.equal(r.status, 200);
  assert.equal(h.state.delegated, 1);
  assert.deepEqual(h.state.proof, {
    machineUserId: MACHINE,
    ownerId: OWNER,
    sessionId: SESSION,
    epoch: 1,
    policySha256: await argumentDigest(engineeringPolicy),
  });
  assert.equal(
    h.state.headers.get("authorization"),
    "Bearer actual.verified.workload",
  );
  assert.equal(h.state.headers.get("x-sandy-approval-id"), APPROVAL);
  assert.equal(
    h.state.rpc[1].args.p_input_sha256,
    await argumentDigest(fileArgs),
  );
});
Deno.test("serialized or caller-invented delegated credentials cannot carry trusted proof", () => {
  assert.equal(
    engineeringProofFor({
      kind: "job_lease",
      principalId: OWNER,
      allowedOperations: engineeringPolicy.operations,
    }),
    undefined,
  );
});
Deno.test("wrong-subject, expired, stale-epoch and invalid-role claims fail before policy or provider execution", async () => {
  for (
    const claims of [
      { sub: OWNER },
      { exp: 0 },
      { role: "service_role" },
      { aud: "service_role" },
      { session_id: "bad" },
      {
        app_metadata: {
          sandy_engineering_test: true,
          sandy_engineering_epoch: 2,
        },
      },
    ]
  ) {
    const h = await harness();
    assert.equal((await h.call(req(), token(claims))).status, 401);
    assert.equal(h.state.rpc.length, 0);
    assert.equal(h.state.delegated, 0);
  }
});
Deno.test("revoked, different-policy and unauthorized owner authorities cannot be used", async () => {
  for (
    const patch of [
      { ok: false },
      { owner_authority_id: null },
      { policy_sha256: "wrong" },
      { identity_user_id: OWNER },
      { session_id: OWNER },
      { operations: ["supabase.projects.delete"] },
    ]
  ) {
    const h = await harness();
    Object.assign(h.state.resolved, patch);
    assert.equal((await h.call()).status, 403);
    assert.equal(h.state.delegated, 0);
  }
});
Deno.test("credential administration, Controller approval and unrelated provider operations are outside the workload grant", async () => {
  for (
    const operation of [
      "engineering.job.approve",
      "system.credentials.issue",
      "supabase.projects.delete",
      "gcp.compute.instances.delete",
    ]
  ) {
    const h = await harness();
    assert.equal((await h.call(req(msg(operation, {})))).status, 403);
    assert.equal(
      h.state.rpc.filter((c) =>
        c.name !== "sandy_engineering_record_policy_denial"
      ).length,
      1,
    );
    assert.equal(h.state.delegated, 0);
  }
});
Deno.test("production branch, other files, arbitrary SQL, other secrets and unreviewed function source are denied", () => {
  const checks: [string, unknown][] = [
    ["github.files.update", {
      ...fileArgs,
      body: { ...fileArgs.body, branch: "main" },
    }],
    ["github.files.update", {
      ...fileArgs,
      path: { path: "supabase/functions/sandy-operation-api/index.ts" },
    }],
    ["supabase.db.migrations.apply", {
      body: { query: "DROP TABLE public.email_customers;" },
    }],
    ["supabase.functions.secrets.set", {
      body: [{
        name: "SANDY_SUPABASE_MANAGEMENT_TOKEN",
        value: "isolated-noncredential-test",
      }],
    }],
    ["supabase.deploy_edge_function", {
      project_id: engineeringPolicy.project_ref,
      slug: engineeringPolicy.function_slug,
      name: engineeringPolicy.function_slug,
      verify_jwt: true,
      entrypoint_path: "index.ts",
      files: [{ path: "index.ts", sha256: "f".repeat(64) }],
    }],
    ["supabase.logs.query", {
      source: "auth_logs",
      start: "2026-10-21T00:00:00Z",
      end: "2026-10-21T00:01:00Z",
    }],
  ];
  for (const [operation, args] of checks) {
    assert.equal(
      engineeringFixtureArguments(operation, args),
      false,
      operation,
    );
  }
});
Deno.test("fixed reversible migration, reviewed deploy sources and noncredential test secret are permitted", () => {
  for (const query of engineeringPolicy.migration_queries) {
    assert.equal(
      engineeringFixtureArguments("supabase.db.migrations.apply", {
        body: { query },
      }),
      true,
    );
  }
  assert.equal(
    engineeringFixtureArguments("supabase.functions.secrets.set", {
      body: [{
        name: engineeringPolicy.secret_name,
        value: "isolated-noncredential-machine-test",
      }],
    }),
    true,
  );
  for (const sha256 of engineeringPolicy.function_source_sha256) {
    assert.equal(
      engineeringFixtureArguments("supabase.deploy_edge_function", {
        project_id: engineeringPolicy.project_ref,
        slug: engineeringPolicy.function_slug,
        name: engineeringPolicy.function_slug,
        verify_jwt: true,
        entrypoint_path: "index.ts",
        files: [{ path: "index.ts", sha256 }],
      }),
      true,
    );
  }
});
Deno.test("invalid schema, paid declarations and API-key substitution do not prepare or execute a mutation", async () => {
  const h = await harness({ argumentsValid: () => false });
  assert.equal((await h.call()).status, 403);
  assert.equal(
    h.state.rpc.filter((c) =>
      c.name !== "sandy_engineering_record_policy_denial"
    ).length,
    1,
  );
  for (
    const headers of [{ "x-sandy-declared-units": "1" }, {
      "x-sandy-api-key": "opaque",
    }] as Record<string, string>[]
  ) {
    const h = await harness();
    assert.equal((await h.call(req(msg(), headers))).status, 403);
    assert.equal(h.state.delegated, 0);
  }
});
Deno.test("machine log result is restricted to exact pinned console markers", async () => {
  const h = await harness({
    delegate: async () =>
      Response.json({
        ok: true,
        result: {
          ok: true,
          operation: "supabase.logs.query",
          contract_version: "1.0.0",
          provider: "supabase",
          request_state: "observed",
          executed: true,
          admission_id: APPROVAL,
          provider_http_status: 200,
          provider_request_id: null,
          possibly_truncated: true,
          result: {
            project_ref: engineeringPolicy.project_ref,
            query_dialect: "clickhouse_sql",
            redaction_policy: "known_patterns_v1",
            entries: [{
              id: null,
              source: "function_logs",
              message: engineeringPolicy.function_console_markers[0] + "\n",
              timestamp: "2026-10-21T00:00:00Z",
            }, {
              id: null,
              source: "function_logs",
              message: "other customer secret",
              timestamp: "2026-10-21T00:00:00Z",
            }],
            next_query_before: "private-project-activity",
          },
        },
      }),
  });
  const r = await h.call(
      req(
        msg("supabase.logs.query", {
          source: "function_logs",
          start: "2026-10-21T00:00:00Z",
          end: "2026-10-21T00:01:00Z",
        }),
      ),
    ),
    v = await r.json();
  assert.equal(v.result.result.entries.length, 1);
  assert.equal(v.result.result.next_query_before, null);
  assert.equal(v.result.possibly_truncated, true);
  assert.equal(Object.hasOwn(v.result, "truncated"), false);
  const validator = new AjvJsonSchemaValidator().getValidator(
    gapContracts["supabase.logs.query"].output_schema,
  );
  assert.equal(
    validator(v.result).valid,
    true,
    "the customer-filtered result must still satisfy the published MCP output schema",
  );
  assert.equal(JSON.stringify(v).includes("other customer secret"), false);
});
Deno.test("log contract description is metadata, not a provider result to redact", async () => {
  const description = {
    ok: true,
    operation: {
      operation: "supabase.logs.query",
      input_schema: { type: "object" },
      output_schema: { type: "object" },
    },
  };
  const h = await harness({ delegate: async () => Response.json(description) });
  const r = await h.call(
    req({ action: "describe", operation: "supabase.logs.query" }),
  );
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), description);
  assert.deepEqual(h.state.rpc.map((x) => x.name), [
    "sandy_engineering_resolve_identity",
  ]);
});
Deno.test("discovery delegates only the bounded catalogue and never prepares a provider write", async () => {
  const h = await harness();
  assert.equal(
    (await h.call(req({ action: "list", channel: "mcp" }))).status,
    200,
  );
  assert.equal(
    h.state.rpc.filter((c) =>
      c.name !== "sandy_engineering_record_policy_denial"
    ).length,
    1,
  );
  assert.equal(h.state.delegated, 1);
});

async function vmHarness() {
  const h = await harness({
    entry: async (operation) => ({
      operation,
      api_exposed: true,
      ai_exposed: true,
      verified: false,
      is_mutation: false,
      error_contract: {},
      input_schema: { type: "object" },
    }),
  });
  (h.state.resolved as Record<string, unknown>).vm_read_scope = {
    policy_sha256: await argumentDigest(engineeringVmReadPolicy),
    owner_authority_id: OWNER,
    source_change_id: APPROVAL,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    operations: engineeringVmReadPolicy.operations,
  };
  return h;
}
Deno.test("separate actual owner-approved VM scope delegates only fixed read tools without preparing provider-write approvals", async () => {
  const h = await vmHarness(), r = await h.call(req(msg("video.status", {})));
  assert.equal(r.status, 200);
  assert.equal(h.state.delegated, 1);
  assert.deepEqual(h.state.rpc.map((x) => x.name), [
    "sandy_engineering_resolve_identity",
    "sandy_engineering_record_vm_read",
  ]);
  assert.equal(h.state.headers.has("x-sandy-approval-id"), false);
  assert.equal(
    (h.state.proof as Record<string, unknown>).vmReadScopeSha256,
    await argumentDigest(engineeringVmReadPolicy),
  );
});
Deno.test("canonical shared VM read is restricted to the existing approved VM without adding mutation authority", async () => {
  const h = await vmHarness();
  assert.equal(
    (await h.call(req(msg("gcp.compute.instances.get", {
      path: { instance: "sandy-video" },
    })))).status,
    200,
  );
  assert.equal(h.state.delegated, 1);
  assert.equal(h.state.rpc[1].name, "sandy_engineering_record_vm_read");
  for (
    const args of [
      {},
      { target: "sandy-video" },
      { path: { instance: "sandy-windows" } },
      { path: { instance: "sandy-video", project: "foreign" } },
      { path: { instance: "sandy-video" }, query: {} },
      { path: { instance: "sandy-video" }, command: "whoami" },
    ]
  ) {
    const denied = await vmHarness();
    assert.equal(
      (await denied.call(req(msg("gcp.compute.instances.get", args)))).status,
      403,
    );
    assert.equal(denied.state.delegated, 0);
    assert.equal(
      denied.state.rpc.filter((c) =>
        c.name !== "sandy_engineering_record_policy_denial"
      ).length,
      1,
    );
  }
});
Deno.test("optional VM scope never authorizes install, IAM grants, provider writes or arbitrary arguments", async () => {
  for (
    const operation of [
      "video.install",
      "video.ssh.iam_grant",
      "gcp.compute.instances.create",
    ]
  ) {
    const h = await vmHarness();
    assert.equal((await h.call(req(msg(operation, {})))).status, 403);
    assert.equal(h.state.delegated, 0);
    assert.equal(
      h.state.rpc.filter((c) =>
        c.name !== "sandy_engineering_record_policy_denial"
      ).length,
      1,
    );
  }
  for (
    const args of [
      { target: "another-vm" },
      { action: "create_video" },
      { project_id: "another-project" },
      { command: "whoami" },
      { target: "sandy-video", job_id: APPROVAL },
    ]
  ) {
    const h = await vmHarness();
    assert.equal((await h.call(req(msg("video.status", args)))).status, 403);
    assert.equal(h.state.delegated, 0);
    assert.equal(
      h.state.rpc.filter((c) =>
        c.name !== "sandy_engineering_record_policy_denial"
      ).length,
      1,
    );
  }
});
Deno.test("expired, foreign-owner, forged-policy and expanded optional scope cannot create a VM delegation", async () => {
  for (
    const patch of [
      { expires_at: new Date(0).toISOString() },
      { owner_authority_id: MACHINE },
      { policy_sha256: "forged" },
      { source_change_id: "invalid" },
      { operations: [...engineeringVmReadPolicy.operations, "video.install"] },
    ] as Record<string, unknown>[]
  ) {
    const h = await vmHarness();
    Object.assign(
      (h.state.resolved as Record<string, unknown>).vm_read_scope as Record<
        string,
        unknown
      >,
      patch,
    );
    assert.equal((await h.call(req(msg("video.status", {})))).status, 403);
    assert.equal(h.state.delegated, 0);
  }
});
Deno.test("a registry mutation or approval requirement cannot be laundered through a VM read grant", async () => {
  for (
    const row of [{ is_mutation: true }, {
      is_mutation: false,
      error_contract: { requires_approval: true },
    }]
  ) {
    const h = await harness({
      entry: async (operation) => ({
        operation,
        api_exposed: true,
        ai_exposed: true,
        verified: true,
        input_schema: { type: "object" },
        ...row,
      }),
    });
    (h.state.resolved as Record<string, unknown>).vm_read_scope = {
      policy_sha256: await argumentDigest(engineeringVmReadPolicy),
      owner_authority_id: OWNER,
      source_change_id: APPROVAL,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      operations: engineeringVmReadPolicy.operations,
    };
    assert.equal((await h.call(req(msg("video.status", {})))).status, 424);
    assert.equal(h.state.delegated, 0);
  }
});
Deno.test("database revalidation refusal prevents provider dispatch even with a formerly valid VM scope", async () => {
  const h = await vmHarness();
  const real = h.state.resolved;
  const broken = await harness({
    db: {
      rpc: async (name) => ({
        data: name === "sandy_engineering_resolve_identity"
          ? real
          : { ok: false },
        error: null,
      }),
    },
    entry: async (operation) => ({
      operation,
      api_exposed: true,
      ai_exposed: true,
      verified: false,
      is_mutation: false,
      error_contract: {},
      input_schema: { type: "object" },
    }),
  });
  assert.equal((await broken.call(req(msg("video.status", {})))).status, 403);
  assert.equal(broken.state.delegated, 0);
});

Deno.test("VM diagnostic scope redacts guest attribute values while preserving operational preflight facts", async () => {
  const h = await vmHarness();
  const resolved = h.state.resolved;
  const checked = await harness({
    db: {
      rpc: async (name) => ({
        data: name === "sandy_engineering_resolve_identity"
          ? resolved
          : { ok: true },
        error: null,
      }),
    },
    entry: async (operation) => ({
      operation,
      api_exposed: true,
      ai_exposed: true,
      verified: true,
      is_mutation: false,
      error_contract: {},
      input_schema: { type: "object" },
    }),
    delegate: async () =>
      Response.json({
        ok: true,
        executed: true,
        result: {
          ok: true,
          vm: "sandy-video",
          vm_status: "RUNNING",
          guest_reporting: {
            items: [{ key: "private", value: "synthetic-private-guest-data" }],
          },
          installation_authorized: false,
          livekit_verified: false,
        },
      }),
  });
  const response = await checked.call(req(msg("video.install.preflight", {}))),
    body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.result.vm_status, "RUNNING");
  assert.equal(body.result.installation_authorized, false);
  assert.deepEqual(body.result.guest_reporting, {
    available: true,
    item_count: 1,
    values_redacted: true,
  });
  assert.equal(
    JSON.stringify(body).includes("synthetic-private-guest-data"),
    false,
  );
});

Deno.test("standing receipt access is limited to the authenticated workload's own admission", async () => {
  for (const owns of [true, false]) {
    const h = await standingHarness(true, false, owns);
    const r = await h.call(
      req(msg("system.execution.get", { request_id: APPROVAL }), {
        "x-sandy-approval-id": APPROVAL,
      }),
    );
    assert.equal(r.status, owns ? 200 : 404);
    assert.equal(h.state.delegated, owns ? 1 : 0);
    assert.equal(
      h.calls.filter((c) => c.name === "sandy_engineering_prepare_delegated")
        .length,
      0,
    );
    if (owns) assert.equal(h.state.headers.has("x-sandy-approval-id"), false);
  }
});

Deno.test("policy denials retain hash-only audit evidence without preparing provider work", async () => {
  const h = await harness();
  const args = {
    body: { content: "private caller text must never be logged" },
  };
  const r = await h.call(
    req(msg("github.repos.delete", args), { "x-sandy-request-id": APPROVAL }),
  );
  assert.equal(r.status, 403);
  const audit = h.state.rpc.find((c) =>
    c.name === "sandy_engineering_record_policy_denial"
  )!;
  assert.ok(audit);
  assert.equal(audit.args.p_request_id, APPROVAL);
  assert.equal(audit.args.p_input_sha256, await argumentDigest(args));
  assert.equal(audit.args.p_error, "engineering_operation_scope_denied");
  assert.equal(JSON.stringify(audit).includes("private caller text"), false);
  assert.equal(h.state.delegated, 0);
});

Deno.test("expired and revoked standing policy cannot fall back to a historical fixture grant", async () => {
  for (
    const error of [
      "standing_delegation_expired",
      "standing_delegation_revoked",
    ]
  ) {
    const h = await standingHarness(false, false, true, error);
    const r = await h.call();
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, error);
    assert.equal(h.state.delegated, 0);
    assert.equal(
      h.calls.some((c) => c.name === "sandy_engineering_prepare_execution"),
      false,
    );
  }
});

Deno.test("nested Git source text is scanned before tree admission, including quoted credential JSON", async () => {
  const h = await standingHarness();
  const response = await h.call(req(msg("github.git.trees.create", {
    body: {
      tree: [{
        path: "engineering/test.json",
        mode: "100644",
        type: "blob",
        content: JSON.stringify({
          client_secret:
            "synthetic-private-material-that-must-not-be-published",
        }),
      }],
    },
  })));
  assert.equal(response.status, 403);
  assert.equal(h.state.delegated, 0);
  assert.equal(
    h.calls.some((c) => c.name === "sandy_engineering_prepare_delegated"),
    false,
  );
});

Deno.test("bounded Git blobs accept larger reviewed text and reject oversized or credential source", async () => {
  for (
    const [text, expected] of [["reviewed source\n".repeat(6000), 200], [
      "x".repeat(512 * 1024 + 1),
      403,
    ], [
      JSON.stringify({
        client_secret: "synthetic-private-material-that-must-not-be-published",
      }),
      403,
    ]] as const
  ) {
    const h = await standingHarness();
    const response = await h.call(
      req(
        msg("github.git.blobs.create", {
          body: { encoding: "base64", content: btoa(text) },
        }),
      ),
    );
    assert.equal(response.status, expected);
    assert.equal(h.state.delegated, expected === 200 ? 1 : 0);
  }
});
