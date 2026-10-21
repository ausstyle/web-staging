import assert from "node:assert/strict";
import {
  authorizeWorkloadControl,
  workloadRegistrationAllowed,
} from "./workload.ts";
const USER = "10000000-0000-4000-8000-000000000001",
  SESSION = "20000000-0000-4000-8000-000000000001",
  OWNER = "30000000-0000-4000-8000-000000000001";
const user = { id: USER, app_metadata: { sandy_engineering_test: true } };
const claims = {
  sub: USER,
  role: "authenticated",
  aud: "authenticated",
  session_id: SESSION,
  app_metadata: { sandy_engineering_test: true, sandy_engineering_epoch: 2 },
};
const token = (value: unknown) =>
  "fixture." + btoa(JSON.stringify(value)) + ".not-a-real-signature";
const allowed = {
  ok: true,
  owner_authority_id: OWNER,
  scope_prefixes: ["github:ausstyle/web-staging:", "sandy-agent-runtime-v4"],
  allowed_risks: ["low", "normal"],
};
function db(data: any = allowed, error: any = null) {
  const calls: any[] = [];
  return {
    calls,
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data, error };
    },
  };
}
Deno.test("verified workload uses the existing session/epoch resolver and records its own identity", async () => {
  const store = db(),
    grant = await authorizeWorkloadControl(user, token(claims), {
      action: "register",
    }, store);
  assert.ok(grant);
  assert.equal(grant.ownerId, OWNER);
  assert.deepEqual(store.calls, [{
    name: "sandy_engineering_resolve_control_grant",
    args: {
      p_user_id: USER,
      p_session_id: SESSION,
      p_epoch: 2,
      p_action: "register",
    },
  }]);
});
Deno.test("owner approvals, status changes, deployment and rollback are outside the workload grant", async () => {
  for (
    const action of [
      "status",
      "auto_approve",
      "approve_job",
      "execute_job",
      "implementation_request",
      "rollback_request",
      "preflight",
    ]
  ) {
    const store = db();
    assert.equal(
      await authorizeWorkloadControl(user, token(claims), { action }, store),
      null,
    );
    assert.equal(store.calls.length, 0);
  }
});
Deno.test("serialized human identity, mismatched subject/session/epoch and anonymous JWT fail before grant resolution", async () => {
  for (
    const value of [
      { ...claims, sub: OWNER },
      { ...claims, session_id: "forged" },
      { ...claims, role: "service_role" },
      { ...claims, is_anonymous: true },
      {
        ...claims,
        app_metadata: {
          sandy_engineering_test: true,
          sandy_engineering_epoch: 1.5,
        },
      },
    ]
  ) {
    const store = db();
    assert.equal(
      await authorizeWorkloadControl(
        user,
        token(value),
        { action: "register" },
        store,
      ),
      null,
    );
    assert.equal(store.calls.length, 0);
  }
  const store = db();
  assert.equal(
    await authorizeWorkloadControl({ id: OWNER }, token(claims), {
      action: "register",
    }, store),
    null,
  );
});
Deno.test("revocation, changed owner, expired grant and unavailable policy fail closed", async () => {
  for (
    const value of [
      { ok: false, error: "revoked" },
      { ...allowed, owner_authority_id: "invalid" },
      { ...allowed, scope_prefixes: [""] },
      null,
    ]
  ) {
    assert.equal(
      await authorizeWorkloadControl(user, token(claims), {
        action: "register",
      }, db(value)),
      null,
    );
  }
  assert.equal(
    await authorizeWorkloadControl(
      user,
      token(claims),
      { action: "register" },
      db(allowed, { code: "unavailable" }),
    ),
    null,
  );
});
Deno.test("registration allows exact approved components and bounded repository prefix only", () => {
  const grant = {
    ownerId: OWNER,
    scopePrefixes: allowed.scope_prefixes,
    risks: allowed.allowed_risks,
  };
  assert.equal(
    workloadRegistrationAllowed({
      scope: [
        "github:ausstyle/web-staging:supabase/functions/sandy-agent-runtime-v4",
        "sandy-agent-runtime-v4",
      ],
      risk: "normal",
    }, grant),
    true,
  );
  for (
    const scope of [
      ["github:foreign/repo:a"],
      ["github:ausstyle/web-staging:"],
      ["sandy-agent-runtime-v4-other"],
      ["sandy-billing"],
      [],
      [null],
      Array(51).fill("sandy-agent-runtime-v4"),
    ]
  ) {
    assert.equal(
      workloadRegistrationAllowed({ scope, risk: "normal" }, grant),
      false,
    );
  }
  assert.equal(
    workloadRegistrationAllowed({
      scope: ["sandy-agent-runtime-v4"],
      risk: "critical",
    }, grant),
    false,
  );
});
