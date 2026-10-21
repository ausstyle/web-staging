import assert from "node:assert/strict";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import type { PolicyDb } from "./access_policy.ts";
import {
  admitCustomerKeyExecution,
  authenticateCustomerKey,
  buildCustomerKeyReadRequest,
  consumeCustomerKeyGrant,
  type CustomerKeyExecutionInput,
  type CustomerKeyPrincipal,
  customerKeyReadScopes,
  customerKeyScopeDigest,
  getCustomerKeyReceipt,
  governedCustomerKeyExecution,
  resolveCustomerKeyRequest,
} from "./customer_key_principal.ts";
type Obj = Record<string, unknown>;
const key = "sandyop_" + "a".repeat(64),
  keyId = "10000000-0000-4000-8000-000000000001",
  customerId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003",
  admissionId = "10000000-0000-4000-8000-000000000004",
  grantId = "10000000-0000-4000-8000-000000000005";
const principal: CustomerKeyPrincipal = {
  kind: "customer_key",
  keyId,
  customerId,
  scopes: ["tasks:read", "calendar:write"],
  allowedOperations: ["tasks.get", "tasks.list"],
  keyRevisionSha256: "b".repeat(64),
  expiresAt: null,
};
const input: CustomerKeyExecutionInput = {
  operation: "tasks.list",
  arguments: {},
  requestId,
  channel: "api",
  contractSha256: "c".repeat(64),
};
const authRow = {
  ok: true,
  kind: "customer_key",
  key_id: keyId,
  customer_id: customerId,
  scopes: principal.scopes,
  allowed_operations: principal.allowedOperations,
  key_revision_sha256: principal.keyRevisionSha256,
  expires_at: null,
};
const admissionRow = {
  ok: true,
  allowed: true,
  reused: false,
  principal_kind: "customer_key",
  customer_key_id: keyId,
  tenant_id: customerId,
  admission_id: admissionId,
  grant_id: grantId,
  state: "admitted",
  executed: false,
  expires_at: "2099-01-01T00:00:00Z",
};
function mock(
  handle: (name: string, args: Obj) => unknown | Promise<unknown> = () =>
    authRow,
  error: unknown = null,
) {
  const calls: { name: string; args: Obj }[] = [];
  const db: PolicyDb = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: await handle(name, args), error };
    },
  };
  return { db, calls };
}
async function hash(v: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
Deno.test("customer keys derive only the actual stored tenant principal and passive exact scopes without an Auth identity", async () => {
  const h = mock();
  const result = await authenticateCustomerKey(h.db, key);
  assert.deepEqual(result, { ok: true, value: principal });
  assert.deepEqual(h.calls, [{
    name: "sandy_api_authenticate_customer_key",
    args: { p_secret_sha256: await hash(key) },
  }]);
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(JSON.stringify(h.calls).includes(key), false);
  for (
    const field of [
      "actorId",
      "principalId",
      "userId",
      "email",
      "userJWT",
      "key_hash",
    ]
  ) assert.equal(Object.hasOwn(result.ok ? result.value : {}, field), false);
  assert.equal(Object.keys(customerKeyReadScopes).length, 8);
  const writeOnly = await authenticateCustomerKey(
    mock(() => ({
      ...authRow,
      scopes: ["tasks:write"],
      allowed_operations: [],
    })).db,
    key,
  );
  assert.equal(writeOnly.ok, true);
});
Deno.test("customer key transport preserves anon platform authentication and rejects mixed user/admin or raw Bearer key modes", async () => {
  const h = mock(),
    req = (authorization: string, keyValue: string | null = key) =>
      new Request("https://test", {
        headers: {
          authorization,
          ...(keyValue ? { "x-sandy-api-key": keyValue } : {}),
        },
      });
  assert.deepEqual(
    await resolveCustomerKeyRequest(
      h.db,
      req("Bearer public-anon"),
      "public-anon",
    ),
    { ok: true, value: principal },
  );
  for (
    const bearer of [
      "Bearer actual-user-jwt",
      "Bearer admin-service-key",
      `Bearer ${key}`,
      "Bearer public-anon extra",
    ]
  ) {
    const before = h.calls.length;
    assert.equal(
      (await resolveCustomerKeyRequest(h.db, req(bearer), "public-anon"))?.ok,
      false,
    );
    assert.equal(h.calls.length, before);
  }
  assert.equal(
    await resolveCustomerKeyRequest(
      h.db,
      req("Bearer public-anon", null),
      "public-anon",
    ),
    null,
  );
  assert.equal(
    await resolveCustomerKeyRequest(
      h.db,
      req("Bearer public-anon", "sandy_api_other"),
      "public-anon",
    ),
    null,
  );
  assert.equal(
    (await authenticateCustomerKey(h.db, "sandyop_" + "x".repeat(64))).ok,
    false,
  );
});
Deno.test("customer key metadata cannot widen scopes, forge an owner or leak private refusal details", async () => {
  for (
    const v of [
      null,
      { ...authRow, kind: "user" },
      { ...authRow, key_id: "owner" },
      { ...authRow, allowed_operations: ["system.registry.list"] },
      { ...authRow, scopes: ["tasks:write"] },
      { ...authRow, expires_at: "2000-01-01T00:00:00Z" },
      { ok: false, error: "private-vault-key-contents", http_status: 500 },
    ]
  ) {
    const result = await authenticateCustomerKey(mock(() => v).db, key);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes("private-vault"), false);
  }
  assert.deepEqual(
    await authenticateCustomerKey(
      mock(() => ({
        ok: false,
        error: "invalid_customer_key",
        http_status: 401,
      })).db,
      key,
    ),
    { ok: false, status: 401, error: "invalid_customer_key" },
  );
});
Deno.test("tenant admissions bind actual key, tenant, current scope revision, exact input, channel and request ID", async () => {
  const h = mock(() => admissionRow),
    result = await admitCustomerKeyExecution(h.db, principal, key, input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const expectedScope = await hash(
    `sandy_customer_key_v1:${keyId}:${customerId}:tasks:read:${principal.keyRevisionSha256}`,
  );
  assert.equal(
    await customerKeyScopeDigest(principal, "tasks.list"),
    expectedScope,
  );
  assert.deepEqual(h.calls, [{
    name: "sandy_api_admit_customer_key_execution",
    args: {
      p_key_id: keyId,
      p_customer_id: customerId,
      p_secret_sha256: await hash(key),
      p_key_revision_sha256: principal.keyRevisionSha256,
      p_operation: "tasks.list",
      p_channel: "api",
      p_input_sha256: await argumentDigest({}),
      p_request_id: requestId,
      p_contract_sha256: input.contractSha256,
      p_scope_sha256: expectedScope,
    },
  }]);
  const consumed = mock(() => ({
    ok: true,
    allowed: true,
    reused: false,
    admission_id: admissionId,
  }));
  assert.deepEqual(
    await consumeCustomerKeyGrant(consumed.db, key, result.value),
    { ok: true, value: { admissionId } },
  );
  assert.equal(consumed.calls[0].args.p_grant_id, grantId);
  assert.equal(consumed.calls[0].args.p_customer_id, customerId);
  assert.equal(consumed.calls[0].args.p_scope_sha256, expectedScope);
  assert.equal(Object.hasOwn(consumed.calls[0].args, "p_actor_id"), false);
});
Deno.test("customer key admissions refuse scope expansion, forged Auth fields and ambiguous or reused grants without dispatch", async () => {
  const h = mock(() => admissionRow);
  for (
    const changed of [
      { ...input, operation: "tasks.create" },
      { ...input, operation: "calendar.list" },
      { ...input, actorId: keyId },
      { ...input, approvalId: grantId },
      { ...input, channel: "worker" },
      { ...input, arguments: { value: undefined } },
    ]
  ) {
    assert.equal(
      (await admitCustomerKeyExecution(
        h.db,
        principal,
        key,
        changed as CustomerKeyExecutionInput,
      )).ok,
      false,
    );
  }
  assert.equal(h.calls.length, 0);
  for (
    const error of [
      "admission_already_recorded",
      "request_id_conflict",
      "customer_key_contract_changed",
    ]
  ) {
    assert.deepEqual(
      await admitCustomerKeyExecution(
        mock(() => ({ ok: false, error, http_status: 409 })).db,
        principal,
        key,
        input,
      ),
      { ok: false, status: 409, error },
    );
  }
  const wrong = await admitCustomerKeyExecution(
    mock(() => ({ ...admissionRow, tenant_id: keyId })).db,
    principal,
    key,
    input,
  );
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.reconciliationRequired, true);
  const lost = await admitCustomerKeyExecution(
    mock(() => {
      throw Error("secret");
    }).db,
    principal,
    key,
    input,
  );
  assert.equal(lost.ok, false);
  if (!lost.ok) assert.equal(lost.reconciliationRequired, true);
});
function governedMock(refuse?: string) {
  return mock((name, args) => {
    if (name === "sandy_api_admit_customer_key_execution") return admissionRow;
    if (name === "sandy_api_consume_customer_key_grant") {
      return refuse
        ? { ok: false, error: refuse, http_status: 403 }
        : { ok: true, allowed: true, reused: false, admission_id: admissionId };
    }
    if (name === "sandy_api_finish_execution") {
      return {
        ok: true,
        admission_id: admissionId,
        state: args.p_outcome,
        reused: false,
      };
    }
    throw Error("unexpected RPC");
  });
}
Deno.test("customer key reads use one central admission/grant/finish around the existing callback and never retry unknown outcomes", async () => {
  const h = governedMock();
  let executions = 0;
  const result = await governedCustomerKeyExecution(
    h.db,
    principal,
    key,
    input,
    async () => {
      executions++;
      return Response.json({
        ok: true,
        executed: true,
        result: { ok: true, items: [] },
        upstream_status: 200,
      });
    },
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.admission_id, admissionId);
  assert.equal(body.request_id, requestId);
  assert.equal(executions, 1);
  assert.deepEqual(h.calls.map((c) => c.name), [
    "sandy_api_admit_customer_key_execution",
    "sandy_api_consume_customer_key_grant",
    "sandy_api_finish_execution",
  ]);
  assert.equal(h.calls[2].args.p_outcome, "succeeded");
  const denied = governedMock("customer_key_scope_denied");
  assert.equal(
    (await governedCustomerKeyExecution(
      denied.db,
      principal,
      key,
      input,
      async () => {
        throw Error("must not execute");
      },
    )).status,
    403,
  );
  assert.equal(denied.calls.length, 2);
  for (
    const callback of [
      async () => {
        throw Error("raw secret should never escape");
      },
      async () =>
        Response.json({ ok: true, accepted: true, executed: false }, {
          status: 202,
        }),
    ]
  ) {
    const uncertain = governedMock();
    let invoked = 0;
    const unknown = await governedCustomerKeyExecution(
      uncertain.db,
      principal,
      key,
      input,
      () => {
        invoked++;
        return callback();
      },
    );
    assert.equal(unknown.status, 502);
    assert.equal((await unknown.json()).executed, null);
    assert.equal(uncertain.calls[2].args.p_outcome, "unknown");
    assert.equal(invoked, 1);
  }
});
Deno.test("opaque customer transport targets only the existing fixed read service and retains tenant derivation there", () => {
  const built = buildCustomerKeyReadRequest(
    "https://project.supabase.co",
    "public-anon",
    principal,
    key,
    "tasks.list",
    {},
  );
  assert.ok(built);
  assert.equal(
    built.url,
    "https://project.supabase.co/functions/v1/sandy-operations-api",
  );
  assert.equal(
    (built.init.headers as Record<string, string>).authorization,
    `Bearer ${key}`,
  );
  assert.equal(
    (built.init.headers as Record<string, string>).apikey,
    "public-anon",
  );
  assert.deepEqual(JSON.parse(String(built.init.body)), {
    operation: "tasks.list",
    arguments: {},
  });
  assert.equal(built.init.redirect, "error");
  for (
    const base of [
      "http://project.supabase.co",
      "https://user:password@project.supabase.co",
      "https://project.supabase.co/wrong",
      "https://project.supabase.co?target=evil",
    ]
  ) {
    assert.equal(
      buildCustomerKeyReadRequest(
        base,
        "public-anon",
        principal,
        key,
        "tasks.list",
        {},
      ),
      null,
    );
  }
  for (
    const args of [
      { customer_id: customerId },
      { actor_id: keyId },
      { operation: "tasks.create" },
      { scopes: ["tasks:write"] },
      { url: "https://other" },
    ]
  ) {
    assert.equal(
      buildCustomerKeyReadRequest(
        "https://project.supabase.co",
        "public-anon",
        principal,
        key,
        "tasks.list",
        args,
      ),
      null,
    );
  }
  assert.equal(
    buildCustomerKeyReadRequest(
      "https://project.supabase.co",
      "public-anon",
      principal,
      key,
      "tasks.create",
      {},
    ),
    null,
  );
});
Deno.test("customer receipt recovery exposes only the same key's projected evidence and never returns an execution grant", async () => {
  const row = {
    ok: true,
    admission_id: admissionId,
    request_id: requestId,
    operation: "tasks.list",
    request_state: "unknown",
    accepted: false,
    executed: null,
    completed: false,
    outcome: "unknown",
    provider_http_status: null,
    provider_request_id_sha256: null,
    result_sha256: "d".repeat(64),
    reconciliation_required: true,
    redispatch_permitted: false,
    created_at: "2026-10-21T00:00:00Z",
    finished_at: "2026-10-21T00:00:01Z",
    grant_id: grantId,
    key_hash: "never expose",
  };
  const h = mock(() => row),
    result = await getCustomerKeyReceipt(h.db, principal, key, requestId);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.hasOwn(result.value, "grant_id"), false);
  assert.equal(JSON.stringify(result).includes("never expose"), false);
  assert.deepEqual(h.calls, [{
    name: "sandy_api_get_customer_key_receipt",
    args: {
      p_key_id: keyId,
      p_customer_id: customerId,
      p_secret_sha256: await hash(key),
      p_request_id: requestId,
    },
  }]);
  for (
    const altered of [
      { ...row, operation: "system.registry.list" },
      { ...row, request_id: keyId },
      { ...row, redispatch_permitted: true },
      { ...row, accepted: true },
    ]
  ) {
    assert.equal(
      (await getCustomerKeyReceipt(
        mock(() => altered).db,
        principal,
        key,
        requestId,
      )).ok,
      false,
    );
  }
});
