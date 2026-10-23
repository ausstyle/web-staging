import { strict as assert } from "node:assert";
import { createGapHandler, gapContracts } from "./index.ts";
import { type Obj, PROJECT } from "./contracts.ts";
import { type Dependencies, type Finish } from "./runtime.ts";
const actor = "10000000-0000-4000-8000-000000000001";
const request = "10000000-0000-4000-8000-000000000002";
const grant = "10000000-0000-4000-8000-000000000003";
const admission = "10000000-0000-4000-8000-000000000004";
const created = "abcdefghijklmnopqrst";
const bound = {
  ref: PROJECT,
  organization_id: "org-1",
  organization_slug: "bound-org",
};
const project = {
  ref: created,
  organization_id: "org-1",
  organization_slug: "bound-org",
  name: "sandy-eng-fixture",
  region: "eu-west-1",
  status: "COMING_UP",
};
function harness(
  overrides: Partial<Dependencies> = {},
  reply?: (url: URL, init: RequestInit) => Response,
) {
  const calls: { url: URL; init: RequestInit }[] = [], finishes: Finish[] = [];
  const deps: Dependencies = {
    service: "internal-service-fixture",
    management: "management-fixture",
    functionAnonKey: "public-anon-fixture",
    authorizeContext: async () => ({ allowed: true }),
    consumeGrant: async () => ({
      allowed: true,
      reused: false,
      admission_id: admission,
    }),
    finishExecution: async (r) => {
      finishes.push(r);
      return { allowed: true };
    },
    validateInvocationSession: async (s, id) =>
      s === "normal-caller-fixture" && id === actor,
    projectCreationMaterial: async () => "isolated-noncredential-password",
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (reply) return reply(url, init);
      let value: unknown;
      if (url.hostname.endsWith(".supabase.co")) {
        return new Response("private function response", {
          headers: { "sb-request-id": "provider-fixture" },
        });
      }
      if (url.pathname === `/v1/projects/${PROJECT}`) value = bound;
      else if (url.pathname === "/v1/organizations/bound-org") {
        value = { id: "org-1", slug: "bound-org" };
      } else if (url.pathname === "/v1/projects" && init.method === "POST") {
        value = project;
      } else if (url.pathname === "/v1/projects") {
        value = [{ ...project, ref: PROJECT, name: "existing-bound" }, {
          ...project,
          name: "unrelated-private-project",
        }];
      } else if (
        url.pathname.endsWith("/functions/sandy-engineering-fixture")
      ) {
        value = {
          slug: "sandy-engineering-fixture",
          status: "ACTIVE",
          verify_jwt: true,
        };
      } else throw Error("unexpected_provider_request");
      return Response.json(value, {
        status: init.method === "POST" ? 201 : 200,
        headers: { "sb-request-id": "provider-fixture" },
      });
    },
    ...overrides,
  };
  const handler = createGapHandler(deps);
  return {
    calls,
    finishes,
    async call(
      operation: string,
      args: Obj = {},
      session = "normal-caller-fixture",
    ) {
      const r = await handler(
        new Request("https://internal.invalid", {
          method: "POST",
          headers: {
            authorization: "Bearer internal-service-fixture",
            "x-sandy-user-session": session,
          },
          body: JSON.stringify({
            operation,
            arguments: args,
            actor_id: actor,
            tenant_id: null,
            request_id: request,
            grant_id: grant,
            credential_id: null,
          }),
        }),
      );
      return { status: r.status, body: await r.json() };
    },
  };
}
Deno.test("project list discloses only the project bound by the shared execution scope", async () => {
  const h = harness();
  const r = await h.call("supabase.projects.list");
  assert.equal(r.status, 200);
  assert.equal(r.body.result.projects.length, 1);
  assert.equal(r.body.result.projects[0].ref, PROJECT);
  assert.equal(r.body.result.other_projects_disclosed, false);
  assert.equal(h.finishes[0].outcome, "succeeded");
});
Deno.test("project creation uses existing custody and exact parent; result never exports password", async () => {
  const h = harness();
  const r = await h.call("supabase.projects.create", {
    name: "sandy-eng-fixture",
    region: "eu-west-1",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.effect_confirmed, false);
  const write = h.calls.find((x) => x.init.method === "POST")!;
  assert.equal(write.url.href, "https://api.supabase.com/v1/projects");
  assert.deepEqual(JSON.parse(String(write.init.body)), {
    name: "sandy-eng-fixture",
    organization_slug: "bound-org",
    region_selection: { type: "specific", code: "eu-west-1" },
    db_pass: "isolated-noncredential-password",
  });
  assert.equal(
    JSON.stringify(r.body).includes("isolated-noncredential-password"),
    false,
  );
  assert.equal(h.finishes[0].outcome, "accepted");
  assert.equal(
    gapContracts["supabase.projects.create"].requires_cost_approval,
    true,
  );
});
Deno.test("project creation rejects caller passwords, arbitrary organisations, templates and machine sizes", async () => {
  for (
    const field of [
      "db_pass",
      "organization_slug",
      "template_url",
      "desired_instance_size",
    ]
  ) {
    const h = harness();
    const r = await h.call("supabase.projects.create", {
      name: "sandy-eng-fixture",
      region: "eu-west-1",
      [field]: "forbidden",
    });
    assert.equal(r.status, 400);
    assert.equal(h.calls.length, 0);
  }
});
Deno.test("foreign organisation names cannot affect scoped creation and a wrong created parent is unknown", async () => {
  for (const wrongParent of [false, true]) {
    const h = harness({}, (url, init) => {
      if (url.pathname === `/v1/projects/${PROJECT}`) {
        return Response.json(bound);
      }
      if (url.pathname === "/v1/organizations/bound-org") {
        return Response.json({ id: "org-1", slug: "bound-org" });
      }
      if (init.method !== "POST") {
        return Response.json([{
          ...project,
          organization_id: "other-org",
          organization_slug: "other-org",
        }]);
      }
      return Response.json({
        ...project,
        organization_id: wrongParent ? "other-org" : "org-1",
      }, { status: 201 });
    });
    const r = await h.call("supabase.projects.create", {
      name: "sandy-eng-fixture",
      region: "eu-west-1",
    });
    assert.equal(r.status, wrongParent ? 503 : 200);
    assert.equal(h.finishes[0].outcome, wrongParent ? "unknown" : "accepted");
    assert.equal(h.calls.filter((c) => c.init.method === "POST").length, 1);
  }
});
Deno.test("project creation refuses absent custody/budget before any write", async () => {
  const h = harness({
    projectCreationMaterial: async () => {
      throw Error("not_bound");
    },
  });
  const r = await h.call("supabase.projects.create", {
    name: "sandy-eng-fixture",
    region: "eu-west-1",
  });
  assert.equal(r.status, 403);
  assert.equal(h.calls.some((c) => c.init.method === "POST"), false);
  assert.equal(h.finishes[0].outcome, "failed");
});
Deno.test("wrong project relationship stops creation without reading custodied material", async () => {
  let material = false;
  const h = harness({
    projectCreationMaterial: async () => {
      material = true;
      return "not-used";
    },
  }, () => Response.json({ ...bound, ref: created }));
  const r = await h.call("supabase.projects.create", {
    name: "sandy-eng-fixture",
    region: "eu-west-1",
  });
  assert.equal(r.status, 502);
  assert.equal(material, false);
  assert.equal(h.calls.length, 1);
});
Deno.test("function invocation forwards the same normal session, never Management/service credentials", async () => {
  const h = harness();
  const r = await h.call("supabase.functions.invoke", {
    slug: "sandy-engineering-fixture",
    body: { echo: "canary" },
  });
  assert.equal(r.status, 200);
  const write = h.calls.find((c) => c.init.method === "POST")!;
  const headers = new Headers(write.init.headers);
  assert.equal(
    write.url.href,
    `https://${PROJECT}.supabase.co/functions/v1/sandy-engineering-fixture`,
  );
  assert.equal(headers.get("authorization"), "Bearer normal-caller-fixture");
  assert.equal(headers.get("apikey"), "public-anon-fixture");
  assert.equal(headers.get("idempotency-key"), request);
  assert.equal(write.init.redirect, "error");
  assert.equal(r.body.result.response_content_disclosed, false);
  assert.equal(
    JSON.stringify(r.body).includes("private function response"),
    false,
  );
  assert.equal(h.finishes[0].outcome, "accepted");
});
Deno.test("function invocation rejects an invalid/mismatched session before any provider read", async () => {
  const h = harness();
  const r = await h.call("supabase.functions.invoke", {
    slug: "sandy-engineering-fixture",
    body: {},
  }, "unrelated-session");
  assert.equal(r.status, 403);
  assert.equal(h.calls.length, 0);
});
Deno.test("function invocation rejects a target with JWT verification disabled", async () => {
  const h = harness(
    {},
    () =>
      Response.json({
        slug: "sandy-engineering-fixture",
        status: "ACTIVE",
        verify_jwt: false,
      }),
  );
  const r = await h.call("supabase.functions.invoke", {
    slug: "sandy-engineering-fixture",
    body: {},
  });
  assert.equal(r.status, 403);
  assert.equal(h.calls.some((c) => c.init.method === "POST"), false);
});
Deno.test("function invocation rejects caller URLs and path traversal before provider dispatch", async () => {
  for (
    const slug of [
      "../sandy-engineering-control",
      "https://attacker.invalid",
      "test?query=1",
    ]
  ) {
    const h = harness();
    const r = await h.call("supabase.functions.invoke", { slug, body: {} });
    assert.equal(r.status, 400);
    assert.equal(h.calls.length, 0);
  }
});
Deno.test("unknown invocation outcome is recorded once and never automatically retried", async () => {
  let writes = 0;
  const h = harness({}, (url, init) => {
    if (url.hostname.endsWith(".supabase.co")) {
      writes++;
      throw Error("transport interrupted after dispatch");
    }
    return Response.json({
      slug: "sandy-engineering-fixture",
      status: "ACTIVE",
      verify_jwt: true,
    });
  });
  const r = await h.call("supabase.functions.invoke", {
    slug: "sandy-engineering-fixture",
    body: {},
  });
  assert.equal(r.status, 503);
  assert.equal(writes, 1);
  assert.equal(h.finishes[0].outcome, "unknown");
});
Deno.test("reused grant cannot invoke a function or create a project again", async () => {
  const h = harness({
    consumeGrant: async () => ({
      allowed: true,
      reused: true,
      admission_id: admission,
    }),
  });
  for (
    const [op, args] of [["supabase.projects.create", {
      name: "sandy-eng-fixture",
      region: "eu-west-1",
    }], ["supabase.functions.invoke", {
      slug: "sandy-engineering-fixture",
      body: {},
    }]] as [string, Obj][]
  ) {
    assert.equal((await h.call(op, args)).status, 409);
  }
  assert.equal(h.calls.length, 0);
});
