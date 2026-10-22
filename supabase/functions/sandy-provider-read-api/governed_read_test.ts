import assert from "node:assert/strict";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import { ConsumerCredentialError } from "../_shared/sandy_credential_consumer.ts";
import {
  createGovernedProviderReadHandler,
  type GovernedProviderReadDependencies,
} from "./governed_read.ts";
import {
  createProviderReadHandler,
  providerReadArgumentsValid,
  providerReadOperationNames,
} from "./index.ts";
type Row = Record<string, any>;
const actor = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const grant = "33333333-3333-4333-8333-333333333333";
const admission = "44444444-4444-4444-8444-444444444444";
const base = {
  protocol: "consumed-admission-v1",
  actor_id: actor,
  tenant_id: null,
  request_id: requestId,
  grant_id: grant,
  admission_id: admission,
  credential_id: null,
  operation: "supabase.projects.get",
  arguments: {},
};
function fixture(overrides: Partial<GovernedProviderReadDependencies> = {}) {
  const events: string[] = [];
  const contexts: Row[] = [];
  let providerCalls = 0;
  const deps: GovernedProviderReadDependencies = {
    service: "synthetic-service",
    operations: providerReadOperationNames,
    validArguments: providerReadArgumentsValid,
    db: {
      rpc: async (name, args) => {
        assert.equal(name, "sandy_provider_read_authorize");
        events.push("actual_admission_proof");
        const p = args.p as Row;
        contexts.push(p);
        assert.equal(p.arguments_canonical, canonicalJson(p.arguments));
        assert.equal(p.input_sha256, await argumentDigest(p.arguments));
        return {
          error: null,
          data: {
            ok: true,
            actor_id: p.actor_id,
            admission_id: p.admission_id,
            request_id: p.request_id,
            operation: p.operation,
            input_sha256: p.input_sha256,
            scope_sha256: p.scope_sha256,
            registry_revision_sha256: "a".repeat(64),
          },
        };
      },
    },
    withManagementCredential: async (execution, use) => {
      events.push("consumer");
      assert.equal(execution.actorId, actor);
      assert.equal(execution.admissionId, admission);
      return await use("synthetic-current-management");
    },
    core: (management) =>
      createProviderReadHandler({
        service: "synthetic-service",
        management,
        fetch: async (input, init) => {
          events.push("provider_read");
          providerCalls++;
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            "Bearer synthetic-current-management",
          );
          assert.equal(init?.redirect, "error");
          assert.match(
            String(input),
            /^https:\/\/api\.supabase\.com\/v1\/projects\/zmqlyygzqoidkcwdysok(?:\/|$)/,
          );
          return Response.json({
            id: "zmqlyygzqoidkcwdysok",
            name: "Synthetic project",
            password: "synthetic-must-not-escape",
          });
        },
      }),
    ...overrides,
  };
  const handler = createGovernedProviderReadHandler(deps);
  const invoke = (payload: Row = base, headers: Record<string, string> = {}) =>
    handler(
      new Request("https://synthetic.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic-service",
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      }),
    );
  return { deps, events, contexts, invoke, providerCalls: () => providerCalls };
}
Deno.test("governed provider reads require exact versioned real-principal context before any lookup", async () => {
  const f = fixture();
  for (
    const body of [
      { operation: base.operation, arguments: {} },
      { ...base, protocol: "legacy" },
      { ...base, actor_id: null },
      { ...base, admission_id: "invented" },
      { ...base, tenant_id: actor },
      { ...base, project_ref: "other" },
      { ...base, operation: "supabase.projects.delete" },
    ]
  ) assert.equal((await f.invoke(body)).status, 400);
  assert.equal(
    (await f.invoke(base, { authorization: "Bearer user-session" })).status,
    403,
  );
  assert.equal(
    (await f.invoke(base, { "x-sandy-api-key": "synthetic" })).status,
    403,
  );
  assert.deepEqual(f.events, []);
  assert.equal(f.providerCalls(), 0);
});
Deno.test("exact argument digest proof precedes consumer resolution and preserves the existing projected output", async () => {
  const f = fixture();
  const response = await f.invoke();
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(text).contract_version, "1.0.0");
  assert.ok(!text.includes("synthetic-must-not-escape"));
  assert.deepEqual(f.events, [
    "actual_admission_proof",
    "consumer",
    "provider_read",
  ]);
  assert.equal(f.contexts[0].request_id, requestId);
  assert.equal(f.contexts[0].grant_id, grant);
  assert.equal(
    f.contexts[0].scope_sha256,
    await argumentDigest({
      permission_scope: "infrastructure:read",
      sandy_project_ref: "zmqlyygzqoidkcwdysok",
    }),
  );
  assert.equal(f.providerCalls(), 1);
});
Deno.test("branch arguments are validated and hashed as their actual approved value", async () => {
  const f = fixture();
  assert.equal(
    (await f.invoke({
      ...base,
      operation: "supabase.branches.get",
      arguments: { name: "../other" },
    })).status,
    400,
  );
  await f.invoke({
    ...base,
    operation: "supabase.branches.get",
    arguments: { name: "approved-branch" },
  });
  assert.equal(f.contexts[0].arguments.name, "approved-branch");
  assert.equal(
    f.contexts[0].input_sha256,
    await argumentDigest({ name: "approved-branch" }),
  );
});
Deno.test("refused, lost, replayed or mismatched admission proofs cannot resolve a credential", async () => {
  for (
    const data of [
      {
        ok: false,
        error: "provider_read_context_already_claimed",
        http_status: 409,
      },
      { ok: true, actor_id: "other" },
      null,
    ]
  ) {
    const f = fixture({
      db: { rpc: async () => ({ error: null, data }) },
      withManagementCredential: () => {
        throw Error("must not resolve");
      },
    });
    assert.notEqual((await f.invoke()).status, 200);
    assert.equal(f.providerCalls(), 0);
  }
  const f = fixture({
    db: {
      rpc: () => {
        throw Error("raw credential diagnostics must not escape");
      },
    },
  });
  const reply = await f.invoke();
  assert.equal(reply.status, 503);
  assert.ok(!(await reply.text()).includes("raw credential"));
});
Deno.test("an active consumer refusal never falls back to original provider configuration", async () => {
  const f = fixture({
    withManagementCredential: async () => {
      throw new ConsumerCredentialError("consumer_active_readback_required");
    },
  });
  const response = await f.invoke();
  assert.equal(response.status, 424);
  assert.equal((await response.json()).executed, false);
  assert.equal(f.providerCalls(), 0);
});
Deno.test("ambiguous provider transport does not fabricate nonexecution or a successful receipt", async () => {
  const f = fixture({
    withManagementCredential: async () => {
      throw new ConsumerCredentialError(
        "consumer_request_outcome_unknown",
        true,
        502,
      );
    },
  });
  const response = await f.invoke();
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
});
Deno.test("versioned read boundary is streaming-bounded despite dishonest Content-Length", async () => {
  const f = fixture();
  const response = await createGovernedProviderReadHandler(f.deps)(
    new Request("https://synthetic.invalid", {
      method: "POST",
      headers: {
        authorization: "Bearer synthetic-service",
        "content-length": "1",
      },
      body: " ".repeat(65537),
    }),
  );
  assert.equal(response.status, 413);
  assert.deepEqual(f.events, []);
});
