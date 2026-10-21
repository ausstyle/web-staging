import assert from "node:assert/strict";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { githubBatchDocument } from "../_shared/sandy_github_batch.ts";
import {
  createSupplementHandler,
  type Dependencies,
} from "../sandy-provider-supplement-api/index.ts";
import { legacyWorkflowContracts } from "./workflow_contracts.ts";
import {
  createLegacyWorkflowHandler,
  functionArtifactDigest,
} from "./workflow_handler.ts";
type Obj = Record<string, any>;
const ACTOR = "10000000-0000-4000-8000-000000000001",
  RID = "20000000-0000-4000-8000-000000000001",
  GRANT = "30000000-0000-4000-8000-000000000001",
  ADMISSION = "40000000-0000-4000-8000-000000000001",
  BEFORE = "a".repeat(40),
  AFTER = "b".repeat(40),
  TREE = "c".repeat(40);
async function digest(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function batch(): Promise<Obj> {
  const files = [{
    path: "docs/sandy-api/compensation-fixtures/batch-a.txt",
    content_base64: btoa("alpha"),
    sha256: await digest("alpha"),
  }, {
    path: "docs/sandy-api/compensation-fixtures/batch-b.txt",
    content_base64: btoa("beta"),
    sha256: await digest("beta"),
  }];
  return {
    repository: "ausstyle/web-staging",
    branch: "compat-fixture",
    expected_head_oid: BEFORE,
    headline: "Scoped two-file commit",
    files,
    files_sha256: await argumentDigest(
      files.map((f) => ({ path: f.path, sha256: f.sha256 })),
    ),
  };
}
async function deployment(): Promise<Obj> {
  const args: Obj = {
    project_id: "zmqlyygzqoidkcwdysok",
    slug: "compat-fixture",
    name: "compat-fixture",
    entrypoint_path: "index.ts",
    verify_jwt: true,
    files: [{
      path: "index.ts",
      content_base64: btoa("Deno.serve(()=>Response.json({fixture:true}));"),
      sha256: await digest("Deno.serve(()=>Response.json({fixture:true}));"),
    }],
  };
  args.artifact_ref = await functionArtifactDigest(args);
  return args;
}
const gql = () => ({
  data: {
    createCommitOnBranch: {
      clientMutationId: ADMISSION,
      commit: {
        oid: AFTER,
        tree: { oid: TREE },
        parents: { nodes: [{ oid: BEFORE }] },
        repository: { nameWithOwner: "ausstyle/web-staging" },
      },
      ref: {
        name: "compat-fixture",
        prefix: "refs/heads/",
        repository: { nameWithOwner: "ausstyle/web-staging" },
        target: { oid: AFTER },
      },
    },
  },
});
function setup(mode = "success") {
  const consumed: Obj[] = [],
    finished: Obj[] = [],
    calls: { url: string; init?: RequestInit }[] = [],
    credentialOperations: string[] = [];
  const deps: Dependencies = {
    service: "internal-fixture",
    authorizeContext: async (c, o) => {
      assert.equal(c.actor_id, ACTOR);
      assert.equal(c.tenant_id, null);
      assert.ok(legacyWorkflowContracts[o.operation]);
      return { allowed: true };
    },
    consumeGrant: async (r) => {
      consumed.push(r);
      return { allowed: true, admission_id: ADMISSION };
    },
    finishExecution: async (r) => {
      finished.push(r);
      return { allowed: mode !== "lost_receipt" };
    },
    credentialForExecution: async (o) => {
      credentialOperations.push(o.operation);
      return "PRIVATE_PROVIDER_TOKEN";
    },
    saveOpaque: async () => {
      throw Error("No private capture expected");
    },
    takeOpaque: async () => {
      throw Error("No cursor expected");
    },
    fetch: (async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer PRIVATE_PROVIDER_TOKEN",
      );
      if (url.includes("/functions/")) {
        const metadata = {
          id: ADMISSION,
          slug: "compat-fixture",
          name: "compat-fixture",
          status: "ACTIVE",
          version: 1,
          verify_jwt: true,
        };
        if (init?.method === "POST") {
          assert.equal(
            url,
            "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/functions/deploy?slug=compat-fixture",
          );
          assert.ok(init.body instanceof FormData);
          const m = JSON.parse(String(init.body.get("metadata")));
          assert.equal(m.verify_jwt, true);
          return Response.json(metadata, { status: 201 });
        }
        assert.equal(
          url,
          "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/functions/compat-fixture",
        );
        return Response.json(metadata);
      }
      if (url === "https://api.github.com/graphql") {
        assert.equal(init?.method, "POST");
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.query, githubBatchDocument);
        assert.deepEqual(payload.variables.input.branch, {
          repositoryNameWithOwner: "ausstyle/web-staging",
          branchName: "compat-fixture",
        });
        assert.equal(payload.variables.input.expectedHeadOid, BEFORE);
        assert.equal(payload.variables.input.clientMutationId, ADMISSION);
        assert.equal(payload.variables.input.fileChanges.additions.length, 2);
        if (mode === "graphql_error") {
          return Response.json({
            errors: [{ message: "Synthetic CAS conflict" }],
            data: { createCommitOnBranch: null },
          });
        }
        if (mode === "lost_mutation") throw Error("Provider transport lost");
        const value = gql();
        if (mode === "foreign_repository") {
          value.data.createCommitOnBranch.commit.repository.nameWithOwner =
            "foreign/repo";
        }
        return Response.json(value);
      }
      assert.equal(
        url,
        "https://api.github.com/repos/ausstyle/web-staging/git/ref/heads%2Fcompat-fixture",
      );
      if (calls.length === 3 && mode === "lost_readback") {
        throw Error("Readback transport lost");
      }
      const sha = calls.length === 1
        ? (mode === "stale_head" ? AFTER : BEFORE)
        : (mode === "changed_readback" ? TREE : AFTER);
      return Response.json({
        ref: "refs/heads/compat-fixture",
        object: { type: "commit", sha },
      });
    }) as typeof fetch,
  };
  const handler = createLegacyWorkflowHandler(deps);
  const call = (operation: string, args: Obj) =>
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
        }),
      }),
    );
  return { call, deps, consumed, finished, calls, credentialOperations };
}
Deno.test("workflow catalogue is deeply frozen and hashes retain distinct original operation identities", async () => {
  assert.equal(Object.keys(legacyWorkflowContracts).length, 2);
  for (const op of Object.values(legacyWorkflowContracts)) {
    assert.ok(Object.isFrozen(op));
    assert.ok(Object.isFrozen(op.input_schema));
    const { contract_sha256, ...unsigned } = op;
    assert.equal(await argumentDigest(unsigned), contract_sha256);
  }
  assert.throws(
    () => createSupplementHandler(setup().deps, { ...legacyWorkflowContracts }),
    /immutable_supplement_catalogue_required/,
  );
});
Deno.test("two-file push uses native expectedHeadOid CAS once and reconciles the exact resulting branch head", async () => {
  const h = setup(), args = await batch();
  const r = await h.call("github.push_files", args);
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.equal(body.operation, "github.push_files");
  assert.equal(body.result.commit_oid, AFTER);
  assert.equal(body.result.native_precondition, "expectedHeadOid");
  assert.equal(body.result.branch_head_observed_match, true);
  assert.equal(body.result.files_changed, 2);
  assert.equal(body.result.effect_confirmed, false);
  assert.equal(JSON.stringify(body).includes("PRIVATE_PROVIDER_TOKEN"), false);
  assert.equal(h.consumed[0].operation, "github.push_files");
  assert.equal(h.consumed[0].input_sha256, await argumentDigest(args));
  assert.equal(
    h.consumed[0].scope_sha256,
    await argumentDigest({
      provider: "github",
      repository: "ausstyle/web-staging",
    }),
  );
  assert.deepEqual([h.consumed.length, h.finished.length, h.calls.length], [
    1,
    1,
    3,
  ]);
  assert.deepEqual(h.credentialOperations, ["github.push_files"]);
  assert.equal(h.finished[0].outcome, "accepted");
});
Deno.test("native batch early stale-head refusal never sends a mutation", async () => {
  const h = setup("stale_head");
  const r = await h.call("github.push_files", await batch());
  assert.equal(r.status, 409);
  assert.equal((await r.json()).executed, false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.finished[0].outcome, "failed");
});
Deno.test("ambiguous GraphQL, foreign identity, changed/lost readback and lost receipt never retry or claim unexecuted", async () => {
  for (
    const mode of [
      "graphql_error",
      "lost_mutation",
      "foreign_repository",
      "changed_readback",
      "lost_readback",
      "lost_receipt",
    ]
  ) {
    const h = setup(mode);
    const r = await h.call("github.push_files", await batch());
    assert.equal(r.status, 503, mode + await r.clone().text());
    const body = await r.json();
    assert.equal(body.executed, null, mode);
    assert.equal(body.reconciliation_required, true, mode);
    assert.equal(
      h.calls.filter((c) => c.url === "https://api.github.com/graphql").length,
      1,
    );
    assert.equal(h.consumed.length, 1);
    assert.equal(h.finished.length, 1);
  }
});
Deno.test("batch duplicate/traversal paths, altered source, manifest, repository and ref fail before grant or credential access", async () => {
  for (
    const change of [
      "duplicate",
      "traversal",
      "content",
      "manifest",
      "repository",
      "ref",
    ]
  ) {
    const args = await batch();
    if (change === "duplicate") args.files[1].path = args.files[0].path;
    if (change === "traversal") args.files[0].path = "../escape";
    if (change === "content") args.files[0].content_base64 = btoa("tampered");
    if (change === "manifest") args.files_sha256 = "0".repeat(64);
    if (change === "repository") args.repository = "foreign/repo";
    if (change === "ref") args.branch = "a/../escape";
    const h = setup();
    const r = await h.call("github.push_files", args);
    assert.equal(r.status, 400, change);
    assert.deepEqual([
      h.consumed.length,
      h.calls.length,
      h.credentialOperations.length,
    ], [0, 0, 0]);
  }
});
Deno.test("digest-bound legacy function deployment reuses actual multipart submission and metadata readback", async () => {
  const h = setup(), args = await deployment();
  const r = await h.call("supabase.deploy_edge_function", args);
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.equal(body.operation, "supabase.deploy_edge_function");
  assert.equal(body.result.readback_matched, true);
  assert.equal(body.result.verify_jwt, true);
  assert.equal(body.result.transfer_state, "accepted");
  assert.equal(h.consumed[0].input_sha256, await argumentDigest(args));
  assert.deepEqual([h.consumed.length, h.finished.length, h.calls.length], [
    1,
    1,
    2,
  ]);
  assert.deepEqual(h.credentialOperations, ["supabase.deploy_edge_function"]);
});
Deno.test("artifact digest, target, source bytes and JWT boundary cannot change before deployment admission", async () => {
  for (const change of ["digest", "target", "source", "jwt"]) {
    const args = await deployment();
    if (change === "digest") args.artifact_ref = "0".repeat(64);
    if (change === "target") args.name = "different";
    if (change === "source") args.files[0].content_base64 = btoa("changed");
    if (change === "jwt") args.verify_jwt = false;
    const h = setup();
    assert.equal(
      (await h.call("supabase.deploy_edge_function", args)).status,
      400,
      change,
    );
    assert.deepEqual([
      h.consumed.length,
      h.calls.length,
      h.credentialOperations.length,
    ], [0, 0, 0]);
  }
});
