import assert from "node:assert/strict";
import { createProviderReadHandler } from "./index.ts";

function harness(
  payload: unknown,
  status = 200,
  management = "test-management-credential",
) {
  const calls: Request[] = [];
  const handler = createProviderReadHandler({
    service: "test-service-credential",
    management,
    fetch: ((url: string | URL | Request, init?: RequestInit) => {
      calls.push(new Request(url, init));
      return Promise.resolve(
        Response.json(payload, {
          status,
          headers: { "x-request-id": "test-provider-request" },
        }),
      );
    }) as typeof fetch,
  });
  const request = (
    operation: unknown,
    args: unknown = {},
    token = "test-service-credential",
  ) =>
    handler(
      new Request("https://handler.invalid", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ operation, arguments: args }),
      }),
    );
  return { request, calls };
}
Deno.test("provider read handler denies end-user tokens and missing binding before provider access", async () => {
  const h = harness({});
  assert.equal(
    (await h.request("supabase.projects.get", {}, "customer-jwt")).status,
    403,
  );
  assert.equal(h.calls.length, 0);
  const missing = harness({}, 200, "");
  assert.equal((await missing.request("supabase.projects.get")).status, 424);
  assert.equal(missing.calls.length, 0);
});
Deno.test("project read is fixed to the approved project and returns projected identity with provider evidence", async () => {
  const h = harness({
    id: "zmqlyygzqoidkcwdysok",
    name: "Test project",
    status: "ACTIVE_HEALTHY",
    database_password: "must-not-leak",
  });
  const r = await h.request("supabase.projects.get");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.result.id, "zmqlyygzqoidkcwdysok");
  assert.equal(body.provider_request_id, "test-provider-request");
  assert.equal(body.result.database_password, undefined);
  assert.equal(
    h.calls[0].url,
    "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok",
  );
  assert.equal(
    h.calls[0].headers.get("authorization"),
    "Bearer test-management-credential",
  );
  assert.equal(h.calls[0].redirect, "error");
  assert.equal(h.calls[0].method, "GET");
  assert.equal(
    (await h.request("supabase.projects.get", {
      project_ref: "another-project",
    })).status,
    400,
  );
  assert.equal(h.calls.length, 1);
  const wrong = harness({ id: "another-project" });
  assert.equal((await wrong.request("supabase.projects.get")).status, 502);
});
Deno.test("secret discovery returns names only even when provider includes plaintext values", async () => {
  const h = harness([{
    name: "EXAMPLE_KEY",
    value: "test-secret-value",
    updated_at: "2026-10-20",
  }]);
  const r = await h.request("supabase.functions.secrets.list");
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes("test-secret-value"));
  assert.deepEqual(JSON.parse(text).result, [{
    name: "EXAMPLE_KEY",
    updated_at: "2026-10-20",
  }]);
});
Deno.test("branch path rejects traversal, cross-project IDs, URLs and extra arguments", async () => {
  const h = harness({
    name: "test-branch",
    project_ref: "test-branch-ref",
    service_role_key: "must-not-leak",
  });
  for (
    const args of [{}, { name: "../other-project" }, {
      name: "https://untrusted.invalid",
    }, { name: "test", ref: "other" }]
  ) {
    assert.equal((await h.request("supabase.branches.get", args)).status, 400);
  }
  assert.equal(h.calls.length, 0);
  const r = await h.request("supabase.branches.get", { name: "test-branch" });
  assert.equal(r.status, 200);
  assert.ok(
    h.calls[0].url.endsWith(
      "/projects/zmqlyygzqoidkcwdysok/branches/test-branch",
    ),
  );
  assert.equal((await r.json()).result.service_role_key, undefined);
});
Deno.test("all project metadata routes project only documented safe fields", async () => {
  const cases: [string, unknown, unknown][] = [
    ["supabase.project.health", [{
      name: "db",
      healthy: true,
      status: "ACTIVE_HEALTHY",
      error: "sensitive diagnostic",
    }], [{ name: "db", healthy: true, status: "ACTIVE_HEALTHY" }]],
    ["supabase.branches.list", [{
      id: "test-id",
      name: "test",
      password: "private",
    }], [{ id: "test-id", name: "test" }]],
    ["supabase.network.restrictions.get", {
      status: "applied",
      config: { dbAllowedCidrs: [], token: "private" },
    }, { status: "applied", config: { dbAllowedCidrs: [] } }],
    ["supabase.domains.get", {
      status: "1_not_started",
      data: { ownership_verification: "private" },
    }, { status: "1_not_started" }],
    ["supabase.backups.list", {
      region: "test",
      backups: [{ id: 1, status: "COMPLETED", download_url: "private" }],
    }, { region: "test", backups: [{ id: 1, status: "COMPLETED" }] }],
  ];
  for (const [operation, payload, expected] of cases) {
    const h = harness(payload);
    const r = await h.request(operation);
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).result, expected);
    assert.equal(h.calls[0].method, "GET");
  }
});
Deno.test("provider denial and rate limits preserve failure and never expose provider error bodies", async () => {
  for (
    const [status, expected] of [
      [401, 502],
      [403, 502],
      [404, 404],
      [429, 429],
      [500, 502],
    ]
  ) {
    const h = harness({ error: "sensitive-provider-diagnostic" }, status);
    const r = await h.request("supabase.projects.get");
    assert.equal(r.status, expected);
    const text = await r.text();
    assert.ok(!text.includes("sensitive-provider-diagnostic"));
    assert.equal(JSON.parse(text).upstream_status, status);
  }
});
Deno.test("unknown operations and malformed provider responses cannot claim execution success", async () => {
  const h = harness(null);
  for (
    const operation of [
      "constructor",
      "supabase.projects.delete",
      "https://untrusted.invalid",
      null,
    ]
  ) {
    assert.equal((await h.request(operation)).status, 404);
  }
  assert.equal(h.calls.length, 0);
  assert.equal((await h.request("supabase.backups.list")).status, 502);
  assert.equal(
    (await h.request("supabase.functions.secrets.list")).status,
    502,
  );
});

Deno.test("provider add-on prerequisite is explicit and excludes billing details", async () => {
  const h = harness({
    message: "Private billing data",
    error: {
      code: "entitlement_required",
      upgrade_url: "https://billing.invalid/private",
    },
  }, 400);
  const response = await h.request("supabase.domains.get");
  assert.equal(response.status, 424);
  const text = await response.text();
  assert.equal(JSON.parse(text).error, "provider_entitlement_required");
  assert.ok(!text.includes("billing"));
});
