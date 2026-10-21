import { strict as a } from "node:assert";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  createSystemMetadataHandler,
  type SystemMetadataDependencies,
} from "./index.ts";
import {
  systemMetadataContractMatches,
  systemMetadataOperations,
} from "./contracts.ts";
import {
  systemMetadataExecutionScope,
  systemMetadataOwnsGrant,
  systemMetadataRequiresUserSession,
} from "./gateway.ts";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
const actor = "10000000-0000-4000-8000-000000000001",
  customer = "20000000-0000-4000-8000-000000000001",
  rid = "30000000-0000-4000-8000-000000000001",
  admission = "40000000-0000-4000-8000-000000000001",
  grant = "50000000-0000-4000-8000-000000000001";
const result = (item: unknown = null) => ({
  items: [],
  item,
  next_cursor: null,
  possibly_truncated: false,
  source: "recorded_metadata",
  provider_verified: false,
  executability_not_implied: true,
  schemas_via: "Sandy API describe",
  notice: "Recorded metadata only.",
});
const output = (operation = "system.catalog", item: unknown = null) => ({
  ok: true,
  operation,
  contract_version: "1.0.0",
  admission_id: admission,
  request_id: rid,
  request_state: "observed",
  executed: true,
  result: result(item),
  reconciliation_required: false,
});
const req = (
  operation = "system.catalog",
  args: Record<string, unknown> = {},
  other: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) =>
  new Request("https://api.invalid", {
    method: "POST",
    headers: {
      authorization: "Bearer internal-service",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      operation,
      arguments: args,
      actor_id: actor,
      tenant_id: null,
      credential_id: null,
      request_id: rid,
      admission_id: admission,
      grant_id: grant,
      ...other,
    }),
  });
