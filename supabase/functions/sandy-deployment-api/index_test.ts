import {
  createDeploymentHandler,
  type DeploymentDependencies,
} from "./index.ts";
import { createApi, createHandler } from "../sandy-api-mcp/index.ts";
import {
  createOperationHandler,
  type OperationDependencies,
} from "../sandy-operation-api/index.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
  );
}
const changeId = "12345678-1234-1234-1234-123456789abc";
const source = "Deno.serve(()=>Response.json({message:'caffè ✓'}));";
const slug = "sandy-api-mcp";
const body = {
  action: "engineering_release",
  function_slug: slug,
  source_ref: "main",
  change_id: changeId,
};
const encodedSource = btoa(
  String.fromCharCode(...new TextEncoder().encode(source)),
);
type Options = {
  existing?: boolean;
  deployStatus?: number;
  metadataStatus?: number;
  persistenceError?: boolean;
  persistenceThrows?: boolean;
  approved?: boolean;
  missingCredential?: boolean;
  writeThrows?: boolean;
  metadataThrows?: boolean;
};
function harness(options: Options = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const events: Record<string, unknown>[] = [];
  const record = {
    id: changeId,
    status: options.approved === false ? "requested" : "approved",
    scope: [`supabase:${slug}`],
    requested_by: "test-controller-owner",
  };
  const db = {
    from(table: string) {
      if (table === "sandy_engineering_changes") {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: () => Promise.resolve({ data: record, error: null }),
        };
        return query;
      }
      assert(
        table === "sandy_engineering_change_events",
        `Unexpected table: ${table}`,
      );
      return {
        insert(event: Record<string, unknown>) {
          events.push(event);
          if (options.persistenceThrows) {
            throw new Error("Database unavailable");
          }
          return Promise.resolve({
            error: options.persistenceError ? { code: "test_failure" } : null,
          });
        },
      };
    },
  } as unknown as DeploymentDependencies["db"];
  let metadataRequests = 0;
  const handler = createDeploymentHandler({
    url: "https://project.test.invalid",
    secret: "test-service-identity",
    db,
    env: (name) =>
      options.missingCredential ? undefined : ({
        SANDY_GITHUB_APP_INSTALLATION_TOKEN: "test-github-identity",
        SANDY_SUPABASE_MANAGEMENT_TOKEN: "test-management-identity",
      } as Record<string, string>)[name],
    fetch: (async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith("https://api.github.com/")) {
        return Response.json({
          type: "file",
          encoding: "base64",
          content: encodedSource,
          sha: "a".repeat(40),
        });
      }
      assert(
        url.startsWith(
          "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/functions/",
        ),
      );
      if (init?.method === "POST") {
        if (options.writeThrows) throw new Error("Lost provider response");
        return Response.json({ slug, version: 1 }, {
          status: options.deployStatus ?? 201,
        });
      }
      metadataRequests++;
      if (metadataRequests === 1 && !options.existing) {
        return new Response(null, { status: 404 });
      }
      if (options.metadataThrows) throw new Error("Metadata unavailable");
      return Response.json({ slug, version: 1 }, {
        status: options.metadataStatus ?? 200,
      });
    }) as typeof fetch,
  });
  return {
    handler,
    calls,
    events,
    request: (
      input: unknown = body,
      authorization = "Bearer test-service-identity",
    ) =>
      handler(
        new Request("https://deployment.test.invalid", {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
      ),
  };
}

Deno.test("release rejects missing, wrong, and malformed provider authorization", async () => {
  for (
    const token of [
      "",
      "Bearer wrong",
      "test-service-identity",
      "Bearer test-service-identity extra",
    ]
  ) {
    const h = harness();
    const response = await h.request(body, token);
    equal(response.status, 403);
    equal(h.calls.length, 0);
    equal(h.events.length, 0);
  }
});

Deno.test("release creation records deployment metadata without claiming functional verification", async () => {
  const h = harness();
  const response = await h.request();
  equal(response.status, 200);
  const data = await response.json();
  equal(data.ok, true);
  equal(data.deployed, true);
  equal(data.metadata_observed, true);
  equal(data.verified, false);
  equal(data.functionally_verified, false);
  equal(data.rollback_tested, false);
  equal(data.receipt.source_blob_sha, "a".repeat(40));
  equal(data.receipt.version, 1);
  equal(h.events.length, 1);
  equal(h.events[0].detail, data.receipt);
  equal(h.events[0].event_type, "sandy_api_release_attempt");
  equal(h.calls.length, 4);
  const deploy = h.calls.find((call) => call.init?.method === "POST");
  assert(deploy?.init?.body instanceof FormData);
  const file = deploy.init.body.get("file");
  assert(file instanceof File);
  equal(await file.text(), source);
  equal(
    new Headers(deploy.init.headers).get("authorization"),
    "Bearer test-management-identity",
  );
});

Deno.test("existing production functions remain protected from overwrite", async () => {
  const h = harness({ existing: true });
  const response = await h.request();
  equal(response.status, 409);
  equal(
    (await response.json()).error,
    "existing_function_release_requires_rollback_executor",
  );
  equal(h.calls.filter((call) => call.init?.method === "POST").length, 0);
  equal(h.events.length, 0);
});

Deno.test("provider deployment rejection never produces a completed or verified receipt", async () => {
  const h = harness({ deployStatus: 403 });
  const response = await h.request();
  equal(response.status, 502);
  const data = await response.json();
  equal(data.error, "provider_deployment_failed");
  equal(data.deployed, false);
  equal(data.verified, false);
  equal(data.provider_http, 403);
  equal(h.events.length, 0);
});

Deno.test("release evidence persistence failure requires reconciliation after provider write", async () => {
  for (
    const options of [{ persistenceError: true }, { persistenceThrows: true }]
  ) {
    const h = harness(options);
    const response = await h.request();
    equal(response.status, 503);
    const data = await response.json();
    equal(data.ok, false);
    equal(data.error, "release_receipt_persistence_failed");
    equal(data.reconciliation_required, true);
    equal(data.deployed, true);
    equal(data.verified, false);
    equal(data.receipt.provider_http, 201);
    equal(data.receipt.version, 1);
  }
});

Deno.test("missing post-write metadata preserves evidence and requires reconciliation", async () => {
  for (const options of [{ metadataStatus: 503 }, { metadataThrows: true }]) {
    const h = harness(options);
    const response = await h.request();
    equal(response.status, 502);
    const data = await response.json();
    equal(data.ok, false);
    equal(data.error, "deployment_metadata_unavailable");
    equal(data.reconciliation_required, true);
    equal(data.deployed, true);
    equal(data.metadata_observed, false);
    equal(data.verified, false);
    equal(h.events.length, 1);
  }
});

Deno.test("provider acceptance alone is pending rather than completed deployment", async () => {
  const h = harness({ deployStatus: 202 });
  const response = await h.request();
  equal(response.status, 202);
  const data = await response.json();
  equal(data.ok, false);
  equal(data.deployed, false);
  equal(data.verified, false);
  equal(data.error, "provider_deployment_pending");
  equal(data.reconciliation_required, true);
});

Deno.test("lost write response reports unknown deployment outcome rather than retry success", async () => {
  const h = harness({ writeThrows: true });
  const response = await h.request();
  equal(response.status, 503);
  const data = await response.json();
  equal(data.error, "deployment_outcome_unknown");
  equal(data.deployed, null);
  equal(data.verified, false);
  equal(data.reconciliation_required, true);
  equal(data.receipt.source_blob_sha, "a".repeat(40));
});

Deno.test("release requires scoped approved change and existing provider bindings", async () => {
  for (
    const [options, expected] of [
      [{ approved: false }, 403],
      [{ missingCredential: true }, 424],
    ] as const
  ) {
    const h = harness(options);
    const response = await h.request();
    equal(response.status, expected);
    equal(h.calls.length, 0);
  }
});

Deno.test("local MCP gateway release flow preserves metadata-only evidence end to end", async () => {
  const deployment = harness();
  const registry = {
    operation: "deployment.management.release",
    handler: "sandy-operation-api",
    api_exposed: true,
    ai_exposed: true,
    verified: false,
    input_schema: {
      type: "object",
      properties: {
        function_slug: { type: "string" },
        source_ref: { type: "string" },
        change_id: { type: "string" },
      },
      required: ["function_slug", "source_ref", "change_id"],
    },
    output_schema: { type: "object" },
  };
  const db = {
    auth: {
      getUser(token: string) {
        equal(token, "test.identity.token");
        return Promise.resolve({
          data: { user: { id: "test-controller-owner" } },
          error: null,
        });
      },
    },
    from(table: string) {
      let rows: Record<string, unknown>[] = table === "sandy_controller_admins"
        ? [{
          role: "owner",
          enabled: true,
          auth_user_id: "test-controller-owner",
        }]
        : [registry];
      const query = {
        select: () => query,
        eq(key: string, value: unknown) {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        in(key: string, values: unknown[]) {
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        order: () => query,
        maybeSingle: () =>
          Promise.resolve({ data: rows[0] ?? null, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as OperationDependencies["db"];
  const gateway = createOperationHandler({
    base: "https://project.test.invalid",
    service: "test-service-identity",
    anon: "test-public-anon",
    db,
    fetch: (async (url, init) => {
      equal(
        String(url),
        "https://project.test.invalid/functions/v1/sandy-deployment-api",
      );
      return await deployment.handler(new Request(url, init));
    }) as typeof fetch,
  });
  const mcp = createHandler(
    createApi(
      "https://project.test.invalid",
      "test-public-anon",
      (async (url, init) => {
        equal(
          String(url),
          "https://project.test.invalid/functions/v1/sandy-operation-api",
        );
        return await gateway(new Request(url, init));
      }) as typeof fetch,
    ),
  );
  const request = (method: string, params: unknown = {}) =>
    mcp(
      new Request("https://mcp.test.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer test.identity.token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
  const listed = await (await request("tools/list")).json();
  equal(listed.result.tools[0].inputSchema, registry.input_schema);
  equal(listed.result.tools[0].outputSchema, registry.output_schema);
  const response = await request("tools/call", {
    name: registry.operation,
    arguments: { function_slug: slug, source_ref: "main", change_id: changeId },
  });
  const tool = (await response.json()).result;
  equal(tool.isError, false);
  equal(tool.structuredContent.deployed, true);
  equal(tool.structuredContent.metadata_observed, true);
  equal(tool.structuredContent.verified, false);
  equal(tool.structuredContent.functionally_verified, false);
  equal(tool.structuredContent.rollback_tested, false);
  equal(deployment.events.length, 1);
});
