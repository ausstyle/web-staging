import { strict as assert } from "node:assert";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import catalogue from "./financial_redaction_contracts.json" with {
  type: "json",
};
import manifest from "./financial_redaction_manifest.json" with {
  type: "json",
};
import consent from "./consent_redaction_contract.json" with { type: "json" };
import {
  financialRedactionExecutionScope,
  financialRedactionResultMatches,
} from "./financial_redaction_contracts.ts";
import { executeRedactionConsent } from "./consent_redaction.ts";
const tenant = "11111111-1111-4111-8111-111111111111",
  policy = "22222222-2222-4222-8222-222222222222",
  record = "33333333-3333-4333-8333-333333333333",
  reference = "44444444-4444-4444-8444-444444444444";
const ajv = new Ajv({ strict: true, allowUnionTypes: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const base = {
  tenant_id: tenant,
  manifest: manifest.id,
  expected_manifest_sha256: manifest.manifest_sha256,
};
Deno.test("redaction: five exact source contracts compile and expose only bounded owner policy actions", async () => {
  assert.equal(catalogue.operations.length, 5);
  assert.equal(await argumentDigest(catalogue.scope), catalogue.scope_sha256);
  for (const op of catalogue.operations) {
    const { contract_sha256, ...body } = op;
    assert.equal(await argumentDigest(body), contract_sha256);
    ajv.compile(op.input_schema);
    ajv.compile(op.output_schema);
    assert.equal(op.requires_approval, true);
    assert.equal(
      financialRedactionExecutionScope(op.operation).manifest,
      manifest.id,
    );
  }
  assert.throws(() =>
    financialRedactionExecutionScope(
      "supabase.tenant.financial.redaction.restore",
    )
  );
  const create = ajv.compile(catalogue.operations[0].input_schema);
  const args = {
    ...base,
    resource: "sandy_commerce_accounts",
    record_ids: [record],
    source_cutoff: "2026-10-21T00:00:00Z",
    effective_at: "2026-10-21T00:00:00Z",
    expires_at: "2026-10-22T00:00:00Z",
    basis: "subject_data_request",
    policy_reference: reference,
    acknowledge_retained_financial_records: true,
    acknowledge_retained_control_copies: true,
  };
  assert(create(args));
  for (
    const patch of [
      { resource: "sandy_api_credentials" },
      { record_ids: [] },
      { record_ids: [record, record] },
      { record_ids: Array(1001).fill(record) },
      { sql: "DELETE FROM auth.users" },
      { service_role: "DO_NOT_DISCLOSE" },
      { acknowledge_retained_control_copies: false },
    ]
  ) assert(!create({ ...args, ...patch }));
  assert.equal(manifest.restore_supported, false);
  assert.equal(manifest.retained_control_copies, true);
  assert.equal(manifest.resources.length, 6);
  assert(
    manifest.replacement_text.length > 0 &&
      manifest.replacement_text.length <= 1000,
  );
});
Deno.test("redaction: result scope binds exact tenant policy resource count reference and approved before hash", () => {
  const operation = "supabase.tenant.financial.redaction.policies.create";
  const args = {
    ...base,
    resource: "sandy_commerce_accounts",
    record_ids: [record],
    policy_reference: reference,
    basis: "subject_data_request",
  };
  const result = {
    tenant_id: tenant,
    policy_id: policy,
    manifest: manifest.id,
    manifest_sha256: manifest.manifest_sha256,
    schema_sha256: manifest.schema_sha256,
    resource: "sandy_commerce_accounts",
    record_count: 1,
    policy_reference: reference,
    basis: "subject_data_request",
  };
  assert(financialRedactionResultMatches(operation, args, result));
  for (
    const patch of [
      { tenant_id: policy },
      { resource: "sandy_commerce_entries" },
      { record_count: 2 },
      { policy_reference: record },
      { basis: "approved_retention_schedule" },
    ]
  ) {
    assert(
      !financialRedactionResultMatches(operation, args, {
        ...result,
        ...patch,
      }),
    );
  }
  const apply = "supabase.tenant.financial.redaction.apply",
    applyArgs = {
      ...base,
      policy_id: policy,
      expected_current_sha256: "a".repeat(64),
    };
  assert(
    financialRedactionResultMatches(apply, applyArgs, {
      ...result,
      state: "applied",
      before_sha256: "a".repeat(64),
    }),
  );
  assert(
    !financialRedactionResultMatches(apply, applyArgs, {
      ...result,
      state: "applied",
      before_sha256: "b".repeat(64),
    }),
  );
  assert(
    !financialRedactionResultMatches(apply, applyArgs, {
      ...result,
      policy_id: record,
      state: "applied",
      before_sha256: "a".repeat(64),
    }),
  );
});
Deno.test("redaction: all73 consent choices remain explicit actual-user SQL policy with no automatic erasure grant", async () => {
  const { contract_sha256, ...body } = consent.operations.set;
  assert.equal(await argumentDigest(body), contract_sha256);
  const operations =
    consent.operations.set.input_schema.properties.operations.items.enum;
  assert.equal(operations.length, 73);
  assert.equal(new Set(operations).size, 73);
  const args = {
    operations,
    approved_emails: [],
    allow_erasure: false,
    expires_at: "2026-10-22T00:00:00Z",
  };
  const reply = {
    ok: true,
    tenant_id: tenant,
    operations,
    approved_emails: [],
    allow_erasure: false,
    expires_at: args.expires_at,
    revision: 1,
    legal_hold: false,
    retention_until: null,
  };
  let calls = 0;
  const response = await executeRedactionConsent(
    {
      rpc: async (name, params) => {
        calls++;
        assert.equal(name, "sandy_supabase_tenant_consent_set");
        assert.equal(params.p_allow_erasure, false);
        assert.deepEqual(params.p_operations, operations);
        return { data: reply, error: null };
      },
    },
    "supabase.tenant.consent.set",
    args,
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual((await response.json()).operations, operations);
  assert.equal(
    (await executeRedactionConsent(
      {
        rpc: async () => ({
          data: { ok: false, http_status: 403 },
          error: null,
        }),
      },
      "supabase.tenant.consent.set",
      args,
    )).status,
    403,
  );
  const rejected = await executeRedactionConsent(
    {
      rpc: async () => {
        throw Error("must not dispatch");
      },
    },
    "supabase.tenant.consent.set",
    { ...args, operations: ["supabase.tenant.financial.redaction.restore"] },
  );
  assert.equal(rejected.status, 400);
});
