import { strict as assert } from "node:assert";
import {
  createGapHandler,
  gapContracts,
  gapExecutionScope,
  normalizeGapReceipt,
  validateGapContracts,
} from "./index.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { GCP_PROJECT, type Obj, PROJECT, REPOSITORY } from "./contracts.ts";
import {
  type Dependencies,
  type Finish,
  type PackageProof,
  redact,
  type ScopeBinding,
} from "./runtime.ts";
const actor = "10000000-0000-4000-8000-000000000001",
  request = "10000000-0000-4000-8000-000000000002",
  grant = "10000000-0000-4000-8000-000000000003",
  admission = "10000000-0000-4000-8000-000000000004";
const now = Date.parse("2026-10-21T00:00:00Z"),
  timestamp = "2026-10-20T23:59:30Z";
const repo = {
    id: 123,
    full_name: REPOSITORY,
    owner: { login: "ausstyle", type: "Organization" },
  },
  graphRepo = {
    id: "R_123",
    nameWithOwner: REPOSITORY,
    owner: { login: "ausstyle", __typename: "Organization" },
  };
const category = {
  id: "DIC_123",
  slug: "general",
  name: "General",
  isAnswerable: true,
};
const disc = {
  id: "D_123",
  number: 2,
  title: "Hello",
  bodyText: "Details",
  url: "https://github.com/ausstyle/web-staging/discussions/2",
  createdAt: timestamp,
  updatedAt: timestamp,
  closed: false,
  locked: false,
  isAnswered: false,
  category,
  author: { login: "owner" },
  answer: null,
  repository: { nameWithOwner: REPOSITORY },
};
const comment = {
  __typename: "DiscussionComment",
  id: "DC_123",
  bodyText: "Reply",
  createdAt: timestamp,
  updatedAt: timestamp,
  isAnswer: false,
  author: { login: "owner" },
  replyTo: null,
  discussion: { number: 2, repository: { nameWithOwner: REPOSITORY } },
};
const page = { hasNextPage: false, endCursor: null };
const pkg = {
  id: 456,
  name: "package",
  package_type: "npm",
  visibility: "private",
  repository: { full_name: REPOSITORY },
  owner: { login: "ausstyle" },
  created_at: timestamp,
  updated_at: timestamp,
  version_count: 0,
};
const version = {
  id: 789,
  name: "1.0.0",
  created_at: timestamp,
  updated_at: timestamp,
  metadata: { container: { tags: [] } },
};
const proof: PackageProof = {
  repository_id: 123,
  package_id: 456,
  package_type: "npm",
  package_name: "package",
  version_id: 789,
  response_sha256: "a".repeat(64),
  observed_at: timestamp,
  provider_request_id: "provider-123",
};
const binding: ScopeBinding = {
  verified: true,
  repository: REPOSITORY,
  repository_id: 123,
  owner: "ausstyle",
  package_type: "npm",
  package_name: "package",
  exclusive_namespace: true,
  expires_at: "2026-10-21T00:10:00Z",
  attestation_sha256: "a".repeat(64),
};
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": "provider-123",
      ...headers,
    },
  });
