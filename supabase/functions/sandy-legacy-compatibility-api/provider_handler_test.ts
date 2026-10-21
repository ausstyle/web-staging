import assert from "node:assert/strict";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  createProviderOperationHandler,
  type ProviderDependencies,
} from "../sandy-provider-operation-api/index.ts";
import { createLegacyProviderHandler } from "./provider_handler.ts";
import {
  legacyProviderContractMatches,
  legacyProviderContracts,
  legacyProviderExecutionScope,
} from "./provider_contracts.ts";
type Obj = Record<string, any>;
const ACTOR = "10000000-0000-4000-8000-000000000001",
  RID = "20000000-0000-4000-8000-000000000001",
  GRANT = "30000000-0000-4000-8000-000000000001",
  ADMISSION = "40000000-0000-4000-8000-000000000001",
  SHA = "a".repeat(40);
function fixture(s: Obj, defs: Obj, name = "", depth = 0): any {
  if (depth > 30) throw Error("fixture_depth");
  if (s.$ref) {
    return fixture(defs[s.$ref.split("/").pop()!], defs, name, depth + 1);
  }
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.oneOf || s.anyOf) {
    return fixture((s.oneOf || s.anyOf)[0], defs, name, depth + 1);
  }
  const type = Array.isArray(s.type)
    ? s.type.includes("null") ? "null" : s.type[0]
    : s.type;
  if (type === "null") return null;
  if (type === "object" || s.properties) {
    return Object.fromEntries(
      (s.required || []).map((
        k: string,
      ) => [k, fixture(s.properties[k], defs, k, depth + 1)]),
    );
  }
  if (type === "array") {
    return Array.from(
      { length: s.minItems || 0 },
      () => fixture(s.items, defs, "", depth + 1),
    );
  }
  if (type === "boolean") return false;
  if (type === "integer" || type === "number") {
    return Math.max(s.minimum || 0, 1);
  }
  if (s.format === "date-time") return "2026-10-21T00:00:00Z";
  if (s.format === "uri" || name.includes("url")) {
    return "https://api.github.com/repos/ausstyle/web-staging";
  }
  if (name === "sha") return SHA;
  if (name === "encoding") return "base64";
  if (name === "content") return "YWJj";
  if (name === "path" || name === "name") {
    return "docs/sandy-api/compensation-fixtures/legacy.txt";
  }
  return "fixture";
}
async function sqlDigest(sql: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sql)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function argsFor(op: string): Promise<Obj> {
  if (op === "github.read") {
    return {
      path: { path: "docs/sandy-api/compensation-fixtures/legacy.txt" },
      query: { ref: SHA },
    };
  }
  if (op === "github.update_file") {
    return {
      path: { path: "docs/sandy-api/compensation-fixtures/legacy.txt" },
      body: {
        message: "Scoped legacy update",
        content: "YWJj",
        sha: SHA,
        branch: "fixture",
      },
    };
  }
  if (op === "github.commit") {
    return {
      body: { message: "Detached immutable commit", tree: SHA, parents: [SHA] },
    };
  }
  if (op === "github.merge") {
    return {
      path: { pull_number: 123 },
      body: { sha: SHA, merge_method: "merge" },
    };
  }
  return {
    project_id: "zmqlyygzqoidkcwdysok",
    migration_ref: await sqlDigest("SELECT 1;"),
    body: { name: "legacy_fixture", query: "SELECT 1;" },
  };
}
function setup(overrides: Partial<ProviderDependencies> = {}) {
  const consumed: Obj[] = [],
    finished: Obj[] = [],
    urls: string[] = [],
    credentials: Obj[] = [];
  const deps: ProviderDependencies = {
    service: "internal-fixture",
    authorizeContext: async (c, op) => {
      assert.equal(c.actor_id, ACTOR);
      assert.ok(legacyProviderContracts[op.operation]);
      return { allowed: true };
    },
    consumeGrant: async (r) => {
      consumed.push(r);
      return { allowed: true, admission_id: ADMISSION };
    },
    finishExecution: async (r) => {
      finished.push(r);
      return { allowed: true };
    },
    credentialForExecution: async (op, context) => {
      credentials.push(context);
      assert.ok(legacyProviderContracts[op.operation]);
      return "PRIVATE_PROVIDER_TOKEN";
    },
    fetch: (async (input) => {
      const url = String(input);
      urls.push(url);
      const op = Object.values(legacyProviderContracts).find((o) =>
        o.operation === consumed.at(-1)?.operation
      )!;
      let value: Obj = { id: "migration-record" };
      const status = op.operation === "github.commit" ? 201 : 200;
      if (op.operation === "github.read") {
        value = fixture(op.$defs["content-file"], op.$defs);
        Object.assign(value, {
          path: "docs/sandy-api/compensation-fixtures/legacy.txt",
          sha: SHA,
          size: 3,
          encoding: "base64",
          content: "YWJj",
          type: "file",
        });
      } else if (op.response_schemas[String(status)]) {
        value = fixture(op.response_schemas[String(status)], op.$defs);
      }
      if (op.operation === "github.merge") value.merged = true;
      return Response.json(value, { status });
    }) as typeof fetch,
  };
  Object.assign(deps, overrides);
  const handler = createLegacyProviderHandler(deps);
  const call = (operation: string, args: Obj, patch: Obj = {}) =>
    handler(
      new Request("https://internal.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer internal-fixture",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation,
          arguments: args,
          actor_id: ACTOR,
          tenant_id: null,
          credential_id: null,
          request_id: RID,
          grant_id: GRANT,
          admission_id: ADMISSION,
          ...patch,
        }),
      }),
    );
  return { deps, call, consumed, finished, urls, credentials };
}
Deno.test("five immutable compatibility descriptors preserve exact original operation identity and typed contracts", async () => {
  assert.equal(Object.keys(legacyProviderContracts).length, 5);
  const ajv = new Ajv({ strict: false, formats: fullFormats });
  for (const op of Object.values(legacyProviderContracts)) {
    assert.ok(Object.isFrozen(op));
    assert.ok(Object.isFrozen(op.input_schema));
    const { contract_sha256, ...unsigned } = op;
    assert.equal(await argumentDigest(unsigned), contract_sha256);
    const row = {
      ...op,
      error_contract: {
        contract_sha256,
        requires_approval: true,
        requires_grant: true,
        api_key_delegable: false,
        requires_real_user_session: true,
      },
    };
    assert.equal(legacyProviderContractMatches(op.operation, row), true);
    assert.equal(
      legacyProviderContractMatches(op.operation, {
        ...row,
        error_contract: { ...row.error_contract, requires_approval: false },
      }),
      false,
    );
    assert.equal(
      ajv.compile(op.input_schema)(await argsFor(op.operation)),
      true,
      op.operation,
    );
    ajv.compile(op.output_schema);
  }
});
Deno.test("all five legacy provider IDs execute in the shared canonical engine with one original-scope grant and receipt", async () => {
  for (const operation of Object.keys(legacyProviderContracts)) {
    const h = setup(), args = await argsFor(operation);
    const r = await h.call(operation, args);
    assert.equal(r.status, 200, await r.clone().text());
    const body = await r.json();
    assert.equal(body.operation, operation);
    assert.equal(body.executed, true);
    assert.equal(h.consumed.length, 1);
    assert.equal(h.finished.length, 1);
    assert.equal(h.urls.length, 1);
    assert.equal(h.credentials[0].operation, operation);
    assert.equal(h.consumed[0].operation, operation);
    assert.equal(h.consumed[0].input_sha256, await argumentDigest(args));
    assert.equal(
      h.consumed[0].scope_sha256,
      await argumentDigest(legacyProviderExecutionScope(operation)),
    );
    assert.equal(
      h.consumed[0].contract_sha256,
      legacyProviderContracts[operation].contract_sha256,
    );
    assert.equal(
      JSON.stringify(body).includes("PRIVATE_PROVIDER_TOKEN"),
      false,
    );
    assert.ok(
      h.urls[0].startsWith(
        operation.startsWith("github.")
          ? "https://api.github.com/repos/ausstyle/web-staging/"
          : "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/",
      ),
    );
    if (operation !== "github.read") {
      assert.equal(body.result.effect_confirmed, false);
    }
  }
});
Deno.test("migration reference and source cannot drift or select a foreign project before consumption", async () => {
  for (
    const change of [{ migration_ref: "0".repeat(64) }, {
      project_id: "foreign-project",
    }, { body: { name: "fixture", query: "SELECT 2;" } }]
  ) {
    const h = setup();
    assert.equal(
      (await h.call("supabase.apply_migration", {
        ...await argsFor("supabase.apply_migration"),
        ...change,
      })).status,
      400,
    );
    assert.deepEqual([h.consumed.length, h.urls.length], [0, 0]);
  }
});
Deno.test("caller cannot inject a catalogue, delegate a key, broaden fixture content or skip update and merge CAS", async () => {
  const cases: [string, Obj, Obj?][] = [
    ["github.read", { path: { path: "supabase/.env" } }],
    ["github.read", await argsFor("github.read"), { catalogue: {} }],
    ["github.read", await argsFor("github.read"), { credential_id: GRANT }],
    ["github.update_file", {
      path: { path: "a.txt" },
      body: { message: "x", content: "YWJj" },
    }],
    ["github.merge", {
      path: { pull_number: 1 },
      body: { merge_method: "merge" },
    }],
  ];
  for (const [operation, args, patch] of cases) {
    const h = setup();
    assert.ok(
      [400, 403].includes((await h.call(operation, args, patch)).status),
    );
    assert.deepEqual([h.consumed.length, h.urls.length], [0, 0]);
  }
});
Deno.test("trusted catalogue construction rejects mutable maps and mismatched operation keys without baseline fallback", async () => {
  const h = setup();
  assert.throws(
    () =>
      createProviderOperationHandler(h.deps, { ...legacyProviderContracts }),
    /immutable_provider_catalogue_required/,
  );
  const bad = createProviderOperationHandler(
    h.deps,
    Object.freeze({ "github.read": legacyProviderContracts["github.commit"] }),
  );
  const request = new Request("https://internal.invalid", {
    method: "POST",
    headers: { authorization: "Bearer internal-fixture" },
    body: JSON.stringify({ operation: "github.read", arguments: {} }),
  });
  assert.equal((await bad(request)).status, 503);
  assert.equal((await h.call("github.repos.get", {})).status, 404);
  assert.equal(
    canonicalJson(legacyProviderExecutionScope("github.read")),
    canonicalJson({ provider: "github", repository: "ausstyle/web-staging" }),
  );
  assert.equal(h.consumed.length, 0);
});

