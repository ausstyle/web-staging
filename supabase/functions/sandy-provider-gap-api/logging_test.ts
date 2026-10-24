import { strict as assert } from "node:assert";
import { createGapHandler, gapExecutionScope } from "./index.ts";
import { GCP_PROJECT, type Obj } from "./contracts.ts";
import { Calls, type Dependencies, type Finish, Refusal } from "./runtime.ts";
const id = "10000000-0000-4000-8000-000000000001",
  now = Date.parse("2026-10-24T01:00:00Z");
const args = {
  log_id: "sandy-engineering-canary",
  start: "2026-10-24T00:50:00Z",
  end: "2026-10-24T01:00:00Z",
  limit: 2,
};
const entry = {
  logName: `projects/${GCP_PROJECT}/logs/${args.log_id}`,
  timestamp: "2026-10-24T00:59:00.123456789Z",
  severity: "INFO",
  resource: {
    type: "global",
    labels: { project_id: GCP_PROJECT, private_label: "private" },
  },
  textPayload: "private payload",
  jsonPayload: { password: "private" },
  insertId: "private-id",
};
function fixture(
  body: unknown = { entries: [entry] },
  override: Partial<Dependencies> = {},
) {
  const seen: { url: string; body: Obj }[] = [], finishes: Finish[] = [];
  const deps: Dependencies = {
    service: "fixture-service",
    getGcpAccessToken: async () => "fixture-token",
    now: () => now,
    authorizeContext: async () => ({ allowed: true }),
    consumeGrant: async () => ({ allowed: true, admission_id: id }),
    finishExecution: async (r) => {
      finishes.push(r);
      return { allowed: true };
    },
    fetch: (async (u, init) => {
      seen.push({ url: String(u), body: JSON.parse(String(init?.body)) });
      return Response.json(body);
    }) as typeof fetch,
    ...override,
  };
  const handler = createGapHandler(deps);
  const call = (input: Obj = args) =>
    handler(
      new Request("https://internal", {
        method: "POST",
        headers: {
          authorization: "Bearer fixture-service",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: "gcp.logging.query",
          arguments: input,
          actor_id: id,
          request_id: id,
          grant_id: id,
          tenant_id: null,
        }),
      }),
    );
  return { seen, finishes, call, deps };
}
Deno.test("logging query uses one fixed-project read and exposes no payload labels token or identity", async () => {
  const h = fixture();
  const r = await h.call();
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(h.seen.length, 1);
  assert.equal(h.seen[0].url, "https://logging.googleapis.com/v2/entries:list");
  assert.deepEqual(h.seen[0].body.resourceNames, [`projects/${GCP_PROJECT}`]);
  assert.equal(h.seen[0].body.orderBy, "timestamp desc");
  assert.equal(h.seen[0].body.pageSize, 2);
  assert.equal(
    h.seen[0].body.filter,
    `logName="projects/${GCP_PROJECT}/logs/sandy-engineering-canary" AND timestamp >= "2026-10-24T00:50:00.000Z" AND timestamp < "2026-10-24T01:00:00.000Z"`,
  );
  assert.deepEqual(out.result.entries, [{
    timestamp: entry.timestamp,
    severity: "INFO",
    resource_type: "global",
  }]);
  assert.equal(out.result.payloads_disclosed, false);
  assert.equal(JSON.stringify(out).includes("private"), false);
  assert.equal(h.finishes[0].outcome, "succeeded");
});
Deno.test("caller filters foreign targets and invalid windows never dispatch", async () => {
  for (
    const patch of [
      { log_id: 'x" OR true' },
      { project_id: "foreign" },
      { filter: "true" },
      { start: "2026-10-24T00:00:00Z" },
      { start: "2026-02-30T00:59:00Z" },
      { end: "2026-10-24T01:00:01Z" },
      { end: args.start },
      { limit: 101 },
      { limit: 0 },
      { pageToken: "foreign" },
    ]
  ) {
    const h = fixture();
    assert.equal((await h.call({ ...args, ...patch })).status, 400);
    assert.equal(h.seen.length, 0);
  }
});
Deno.test("foreign log project timestamps and malformed metadata fail closed", async () => {
  for (
    const patch of [
      { logName: "projects/foreign/logs/sandy-engineering-canary" },
      { logName: `projects/${GCP_PROJECT}/logs/private` },
      { timestamp: "2026-10-24T01:00:00Z" },
      { resource: { type: "global", labels: { project_id: "foreign" } } },
      { severity: "secret-value" },
      { timestamp: "invalid" },
    ]
  ) {
    const h = fixture({ entries: [{ ...entry, ...patch }] });
    const r = await h.call();
    assert.equal(r.status, 502);
    assert.equal(h.finishes[0].outcome, "failed");
    assert.equal(h.seen.length, 1);
  }
});
Deno.test("empty partial search is explicitly truncated without exposing or replaying cursor", async () => {
  const h = fixture({ entries: [], nextPageToken: "private-token" });
  const r = await h.call();
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.possibly_truncated, true);
  assert.equal(out.result.continuation_available, true);
  assert.equal(JSON.stringify(out).includes("private-token"), false);
  assert.equal(h.seen.length, 1);
});
Deno.test("logging POST network failure is a read failure not unknown mutation", async () => {
  const h = fixture({}, {
    fetch: async () => {
      throw Error("fixture transport loss");
    },
  });
  const r = await h.call();
  assert.equal(r.status, 502);
  assert.equal(h.finishes[0].outcome, "failed");
  assert.equal((await r.json()).error, "provider_request_failed");
});
Deno.test("authorization duplicate admission and unavailable credentials prevent log dispatch", async () => {
  for (
    const override of [{
      authorizeContext: async () => ({
        allowed: false,
        error: "scope_denied",
        http_status: 403,
      }),
    }, {
      consumeGrant: async () => ({
        allowed: true,
        reused: true,
        admission_id: id,
      }),
    }, { getGcpAccessToken: async () => "" }]
  ) {
    const h = fixture({}, override);
    assert.notEqual((await h.call()).status, 200);
    assert.equal(h.seen.length, 0);
  }
});
Deno.test("logging host exception cannot be used by serial or for another method path", async () => {
  const h = fixture();
  for (
    const [operation, url, method] of [[
      "gcp.compute.instances.serial_output",
      "https://logging.googleapis.com/v2/entries:list",
      "POST",
    ], [
      "gcp.logging.query",
      "https://logging.googleapis.com/v2/entries:write",
      "POST",
    ], [
      "gcp.logging.query",
      "https://logging.googleapis.com/v2/entries:list",
      "GET",
    ], [
      "gcp.logging.query",
      "https://compute.googleapis.com/compute/v1/projects/x",
      "POST",
    ]]
  ) {
    const calls = new Calls(h.deps, "fixture-token", "gcp", operation);
    await assert.rejects(
      () => calls.request(new URL(url), method, {}),
      (e: unknown) =>
        e instanceof Refusal && e.code === "provider_scope_mismatch",
    );
    assert.equal(calls.mutationDispatched, false);
  }
  assert.equal(h.seen.length, 0);
});
Deno.test("oversized result and malformed cursor are rejected without pagination", async () => {
  for (
    const body of [{ entries: [entry, entry, entry] }, {
      entries: [entry],
      nextPageToken: 42,
    }]
  ) {
    const h = fixture(body);
    assert.equal((await h.call()).status, 502);
    assert.equal(h.seen.length, 1);
  }
});

Deno.test("logging admission declares project-level metadata scope without pretending regional restriction", () => {
  const scope = gapExecutionScope("gcp.logging.query");
  assert.equal(scope.project_id, GCP_PROJECT);
  assert.equal(scope.log_namespace, "sandy-engineering-canary");
  assert.equal(scope.projection, "metadata_only");
  assert.equal(Object.hasOwn(scope, "region"), false);
  assert.equal(Object.hasOwn(scope, "zone"), false);
  assert.equal(
    gapExecutionScope("gcp.compute.instances.serial_output").zone,
    "europe-west1-b",
  );
});
