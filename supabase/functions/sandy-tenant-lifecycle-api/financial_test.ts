import { strict as assert } from "node:assert";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import contracts from "./financial_contracts.json" with { type: "json" };
import manifest from "./financial_manifest.json" with { type: "json" };
import consent from "./consent_financial_contract.json" with { type: "json" };
import {
  financialExportExecutionScope,
  financialExportOperations,
} from "./financial_contracts.ts";
import {
  executeFinancialExportAvailable,
  executeFinancialExportDownload,
  financialExportAvailableOperation,
  financialExportDownloadOperation,
} from "./financial_user.ts";
import { executeFinancialConsent } from "./consent_financial.ts";
const snapshot = "11111111-1111-4111-8111-111111111111",
  tenant = "22222222-2222-4222-8222-222222222222";
const ajv = new Ajv({ strict: true, allowUnionTypes: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const db = (data: unknown) => ({ rpc: async () => ({ data, error: null }) });
function metadata() {
  return {
    snapshot_id: snapshot,
    tenant_id: tenant,
    manifest: manifest.id,
    manifest_sha256: manifest.manifest_sha256,
    schema_sha256: manifest.schema_sha256,
    fragment_count: 10,
    row_counts: Object.fromEntries(manifest.tables.map((t) => [t.table, 0])),
    total_plaintext_bytes: 0,
    artifact_index_sha256: "a".repeat(64),
    state: "exported",
    created_at: "2026-10-21T00:00:00Z",
    expires_at: "2026-10-22T00:00:00Z",
    complete_tenant_coverage: false,
    external_provider_assets_included: false,
    erasure_supported: false,
    restore_supported: false,
    financial_source: "internal_commerce_records",
    provider_verified: false,
    payment_executed: false,
  };
}
async function download() {
  const payload = {
    manifest: manifest.id,
    manifest_sha256: manifest.manifest_sha256,
    schema_sha256: manifest.schema_sha256,
    tenant_id: tenant,
    snapshot_id: snapshot,
    table: "sandy_commerce_entry_lines",
    sequence: 0,
    table_sequence: 0,
    table_complete: true,
    table_row_count: 1,
    table_row_chain_sha256: "b".repeat(64),
    json_fragment: '{"debit_minor":"9223372036854775807"}\n',
    complete_tenant_coverage: false,
    external_provider_assets_included: false,
  };
  const artifact_json = JSON.stringify(payload),
    hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(artifact_json),
        ),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  return {
    ok: true,
    snapshot_id: snapshot,
    sequence: 0,
    artifact_json,
    artifact_sha256: hash,
  };
}
Deno.test("financial: all five contracts bind exact source hashes and closed read-only financial semantics", async () => {
  assert.equal(Object.keys(financialExportOperations).length, 3);
  for (
    const op of [
      ...contracts.operations,
      financialExportDownloadOperation,
      financialExportAvailableOperation,
    ]
  ) {
    const { contract_sha256, ...value } = op;
    assert.equal(await argumentDigest(value), contract_sha256);
    ajv.compile(op.input_schema);
    ajv.compile(op.output_schema);
  }
  assert.equal(await argumentDigest(contracts.scope), contracts.scope_sha256);
  assert.equal(
    financialExportExecutionScope("supabase.tenant.financial.export").manifest,
    manifest.id,
  );
  assert.throws(() =>
    financialExportExecutionScope("supabase.tenant.financial.erase")
  );
  assert.equal(manifest.tables.length, 10);
  assert.equal(manifest.erasure_supported, false);
  assert.equal(manifest.restore_supported, false);
  assert.equal(
    manifest.tables.find((t) => t.table === "sandy_commerce_entry_lines")
      ?.ownership_adapter,
    "financial_entry_customer",
  );
  assert(
    manifest.tables.flatMap((t) => t.columns).filter((c) =>
      ["bigint", "numeric(30,0)"].includes(c.type)
    ).every((c) => c.encoding === "decimal_integer_string"),
  );
});
Deno.test("financial: customer transport keeps exact decoded UTF8 hash and decimal strings in the standard payload", async () => {
  const result = await download();
  let calls = 0;
  const response = await executeFinancialExportDownload({
    rpc: async (name, args) => {
      calls++;
      assert.equal(name, "sandy_tenant_financial_fragment_download");
      assert.deepEqual(args, { p_snapshot: snapshot, p_sequence: 0 });
      return { data: result, error: null };
    },
  }, { snapshot_id: snapshot, sequence: 0 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.artifact_json, result.artifact_json);
  assert.equal(body.artifact_sha256, result.artifact_sha256);
  assert.equal(
    JSON.parse(JSON.parse(body.artifact_json).json_fragment).debit_minor,
    "9223372036854775807",
  );
  assert.equal(calls, 1);
});
Deno.test("financial: invalid fragments secrets caller identity and broken digests cannot leave the customer adapter", async () => {
  const original = await download();
  for (
    const patch of [{ artifact_sha256: "f".repeat(64) }, { sequence: 2 }, {
      secret: "DO_NOT_DISCLOSE",
    }, {
      artifact_json: original.artifact_json.replace(
        manifest.id,
        "customer_content_fragments_v1",
      ),
    }]
  ) {
    const response = await executeFinancialExportDownload(
      db({ ...original, ...patch }),
      { snapshot_id: snapshot, sequence: 0 },
    );
    assert.equal(response.status, 502);
    assert(!(await response.text()).includes("DO_NOT_DISCLOSE"));
  }
  let calls = 0;
  const response = await executeFinancialExportDownload({
    rpc: async () => {
      calls++;
      throw Error("unexpected");
    },
  }, { snapshot_id: snapshot, sequence: 0, tenant_id: tenant });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});
Deno.test("financial: discovery enforces exact financial metadata and coherent pagination", async () => {
  const value = {
    ok: true,
    offset: 1,
    limit: 1,
    total_count: 2,
    next_offset: null,
    items: [metadata()],
  };
  assert.equal(
    (await executeFinancialExportAvailable(db(value), { offset: 1, limit: 1 }))
      .status,
    200,
  );
  for (
    const patch of [{ offset: 0 }, { next_offset: 2 }, {
      items: [{ ...metadata(), provider_verified: true }],
    }, {
      items: [{ ...metadata(), manifest: "customer_content_fragments_v1" }],
    }, { token: "DO_NOT_DISCLOSE" }]
  ) {
    const response = await executeFinancialExportAvailable(
      db({ ...value, ...patch }),
      { offset: 1, limit: 1 },
    );
    assert.equal(response.status, 502);
    assert(!(await response.text()).includes("DO_NOT_DISCLOSE"));
  }
});
Deno.test("financial: actual-customer refusals retain 403 404 410 and 424 without pretending to impersonate a session", async () => {
  for (const status of [403, 404, 410, 424]) {
    assert.equal(
      (await executeFinancialExportDownload(
        db({ ok: false, http_status: status }),
        { snapshot_id: snapshot, sequence: 0 },
      )).status,
      status,
    );
  }
  assert.equal(
    (await executeFinancialExportAvailable(
      db({ ok: false, http_status: 403 }),
      { offset: 0, limit: 1 },
    )).status,
    403,
  );
});
Deno.test("financial: all68 explicit consent choices use the existing normal-user SQL ledger with no automatic erasure grant", async () => {
  const { contract_sha256, ...value } = consent.operations.set;
  assert.equal(await argumentDigest(value), contract_sha256);
  const operations =
    consent.operations.set.input_schema.properties.operations.items.enum;
  assert.equal(operations.length, 68);
  assert.equal(new Set(operations).size, 68);
  let calls = 0;
  const args = {
    operations,
    approved_emails: [],
    allow_erasure: false,
    expires_at: "2026-10-22T00:00:00Z",
  };
  const record = {
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
  const response = await executeFinancialConsent(
    {
      rpc: async (name, rpcArgs) => {
        calls++;
        assert.equal(name, "sandy_supabase_tenant_consent_set");
        assert.equal(rpcArgs.p_allow_erasure, false);
        assert.deepEqual(rpcArgs.p_operations, operations);
        return { data: record, error: null };
      },
    },
    "supabase.tenant.consent.set",
    args,
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual((await response.json()).operations, operations);
  assert.equal(
    (await executeFinancialConsent(
      db({ ok: false, http_status: 403 }),
      "supabase.tenant.consent.set",
      args,
    )).status,
    403,
  );
  assert.equal(
    (await executeFinancialConsent(db(record), "supabase.tenant.consent.set", {
      ...args,
      operations: [...operations, "supabase.tenant.financial.erase"],
    })).status,
    400,
  );
});
