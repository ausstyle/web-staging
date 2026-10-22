import {
  deepStrictEqual as equal,
  ok as assert,
  rejects,
} from "node:assert/strict";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  executeProtectedInventoryRpc,
  protectedInventoryContractPayload,
  type ProtectedInventoryDb,
  protectedInventoryOperation,
  protectedInventoryOperationName,
  protectedInventoryResources,
  protectedInventoryRpcName,
  type ProtectedInventoryRpcParameters,
  protectedInventoryScope,
} from "./protected_inventory.ts";
type Obj = Record<string, unknown>;
const actor = "00000000-0000-4000-8000-000000000001",
  tenant = "00000000-0000-4000-8000-000000000002",
  admission = "00000000-0000-4000-8000-000000000003",
  id = "00000000-0000-4000-8000-000000000004",
  date = "2026-10-21T00:00:00Z";
const args = { tenant_id: tenant, offset: 0, limit: 2 };
const parameters = (): ProtectedInventoryRpcParameters => ({
  p_actor: actor,
  p_admission: admission,
  p_canonical: canonicalJson(args),
});
function rowFor(name: string): Obj {
  const resource = protectedInventoryResources[
    name as keyof typeof protectedInventoryResources
  ];
  return Object.fromEntries(
    Object.keys(resource.fields).map((field) => [
      field,
      field === "id" || field === "api_tenant_id"
        ? id
        : field === "scopes" || field === "operations" ||
            field === "capabilities"
        ? ["read"]
        : ["active", "allow_erasure", "legal_hold"].includes(field)
        ? false
        : ["revision", "max_starts", "starts"].includes(field)
        ? 1
        : field === "name"
        ? "synthetic-secret-name"
        : field.endsWith("_at") || field === "retention_until"
        ? date
        : "synthetic",
    ]),
  );
}
function resultFor(): Obj {
  return {
    tenant_id: tenant,
    inventory_version: "protected_resource_metadata_v1",
    observed_at: date,
    offset: 0,
    limit: 2,
    complete_tenant_coverage: false,
    provider_revocation_verified: false,
    generic_restore_permitted: false,
    audit_evidence_disposition: "retain_append_only_digest_evidence",
    resources: Object.fromEntries(
      Object.entries(protectedInventoryResources).map(([name, resource]) => {
        const unavailable = "unavailable" in resource;
        return [name, {
          ownership: resource.ownership,
          revocation_disposition: resource.revocation,
          retention_disposition: resource.retention,
          generic_restore_permitted: false,
          offset: 0,
          limit: 2,
          status: unavailable ? "ownership_mapping_unavailable" : "available",
          reason: unavailable ? resource.unavailable : null,
          total_count: unavailable ? null : 1,
          items: unavailable ? [] : [rowFor(name)],
          next_offset: null,
        }];
      }),
    ),
  };
}
function fixture(options: {
  data?: unknown;
  result?: Obj;
  status?: number;
  error?: unknown;
  throws?: boolean;
} = {}) {
  const calls: { name: string; args: unknown }[] = [];
  const data = options.data ?? {
    ok: true,
    reused: false,
    result: options.result ?? resultFor(),
  };
  const db: ProtectedInventoryDb = {
    rpc: async (name, input) => {
      calls.push({ name, args: input });
      if (options.throws) throw Error("SENSITIVE PROVIDER DETAILS");
      return {
        data,
        error: options.error ?? null,
        status: options.status ?? 201,
      };
    },
  };
  return { db, calls, data };
}
const pages = (result: Obj) => result.resources as Record<string, Obj>;
Deno.test("sensitive inventory remains an approval-bound read with partial coverage", async () => {
  equal(protectedInventoryOperation.operation, protectedInventoryOperationName);
  equal(protectedInventoryOperation.handler, "sandy-tenant-lifecycle-api");
  equal(protectedInventoryOperation.is_mutation, false);
  equal(protectedInventoryOperation.requires_grant, true);
  equal(protectedInventoryOperation.requires_approval, true);
  equal(protectedInventoryOperation.api_key_delegable, false);
  equal(protectedInventoryOperation.complete_tenant_coverage, false);
  equal(
    protectedInventoryOperation.contract_sha256,
    await argumentDigest(protectedInventoryContractPayload),
  );
  equal(protectedInventoryScope.project_ref, "zmqlyygzqoidkcwdysok");
  equal(Object.keys(protectedInventoryResources).length, 11);
});
Deno.test("only a narrow SQL RPC runs and actual SDK HTTP status is retained", async () => {
  const f = fixture();
  const params = parameters();
  equal(await executeProtectedInventoryRpc(f.db, params), {
    data: f.data,
    error: null,
    status: 201,
  });
  equal(f.calls, [{ name: protectedInventoryRpcName, args: params }]);
});
Deno.test("unmapped API tenants stay unknown and cannot be adopted by UUID coincidence", async () => {
  const result = resultFor(), p = pages(result);
  for (
    const name of [
      "sandy_api_keys",
      "sandy_api_credentials",
      "sandy_computer_api_grants",
    ]
  ) {
    equal(p[name].status, "ownership_mapping_unavailable");
    equal(p[name].total_count, null);
    equal(p[name].items, []);
    p[name].total_count = 0;
    const reply = await executeProtectedInventoryRpc(
      fixture({ result }).db,
      parameters(),
    );
    equal(reply.data, null);
    p[name].total_count = null;
  }
});
Deno.test("invalid identity/canonical input cannot reach the database", async () => {
  const invalid = [
    { ...parameters(), p_actor: tenant + "extra" },
    { ...parameters(), p_admission: "Bearer admin-key" },
    { ...parameters(), credential_id: id },
    { ...parameters(), p_canonical: "{" },
    { ...parameters(), p_canonical: " ".repeat(196609) },
    { ...parameters(), p_canonical: JSON.stringify(args) },
    {
      ...parameters(),
      p_canonical: canonicalJson({ ...args, table: "auth.users" }),
    },
    { ...parameters(), p_canonical: canonicalJson({ ...args, limit: 51 }) },
    { ...parameters(), p_canonical: canonicalJson({ ...args, offset: -1 }) },
    { ...parameters(), p_canonical: canonicalJson({ ...args, limit: "2" }) },
  ];
  for (const params of invalid) {
    const f = fixture();
    await rejects(
      () =>
        executeProtectedInventoryRpc(
          f.db,
          params as ProtectedInventoryRpcParameters,
        ),
      { message: "tenant_inventory_parameters_invalid" },
    );
    equal(f.calls, []);
  }
});
Deno.test("PostgreSQL errors expose only safe SQLSTATE and preserve actual failure status", async () => {
  const f = fixture({
    error: {
      code: "P0001",
      message: "SENSITIVE SQL DETAIL",
      details: "RAW MATERIAL",
    },
    data: { secret: "SENSITIVE PROVIDER DATA" },
    status: 403,
  });
  const reply = await executeProtectedInventoryRpc(f.db, parameters());
  equal(reply, { data: null, error: { code: "P0001" }, status: 403 });
  assert(!JSON.stringify(reply).includes("SENSITIVE"));
});
Deno.test("non-success status cannot release a success-shaped payload", async () => {
  const reply = await executeProtectedInventoryRpc(
    fixture({ status: 401 }).db,
    parameters(),
  );
  equal(reply, {
    data: null,
    error: { code: "tenant_inventory_rpc_failed" },
    status: 401,
  });
});
Deno.test("transport failures are sanitized without manufacturing a provider status", async () => {
  await rejects(
    () =>
      executeProtectedInventoryRpc(fixture({ throws: true }).db, parameters()),
    { message: "tenant_inventory_transport_unavailable" },
  );
});
Deno.test("result tenant and pagination must remain bound to the approved input", async () => {
  for (const change of [{ tenant_id: actor }, { offset: 1 }, { limit: 1 }]) {
    const reply = await executeProtectedInventoryRpc(
      fixture({ result: { ...resultFor(), ...change } }).db,
      parameters(),
    );
    equal(reply.data, null);
    equal(reply.status, 201);
  }
});
Deno.test("secret material and unreviewed fields are refused at every available resource", async () => {
  for (
    const [name, resource] of Object.entries(protectedInventoryResources)
      .filter(
        ([, resource]) => !("unavailable" in resource),
      )
  ) {
    assert(resource.fields);
    for (
      const key of [
        "key_hash",
        "token_sha256",
        "access_token_ciphertext",
        "secret_id",
        "auth_user_id",
        "token_secret_ref",
        "trusted_memory",
        "raw_secret",
      ]
    ) {
      const result = resultFor();
      (pages(result)[name].items as Obj[])[0][key] = "SENSITIVE";
      const reply = await executeProtectedInventoryRpc(
        fixture({ result }).db,
        parameters(),
      );
      equal(reply.data, null);
      assert(!JSON.stringify(reply).includes("SENSITIVE"));
    }
  }
});
Deno.test("inventory cannot claim provider revocation, generic restoration or full coverage", async () => {
  for (
    const field of [
      "provider_revocation_verified",
      "generic_restore_permitted",
      "complete_tenant_coverage",
    ]
  ) {
    const reply = await executeProtectedInventoryRpc(
      fixture({ result: { ...resultFor(), [field]: true } }).db,
      parameters(),
    );
    equal(reply.data, null);
  }
});
Deno.test("pagination cannot silently omit rows or return an endless empty continuation", async () => {
  for (
    const change of [{ total_count: 5 }, { next_offset: 1 }, { items: [] }, {
      offset: 1,
    }]
  ) {
    const result = resultFor();
    Object.assign(pages(result).sandy_operations_keys, change);
    equal(
      (await executeProtectedInventoryRpc(fixture({ result }).db, parameters()))
        .data,
      null,
    );
  }
  const result = resultFor();
  const page = pages(result).sandy_operations_keys;
  page.items = [
    rowFor("sandy_operations_keys"),
    rowFor("sandy_operations_keys"),
  ];
  page.total_count = 5;
  page.next_offset = 2;
  assert(
    (await executeProtectedInventoryRpc(fixture({ result }).db, parameters()))
      .data,
  );
});
Deno.test("a missing reviewed schema is explicit and cannot masquerade as an empty inventory", async () => {
  const result = resultFor(), page = pages(result).sandy_calendar_connections;
  Object.assign(page, {
    status: "schema_unavailable",
    reason: "reviewed_metadata_schema_not_available",
    items: [],
    total_count: null,
  });
  assert(
    (await executeProtectedInventoryRpc(fixture({ result }).db, parameters()))
      .data,
  );
  page.total_count = 0;
  equal(
    (await executeProtectedInventoryRpc(fixture({ result }).db, parameters()))
      .data,
    null,
  );
});