Deno.test("alias merge provider refusal is terminal unexecuted with attempted upstream evidence", async () => {
  const h = setup({
    fetch: (async () =>
      Response.json({
        merged: false,
        sha: SHA,
        message: "Refused by provider",
      })) as typeof fetch,
  });
  const response = await h.call("github.merge", await argsFor("github.merge"));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.executed, false);
  assert.equal(body.provider_attempted, true);
  assert.equal(body.reconciliation_required, false);
  assert.equal(body.provider_http_status, 200);
  assert.equal(h.finished[0].outcome, "failed");
  assert.equal(h.consumed.length, 1);
});
Deno.test("compatibility transport ambiguity and lost receipts return unknown without automatic replay", async () => {
  for (const finishLost of [false, true]) {
    const h = setup(
      finishLost ? { finishExecution: async () => ({ allowed: false }) } : {
        fetch: (async () => {
          throw Error("lost provider response");
        }) as typeof fetch,
      },
    );
    const response = await h.call(
      "github.commit",
      await argsFor("github.commit"),
    );
    assert.equal(response.status, finishLost ? 503 : 502);
    const body = await response.json();
    assert.equal(body.executed, null);
    assert.equal(body.reconciliation_required, true);
    assert.equal(h.consumed.length, 1);
    assert.ok(h.urls.length <= 1);
  }
});
