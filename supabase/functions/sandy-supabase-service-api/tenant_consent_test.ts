import {
  executeTenantConsent,
  type TenantConsentDb,
} from "./tenant_consent.ts";
import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
const policy = {
  ok: true,
  tenant_id: "00000000-0000-4000-8000-000000000002",
  operations: [],
  approved_emails: [],
  allow_erasure: false,
  expires_at: null,
  revision: 0,
  legal_hold: false,
  retention_until: null,
};
Deno.test("tenant policy accepts no caller tenant, actor or session replacement", async () => {
  let called = false;
  const db: TenantConsentDb = {
    rpc: () => {
      called = true;
      return Promise.resolve({ data: policy, error: null });
    },
  };
  for (
    const args of [{ tenant_id: policy.tenant_id }, {
      actor_id: policy.tenant_id,
    }, { access_token: "not-a-session" }]
  ) {
    equal(
      (await executeTenantConsent(db, "supabase.tenant.consent.get", args))
        .status,
      400,
    );
  }
  assert(!called);
});
Deno.test("tenant policy setter maps only explicit consent arguments to user-context RPC", async () => {
  const calls: unknown[] = [];
  const db: TenantConsentDb = {
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ data: policy, error: null });
    },
  };
  const args = {
    operations: ["supabase.storage.objects.get"],
    approved_emails: [],
    allow_erasure: false,
    expires_at: "2026-10-22T00:00:00Z",
  };
  const result = await executeTenantConsent(
    db,
    "supabase.tenant.consent.set",
    args,
  );
  equal(result.status, 200);
  equal(calls, [{
    name: "sandy_supabase_tenant_consent_set",
    args: {
      p_operations: args.operations,
      p_approved_emails: [],
      p_allow_erasure: false,
      p_expires_at: args.expires_at,
    },
  }]);
});
Deno.test("service/no-session database refusal is preserved without user impersonation", async () => {
  const db: TenantConsentDb = {
    rpc: () =>
      Promise.resolve({
        data: {
          ok: false,
          error: "confirmed_portal_customer_session_required",
          http_status: 403,
        },
        error: null,
      }),
  };
  const result = await executeTenantConsent(
    db,
    "supabase.tenant.consent.get",
    {},
  );
  equal(result.status, 403);
  assert(!(await result.text()).includes("access_token"));
});
Deno.test("arbitrary database payload is excluded from consent results", async () => {
  const db: TenantConsentDb = {
    rpc: () =>
      Promise.resolve({
        data: { ...policy, secret: "never-disclose" },
        error: null,
      }),
  };
  const result = await executeTenantConsent(
    db,
    "supabase.tenant.consent.get",
    {},
  );
  equal(result.status, 502);
  assert(!(await result.text()).includes("never-disclose"));
});
