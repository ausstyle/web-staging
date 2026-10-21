import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  contentExportDownloadOperation,
  executeContentExportDownload,
} from "./content_download.ts";
import {
  contentExportExecutionScope,
  contentExportOperations,
  contentRowSchemas,
} from "./content_contracts.ts";
import manifest from "./content_manifest.json" with { type: "json" };
const tenant = "00000000-0000-4000-8000-000000000001",
  snapshot = "00000000-0000-4000-8000-000000000002";
const fragment = {
  manifest: manifest.id,
  manifest_sha256: manifest.manifest_sha256,
  tenant_id: tenant,
  table: "sandy_knowledge_documents",
  sequence: 0,
  table_sequence: 0,
  table_complete: true,
  table_row_count: 1,
  table_row_chain_sha256: "a".repeat(64),
  json_fragment: '{"title":"🍋 customer data"}\n',
  snapshot_id: snapshot,
  schema_sha256: manifest.schema_sha256,
  complete_tenant_coverage: false,
  external_provider_assets_included: false,
};
async function data(value: unknown = fragment) {
  const material = JSON.stringify(value);
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  return {
    ok: true,
    snapshot_id: snapshot,
    sequence: 0,
    artifact_json: material,
    artifact_sha256: hash,
  };
}
const db = (reply: unknown) => ({
  rpc: () => Promise.resolve({ data: reply, error: null }),
});
Deno.test("three export-artifact operations and user download are fixed typed hash-bound contracts", async () => {
  const ajv = new Ajv({ strict: true });
  for (const [n, f] of Object.entries(fullFormats)) ajv.addFormat(n, f);
  equal(Object.keys(contentExportOperations).length, 3);
  for (
    const op of [
      ...Object.values(contentExportOperations),
      contentExportDownloadOperation,
    ]
  ) {
    const { contract_sha256, ...definition } = op;
    equal(await argumentDigest(definition), contract_sha256);
    ajv.compile(op.input_schema);
    ajv.compile(op.output_schema);
  }
  equal(
    await argumentDigest(
      contentExportExecutionScope("supabase.tenant.content.export"),
    ),
    "f03c397e8c2ba3276d669cab643832a891899f6529274da2de1d6b52fd99c1ad",
  );
  for (const schema of Object.values(contentRowSchemas)) ajv.compile(schema);
  equal(contentExportDownloadOperation.requires_real_user_session, true);
  equal(contentExportDownloadOperation.api_key_delegable, false);
});
Deno.test("customer fragment preserves exact decoded UTF8 artifact bytes with a reproducible SHA256", async () => {
  const reply = await data();
  let call: unknown;
  const response = await executeContentExportDownload({
    rpc: (name, args) => {
      call = { name, args };
      return Promise.resolve({ data: reply, error: null });
    },
  }, { snapshot_id: snapshot, sequence: 0 });
  equal(response.status, 200);
  equal(await response.json(), reply);
  equal(response.headers.get("x-sandy-artifact-sha256"), null);
  equal(response.headers.get("cache-control"), "no-store");
  equal(call, {
    name: "sandy_tenant_content_fragment_download",
    args: { p_snapshot: snapshot, p_sequence: 0 },
  });
});
Deno.test("caller cannot supply another tenant actor credential or provider transport", async () => {
  let called = false;
  const blocked = {
    rpc: () => {
      called = true;
      return Promise.resolve({ data: null, error: null });
    },
  };
  for (
    const extra of [
      { tenant_id: tenant },
      { actor_id: tenant },
      { service_key: "fixture-secret" },
      { sql: "SELECT 1" },
      { sequence: -1 },
      { sequence: 2048 },
    ]
  ) {
    equal(
      (await executeContentExportDownload(blocked, {
        snapshot_id: snapshot,
        sequence: 0,
        ...extra,
      })).status,
      400,
    );
  }
  equal(called, false);
});
Deno.test("tampered canonical artifact never becomes a downloadable success", async () => {
  const reply = await data();
  const result = await executeContentExportDownload(
    db({ ...reply, artifact_sha256: "0".repeat(64) }),
    { snapshot_id: snapshot, sequence: 0 },
  );
  equal(result.status, 502);
  assert(!(await result.text()).includes("customer data"));
});
Deno.test("snapshot sequence table and source manifest stay strictly bound", async () => {
  for (
    const change of [
      { snapshot_id: tenant },
      { sequence: 1 },
      { manifest_sha256: "0".repeat(64) },
      { table: "auth.users" },
      { raw_token: "fixture-secret" },
      { complete_tenant_coverage: true },
      { table_complete: true, table_row_count: null },
      { json_fragment: "x".repeat(65537) },
    ]
  ) {
    const result = await executeContentExportDownload(
      db(await data({ ...fragment, ...change })),
      { snapshot_id: snapshot, sequence: 0 },
    );
    equal(result.status, 502);
    assert(!(await result.text()).includes("fixture-secret"));
  }
});
Deno.test("session, missing artifact, expiry and disabled verification remain distinct", async () => {
  for (const status of [403, 404, 410, 424]) {
    equal(
      (await executeContentExportDownload(
        db({ ok: false, http_status: status }),
        { snapshot_id: snapshot, sequence: 0 },
      )).status,
      status,
    );
  }
});
Deno.test("database errors cannot expose credential-bearing details", async () => {
  const response = await executeContentExportDownload({
    rpc: () =>
      Promise.resolve({ data: null, error: { message: "fixture-secret" } }),
  }, { snapshot_id: snapshot, sequence: 0 });
  equal(response.status, 503);
  assert(!(await response.text()).includes("fixture-secret"));
});
Deno.test("reconstructed parent row schemas exclude operational columns and preserve text arrays", () => {
  const ajv = new Ajv({ strict: true });
  for (const [n, f] of Object.entries(fullFormats)) ajv.addFormat(n, f);
  const schema = contentRowSchemas.email_messages;
  const row = Object.fromEntries(
    manifest.tables.find((t) => t.table === "email_messages")!.columns.map((
      c,
    ) => [
      c.name,
      c.nullable
        ? null
        : c.type === "uuid"
        ? tenant
        : c.type === "text[]"
        ? [null, "fixture@example.invalid"]
        : c.type === "timestamp with time zone"
        ? "2026-10-21T00:00:00Z"
        : "fixture",
    ]),
  );
  const validate = ajv.compile(schema);
  assert(validate(row));
  assert(
    validate({
      ...row,
      recipient_addresses: [["fixture@example.invalid"], [null]],
    }),
  );
  for (
    const field of [
      "provider_message_id",
      "refresh_token",
      "source_ref",
      "metadata",
    ]
  ) assert(!validate({ ...row, [field]: "fixture-secret" }));
});
Deno.test("product content preserves typed safe fields and excludes actor provider and arbitrary draft JSON", () => {
  const ajv = new Ajv({ strict: true });
  for (const [n, f] of Object.entries(fullFormats)) ajv.addFormat(n, f);
  const comment = {
    id: tenant,
    case_id: tenant,
    body: "customer case comment",
    created_at: "2026-10-21T00:00:00Z",
  };
  const validateComment = ajv.compile(
    contentRowSchemas.sandy_product_support_comments,
  );
  assert(validateComment(comment));
  assert(!validateComment({ ...comment, actor_id: tenant }));
  const draft = {
    id: tenant,
    customer_id: tenant,
    source_message_id: null,
    recipient: "fixture@example.invalid",
    recipients: ["fixture@example.invalid"],
    state: "draft",
    version: 1,
    created_at: "2026-10-21T00:00:00Z",
    updated_at: "2026-10-21T00:00:00Z",
  };
  const validateDraft = ajv.compile(
    contentRowSchemas.sandy_product_graph_drafts,
  );
  assert(validateDraft(draft));
  assert(!validateDraft({ ...draft, provider_id: "private-handle" }));
  assert(
    !validateDraft({ ...draft, recipients: [{ token: "fixture-secret" }] }),
  );
  equal(
    manifest.tables.filter((t) => t.table.startsWith("sandy_product_")).length,
    8,
  );
});
