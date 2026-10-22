import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  supportRecoveryExecutionScope,
  supportRecoveryOperations,
} from "./support_recovery_contracts.ts";
import manifest from "./support_recovery_manifest.json" with { type: "json" };
const ajv = new Ajv({ strict: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const id = "00000000-0000-4000-8000-000000000001";
Deno.test("five support operations bind the exact private case-scoped recovery contract", async () => {
  equal(Object.keys(supportRecoveryOperations).length, 5);
  for (const operation of Object.values(supportRecoveryOperations)) {
    const { contract_sha256, ...definition } = operation;
    equal(await argumentDigest(definition), contract_sha256);
    ajv.compile(operation.input_schema);
    ajv.compile(operation.output_schema);
    ajv.compile(operation.result_schema);
    equal(operation.private_recovery_only, true);
    equal(operation.complete_tenant_coverage, false);
  }
  equal(
    await argumentDigest(
      supportRecoveryExecutionScope("supabase.tenant.support.snapshot"),
    ),
    "c691594174ef0f5b74c1c815568dab535a74a1b2f05f8a187bda3f41da1709b7",
  );
});
Deno.test("private snapshot inputs cannot manufacture Auth attribution restore data SQL or another manifest", () => {
  const validate = ajv.compile(
    supportRecoveryOperations["supabase.tenant.support.snapshot"].input_schema,
  );
  const args = {
    tenant_id: id,
    case_id: id,
    manifest: manifest.id,
    expected_manifest_sha256: manifest.manifest_sha256,
  };
  assert(validate(args));
  for (
    const change of [
      { actor_id: id },
      { payload: { actor_id: id } },
      { sql: "SELECT 1" },
      { manifest: "customer_content_fragments_v1" },
      { case_id: "invalid" },
    ]
  ) assert(!validate({ ...args, ...change }));
});
Deno.test("private recovery results are metadata and never customer-downloadable attribution", () => {
  const operation =
    supportRecoveryOperations["supabase.tenant.support.snapshot"];
  const result = {
    snapshot_id: id,
    tenant_id: id,
    manifest: manifest.id,
    manifest_sha256: manifest.manifest_sha256,
    schema_sha256: manifest.schema_sha256,
    snapshot_sha256: "a".repeat(64),
    state: "exported",
    created_at: "2026-10-21T00:00:00Z",
    expires_at: "2026-10-22T00:00:00Z",
    row_counts: {
      sandy_product_support_cases: 1,
      sandy_product_support_comments: 1,
    },
    complete_tenant_coverage: false,
    external_provider_assets_included: false,
    case_id: id,
    private_recovery_only: true,
    retained_control_copies: true,
  };
  const validate = ajv.compile(operation.result_schema);
  assert(validate(result));
  for (
    const extra of [
      { actor_id: id },
      { body: "private body" },
      { payload: { actor_id: id } },
      { vault_secret_id: id },
      { private_recovery_only: false },
      { retained_control_copies: false },
      { state: "restored" },
    ]
  ) assert(!validate({ ...result, ...extra }));
});
