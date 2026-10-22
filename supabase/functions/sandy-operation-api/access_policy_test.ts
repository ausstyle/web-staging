import assert from "node:assert/strict";
import {
  admitExecution,
  authenticateScopedCredential,
  consumeExecutionGrant,
  finishExecution,
  getExecutionReceipt,
  issueScopedCredential,
  type PolicyDb,
  resolveApiKeyRequest,
  revokeScopedCredential,
} from "./access_policy.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
const actor = "10000000-0000-4000-8000-000000000001";
const credential = "10000000-0000-4000-8000-000000000002";
const request = "10000000-0000-4000-8000-000000000003";
const admission = "10000000-0000-4000-8000-000000000004";
const grant = "10000000-0000-4000-8000-000000000005";
const session = "fixture.normal.session";
const expires = () => new Date(Date.now() + 600000).toISOString();
const rawKey = `sandy_api_${credential}.${"a".repeat(43)}`;
const operations = ["supabase.projects.get"];
function mock(run: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: PolicyDb = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: run(name, args), error: null });
    },
  };
  return { db, calls };
}
Deno.test("key issuance requires normal Auth identity and stores only a random secret hash", async () => {
  const identities: string[] = [];
  const h = mock((name, args) => {
    assert.equal(name, "sandy_api_issue_credential");
    assert.match(String(args.p_secret_sha256), /^[a-f0-9]{64}$/);
    assert.equal(args.p_actor_id, actor);
    assert.equal(args.p_tenant_id, null);
    return {
      ok: true,
      credential_id: args.p_credential_id,
      principal_id: actor,
      tenant_id: null,
      allowed_operations: operations,
      expires_at: expires(),
      requests_per_minute: 5,
      declared_unit_budget: 10,
      secret_sha256: "must-not-escape",
      arbitrary: "private",
    };
  });
  const result = await issueScopedCredential(
    h.db,
    async (token) => {
      identities.push(token);
      return { id: actor };
    },
    session,
    {
      operations,
      ttlSeconds: 600,
      requestsPerMinute: 5,
      declaredUnitBudget: 10,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(identities, [session]);
  assert.equal(result.value.display_once, true);
  assert.match(
    String(result.value.api_key),
    /^sandy_api_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/,
  );
  assert.equal(
    JSON.stringify(h.calls).includes(String(result.value.api_key)),
    false,
  );
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
  assert.equal(JSON.stringify(result).includes("arbitrary"), false);
  const second = await issueScopedCredential(
    h.db,
    async () => ({ id: actor }),
    session,
    {
      operations,
      ttlSeconds: 600,
      requestsPerMinute: 5,
      declaredUnitBudget: 10,
    },
  );
  assert.equal(second.ok, true);
  if (second.ok) assert.notEqual(result.value.api_key, second.value.api_key);
});
Deno.test("opaque keys, invalid Auth sessions and excessive policies never issue credentials", async () => {
  const h = mock(() => {
    throw Error("not reached");
  });
  for (const token of [rawKey, "service-key-without-user-session"]) {
    const result = await issueScopedCredential(
      h.db,
      async () => ({ id: actor }),
      token,
      {
        operations,
        ttlSeconds: 600,
        requestsPerMinute: 5,
        declaredUnitBudget: 10,
      },
    );
    assert.equal(result.ok, false);
    assert.equal(h.calls.length, 0);
  }
  const invalid = await issueScopedCredential(h.db, async () => null, session, {
    operations,
    ttlSeconds: 600,
    requestsPerMinute: 5,
    declaredUnitBudget: 10,
  });
  assert.deepEqual(invalid, {
    ok: false,
    status: 401,
    error: "invalid_identity",
  });
  for (
    const policy of [{
      operations,
      ttlSeconds: 3601,
      requestsPerMinute: 5,
      declaredUnitBudget: 10,
    }, {
      operations: [...operations, ...operations],
      ttlSeconds: 60,
      requestsPerMinute: 5,
      declaredUnitBudget: 10,
    }, {
      operations,
      ttlSeconds: 60,
      requestsPerMinute: 5,
      declaredUnitBudget: 10,
      tenantId: actor,
    }]
  ) {
    const r = await issueScopedCredential(
      h.db,
      async () => ({ id: actor }),
      session,
      policy,
    );
    assert.equal(r.ok, false);
  }
  assert.equal(h.calls.length, 0);
});
Deno.test("key authentication derives principal and scope from DB and never creates a JWT", async () => {
  const h = mock((name, args) => {
    assert.equal(name, "sandy_api_authenticate_credential");
    assert.equal(args.p_credential_id, credential);
    assert.match(String(args.p_secret_sha256), /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(args).includes(rawKey), false);
    return {
      ok: true,
      credential_id: credential,
      principal_id: actor,
      tenant_id: null,
      allowed_operations: operations,
      expires_at: expires(),
      jwt: "must-not-escape",
      secret: "private",
    };
  });
  const result = await authenticateScopedCredential(h.db, rawKey);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    Object.keys(result.value).sort(),
    [
      "allowedOperations",
      "credentialId",
      "expiresAt",
      "kind",
      "principalId",
      "tenantId",
    ].sort(),
  );
  assert.equal(result.value.principalId, actor);
  assert.equal(result.value.kind, "api_key");
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
});
Deno.test("API key transport preserves Edge JWT gate and rejects mixed principals before lookup", async () => {
  const h = mock(() => ({
    ok: true,
    credential_id: credential,
    principal_id: actor,
    tenant_id: null,
    allowed_operations: operations,
    expires_at: expires(),
  }));
  for (const bearer of ["service-role-jwt", session, rawKey]) {
    const result = await resolveApiKeyRequest(
      h.db,
      new Request("https://api.invalid", {
        headers: {
          authorization: `Bearer ${bearer}`,
          "x-sandy-api-key": rawKey,
        },
      }),
      "public-anon-jwt",
    );
    assert.deepEqual(result, {
      ok: false,
      status: 401,
      error: "api_key_transport_requires_anon_bearer",
    });
  }
  assert.equal(h.calls.length, 0);
  const absent = await resolveApiKeyRequest(
    h.db,
    new Request("https://api.invalid", {
      headers: { authorization: `Bearer ${session}` },
    }),
    "public-anon-jwt",
  );
  assert.equal(absent, null);
  const good = await resolveApiKeyRequest(
    h.db,
    new Request("https://api.invalid", {
      headers: {
        authorization: "Bearer public-anon-jwt",
        "x-sandy-api-key": rawKey,
      },
    }),
    "public-anon-jwt",
  );
  assert.equal(good?.ok, true);
  assert.equal(h.calls.length, 1);
});
Deno.test("invalid or expired key responses fail closed without leaking RPC diagnostics", async () => {
  const denial = mock(() => ({
    ok: false,
    error: "invalid_api_credential",
    http_status: 401,
    secret: "private",
  }));
  assert.deepEqual(await authenticateScopedCredential(denial.db, rawKey), {
    ok: false,
    status: 401,
    error: "invalid_api_credential",
  });
  const malformed = mock(() => ({
    ok: true,
    credential_id: credential,
    principal_id: actor,
    tenant_id: null,
    allowed_operations: operations,
    expires_at: new Date(0).toISOString(),
    secret: "private",
  }));
  assert.deepEqual(await authenticateScopedCredential(malformed.db, rawKey), {
    ok: false,
    status: 503,
    error: "policy_response_invalid",
  });
});
const input = () => ({
  actorId: actor,
  tenantId: null,
  operation: operations[0],
  arguments: { z: "fixture-private-content", a: 1 },
  requestId: request,
  contractSha256: "c".repeat(64),
  scope: { provider: "supabase", project_ref: "zmqlyygzqoidkcwdysok" },
} as const);
Deno.test("execution admission binds shared canonical digests without persisting raw arguments", async () => {
  const h = mock((name, args) => {
    assert.equal(name, "sandy_api_admit_execution");
    assert.equal(args.p_actor_id, actor);
    assert.equal(args.p_request_id, request);
    return {
      ok: true,
      allowed: true,
      reused: false,
      admission_id: admission,
      grant_id: grant,
      state: "admitted",
      expires_at: expires(),
      executed: false,
    };
  });
  const result = await admitExecution(h.db, input());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    h.calls[0].args.p_input_sha256,
    await argumentDigest({ a: 1, z: "fixture-private-content" }),
  );
  assert.equal(
    JSON.stringify(h.calls).includes("fixture-private-content"),
    false,
  );
  assert.equal(result.value.inputSha256, h.calls[0].args.p_input_sha256);
  assert.equal(result.value.admissionId, admission);
});
Deno.test("replayed and ambiguous admissions never authorize a second dispatch", async () => {
  const replay = mock(() => ({
    ok: true,
    allowed: false,
    reused: true,
    admission_id: admission,
    grant_id: grant,
    state: "consumed",
    expires_at: expires(),
    executed: false,
  }));
  assert.deepEqual(await admitExecution(replay.db, input()), {
    ok: false,
    status: 409,
    error: "admission_already_recorded",
  });
  const uncertain: PolicyDb = {
    rpc() {
      return Promise.reject(Error("secret connection diagnostics"));
    },
  };
  assert.deepEqual(await admitExecution(uncertain, input()), {
    ok: false,
    status: 503,
    error: "policy_outcome_unknown",
    reconciliationRequired: true,
  });
});
Deno.test("grant consumption binds every scope field and rejects reused/malformed receipts", async () => {
  const h = mock(() => ({
    ok: true,
    allowed: true,
    reused: false,
    admission_id: admission,
    executed: false,
  }));
  const proof = {
    ...input(),
    admissionId: admission,
    grantId: grant,
    inputSha256: "a".repeat(64),
    scopeSha256: "b".repeat(64),
    expiresAt: expires(),
  };
  const result = await consumeExecutionGrant(h.db, proof);
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls[0], {
    name: "sandy_api_consume_execution_grant",
    args: {
      p_grant_id: grant,
      p_actor_id: actor,
      p_tenant_id: null,
      p_operation: operations[0],
      p_input_sha256: "a".repeat(64),
      p_request_id: request,
      p_contract_sha256: "c".repeat(64),
      p_scope_sha256: "b".repeat(64),
    },
  });
  const malformed = mock(() => ({
    ok: true,
    allowed: true,
    reused: true,
    admission_id: admission,
  }));
  const rejected = await consumeExecutionGrant(malformed.db, proof);
  assert.equal(rejected.ok, false);
});
Deno.test("accepted dispatch is distinct from completed outcome and receipt conflicts stay errors", async () => {
  const h = mock((name, args) => {
    assert.equal(name, "sandy_api_finish_execution");
    return {
      ok: true,
      admission_id: admission,
      state: args.p_outcome,
      reused: false,
      raw_result: "must-not-escape",
    };
  });
  const accepted = await finishExecution(
    h.db,
    admission,
    "accepted",
    202,
    "opaque-request-id",
    "d".repeat(64),
  );
  assert.deepEqual(accepted, {
    ok: true,
    value: { admissionId: admission, state: "accepted", reused: false },
  });
  assert.equal(JSON.stringify(accepted).includes("must-not-escape"), false);
  const conflict = mock(() => ({
    ok: false,
    error: "mutation_readback_required",
    http_status: 409,
  }));
  assert.deepEqual(
    await finishExecution(
      conflict.db,
      admission,
      "succeeded",
      200,
      null,
      "d".repeat(64),
    ),
    { ok: false, status: 409, error: "mutation_readback_required" },
  );
});
Deno.test("revocation derives actor from Auth session and projects only its receipt", async () => {
  const h = mock((name, args) => {
    assert.equal(name, "sandy_api_revoke_credential");
    assert.deepEqual(args, { p_actor_id: actor, p_credential_id: credential });
    return {
      ok: true,
      credential_id: credential,
      revoked: true,
      already_revoked: true,
      secret: "private",
    };
  });
  assert.deepEqual(
    await revokeScopedCredential(
      h.db,
      async () => ({ id: actor }),
      session,
      credential,
    ),
    {
      ok: true,
      value: {
        credential_id: credential,
        revoked: true,
        already_revoked: true,
      },
    },
  );
});

