import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  tenantLifecycleOperations,
  tenantLifecycleScope,
} from "./contracts.ts";
import {
  createTenantLifecycleHandler,
  type Dependencies,
  type FinishRequest,
  normalizeTenantLifecycleFinish,
  type RpcResult,
  validateTenantLifecycleContracts,
} from "./index.ts";
const actor = "00000000-0000-4000-8000-000000000001",
  tenant = "00000000-0000-4000-8000-000000000002",
  snapshot = "00000000-0000-4000-8000-000000000003",
  admission = "00000000-0000-4000-8000-000000000004",
  grant = "00000000-0000-4000-8000-000000000005",
  requestId = "00000000-0000-4000-8000-000000000006";
const manifestSha =
    (tenantLifecycleOperations["supabase.tenant.export"].input_schema.properties
      .expected_manifest_sha256 as { const: string }).const,
  currentSha = "b".repeat(64);
const counts = {
  sandy_task_pins: 0,
  sandy_company_aliases: 0,
  sandy_agenda_attention: 0,
  sandy_life_task_contexts: 0,
  sandy_life_goal_tasks: 0,
  sandy_social_connections: 0,
};
function resultFor(operation: string, args: Record<string, unknown>) {
  const result: Record<string, unknown> = {
    snapshot_id: snapshot,
    tenant_id: tenant,
    manifest: "application_leaf_links_v1",
    manifest_sha256: manifestSha,
    schema_sha256:
      tenantLifecycleOperations["supabase.tenant.export"].schema_sha256,
    snapshot_sha256: "d".repeat(64),
    state: "exported",
    created_at: "2026-10-21T00:00:00Z",
    expires_at: "2026-11-21T00:00:00Z",
    row_counts: counts,
    complete_tenant_coverage: false,
    external_provider_assets_included: false,
  };
  if (
    operation === "supabase.tenant.erase" ||
    operation === "supabase.tenant.restore"
  ) {
    Object.assign(result, {
      state: operation.endsWith("erase") ? "erased" : "restored",
      before_sha256: args.expected_current_sha256,
      after_sha256: "e".repeat(64),
      readback_verified: true,
      scope: operation.endsWith("erase")
        ? "exact_snapshot_manifest_rows"
        : "empty_target_manifest_only",
    });
  }
  if (operation === "supabase.tenant.exports.purge") {
    Object.assign(result, { state: "purged", readback_verified: true });
  }
  return result;
}
function argsFor(operation: string): Record<string, unknown> {
  if (operation === "supabase.tenant.exports.get") {
    return { tenant_id: tenant, snapshot_id: snapshot };
  }
  if (operation === "supabase.tenant.exports.purge") {
    return {
      tenant_id: tenant,
      snapshot_id: snapshot,
      confirm_artifact_purge: true,
    };
  }
  const args: Record<string, unknown> = {
    tenant_id: tenant,
    manifest: "application_leaf_links_v1",
    expected_manifest_sha256: manifestSha,
  };
  if (operation !== "supabase.tenant.export") {
    Object.assign(args, {
      snapshot_id: snapshot,
      expected_current_sha256: currentSha,
      ...(operation.endsWith("erase")
        ? { confirm_manifest_erasure: true }
        : { confirm_manifest_restore: true }),
    });
  }
  return args;
}
function fixture(overrides: Partial<Dependencies> = {}) {
  const calls: { name: string; value: unknown }[] = [];
  let currentOperation = "supabase.tenant.export",
    currentArgs = argsFor(currentOperation);
  const deps: Dependencies = {
    service: "internal-fixture",
    projectUrl: "https://zmqlyygzqoidkcwdysok.supabase.co",
    authorizeContext: async (context, operation) => {
      calls.push({
        name: "authorize",
        value: { context, operation: operation.operation },
      });
      return { allowed: true };
    },
    consumeGrant: async (value) => {
      calls.push({ name: "consume", value });
      return { allowed: true, reused: false, admission_id: admission };
    },
    finishExecution: async (value) => {
      calls.push({ name: "finish", value });
      return { allowed: true };
    },
    rpc: async (name, value) => {
      calls.push({ name, value });
      return {
        data: {
          ok: true,
          result: resultFor(currentOperation, currentArgs),
          reused: false,
        },
        error: null,
        status: 200,
      };
    },
    ...overrides,
  };
  const handler = createTenantLifecycleHandler(deps);
  const invoke = (
    operation = currentOperation,
    args = argsFor(operation),
    extra: Record<string, unknown> = {},
  ) => {
    currentOperation = operation;
    currentArgs = args;
    return handler(
      new Request("https://fixture.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer internal-fixture",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation,
          arguments: args,
          actor_id: actor,
          tenant_id: null,
          request_id: requestId,
          grant_id: grant,
          ...extra,
        }),
      }),
    );
  };
  return { deps, calls, handler, invoke };
}
Deno.test("all five fixed manifest operations have executable strict contracts", () =>
  equal(validateTenantLifecycleContracts(), 5));
