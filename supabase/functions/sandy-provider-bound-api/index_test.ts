import assert from "node:assert/strict";
import { boundContractEnabled, createBoundHandler } from "./index.ts";
import { boundContracts, type Contract, type Obj } from "./contracts.ts";
import {
  type Dependencies,
  encode64,
  type OpaqueSave,
  validate,
} from "../sandy-provider-supplement-api/runtime.ts";
const PROJECT = "elaborate-haven-511518-a5",
  NUMBER = "1030223524306",
  SB = "zmqlyygzqoidkcwdysok",
  branchRef = "aaaaaaaaaaaaaaaaaaaa",
  branchId = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222",
  admission = "33333333-3333-4333-8333-333333333333",
  handle = "44444444-4444-4444-8444-444444444444";
const prefix = `projects/${PROJECT}/locations/europe-west1/`,
  now = Date.parse("2026-10-21T01:00:00Z");
import { argsFor, finalValue } from "./test_fixtures.ts";
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function setup(transform: (value: Obj, url: URL) => Obj = (v) => v) {
  let current: Contract, args: Obj;
  const events: string[] = [],
    urls: string[] = [],
    methods: string[] = [],
    stored: OpaqueSave[] = [],
    outcomes: string[] = [];
  const deps: Dependencies = {
    service: "private-fixture-service",
    now: () => now,
    bindings: {
      organization: { id: "100", verified: true, project_id: PROJECT },
      folder: { id: "200", verified: true, project_id: PROJECT },
      destination_folder: { id: "300", verified: true, project_id: PROJECT },
    },
    authorizeContext: async () => {
      events.push("authorize");
      return { allowed: true };
    },
    consumeGrant: async () => {
      events.push("consume");
      return { allowed: true, admission_id: admission };
    },
    credentialForExecution: async () => {
      events.push("credential");
      return "fixture-token";
    },
    finishExecution: async (r) => {
      outcomes.push(r.outcome);
      return { allowed: true };
    },
    saveOpaque: async (v) => {
      stored.push(v);
      return {
        custody_id: handle,
        byte_length: v.byte_length,
        sha256: v.payload_sha256,
        media_type: v.media_type,
        expires_at: new Date(now + 60000).toISOString(),
      };
    },
    takeOpaque: async () => new TextEncoder().encode("private-next-token"),
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      urls.push(url.toString());
      methods.push(init?.method ?? "GET");
      events.push("fetch");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer fixture-token",
      );
      assert.equal(init?.redirect, "manual");
      if (url.pathname === `/v1/projects/${SB}/branches`) {
        return Promise.resolve(
          Response.json(
            transform(
              [{
                id: branchId,
                project_ref: branchRef,
                parent_project_ref: SB,
                is_default: false,
              }] as unknown as Obj,
              url,
            ),
          ),
        );
      }
      const bucket = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)$/);
      if (bucket && init?.method === "GET") {
        return Promise.resolve(
          Response.json(
            transform({
              name: decodeURIComponent(bucket[1]),
              projectNumber: NUMBER,
              generation: "1",
            }, url),
          ),
        );
      }
      if (
        url.hostname === "compute.googleapis.com" &&
        url.pathname.match(/firewallPolicies\/(123|456)$/) &&
        init?.method === "GET"
      ) {
        return Promise.resolve(
          Response.json(
            transform({
              id: url.pathname.endsWith("456") ? "456" : "123",
              name: "fixture",
              parent: "folders/200",
            }, url),
          ),
        );
      }
      if (
        url.hostname === "artifactregistry.googleapis.com" &&
        init?.method === "GET"
      ) {
        return Promise.resolve(
          Response.json(
            transform({ name: prefix + "repositories/fixture" }, url),
          ),
        );
      }
      if (
        url.hostname === "backupdr.googleapis.com" && init?.method === "GET"
      ) {
        return Promise.resolve(
          Response.json(
            transform({
              name: prefix + "backupVaults/fixture/dataSources/fixture",
            }, url),
          ),
        );
      }
      if (current.private_diff_capture) {
        return Promise.resolve(
          new Response("CREATE TABLE private_fixture(id bigint);", {
            headers: { "content-type": "text/plain" },
          }),
        );
      }
      const status = current.provider === "supabase" &&
          ["push", "merge", "reset", "restore"].some((name) =>
            current.operation.includes(`.${name}.`)
          )
        ? 201
        : 200;
      return Promise.resolve(
        Response.json(transform(finalValue(current, args), url), { status }),
      );
    },
  };
  const handler = createBoundHandler(deps),
    run = async (op: Contract, input = argsFor(op)) => {
      current = op;
      args = input;
      const r = await handler(
        new Request("https://synthetic.invalid", {
          method: "POST",
          headers: {
            authorization: "Bearer private-fixture-service",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            operation: op.operation,
            arguments: input,
            actor_id: actor,
            tenant_id: null,
            request_id: crypto.randomUUID(),
            grant_id: crypto.randomUUID(),
          }),
        }),
      );
      return { status: r.status, body: await r.json() };
    };
  return { deps, run, urls, methods, events, stored, outcomes };
}
Deno.test("bound:48 unique pinned methods execute through typed handlers with exact post-grant scope proofs", async () => {
  assert.equal(Object.keys(boundContracts).length, 48);
  for (const op of Object.values(boundContracts)) {
    const f = setup(), args = argsFor(op);
    assert.equal(
      validate(op.input_schema, args),
      true,
      op.operation + JSON.stringify(args),
    );
    const result = await f.run(op, args);
    assert.equal(result.status, 200, op.operation + JSON.stringify(result));
    assert(f.events.indexOf("consume") < f.events.indexOf("credential"));
    assert.equal(f.outcomes[0], op.is_mutation ? "accepted" : "succeeded");
    if (op.provider === "supabase" || op.service !== "pubsub") {
      assert(
        result.body.scope_proofs.length > 0 ||
          op.service === "compute" &&
            ["list", "listAssociations", "insert"].includes(op.method_name),
      );
    }
    assert(!JSON.stringify(result).includes("fixture-token"));
    assert(!JSON.stringify(result).includes("private_fixture"));
  }
});
Deno.test("bound:cross-project buckets refuse before any mutation; both source and destination proved", async () => {
  const op = boundContracts["gcp.storage.objects.copy.bound"],
    f = setup((v, url) =>
      url.pathname.includes("fixture-destination")
        ? { ...v, projectNumber: "foreign" }
        : v
    );
  const result = await f.run(op);
  assert.equal(result.status, 403);
  assert(f.methods.every((method) => method === "GET"));
  const g = setup(), ok = await g.run(op);
  assert.equal(ok.status, 200);
  assert.equal(
    ok.body.scope_proofs.filter((p: Obj) => p.kind === "bucket_project").length,
    2,
  );
});
Deno.test("bound:soft-deleted bucket restore proves exact generation; unsafe write preconditions refused", async () => {
  const restore = boundContracts["gcp.storage.buckets.restore.bound"],
    f = setup();
  assert.equal((await f.run(restore)).status, 200);
  assert(f.urls[0].includes("softDeleted=true"));
  assert(f.urls[0].includes("generation=1"));
  const copy = boundContracts["gcp.storage.objects.copy.bound"],
    g = setup(),
    args = argsFor(copy);
  delete (args.query as Obj).ifSourceGenerationMatch;
  assert.equal((await g.run(copy, args)).status, 400);
  assert(g.methods.every((m) => m === "GET"));
});
Deno.test("bound:firewall parent/source clone/association guards reject foreign scope and caller parent override", async () => {
  const clone = boundContracts["gcp.firewall_policies.clone_rules.bound"],
    f = setup((v, url) =>
      url.pathname.endsWith("456")
        ? { ...v, parent: "organizations/foreign" }
        : v
    );
  assert.equal((await f.run(clone)).status, 403);
  assert(f.methods.every((m) => m === "GET"));
  const insert = boundContracts["gcp.firewall_policies.create.bound"],
    g = setup();
  assert.equal(
    (await g.run(insert, {
      ...argsFor(insert),
      query: { parentId: "organizations/foreign" },
    })).status,
    400,
  );
  assert.equal(g.urls.length, 0);
  const add = boundContracts["gcp.firewall_policies.add_association.bound"],
    h = setup();
  assert.equal(
    (await h.run(add, {
      ...argsFor(add),
      body: { name: "fixture", attachmentTarget: "folders/foreign" },
    })).status,
    403,
  );
});
Deno.test("bound:branch membership, credential field projection and plaintext diff private custody", async () => {
  const get = boundContracts["supabase.branches.get_config.bound"],
    f = setup((v, url) =>
      url.pathname.endsWith(branchId)
        ? {
          ...v,
          db_pass: "DO_NOT_DISCLOSE",
          jwt_secret: "DO_NOT_DISCLOSE",
          db_user: "DO_NOT_DISCLOSE",
        }
        : v
    );
  const result = await f.run(get);
  assert.equal(result.status, 200);
  assert(!JSON.stringify(result).includes("DO_NOT_DISCLOSE"));
  const g = setup((v, url) =>
    url.pathname === `/v1/projects/${SB}/branches`
      ? [{
        id: branchId,
        project_ref: branchRef,
        parent_project_ref: "foreign",
      }] as unknown as Obj
      : v
  );
  assert.equal((await g.run(get)).status, 403);
  assert.equal(g.urls.length, 1);
  const diff = boundContracts["supabase.branches.diff.bound"],
    h = setup(),
    captured = await h.run(diff);
  assert.equal(captured.status, 200);
  assert.equal(h.stored[0].media_type, "text/plain");
  assert.equal(captured.body.result.content_returned, false);
  const withQuery = setup(),
    queried = await withQuery.run(diff, {
      ...argsFor(diff),
      query: { included_schemas: "public,tenant_a", pgdelta: "true" },
    });
  assert.equal(queried.status, 200);
  assert.equal(
    withQuery.stored[0].target,
    `https://api.supabase.com/v1/branches/${branchId}/diff?included_schemas=public%2Ctenant_a&pgdelta=true`,
  );
  const badQuery = setup();
  assert.equal(
    (await badQuery.run(diff, {
      ...argsFor(diff),
      query: { notify_url: "https://foreign.invalid" },
    })).status,
    400,
  );
  assert.equal(badQuery.urls.length, 0);
  const patch = boundContracts["supabase.branches.update_config.bound"],
    i = setup();
  assert.equal(
    (await i.run(patch, {
      ...argsFor(patch),
      body: { notify_url: "https://attacker.invalid" },
    })).status,
    400,
  );
  assert.equal(i.urls.length, 0);
});
Deno.test("bound:repository and BackupDR resource binding reject cross-project and secondary targets", async () => {
  const artifact =
      boundContracts["gcp.artifacts.repositories.prewarm_artifact.bound"],
    f = setup();
  assert.equal(
    (await f.run(artifact, {
      ...argsFor(artifact),
      body: {
        version:
          "projects/foreign/locations/europe-west1/repositories/fixture/packages/a/versions/1",
      },
    })).status,
    403,
  );
  assert.equal(f.urls.length, 0);
  const backup =
      boundContracts["gcp.backups.data_sources.abandon_backup.bound"],
    g = setup(),
    args = argsFor(backup);
  if (object(args.body)) {
    args.body.backup =
      "projects/foreign/locations/europe-west1/backupVaults/a/dataSources/b/backups/c";
  }
  assert((await g.run(backup, args)).status >= 400);
  assert(g.methods.every((m) => m === "GET"));
});
Deno.test("bound:opaque pagination hides tokens, binds current scope and caps pages at100", async () => {
  const op = boundContracts["gcp.pubsub.snapshots.list.bound"],
    f = setup((v) => ({ ...v, nextPageToken: "PRIVATE_PROVIDER_CURSOR" }));
  const result = await f.run(op);
  assert.equal(result.status, 200);
  assert.equal(result.body.next_cursor_id, handle);
  assert(!JSON.stringify(result).includes("PRIVATE_PROVIDER_CURSOR"));
  assert.equal(f.stored[0].target.includes("pageToken"), false);
  assert(f.urls[0].includes("pageSize=100"));
  const follow = await f.run(op, { query: { cursor_id: handle } });
  assert.equal(follow.status, 200);
  assert.equal(f.stored[0].binding_sha256, f.stored[1].binding_sha256);
  assert.equal(f.stored[0].target, f.stored[1].target);
  const g = setup();
  assert.equal((await g.run(op, { query: { pageSize: 500 } })).status, 400);
  assert.equal(g.urls.length, 0);
});
Deno.test("bound:compiled policy flags cannot weaken approval and active credential refusal never falls back", async () => {
  const op = Object.values(boundContracts)[0],
    row = {
      handler: "sandy-provider-bound-api",
      is_mutation: op.is_mutation,
      api_exposed: true,
      verified: true,
      permission_scope: "infrastructure:write",
      error_contract: {
        contract_sha256: op.contract_sha256,
        requires_approval: true,
        requires_grant: true,
        api_key_delegable: false,
      },
    };
  assert(boundContractEnabled(row, op));
  assert.equal(
    boundContractEnabled({
      ...row,
      error_contract: { ...row.error_contract, requires_approval: false },
    }, op),
    false,
  );
  const f = setup();
  f.deps.credentialForExecution = async () => {
    throw Error("private fixture");
  };
  assert.equal((await f.run(op)).status, 424);
  assert.equal(f.urls.length, 0);
});