Deno.test("receipt recovery projects only owned evidence and never dispatches a lost reply", async () => {
  const h = mock((name, args) => {
    assert.equal(name, "sandy_api_get_execution_receipt");
    assert.deepEqual(args, {
      p_actor_id: actor,
      p_request_id: request,
      p_credential_id: credential,
    });
    return {
      ok: true,
      admission_id: admission,
      request_id: request,
      operation: operations[0],
      request_state: "consumed",
      accepted: false,
      executed: null,
      completed: false,
      outcome: "pending",
      provider_http_status: null,
      provider_request_id_sha256: null,
      result_sha256: null,
      reconciliation_required: true,
      redispatch_permitted: false,
      created_at: expires(),
      finished_at: null,
      grant_id: "must-not-escape",
      input_sha256: "internal",
      secret_sha256: "private",
    };
  });
  const result = await getExecutionReceipt(h.db, actor, request, credential);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.executed, null);
    assert.equal(result.value.reconciliation_required, true);
    assert.equal(result.value.redispatch_permitted, false);
  }
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
  assert.equal(JSON.stringify(result).includes("internal"), false);
  assert.equal(JSON.stringify(result).includes("private"), false);
});
Deno.test("receipt lookup refuses cross-principal evidence and false completion responses", async () => {
  const denied = mock(() => ({
    ok: false,
    error: "admission_not_found",
    http_status: 404,
  }));
  assert.deepEqual(
    await getExecutionReceipt(denied.db, actor, request, credential),
    { ok: false, status: 404, error: "admission_not_found" },
  );
  const invalid = mock(() => ({
    ok: true,
    admission_id: admission,
    request_id: request,
    operation: operations[0],
    request_state: "accepted",
    accepted: true,
    executed: true,
    completed: true,
    outcome: "accepted",
    provider_http_status: 202,
    provider_request_id_sha256: null,
    result_sha256: "a".repeat(64),
    reconciliation_required: true,
    redispatch_permitted: false,
    created_at: expires(),
    finished_at: expires(),
  }));
  const result = await getExecutionReceipt(invalid.db, actor, request);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "policy_response_invalid");
});

Deno.test("ambiguous issuance receipts retain only the safe revocation reference", async () => {
  const h = mock(() => ({ ok: true, credential_id: credential }));
  const result = await issueScopedCredential(
    h.db,
    async () => ({ id: actor }),
    session,
    {
      operations,
      ttlSeconds: 600,
      requestsPerMinute: 5,
      declaredUnitBudget: 10,
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reconciliationRequired, true);
    assert.equal(result.credentialId, h.calls[0].args.p_credential_id);
  }
  assert.equal(JSON.stringify(result).includes("sandy_api_"), false);
});
