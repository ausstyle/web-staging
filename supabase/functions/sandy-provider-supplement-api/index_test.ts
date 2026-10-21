import { strict as assert } from "node:assert";
function assertEquals(actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected);
}
import {
  GCP_NUMBER,
  GCP_PROJECT,
  type Obj,
  PROJECT,
  REGION,
  REPOSITORY,
  supplementContracts,
} from "./contracts.ts";
import {
  createSupplementHandler,
  normalizeReceipt,
  supplementContractEnabled,
} from "./index.ts";
import {
  bytesDigest,
  Calls,
  type Dependencies,
  encode64,
  type OpaqueSave,
  Refusal,
  validate,
} from "./runtime.ts";
import { supplementExecutionScope } from "./scope.ts";
const actor = "11111111-1111-4111-8111-111111111111",
  requestId = "22222222-2222-4222-8222-222222222222";
const grant = "33333333-3333-4333-8333-333333333333",
  admission = "44444444-4444-4444-8444-444444444444";
const handle = "55555555-5555-4555-8555-555555555555",
  now = Date.parse("2026-10-21T01:00:00Z");
const fixture = new TextEncoder().encode("synthetic media fixture only"),
  sha = await bytesDigest(fixture);
const content = {
  content_base64: encode64(fixture),
  sha256: sha,
  media_type: "application/octet-stream",
};
const reply = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
function setup(transport: typeof fetch = () => Promise.resolve(reply({}))) {
  const events: string[] = [],
    receipts: Obj[] = [],
    opaque: OpaqueSave[] = [],
    urls: string[] = [];
  const deps: Dependencies = {
    service: "fixture-private-service",
    now: () => now,
    bindings: {
      organization: { id: "100", verified: true, project_id: GCP_PROJECT },
      folder: { id: "200", verified: true, project_id: GCP_PROJECT },
      billing_account: {
        id: "ABCDEF-ABCDEF-ABCDEF",
        verified: true,
        project_id: GCP_PROJECT,
      },
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
      return "fixture-provider-token";
    },
    finishExecution: async (r) => {
      events.push("finish:" + r.outcome);
      receipts.push(r);
      return { allowed: true };
    },
    fetch: ((url, init) => {
      events.push("fetch");
      urls.push(String(url));
      assertEquals(
        new Headers(init?.headers).get("authorization"),
        "Bearer fixture-provider-token",
      );
      assertEquals(init?.redirect, "manual");
      return transport(url, init);
    }) as typeof fetch,
    saveOpaque: async (r) => {
      events.push("custody");
      opaque.push(r);
      return {
        custody_id: handle,
        byte_length: r.byte_length,
        sha256: r.payload_sha256,
        media_type: r.media_type,
        expires_at: new Date(now + 5 * 60000).toISOString(),
      };
    },
    takeOpaque: async () => {
      events.push("take");
      return new TextEncoder().encode("opaque-provider-next-token");
    },
  };
  const handler = createSupplementHandler(deps);
  const run = async (operation: string, args: Obj = {}, extra: Obj = {}) => {
    const res = await handler(
      new Request("https://fixture.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer fixture-private-service",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation,
          arguments: args,
          actor_id: actor,
          request_id: requestId,
          grant_id: grant,
          tenant_id: null,
          ...extra,
        }),
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  return { deps, handler, run, events, receipts, opaque, urls };
}
Deno.test("supplement: 28 closed dedicated executable contracts; exact output validation", () => {
  assertEquals(Object.keys(supplementContracts).length, 28);
  for (const op of Object.values(supplementContracts)) {
    assert(op.requires_approval);
    assertEquals(op.api_key_delegable, false);
    assertEquals(op.permission_scope, "infrastructure:write");
    assert(/^[a-f0-9]{64}$/.test(op.contract_sha256));
    validate(op.input_schema, {});
    validate(op.output_schema, {});
  }
});
Deno.test("supplement: compiled approval-only policy refuses live metadata drift even on no-cursor reads", () => {
  const op = supplementContracts["gcp.projects.search_filtered"];
  const row = {
    handler: "sandy-provider-supplement-api",
    is_mutation: false,
    api_exposed: true,
    verified: true,
    permission_scope: "infrastructure:write",
    error_contract: {
      contract_sha256: op.contract_sha256,
      requires_grant: true,
      requires_approval: true,
      api_key_delegable: false,
    },
  };
  assert(supplementContractEnabled(row, op));
  for (
    const drift of [
      { requires_approval: false },
      { api_key_delegable: true },
      { requires_grant: false },
      { requires_approval: undefined },
      { api_key_delegable: undefined },
    ]
  ) {
    assertEquals(
      supplementContractEnabled({
        ...row,
        error_contract: { ...row.error_contract, ...drift },
      }, op),
      false,
    );
  }
  assertEquals(
    supplementContractEnabled({
      ...row,
      permission_scope: "infrastructure:read",
    }, op),
    false,
  );
});
Deno.test("supplement: service/normal owner only, never a delegated key or tenant; refusal before credential", async () => {
  const f = setup();
  const unauthorized = await f.handler(
    new Request("https://fixture.invalid", { method: "POST", body: "{}" }),
  );
  assertEquals(unauthorized.status, 403);
  for (
    const extra of [{ credential_id: handle }, { tenant_id: handle }, {
      actor_id: null,
    }]
  ) {
    assertEquals(
      (await f.run("github.security.vulnerability_alerts.check", {}, extra))
        .status,
      400,
    );
  }
  assertEquals(f.events, []);
});
Deno.test("supplement: authorization/grant are consumed before private credential; pointer failure never falls back", async () => {
  const f = setup();
  f.deps.credentialForExecution = async () => {
    f.events.push("credential-refused");
    throw Error("fixture hidden detail");
  };
  const result = await f.run("github.security.vulnerability_alerts.check");
  assertEquals(result.status, 424);
  assertEquals(f.events, [
    "authorize",
    "consume",
    "credential-refused",
    "finish:failed",
  ]);
  assert(!JSON.stringify(result).includes("hidden detail"));
});
Deno.test("supplement: policy denial and replayed grant cause zero provider/credential calls", async () => {
  const f = setup();
  f.deps.consumeGrant = async () => ({
    allowed: true,
    reused: true,
    admission_id: admission,
  });
  assertEquals(
    (await f.run("github.security.vulnerability_alerts.check")).status,
    409,
  );
  assertEquals(f.events, ["authorize"]);
});
Deno.test("supplement: five provider-wide searches filter exact verified identity and hide foreign records/raw cursors", async () => {
  for (
    const [op, field, expected] of [
      [
        "gcp.organizations.search_filtered",
        "organizations",
        "organizations/100",
      ],
      ["gcp.folders.search_filtered", "folders", "folders/200"],
      ["gcp.projects.search_filtered", "projects", `projects/${GCP_NUMBER}`],
      ["gcp.projects.list_filtered", "projects", `projects/${GCP_NUMBER}`],
      [
        "gcp.billing.accounts.list_filtered",
        "billingAccounts",
        "billingAccounts/ABCDEF-ABCDEF-ABCDEF",
      ],
    ]
  ) {
    const f = setup((url) =>
      Promise.resolve(
        String(url).endsWith(`/projects/${GCP_PROJECT}`)
          ? reply({
            name: `projects/${GCP_NUMBER}`,
            projectId: GCP_PROJECT,
            parent: "folders/200",
          })
          : reply({
            [field]: [{
              name: "foreign-resource-secret",
              displayName: "foreign-private",
            }, {
              name: expected,
              projectId: GCP_PROJECT,
              displayName: "fixture",
              state: "ACTIVE",
              credential: "never-disclose",
            }],
            nextPageToken: "raw-private-token",
          }),
      )
    );
    const result = await f.run(op);
    assertEquals(result.status, 200);
    assertEquals(result.body.result.resources.length, 1);
    assertEquals(result.body.result.resources[0].name, expected);
    assertEquals(result.body.result.next_cursor_id, handle);
    assert(!JSON.stringify(result).includes("foreign"));
    assert(!JSON.stringify(result).includes("raw-private-token"));
    assert(!JSON.stringify(result).includes("never-disclose"));
    assertEquals(f.opaque[0].kind, "cursor");
    assertEquals(f.opaque[0].target.includes("pageToken"), false);
    assert(f.events.indexOf("consume") < f.events.indexOf("credential"));
  }
});
Deno.test("supplement: missing bindings fail before policy/provider and fresh parent proof rejects foreign parent", async () => {
  const f = setup();
  f.deps.bindings = undefined;
  assertEquals((await f.run("gcp.organizations.search_filtered")).status, 424);
  assertEquals(f.events, []);
  const g = setup(() =>
    Promise.resolve(
      reply({
        name: `projects/${GCP_NUMBER}`,
        projectId: GCP_PROJECT,
        parent: "folders/foreign",
      }),
    )
  );
  assertEquals((await g.run("gcp.projects.list_filtered")).status, 424);
  assertEquals(g.urls.length, 1);
});
Deno.test("supplement: opaque cursor consumption precedes fixed URL request; raw/cross-scope caller tokens rejected", async () => {
  const f = setup(() => Promise.resolve(reply({ projects: [] })));
  const result = await f.run("gcp.projects.search_filtered", {
    cursor_id: handle,
    page_size: 20,
  });
  assertEquals(result.status, 200);
  assert(f.events.indexOf("take") < f.events.indexOf("fetch"));
  assert(f.urls[0].includes("pageToken=opaque-provider-next-token"));
  assertEquals(
    (await f.run("gcp.projects.search_filtered", { page_token: "attacker" }))
      .status,
    400,
  );
  f.deps.takeOpaque = async () => {
    throw Error("expired");
  };
  const prior = f.urls.length;
  assertEquals(
    (await f.run("gcp.projects.search_filtered", { cursor_id: handle })).status,
    409,
  );
  assertEquals(f.urls.length, prior);
});
Deno.test("supplement: multipart deploy sends exact digest-bound safe files then reads same function; no JWT disable", async () => {
  const f = setup((_url, init) => {
    if (init?.method === "POST") {
      assert(init.body instanceof FormData);
      assertEquals(init.body.getAll("file").length, 1);
    }
    return Promise.resolve(
      reply({
        id: "fixture-function",
        slug: "fixture",
        name: "Fixture",
        status: "ACTIVE",
        version: 1,
        verify_jwt: true,
      }, init?.method === "POST" ? 201 : 200),
    );
  });
  const args = {
    slug: "fixture",
    entrypoint_path: "index.ts",
    verify_jwt: true,
    files: [{
      path: "index.ts",
      content_base64: content.content_base64,
      sha256: sha,
    }],
  };
  const result = await f.run("supabase.functions.deploy.multipart", args);
  assertEquals(result.status, 200);
  assertEquals(result.body.result.readback_matched, true);
  assertEquals(f.urls.length, 2);
  assertEquals(f.receipts[0].outcome, "accepted");
  assert(!JSON.stringify(result).includes("synthetic media"));
  for (
    const bad of [
      { ...args, verify_jwt: false },
      { ...args, files: [{ ...args.files[0], path: "../index.ts" }] },
      { ...args, files: [{ ...args.files[0], sha256: "0".repeat(64) }] },
      { ...args, files: [args.files[0], args.files[0]] },
    ]
  ) {
    const before = f.urls.length;
    assert(
      (await f.run("supabase.functions.deploy.multipart", bad)).status >= 400,
    );
    assertEquals(f.urls.length, before);
  }
});
Deno.test("supplement: mutation timeout or readback mismatch remains unknown with no redispatch", async () => {
  const f = setup(() => {
    throw Error("provider private network detail");
  });
  const result = await f.run("supabase.functions.deploy.multipart", {
    slug: "fixture",
    entrypoint_path: "index.ts",
    verify_jwt: true,
    files: [{
      path: "index.ts",
      content_base64: content.content_base64,
      sha256: sha,
    }],
  });
  assertEquals(result.status, 503);
  assertEquals(f.urls.length, 1);
  assertEquals(f.receipts[0].outcome, "unknown");
  assertEquals(result.body.request_may_have_executed, true);
  assertEquals(result.body.executed, null);
  assertEquals(result.body.reconciliation_required, true);
  assert(!JSON.stringify(result).includes("private network"));
});
Deno.test("supplement: missing final receipt propagates unknown execution through the canonical envelope", async () => {
  const f = setup(() => Promise.resolve(new Response(null, { status: 204 })));
  f.deps.finishExecution = async () => ({ allowed: false });
  const result = await f.run("github.security.vulnerability_alerts.check");
  assertEquals(result.status, 503);
  assertEquals(result.body.executed, null);
  assertEquals(result.body.reconciliation_required, true);
});
Deno.test("supplement: source/media and undocumented Compute response capture bytes privately, no invented semantics", async () => {
  for (
    const [op, args] of [["supabase.functions.body.capture", {
      function_slug: "fixture",
    }], ["gcp.load_balancers.backends.effective_security_policies.capture", {
      backend_service: "fixture",
    }], ["gcp.artifacts.files.download.capture", {
      repository: "fixture",
      file_id: "fixture:file.zip",
    }]] as [string, Obj][]
  ) {
    const f = setup(() =>
      Promise.resolve(
        new Response(fixture, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      )
    );
    const result = await f.run(op, args);
    assertEquals(result.status, 200);
    assertEquals(f.opaque[0].payload_base64, content.content_base64);
    assertEquals(f.opaque[0].payload_sha256, sha);
    assert(!JSON.stringify(result).includes(content.content_base64));
    assert(!JSON.stringify(result).includes("fixture-provider-token"));
    if (op.includes("effective_security")) {
      assertEquals(
        result.body.result.effective_policy_semantics_verified,
        false,
      );
    }
  }
});
Deno.test("supplement: five GitHub status-only checks implement 204/404 without claiming visibility certainty", async () => {
  for (
    const [op, args] of [
      ["github.pulls.merged.check", { pull_number: 1 }],
      ["github.issues.assignee.check", { assignee: "fixture" }],
      ["github.issues.assignee_on_issue.check", {
        assignee: "fixture",
        issue_number: 1,
      }],
      ["github.collaborators.check", { username: "fixture" }],
      ["github.security.vulnerability_alerts.check", {}],
    ] as [string, Obj][]
  ) {
    for (const status of [204, 404]) {
      const f = setup(() =>
        Promise.resolve(
          status === 204
            ? new Response(null, { status })
            : reply({ message: "private fixture error" }, status),
        )
      );
      const result = await f.run(op, args);
      assertEquals(result.status, 200);
      assertEquals(result.body.result.condition, status === 204);
      assertEquals(
        result.body.result.not_found_semantics,
        "provider_condition_or_visibility",
      );
      assert(!JSON.stringify(result).includes("private fixture error"));
    }
  }
});
Deno.test("supplement: seven Artifact Registry multipart adapters carry metadata/bytes and acceptance-only LRO", async () => {
  for (
    const category of ["apt", "files", "generic", "go", "googet", "kfp", "yum"]
  ) {
    const f = setup((_url, init) => {
      assert(init?.body instanceof Blob);
      assert(
        String(new Headers(init.headers).get("content-type")).startsWith(
          "multipart/related;",
        ),
      );
      return Promise.resolve(
        reply({
          operation: {
            name:
              `projects/${GCP_PROJECT}/locations/${REGION}/operations/fixture`,
            done: false,
            metadata: { secret: "never-public" },
          },
        }),
      );
    });
    const metadata = category === "generic"
      ? { filename: "fixture.zip", packageId: "fixture", versionId: "v1" }
      : {};
    const result = await f.run(
      `gcp.artifacts.repositories.${category}.upload.media`,
      { repository: "fixture", ...content, metadata },
    );
    assertEquals(result.status, 200);
    assertEquals(result.body.result.source_sha256, sha);
    assertEquals(result.body.result.effect_confirmed, false);
    assertEquals(f.urls.length, 1);
    assert(!JSON.stringify(result).includes("never-public"));
  }
});
Deno.test("supplement: Storage ownership/precondition and export destination relationship checked before writes", async () => {
  const f = setup((url, init) =>
    Promise.resolve(
      init?.method === "GET" && String(url).includes("/o/")
        ? new Response(fixture)
        : init?.method === "GET"
        ? reply({ name: "fixture-bucket", projectNumber: GCP_NUMBER })
        : String(url).includes("exportArtifact")
        ? reply({
          name: `projects/${GCP_PROJECT}/locations/${REGION}/operations/export`,
        })
        : reply({
          bucket: "fixture-bucket",
          name: "fixture/file",
          size: fixture.length.toString(),
          generation: "1",
        }),
    )
  );
  assertEquals(
    (await f.run("gcp.storage.objects.upload.media", {
      bucket: "fixture-bucket",
      object_name: "fixture/file",
      if_generation_match: "0",
      ...content,
    })).status,
    200,
  );
  assert(f.urls[1].includes("ifGenerationMatch=0"));
  assertEquals(
    (await f.run("gcp.artifacts.repositories.export.bound", {
      repository: "fixture",
      package: "fixture",
      source_type: "versions",
      source_id: "v1",
      destination_bucket: "fixture-bucket",
      destination_prefix: "fixture",
      overwrite_existing: true,
    })).status,
    200,
  );
  const g = setup(() =>
    Promise.resolve(reply({ name: "fixture-bucket", projectNumber: "foreign" }))
  );
  assertEquals(
    (await g.run("gcp.storage.objects.upload.media", {
      bucket: "fixture-bucket",
      object_name: "fixture/file",
      if_generation_match: "0",
      ...content,
    })).status,
    403,
  );
  assertEquals(g.urls.length, 1);
  assertEquals(g.receipts[0].outcome, "failed");
});
Deno.test("supplement: five GitHub redirects remain opaque initiation, no credential forwarding or invented transfer claim", async () => {
  for (
    const [op, args] of [
      ["github.actions.jobs.logs.capture", { job_id: 1 }],
      ["github.actions.jobs.steps.logs.capture", { job_id: 1, step_number: 1 }],
      ["github.actions.runs.attempts.logs.capture", {
        run_id: 1,
        attempt_number: 1,
      }],
      ["github.actions.runs.logs.capture", { run_id: 1 }],
      ["github.actions.artifacts.download.capture", { artifact_id: 1 }],
    ] as [string, Obj][]
  ) {
    const f = setup(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://provider-storage.example.invalid/download?signature=private-fixture",
          },
        }),
      )
    );
    const result = await f.run(op, args);
    assertEquals(result.status, 200);
    assertEquals(f.urls.length, 1);
    assertEquals(result.body.result.payload_transfer_complete, false);
    assertEquals(f.opaque[0].kind, "redirect");
    assert(!JSON.stringify(result).includes("signature"));
    assert(!JSON.stringify(result).includes("provider-storage"));
  }
});
Deno.test("supplement: redirects never fetched, oversized content and invalid receipts fail closed", async () => {
  const f = setup(() =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
    )
  );
  assertEquals(
    (await f.run("github.actions.runs.logs.capture", { run_id: 1 })).status,
    502,
  );
  assertEquals(f.urls.length, 1);
  assertEquals(f.opaque.length, 0);
  const g = setup(() => Promise.resolve(new Response(new Uint8Array(1048577))));
  assertEquals(
    (await g.run("supabase.functions.body.capture", {
      function_slug: "fixture",
    })).status,
    502,
  );
  assertEquals(g.opaque.length, 0);
  const h = setup(() => Promise.resolve(new Response(fixture)));
  h.deps.saveOpaque = async () => ({
    custody_id: handle,
    byte_length: 999,
    sha256: sha,
    media_type: "application/octet-stream",
    expires_at: new Date(now + 10000).toISOString(),
  });
  assertEquals(
    (await h.run("supabase.functions.body.capture", {
      function_slug: "fixture",
    })).status,
    503,
  );
});
Deno.test("supplement: receipt exact state/ID/reuse validation", () => {
  const r = {
    admission_id: admission,
    outcome: "succeeded" as const,
    provider_http_status: 200,
    provider_request_id: null,
    result_sha256: "0".repeat(64),
  };
  assert(
    normalizeReceipt(r, {
      ok: true,
      admission_id: admission,
      state: "succeeded",
      reused: false,
    }).allowed,
  );
  for (
    const bad of [
      { ok: true, admission_id: handle, state: "succeeded", reused: false },
      { ok: true, admission_id: admission, state: "accepted", reused: false },
      { ok: true, admission_id: admission, state: "succeeded", reused: true },
    ]
  ) assertEquals(normalizeReceipt(r, bad).allowed, false);
});
Deno.test("supplement: maximum1MiB transfer has bounded parsing and retains only opaque output", async () => {
  const maximum = new Uint8Array(1048576);
  maximum.fill(70);
  const maximumSha = await bytesDigest(maximum);
  const f = setup((_url, init) =>
    Promise.resolve(
      init?.method === "GET" && String(_url).includes("/o/")
        ? new Response(maximum)
        : init?.method === "GET"
        ? reply({ name: "fixture-bucket", projectNumber: GCP_NUMBER })
        : reply({
          bucket: "fixture-bucket",
          name: "fixture/file",
          size: "1048576",
          generation: "1",
        }),
    )
  );
  const result = await f.run("gcp.storage.objects.upload.media", {
    bucket: "fixture-bucket",
    object_name: "fixture/file",
    if_generation_match: "0",
    content_base64: encode64(maximum),
    sha256: maximumSha,
    media_type: "application/octet-stream",
  });
  assertEquals(result.status, 200);
  assertEquals(result.body.result.source_bytes, 1048576);
  assert(JSON.stringify(result).length < 2000);
});