type Seen = { url: URL; method: string; body: Obj | undefined };
function harness(
  override: Partial<Dependencies> = {},
  provider?: (call: Seen) => Response | Promise<Response>,
) {
  const seen: Seen[] = [],
    finishes: Finish[] = [],
    grants: Obj[] = [],
    saved: PackageProof[] = [];
  const deps: Dependencies = {
    service: "internal-service",
    management: "management-token",
    github: "github-token",
    getGcpAccessToken: async () => "gcp-token",
    now: () => now,
    authorizeContext: async () => ({ allowed: true }),
    consumeGrant: async (r) => {
      grants.push(r);
      return { allowed: true, admission_id: admission };
    },
    finishExecution: async (r) => {
      finishes.push(r);
      return { allowed: true };
    },
    packageRestoreBindings: [binding],
    savePackageProof: async (_a, _b, p) => {
      saved.push(p);
    },
    loadPackageProof: async () => proof,
    ...override,
    fetch: (async (input, init) => {
      const call = {
        url: new URL(String(input)),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      seen.push(call);
      return await (provider ?? defaultProvider)(call);
    }) as typeof fetch,
  };
  return { seen, finishes, grants, saved, handler: createGapHandler(deps) };
}
function defaultProvider({ url: u, method, body }: Seen): Response {
  if (u.host === "compute.googleapis.com") {
    return json({ contents: "VM ready", start: "0", next: "8" });
  }
  if (u.host === "api.supabase.com") {
    if (u.pathname === `/v1/projects/${PROJECT}`) {
      return json({
        ref: PROJECT,
        id: PROJECT,
        organization_id: "org123",
        organization_slug: "bound-org",
      });
    }
    if (u.pathname === "/v1/organizations") {
      return json([{ id: "other", slug: "unrelated", name: "Other" }, {
        id: "org123",
        slug: "bound-org",
        name: "Bound",
      }]);
    }
    if (u.pathname === "/v1/organizations/bound-org") {
      return json({ id: "org123", name: "Bound", plan: "private-plan" });
    }
    return json({
      result: [{
        id: "log123",
        timestamp,
        source: "edge_logs",
        event_message: "password=hunter2",
      }],
    });
  }
  if (u.pathname === "/graphql") {
    const q = String(body?.query);
    if (q.startsWith("mutation")) {
      const field = q.match(/\{\s*(\w+)\(input:/)![1],
        input = body!.variables as Obj;
      const mutationInput = input.input as Obj;
      return json({
        data: {
          [field]: {
            clientMutationId: mutationInput.clientMutationId,
            ...(field.includes("Comment") && !field.includes("AsAnswer")
              ? { comment }
              : { discussion: disc }),
          },
        },
      });
    }
    if (q.includes("SandyDiscussionCategories")) {
      return json({
        data: {
          repository: {
            ...graphRepo,
            discussionCategories: { nodes: [category], pageInfo: page },
          },
        },
      });
    }
    if (q.includes("SandyDiscussions(")) {
      return json({
        data: {
          repository: {
            ...graphRepo,
            discussions: { nodes: [disc], pageInfo: page },
          },
        },
      });
    }
    if (q.includes("SandyDiscussionComments(")) {
      return json({
        data: {
          repository: {
            ...graphRepo,
            discussion: {
              ...disc,
              comments: { nodes: [comment], pageInfo: page },
            },
          },
        },
      });
    }
    if (q.includes("SandyDiscussionReplies(")) {
      return json({
        data: {
          node: { ...comment, replies: { nodes: [comment], pageInfo: page } },
        },
      });
    }
    if (q.includes("SandyDiscussionComment(")) {
      return json({ data: { node: comment } });
    }
    if (q.includes("SandyDiscussion(")) {
      return json({ data: { repository: { ...graphRepo, discussion: disc } } });
    }
    return json({ data: { repository: graphRepo } });
  }
  if (u.pathname === `/repos/${REPOSITORY}`) return json(repo);
  if (u.pathname === "/orgs/ausstyle/audit-log") {
    return json([{
      action: "repo.create",
      actor: "owner",
      repo: REPOSITORY,
      "@timestamp": now - 30000,
    }, {
      action: "org.update",
      actor: "owner",
      org: "ausstyle",
      "@timestamp": now - 30000,
    }]);
  }
  if (u.pathname.includes("/environments/")) {
    if (u.pathname.endsWith("/public-key")) {
      return json({ key_id: "key123", key: btoa("x".repeat(32)) });
    }
    if (method !== "GET") return json(null, 204);
    const secret = {
      name: "TEST",
      created_at: timestamp,
      updated_at: timestamp,
      value: "must-not-disclose",
    };
    return json(
      u.pathname.endsWith("/secrets")
        ? { total_count: 1, secrets: [secret] }
        : secret,
    );
  }
  if (method !== "GET") return json(null, 204);
  if (u.pathname.endsWith("/packages")) {
    return json([pkg, {
      ...pkg,
      id: 457,
      repository: { full_name: "ausstyle/other" },
    }]);
  }
  if (u.pathname.endsWith("/versions")) return json([version]);
  if (u.pathname.includes("/versions/")) return json(version);
  return json(pkg);
}
function requestFor(
  operation: string,
  args: Obj = {},
  extra: Obj = {},
): Request {
  return new Request("http://internal", {
    method: "POST",
    headers: {
      authorization: "Bearer internal-service",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      operation,
      arguments: args,
      actor_id: actor,
      tenant_id: null,
      request_id: request,
      grant_id: grant,
      ...extra,
    }),
  });
}
const argsFor = (kind: string): Obj =>
  kind === "serial"
    ? { instance: "fixture" }
    : kind.startsWith("org_")
    ? {}
    : kind === "logs"
    ? {
      source: "edge_logs",
      start: "2026-10-20T23:59:00Z",
      end: "2026-10-21T00:00:00Z",
    }
    : kind === "audit"
    ? { start: "2026-10-20", end: "2026-10-21" }
    : kind.startsWith("secret_")
    ? {
      environment: "staging",
      ...(["secret_get", "secret_set", "secret_delete"].includes(kind)
        ? { secret_name: "TEST" }
        : {}),
      ...(kind === "secret_set"
        ? { key_id: "key123", encrypted_value: btoa("a".repeat(64)) }
        : {}),
    }
    : kind === "package_list"
    ? { package_type: "npm" }
    : kind.startsWith("package_") || kind.startsWith("version_")
    ? {
      package_type: "npm",
      package_name: "package",
      ...(kind.startsWith("version_") && kind !== "version_list"
        ? { version_id: 789 }
        : {}),
      ...([
          "package_delete",
          "package_restore",
          "version_delete",
          "version_restore",
        ].includes(kind)
        ? { expected_package_id: 456 }
        : {}),
    }
    : kind === "discussion_categories" || kind === "discussion_list"
    ? {}
    : kind === "discussion_create"
    ? { title: "A", body: "B", category_slug: "general" }
    : kind === "discussion_update"
    ? { number: 2, title: "Updated" }
    : kind === "comment_list"
    ? { number: 2 }
    : kind === "comment_create"
    ? { number: 2, body: "Reply" }
    : kind === "comment_update"
    ? { number: 2, comment_id: "DC_123", body: "Edit" }
    : kind.startsWith("comment_") || kind === "reply_list"
    ? { number: 2, comment_id: "DC_123" }
    : { number: 2 };
Deno.test("all 35 exact contracts compile, hash source pins, and have executable provider transports", async () => {
  assert.equal(validateGapContracts(), 35);
  for (const op of Object.values(gapContracts)) {
    assert.match(op.source_sha256, /^[a-f0-9]{64}$/);
    const h = harness();
    const r = await h.handler(requestFor(op.operation, argsFor(op.kind)));
    const value = await r.json();
    assert.equal(
      r.status,
      200,
      JSON.stringify({ operation: op.operation, ...value }),
    );
    assert.equal(value.operation, op.operation);
    assert.equal(value.request_state, op.is_mutation ? "accepted" : "observed");
    assert.equal(
      h.finishes.at(-1)?.outcome,
      op.is_mutation ? "accepted" : "succeeded",
    );
    assert.ok(h.seen.length);
    assert.equal(
      h.grants[0].input_sha256,
      await argumentDigest(argsFor(op.kind)),
    );
    assert.equal(h.grants[0].contract_sha256, op.contract_sha256);
  }
});
Deno.test("service boundary, closed schemas, policy refusal and one-use refusal perform no provider call", async () => {
  const h = harness();
  assert.equal(
    (await h.handler(new Request("http://internal", { method: "POST" })))
      .status,
    403,
  );
  for (
    const [op, args] of [
      ["supabase.logs.query", { ...argsFor("logs"), sql: "select secret" }],
      ["gcp.compute.instances.serial_output", { instance: "../../other" }],
      ["github.discussions.list", { query: "mutation{}" }],
      ["github.environment_secrets.list", { environment: "../../prod" }],
    ] as [string, Obj][]
  ) assert.equal((await h.handler(requestFor(op, args))).status, 400);
  assert.equal(h.seen.length, 0);
  assert.equal(h.grants.length, 0);
  const policy = harness({
    authorizeContext: async () => ({ allowed: false }),
  });
  assert.equal(
    (await policy.handler(requestFor("supabase.orgs.list"))).status,
    403,
  );
  assert.equal(policy.grants.length, 0);
  const reused = harness({
    consumeGrant: async () => ({
      allowed: true,
      reused: true,
      admission_id: admission,
    }),
  });
  assert.equal(
    (await reused.handler(requestFor("supabase.orgs.list"))).status,
    409,
  );
  assert.equal(reused.seen.length, 0);
});
Deno.test("organization projection uses authoritative project relation and omits all other memberships", async () => {
  const h = harness(),
    r = await h.handler(requestFor("supabase.orgs.list")),
    value = await r.json();
  assert.equal(value.result.organizations.length, 1);
  assert.equal(value.result.organizations[0].slug, "bound-org");
  assert.ok(!JSON.stringify(value).includes("unrelated"));
  const mismatch = harness(
    {},
    (c) =>
      c.url.pathname === `/v1/projects/${PROJECT}`
        ? json({ ref: "other", id: "other" })
        : defaultProvider(c),
  );
  assert.equal(
    (await mismatch.handler(requestFor("supabase.orgs.list"))).status,
    502,
  );
  const empty = harness(
    {},
    (c) =>
      c.url.pathname === "/v1/organizations" ? json([]) : defaultProvider(c),
  );
  assert.equal(
    (await empty.handler(requestFor("supabase.orgs.get"))).status,
    424,
  );
  assert.equal(empty.seen.length, 2);
});
Deno.test("actual logs endpoint uses fixed unified table/source, bounded timestamps and redacted projections", async () => {
  const h = harness(),
    r = await h.handler(requestFor("supabase.logs.query", argsFor("logs"))),
    v = await r.json(),
    u = h.seen[0].url;
  assert.equal(u.pathname, `/v1/projects/${PROJECT}/analytics/endpoints/logs`);
  assert.equal(
    u.searchParams.get("sql"),
    "SELECT id, timestamp, source, event_message FROM logs WHERE source = 'edge_logs' ORDER BY timestamp DESC LIMIT 25",
  );
  assert.ok(!JSON.stringify(v).includes("hunter2"));
  assert.equal(v.result.entries[0].message, "password=[REDACTED]");
  const error = harness(
    {},
    () => json({ error: "private provider body must not leak" }),
  );
  const er = await error.handler(
    requestFor("supabase.logs.query", argsFor("logs")),
  );
  assert.equal(er.status, 424);
  assert.ok(!(await er.text()).includes("private provider"));
  assert.equal(error.finishes[0].outcome, "failed");
  const foreign = harness(
    {},
    () =>
      json({
        result: [{
          id: "x",
          timestamp,
          source: "auth_logs",
          event_message: "content",
        }],
      }),
  );
  assert.equal(
    (await foreign.handler(requestFor("supabase.logs.query", argsFor("logs"))))
      .status,
    502,
  );
  const tooLong = harness();
  assert.equal(
    (await tooLong.handler(
      requestFor("supabase.logs.query", {
        ...argsFor("logs"),
        start: "2026-10-19T00:00:00Z",
      }),
    )).status,
    400,
  );
  assert.equal(tooLong.seen.length, 0);
});
Deno.test("serial uses fixed project/zone, rejects offset overflow and redacts known credentials", async () => {
  const contents =
    "Bearer SECRET123 password=hidden\n-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----";
  const h = harness({}, () => json({ contents, start: "0", next: "80" }));
  const r = await h.handler(
    requestFor("gcp.compute.instances.serial_output", {
      instance: "fixture",
      port: 2,
      start: "-1024",
    }),
  );
  assert.equal(r.status, 200);
  const v = await r.json();
  assert.ok(!JSON.stringify(v).includes("SECRET123"));
  assert.ok(!JSON.stringify(v).includes("hidden"));
  assert.ok(!JSON.stringify(v).includes("\nprivate"));
  assert.equal(
    h.seen[0].url.pathname,
    `/compute/v1/projects/${GCP_PROJECT}/zones/europe-west1-b/instances/fixture/serialPort`,
  );
  assert.equal(h.seen[0].url.searchParams.get("port"), "2");
  const overflow = harness();
  assert.equal(
    (await overflow.handler(
      requestFor("gcp.compute.instances.serial_output", {
        instance: "fixture",
        start: "9223372036854775808",
      }),
    )).status,
    400,
  );
  assert.equal(overflow.seen.length, 0);
  assert.match(redact("https://user:pass@example.com"), /REDACTED/);
});
Deno.test("environment secret writes pin encryption key and never disclose values", async () => {
  const h = harness(
    {},
    (c) =>
      c.url.pathname.endsWith("/public-key")
        ? json({ key_id: "rotated", key: btoa("x".repeat(32)) })
        : defaultProvider(c),
  );
  assert.equal(
    (await h.handler(
      requestFor("github.environment_secrets.set", argsFor("secret_set")),
    )).status,
    409,
  );
  assert.ok(h.seen.every((c) => c.method === "GET"));
  const m = harness();
  const r = await m.handler(
    requestFor("github.environment_secrets.list", argsFor("secret_list")),
  );
  assert.ok(!(await r.text()).includes("must-not-disclose"));
  const delegate = harness();
  assert.equal(
    (await delegate.handler(
      requestFor("github.environment_secrets.set", argsFor("secret_set"), {
        credential_id: actor,
      }),
    )).status,
    403,
  );
  assert.equal(delegate.seen.length, 0);
});
Deno.test("package reads filter owner pages by actual repository association and user namespaces stay bound", async () => {
  const h = harness(),
    r = await h.handler(
      requestFor("github.packages.list", argsFor("package_list")),
    ),
    v = await r.json();
  assert.equal(v.result.packages.length, 1);
  assert.equal(v.result.packages[0].version_count, 0);
  const user = harness(
    {},
    (c) =>
      c.url.pathname === `/repos/${REPOSITORY}`
        ? json({ ...repo, owner: { login: "ausstyle", type: "User" } })
        : defaultProvider(c),
  );
  assert.equal(
    (await user.handler(
      requestFor("github.packages.get", argsFor("package_get")),
    )).status,
    200,
  );
  assert.equal(
    user.seen[1].url.pathname,
    "/users/ausstyle/packages/npm/package",
  );
  const changed = harness();
  assert.equal(
    (await changed.handler(
      requestFor("github.packages.delete", {
        ...argsFor("package_delete"),
        expected_package_id: 999,
      }),
    )).status,
    409,
  );
  assert.ok(changed.seen.every((c) => c.method === "GET"));
});
Deno.test("package deletion persists actual preflight proof before dispatch; restore needs exclusive binding and immutable evidence", async () => {
  let stored = false;
  const h = harness({
    savePackageProof: async () => {
      stored = true;
    },
  }, (c) => {
    if (c.method === "DELETE") assert.equal(stored, true);
    return defaultProvider(c);
  });
  assert.equal(
    (await h.handler(
      requestFor("github.packages.delete", argsFor("package_delete")),
    )).status,
    200,
  );
  const noBinding = harness({ packageRestoreBindings: [] });
  assert.equal(
    (await noBinding.handler(
      requestFor("github.packages.restore", argsFor("package_restore")),
    )).status,
    424,
  );
  assert.ok(noBinding.seen.every((c) => c.method === "GET"));
  const badProof = harness({
    loadPackageProof: async () => ({ ...proof, package_id: 999 }),
  });
  assert.equal(
    (await badProof.handler(
      requestFor("github.packages.restore", argsFor("package_restore")),
    )).status,
    424,
  );
  assert.ok(badProof.seen.every((c) => c.method === "GET"));
  const changed = harness(
    {},
    (c) =>
      c.url.pathname.endsWith("/packages/npm/package")
        ? json({ ...pkg, id: 999 })
        : defaultProvider(c),
  );
  const r = await changed.handler(
    requestFor("github.packages.restore", argsFor("package_restore")),
  );
  assert.equal(r.status, 503);
  assert.equal(changed.finishes.at(-1)?.outcome, "unknown");
});
Deno.test("discussion comment mutations resolve fixed-repository identity before using immutable GraphQL documents", async () => {
  const h = harness(
    {},
    (c) =>
      c.url.pathname === "/graphql" &&
        String(c.body?.query).includes("SandyDiscussionComment(")
        ? json({
          data: {
            node: {
              ...comment,
              discussion: {
                number: 2,
                repository: { nameWithOwner: "ausstyle/foreign" },
              },
            },
          },
        })
        : defaultProvider(c),
  );
  const r = await h.handler(
    requestFor("github.discussions.comments.delete", argsFor("comment_delete")),
  );
  assert.equal(r.status, 502);
  assert.ok(h.seen.every((c) => !String(c.body?.query).startsWith("mutation")));
  const receipt = harness(
    {},
    (c) =>
      String(c.body?.query).startsWith("mutation")
        ? json({
          data: {
            deleteDiscussionComment: {
              clientMutationId: request,
              comment: null,
            },
          },
        })
        : defaultProvider(c),
  );
  assert.equal(
    (await receipt.handler(
      requestFor(
        "github.discussions.comments.delete",
        argsFor("comment_delete"),
      ),
    )).status,
    200,
  );
  const wrong = harness(
    {},
    (c) =>
      String(c.body?.query).startsWith("mutation")
        ? json({
          data: {
            closeDiscussion: { clientMutationId: "wrong", discussion: disc },
          },
        })
        : defaultProvider(c),
  );
  assert.equal(
    (await wrong.handler(requestFor("github.discussions.close", { number: 2 })))
      .status,
    503,
  );
  assert.equal(wrong.finishes.at(-1)?.outcome, "unknown");
});
Deno.test("audit query is generated, org ownership is proved and org-global payloads are omitted", async () => {
  const h = harness(),
    r = await h.handler(requestFor("github.audit.list", argsFor("audit"))),
    v = await r.json();
  assert.equal(v.result.events.length, 1);
  assert.equal(
    h.seen[1].url.searchParams.get("phrase"),
    `repo:${REPOSITORY} created:2026-10-20..2026-10-21`,
  );
  const user = harness(
    {},
    (c) =>
      c.url.pathname === `/repos/${REPOSITORY}`
        ? json({ ...repo, owner: { login: "ausstyle", type: "User" } })
        : defaultProvider(c),
  );
  assert.equal(
    (await user.handler(requestFor("github.audit.list", argsFor("audit"))))
      .status,
    424,
  );
  assert.equal(user.seen.length, 1);
  const denied = harness(
    {},
    (c) =>
      c.url.pathname.includes("audit-log")
        ? json({ message: "private denied" }, 403)
        : defaultProvider(c),
  );
  const deniedResult = await (await denied.handler(
    requestFor("github.audit.list", argsFor("audit")),
  )).json();
  assert.equal(deniedResult.error, "provider_authorization_refused");
  assert.ok(!JSON.stringify(deniedResult).includes("entitlement"));
});
Deno.test("receipt ambiguity never reports success and finish RPC normalization is state exact", async () => {
  const h = harness({ finishExecution: async () => ({ allowed: false }) });
  assert.equal((await h.handler(requestFor("supabase.orgs.list"))).status, 503);
  const finish: Finish = {
    admission_id: admission,
    outcome: "accepted",
    provider_http_status: 204,
    provider_request_id: "provider-123",
    result_sha256: "a".repeat(64),
  };
  assert.equal(
    normalizeGapReceipt(finish, {
      ok: true,
      admission_id: admission,
      state: "accepted",
      reused: false,
    }).allowed,
    true,
  );
  assert.equal(
    normalizeGapReceipt(finish, {
      ok: true,
      admission_id: admission,
      state: "succeeded",
      reused: false,
    }).allowed,
    false,
  );
  const gcp = gapExecutionScope("gcp.compute.instances.serial_output");
  assert.equal(
    gcp.service_account,
    "sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com",
  );
});
Deno.test("explicit provider mutation refusal is failed while network ambiguity stays unknown", async () => {
  const denied = harness(
    {},
    (c) =>
      c.method === "DELETE"
        ? json({ message: "not authorized" }, 403)
        : defaultProvider(c),
  );
  const r = await denied.handler(
    requestFor("github.environment_secrets.delete", argsFor("secret_delete")),
  );
  assert.equal(r.status, 424);
  assert.equal(denied.finishes.at(-1)?.outcome, "failed");
  assert.equal(denied.finishes.at(-1)?.provider_http_status, 403);
  const timeout = harness({}, (c) => {
    if (c.method === "DELETE") throw new Error("network timeout");
    return defaultProvider(c);
  });
  const failed = await timeout.handler(
    requestFor("github.environment_secrets.delete", argsFor("secret_delete")),
  );
  assert.equal(failed.status, 503);
  assert.equal(timeout.finishes.at(-1)?.outcome, "unknown");
  const restored = harness();
  const accepted = await (await restored.handler(
    requestFor("github.packages.restore", argsFor("package_restore")),
  )).json();
  assert.equal(accepted.provider_http_status, 204);
  assert.equal(restored.finishes.at(-1)?.provider_http_status, 204);
  assert.equal(restored.seen.at(-1)?.method, "GET");
});
Deno.test("cross-host pagination, GraphQL errors, and foreign tenant scopes cannot succeed", async () => {
  const pagination = harness(
    {},
    (c) =>
      c.url.pathname.endsWith("/packages")
        ? json([pkg], 200, {
          link: '<https://evil.invalid/?page=2>; rel="next"',
        })
        : defaultProvider(c),
  );
  assert.equal(
    (await pagination.handler(
      requestFor("github.packages.list", argsFor("package_list")),
    )).status,
    502,
  );
  const graph = harness(
    {},
    () => json({ errors: [{ message: "private error details" }], data: {} }),
  );
  const failed = await graph.handler(requestFor("github.discussions.list"));
  assert.equal(failed.status, 424);
  assert.ok(!(await failed.text()).includes("private error details"));
  const tenant = harness();
  assert.equal(
    (await tenant.handler(
      requestFor("supabase.orgs.list", {}, { tenant_id: actor }),
    )).status,
    403,
  );
  assert.equal(tenant.seen.length, 0);
  assert.equal(tenant.grants.length, 0);
});

Deno.test("redaction covers quoted JSON credentials and nondelegable metadata stays session scoped", async () => {
  const value = redact(
    '{"password":"hunter2","client_secret":"private-value"} sbp_' +
      "a".repeat(32),
  );
  assert.ok(!value.includes("hunter2"));
  assert.ok(!value.includes("private-value"));
  assert.ok(!value.includes("a".repeat(32)));
  const h = harness();
  assert.equal(
    (await h.handler(
      requestFor("supabase.orgs.list", {}, { credential_id: actor }),
    )).status,
    403,
  );
  assert.equal(h.grants.length, 0);
  assert.equal(h.seen.length, 0);
});
