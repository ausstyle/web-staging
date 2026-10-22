import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  executeRecoveryConsent,
  recoveryConsentOverrides,
} from "./consent_recovery.ts";
import revised from "./consent_recovery_contract.json" with { type: "json" };
const operations =
  revised.operations.set.input_schema.properties.operations.items.enum;
const policy = {
  ok: true,
  tenant_id: "00000000-0000-4000-8000-000000000001",
  operations,
  approved_emails: [],
  allow_erasure: false,
  expires_at: "2026-10-22T00:00:00Z",
  revision: 1,
  legal_hold: false,
  retention_until: null,
};
const args = {
  operations,
  approved_emails: [],
  allow_erasure: false,
  expires_at: "2026-10-22T00:00:00Z",
};
const db = (data: unknown) => ({
  rpc: () => Promise.resolve({ data, error: null }),
});
Deno.test("both real-user consent contracts bind the new bounded getter and setter schemas", async () => {
  for (const descriptor of Object.values(recoveryConsentOverrides)) {
    const { contract_sha256, ...body } = descriptor;
    equal(await argumentDigest(body), contract_sha256);
  }
  equal(operations.length, 65);
  equal(
    recoveryConsentOverrides["supabase.tenant.consent.get"].output_schema
      .properties.operations.maxItems,
    128,
  );
});
Deno.test("all65 explicitly reviewed names roundtrip through both setter and getter without truncation", async () => {
  let call: unknown;
  const reply = await executeRecoveryConsent(
    {
      rpc: (name, parameters) => {
        call = { name, parameters };
        return Promise.resolve({ data: policy, error: null });
      },
    },
    "supabase.tenant.consent.set",
    args,
  );
  equal(reply.status, 200);
  equal(await reply.json(), policy);
  equal(call, {
    name: "sandy_supabase_tenant_consent_set",
    parameters: {
      p_operations: operations,
      p_approved_emails: [],
      p_allow_erasure: false,
      p_expires_at: args.expires_at,
    },
  });
  const read = await executeRecoveryConsent(
    db(policy),
    "supabase.tenant.consent.get",
    {},
  );
  equal(read.status, 200);
  equal(await read.json(), policy);
});
Deno.test("consent remains explicit bounded and rejects arbitrary roles SQL caller identities and duplicate grants", async () => {
  let called = false;
  const blocked = {
    rpc: () => {
      called = true;
      return Promise.resolve({ data: policy, error: null });
    },
  };
  for (
    const change of [
      { actor_id: policy.tenant_id },
      { tenant_id: policy.tenant_id },
      { service_key: "fixture-secret" },
      { operations: ["sql.execute"] },
      { operations: Array(129).fill(operations[0]) },
      { operations: [operations[0], operations[0]] },
      { operations: [[operations[0]]] },
    ]
  ) {
    equal(
      (await executeRecoveryConsent(blocked, "supabase.tenant.consent.set", {
        ...args,
        ...change,
      })).status,
      400,
    );
  }
  equal(called, false);
});
Deno.test("session refusal and unexpected secret fields stay private", async () => {
  equal(
    (await executeRecoveryConsent(
      db({ ok: false, http_status: 403 }),
      "supabase.tenant.consent.get",
      {},
    )).status,
    403,
  );
  const reply = await executeRecoveryConsent(
    db({ ...policy, token: "fixture-secret" }),
    "supabase.tenant.consent.get",
    {},
  );
  equal(reply.status, 502);
  assert(!(await reply.text()).includes("fixture-secret"));
});
