import { deepStrictEqual as equal, ok as assert } from "node:assert/strict";
import { executeTenantExportDownload, type UserExportDb } from "./download.ts";
import manifest from "./manifest.json" with { type: "json" };
const id = "00000000-0000-4000-8000-000000000001",
  tenant = "00000000-0000-4000-8000-000000000002";
const payload = {
  format_version: "1.0.0",
  tenant_id: tenant,
  manifest: manifest.id,
  manifest_sha256: manifest.manifest_sha256,
  schema_sha256: manifest.schema_sha256,
  complete_tenant_coverage: false,
  external_provider_assets_included: false,
  tables: Object.fromEntries(manifest.tables.map((t) => [t.table, []])),
};
const valid = {
  ok: true,
  snapshot_id: id,
  snapshot_sha256: "a".repeat(64),
  file_name: "sandy-tenant-links-" + id + ".json",
  export: payload,
};
const db = (data: unknown): UserExportDb => ({
  rpc: () => Promise.resolve({ data, error: null }),
});
Deno.test("real-user export delivery exposes only a validated bounded manifest attachment", async () => {
  const result = await executeTenantExportDownload(db(valid), {
    snapshot_id: id,
  });
  equal(result.status, 200);
  equal(await result.json(), valid);
  assert(result.headers.get("content-disposition")?.includes(valid.file_name));
  equal(result.headers.get("cache-control"), "no-store");
});
Deno.test("download caller cannot substitute tenant, actor, credential or raw Vault ID", async () => {
  let called = false;
  const forbidden: UserExportDb = {
    rpc: () => {
      called = true;
      return Promise.resolve({ data: valid, error: null });
    },
  };
  for (
    const extra of [{ tenant_id: tenant }, { actor_id: tenant }, {
      vault_secret_id: id,
    }, { token: "not-a-customer-session" }]
  ) {
    equal(
      (await executeTenantExportDownload(forbidden, {
        snapshot_id: id,
        ...extra,
      })).status,
      400,
    );
  }
  equal(called, false);
});
Deno.test("operational secret fields and arbitrary tables never pass private export projection", async () => {
  for (
    const changed of [{ ...valid, secret: "do-not-disclose" }, {
      ...valid,
      export: {
        ...payload,
        tables: {
          ...payload.tables,
          sandy_operations_keys: [{ key_hash: "do-not-disclose" }],
        },
      },
    }, { ...valid, export: { ...payload, complete_tenant_coverage: true } }]
  ) {
    const result = await executeTenantExportDownload(db(changed), {
      snapshot_id: id,
    });
    equal(result.status, 502);
    assert(!(await result.text()).includes("do-not-disclose"));
  }
});
Deno.test("customer session refusal and expired/purged artifact are explicit", async () => {
  for (const status of [403, 404, 410, 424]) {
    equal(
      (await executeTenantExportDownload(
        db({ ok: false, http_status: status, error: "safe" }),
        { snapshot_id: id },
      )).status,
      status,
    );
  }
});
Deno.test("snapshot delivery remains bound to the exact requested artifact", async () => {
  const other = "00000000-0000-4000-8000-000000000009";
  for (
    const changed of [{ ...valid, snapshot_id: other }, {
      ...valid,
      file_name: "sandy-tenant-links-" + other + ".json",
    }]
  ) {
    equal(
      (await executeTenantExportDownload(db(changed), { snapshot_id: id }))
        .status,
      502,
    );
  }
});
Deno.test("customer download accepts the capture text boundary and refuses larger values", async () => {
  for (const [length, status] of [[10000, 200], [10001, 502]]) {
    const row = {
      customer_id: tenant,
      company_id: id,
      alias: "x" + " ".repeat(length - 1),
      normalized_alias: "x",
      created_at: "2026-10-21T00:00:00Z",
    };
    const result = await executeTenantExportDownload(
      db({
        ...valid,
        export: {
          ...payload,
          tables: { ...payload.tables, sandy_company_aliases: [row] },
        },
      }),
      { snapshot_id: id },
    );
    equal(result.status, status);
  }
});
