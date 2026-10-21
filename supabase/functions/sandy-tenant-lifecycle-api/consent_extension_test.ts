import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import {
  executeLifecycleConsent,
  tenantLifecycleConsentOverride,
} from "./consent_extension.ts";
import type { TenantConsentDb } from "../sandy-supabase-service-api/tenant_consent.ts";
const tenant = "00000000-0000-4000-8000-000000000002";
const policy = {
  ok: true,
  tenant_id: tenant,
  operations: [],
  approved_emails: [],
  allow_erasure: false,
  expires_at: null,
  revision: 0,
  legal_hold: false,
  retention_until: null,
};
Deno.test("lifecycle consent uses the same actual-user RPC and ledger with a revised exact schema", async () => {
  const calls: unknown[] = [];
  const db: TenantConsentDb = {
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ data: policy, error: null });
    },
  };
  const args = {
    operations: [
      "supabase.tenant.export",
      "supabase.storage.objects.get",
      "supabase.tenant.protected_resources.inventory",
    ],
    approved_emails: [],
    allow_erasure: false,
    expires_at: "2026-10-22T00:00:00Z",
  };
  equal(
    (await executeLifecycleConsent(db, "supabase.tenant.consent.set", args))
      .status,
    200,
  );
  equal(calls, [{
    name: "sandy_supabase_tenant_consent_set",
    args: {
      p_operations: args.operations,
      p_approved_emails: [],
      p_allow_erasure: false,
      p_expires_at: args.expires_at,
    },
  }]);
  assert(tenantLifecycleConsentOverride.contract_sha256);
  equal(
    tenantLifecycleConsentOverride.input_schema.properties.operations.items.enum
      .length,
    52,
  );
});
Deno.test("lifecycle consent cannot authorize arbitrary SQL, credentials or an actor override", async () => {
  let called = false;
  const db: TenantConsentDb = {
    rpc: () => {
      called = true;
      return Promise.resolve({ data: policy, error: null });
    },
  };
  for (
    const patch of [
      { operations: ["system.credentials.activate"] },
      { tenant_id: tenant },
      { actor_id: tenant },
      { access_token: "not-an-auth-session" },
    ]
  ) {
    equal(
      (await executeLifecycleConsent(db, "supabase.tenant.consent.set", {
        operations: [],
        approved_emails: [],
        allow_erasure: false,
        expires_at: "2026-10-22T00:00:00Z",
        ...patch,
      })).status,
      400,
    );
  }
  equal(called, false);
});