const deps = (): SystemMetadataDependencies => ({
  base: "https://zmqlyygzqoidkcwdysok.supabase.co",
  service: "internal-service",
  fetch: () => {
    throw Error("unexpected_external_request");
  },
});
Deno.test("exactly7 immutable typed owner read contracts match registry flags and hashes", async () => {
  a.equal(Object.keys(systemMetadataOperations).length, 7);
  for (const c of Object.values(systemMetadataOperations)) {
    const { contract_sha256, ...unsigned } = c;
    a.equal(await argumentDigest(unsigned), contract_sha256);
    a.equal(c.is_mutation, false);
    a.equal(c.input_schema.additionalProperties, false);
    a.equal(c.output_schema.additionalProperties, false);
    a.equal(systemMetadataOwnsGrant(c.operation), true);
    a.equal(systemMetadataRequiresUserSession(c.operation), true);
    const row = {
      handler: c.handler,
      permission_scope: c.permission_scope,
      is_mutation: false,
      input_schema: c.input_schema,
      output_schema: c.output_schema,
      error_contract: {
        contract_sha256,
        requires_approval: c.requires_approval,
        requires_real_user_session: true,
        api_key_delegable: false,
      },
    };
    a.equal(systemMetadataContractMatches(c.operation, row), true);
    a.equal(
      systemMetadataContractMatches(c.operation, {
        ...row,
        error_contract: { ...row.error_contract, api_key_delegable: true },
      }),
      false,
    );
    a.equal(
      systemMetadataContractMatches(c.operation, {
        ...row,
        error_contract: {
          ...row.error_contract,
          requires_approval: !c.requires_approval,
        },
      }),
      false,
    );
    a.equal(
      systemMetadataContractMatches(c.operation, { ...row, input_schema: {} }),
      false,
    );
  }
  a.equal(systemMetadataOperations["cloud.vm.exec"], undefined);
});
Deno.test("normal JWTs, opaque keys and anonymous calls cannot use the internal service transport", async () => {
  const d = deps();
  let calls = 0;
  d.rpc = async () => {
    calls++;
    return output();
  };
  const h = createSystemMetadataHandler(d);
  const headers: Record<string, string>[] = [
    { authorization: "Bearer actual-owner-user-JWT" },
    { authorization: "Bearer anon" },
    { authorization: "" },
    { "x-api-key": "opaque" },
  ];
  for (const v of headers) {
    a.equal((await h(req(undefined, {}, {}, v))).status, 401);
  }
  a.equal(calls, 0);
});
Deno.test("exact bound owner proof rejects tenant, credential, actor and transport overrides", async () => {
  const d = deps();
  let calls = 0;
  d.rpc = async () => {
    calls++;
    return output();
  };
  const h = createSystemMetadataHandler(d);
  for (
    const v of [
      { tenant_id: customer },
      { credential_id: grant },
      { actor_id: "not-a-uuid" },
      { grant_id: null },
      { scope: { project: "arbitrary" } },
      { channel: "arbitrary" },
    ]
  ) a.equal((await h(req(undefined, {}, v))).status, 400);
  a.equal(calls, 0);
});
Deno.test("fixed operations never accept SQL, table names, provider handles or raw credentials", async () => {
  const d = deps();
  let calls = 0;
  d.rpc = async () => {
    calls++;
    return output();
  };
  const h = createSystemMetadataHandler(d);
  for (
    const r of [
      req(undefined, { sql: "select * from vault.decrypted_secrets" }),
      req(undefined, { table: "auth.users" }),
      req("system.connections", {}),
      req("system.connections", {
        customer_id: customer,
        connected_account_id: "private-provider-handle",
      }),
      req("system.connections", { customer_id: customer, token: "secret" }),
      req("system.operation_status", {}),
    ]
  ) a.equal((await h(r)).status, 400);
  a.equal((await h(req("cloud.vm.exec", {}))).status, 404);
  a.equal(calls, 0);
});
Deno.test("fixed scope binds project and exact customer target without raw provider IDs", () => {
  a.deepEqual(systemMetadataExecutionScope("system.catalog", {}), {
    sandy_project_ref: "zmqlyygzqoidkcwdysok",
    permission_scope: "system:read",
    service: "system_metadata_v1",
  });
  a.deepEqual(
    systemMetadataExecutionScope("system.connections", {
      customer_id: customer.toUpperCase(),
    }),
    {
      sandy_project_ref: "zmqlyygzqoidkcwdysok",
      permission_scope: "system:read",
      service: "system_metadata_v1",
      customer_id: customer,
    },
  );
  a.throws(() => systemMetadataExecutionScope("system.connections", {}));
  a.throws(() => systemMetadataExecutionScope("cloud.vm.exec", {}));
});
Deno.test("the API forwards exact one-use proof and canonical scope to one shared RPC", async () => {
  const d = deps();
  let calls = 0;
  d.rpc = async (args) => {
    calls++;
    a.equal(args.p_actor_id, actor);
    a.equal(args.p_admission_id, admission);
    a.equal(args.p_grant_id, grant);
    a.equal(args.p_request_id, rid);
    a.equal(args.p_channel, "mcp");
    a.equal(args.p_canonical_arguments, canonicalJson({ limit: 1 }));
    a.equal(
      args.p_canonical_scope,
      canonicalJson(
        systemMetadataExecutionScope("system.catalog", { limit: 1 }),
      ),
    );
    return output();
  };
  a.equal(
    (await createSystemMetadataHandler(d)(
      req(undefined, { limit: 1 }, { channel: "mcp" }),
    )).status,
    200,
  );
  a.equal(calls, 1);
});
Deno.test("default transport has one fixed RPC endpoint, internal bearer, byte cap and redirect refusal", async () => {
  const d = deps();
  let calls = 0;
  d.fetch = async (url, init) => {
    calls++;
    a.equal(String(url), d.base + "/rest/v1/rpc/sandy_system_metadata_execute");
    a.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer internal-service",
    );
    a.equal(init?.redirect, "error");
    const b = JSON.parse(String(init?.body));
    a.equal(b.p_actor_id, actor);
    return Response.json(output());
  };
  a.equal((await createSystemMetadataHandler(d)(req())).status, 200);
  a.equal(calls, 1);
});
Deno.test("exact output projection rejects schema blobs, provider verification and missing resource fields", async () => {
  for (
    const body of [
      {
        ...output(),
        result: {
          ...result(),
          input_schema: { secret: "unapproved_schema_blob" },
        },
      },
      { ...output(), result: { ...result(), provider_verified: true } },
      {
        ...output("system.capabilities"),
        result: { ...result(), items: [{ feature_key: "incomplete" }] },
      },
    ]
  ) {
    const d = deps();
    d.rpc = async () => body;
    const response = await createSystemMetadataHandler(d)(
      req(String(body.operation)),
    );
    a.equal(response.status, 502);
    a.ok(
      !JSON.stringify(await response.json()).includes("unapproved_schema_blob"),
    );
  }
});
Deno.test("response request/admission identity cannot drift from the original proof", async () => {
  for (const fields of [{ request_id: customer }, { admission_id: customer }]) {
    const d = deps();
    d.rpc = async () => ({ ...output(), ...fields });
    a.equal((await createSystemMetadataHandler(d)(req())).status, 502);
  }
});
Deno.test("receipt alias requires the exact original target UUID and forbids redispatch", async () => {
  const receipt = {
    ok: true,
    admission_id: customer,
    request_id: customer,
    operation: "system.catalog",
    request_state: "succeeded",
    accepted: false,
    executed: true,
    completed: true,
    outcome: "succeeded",
    provider_http_status: null,
    provider_request_id_sha256: null,
    result_sha256: null,
    reconciliation_required: false,
    redispatch_permitted: false,
    created_at: "2026-10-21T00:00:00Z",
    finished_at: "2026-10-21T00:00:00Z",
  };
  const d = deps();
  d.rpc = async () => output("system.operation_status", receipt);
  a.equal(
    (await createSystemMetadataHandler(d)(
      req("system.operation_status", { request_id: customer }),
    )).status,
    200,
  );
  d.rpc = async () =>
    output("system.operation_status", { ...receipt, request_id: grant });
  a.equal(
    (await createSystemMetadataHandler(d)(
      req("system.operation_status", { request_id: customer }),
    )).status,
    502,
  );
  d.rpc = async () =>
    output("system.operation_status", {
      ...receipt,
      redispatch_permitted: true,
    });
  a.equal(
    (await createSystemMetadataHandler(d)(
      req("system.operation_status", { request_id: customer }),
    )).status,
    502,
  );
});
Deno.test("private SQL/provider details are removed from failed backend responses", async () => {
  const d = deps();
  d.rpc = async () => ({
    ok: false,
    http_status: 500,
    error: "SQL contains private credentials",
    secret: "never_return",
  });
  const response = await createSystemMetadataHandler(d)(req());
  a.equal(response.status, 503);
  a.ok(!JSON.stringify(await response.json()).includes("private credentials"));
  d.rpc = async () => {
    throw Error("private SQL password");
  };
  const failed = await createSystemMetadataHandler(d)(req());
  a.equal(failed.status, 503);
  a.equal((await failed.json()).executed, null);
});
const evidencePath = Deno.env.get("SYSTEM_METADATA_PG_EVIDENCE_PATH");
if (evidencePath) {
  Deno.test("all7 actual PostgreSQL outputs satisfy strict semantic resource schemas", async () => {
    const evidence = JSON.parse(await Deno.readTextFile(evidencePath)),
      outputs = evidence.evidence[0].evidence.outputs;
    const ajv = new Ajv({ strict: false, formats: fullFormats }),
      seen = new Set();
    for (const body of outputs) {
      const op = systemMetadataOperations[body.operation];
      a.ok(op);
      const validate = ajv.compile(op.output_schema);
      a.equal(
        validate(body),
        true,
        JSON.stringify({ operation: body.operation, errors: validate.errors }),
      );
      seen.add(body.operation);
    }
    a.equal(seen.size, 7);
  });
}
