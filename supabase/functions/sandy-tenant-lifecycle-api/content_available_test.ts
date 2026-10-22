import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  contentExportAvailableOperation,
  executeContentExportAvailable,
} from "./content_available.ts";
import manifest from "./content_manifest.json" with { type: "json" };
const id = "00000000-0000-4000-8000-000000000001";
const metadata = {
  snapshot_id: id,
  tenant_id: id,
  manifest: manifest.id,
  manifest_sha256: manifest.manifest_sha256,
  schema_sha256: manifest.schema_sha256,
  fragment_count: 12,
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
};
const valid = {
  ok: true,
  offset: 0,
  limit: 1,
  total_count: 1,
  next_offset: null,
  items: [metadata],
};
const db = (data: unknown) => ({
  rpc: () => Promise.resolve({ data, error: null }),
});
Deno.test("customer discovers only typed own-export metadata with an exact contract hash", async () => {
  const { contract_sha256, ...definition } = contentExportAvailableOperation;
  equal(await argumentDigest(definition), contract_sha256);
  let call: unknown;
  const reply = await executeContentExportAvailable({
    rpc: (name, args) => {
      call = { name, args };
      return Promise.resolve({ data: valid, error: null });
    },
  }, { offset: 0, limit: 1 });
  equal(reply.status, 200);
  equal(await reply.json(), valid);
  equal(call, {
    name: "sandy_tenant_content_exports_available",
    args: { p_offset: 0, p_limit: 1 },
  });
});
Deno.test("discovery accepts no caller tenant credentials or oversized page", async () => {
  let called = false;
  const blocked = {
    rpc: () => {
      called = true;
      return Promise.resolve({ data: null, error: null });
    },
  };
  for (
    const change of [
      { tenant_id: id },
      { actor_id: id },
      { vault_secret_id: id },
      { limit: 51 },
      { offset: -1 },
    ]
  ) {
    equal(
      (await executeContentExportAvailable(blocked, {
        offset: 0,
        limit: 1,
        ...change,
      })).status,
      400,
    );
  }
  equal(called, false);
});
Deno.test("metadata projection rejects plaintext secret references and inconsistent pagination", async () => {
  for (
    const changed of [
      { ...valid, items: [{ ...metadata, vault_secret_id: id }] },
      { ...valid, items: [{ ...metadata, json_fragment: "fixture-secret" }] },
      { ...valid, next_offset: 0 },
      { ...valid, total_count: 2, next_offset: null },
      { ...valid, items: [] },
    ]
  ) {
    const reply = await executeContentExportAvailable(db(changed), {
      offset: 0,
      limit: 1,
    });
    equal(reply.status, 502);
    assert(!(await reply.text()).includes("fixture-secret"));
  }
});
Deno.test("discovery preserves actual session and closed-verification refusals", async () => {
  for (const status of [403, 424]) {
    equal(
      (await executeContentExportAvailable(
        db({ ok: false, http_status: status }),
        { offset: 0, limit: 1 },
      )).status,
      status,
    );
  }
});
