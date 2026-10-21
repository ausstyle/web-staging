import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  scalarManifestExecutionScope,
  scalarManifestOperations,
  scalarManifestPayloadSchema,
} from "./scalar_contracts.ts";
import manifest from "./scalar_manifest.json" with { type: "json" };
const ajv = new Ajv({ strict: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const tenant = "00000000-0000-4000-8000-000000000001";
const empty = {
  format_version: "1.0.0",
  tenant_id: tenant,
  manifest: manifest.id,
  manifest_sha256: manifest.manifest_sha256,
  schema_sha256: manifest.schema_sha256,
  complete_tenant_coverage: false,
  external_provider_assets_included: false,
  tables: Object.fromEntries(manifest.tables.map((table) => [table.table, []])),
};
Deno.test("five scalar manifest contracts remain hash-bound to the explicit partial scope", async () => {
  equal(Object.keys(scalarManifestOperations).length, 5);
  for (const operation of Object.values(scalarManifestOperations)) {
    const { contract_sha256, ...contract } = operation;
    equal(await argumentDigest(contract), contract_sha256);
    ajv.compile(operation.input_schema);
    ajv.compile(operation.result_schema);
    ajv.compile(operation.output_schema);
    equal(
      scalarManifestExecutionScope(operation.operation).manifest,
      manifest.id,
    );
    equal(operation.complete_tenant_coverage, false);
  }
  equal(
    await argumentDigest(
      scalarManifestExecutionScope("supabase.tenant.manifests.export"),
    ),
    "bde7aa35f375750e7fc7945e7012516b364c7ba8a4021c2319265dd8433c879e",
  );
});
Deno.test("manifest export cannot select arbitrary tables SQL or credential data", () => {
  const input = ajv.compile(
    scalarManifestOperations["supabase.tenant.manifests.export"].input_schema,
  );
  const args = {
    tenant_id: tenant,
    manifest: manifest.id,
    expected_manifest_sha256: manifest.manifest_sha256,
  };
  assert(input(args));
  for (
    const mutation of [
      { ...args, table: "auth.users" },
      { ...args, sql: "SELECT 1" },
      { ...args, manifest: "application_leaf_links_v1" },
      { ...args, expected_manifest_sha256: "f".repeat(64) },
      { ...args, actor_id: tenant },
    ]
  ) assert(!input(mutation));
});
Deno.test("typed scalar payload excludes unknown tables fields and full coverage assertions", () => {
  const validate = ajv.compile(scalarManifestPayloadSchema);
  assert(validate(empty));
  for (
    const changed of [
      { ...empty, complete_tenant_coverage: true },
      { ...empty, tables: { ...empty.tables, sandy_operations_keys: [] } },
      { ...empty, secret: "fixture-must-not-escape" },
      { ...empty, manifest_sha256: "f".repeat(64) },
    ]
  ) assert(!validate(changed));
});
Deno.test("decimal confidence values are strings preserving precision instead of rounded JSON numbers", () => {
  const validate = ajv.compile(scalarManifestPayloadSchema);
  const row = {
    id: tenant,
    owner_customer_id: tenant,
    document_id: tenant,
    entity_id: tenant,
    relationship_type: "fixture",
    evidence_excerpt: null,
    confidence: "0.123456789012345678901234567890123456789",
    created_at: "2026-10-21T00:00:00Z",
  };
  const withRow = (confidence: unknown) => ({
    ...empty,
    tables: {
      ...empty.tables,
      sandy_knowledge_links: [{ ...row, confidence }],
    },
  });
  assert(validate(withRow(row.confidence)));
  assert(validate(withRow(null)));
  for (
    const invalid of [
      0.1234,
      "NaN",
      "Infinity",
      "1e-8",
      "0." + "1".repeat(10000),
    ]
  ) assert(!validate(withRow(invalid)));
});
Deno.test("text and row bounds are enforced on the customer-delivery payload", () => {
  const validate = ajv.compile(scalarManifestPayloadSchema);
  const row = {
    id: tenant,
    owner_customer_id: tenant,
    from_person_id: tenant,
    to_person_id: tenant,
    link_type: "knows",
    source: "explicit_user",
    note: "x".repeat(10000),
    created_at: "2026-10-21T00:00:00Z",
    updated_at: "2026-10-21T00:00:00Z",
  };
  const payload = {
    ...empty,
    tables: { ...empty.tables, sandy_person_links: [row] },
  };
  assert(validate(payload));
  assert(
    !validate({
      ...empty,
      tables: {
        ...empty.tables,
        sandy_person_links: [{ ...row, note: "x".repeat(10001) }],
      },
    }),
  );
  assert(
    !validate({
      ...empty,
      tables: { ...empty.tables, sandy_person_links: Array(1001).fill(row) },
    }),
  );
});
