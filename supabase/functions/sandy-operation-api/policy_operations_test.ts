import assert from "node:assert/strict";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  executePolicyOperation,
  isPolicyOperation,
  policyContractMatches,
  type PolicyOperationContext,
  policyOperationContracts,
  requiresPolicyUserJWT,
} from "./policy_operations.ts";
const actor = "20000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const credential = "20000000-0000-4000-8000-000000000003";
const request = "20000000-0000-4000-8000-000000000004";
const admission = "20000000-0000-4000-8000-000000000005";
const token = "verified.user.session";
const user: PolicyOperationContext = {
  kind: "user",
  actorId: actor,
  userJWT: token,
};
const issueArgs = {
  operations: ["supabase.projects.get"],
  ttl_seconds: 300,
  requests_per_minute: 5,
  declared_unit_budget: 20,
};
function harness(
  answer: (name: string, args: Record<string, unknown>) => unknown = () => ({
    ok: false,
    error: "owner_required",
    http_status: 403,
  }),
  identity: string | null = actor,
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const sessions: string[] = [];
  return {
    calls,
    sessions,
    dependencies: {
      db: {
        rpc(name: string, args: Record<string, unknown>) {
          calls.push({ name, args });
          return Promise.resolve().then(() => ({
            data: answer(name, args),
            error: null,
          }));
        },
      },
      verifySession: async (bearer: string) => {
        sessions.push(bearer);
        return identity ? { id: identity } : null;
      },
    },
  };
}
const event = {
  sequence: 1,
  id: admission,
  occurred_at: "2026-10-20T00:00:00Z",
  actor_id: actor,
  operation: "supabase.projects.get",
  request_id: request,
  credential_id: null,
  admission_id: admission,
  phase: "execution",
  outcome: "succeeded",
  input_sha256: "1".repeat(64),
  result_sha256: "2".repeat(64),
  provider_http_status: 200,
  provider_request_id_sha256: "3".repeat(64),
  previous_sha256: "0".repeat(64),
  event_sha256: "4".repeat(64),
  format: "pg_jsonb_v1",
};
Deno.test("policy operations have strict typed contracts and fixed registry matching", () => {
  const ajv = new Ajv({ strict: true, validateFormats: true });
  for (const [name, format] of Object.entries(fullFormats)) {
    ajv.addFormat(name, format);
  }
  assert.equal(Object.keys(policyOperationContracts).length, 6);
  for (
    const [operation, contract] of Object.entries(policyOperationContracts)
  ) {
    ajv.compile(contract.input_schema);
    ajv.compile(contract.output_schema);
    assert.equal(isPolicyOperation(operation), true);
    const entry = { handler: "sandy-operation-api", ...contract };
    assert.equal(policyContractMatches(operation, entry), true);
    assert.equal(
      policyContractMatches(operation, { ...entry, handler: "caller-rpc" }),
      false,
    );
    assert.equal(
      policyContractMatches(operation, {
        ...entry,
        input_schema: { type: "object" },
      }),
      false,
    );
    assert.equal(
      requiresPolicyUserJWT(operation),
      operation !== "system.execution.get",
    );
  }
  assert.equal(isPolicyOperation("system.arbitrary.rpc"), false);
});
Deno.test("credential issuance verifies the bound normal user and returns a secret only once without persisting it", async () => {
  const h = harness((_name, args) => ({
    ok: true,
    credential_id: args.p_credential_id,
    principal_id: actor,
    tenant_id: null,
    allowed_operations: args.p_allowed_operations,
    expires_at: new Date(Date.now() + 300000).toISOString(),
    requests_per_minute: args.p_requests_per_minute,
    declared_unit_budget: args.p_declared_unit_budget,
    secret_sha256: args.p_secret_sha256,
    private_grant: "private-db-material",
  }));
  const response = await executePolicyOperation(
    h.dependencies,
    user,
    "system.credentials.issue",
    issueArgs,
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.display_once, true);
  assert.match(body.api_key, /^sandy_api_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(body.principal_id, actor);
  assert.deepEqual(h.sessions, [token]);
  assert.deepEqual(h.calls.map((call) => call.name), [
    "sandy_api_issue_credential",
  ]);
  assert.equal(h.calls[0].args.p_actor_id, actor);
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(body.api_key),
      ),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
  assert.equal(h.calls[0].args.p_secret_sha256, hash);
  assert.equal(JSON.stringify(h.calls).includes(body.api_key), false);
  assert.equal(JSON.stringify(body).includes("private-db-material"), false);
  assert.equal(Object.hasOwn(body, "secret_sha256"), false);
});
Deno.test("API keys, worker leases, actor changes and malformed inputs cannot administer credentials or audit", async () => {
  for (
    const operation of Object.keys(policyOperationContracts).filter((id) =>
      id !== "system.execution.get"
    )
  ) {
    const args = operation === "system.credentials.issue"
      ? issueArgs
      : operation === "system.credentials.revoke"
      ? { credential_id: credential }
      : {};
    for (const kind of ["api_key", "job_lease"] as const) {
      const h = harness();
      const response = await executePolicyOperation(
        h.dependencies,
        { ...user, kind, credentialId: credential },
        operation,
        args,
      );
      assert.equal(response.status, kind === "job_lease" ? 403 : 401);
      assert.equal(h.calls.length, 0);
      assert.equal(h.sessions.length, 0);
    }
  }
  const changed = harness(undefined, other);
  assert.equal(
    (await executePolicyOperation(
      changed.dependencies,
      user,
      "system.credentials.issue",
      issueArgs,
    )).status,
    401,
  );
  assert.equal(changed.calls.length, 0);
  for (
    const args of [{ ...issueArgs, actor_id: other }, {
      ...issueArgs,
      ttl_seconds: 3601,
    }, {
      ...issueArgs,
      operations: ["supabase.projects.get", "supabase.projects.get"],
    }, { ...issueArgs, rpc: "arbitrary" }]
  ) {
    const h = harness();
    assert.equal(
      (await executePolicyOperation(
        h.dependencies,
        user,
        "system.credentials.issue",
        args,
      )).status,
      400,
    );
    assert.equal(h.calls.length, 0);
    assert.equal(h.sessions.length, 0);
  }
});
Deno.test("lost issuance returns only a revocable identifier and never a credential secret or raw diagnostic", async () => {
  const h = harness(() => {
    throw Error("private-db-diagnostic");
  });
  const response = await executePolicyOperation(
    h.dependencies,
    user,
    "system.credentials.issue",
    issueArgs,
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.reconciliation_required, true);
  assert.equal(body.credential_id, h.calls[0].args.p_credential_id);
  assert.equal(Object.hasOwn(body, "api_key"), false);
  assert.equal(JSON.stringify(body).includes("private-db-diagnostic"), false);
  const revoke = harness(() => ({
    ok: true,
    credential_id: credential,
    revoked: true,
    already_revoked: true,
    secret_sha256: "private",
  }));
  const revoked = await executePolicyOperation(
    revoke.dependencies,
    user,
    "system.credentials.revoke",
    { credential_id: credential },
  );
  assert.equal(revoked.status, 200);
  assert.deepEqual(await revoked.json(), {
    ok: true,
    contract_version: "1.0.0",
    credential_id: credential,
    revoked: true,
    already_revoked: true,
  });
  assert.equal(revoke.calls[0].args.p_actor_id, actor);
});
Deno.test("audit list projects digest-only events, exclusive cursor and operation filtering without leaking unexpected fields", async () => {
  const h = harness(() => ({
    ok: true,
    events: [{
      ...event,
      grant_id: "private-grant",
      raw_arguments: "private-arguments",
    }],
    limit: 1,
    possibly_truncated: true,
    external_anchor_established: false,
    api_key: "private-key",
  }));
  const response = await executePolicyOperation(
    h.dependencies,
    user,
    "system.audit.list",
    { after_sequence: 0, limit: 1, operation: event.operation },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.events, [event]);
  assert.equal(body.next_sequence, 1);
  assert.equal(body.external_anchor_established, false);
  assert.deepEqual(h.calls[0], {
    name: "sandy_api_read_audit",
    args: {
      p_actor_id: actor,
      p_after_sequence: 0,
      p_limit: 1,
      p_operation: event.operation,
    },
  });
  assert.equal(JSON.stringify(body).includes("private-"), false);
  const invalid = harness(() => ({
    ok: true,
    events: [event, event],
    limit: 2,
    possibly_truncated: true,
    external_anchor_established: false,
  }));
  assert.equal(
    (await executePolicyOperation(
      invalid.dependencies,
      user,
      "system.audit.list",
      { limit: 2 },
    )).status,
    503,
  );
  const denied = harness();
  const denial = await executePolicyOperation(
    denied.dependencies,
    user,
    "system.audit.list",
    {},
  );
  assert.equal(denial.status, 403);
  assert.equal((await denial.json()).error, "owner_required");
});
Deno.test("audit checkpoints bind the verified actor, never imply an external anchor, and preserve unknown write outcomes", async () => {
  const checkpoint = {
    id: admission,
    sequence: 1,
    event_sha256: event.event_sha256,
    recorded_at: event.occurred_at,
    recorded_by: actor,
  };
  const limitation =
    "Database administrators can rewrite both chain and checkpoints; retain checkpoint externally for independent trust";
  const h = harness(() => ({
    ok: true,
    checkpoint: { ...checkpoint, grant_id: "private" },
    external_anchor_established: false,
    limitation,
  }));
  const response = await executePolicyOperation(
    h.dependencies,
    user,
    "system.audit.checkpoint",
    {},
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).checkpoint, checkpoint);
  assert.deepEqual(h.calls[0], {
    name: "sandy_api_checkpoint_audit",
    args: { p_actor_id: actor },
  });
  const lost = harness(() => {
    throw Error("private-diagnostic");
  });
  const unknown = await executePolicyOperation(
    lost.dependencies,
    user,
    "system.audit.checkpoint",
    {},
  );
  assert.equal(unknown.status, 503);
  assert.deepEqual(await unknown.json(), {
    ok: false,
    error: "policy_outcome_unknown",
    reconciliation_required: true,
  });
});
Deno.test("audit verification reports bounded/incomplete scans and actual failures without claiming independent trust", async () => {
  const h = harness(() => ({
    ok: true,
    valid: true,
    checked_events: 1,
    last_sequence: 1,
    last_sha256: event.event_sha256,
    complete: false,
    external_anchor_established: false,
    caller_supplied_anchor: true,
  }));
  const response = await executePolicyOperation(
    h.dependencies,
    user,
    "system.audit.verify",
    { limit: 1, expected_previous_sha256: event.previous_sha256 },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.valid, true);
  assert.equal(body.complete, false);
  assert.equal(body.caller_supplied_anchor, true);
  assert.equal(body.external_anchor_established, false);
  assert.deepEqual(h.calls[0], {
    name: "sandy_api_verify_audit",
    args: {
      p_actor_id: actor,
      p_after_sequence: 0,
      p_expected_previous_sha256: event.previous_sha256,
      p_limit: 1,
    },
  });
  const broken = harness(() => ({
    ok: true,
    valid: false,
    failed_sequence: 8,
    checked_events: 7,
    external_anchor_established: false,
  }));
  const brokenBody = await (await executePolicyOperation(
    broken.dependencies,
    user,
    "system.audit.verify",
    {},
  )).json();
  assert.equal(brokenBody.valid, false);
  assert.equal(brokenBody.reason, "chain_hash_mismatch");
  assert.equal(brokenBody.failed_sequence, 8);
  assert.equal(brokenBody.complete, false);
  const mismatch = harness(() => ({
    ok: false,
    error: "audit_anchor_mismatch",
    valid: false,
    http_status: 409,
    private: "secret",
  }));
  const mismatchResponse = await executePolicyOperation(
    mismatch.dependencies,
    user,
    "system.audit.verify",
    {},
  );
  assert.equal(mismatchResponse.status, 409);
  assert.deepEqual(await mismatchResponse.json(), {
    ok: false,
    error: "audit_anchor_mismatch",
  });
  const invalid = harness(() => ({
    ok: false,
    error: "private-db-diagnostic",
    http_status: 403,
  }));
  assert.deepEqual(
    await (await executePolicyOperation(
      invalid.dependencies,
      user,
      "system.audit.verify",
      {},
    )).json(),
    { ok: false, error: "policy_response_invalid" },
  );
});
Deno.test("execution receipts preserve exact API-key ownership and never admit or redispatch work", async () => {
  const receipt = {
    ok: true,
    admission_id: admission,
    request_id: request,
    operation: event.operation,
    request_state: "unknown",
    accepted: false,
    executed: null,
    completed: false,
    outcome: "unknown",
    provider_http_status: null,
    provider_request_id_sha256: null,
    result_sha256: null,
    reconciliation_required: true,
    redispatch_permitted: false,
    created_at: event.occurred_at,
    finished_at: event.occurred_at,
  };
  const h = harness(() => ({ ...receipt, grant_id: "private" }));
  const response = await executePolicyOperation(
    h.dependencies,
    { kind: "api_key", actorId: actor, credentialId: credential },
    "system.execution.get",
    { request_id: request },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), receipt);
  assert.deepEqual(h.calls, [{
    name: "sandy_api_get_execution_receipt",
    args: {
      p_actor_id: actor,
      p_request_id: request,
      p_credential_id: credential,
    },
  }]);
  assert.equal(h.sessions.length, 0);
  const invalid = harness();
  assert.equal(
    (await executePolicyOperation(
      invalid.dependencies,
      { kind: "api_key", actorId: actor },
      "system.execution.get",
      { request_id: request },
    )).status,
    401,
  );
  assert.equal(invalid.calls.length, 0);
});