Deno.test("internal service identity and exact project are checked before provider/policy", async () => {
  const f = fixture();
  equal(
    (await f.handler(
      new Request("https://fixture.invalid", {
        method: "POST",
        headers: { authorization: "Bearer customer-session" },
        body: "{}",
      }),
    )).status,
    401,
  );
  equal(f.calls, []);
  const other = fixture({ projectUrl: "https://other.supabase.co" });
  equal((await other.invoke()).status, 503);
  equal(other.calls, []);
});
Deno.test("caller cannot choose SQL, columns, credentials, another manifest or admin execution tenant", async () => {
  for (
    const extra of [
      { sql: "select private" },
      { tables: ["auth.users"] },
      { payload: { refresh_token: "private" } },
      { url: "https://other.invalid" },
      { manifest: "arbitrary_table_v1" },
    ]
  ) {
    const f = fixture();
    equal(
      (await f.invoke("supabase.tenant.export", {
        ...argsFor("supabase.tenant.export"),
        ...extra,
      })).status,
      400,
    );
    equal(f.calls, []);
  }
  for (
    const extra of [{ tenant_id: tenant }, { credential_id: snapshot }, {
      user_jwt: "private",
    }]
  ) {
    const f = fixture();
    equal(
      (await f.invoke(
        "supabase.tenant.export",
        argsFor("supabase.tenant.export"),
        extra,
      )).status,
      400,
    );
    equal(f.calls, []);
  }
});
Deno.test("disabled owner contract refuses before grant consumption", async () => {
  const f = fixture({
    authorizeContext: async () => ({
      allowed: false,
      error: "verified_execution_contract_required",
      http_status: 424,
    }),
  });
  equal((await f.invoke()).status, 424);
  equal(f.calls, []);
});
Deno.test("one-use grant binds actor, exact arguments, operation, contract and manifest scope", async () => {
  const f = fixture();
  equal((await f.invoke()).status, 200);
  const consumed = f.calls.find((c) => c.name === "consume")!.value as Record<
    string,
    unknown
  >;
  equal(consumed.actor_id, actor);
  equal(consumed.tenant_id, null);
  equal(consumed.operation, "supabase.tenant.export");
  equal(
    consumed.input_sha256,
    await argumentDigest(argsFor("supabase.tenant.export")),
  );
  equal(consumed.scope_sha256, await argumentDigest(tenantLifecycleScope));
  equal(
    consumed.contract_sha256,
    tenantLifecycleOperations["supabase.tenant.export"].contract_sha256,
  );
  const call = f.calls.find((c) =>
    c.name === "sandy_tenant_lifecycle_execute"
  )!;
  equal(call.value, {
    p_actor: actor,
    p_admission: admission,
    p_canonical: canonicalJson(argsFor("supabase.tenant.export")),
  });
  assert(
    f.calls.findIndex((c) => c.name === "consume") <
      f.calls.findIndex((c) => c.name === "sandy_tenant_lifecycle_execute"),
  );
});
Deno.test("reused or incomplete grant proof cannot dispatch the database", async () => {
  for (
    const value of [{ allowed: true, reused: true, admission_id: admission }, {
      allowed: true,
      admission_id: admission,
    }, { allowed: true, reused: false, admission_id: "invalid" }]
  ) {
    const f = fixture({ consumeGrant: async () => value });
    equal((await f.invoke()).status, 409);
    assert(!f.calls.some((c) => c.name === "sandy_tenant_lifecycle_execute"));
  }
});
Deno.test("admission ID conflict records failure and never executes SQL", async () => {
  const f = fixture();
  equal(
    (await f.invoke(
      "supabase.tenant.export",
      argsFor("supabase.tenant.export"),
      { admission_id: snapshot },
    )).status,
    409,
  );
  assert(!f.calls.some((c) => c.name === "sandy_tenant_lifecycle_execute"));
  equal(
    (f.calls.find((c) => c.name === "finish")!.value as FinishRequest).outcome,
    "failed",
  );
});
Deno.test("metadata export is accepted; passive snapshot get finishes succeeded", async () => {
  for (const operation of Object.keys(tenantLifecycleOperations)) {
    const f = fixture();
    const r = await f.invoke(operation);
    equal(r.status, 200);
    const body = await r.json();
    equal(body.result.complete_tenant_coverage, false);
    equal(body.result.external_provider_assets_included, false);
    const read = operation === "supabase.tenant.exports.get";
    equal(body.request_state, read ? "observed" : "accepted");
    equal(
      (f.calls.find((c) => c.name === "finish")!.value as FinishRequest)
        .outcome,
      read ? "succeeded" : "accepted",
    );
  }
});
Deno.test("cross-tenant, cross-snapshot and wrong manifest results cannot be returned", async () => {
  for (
    const patch of [
      { tenant_id: actor },
      { snapshot_id: actor },
      { manifest_sha256: "f".repeat(64) },
      { before_sha256: "f".repeat(64) },
      { state: "exported" },
    ]
  ) {
    const args = argsFor("supabase.tenant.erase"),
      f = fixture({
        rpc: async () => ({
          data: {
            ok: true,
            result: { ...resultFor("supabase.tenant.erase", args), ...patch },
            reused: false,
          },
          error: null,
          status: 200,
        }),
      });
    const r = await f.invoke("supabase.tenant.erase", args);
    equal(r.status, 502);
    equal((await r.json()).reconciliation_required, true);
  }
});
Deno.test("unexpected plaintext, secret fields and false full coverage claims fail projection", async () => {
  for (
    const patch of [{ decrypted_payload: "never-return-this-secret" }, {
      complete_tenant_coverage: true,
    }, { external_provider_assets_included: true }]
  ) {
    const f = fixture({
      rpc: async () => ({
        data: {
          ok: true,
          result: {
            ...resultFor(
              "supabase.tenant.export",
              argsFor("supabase.tenant.export"),
            ),
            ...patch,
          },
          reused: false,
        },
        error: null,
        status: 200,
      }),
    });
    const r = await f.invoke();
    equal(r.status, 502);
    assert(!(await r.text()).includes("never-return-this-secret"));
    assert(
      !JSON.stringify(f.calls.filter((c) => c.name === "finish")).includes(
        "never-return-this-secret",
      ),
    );
  }
});
Deno.test("provider status comes from actual RPC response and is never invented", async () => {
  const reply = (status: number): RpcResult => ({
    data: {
      ok: true,
      result: resultFor(
        "supabase.tenant.export",
        argsFor("supabase.tenant.export"),
      ),
      reused: false,
    },
    error: null,
    status,
  });
  const actual = fixture({ rpc: async () => reply(201) });
  equal((await actual.invoke()).status, 200);
  equal(
    (actual.calls.find((c) => c.name === "finish")!.value as FinishRequest)
      .provider_http_status,
    201,
  );
  const absent = fixture({ rpc: async () => reply(0) });
  equal((await absent.invoke()).status, 502);
  const finish = absent.calls.find((c) => c.name === "finish")!
    .value as FinishRequest;
  equal(finish.outcome, "unknown");
  equal(finish.provider_http_status, null);
});
Deno.test("lost transport leaves mutation uncertain without forwarding raw credentials", async () => {
  const f = fixture({
    rpc: async () => {
      throw Error("Bearer private-provider-material");
    },
  });
  const r = await f.invoke();
  equal(r.status, 503);
  const text = await r.text();
  assert(!text.includes("private-provider-material"));
  assert(text.includes('"executed":null'));
  equal(
    (f.calls.find((c) => c.name === "finish")!.value as FinishRequest).outcome,
    "unknown",
  );
});
Deno.test("only an explicit PostgreSQL rollback proof is a known failed mutation", async () => {
  for (
    const [status, error, expected] of [[400, {
      code: "P0001",
      message: "private-tenant-policy",
    }, "failed"], [
      408,
      { code: "57014", message: "private-transport-timeout" },
      "unknown",
    ], [502, { message: "private-upstream" }, "unknown"]] as const
  ) {
    const f = fixture({ rpc: async () => ({ data: null, error, status }) });
    const r = await f.invoke();
    assert(!(await r.text()).includes("private-"));
    equal(
      (f.calls.find((c) => c.name === "finish")!.value as FinishRequest)
        .outcome,
      expected,
    );
  }
});
Deno.test("finish normalizes shared SQL receipt state rather than requiring an allowed field", () => {
  const request: FinishRequest = {
    admission_id: admission,
    outcome: "accepted",
    provider_http_status: 200,
    provider_request_id: null,
    result_sha256: "a".repeat(64),
  };
  equal(
    normalizeTenantLifecycleFinish(request, {
      ok: true,
      admission_id: admission,
      state: "accepted",
      reused: false,
    }),
    { allowed: true, admission_id: admission, reused: false },
  );
  for (
    const value of [
      { ok: true, admission_id: admission, state: "succeeded", reused: false },
      { ok: true, admission_id: snapshot, state: "accepted", reused: false },
      { ok: true, admission_id: admission, state: "accepted" },
      { allowed: true },
    ]
  ) equal(normalizeTenantLifecycleFinish(request, value).allowed, false);
});
Deno.test("lost durable receipt never reports successful completion", async () => {
  const f = fixture({ finishExecution: async () => ({ allowed: false }) });
  const r = await f.invoke();
  equal(r.status, 503);
  const body = await r.json();
  equal(body.ok, false);
  equal(body.reconciliation_required, true);
});
Deno.test("body bound is enforced before schema or any execution policy", async () => {
  const f = fixture();
  const r = await f.handler(
    new Request("https://fixture.invalid", {
      method: "POST",
      headers: { authorization: "Bearer internal-fixture" },
      body: JSON.stringify({ padding: "x".repeat(200000) }),
    }),
  );
  equal(r.status, 413);
  equal(f.calls, []);
});
