import { createHandler as createMcpHandler } from "../sandy-api-mcp/index.ts";
import {
  engineeringPolicy,
  engineeringVmReadPolicy,
} from "./engineering_identity.ts";
import assert from "node:assert/strict";
import { createOperationHandler, type OperationDependencies } from "./index.ts";
import { createApi, createHandler } from "../sandy-api-mcp/index.ts";
import { legacyOperationContracts } from "./legacy_operations.ts";
import { customerOperationContracts } from "./customer_operations.ts";
import { customerServiceContracts } from "./customer_services.ts";
import { policyOperationContracts } from "./policy_operations.ts";
import { orchestrationContracts } from "../sandy-orchestration-api/contracts.ts";
import { extensionContracts } from "./installed_extensions.ts";
import { providerOperations } from "../sandy-provider-operation-api/gateway.ts";
import {
  expandedProviderExecutionScope,
  providerExpansionOperations,
} from "../sandy-provider-operation-api/expansion_gateway.ts";
import { loadExpandedProviderOperation } from "../sandy-provider-operation-api/expansion.ts";
import { createProviderOperationHandler } from "../sandy-provider-operation-api/index.ts";
import { installedOperationIds } from "./index.ts";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import { gapContracts } from "../sandy-provider-gap-api/contracts.ts";
import {
  createGapHandler,
  type Dependencies as GapDependencies,
} from "../sandy-provider-gap-api/index.ts";
import {
  createServiceHandler,
  type Dependencies as ServiceDependencies,
} from "../sandy-supabase-service-api/index.ts";
import { productStrictOperations as productOperations } from "../sandy-product-service-api/strict_gateway.ts";
import { createStrictProductHandler } from "../sandy-product-service-api/strict_entry.ts";
import {
  legacyOwnerExecutionScope,
  legacyOwnerOperations,
} from "../sandy-legacy-compatibility-api/gateway.ts";
import { createLegacyProviderHandler } from "../sandy-legacy-compatibility-api/provider_handler.ts";
import { composioReadOperations } from "../sandy-composio-read-api/contracts.ts";
import { createComposioReadHandler } from "../sandy-composio-read-api/index.ts";
import { financialRedactionScope } from "../sandy-tenant-lifecycle-api/financial_redaction_contracts.ts";
import redactionManifest from "../sandy-tenant-lifecycle-api/financial_redaction_manifest.json" with {
  type: "json",
};
import { supplementContracts } from "../sandy-provider-supplement-api/contracts.ts";
import { createSupplementHandler } from "../sandy-provider-supplement-api/index.ts";
import { sensitiveContracts } from "../sandy-provider-sensitive-api/contracts.ts";
import { createSensitiveHandler } from "../sandy-provider-sensitive-api/index.ts";
import { sensitiveExecutionScope } from "../sandy-provider-sensitive-api/gateway.ts";
import { boundContracts } from "../sandy-provider-bound-api/contracts.ts";
import { boundExecutionScope } from "../sandy-provider-bound-api/gateway.ts";
import { createBoundHandler } from "../sandy-provider-bound-api/index.ts";
import { commerceStrictOperations as commerceOperations } from "../sandy-commerce-ledger-api/strict_gateway.ts";
import { createStrictCommerceHandler as createCommerceHandler } from "../sandy-commerce-ledger-api/strict_entry.ts";
import { systemMetadataOperations } from "../sandy-system-metadata-api/contracts.ts";
import { systemMetadataExecutionScope } from "../sandy-system-metadata-api/gateway.ts";
import { createSystemMetadataHandler } from "../sandy-system-metadata-api/index.ts";
import { scalarManifestScope } from "../sandy-tenant-lifecycle-api/scalar_contracts.ts";
import { createTenantLifecycleHandler } from "../sandy-tenant-lifecycle-api/index.ts";
import {
  tenantLifecycleOperations,
  tenantLifecycleScope,
} from "../sandy-tenant-lifecycle-api/contracts.ts";
import tenantManifest from "../sandy-tenant-lifecycle-api/manifest.json" with {
  type: "json",
};
import contentManifest from "../sandy-tenant-lifecycle-api/content_manifest.json" with {
  type: "json",
};
import financialManifest from "../sandy-tenant-lifecycle-api/financial_manifest.json" with {
  type: "json",
};

const preflight = {
  operation: "engineering.preflight",
  handler: "sandy-operation-api",
  api_exposed: true,
  ai_exposed: true,
  verified: false,
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  output_schema: { type: "object" },
  permission_scope: "engineering:read",
  is_mutation: false,
};
const release = {
  ...preflight,
  operation: "deployment.management.release",
  verified: true,
  is_mutation: true,
  input_schema: {
    type: "object",
    required: ["function_slug", "source_ref", "change_id"],
    properties: {
      function_slug: {
        type: "string",
        enum: ["sandy-operation-api", "sandy-api-mcp"],
      },
      source_ref: { type: "string", const: "main" },
      change_id: { type: "string" },
    },
    additionalProperties: false,
  },
};
type Row = Record<string, unknown>;
type Options = {
  rows?: readonly Row[];
  role?: string | null;
  actorId?: string;
  authorityId?: string;
  registryError?: boolean;
  authError?: boolean;
  authErrorStatus?: number;
  authThrow?: boolean;
  authRole?: string;
  authMetadata?: Row;
  anonymous?: boolean;
  roleError?: boolean;
  tenant?: string | null;
  tenantError?: boolean;
  memoryTenant?: string | null;
  memoryEmail?: string;
  memoryError?: boolean;
  memoryAddressError?: boolean;
  memoryRevoked?: boolean;
  memoryPrimary?: boolean;
  emailConfirmed?: boolean;
  rpcData?: Row;
  rpcError?: boolean;
  rpcHandler?: (name: string, args: Row) => unknown | Promise<unknown>;
  executionPolicy?: boolean;
  backend?: (input: string, init?: RequestInit) => Response | Promise<Response>;
  resolveCredential?: OperationDependencies["resolveCredential"];
  authenticatedDb?: OperationDependencies["authenticatedDb"];
  packageRestoreBindings?: OperationDependencies["packageRestoreBindings"];
  providerConfig?: OperationDependencies["providerConfig"];
};
function harness(options: Options = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const identityTokens: string[] = [];
  const tables: string[] = [];
  const db = {
    async rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      return {
        data: options.rpcHandler
          ? await options.rpcHandler(name, args as Row)
          : options.rpcData ?? null,
        error: options.rpcError ? { message: "connection lost" } : null,
      };
    },
    auth: {
      getUser: (token: string) => {
        identityTokens.push(token);
        if (options.authThrow) {
          throw new Error("Synthetic Auth transport failure");
        }
        return Promise.resolve({
          data: {
            user: options.authError ? null : {
              id: options.actorId ?? "controller-test-user",
              role: options.authRole ?? "authenticated",
              ...(options.authMetadata
                ? { app_metadata: options.authMetadata }
                : {}),
              is_anonymous: options.anonymous === true,
              ...(options.tenant !== undefined ||
                  options.memoryTenant !== undefined ||
                  options.emailConfirmed === true
                ? { email: "fixture-user@example.invalid" }
                : {}),
              ...((options.memoryTenant !== undefined &&
                  options.emailConfirmed !== false) ||
                  options.emailConfirmed === true
                ? { email_confirmed_at: "2026-10-20T00:00:00Z" }
                : {}),
            },
          },
          error: options.authError
            ? { message: "invalid", status: options.authErrorStatus ?? 401 }
            : null,
        });
      },
    },
    from(table: string) {
      tables.push(table);
      let rows = table === "sandy_memory_portal_accounts"
        ? options.memoryTenant
          ? [{
            customer_id: options.memoryTenant,
            auth_user_id: options.actorId ?? "controller-test-user",
            revoked_at: options.memoryRevoked ? "2026-10-20T00:00:00Z" : null,
          }]
          : []
        : table === "email_customer_addresses"
        ? options.memoryTenant
          ? [{
            customer_id: options.memoryTenant,
            normalized_email: options.memoryEmail ??
              "fixture-user@example.invalid",
            is_primary: options.memoryPrimary !== false,
          }]
          : []
        : table === "sandy_agenda_access"
        ? options.tenant
          ? [{
            customer_id: options.tenant,
            email: "fixture-user@example.invalid",
            enabled: true,
          }]
          : []
        : table === "sandy_operation_registry"
        ? options.rows ?? [preflight, release]
        : options.role === null
        ? []
        : [{
          role: options.role ?? "owner",
          enabled: true,
          auth_user_id: options.authorityId ?? options.actorId ??
            "controller-test-user",
        }];
      const error = table === "sandy_memory_portal_accounts"
        ? options.memoryError
        : table === "email_customer_addresses"
        ? options.memoryAddressError
        : table === "sandy_agenda_access"
        ? options.tenantError
        : table === "sandy_operation_registry"
        ? options.registryError
        : options.roleError;
      const result = () => ({
        data: error ? null : rows,
        error: error ? { message: "unavailable" } : null,
      });
      const query = {
        select: (_columns: string) => query,
        eq(key: string, value: unknown) {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        is(key: string, value: unknown) {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        in(key: string, values: unknown[]) {
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        order: (_key: string) => query,
        maybeSingle: () =>
          Promise.resolve({
            ...result(),
            data: error ? null : rows[0] ?? null,
          }),
        then(
          resolve: (value: ReturnType<typeof result>) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return query;
    },
  } as unknown as OperationDependencies["db"];
  const handler = createOperationHandler({
    base: "https://example.supabase.co",
    service: "test-service-credential",
    anon: "test-anon-key",
    db,
    resolveCredential: options.resolveCredential,
    executionPolicy: options.executionPolicy,
    authenticatedDb: options.authenticatedDb,
    packageRestoreBindings: options.packageRestoreBindings,
    providerConfig: options.providerConfig,
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const headers = new Headers(init?.headers);
      if (
        headers.get("authorization") === "Bearer test-service-credential" &&
        headers.get("apikey") !== "test-service-credential"
      ) {
        return Promise.resolve(Response.json(
          { message: "Conflicting API keys" },
          { status: 401 },
        ));
      }
      return Promise.resolve(
        options.backend
          ? options.backend(url, init)
          : Response.json({ ok: true }),
      );
    }) as typeof fetch,
  });
  const request = (
    body: unknown,
    authorization: string | null = "Bearer test-user-jwt",
    headers: Record<string, string> = {},
  ) =>
    handler(
      new Request("https://local.invalid", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );
  return { handler, request, calls, rpcCalls, identityTokens, tables };
}

Deno.test("gateway requires authenticated controller membership", async () => {
  for (
    const [options, token, status] of [
      [{}, null, 401],
      [{ authError: true }, "Bearer bad", 401],
      [{ role: null }, "Bearer user", 403],
      [{ roleError: true }, "Bearer user", 503],
    ] as [Options, string | null, number][]
  ) {
    const h = harness(options);
    assert.equal((await h.request({ action: "list" }, token)).status, status);
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("Auth outages return503 and untrusted roles remain401 before any policy or provider access", async () => {
  for (
    const [options, status, error] of [
      [{ authThrow: true }, 503, "authentication_unavailable"],
      [
        { authError: true, authErrorStatus: 0 },
        503,
        "authentication_unavailable",
      ],
      [
        { authError: true, authErrorStatus: 429 },
        503,
        "authentication_unavailable",
      ],
      [
        { authError: true, authErrorStatus: 503 },
        503,
        "authentication_unavailable",
      ],
      [{ authError: true, authErrorStatus: 401 }, 401, "invalid_identity"],
      [{ authRole: "service_role" }, 401, "invalid_identity"],
      [{ authRole: "anon" }, 401, "invalid_identity"],
      [{ anonymous: true }, 401, "invalid_identity"],
    ] as [Options, number, string][]
  ) {
    const h = harness(options);
    const response = await h.request({
      action: "execute",
      operation: "engineering.preflight",
      arguments: {},
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, error);
    assert.deepEqual([h.tables.length, h.rpcCalls.length, h.calls.length], [
      0,
      0,
      0,
    ]);
    assert.deepEqual(h.identityTokens, ["test-user-jwt"]);
  }
});

Deno.test("discovery exposes only enabled known handlers and preserves registry evidence and schemas", async () => {
  const h = harness({
    rows: [
      preflight,
      release,
      { ...preflight, operation: "unimplemented.operation" },
      { ...preflight, operation: "constructor" },
      { ...preflight, api_exposed: false },
      { ...preflight, handler: "untrusted-function" },
    ],
  });
  const response = await h.request({ action: "list" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.operations, [{ ...preflight, executable: true }, {
    ...release,
    executable: true,
  }]);
  assert.equal(body.operations[0].verified, false);
  assert.equal(h.calls.length, 0);
});

Deno.test("non-owner cannot discover, describe or execute release", async () => {
  const h = harness({ role: "administrator" });
  const body = await (await h.request({ action: "list" })).json();
  assert.deepEqual(body.operations.map((row: Row) => row.operation), [
    "engineering.preflight",
  ]);
  for (const action of ["describe", "execute"]) {
    const response = await h.request({ action, operation: release.operation });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "owner_required");
  }
  assert.equal(h.calls.length, 0);
});

Deno.test("describe and execute fail closed for unimplemented or incorrectly registered handlers", async () => {
  for (
    const entry of [
      { ...preflight, operation: "unimplemented.operation" },
      { ...preflight, operation: "constructor" },
      { ...preflight, handler: "unexpected-handler" },
    ]
  ) {
    const h = harness({ rows: [entry] });
    for (const action of ["describe", "execute"]) {
      const response = await h.request({ action, operation: entry.operation });
      assert.equal(response.status, 422);
      assert.equal((await response.json()).executed, false);
    }
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("registry errors prevent discovery and execution", async () => {
  const h = harness({ registryError: true });
  for (const action of ["list", "describe", "execute"]) {
    const response = await h.request({
      action,
      operation: preflight.operation,
    });
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).error,
      "operation_registry_unavailable",
    );
  }
  assert.equal(h.calls.length, 0);
});

Deno.test("preflight forwards the user identity and reports execution separately from verification", async () => {
  const h = harness({
    backend: () => Response.json({ ok: true, registered_change_count: 3 }),
  });
  const response = await h.request({
    action: "execute",
    operation: preflight.operation,
    arguments: {},
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.executed, true);
  assert.equal(body.verified, undefined);
  assert.deepEqual(body.result, { ok: true, registered_change_count: 3 });
  assert.equal(h.calls.length, 1);
  assert.equal(
    h.calls[0].url,
    "https://example.supabase.co/functions/v1/sandy-engineering-control",
  );
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    "Bearer test-user-jwt",
  );
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    action: "preflight",
  });
});

Deno.test("preflight rejects arguments before making any backend call", async () => {
  const h = harness();
  for (
    const args of [null, [], "value", { action: "delete" }, {
      tenant_id: "another-tenant",
    }]
  ) {
    const response = await h.request({
      action: "execute",
      operation: preflight.operation,
      arguments: args,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).executed, false);
  }
  assert.equal(h.calls.length, 0);
});

Deno.test("backend domain failures remain failures even when HTTP succeeds", async () => {
  for (
    const result of [{ ok: false, error: "provider_denied" }, { ok: false }, {
      error: "database_unavailable",
    }, {}]
  ) {
    const h = harness({ backend: () => Response.json(result) });
    const response = await h.request({
      action: "execute",
      operation: preflight.operation,
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.executed, true);
    assert.equal(body.upstream_status, 200);
    assert.deepEqual(body.result, result);
  }
});

Deno.test("provider rejection status is preserved with a failed operation result", async () => {
  const h = harness({
    backend: () => Response.json({ error: "owner_required" }, { status: 403 }),
  });
  const response = await h.request({
    action: "execute",
    operation: preflight.operation,
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.executed, true);
  assert.equal(body.error, "owner_required");
});

Deno.test("invalid backend responses never become successful operations", async () => {
  for (
    const backend of [
      () => new Response("invalid json"),
      () => Response.json([]),
      () => Response.json(null),
    ]
  ) {
    const h = harness({ backend });
    const response = await h.request({
      action: "execute",
      operation: preflight.operation,
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.executed, true);
  }
});

Deno.test("transport failure does not claim confirmed backend execution", async () => {
  const h = harness({
    backend: () => {
      throw new Error("network unavailable");
    },
  });
  const response = await h.request({
    action: "execute",
    operation: preflight.operation,
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.executed, false);
});

const releaseArgs = {
  function_slug: "sandy-api-mcp",
  source_ref: "main",
  change_id: "11111111-2222-4333-8444-555555555555",
};
Deno.test("release validates scope arguments and rejects unknown fields before dispatch", async () => {
  const h = harness();
  for (
    const args of [
      null,
      [],
      { ...releaseArgs, function_slug: "sandy-task-api" },
      { ...releaseArgs, source_ref: "feature/unreviewed" },
      { ...releaseArgs, change_id: "------------------------------------" },
      { ...releaseArgs, change_id: 123 },
      { ...releaseArgs, injected: true },
    ]
  ) {
    const response = await h.request({
      action: "execute",
      operation: release.operation,
      arguments: args,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).executed, false);
  }
  assert.equal(h.calls.length, 0);
});

Deno.test("release dispatch preserves approved identifiers without claiming functional production verification", async () => {
  const provider = {
    ok: true,
    verified: true,
    receipt: { version: 2 },
    rollback_mode: "delete_new_function_only",
  };
  const h = harness({ backend: () => Response.json(provider) });
  const response = await h.request({
    action: "execute",
    operation: release.operation,
    arguments: releaseArgs,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.executed, true);
  assert.equal(body.verified, undefined);
  assert.deepEqual(body.result, provider);
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    "Bearer test-service-credential",
  );
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    action: "engineering_release",
    ...releaseArgs,
  });
});

const infrastructure = (operation = "supabase.functions.list") => ({
  ...preflight,
  operation,
  handler: "sandy-infrastructure-read",
  permission_scope:
    ["deployment", "engineering", "system"].includes(operation.split(".")[0])
      ? `${operation.split(".")[0]}:read`
      : "infrastructure:read",
  ai_exposed: false,
});

Deno.test("all installed infrastructure reads delegate through API with service authentication and retain exposure flags", async () => {
  const operations = [
    "supabase.functions.list",
    "supabase.functions.get",
    "supabase.project.status",
    "system.registry.list",
    "system.registry.describe",
    "system.registry.summary",
    "deployment.jobs.get",
    "deployment.jobs.list",
    "deployment.jobs.events",
    "deployment.audit.list",
    "engineering.changes.list",
    "engineering.change.detail",
    "engineering.change.events",
    "engineering.change.tests",
    "engineering.change.artifacts",
  ];
  for (const operation of operations) {
    const entry = infrastructure(operation);
    const h = harness({ rows: [entry] });
    const catalogue = await (await h.request({ action: "list" })).json();
    assert.equal(catalogue.operations[0].ai_exposed, false);
    assert.equal(catalogue.operations[0].executable, true);
    const r = await h.request({ action: "execute", operation, arguments: {} });
    assert.equal(r.status, 200);
    assert.equal(
      h.calls[0].url,
      "https://example.supabase.co/functions/v1/sandy-infrastructure-read",
    );
    assert.equal(
      new Headers(h.calls[0].init?.headers).get("authorization"),
      "Bearer test-service-credential",
    );
    assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
      operation,
      arguments: {},
    });
    const mcp = await h.request({
      action: "execute",
      channel: "mcp",
      operation,
    });
    assert.equal(mcp.status, 403);
    assert.equal(h.calls.length, 1);
  }
});

Deno.test("global infrastructure reads require owner and cannot execute mutations", async () => {
  const entry = infrastructure();
  const h = harness({ rows: [entry], role: "administrator" });
  assert.deepEqual(
    (await (await h.request({ action: "list" })).json()).operations,
    [],
  );
  for (const action of ["describe", "execute"]) {
    assert.equal(
      (await h.request({ action, operation: entry.operation })).status,
      403,
    );
  }
  assert.equal(h.calls.length, 0);
  const conflicting = harness({ rows: [{ ...entry, is_mutation: true }] });
  assert.equal(
    (await conflicting.request({
      action: "execute",
      operation: entry.operation,
    })).status,
    503,
  );
  assert.equal(conflicting.calls.length, 0);
});

Deno.test("registry input validation rejects malformed nested inputs without coercing or dispatching", async () => {
  const entry = {
    ...infrastructure(),
    input_schema: {
      type: "object",
      required: ["target"],
      additionalProperties: false,
      properties: {
        target: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: {
            id: { type: "string", format: "uuid" },
            count: { type: "integer", minimum: 1, maximum: 5 },
          },
        },
      },
    },
  };
  const h = harness({ rows: [entry] });
  for (
    const args of [{}, { target: { id: "bad" } }, {
      target: { id: "11111111-2222-4333-8444-555555555555", count: "2" },
    }, { target: { id: "11111111-2222-4333-8444-555555555555", count: 6 } }]
  ) {
    assert.equal(
      (await h.request({
        action: "execute",
        operation: entry.operation,
        arguments: args,
      })).status,
      400,
    );
  }
  assert.equal(h.calls.length, 0);
});

Deno.test("invalid and asynchronous registry schemas fail closed before dispatch", async () => {
  for (
    const input_schema of [
      null,
      { type: "object", properties: { id: { type: "imaginary" } } },
      { type: "object", $ref: "https://untrusted.invalid/schema" },
      { type: "object", $async: true },
      { type: "object", $async: false },
      {
        type: "object",
        properties: { child: { $ref: "#/definitions/async" } },
        definitions: { async: { type: "object", $async: true } },
      },
    ]
  ) {
    const entry = { ...infrastructure(), input_schema };
    const h = harness({ rows: [entry], executionPolicy: true });
    const response = await h.request({
      action: "execute",
      operation: entry.operation,
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).executed, false);
    assert.equal(h.calls.length, 0);
    assert.equal(h.rpcCalls.length, 0);
  }
});

Deno.test("repeated registry revisions release validators and preserve format refusals before dispatch", async () => {
  const collect = (globalThis as unknown as { gc?: () => void }).gc;
  const entry: Row = { ...infrastructure() };
  const h = harness({ rows: [entry] });
  const iterations = collect ? 2048 : 24;
  const invalid = [
    {
      id: "invalid",
      email: "person@example.invalid",
      at: "2026-10-21T00:00:00Z",
    },
    {
      id: "11111111-2222-4333-8444-555555555555",
      email: "invalid",
      at: "2026-10-21T00:00:00Z",
    },
    {
      id: "11111111-2222-4333-8444-555555555555",
      email: "person@example.invalid",
      at: "2026-02-30T00:00:00Z",
    },
  ];
  let baseline = 0;
  for (let revision = 0; revision < iterations + 8; revision++) {
    entry.input_schema = {
      $id: `urn:sandy:test:registry-revision:${revision}`,
      type: "object",
      required: ["id", "email", "at"],
      properties: {
        id: { type: "string", format: "uuid" },
        email: { type: "string", format: "email" },
        at: { type: "string", format: "date-time" },
        ...Object.fromEntries(Array.from({ length: 48 }, (_, field) => [
          `optional_${field}`,
          { type: "string", enum: [`revision_${revision}_field_${field}`] },
        ])),
      },
      additionalProperties: false,
    };
    const response = await h.request({
      action: "execute",
      operation: entry.operation,
      arguments: invalid[revision % invalid.length],
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).executed, false);
    if (revision === 7 && collect) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      collect();
      baseline = Deno.memoryUsage().heapUsed;
    }
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.rpcCalls.length, 0);
  if (collect) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collect();
    const retainedBytes = Deno.memoryUsage().heapUsed - baseline;
    console.info({
      registry_revisions: iterations,
      retained_bytes: retainedBytes,
    });
    assert.ok(
      retainedBytes < 200 * 1024 * 1024,
      `registry revisions retained ${retainedBytes} bytes after collection`,
    );
  }
});

Deno.test("output schema mismatch is an executed failure rather than verified success", async () => {
  const entry = {
    ...infrastructure(),
    output_schema: {
      type: "object",
      required: ["items"],
      properties: { items: { type: "array" } },
    },
  };
  const h = harness({
    rows: [entry],
    backend: () => Response.json({ ok: true, items: "wrong" }),
  });
  const response = await h.request({
    action: "execute",
    operation: entry.operation,
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.executed, true);
  assert.equal(body.error, "upstream_output_schema_mismatch");
  assert.equal(body.result, undefined);
});

Deno.test("canonical capabilities routes use existing authorization and version the caller's catalogue", async () => {
  const h = harness();
  const request = (path: string) =>
    h.handler(
      new Request(
        "https://example.supabase.co/functions/v1/sandy-operation-api" + path,
        {
          headers: { authorization: "Bearer test-user-jwt" },
        },
      ),
    );
  const catalogue = await (await request("/v1/capabilities")).json();
  assert.match(catalogue.catalogue_version, /^[a-f0-9]{64}$/);
  const again = await (await request("/v1/capabilities")).json();
  assert.equal(again.catalogue_version, catalogue.catalogue_version);
  assert.equal(
    (await request("/v1/capabilities/engineering.preflight")).status,
    200,
  );
  assert.equal(
    (await h.handler(new Request("https://example.invalid/v1/capabilities")))
      .status,
    401,
  );
  assert.equal(h.calls.length, 0);
});

Deno.test("canonical execute route binds operation to URL and rejects conflicting envelopes", async () => {
  const h = harness();
  const request = (body: unknown) =>
    h.handler(
      new Request(
        "https://example.invalid/v1/operations/engineering.preflight:execute",
        {
          method: "POST",
          headers: {
            authorization: "Bearer test-user-jwt",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      ),
    );
  assert.equal((await request({ arguments: {} })).status, 200);
  assert.equal(
    (await request({
      operation: "deployment.management.release",
      arguments: {},
    })).status,
    400,
  );
  assert.equal(h.calls.length, 1);
});

Deno.test("canonical job routes delegate exact job identifier to installed read handler", async () => {
  const job_id = "11111111-2222-4333-8444-555555555555";
  const h = harness({
    actorId: "10000000-0000-4000-8000-000000000003",
    rpcHandler: (name, args) => {
      assert.equal(name, "sandy_api_resolve_job_route");
      return {
        ok: true,
        job_id,
        job_kind: "legacy",
        operation: `deployment.jobs.${args.p_action}`,
      };
    },
    rows: [
      infrastructure("deployment.jobs.get"),
      infrastructure("deployment.jobs.events"),
    ].map((entry) => ({
      ...entry,
      input_schema: {
        type: "object",
        required: ["job_id"],
        properties: { job_id: { type: "string", format: "uuid" } },
        additionalProperties: false,
      },
    })),
  });
  for (const suffix of ["", "/events"]) {
    const response = await h.handler(
      new Request("https://example.invalid/v1/jobs/" + job_id + suffix, {
        headers: { authorization: "Bearer test-user-jwt" },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(String(h.calls.at(-1)?.init?.body)), {
      operation: suffix ? "deployment.jobs.events" : "deployment.jobs.get",
      arguments: { job_id },
    });
  }
});

const customerRead = (operation = "tasks.list") => ({
  ...preflight,
  operation,
  handler: "sandy-operations-api",
  permission_scope: `${operation.split(".")[0]}:read`,
});
const opaqueKey = "sandyop_" + "a".repeat(64);
const opaqueKeyId = "40000000-0000-4000-8000-000000000001";
const opaqueTenant = "40000000-0000-4000-8000-000000000002";
const opaqueAdmission = "40000000-0000-4000-8000-000000000003";
const opaqueGrant = "40000000-0000-4000-8000-000000000004";
function opaqueKeyHarness(
  options: { refusal?: string; ai?: boolean; backend?: Options["backend"] } =
    {},
) {
  return harness({
    role: null,
    rows: [
      { ...customerRead(), ai_exposed: options.ai ?? true },
      customerRead("calendar.list"),
      release,
    ],
    rpcHandler(name, args) {
      if (name === "sandy_api_authenticate_customer_key") {
        return {
          ok: true,
          kind: "customer_key",
          key_id: opaqueKeyId,
          customer_id: opaqueTenant,
          scopes: ["tasks:read"],
          allowed_operations: ["tasks.get", "tasks.list"],
          key_revision_sha256: "b".repeat(64),
          expires_at: null,
        };
      }
      if (name === "sandy_api_admit_customer_key_execution") {
        assert.equal(args.p_key_id, opaqueKeyId);
        assert.equal(args.p_customer_id, opaqueTenant);
        assert.equal(Object.hasOwn(args, "p_actor_id"), false);
        return {
          ok: true,
          allowed: true,
          reused: false,
          principal_kind: "customer_key",
          customer_key_id: opaqueKeyId,
          tenant_id: opaqueTenant,
          admission_id: opaqueAdmission,
          grant_id: opaqueGrant,
          state: "admitted",
          executed: false,
          expires_at: "2099-01-01T00:00:00Z",
        };
      }
      if (name === "sandy_api_consume_customer_key_grant") {
        return options.refusal
          ? { ok: false, error: options.refusal, http_status: 403 }
          : {
            ok: true,
            allowed: true,
            reused: false,
            admission_id: opaqueAdmission,
          };
      }
      if (name === "sandy_api_finish_execution") {
        return {
          ok: true,
          admission_id: opaqueAdmission,
          state: args.p_outcome,
          reused: false,
        };
      }
      throw Error("unexpected customer key RPC");
    },
    backend: options.backend ?? (() => Response.json({ ok: true, items: [] })),
  });
}
function opaqueRequest(body: unknown, bearer = "test-anon-key") {
  return new Request("https://local.invalid", {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "x-sandy-api-key": opaqueKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
Deno.test("legacy customer keys have explicit tenant scope and no fabricated Auth/Controller/Agenda identity in the composed gateway", async () => {
  const h = opaqueKeyHarness();
  const list = await h.handler(opaqueRequest({ action: "list" }));
  assert.equal(list.status, 200);
  assert.deepEqual(
    (await list.json()).operations.map((r: Row) => r.operation),
    ["tasks.list"],
  );
  assert.deepEqual(h.identityTokens, []);
  assert.deepEqual(h.tables, ["sandy_operation_registry"]);
  for (
    const operation of [
      "calendar.list",
      "tasks.create",
      "customer.keys.create",
      "memory.tree",
      "supabase.projects.get",
    ]
  ) {
    const result = await h.handler(
      opaqueRequest({ action: "execute", operation, arguments: {} }),
    );
    assert.equal(result.status, 404);
  }
  const result = await h.handler(
    opaqueRequest({
      action: "execute",
      operation: "tasks.list",
      arguments: {},
    }),
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).admission_id, opaqueAdmission);
  assert.equal(h.calls.length, 1);
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    `Bearer ${opaqueKey}`,
  );
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    operation: "tasks.list",
    arguments: {},
  });
  assert.deepEqual(h.rpcCalls.slice(-4).map((c) => c.name), [
    "sandy_api_authenticate_customer_key",
    "sandy_api_admit_customer_key_execution",
    "sandy_api_consume_customer_key_grant",
    "sandy_api_finish_execution",
  ]);
  assert.deepEqual(h.identityTokens, []);
  assert.ok(h.tables.every((t) => t === "sandy_operation_registry"));
});
Deno.test("customer key gateway preserves mixed-auth rejection, final grant refusal, AI flags and job tenant non-disclosure", async () => {
  const h = opaqueKeyHarness();
  assert.equal(
    (await h.handler(opaqueRequest({ action: "list" }, "actual-user-session")))
      .status,
    401,
  );
  assert.equal(h.rpcCalls.length, 0);
  const hidden = await h.handler(
    new Request(`https://local.invalid/v1/jobs/${retryJobId}`, {
      headers: {
        authorization: "Bearer test-anon-key",
        "x-sandy-api-key": opaqueKey,
      },
    }),
  );
  assert.equal(hidden.status, 404);
  assert.ok(
    h.rpcCalls.every((c) => c.name === "sandy_api_authenticate_customer_key"),
  );
  const refused = opaqueKeyHarness({ refusal: "customer_key_scope_denied" });
  assert.equal(
    (await refused.handler(
      opaqueRequest({
        action: "execute",
        operation: "tasks.list",
        arguments: {},
      }),
    )).status,
    403,
  );
  assert.equal(refused.calls.length, 0);
  const ai = opaqueKeyHarness({ ai: false });
  assert.equal(
    (await ai.handler(
      opaqueRequest({
        action: "execute",
        operation: "tasks.list",
        arguments: {},
        channel: "mcp",
      }),
    )).status,
    403,
  );
  assert.equal(ai.calls.length, 0);
  assert.equal(
    (await ai.handler(
      opaqueRequest({
        action: "execute",
        operation: "tasks.list",
        arguments: {},
      }),
    )).status,
    200,
  );
});
Deno.test("canonical MCP reaches the governed customer key API with its original opaque backend identity", async () => {
  const h = opaqueKeyHarness(), apiRequests: Request[] = [];
  const mcp = createHandler(
    createApi(
      "https://example.supabase.co",
      "test-anon-key",
      (async (input, init) => {
        const req = new Request(input, init);
        apiRequests.push(req.clone());
        return h.handler(req);
      }) as typeof fetch,
    ),
  );
  const response = await mcp(
    new Request("https://local.invalid/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-anon-key",
        "x-sandy-api-key": opaqueKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "tasks.list", arguments: {} },
      }),
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.result.isError, false);
  assert.deepEqual(result.result.structuredContent, { ok: true, items: [] });
  assert.equal(apiRequests.length, 1);
  assert.equal(apiRequests[0].headers.get("x-sandy-api-key"), opaqueKey);
  assert.equal((await apiRequests[0].json()).channel, "mcp");
  assert.deepEqual(h.identityTokens, []);
  assert.equal(h.calls.length, 1);
  assert.equal(h.rpcCalls.length, 4);
});
Deno.test("customer key execution receipt URLs recover only projected own-key evidence without admitting or dispatching again", async () => {
  const requestId = "40000000-0000-4000-8000-000000000005";
  const h = harness({
    role: null,
    rows: [{
      ...policyOperationContracts["system.execution.get"],
      operation: "system.execution.get",
      handler: "sandy-operation-api",
      api_exposed: true,
      ai_exposed: true,
      verified: false,
    }],
    rpcHandler(name, args) {
      if (name === "sandy_api_authenticate_customer_key") {
        return {
          ok: true,
          kind: "customer_key",
          key_id: opaqueKeyId,
          customer_id: opaqueTenant,
          scopes: ["tasks:read"],
          allowed_operations: ["tasks.get", "tasks.list"],
          key_revision_sha256: "b".repeat(64),
          expires_at: null,
        };
      }
      assert.equal(name, "sandy_api_get_customer_key_receipt");
      assert.equal(args.p_key_id, opaqueKeyId);
      assert.equal(args.p_customer_id, opaqueTenant);
      assert.equal(args.p_request_id, requestId);
      return {
        ok: true,
        admission_id: opaqueAdmission,
        request_id: requestId,
        operation: "tasks.list",
        request_state: "consumed",
        accepted: false,
        executed: null,
        completed: false,
        outcome: "pending",
        provider_http_status: null,
        provider_request_id_sha256: null,
        result_sha256: null,
        reconciliation_required: true,
        redispatch_permitted: false,
        created_at: "2026-10-21T00:00:00Z",
        finished_at: null,
        grant_id: opaqueGrant,
        key_hash: "must not expose",
      };
    },
  });
  const result = await h.handler(
    new Request(`https://local.invalid/v1/executions/${requestId}`, {
      headers: {
        authorization: "Bearer test-anon-key",
        "x-sandy-api-key": opaqueKey,
      },
    }),
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.result.executed, null);
  assert.equal(body.result.redispatch_permitted, false);
  assert.equal(Object.hasOwn(body.result, "grant_id"), false);
  assert.equal(JSON.stringify(body).includes("must not expose"), false);
  assert.deepEqual(h.rpcCalls.map((c) => c.name), [
    "sandy_api_authenticate_customer_key",
    "sandy_api_get_customer_key_receipt",
  ]);
  assert.deepEqual(h.identityTokens, []);
  assert.equal(h.calls.length, 0);
  assert.ok(h.tables.every((t) => t === "sandy_operation_registry"));
});
Deno.test("original provider read dispatch carries one consumed versioned proof with its actual arguments and receipt", async () => {
  const operation = "supabase.branches.get",
    requestId = "50000000-0000-4000-8000-000000000001";
  const readArguments = { name: "main" };
  const expectedInputDigest = await argumentDigest(readArguments);
  const admission = "50000000-0000-4000-8000-000000000002",
    grant = "50000000-0000-4000-8000-000000000003";
  let refusedBeforeProvider = false;
  const h = harness({
    actorId: retryActorId,
    executionPolicy: true,
    backend: () =>
      refusedBeforeProvider
        ? Response.json({
          ok: false,
          error: "consumer_active_binding_refused",
          executed: false,
        }, { status: 424 })
        : Response.json({ ok: true }, {
          headers: { "x-sandy-provider-http-status": "201" },
        }),
    rows: [{
      ...infrastructure(operation),
      handler: "sandy-provider-read-api",
      input_schema: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
        additionalProperties: false,
      },
    }],
    rpcHandler(name, args) {
      if (name === "sandy_api_admit_execution") {
        assert.equal(args.p_input_sha256, expectedInputDigest);
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: admission,
          grant_id: grant,
          state: "admitted",
          executed: false,
          expires_at: "2099-01-01T00:00:00Z",
        };
      }
      if (name === "sandy_api_consume_execution_grant") {
        assert.equal(args.p_input_sha256, expectedInputDigest);
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: admission,
        };
      }
      if (name === "sandy_api_finish_execution") {
        assert.equal(
          args.p_provider_http_status,
          refusedBeforeProvider ? null : 201,
        );
        return {
          ok: true,
          admission_id: admission,
          state: args.p_outcome,
          reused: false,
        };
      }
      throw Error("unexpected RPC");
    },
  });
  const response = await h.handler(
    new Request("https://local.invalid", {
      method: "POST",
      headers: {
        authorization: "Bearer original-user-jwt",
        "content-type": "application/json",
        "x-sandy-request-id": requestId,
      },
      body: JSON.stringify({
        action: "execute",
        operation,
        arguments: readArguments,
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).upstream_status, 201);
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    protocol: "consumed-admission-v1",
    operation,
    arguments: readArguments,
    actor_id: retryActorId,
    tenant_id: null,
    request_id: requestId,
    grant_id: grant,
    admission_id: admission,
    credential_id: null,
  });
  assert.deepEqual(h.rpcCalls.map((c) => c.name), [
    "sandy_api_admit_execution",
    "sandy_api_consume_execution_grant",
    "sandy_api_finish_execution",
  ]);
  assert.equal(h.calls.length, 1);
  refusedBeforeProvider = true;
  const refused = await h.request({
    action: "execute",
    operation,
    arguments: readArguments,
  });
  assert.equal(refused.status, 424);
  assert.equal((await refused.json()).executed, false);
  assert.equal(h.rpcCalls.length, 6);
  assert.equal(h.calls.length, 2);
});
const memoryRead = (operation = "memory.tree") => ({
  ...preflight,
  operation,
  handler: "sandy-memory-centre",
  permission_scope: "memory:read",
  input_schema: operation === "memory.evidence"
    ? {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", format: "uuid" } },
      additionalProperties: false,
    }
    : preflight.input_schema,
  output_schema: {
    type: "object",
    required: operation === "memory.evidence"
      ? ["ok", "item"]
      : operation === "memory.overview"
      ? ["ok", "overview"]
      : operation === "memory.life_brief"
      ? ["ok", "brief"]
      : operation === "memory.life_spaces"
      ? ["ok", "spaces", "areas", "suggestions"]
      : ["ok", "subjects", "links"],
    properties: {
      ok: { const: true },
      item: { type: "object" },
      overview: { type: "object" },
      brief: { type: "object" },
      spaces: { type: "array", items: { type: "object" } },
      areas: { type: "array", items: { type: "object" } },
      suggestions: { type: "array", items: { type: "object" } },
      subjects: { type: "array", items: { type: "object" } },
      links: { type: "array", items: { type: "object" } },
    },
    additionalProperties: false,
  },
});

Deno.test("passive memory reads use a separate portal grant, fixed query action and original user session", async () => {
  const id = "11111111-2222-4333-8444-555555555555";
  for (
    const [operation, action] of [
      ["memory.overview", "overview"],
      ["memory.tree", "memory_tree"],
      ["memory.evidence", "evidence"],
      ["memory.life_brief", "life_brief"],
      ["memory.life_spaces", "life_spaces"],
    ]
  ) {
    const args = operation === "memory.evidence" ? { id } : {};
    const result = operation === "memory.evidence"
      ? { ok: true, item: { id, content: "Synthetic source" } }
      : operation === "memory.overview"
      ? { ok: true, overview: { name: "Synthetic fixture", settings: null } }
      : operation === "memory.life_brief"
      ? { ok: true, brief: { enabled: false } }
      : operation === "memory.life_spaces"
      ? { ok: true, spaces: [], areas: [], suggestions: [] }
      : { ok: true, subjects: [], links: [] };
    const h = harness({
      role: null,
      memoryTenant: "memory-tenant-one",
      rows: [memoryRead(operation), customerRead(), preflight, release],
      backend: (url, init) => {
        // This models the backend's independent session check, not a service call.
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer test-user-jwt",
        );
        assert.equal(new URL(url).searchParams.get("op"), action);
        assert.deepEqual(JSON.parse(String(init?.body)), args);
        return Response.json(result);
      },
    });
    const catalogue = await (await h.request({ action: "list" })).json();
    assert.deepEqual(catalogue.operations.map((row: Row) => row.operation), [
      operation,
    ]);
    const response = await h.request({
      action: "execute",
      channel: "mcp",
      operation,
      arguments: args,
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.result, result);
    assert.equal(body.verified, undefined);
    assert.equal(h.calls.length, 1);
    assert.equal(
      h.calls[0].url,
      "https://example.supabase.co/functions/v1/sandy-memory-centre?op=" +
        action,
    );
    assert.equal(h.calls[0].init?.method, "POST");
    assert.equal(
      new Headers(h.calls[0].init?.headers).get("apikey"),
      "test-anon-key",
    );
  }
});

Deno.test("Controller and Agenda grants cannot substitute for a verified Memory Portal grant", async () => {
  for (
    const options of [
      { tenant: "agenda-tenant", memoryTenant: null },
      { memoryTenant: "memory-tenant", memoryRevoked: true },
      { memoryTenant: "memory-tenant", memoryPrimary: false },
      { memoryTenant: "memory-tenant", memoryEmail: "other@example.invalid" },
      { memoryTenant: "memory-tenant", emailConfirmed: false },
    ]
  ) {
    const h = harness({ ...options, rows: [memoryRead(), preflight] });
    const catalogue = await (await h.request({ action: "list" })).json();
    assert.deepEqual(catalogue.operations.map((row: Row) => row.operation), [
      "engineering.preflight",
    ]);
    for (const action of ["describe", "execute"]) {
      const response = await h.request({ action, operation: "memory.tree" });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, "memory_access_required");
    }
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("Memory Portal identity and email directory errors fail closed before dispatch", async () => {
  for (const error of [{ memoryError: true }, { memoryAddressError: true }]) {
    const h = harness({
      role: null,
      memoryTenant: "memory-tenant",
      rows: [memoryRead()],
      ...error,
    });
    const response = await h.request({
      action: "execute",
      operation: "memory.tree",
    });
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).error,
      "memory_authorisation_unavailable",
    );
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("API exposure remains independent of AI exposure across Controller, Agenda and Memory handlers", async () => {
  for (const candidate of [preflight, customerRead(), memoryRead()]) {
    const entry = { ...candidate, ai_exposed: false };
    const isMemory = entry.operation.startsWith("memory.");
    const h = harness({
      role: entry.operation.startsWith("engineering.") ? "owner" : null,
      tenant: entry.operation.startsWith("tasks.") ? "agenda-tenant" : null,
      memoryTenant: isMemory ? "memory-tenant" : null,
      rows: [entry],
      backend: () =>
        Response.json(
          isMemory ? { ok: true, subjects: [], links: [] } : { ok: true },
        ),
    });
    const catalogue = await (await h.request({ action: "list" })).json();
    assert.deepEqual(catalogue.operations, [{ ...entry, executable: true }]);
    assert.equal(
      (await h.request({ action: "describe", operation: entry.operation }))
        .status,
      200,
    );
    // Compose the actual MCP adapter and API handlers. MCP discovery excludes
    // API-only rows and a direct tool call still reaches API's channel gate.
    const mcp = createHandler(createApi(
      "https://example.supabase.co",
      "test-anon-key",
      ((input: RequestInfo | URL, init?: RequestInit) =>
        h.handler(new Request(input, init))) as typeof fetch,
    ));
    const mcpRequest = (method: string, params: Row = {}) =>
      mcp(
        new Request("https://mcp.fixture.invalid", {
          method: "POST",
          headers: {
            authorization: "Bearer test-user-jwt",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "exposure-test",
            method,
            params,
          }),
        }),
      );
    const tools = await (await mcpRequest("tools/list")).json();
    assert.deepEqual(tools.result.tools, []);
    const blocked = await (await mcpRequest("tools/call", {
      name: entry.operation,
      arguments: {},
    })).json();
    assert.equal(blocked.result.isError, true);
    const denial = JSON.parse(blocked.result.content[0].text);
    assert.equal(denial.status, 403);
    assert.equal(
      denial.result.error,
      "operation_not_mcp_exposed",
    );
    assert.equal(h.calls.length, 0);
    assert.equal(
      (await h.request({ action: "execute", operation: entry.operation }))
        .status,
      200,
    );
    assert.equal(h.calls.length, 1);
  }
});

Deno.test("passive memory dispatch rejects forged identity/action fields even if registry schemas become permissive", async () => {
  for (const operation of ["memory.tree", "memory.evidence"]) {
    const h = harness({
      role: null,
      memoryTenant: "memory-tenant",
      rows: [{ ...memoryRead(operation), input_schema: { type: "object" } }],
    });
    for (
      const args of [
        { customer_id: "another-tenant" },
        { owner_customer_id: "another-tenant" },
        { action: "forget" },
        { op: "ask" },
        { id: "not-a-uuid" },
        { id: "11111111-2222-4333-8444-555555555555", confirm: true },
      ]
    ) {
      const response = await h.request({
        action: "execute",
        operation,
        arguments: args,
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).executed, false);
    }
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("memory contract drift, hidden exposure and side-effecting read labels never enable dispatch", async () => {
  for (
    const entry of [
      { ...memoryRead(), is_mutation: true },
      { ...memoryRead(), permission_scope: "memory:write" },
      { ...memoryRead(), handler: "sandy-operation-api" },
      { ...memoryRead(), api_exposed: false },
      ...[
        "memory.ask",
        "memory.search",
        "memory.life_search",
        "memory.biography",
      ]
        .map((operation) => memoryRead(operation)),
    ]
  ) {
    const h = harness({
      role: null,
      memoryTenant: "memory-tenant",
      rows: [entry],
    });
    assert.deepEqual(
      (await (await h.request({ action: "list" })).json()).operations,
      [],
    );
    const response = await h.request({
      action: "execute",
      channel: "mcp",
      operation: entry.operation,
    });
    assert.equal(response.status >= 400, true);
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("memory backend authorization errors and invalid outputs preserve failure", async () => {
  for (
    const [provider, expectedStatus, expectedError] of [
      [
        () =>
          Response.json({
            error: "Sign in with your verified customer account.",
          }, { status: 401 }),
        401,
        "Sign in with your verified customer account.",
      ],
      [
        () => Response.json({ error: "source_not_found" }, { status: 404 }),
        404,
        "source_not_found",
      ],
      [
        () => Response.json({ ok: true, subjects: [], links: "invalid" }),
        502,
        "upstream_output_schema_mismatch",
      ],
    ] as [() => Response, number, string][]
  ) {
    const h = harness({
      role: null,
      memoryTenant: "memory-tenant",
      rows: [memoryRead()],
      backend: provider,
    });
    const response = await h.request({
      action: "execute",
      operation: "memory.tree",
    });
    const body = await response.json();
    assert.equal(response.status, expectedStatus);
    assert.equal(body.ok, false);
    assert.equal(body.error, expectedError);
    assert.equal(body.executed, true);
    assert.equal(body.verified, undefined);
    assert.equal(h.calls.length, 1);
  }
});

Deno.test("customer sessions discover only their installed tenant reads and forward their identity, never service credentials", async () => {
  const entry = customerRead();
  const h = harness({
    role: null,
    tenant: "tenant-one",
    rows: [entry, preflight, release, infrastructure()],
  });
  const catalogue = await (await h.request({ action: "list" })).json();
  assert.deepEqual(catalogue.operations.map((row: Row) => row.operation), [
    "tasks.list",
  ]);
  const response = await h.request({
    action: "execute",
    channel: "mcp",
    operation: entry.operation,
  });
  assert.equal(response.status, 200);
  assert.equal(
    h.calls[0].url,
    "https://example.supabase.co/functions/v1/sandy-operations-api",
  );
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    "Bearer test-user-jwt",
  );
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    operation: "tasks.list",
    arguments: {},
  });
  assert.equal(
    (await h.request({ action: "execute", operation: preflight.operation }))
      .status,
    403,
  );
  assert.equal(h.calls.length, 1);
});
Deno.test("Controller membership alone never grants access to a customer's reads", async () => {
  const h = harness({ tenant: null, rows: [customerRead(), preflight] });
  const catalogue = await (await h.request({ action: "list" })).json();
  assert.deepEqual(catalogue.operations.map((row: Row) => row.operation), [
    "engineering.preflight",
  ]);
  assert.equal(
    (await h.request({ action: "execute", operation: "tasks.list" })).status,
    403,
  );
  assert.equal(h.calls.length, 0);
});
Deno.test("tenant directory failures, forged tenant arguments and conflicting scope or mutation contracts fail closed", async () => {
  const h = harness({
    role: null,
    tenant: "tenant-one",
    tenantError: true,
    rows: [customerRead()],
  });
  assert.equal(
    (await h.request({ action: "execute", operation: "tasks.list" })).status,
    503,
  );
  assert.equal(h.calls.length, 0);
  const tenant = harness({
    role: null,
    tenant: "tenant-one",
    rows: [customerRead()],
  });
  assert.equal(
    (await tenant.request({
      action: "execute",
      operation: "tasks.list",
      arguments: { customer_id: "tenant-two" },
    })).status,
    400,
  );
  assert.equal(tenant.calls.length, 0);
  for (
    const entry of [{ ...customerRead(), is_mutation: true }, {
      ...customerRead(),
      permission_scope: "infrastructure:read",
    }]
  ) {
    const conflict = harness({
      role: null,
      tenant: "tenant-one",
      rows: [entry],
    });
    assert.equal(
      (await conflict.request({ action: "execute", operation: "tasks.list" }))
        .status,
      503,
    );
    assert.equal(conflict.calls.length, 0);
  }
});

Deno.test("lost release response is ambiguous and requires reconciliation rather than reporting no execution", async () => {
  const h = harness({
    backend: () => {
      throw Error("connection lost after request");
    },
  });
  const response = await h.request({
    action: "execute",
    operation: release.operation,
    arguments: releaseArgs,
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
  assert.equal(body.ok, false);
});

Deno.test("all provider reads and customer reads are installed at the correct fixed backend", async () => {
  const providerOperations = [
    "supabase.projects.get",
    "supabase.project.health",
    "supabase.branches.list",
    "supabase.branches.get",
    "supabase.network.restrictions.get",
    "supabase.domains.get",
    "supabase.functions.secrets.list",
    "supabase.backups.list",
    "supabase.db.migrations.list",
    "supabase.database.inspect",
    "supabase.schema.tables.list",
    "supabase.schema.functions.list",
    "supabase.schema.indexes.list",
    "supabase.database.connections.list",
    "supabase.schema.views.list",
    "supabase.schema.materialized_views.list",
    "supabase.schema.triggers.list",
    "supabase.schema.constraints.list",
    "supabase.schema.types.list",
    "supabase.schema.extensions.list",
    "supabase.database.roles.list",
    "supabase.database.grants.list",
    "supabase.database.default_privileges.list",
    "supabase.database.rls.policies.list",
    "supabase.database.locks.list",
    "supabase.database.cron.jobs.list",
  ];
  for (const operation of providerOperations) {
    const entry = {
      ...infrastructure(operation),
      handler: "sandy-provider-read-api",
      ai_exposed: true,
    };
    const h = harness({ rows: [entry] });
    assert.equal(
      (await h.request({ action: "execute", channel: "mcp", operation }))
        .status,
      200,
    );
    assert.equal(
      h.calls[0].url,
      "https://example.supabase.co/functions/v1/sandy-provider-read-api",
    );
    assert.equal(
      new Headers(h.calls[0].init?.headers).get("authorization"),
      "Bearer test-service-credential",
    );
  }
  for (
    const operation of [
      "tasks.list",
      "tasks.get",
      "calendar.list",
      "calendar.get",
      "calendar.conflicts",
      "files.list",
      "files.get",
      "files.search",
    ]
  ) {
    const h = harness({
      rows: [customerRead(operation)],
      role: null,
      tenant: "tenant-one",
    });
    assert.equal(
      (await h.request({ action: "execute", operation })).status,
      200,
    );
    assert.equal(
      h.calls[0].url,
      "https://example.supabase.co/functions/v1/sandy-operations-api",
    );
    assert.equal(
      new Headers(h.calls[0].init?.headers).get("authorization"),
      "Bearer test-user-jwt",
    );
  }
});

const videoRead = (operation = "video.execution.preflight") => ({
  ...preflight,
  operation,
  handler: "sandy-deploy-provision",
  permission_scope: "infrastructure:read",
  verified: true,
});

Deno.test("video reads use the original fixed service actions and preserve provider payloads without promoting verification", async () => {
  const cases = [
    {
      operation: "video.status",
      action: "video_status",
      arguments: { target: "sandy-video" },
      result: { ok: true, name: "sandy-video", status: "RUNNING" },
    },
    {
      operation: "video.install.preflight",
      action: "video_install_preflight",
      arguments: {},
      result: {
        ok: true,
        installation_authorized: false,
        livekit_verified: false,
      },
    },
    {
      operation: "video.execution.preflight",
      action: "video_execution_preflight",
      arguments: {},
      result: {
        ok: true,
        osconfig_http: 200,
        osconfig_enabled: true,
        installation_executed: false,
      },
    },
  ];
  for (const expected of cases) {
    const entry = {
      ...videoRead(expected.operation),
      input_schema: expected.operation === "video.status"
        ? {
          type: "object",
          properties: { target: { const: "sandy-video" } },
        }
        : videoRead().input_schema,
    };
    const h = harness({
      rows: [entry],
      backend: () => Response.json(expected.result),
    });
    const catalogue = await (await h.request({ action: "list" })).json();
    assert.deepEqual(catalogue.operations, [{ ...entry, executable: true }]);
    const response = await h.request({
      action: "execute",
      channel: "mcp",
      operation: expected.operation,
      arguments: expected.arguments,
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.result, expected.result);
    assert.equal(body.executed, true);
    assert.equal(body.verified, undefined);
    assert.deepEqual(h.identityTokens, ["test-user-jwt", "test-user-jwt"]);
    assert.equal(h.calls.length, 1);
    assert.equal(
      h.calls[0].url,
      "https://example.supabase.co/functions/v1/sandy-deploy-provision",
    );
    assert.equal(
      new Headers(h.calls[0].init?.headers).get("authorization"),
      "Bearer test-service-credential",
    );
    assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
      action: expected.action,
    });
  }
});

Deno.test("video infrastructure reads require an owner independently of tenant access and retain registry exposure policy", async () => {
  for (
    const operation of [
      "video.status",
      "video.install.preflight",
      "video.execution.preflight",
    ]
  ) {
    for (
      const options of [
        { role: "administrator" },
        { role: null, tenant: "fixture-tenant" },
      ]
    ) {
      const h = harness({ ...options, rows: [videoRead(operation)] });
      assert.deepEqual(
        (await (await h.request({ action: "list" })).json()).operations,
        [],
      );
      for (const action of ["describe", "execute"]) {
        assert.equal((await h.request({ action, operation })).status, 403);
      }
      assert.equal(h.calls.length, 0);
    }
    const disabled = harness({
      rows: [{ ...videoRead(operation), api_exposed: false }],
    });
    assert.equal(
      (await disabled.request({ action: "execute", operation })).status,
      404,
    );
    assert.equal(disabled.calls.length, 0);
    const apiOnly = harness({
      rows: [{ ...videoRead(operation), ai_exposed: false }],
    });
    const catalogue = await (await apiOnly.request({ action: "list" })).json();
    assert.equal(catalogue.operations[0].ai_exposed, false);
    assert.equal(
      (await apiOnly.request({
        action: "execute",
        channel: "mcp",
        operation,
      })).status,
      403,
    );
    assert.equal(apiOnly.calls.length, 0);
    assert.equal(
      (await apiOnly.request({ action: "execute", operation })).status,
      200,
    );
  }
});

Deno.test("video dispatch refuses registry mutation, scope and handler conflicts and caller action or target overrides", async () => {
  for (
    const [override, expected] of [
      [{ is_mutation: true }, 503],
      [{ permission_scope: "infrastructure:write" }, 503],
      [{ handler: "sandy-operation-api" }, 503],
      [{ handler: "untrusted-provisioner" }, 422],
    ] as [Row, number][]
  ) {
    const h = harness({ rows: [{ ...videoRead(), ...override }] });
    const response = await h.request({
      action: "execute",
      operation: "video.execution.preflight",
    });
    assert.equal(response.status, expected);
    assert.equal((await response.json()).executed, false);
    assert.equal(h.calls.length, 0);
  }
  for (
    const operation of [
      "video.status",
      "video.install.preflight",
      "video.execution.preflight",
    ]
  ) {
    // Even a loosened registry schema cannot select a write action or another VM.
    for (
      const args of [
        { action: "create_video" },
        { target: "other-vm" },
        { job_id: "11111111-2222-4333-8444-555555555555" },
      ]
    ) {
      const h = harness({
        rows: [{ ...videoRead(operation), input_schema: { type: "object" } }],
      });
      const response = await h.request({
        action: "execute",
        operation,
        arguments: args,
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).executed, false);
      assert.equal(h.calls.length, 0);
    }
  }
});

Deno.test("video provider failure and transport failure retain truthful execution outcomes", async () => {
  for (const status of [200, 502]) {
    const h = harness({
      rows: [videoRead()],
      backend: () =>
        Response.json({ ok: false, error: "google_sts_unavailable" }, {
          status,
        }),
    });
    const response = await h.request({
      action: "execute",
      operation: "video.execution.preflight",
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.ok, false);
    assert.equal(body.error, "google_sts_unavailable");
    assert.equal(body.executed, true);
    assert.equal(body.verified, undefined);
    assert.equal(h.calls.length, 1);
  }
  const unavailable = harness({
    rows: [videoRead()],
    backend: () => Promise.reject(new TypeError("network unavailable")),
  });
  const response = await unavailable.request({
    action: "execute",
    operation: "video.execution.preflight",
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.ok, false);
  assert.equal(body.executed, false);
  assert.equal(body.error, "upstream_unavailable");
});

const cancelOperation = {
  ...preflight,
  operation: "deployment.jobs.cancel",
  is_mutation: true,
  verified: true,
  input_schema: {
    type: "object",
    required: ["job_id"],
    properties: { job_id: { type: "string", format: "uuid" } },
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    required: ["ok", "job_id", "state", "already_cancelled"],
    properties: {
      ok: { const: true },
      job_id: { type: "string", format: "uuid" },
      state: { const: "cancelled" },
      already_cancelled: { type: "boolean" },
    },
    additionalProperties: false,
  },
};
const cancelJobId = "11111111-2222-4333-8444-555555555555";
Deno.test("queued cancellation requires a verified exposed contract and owner; binds actor to the actual authenticated identity", async () => {
  for (
    const [entry, role, status] of [
      [{ ...cancelOperation, api_exposed: false }, "owner", 404],
      [{ ...cancelOperation, verified: false }, "owner", 424],
      [cancelOperation, "operator", 403],
    ] as [Row, string, number][]
  ) {
    const h = harness({ rows: [entry], role });
    assert.equal(
      (await h.request({
        action: "execute",
        operation: cancelOperation.operation,
        arguments: { job_id: cancelJobId },
      })).status,
      status,
    );
    assert.equal(h.rpcCalls.length, 0);
  }
  const h = harness({
    rows: [cancelOperation],
    rpcData: {
      ok: true,
      job_id: cancelJobId,
      state: "cancelled",
      already_cancelled: false,
    },
  });
  const response = await h.request({
    action: "execute",
    operation: cancelOperation.operation,
    arguments: { job_id: cancelJobId },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(h.rpcCalls, [{
    name: "sandy_api_cancel_deployment_job",
    args: { p_job_id: cancelJobId, p_actor_id: "controller-test-user" },
  }]);
  assert.equal(h.calls.length, 0);
  assert.equal(
    (await h.request({
      action: "execute",
      operation: cancelOperation.operation,
      arguments: { job_id: cancelJobId, actor_id: "forged-owner" },
    })).status,
    400,
  );
});
Deno.test("cancellation preserves running-job refusal, ownership denial and ambiguous transaction outcomes", async () => {
  for (
    const [error, status] of [["job_not_cancellable", 409], [
      "owner_required",
      403,
    ], ["job_not_found", 404]] as [string, number][]
  ) {
    const h = harness({
      rows: [cancelOperation],
      rpcData: { ok: false, error, http_status: status },
    });
    const response = await h.request({
      action: "execute",
      operation: cancelOperation.operation,
      arguments: { job_id: cancelJobId },
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).executed, false);
  }
  const uncertain = harness({ rows: [cancelOperation], rpcError: true });
  const response = await uncertain.request({
    action: "execute",
    operation: cancelOperation.operation,
    arguments: { job_id: cancelJobId },
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
});
Deno.test("canonical cancellation route rejects actor overrides and uses the registered operation", async () => {
  const h = harness({
    rows: [cancelOperation],
    actorId: "10000000-0000-4000-8000-000000000003",
    rpcHandler: (name) =>
      name === "sandy_api_resolve_job_route"
        ? {
          ok: true,
          job_id: cancelJobId,
          job_kind: "legacy",
          operation: "deployment.jobs.cancel",
        }
        : {
          ok: true,
          job_id: cancelJobId,
          state: "cancelled",
          already_cancelled: true,
        },
  });
  const request = (body: unknown) =>
    h.handler(
      new Request(`https://example.invalid/v1/jobs/${cancelJobId}:cancel`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-user-jwt",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await request({})).status, 200);
  assert.equal((await request({ actor_id: "forged" })).status, 400);
  assert.deepEqual(h.rpcCalls.map((c) => c.name), [
    "sandy_api_resolve_job_route",
    "sandy_api_cancel_deployment_job",
  ]);
});

const retryJobId = "10000000-0000-4000-8000-000000000001";
const retryChildId = "10000000-0000-4000-8000-000000000002";
const retryActorId = "10000000-0000-4000-8000-000000000003";
function canonicalJobRequest(
  jobId: string,
  suffix = "",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`https://local.invalid/v1/jobs/${jobId}${suffix}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: "Bearer actual-user-session",
      "content-type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
Deno.test("durable job URLs resolve the actual principal once and reach existing canonical handlers without legacy fallback", async () => {
  const actions = ["get", "events", "cancel", "retry"] as const;
  const names = [
    "sandy_orch_job",
    "sandy_orch_events_page",
    "sandy_orch_cancel",
    "sandy_orch_retry",
  ];
  for (const [index, action] of actions.entries()) {
    const operation = `orchestration.jobs.${action}`;
    const contract = orchestrationContracts.find((c) =>
      c.operation === operation
    )!;
    assert.ok(contract);
    const h = harness({
      actorId: retryActorId,
      rows: [{
        ...contract,
        handler: "sandy-orchestration-api",
        permission_scope: contract.is_mutation
          ? "orchestration:write"
          : "orchestration:read",
        api_exposed: true,
        ai_exposed: false,
        verified: true,
        output_schema: { type: "object" },
      }],
      rpcHandler: (name, args) => {
        if (name === "sandy_api_resolve_job_route") {
          assert.equal(args.p_actor_id, retryActorId);
          assert.equal(args.p_channel, "api");
          assert.equal(args.p_action, action);
          return {
            ok: true,
            job_id: retryJobId,
            job_kind: "durable",
            operation,
          };
        }
        assert.equal(name, names[index]);
        assert.equal(args.p_actor_id, retryActorId);
        assert.equal(args.p_job_id, retryJobId);
        if (action === "events") {
          assert.deepEqual(args, {
            p_actor_id: retryActorId,
            p_job_id: retryJobId,
            p_after: 14,
            p_limit: 15,
          });
        }
        return { ok: true };
      },
    });
    const response = await h.handler(
      canonicalJobRequest(
        retryJobId,
        action === "events"
          ? "/events?after=14&limit=15"
          : action === "get"
          ? ""
          : `:${action}`,
        ["cancel", "retry"].includes(action) ? {} : undefined,
      ),
    );
    assert.equal(
      response.status,
      action === "retry" ? 202 : 200,
      JSON.stringify(await response.clone().json()),
    );
    assert.equal((await response.json()).operation, operation);
    assert.deepEqual(h.rpcCalls.map((c) => c.name), [
      "sandy_api_resolve_job_route",
      names[index],
    ]);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.identityTokens, ["actual-user-session"]);
  }
});
Deno.test("resolved job reads retain one central admission, grant, request ID and receipt", async () => {
  const admission = "20000000-0000-4000-8000-000000000001";
  const grant = "20000000-0000-4000-8000-000000000002";
  const requestId = "20000000-0000-4000-8000-000000000003";
  const contract = orchestrationContracts.find((c) =>
    c.operation === "orchestration.jobs.get"
  )!;
  const h = harness({
    actorId: retryActorId,
    executionPolicy: true,
    rows: [{
      ...contract,
      handler: "sandy-orchestration-api",
      permission_scope: "orchestration:read",
      api_exposed: true,
      ai_exposed: true,
      verified: false,
      output_schema: { type: "object" },
    }],
    rpcHandler(name, args) {
      switch (name) {
        case "sandy_api_resolve_job_route":
          return {
            ok: true,
            job_id: retryJobId,
            job_kind: "durable",
            operation: "orchestration.jobs.get",
          };
        case "sandy_api_admit_execution":
          assert.equal(args.p_request_id, requestId);
          assert.equal(args.p_actor_id, retryActorId);
          assert.equal(args.p_operation, "orchestration.jobs.get");
          return {
            ok: true,
            allowed: true,
            reused: false,
            admission_id: admission,
            grant_id: grant,
            state: "admitted",
            executed: false,
            expires_at: "2099-01-01T00:00:00Z",
          };
        case "sandy_api_consume_execution_grant":
          assert.equal(args.p_grant_id, grant);
          return {
            ok: true,
            allowed: true,
            reused: false,
            admission_id: admission,
          };
        case "sandy_orch_job":
          return { ok: true };
        case "sandy_api_finish_execution":
          assert.equal(args.p_admission_id, admission);
          return {
            ok: true,
            admission_id: admission,
            state: "succeeded",
            reused: false,
          };
        default:
          throw Error("unexpected RPC");
      }
    },
  });
  const response = await h.handler(
    canonicalJobRequest(retryJobId, "", undefined, {
      "x-sandy-request-id": requestId,
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).admission_id, admission);
  assert.deepEqual(h.rpcCalls.map((c) => c.name), [
    "sandy_api_resolve_job_route",
    "sandy_api_admit_execution",
    "sandy_api_consume_execution_grant",
    "sandy_orch_job",
    "sandy_api_finish_execution",
  ]);
  assert.equal(h.calls.length, 0);
});
Deno.test("job URLs preserve key scope, authenticated non-disclosure and verified rollback dependencies", async () => {
  const keyId = "30000000-0000-4000-8000-000000000001";
  const approval = "30000000-0000-4000-8000-000000000002";
  const source = "30000000-0000-4000-8000-000000000003";
  const badAuth = harness({ actorId: retryActorId, authError: true });
  assert.equal(
    (await badAuth.handler(canonicalJobRequest(retryJobId))).status,
    401,
  );
  assert.equal(badAuth.rpcCalls.length, 0);
  for (
    const error of [
      "job_not_found",
      "ambiguous_job_id",
      "job_rollback_snapshot_required",
    ]
  ) {
    const status = error === "job_not_found"
      ? 404
      : error === "ambiguous_job_id"
      ? 409
      : 424;
    const h = harness({
      actorId: retryActorId,
      rpcData: { ok: false, error, http_status: status },
    });
    const response = await h.handler(
      canonicalJobRequest(
        retryJobId,
        error === "job_rollback_snapshot_required" ? ":rollback" : "",
        error === "job_rollback_snapshot_required"
          ? { compensation_approval_id: approval }
          : undefined,
      ),
    );
    assert.equal(response.status, status);
    assert.equal((await response.json()).executed, false);
    assert.equal(h.rpcCalls.length, 1);
    assert.equal(h.calls.length, 0);
  }
  const key = harness({
    actorId: retryActorId,
    rows: [{
      ...infrastructure("deployment.jobs.get"),
      input_schema: {
        type: "object",
        required: ["job_id"],
        properties: { job_id: { type: "string", format: "uuid" } },
        additionalProperties: false,
      },
    }],
    resolveCredential: async () => ({
      kind: "api_key",
      principalId: retryActorId,
      credentialId: keyId,
      allowedOperations: ["deployment.jobs.get"],
    }),
    rpcHandler(name, args) {
      assert.equal(name, "sandy_api_resolve_job_route");
      assert.equal(args.p_credential_id, keyId);
      assert.deepEqual(args.p_allowed_operations, ["deployment.jobs.get"]);
      return {
        ok: true,
        job_id: retryJobId,
        job_kind: "legacy",
        operation: "deployment.jobs.get",
      };
    },
  });
  assert.equal(
    (await key.handler(canonicalJobRequest(retryJobId))).status,
    200,
  );
  assert.deepEqual(key.identityTokens, []);
  assert.equal(key.calls.length, 1);
  const refused = await key.handler(
    canonicalJobRequest(retryJobId, ":cancel", {}),
  );
  assert.equal(refused.status, 404);
  assert.equal(key.rpcCalls.length, 1);
  const rollback = harness({
    actorId: retryActorId,
    rows: [extensionRow("system.lifecycle.compensate")],
    rpcData: {
      ok: true,
      job_id: retryJobId,
      job_kind: "legacy",
      operation: "system.lifecycle.compensate",
      source_request_id: source,
    },
  });
  const result = await rollback.handler(
    canonicalJobRequest(retryJobId, ":rollback", {
      compensation_approval_id: approval,
    }),
  );
  assert.equal(result.status, 424);
  assert.equal(
    (await result.json()).error,
    "operation_requires_live_verification",
  );
  assert.equal(rollback.rpcCalls.length, 1);
  assert.equal(rollback.calls.length, 0);
  const leased = harness({
    actorId: retryActorId,
    resolveCredential: async () => ({
      kind: "job_lease",
      principalId: retryActorId,
      allowedOperations: ["orchestration.jobs.get"],
      boundExecution: {
        operation: "orchestration.jobs.get",
        arguments: { job_id: retryJobId },
        inputDigest: "0".repeat(64),
        channel: "api",
      },
    }),
  });
  // A leased worker enters only its fixed internal route. A caller cannot use
  // a public job URL to resolve a second job or consume that lease again.
  assert.equal(
    (await leased.handler(canonicalJobRequest(retryJobId))).status,
    403,
  );
  assert.equal(leased.rpcCalls.length, 0);
  assert.equal(leased.calls.length, 0);
});
const retryEntry = {
  ...preflight,
  operation: "deployment.jobs.retry",
  verified: true,
  permission_scope: "deployment:write",
  is_mutation: true,
  input_schema: {
    type: "object",
    required: ["job_id"],
    properties: { job_id: { type: "string", format: "uuid" } },
    additionalProperties: false,
  },
};
const retryReceipt = {
  ok: true,
  accepted: true,
  executed: false,
  request_state: "recorded",
  source_job_id: retryJobId,
  retry_job_id: retryChildId,
  retry_job_status: "approved",
  reused: false,
  retry_depth: 1,
  dispatch_required: true,
};
Deno.test("canonical retry records a receipt through one fixed RPC with authenticated actor", async () => {
  const h = harness({
    rows: [retryEntry],
    actorId: retryActorId,
    rpcHandler: (name) =>
      name === "sandy_api_resolve_job_route"
        ? {
          ok: true,
          job_id: retryJobId,
          job_kind: "legacy",
          operation: "deployment.jobs.retry",
        }
        : retryReceipt,
  });
  const response = await h.handler(
    new Request(`https://local.invalid/v1/jobs/${retryJobId}:retry`, {
      method: "POST",
      headers: {
        authorization: "Bearer user-session",
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.equal(result.accepted, true);
  assert.equal(result.executed, false);
  assert.equal(result.dispatch_required, true);
  assert.equal(result.retry_job_id, retryChildId);
  assert.equal(result.operation, "deployment.jobs.retry");
  assert.deepEqual(h.rpcCalls, [{
    name: "sandy_api_resolve_job_route",
    args: {
      p_actor_id: retryActorId,
      p_job_id: retryJobId,
      p_action: "retry",
      p_channel: "api",
      p_credential_id: null,
      p_allowed_operations: null,
    },
  }, {
    name: "sandy_api_retry_read_deployment_job",
    args: { p_job_id: retryJobId, p_actor_id: retryActorId },
  }]);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.identityTokens, ["user-session"]);
});
Deno.test("retry refuses nonowners, unverified and MCP-disabled mutations before RPC", async () => {
  for (
    const [options, expected] of [
      [{ role: "viewer", rows: [retryEntry] }, 403],
      [{ rows: [{ ...retryEntry, verified: false }] }, 424],
      [{ rows: [{ ...retryEntry, ai_exposed: false }] }, 403],
      [{ rows: [{ ...retryEntry, is_mutation: false }] }, 503],
    ] as const
  ) {
    const h = harness({ ...options, actorId: retryActorId });
    const response = await h.request({
      action: "execute",
      operation: "deployment.jobs.retry",
      arguments: { job_id: retryJobId },
      ...(options.rows?.[0]?.ai_exposed === false ? { channel: "mcp" } : {}),
    });
    assert.equal(response.status, expected);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.calls.length, 0);
  }
});
Deno.test("retry rejects route arguments and preserves ambiguous RPC receipt", async () => {
  const h = harness({
    rows: [retryEntry],
    actorId: retryActorId,
    rpcError: true,
  });
  const invalid = await h.handler(
    new Request(`https://local.invalid/v1/jobs/${retryJobId}:retry`, {
      method: "POST",
      headers: {
        authorization: "Bearer user-session",
        "content-type": "application/json",
      },
      body: '{"actor":"forged"}',
    }),
  );
  assert.equal(invalid.status, 400);
  assert.equal(h.rpcCalls.length, 0);
  const unknown = await h.request({
    action: "execute",
    operation: "deployment.jobs.retry",
    arguments: { job_id: retryJobId },
  });
  assert.equal(unknown.status, 503);
  const body = await unknown.json();
  assert.equal(body.accepted, null);
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
});

Deno.test("discovery omits read contracts that fixed dispatch cannot execute", async () => {
  const rows = [
    {
      ...preflight,
      operation: "video.status",
      handler: "sandy-deploy-provision",
      permission_scope: "infrastructure:read",
    },
    {
      ...preflight,
      operation: "video.install.preflight",
      handler: "sandy-deploy-provision",
      permission_scope: "infrastructure:read",
      is_mutation: true,
    },
    {
      ...preflight,
      operation: "supabase.schema.views.list",
      handler: "sandy-provider-read-api",
      permission_scope: "tenant:write",
    },
    {
      ...preflight,
      operation: "tasks.list",
      handler: "sandy-operations-api",
      permission_scope: "tasks:write",
    },
  ];
  const h = harness({ rows, tenant: "fixture-tenant" });
  const response = await h.request({ action: "list" });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.operations.map((row: Row) => row.operation), [
    "video.status",
  ]);
});

Deno.test("engineering API reads preserve real user context and normalize complete legacy responses", async () => {
  const entry = {
    ...preflight,
    operation: "engineering.change.list",
    handler: "sandy-engineering-control",
  };
  const h = harness({
    rows: [entry],
    backend: () => Response.json({ changes: [] }),
  });
  const response = await h.request({
    action: "execute",
    operation: entry.operation,
    arguments: {},
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.result.ok, true);
  assert.equal(result.result.contract_version, "1.0.0");
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    action: "list",
  });
  assert.equal(
    h.calls[0].url,
    "https://example.supabase.co/functions/v1/sandy-engineering-control",
  );
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    "Bearer test-user-jwt",
  );
  for (const role of ["viewer", null]) {
    const denied = harness({ rows: [entry], role, tenant: "fixture-tenant" });
    assert.equal(
      (await denied.request({
        action: "execute",
        operation: entry.operation,
        arguments: {},
      })).status,
      403,
    );
    assert.equal(denied.calls.length, 0);
  }
});
Deno.test("engineering API read admission rejects action overrides, corrupt contracts and partial responses", async () => {
  const entry = {
    ...preflight,
    operation: "engineering.change.list",
    handler: "sandy-engineering-control",
  };
  for (
    const alteration of [{ is_mutation: true }, {
      permission_scope: "engineering:write",
    }]
  ) {
    const h = harness({ rows: [{ ...entry, ...alteration }] });
    assert.deepEqual(
      (await (await h.request({ action: "list" })).json()).operations,
      [],
    );
    assert.equal(
      (await h.request({
        action: "execute",
        operation: entry.operation,
        arguments: {},
      })).status,
      503,
    );
    assert.equal(h.calls.length, 0);
  }
  const h = harness({
    rows: [entry],
    backend: () => Response.json({ changes: null }),
  });
  const override = await h.request({
    action: "execute",
    operation: entry.operation,
    arguments: { action: "approve_job" },
  });
  assert.equal(override.status, 400);
  assert.equal(h.calls.length, 0);
  const malformed = await h.request({
    action: "execute",
    operation: entry.operation,
    arguments: {},
  });
  assert.equal(malformed.status, 502);
  assert.equal((await malformed.json()).ok, false);
  const unavailable = harness({
    rows: [entry],
    backend: () => {
      throw Error("private diagnostic");
    },
  });
  const unknown = await unavailable.request({
    action: "execute",
    operation: entry.operation,
    arguments: {},
  });
  assert.equal(unknown.status, 502);
  const body = await unknown.json();
  assert.equal(body.executed, null);
  assert.equal(JSON.stringify(body).includes("private diagnostic"), false);
});

Deno.test("delegated API identity never substitutes a transport credential for a customer session", async () => {
  const actor = "20000000-0000-4000-8000-000000000001";
  const read = infrastructure("supabase.functions.list");
  const h = harness({
    actorId: actor,
    rows: [read, preflight],
    resolveCredential: async () => ({
      kind: "api_key",
      principalId: actor,
      allowedOperations: [read.operation, preflight.operation],
    }),
  });
  const listed =
    await (await h.request({ action: "list" }, "Bearer public-anon-transport"))
      .json();
  assert.deepEqual(listed.operations.map((row: Row) => row.operation), [
    read.operation,
  ]);
  const response = await h.request({
    action: "execute",
    operation: read.operation,
    arguments: {},
  }, "Bearer public-anon-transport");
  assert.equal(response.status, 200);
  assert.deepEqual(h.identityTokens, []);
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    "Bearer test-service-credential",
  );
  const userOnly = await h.request({
    action: "execute",
    operation: preflight.operation,
    arguments: {},
  }, "Bearer public-anon-transport");
  assert.equal(userOnly.status, 403);
  assert.equal(
    (await userOnly.json()).error,
    "operation_requires_user_session",
  );
  const denied = await h.request({
    action: "execute",
    operation: "video.status",
    arguments: {},
  }, "Bearer public-anon-transport");
  assert.equal(denied.status, 403);
  assert.equal(h.calls.length, 1);
});
Deno.test("job leases execute only the stored operation and canonical argument digest through the same gateway", async () => {
  const actor = "20000000-0000-4000-8000-000000000001";
  const read = infrastructure("supabase.functions.list");
  const digest =
    "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
  const resolver = async () => ({
    kind: "job_lease" as const,
    principalId: actor,
    allowedOperations: [read.operation],
    boundExecution: {
      operation: read.operation,
      arguments: {},
      inputDigest: digest,
      channel: "api" as const,
    },
  });
  const h = harness({
    actorId: actor,
    rows: [read],
    resolveCredential: resolver,
  });
  const response = await h.handler(
    new Request("https://local.invalid/v1/internal/execute", {
      method: "POST",
      headers: { authorization: "Bearer internal-service" },
      body: '{"operation":"forged","arguments":{"target":"other"}}',
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(h.identityTokens, []);
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    operation: read.operation,
    arguments: {},
  });
  const bad = harness({
    actorId: actor,
    rows: [read],
    resolveCredential: async () => ({
      ...await resolver(),
      boundExecution: {
        operation: read.operation,
        arguments: {},
        channel: "api" as const,
        inputDigest: "0".repeat(64),
      },
    }),
  });
  assert.equal(
    (await bad.handler(
      new Request("https://local.invalid/v1/internal/execute", {
        method: "POST",
        headers: { authorization: "Bearer internal-service" },
        body: "{}",
      }),
    )).status,
    403,
  );
  assert.equal(bad.calls.length, 0);
});
Deno.test("delegated identities recheck current membership and cannot enter through unconfigured resolver", async () => {
  const actor = "20000000-0000-4000-8000-000000000001";
  const read = infrastructure();
  for (const role of [null, "viewer"]) {
    const h = harness({
      actorId: actor,
      role,
      rows: [read],
      resolveCredential: async () => ({
        kind: "api_key",
        principalId: actor,
        allowedOperations: [read.operation],
      }),
    });
    assert.equal(
      (await h.request({
        action: "execute",
        operation: read.operation,
        arguments: {},
      })).status,
      403,
    );
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ rows: [read] });
  const response = await h.handler(
    new Request("https://local.invalid/v1/internal/execute", {
      method: "POST",
      headers: { authorization: "Bearer internal-service" },
      body: "{}",
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.identityTokens, []);
});
Deno.test("all unverified mutations fail closed and discovery declares them nonexecutable", async () => {
  const unverified = { ...release, verified: false };
  const h = harness({ rows: [unverified] });
  const catalogue = await (await h.request({ action: "list" })).json();
  assert.equal(catalogue.operations[0].executable, false);
  const response = await h.request({
    action: "execute",
    operation: unverified.operation,
    arguments: releaseArgs,
  });
  assert.equal(response.status, 424);
  assert.equal(h.calls.length, 0);
});

Deno.test("all newly installed application contracts traverse the same gateway and preserve user grants and verification gates", async () => {
  const actor = "10000000-0000-4000-8000-000000000001";
  const tenant = "10000000-0000-4000-8000-000000000002";
  const contracts: Row[] = [
    ...Object.entries(legacyOperationContracts).map(([operation, c]) => ({
      ...c,
      operation,
    })),
    ...Object.entries(customerOperationContracts).map(([operation, c]) => ({
      ...c,
      operation,
    })),
    ...Object.entries(customerServiceContracts).map(([operation, c]) => ({
      ...c,
      operation,
    })),
    ...Object.entries(policyOperationContracts).map(([operation, c]) => ({
      ...c,
      operation,
      handler: "sandy-operation-api",
    })),
    ...orchestrationContracts.map((c) => ({
      ...c,
      handler: "sandy-orchestration-api",
      permission_scope: c.is_mutation
        ? "orchestration:write"
        : "orchestration:read",
    })),
  ];
  const rows: Row[] = contracts.map((c) => ({
    ...c,
    api_exposed: true,
    ai_exposed: true,
    verified: false,
  }));
  const h = harness({ actorId: actor, tenant, memoryTenant: tenant, rows });
  for (const row of rows) {
    const response = await h.request({
      action: "describe",
      operation: row.operation,
    });
    assert.equal(response.status, 200, String(row.operation));
    const body = await response.json();
    assert.equal(body.operation.operation, row.operation);
    assert.equal(body.operation.executable, row.is_mutation !== true);
  }
  assert.equal(h.calls.length, 0);
  const ownerOnly = harness({ actorId: actor, rows });
  const portalOnly = harness({
    actorId: actor,
    role: null,
    memoryTenant: tenant,
    rows,
  });
  assert.equal(
    (await ownerOnly.request({
      action: "describe",
      operation: "social.people.list",
    })).status,
    403,
  );
  assert.equal(
    (await portalOnly.request({
      action: "describe",
      operation: "controller.overview",
    })).status,
    403,
  );
});

const extensionActor = "10000000-0000-4000-8000-000000000001";
const extensionTenant = "10000000-0000-4000-8000-000000000002";
function extensionRow(operation: string, verified = false): Row {
  const c = extensionContracts[operation];
  assert.ok(c, operation);
  return {
    ...gapContracts[operation],
    ...supplementContracts[operation],
    ...sensitiveContracts[operation],
    ...boundContracts[operation],
    ...commerceOperations[operation],
    ...systemMetadataOperations[operation],
    ...c,
    operation,
    api_exposed: true,
    ai_exposed: true,
    verified,
    error_contract: {
      ...(c.contract_sha256 ? { contract_sha256: c.contract_sha256 } : {}),
      ...(["tenant_consent", "tenant_download"].includes(c.kind)
        ? { requires_real_user_session: true, api_key_delegable: false }
        : {}),
      ...(c.kind === "tenant_lifecycle"
        ? { requires_approval: true, api_key_delegable: false }
        : {}),
      ...([
          "provider_supplement",
          "provider_sensitive",
          "provider_bound",
          "provider_artifact",
          "legacy_owner",
        ]
          .includes(c.kind)
        ? {
          requires_approval: true,
          requires_grant: true,
          ...(c.kind === "legacy_owner"
            ? { requires_real_user_session: true }
            : {}),
          api_key_delegable: false,
        }
        : {}),
      ...(c.kind === "product"
        ? {
          requires_approval:
            productOperations[operation].authorization === "owner" &&
            (productOperations[operation].is_mutation ||
              productOperations[operation].sensitive),
          api_key_delegable: false,
          requires_real_user_session: true,
        }
        : {}),
      ...(c.kind === "commerce"
        ? {
          requires_approval: commerceOperations[operation].requires_approval,
          requires_real_user_session: true,
          api_key_delegable: false,
        }
        : {}),
      ...(c.kind === "composio_customer"
        ? {
          requires_approval: false,
          requires_grant: true,
          requires_real_user_session: true,
          api_key_delegable: false,
        }
        : {}),
      ...(c.kind === "system_metadata"
        ? {
          requires_approval:
            systemMetadataOperations[operation].requires_approval,
          requires_real_user_session: true,
          api_key_delegable: false,
        }
        : {}),
      ...(c.kind === "onboarding"
        ? {
          requires_approval: false,
          requires_real_user_session: true,
          api_key_delegable: false,
        }
        : {}),
    },
  };
}
const productRequestId = "80000000-0000-4000-8000-000000000001";
const productAdmissionId = "80000000-0000-4000-8000-000000000002";
function productResponse(operation: string, patch: Row = {}): Response {
  // Resource fields observed in the actual full-rollback PostgreSQL outputs:
  // product-strict-rollback-evidence.json SHA256 2cff20858d70e6565717f638230283f04bb08c8f89d8f9761178165210a23a00.
  // Only synthetic IDs, dates and request-specific values are normalized here.
  assert.ok(
    [
      "customer.profile.get",
      "product.configuration.providers.get",
      "notifications.templates.create",
    ].includes(operation),
    "strict Product fixture must be explicit",
  );
  const item = operation === "customer.profile.get"
    ? {
      id: extensionTenant,
      display_name: "Product rollback fixture",
      created_at: "2026-10-21T00:00:00Z",
      updated_at: "2026-10-21T00:00:00Z",
    }
    : operation === "product.configuration.providers.get"
    ? {
      provider_key: "openai",
      model_name: "not_configured",
      enabled: false,
      is_default: false,
      created_at: "2026-10-21T00:00:00Z",
      updated_at: "2026-10-21T00:00:00Z",
    }
    : {
      id: productRequestId,
      name: "synthetic_template",
      body_text: "Synthetic text",
      version: 1,
      deleted_at: null,
      created_at: "2026-10-21T00:00:00Z",
      updated_at: "2026-10-21T00:00:00Z",
    };
  return Response.json({
    ok: true,
    operation,
    contract_version: "1.1.0",
    request_id: productRequestId,
    admission_id: productAdmissionId,
    request_state: "observed",
    executed: true,
    result: {
      item,
      items: [],
      changed: operation === "notifications.templates.create",
      next_cursor: null,
      possibly_truncated: false,
      provider_id: null,
      provider_http_status: null,
      delivery_verified: false,
    },
    reconciliation_required: false,
    ...patch,
  });
}
Deno.test("product owner and tenant operations forward only the original confirmed JWT and own their admission once", async () => {
  for (
    const [operation, args] of [
      ["customer.profile.get", {}],
      ["product.configuration.providers.get", { provider_key: "openai" }],
    ] as const
  ) {
    const h = harness({
      actorId: extensionActor,
      memoryTenant: extensionTenant,
      executionPolicy: true,
      rows: [extensionRow(operation)],
      backend: (_url, init) => {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer test-user-jwt");
        assert.equal(headers.get("apikey"), "test-anon-key");
        assert.deepEqual(JSON.parse(String(init?.body)), {
          operation,
          arguments: args,
          channel: "mcp",
          request_id: productRequestId,
        });
        return productResponse(operation);
      },
    });
    const response = await h.request(
      { action: "execute", operation, arguments: args, channel: "mcp" },
      undefined,
      { "x-sandy-request-id": productRequestId },
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(h.calls.length, 1);
    assert.equal(
      h.calls[0].url,
      "https://example.supabase.co/functions/v1/sandy-product-service-api",
    );
    assert.equal(
      h.rpcCalls.length,
      0,
      "product owns admission; no second gateway reservation/consume",
    );
  }
});
Deno.test("product mutation keeps exact request and approval metadata without introducing actor or tenant fields", async () => {
  const operation = "notifications.templates.create";
  const approval = "80000000-0000-4000-8000-000000000003";
  const args = {
    name: "synthetic_template",
    body_text: "Synthetic text",
    idempotency_key: productRequestId,
  };
  const h = harness({
    actorId: extensionActor,
    memoryTenant: extensionTenant,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    backend: (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        operation,
        arguments: args,
        channel: "api",
        request_id: productRequestId,
        approval_id: approval,
      });
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-user-jwt",
      );
      return productResponse(operation, {
        request_state: "accepted",
        reconciliation_required: true,
      });
    },
  });
  const response = await h.request(
    { action: "execute", operation, arguments: args },
    undefined,
    { "x-sandy-request-id": productRequestId, "x-sandy-approval-id": approval },
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(h.calls.length, 1);
});
Deno.test("product positive replay preserves false or unknown execution and reconciliation instead of inventing dispatch", async () => {
  for (const executed of [false, null]) {
    const operation = "customer.profile.get";
    const h = harness({
      actorId: extensionActor,
      memoryTenant: extensionTenant,
      role: null,
      rows: [extensionRow(operation)],
      backend: () =>
        productResponse(operation, {
          request_state: "replayed",
          executed,
          reconciliation_required: true,
        }),
    });
    const response = await h.request({
      action: "execute",
      operation,
      arguments: {},
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.executed, executed);
    assert.equal(payload.reconciliation_required, true);
    assert.equal(payload.request_state, "replayed");
    assert.equal(payload.result.executed, executed);
  }
});
Deno.test("product malformed JSON and non-object responses preserve unknown execution", async () => {
  for (const upstream of ["not-json", "null", "[]"]) {
    const operation = "customer.profile.get";
    const h = harness({
      actorId: extensionActor,
      memoryTenant: extensionTenant,
      role: null,
      rows: [extensionRow(operation)],
      backend: () => new Response(upstream),
    });
    const response = await h.request({
      action: "execute",
      operation,
      arguments: {},
    });
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.executed, null);
    assert.equal(payload.reconciliation_required, true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.rpcCalls.length, 0);
  }
});
Deno.test("product output schema mismatch cannot assert execution", async () => {
  const operation = "customer.profile.get";
  const h = harness({
    actorId: extensionActor,
    memoryTenant: extensionTenant,
    role: null,
    rows: [extensionRow(operation)],
    backend: () => productResponse(operation, { result: "invalid" }),
  });
  const response = await h.request({
    action: "execute",
    operation,
    arguments: {},
  });
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, "upstream_output_schema_mismatch");
  assert.equal(payload.executed, null);
  assert.equal(payload.reconciliation_required, true);
});
Deno.test("product HTTP200 refusal cannot assert execution from an untyped envelope", async () => {
  const operation = "customer.profile.get";
  const h = harness({
    actorId: extensionActor,
    memoryTenant: extensionTenant,
    role: null,
    rows: [extensionRow(operation)],
    backend: () =>
      productResponse(operation, {
        ok: false,
        error: "synthetic_refusal",
        executed: true,
        reconciliation_required: false,
      }),
  });
  const response = await h.request({
    action: "execute",
    operation,
    arguments: {},
  });
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, "synthetic_refusal");
  assert.equal(payload.executed, null);
  assert.equal(payload.reconciliation_required, true);
});
Deno.test("product grants and sensitivity cannot be weakened by Controller privilege, unconfirmed sessions or contract flag drift", async () => {
  const portalOperation = "customer.profile.get",
    ownerOperation = "graph.messages.search";
  for (
    const [options, operation] of [
      [{ role: "owner" }, portalOperation],
      [{ role: null, memoryTenant: extensionTenant }, ownerOperation],
      [
        { role: null, memoryTenant: extensionTenant, emailConfirmed: false },
        portalOperation,
      ],
    ] as const
  ) {
    const h = harness({
      ...options,
      actorId: extensionActor,
      rows: [extensionRow(operation, true)],
    });
    assert.equal(
      (await h.request({ action: "describe", operation })).status,
      403,
    );
    assert.equal(h.calls.length, 0);
    assert.equal(h.rpcCalls.length, 0);
  }
  const bad = extensionRow(ownerOperation, true);
  (bad.error_contract as Row).requires_approval = false;
  const h = harness({
    actorId: extensionActor,
    memoryTenant: extensionTenant,
    rows: [bad],
  });
  assert.equal(
    (await h.request({
      action: "execute",
      operation: ownerOperation,
      arguments: { query: "synthetic" },
    })).status,
    503,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.rpcCalls.length, 0);
});
Deno.test("unverified sensitive product reads and tenant exports are unavailable before any downstream request", async () => {
  for (
    const [operation, args] of [
      ["graph.messages.get", { message_id: productRequestId }],
      ["supabase.tenant.exports.download", { snapshot_id: productRequestId }],
    ] as const
  ) {
    const h = harness({
      actorId: extensionActor,
      memoryTenant: extensionTenant,
      rows: [extensionRow(operation)],
      authenticatedDb: () => {
        throw Error("must not obtain session");
      },
    });
    assert.equal(
      (await h.request({ action: "execute", operation, arguments: args }))
        .status,
      424,
    );
    assert.equal(h.calls.length, 0);
    assert.equal(h.rpcCalls.length, 0);
  }
});
Deno.test("tenant export download uses only the original actual-user RPC and never a Controller or service session", async () => {
  const operation = "supabase.tenant.exports.download",
    calls: Row[] = [],
    tokens: string[] = [];
  const h = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    rows: [extensionRow(operation, true)],
    authenticatedDb: (token) => {
      tokens.push(token);
      return {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return {
            error: null,
            data: {
              ok: true,
              snapshot_id: productRequestId,
              snapshot_sha256: "a".repeat(64),
              file_name: `sandy-tenant-links-${productRequestId}.json`,
              export: {
                format_version: "1.0.0",
                tenant_id: extensionTenant,
                manifest: tenantManifest.id,
                manifest_sha256: tenantManifest.manifest_sha256,
                schema_sha256: tenantManifest.schema_sha256,
                complete_tenant_coverage: false,
                external_provider_assets_included: false,
                tables: Object.fromEntries(
                  tenantManifest.tables.map((t) => [t.table, []]),
                ),
              },
            },
          };
        },
      };
    },
  });
  const response = await h.request({
    action: "execute",
    operation,
    arguments: { snapshot_id: productRequestId },
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(tokens, ["test-user-jwt"]);
  assert.deepEqual(calls, [{
    name: "sandy_tenant_export_download",
    args: { p_snapshot: productRequestId },
  }]);
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(h.calls.length, 0);
});
Deno.test("tenant lifecycle backend consumes and finishes the gateway owner grant exactly once", async () => {
  const operation = "supabase.tenant.exports.get",
    grant = "80000000-0000-4000-8000-000000000004";
  let consumed = 0, finished = 0, sqlCalls = 0;
  const backend = createTenantLifecycleHandler({
    service: "test-service-credential",
    projectUrl: "https://zmqlyygzqoidkcwdysok.supabase.co",
    authorizeContext: async () => ({ allowed: true }),
    consumeGrant: async (input) => {
      consumed++;
      assert.equal(input.grant_id, grant);
      assert.equal(
        input.scope_sha256,
        await argumentDigest(tenantLifecycleScope),
      );
      return { allowed: true, reused: false, admission_id: productAdmissionId };
    },
    finishExecution: async (input) => {
      finished++;
      assert.equal(input.outcome, "succeeded");
      return { allowed: true };
    },
    rpc: async (name, args) => {
      sqlCalls++;
      assert.equal(name, "sandy_tenant_lifecycle_execute");
      assert.equal(args.p_actor, extensionActor);
      return {
        error: null,
        status: 200,
        data: {
          ok: true,
          reused: false,
          result: {
            snapshot_id: productRequestId,
            tenant_id: extensionTenant,
            manifest: tenantManifest.id,
            manifest_sha256: tenantManifest.manifest_sha256,
            schema_sha256: tenantManifest.schema_sha256,
            snapshot_sha256: "a".repeat(64),
            state: "exported",
            created_at: "2026-10-21T00:00:00Z",
            expires_at: "2026-10-22T00:00:00Z",
            row_counts: Object.fromEntries(
              tenantManifest.tables.map((t) => [t.table, 0]),
            ),
            complete_tenant_coverage: false,
            external_provider_assets_included: false,
          },
        },
      };
    },
  });
  const h = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    rpcHandler: (name) => {
      assert.equal(name, "sandy_api_admit_execution");
      return {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: productAdmissionId,
        grant_id: grant,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    },
    backend: (url, init) => backend(new Request(url, init)),
  });
  const response = await h.request({
    action: "execute",
    operation,
    arguments: { tenant_id: extensionTenant, snapshot_id: productRequestId },
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual([consumed, finished, sqlCalls], [1, 1, 1]);
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.calls.length, 1);
});
Deno.test("all 567 service extensions are installed with their exact contracts and truthful readiness", async () => {
  assert.equal(Object.keys(extensionContracts).length, 567);
  assert.equal(
    new Set(installedOperationIds).size,
    installedOperationIds.length,
  );
  assert.ok(Object.isFrozen(installedOperationIds));
  const rows = Object.keys(extensionContracts).map((op) => extensionRow(op));
  const h = harness({
    actorId: extensionActor,
    tenant: extensionTenant,
    memoryTenant: extensionTenant,
    rows,
  });
  for (const row of rows) {
    const response = await h.request({
      action: "describe",
      operation: row.operation,
    });
    assert.equal(response.status, 200, String(row.operation));
    const payload = await response.json();
    const closed = row.is_mutation === true ||
      [
        "guest",
        "database",
        "credential",
        "supabase_service",
        "tenant_lifecycle",
        "tenant_download",
        "provider_supplement",
        "provider_sensitive",
        "provider_bound",
        "provider_artifact",
        "system_metadata",
        "legacy_owner",
        "composio_customer",
      ].includes(
        String(row.kind),
      ) ||
      (row.kind === "provider_gap" && row.requires_grant === true) ||
      (row.kind === "product" &&
        productOperations[String(row.operation)].sensitive) ||
      (row.kind === "commerce" &&
        commerceOperations[String(row.operation)].sensitive);
    assert.equal(payload.operation.executable, !closed, String(row.operation));
    assert.equal(payload.operation.handler, row.handler);
  }
  assert.equal(h.calls.length, 0);
});
Deno.test("scalar gateway admission uses its exact manifest scope before one private backend dispatch", async () => {
  const operation = "supabase.tenant.manifests.exports.get";
  const h = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    rpcHandler: async (name, args) => {
      assert.equal(name, "sandy_api_admit_execution");
      assert.equal(
        args.p_scope_sha256,
        await argumentDigest(scalarManifestScope),
      );
      return {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: productAdmissionId,
        grant_id: productRequestId,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    },
    backend: (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.operation, operation);
      assert.equal(body.actor_id, extensionActor);
      assert.equal(body.tenant_id, null);
      assert.equal(body.admission_id, productAdmissionId);
      return Response.json({
        ok: false,
        error: "synthetic_refusal",
        executed: false,
      }, { status: 424 });
    },
  });
  assert.equal(
    (await h.request({
      action: "execute",
      operation,
      arguments: { tenant_id: extensionTenant, snapshot_id: productRequestId },
    })).status,
    424,
  );
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.calls.length, 1);
});
Deno.test("MCP content and financial discovery and exact artifact download execute through API with the actual customer JWT", async () => {
  for (
    const [family, manifest] of [["content", contentManifest], [
      "financial",
      financialManifest,
    ]] as const
  ) {
    const downloadOperation = `supabase.tenant.${family}.exports.download`;
    const availableOperation = `supabase.tenant.${family}.exports.available`;
    const artifact = {
      manifest: manifest.id,
      manifest_sha256: manifest.manifest_sha256,
      tenant_id: extensionTenant,
      table: family === "content"
        ? "sandy_knowledge_documents"
        : "sandy_commerce_entry_lines",
      sequence: 0,
      table_sequence: 0,
      table_complete: true,
      table_row_count: 1,
      table_row_chain_sha256: "a".repeat(64),
      json_fragment: '{"title":"🍋 synthetic content"}\n',
      snapshot_id: productRequestId,
      schema_sha256: manifest.schema_sha256,
      complete_tenant_coverage: false,
      external_provider_assets_included: false,
    };
    const download = {
      ok: true,
      snapshot_id: productRequestId,
      sequence: 0,
      artifact_json: canonicalJson(artifact),
      artifact_sha256: await argumentDigest(artifact),
    };
    const available = {
      ok: true,
      offset: 0,
      limit: 1,
      total_count: 1,
      next_offset: null,
      items: [{
        snapshot_id: productRequestId,
        tenant_id: extensionTenant,
        manifest: manifest.id,
        manifest_sha256: manifest.manifest_sha256,
        schema_sha256: manifest.schema_sha256,
        fragment_count: manifest.tables.length,
        row_counts: Object.fromEntries(
          manifest.tables.map((t) => [t.table, 0]),
        ),
        total_plaintext_bytes: 0,
        artifact_index_sha256: "a".repeat(64),
        state: "exported",
        created_at: "2026-10-21T00:00:00Z",
        expires_at: "2026-10-22T00:00:00Z",
        complete_tenant_coverage: false,
        external_provider_assets_included: false,
        erasure_supported: false,
        restore_supported: false,
        ...(family === "financial"
          ? {
            financial_source: "internal_commerce_records",
            provider_verified: false,
            payment_executed: false,
          }
          : {}),
      }],
    };
    const tokens: string[] = [], calls: Row[] = [];
    const h = harness({
      actorId: extensionActor,
      role: null,
      memoryTenant: extensionTenant,
      executionPolicy: true,
      rows: [
        extensionRow(downloadOperation, true),
        extensionRow(availableOperation, true),
      ],
      authenticatedDb: (token) => {
        tokens.push(token);
        return {
          rpc: async (name, args) => {
            calls.push({ name, args });
            return {
              error: null,
              data: name === `sandy_tenant_${family}_fragment_download`
                ? download
                : available,
            };
          },
        };
      },
    });
    const transport = createHandler(
      createApi(
        "https://example.supabase.co",
        "test-anon-key",
        ((url, init) => h.handler(new Request(url, init))) as typeof fetch,
      ),
    );
    for (
      const [operation, args, expected] of [
        [
          downloadOperation,
          { snapshot_id: productRequestId, sequence: 0 },
          download,
        ],
        [availableOperation, { offset: 0, limit: 1 }, available],
      ] as const
    ) {
      const response = await transport(
        new Request("https://mcp.fixture.invalid", {
          method: "POST",
          headers: {
            authorization: "Bearer test-user-jwt",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: operation, arguments: args },
          }),
        }),
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.result.isError, false, JSON.stringify(body));
      assert.deepEqual(body.result.structuredContent, expected);
    }
    assert.deepEqual(tokens, ["test-user-jwt", "test-user-jwt"]);
    assert.deepEqual(calls.map((c) => c.name), [
      `sandy_tenant_${family}_fragment_download`,
      `sandy_tenant_${family}_exports_available`,
    ]);
    assert.deepEqual([h.calls.length, h.rpcCalls.length], [0, 0]);
  }
});
Deno.test("provider supplement composes the actual executor with one owner grant and filtered provider read", async () => {
  const operation = "gcp.projects.search_filtered";
  let consumed = 0, finished = 0, reads = 0;
  const backend = createSupplementHandler({
    service: "test-service-credential",
    authorizeContext: async () => ({ allowed: true }),
    consumeGrant: async (input) => {
      consumed++;
      assert.equal(input.actor_id, extensionActor);
      assert.equal(input.grant_id, productRequestId);
      return { allowed: true, admission_id: productAdmissionId, reused: false };
    },
    finishExecution: async (input) => {
      finished++;
      assert.equal(input.outcome, "succeeded");
      return { allowed: true };
    },
    credentialForExecution: async () => "synthetic-provider-token",
    saveOpaque: async () => {
      throw Error("No cursor expected");
    },
    takeOpaque: async () => {
      throw Error("No cursor expected");
    },
    fetch: (async (input, init) => {
      reads++;
      const url = new URL(String(input));
      assert.equal(url.origin, "https://cloudresourcemanager.googleapis.com");
      assert.equal(url.pathname, "/v3/projects:search");
      assert.equal(
        url.searchParams.get("query"),
        "projectId:elaborate-haven-511518-a5",
      );
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer synthetic-provider-token",
      );
      return Response.json({
        projects: [
          {
            name: "projects/1030223524306",
            projectId: "elaborate-haven-511518-a5",
            displayName: "Synthetic project",
            state: "ACTIVE",
          },
          {
            name: "projects/999",
            projectId: "foreign-project",
            displayName: "must-not-expose",
          },
        ],
      });
    }) as typeof fetch,
  });
  const h = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    rpcHandler: (name) => {
      assert.equal(name, "sandy_api_admit_execution");
      return {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: productAdmissionId,
        grant_id: productRequestId,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    },
    backend: (url, init) => {
      assert.equal(
        url,
        "https://example.supabase.co/functions/v1/sandy-provider-supplement-api",
      );
      return backend(new Request(url, init));
    },
  });
  const response = await h.request({
    action: "execute",
    operation,
    arguments: {},
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.text()).includes("must-not-expose"), false);
  assert.deepEqual([
    consumed,
    finished,
    reads,
    h.rpcCalls.length,
    h.calls.length,
  ], [1, 1, 1, 1, 1]);
});
Deno.test("supplement approval flags and normal-user owner identity cannot be weakened", async () => {
  const operation = "gcp.projects.search_filtered";
  for (
    const patch of [{ requires_approval: false }, { api_key_delegable: true }, {
      requires_grant: false,
    }]
  ) {
    const row = extensionRow(operation, true);
    row.error_contract = { ...(row.error_contract as Row), ...patch };
    const h = harness({ actorId: extensionActor, rows: [row] });
    assert.equal(
      (await h.request({ action: "execute", operation, arguments: {} })).status,
      503,
    );
    assert.deepEqual([h.calls.length, h.rpcCalls.length], [0, 0]);
  }
  const h = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    rows: [extensionRow(operation, true)],
  });
  assert.equal(
    (await h.request({ action: "execute", operation, arguments: {} })).status,
    403,
  );
  assert.deepEqual([h.calls.length, h.rpcCalls.length], [0, 0]);
});
Deno.test("supplement discovery and execution require the same verified server parent binding", async () => {
  const operation = "gcp.projects.list_filtered";
  const h = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
  });
  const described = await h.request({ action: "describe", operation });
  const body = await described.json();
  assert.equal(body.operation.executable, false);
  assert.equal(
    body.operation.unavailable_reason,
    "verified_organization_scope_binding_required",
  );
  assert.equal(
    (await h.request({ action: "execute", operation, arguments: {} })).status,
    424,
  );
  assert.deepEqual([h.calls.length, h.rpcCalls.length], [0, 0]);
});
Deno.test("private provider captures use one exact owner grant and never return captured bytes", async () => {
  const operation = "gcp.compute.instances.get_guest_attributes.capture";
  const now = Date.parse("2026-10-21T01:00:00Z");
  let consumed = 0, finished = 0, reads = 0, custody = 0;
  const scopeSha = await argumentDigest(sensitiveExecutionScope(operation));
  const backend = createSensitiveHandler({
    service: "test-service-credential",
    now: () => now,
    authorizeContext: async () => ({ allowed: true }),
    consumeGrant: async (input) => {
      consumed++;
      assert.equal(input.actor_id, extensionActor);
      assert.equal(input.grant_id, productRequestId);
      assert.equal(input.scope_sha256, scopeSha);
      return { allowed: true, admission_id: productAdmissionId, reused: false };
    },
    finishExecution: async (input) => {
      finished++;
      assert.equal(input.outcome, "succeeded");
      return { allowed: true };
    },
    credentialForExecution: async () => "synthetic-provider-token",
    saveOpaque: async (input) => {
      custody++;
      assert.equal(input.actor, extensionActor);
      assert.equal(input.operation, operation);
      assert.equal(input.kind, "artifact");
      return {
        custody_id: productRequestId,
        byte_length: input.byte_length,
        sha256: input.payload_sha256,
        media_type: input.media_type,
        expires_at: new Date(now + 5 * 60000).toISOString(),
      };
    },
    takeOpaque: async () => {
      throw Error("No cursor or public retrieval expected");
    },
    fetch: (async (input, init) => {
      reads++;
      const url = new URL(String(input));
      assert.equal(url.origin, "https://compute.googleapis.com");
      assert.ok(
        url.pathname.includes(
          "/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/fixture/",
        ),
      );
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer synthetic-provider-token",
      );
      return Response.json({
        kind: "compute#guestAttributes",
        queryValue: {
          items: [
            {
              namespace: "fixture",
              key: "fixture",
              value: "PRIVATE_FIXTURE_MUST_NOT_RETURN",
            },
          ],
        },
      });
    }) as typeof fetch,
  });
  const h = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    rpcHandler: (name, args) => {
      assert.equal(name, "sandy_api_admit_execution");
      assert.equal(args.p_scope_sha256, scopeSha);
      return {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: productAdmissionId,
        grant_id: productRequestId,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    },
    backend: (url, init) => {
      assert.equal(
        url,
        "https://example.supabase.co/functions/v1/sandy-provider-sensitive-api",
      );
      return backend(new Request(url, init));
    },
  });
  const response = await h.request({
    action: "execute",
    operation,
    arguments: { resource: "fixture" },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const text = await response.text();
  assert.equal(text.includes("PRIVATE_FIXTURE_MUST_NOT_RETURN"), false);
  assert.equal(text.includes("synthetic-provider-token"), false);
  assert.deepEqual([
    consumed,
    finished,
    reads,
    custody,
    h.rpcCalls.length,
    h.calls.length,
  ], [1, 1, 1, 1, 1, 1]);
});
Deno.test("private capture reads retain closed verification and immutable approval metadata before admission", async () => {
  const operation = "gcp.compute.instances.get_guest_attributes.capture";
  const closed = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation)],
  });
  assert.equal(
    (await closed.request({
      action: "execute",
      operation,
      arguments: { resource: "fixture" },
    })).status,
    424,
  );
  assert.deepEqual([closed.calls.length, closed.rpcCalls.length], [0, 0]);
  for (
    const patch of [{ requires_approval: false }, { api_key_delegable: true }, {
      requires_grant: false,
    }]
  ) {
    const row = extensionRow(operation, true);
    row.error_contract = { ...(row.error_contract as Row), ...patch };
    const h = harness({
      actorId: extensionActor,
      executionPolicy: true,
      rows: [row],
    });
    assert.equal(
      (await h.request({
        action: "execute",
        operation,
        arguments: { resource: "fixture" },
      })).status,
      503,
    );
    assert.deepEqual([h.calls.length, h.rpcCalls.length], [0, 0]);
  }
});
Deno.test("commerce owner and customer calls retain the original JWT and exactly one backend-owned admission", async () => {
  for (
    const [operation, args] of [
      ["commerce.configuration.get", {}],
      ["commerce.accounts.create", {
        code: "cash",
        name: "Synthetic cash",
        kind: "asset",
        idempotency_key: productRequestId,
      }],
      ["commerce.plans.list", {}],
    ] as const
  ) {
    const owner = commerceOperations[operation].authorization === "owner";
    const approval = "80000000-0000-4000-8000-000000000003";
    const calls: string[] = [];
    const backend = createCommerceHandler({
      base: "https://example.supabase.co",
      anon: "test-anon-key",
      service: "test-service-credential",
      fetch: (() => {
        throw Error("No provider calls expected");
      }) as typeof fetch,
      authenticate: async (token) => {
        assert.equal(token, "test-user-jwt");
        return { id: extensionActor, emailConfirmed: true };
      },
      rpc: async (name, parameters, token) => {
        calls.push(name);
        assert.equal(token, "test-user-jwt");
        if (name === "sandy_commerce_admit") {
          assert.equal(parameters.p_operation, operation);
          assert.deepEqual(parameters.p_arguments, args);
          assert.equal(parameters.p_canonical_arguments, canonicalJson(args));
          assert.equal(parameters.p_request_id, productRequestId);
          assert.equal(parameters.p_channel, "mcp");
          assert.equal(parameters.p_approval_id, owner ? approval : null);
          return {
            ok: true,
            allowed: true,
            reused: false,
            admission_id: productAdmissionId,
            grant_id: productRequestId,
          };
        }
        assert.equal(name, "sandy_commerce_execute");
        return {
          ok: true,
          admission_id: productAdmissionId,
          request_id: productRequestId,
          request_state: commerceOperations[operation].is_mutation
            ? "accepted"
            : "observed",
          executed: true,
          reconciliation_required: commerceOperations[operation].is_mutation,
          result: {
            item: operation === "commerce.configuration.get"
              ? { configured: false, version: 0, processor: null }
              : operation === "commerce.accounts.create"
              ? {
                id: productRequestId,
                code: "cash",
                name: "Synthetic cash",
                kind: "asset",
                currency: "NZD",
                minor_unit_exponent: 2,
                active: true,
                version: 1,
                created_at: "2026-10-21T00:00:00Z",
                updated_at: "2026-10-21T00:00:00Z",
              }
              : null,
            items: [],
            changed: operation === "commerce.accounts.create",
            next_cursor: null,
            possibly_truncated: false,
            source: "internal_commerce_records",
            payment_executed: false,
            provider_verified: false,
          },
        };
      },
    });
    const h = harness({
      actorId: extensionActor,
      role: owner ? "owner" : null,
      memoryTenant: owner ? null : extensionTenant,
      executionPolicy: true,
      rows: [extensionRow(operation, true)],
      backend: (url, init) => {
        assert.equal(
          url,
          "https://example.supabase.co/functions/v1/sandy-commerce-ledger-api",
        );
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer test-user-jwt",
        );
        const body = JSON.parse(String(init?.body));
        assert.equal(Object.hasOwn(body, "actor_id"), false);
        assert.equal(Object.hasOwn(body, "tenant_id"), false);
        return backend(new Request(url, init));
      },
    });
    const response = await h.request(
      { action: "execute", operation, arguments: args, channel: "mcp" },
      undefined,
      {
        "x-sandy-request-id": productRequestId,
        ...(owner ? { "x-sandy-approval-id": approval } : {}),
      },
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(calls, ["sandy_commerce_admit", "sandy_commerce_execute"]);
    assert.deepEqual([h.rpcCalls.length, h.calls.length], [0, 1]);
  }
});
Deno.test("commerce untrusted replies cannot invent execution and closed sensitive reads cannot dispatch", async () => {
  const operation = "commerce.configuration.get";
  const h = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    backend: () => new Response("not-json"),
  });
  const response = await h.request({
    action: "execute",
    operation,
    arguments: {},
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
  assert.equal(h.rpcCalls.length, 0);
  const closed = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    executionPolicy: true,
    rows: [extensionRow(operation)],
  });
  assert.equal(
    (await closed.request({ action: "execute", operation, arguments: {} }))
      .status,
    424,
  );
  assert.deepEqual([closed.calls.length, closed.rpcCalls.length], [0, 0]);
});
Deno.test("recovery consent getter and setter retain all73 explicit choices through the actual customer JWT", async () => {
  const setter = "supabase.tenant.consent.set",
    getter = "supabase.tenant.consent.get";
  const schema = extensionContracts[setter].input_schema as {
    properties: { operations: { items: { enum: string[] } } };
  };
  const operations = schema.properties.operations.items.enum;
  assert.equal(operations.length, 73);
  const policy = {
    ok: true,
    tenant_id: extensionTenant,
    operations,
    approved_emails: [],
    allow_erasure: false,
    expires_at: "2026-10-22T00:00:00Z",
    revision: 1,
    legal_hold: false,
    retention_until: null,
  };
  const calls: Row[] = [], tokens: string[] = [];
  const h = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    rows: [extensionRow(setter, true), extensionRow(getter, true)],
    executionPolicy: true,
    authenticatedDb: (token) => {
      tokens.push(token);
      return {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: policy, error: null };
        },
      };
    },
  });
  for (
    const [operation, args] of [[setter, {
      operations,
      approved_emails: [],
      allow_erasure: false,
      expires_at: policy.expires_at,
    }], [getter, {}]] as const
  ) {
    const response = await h.request({
      action: "execute",
      operation,
      arguments: args,
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual((await response.json()).result.operations, operations);
  }
  assert.deepEqual(tokens, ["test-user-jwt", "test-user-jwt"]);
  assert.deepEqual(calls.map((c) => c.name), [
    "sandy_supabase_tenant_consent_set",
    "sandy_supabase_tenant_consent_get",
  ]);
  assert.deepEqual([h.calls.length, h.rpcCalls.length], [0, 0]);
});
Deno.test("media capacity accepts one MiB base64 envelope and rejects oversized bodies before admission", async () => {
  const operation = "gcp.storage.objects.upload.media";
  const h = harness({
    actorId: extensionActor,
    rows: [extensionRow(operation)],
    executionPolicy: true,
  });
  const args = {
    bucket: "synthetic-bucket",
    object_name: "synthetic.bin",
    if_generation_match: "0",
    content_base64: "AAAA".repeat(349525) + "AA==",
    sha256: "a".repeat(64),
    media_type: "application/octet-stream",
  };
  const response = await h.request({
    action: "execute",
    operation,
    arguments: args,
  });
  assert.equal(response.status, 424, await response.clone().text());
  const overflow = await h.request({
    action: "execute",
    operation,
    arguments: { ...args, content_base64: "x".repeat(1550000) },
  });
  assert.equal(overflow.status, 413);
  assert.deepEqual([h.calls.length, h.rpcCalls.length], [0, 0]);
});
Deno.test("new owner service and provider-gap operations retain verified approval and real-user boundaries", async () => {
  const ownerOps = [
    "supabase.auth.users.list",
    "supabase.logs.query",
    "supabase.orgs.list",
  ];
  const rows = ownerOps.map((op) => extensionRow(op));
  const portal = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    rows,
  });
  for (const operation of ownerOps) {
    assert.equal(
      (await portal.request({ action: "describe", operation })).status,
      403,
    );
  }
  const owner = harness({ actorId: extensionActor, rows });
  assert.equal(
    (await owner.request({
      action: "execute",
      operation: "supabase.auth.users.list",
      arguments: { tenant_id: extensionTenant },
    })).status,
    424,
  );
  assert.equal(owner.calls.length, 0);
  assert.equal(owner.rpcCalls.length, 0);
  for (const kind of ["api_key", "job_lease"] as const) {
    const delegated = harness({
      actorId: extensionActor,
      rows,
      resolveCredential: async () => ({
        kind,
        principalId: extensionActor,
        allowedOperations: ["supabase.orgs.list"],
      }),
    });
    assert.equal(
      (await delegated.request({
        action: "execute",
        operation: "supabase.orgs.list",
        arguments: {},
      })).status,
      403,
    );
    assert.equal(delegated.calls.length, 0);
  }
});
Deno.test("owner Supabase service composes its actual handler with one admission and one owned grant/receipt", async () => {
  const operation = "supabase.auth.users.get",
    admission = "60000000-0000-4000-8000-000000000001",
    grant = "60000000-0000-4000-8000-000000000002",
    target = "60000000-0000-4000-8000-000000000003";
  let consumed = 0, finished = 0, providerReads = 0;
  const backend = createServiceHandler({
    service: "test-service-credential",
    projectUrl: "https://zmqlyygzqoidkcwdysok.supabase.co",
    client: {
      auth: {
        admin: {
          getUserById: async (id: string) => {
            assert.equal(id, target);
            providerReads++;
            return {
              data: {
                user: {
                  id: target,
                  email: "fixture@example.invalid",
                  user_metadata: { private_field: "must not expose" },
                },
              },
              error: null,
            };
          },
        },
      },
    } as unknown as ServiceDependencies["client"],
    authorizeContext: async (context, contract) => {
      assert.equal(context.actor_id, extensionActor);
      assert.equal(context.tenant_id, null);
      assert.equal(context.credential_id, null);
      assert.equal(contract.operation, operation);
      return { allowed: true };
    },
    consumeGrant: async (value) => {
      consumed++;
      assert.equal(value.grant_id, grant);
      assert.equal(
        value.input_sha256,
        await argumentDigest({ tenant_id: extensionTenant, user_id: target }),
      );
      return { allowed: true, reused: false, admission_id: admission };
    },
    finishExecution: async (value) => {
      finished++;
      assert.equal(value.admission_id, admission);
      assert.equal(value.outcome, "succeeded");
      return { allowed: true };
    },
    rpc: async (name, args) => {
      assert.equal(name, "sandy_supabase_service_authorize");
      assert.equal(args.p_actor, extensionActor);
      assert.equal(args.p_admission, admission);
      return {
        data: {
          ok: true,
          bucket_id: `sandy-service-v1-tenant-${extensionTenant}`,
          user_ids: [target],
        },
        error: null,
      };
    },
  });
  const h = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    rpcHandler(name) {
      assert.equal(name, "sandy_api_admit_execution");
      return {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: admission,
        grant_id: grant,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    },
    backend: (url, init) => {
      assert.equal(
        url,
        "https://example.supabase.co/functions/v1/sandy-supabase-service-api",
      );
      return backend(new Request(url, init));
    },
  });
  const result = await h.request({
    action: "execute",
    operation,
    arguments: { tenant_id: extensionTenant, user_id: target },
  });
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  assert.equal(
    JSON.stringify(await result.json()).includes("must not expose"),
    false,
  );
  assert.deepEqual([consumed, finished, providerReads], [1, 1, 1]);
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.calls.length, 1);
});
Deno.test("provider-gap organization read composes fixed-provider code and owns its exact grant without gateway double consumption", async () => {
  const operation = "supabase.orgs.list",
    admission = "61000000-0000-4000-8000-000000000001",
    grant = "61000000-0000-4000-8000-000000000002";
  let consumed = 0, finished = 0, providerCalls = 0;
  const backend = createGapHandler(
    {
      service: "test-service-credential",
      management: "synthetic-provider-token",
      authorizeContext: async (context, contract) => {
        assert.equal(context.actor_id, extensionActor);
        assert.equal(context.credential_id, null);
        assert.equal(contract.api_key_delegable, false);
        return { allowed: true };
      },
      consumeGrant: async (value) => {
        consumed++;
        assert.equal(value.grant_id, grant);
        assert.equal(
          value.scope_sha256,
          await argumentDigest({
            provider: "supabase",
            project_ref: "zmqlyygzqoidkcwdysok",
          }),
        );
        return { allowed: true, reused: false, admission_id: admission };
      },
      finishExecution: async (value) => {
        finished++;
        assert.equal(value.admission_id, admission);
        assert.equal(value.outcome, "succeeded");
        return { allowed: true, reused: false };
      },
      fetch: (async (input, init) => {
        providerCalls++;
        const url = new URL(String(input));
        assert.equal(url.origin, "https://api.supabase.com");
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer synthetic-provider-token",
        );
        return url.pathname === "/v1/projects/zmqlyygzqoidkcwdysok"
          ? Response.json({
            ref: "zmqlyygzqoidkcwdysok",
            organization_id: "org-id",
            organization_slug: "org",
          })
          : Response.json([{
            id: "org-id",
            slug: "org",
            name: "Fixture organization",
          }]);
      }) as typeof fetch,
    } satisfies GapDependencies,
  );
  const h = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation)],
    rpcHandler(name) {
      assert.equal(name, "sandy_api_admit_execution");
      return {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: admission,
        grant_id: grant,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    },
    backend: (url, init) => {
      assert.equal(
        url,
        "https://example.supabase.co/functions/v1/sandy-provider-gap-api",
      );
      return backend(new Request(url, init));
    },
  });
  const result = await h.request({
    action: "execute",
    operation,
    arguments: {},
  });
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  assert.deepEqual([consumed, finished, providerCalls], [1, 1, 2]);
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.calls.length, 1);
});
Deno.test("provider package restore scope binds only the trusted server authority and never caller bindings", async () => {
  const operation = "github.packages.restore",
    admission = "62000000-0000-4000-8000-000000000001",
    grant = "62000000-0000-4000-8000-000000000002";
  const bindings: NonNullable<OperationDependencies["packageRestoreBindings"]> =
    [{
      verified: true,
      repository: "ausstyle/web-staging",
      repository_id: 123,
      owner: "ausstyle",
      package_type: "npm",
      package_name: "fixture",
      exclusive_namespace: true,
      expires_at: "2099-01-01T00:00:00Z",
      attestation_sha256: "a".repeat(64),
    }];
  const expected = await argumentDigest({
    provider: "github",
    repository: "ausstyle/web-staging",
    restore_bindings: bindings,
  });
  const h = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    packageRestoreBindings: bindings,
    rpcHandler(name, args) {
      assert.equal(name, "sandy_api_admit_execution");
      assert.equal(args.p_scope_sha256, expected);
      return {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: admission,
        grant_id: grant,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    },
    backend: (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(Object.hasOwn(body, "restore_bindings"), false);
      assert.equal(Object.hasOwn(body.arguments, "restore_bindings"), false);
      return Response.json({
        ok: false,
        error: "package_restore_binding_required",
        executed: false,
      }, { status: 424 });
    },
  });
  const args = {
    package_type: "npm",
    package_name: "fixture",
    expected_package_id: 123,
  };
  assert.equal(
    (await h.request({
      action: "execute",
      operation,
      arguments: { ...args, restore_bindings: [] },
    })).status,
    400,
  );
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(
    (await h.request({
      action: "execute",
      operation,
      arguments: args,
      restore_bindings: [],
    })).status,
    424,
  );
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.calls.length, 1);
});
Deno.test("tenant consent uses only the actual confirmed portal user JWT and never a Controller/service/key substitute", async () => {
  const rows = [
    extensionRow("supabase.tenant.consent.get"),
    extensionRow("supabase.tenant.consent.set", true),
  ];
  const calls: { name: string; args: Row }[] = [], tokens: string[] = [];
  const h = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    rows,
    authenticatedDb: (token) => {
      tokens.push(token);
      return {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return {
            data: {
              ok: true,
              tenant_id: extensionTenant,
              operations: [],
              approved_emails: [],
              allow_erasure: false,
              expires_at: null,
              revision: 0,
              legal_hold: false,
              retention_until: null,
            },
            error: null,
          };
        },
      };
    },
  });
  assert.equal(
    (await h.request({
      action: "execute",
      operation: "supabase.tenant.consent.get",
      arguments: {},
    })).status,
    200,
  );
  assert.equal(
    (await h.request({
      action: "execute",
      operation: "supabase.tenant.consent.set",
      arguments: {
        operations: [],
        approved_emails: [],
        allow_erasure: false,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    })).status,
    200,
  );
  assert.deepEqual(tokens, ["test-user-jwt", "test-user-jwt"]);
  assert.deepEqual(calls.map((c) => c.name), [
    "sandy_supabase_tenant_consent_get",
    "sandy_supabase_tenant_consent_set",
  ]);
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(
    (await h.request({
      action: "execute",
      operation: "supabase.tenant.consent.get",
      arguments: { tenant_id: extensionTenant },
    })).status,
    400,
  );
  for (
    const options of [{ role: "owner" }, {
      role: null,
      tenant: extensionTenant,
    }, { role: null, memoryTenant: extensionTenant, emailConfirmed: false }]
  ) {
    const denied = harness({
      ...options,
      actorId: extensionActor,
      rows,
      authenticatedDb: () => {
        throw Error("must not obtain session");
      },
    });
    assert.equal(
      (await denied.request({
        action: "execute",
        operation: "supabase.tenant.consent.get",
        arguments: {},
      })).status,
      403,
    );
  }
});
Deno.test("Agenda, customer key and agent grants remain independent from Controller privilege", async () => {
  const rows = [
    extensionRow("agenda.pins.list"),
    extensionRow("customer.keys.list"),
    extensionRow("gmail.messages.search"),
  ];
  const owner = harness({ actorId: extensionActor, rows });
  for (const row of rows) {
    assert.equal(
      (await owner.request({ action: "describe", operation: row.operation }))
        .status,
      403,
    );
  }
  const portal = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    rows,
  });
  assert.equal(
    (await portal.request({
      action: "describe",
      operation: "gmail.messages.search",
    })).status,
    200,
  );
  assert.equal(
    (await portal.request({
      action: "describe",
      operation: "agenda.pins.list",
    })).status,
    403,
  );
  const mismatched = harness({
    actorId: extensionActor,
    role: null,
    tenant: "10000000-0000-4000-8000-000000000003",
    memoryTenant: extensionTenant,
    rows,
  });
  assert.equal(
    (await mismatched.request({
      action: "describe",
      operation: "agenda.pins.list",
    })).status,
    403,
  );
  const unconfirmed = harness({
    actorId: extensionActor,
    tenant: extensionTenant,
    memoryTenant: extensionTenant,
    emailConfirmed: false,
    rows,
  });
  assert.equal(
    (await unconfirmed.request({
      action: "describe",
      operation: "customer.keys.list",
    })).status,
    403,
  );
});
Deno.test("customer key administration and Gmail reads forward the real user JWT to their fixed services", async () => {
  const key = harness({
    actorId: extensionActor,
    role: null,
    tenant: extensionTenant,
    memoryTenant: extensionTenant,
    rows: [extensionRow("customer.keys.list")],
    backend: () => Response.json({ ok: true, keys: [] }),
  });
  assert.equal(
    (await key.request({
      action: "execute",
      operation: "customer.keys.list",
      arguments: {},
    })).status,
    200,
  );
  assert.equal(
    key.calls[0].url,
    "https://example.supabase.co/functions/v1/sandy-operations-api",
  );
  assert.deepEqual(JSON.parse(String(key.calls[0].init?.body)), {
    operation: "keys.list",
    arguments: {},
  });
  assert.equal(
    new Headers(key.calls[0].init?.headers).get("authorization"),
    "Bearer test-user-jwt",
  );
  const gmail = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    rows: [extensionRow("gmail.messages.search")],
    backend: () =>
      Response.json({
        ok: true,
        contract_version: "1.0.0",
        principal_kind: "auth_user",
        task_id: null,
        read_only: true,
        data: "fixture",
      }),
  });
  assert.equal(
    (await gmail.request({
      action: "execute",
      channel: "mcp",
      operation: "gmail.messages.search",
      arguments: { query: "in:inbox" },
    })).status,
    200,
  );
  assert.equal(
    gmail.calls[0].url,
    "https://example.supabase.co/functions/v1/sandy-agent-operation-api",
  );
  assert.equal(
    new Headers(gmail.calls[0].init?.headers).get("authorization"),
    "Bearer test-user-jwt",
  );
  assert.deepEqual(JSON.parse(String(gmail.calls[0].init?.body)), {
    operation: "gmail.messages.search",
    arguments: { query: "in:inbox" },
    channel: "mcp",
  });
});
Deno.test("sensitive reads and unavailable SSH stay closed before grants, provider access or credential lookup", async () => {
  const cases: [string, Row][] = [
    ["supabase.sql.query", { sql: "SELECT 1" }],
    ["gcp.vm.agent.status", { vm_name: "sandy-video" }],
    ["system.credentials.provider.verify", {
      target_id: extensionActor,
      rotation_id: extensionTenant,
    }],
  ];
  for (const [operation, args] of cases) {
    const h = harness({
      actorId: extensionActor,
      rows: [extensionRow(operation)],
    });
    const response = await h.request({
      action: "execute",
      operation,
      arguments: args,
    });
    assert.equal(response.status, 424, operation);
    assert.equal(
      (await response.json()).error,
      "operation_requires_live_verification",
    );
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.calls.length, 0);
  }
  const ssh = harness({
    actorId: extensionActor,
    rows: [extensionRow("gcp.vm.ssh.exec", true)],
  });
  const response = await ssh.request({
    action: "execute",
    operation: "gcp.vm.ssh.exec",
    arguments: { vm_name: "sandy-video", command: "true" },
  });
  assert.equal(response.status, 424);
  assert.equal(
    (await response.json()).error,
    "guest_ssh_transport_unavailable",
  );
  assert.equal(ssh.calls.length, 0);
});
Deno.test("lifecycle polling reenters the real gateway and consumes the provider envelope with original proof", async () => {
  const child = "gcp.compute.zone_operations.get",
    c = providerOperations[child];
  const rows = [extensionRow("system.lifecycle.poll"), {
    ...c,
    handler: "sandy-provider-operation-api",
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    api_exposed: true,
    ai_exposed: true,
    verified: false,
    error_contract: { contract_sha256: c.contract_sha256 },
  }];
  const grants = new Map<string, string>();
  let admissions = 0;
  const h = harness({
    actorId: extensionActor,
    rows,
    executionPolicy: true,
    rpcHandler: (name, args) => {
      if (name === "sandy_api_admit_execution") {
        admissions++;
        const admission = crypto.randomUUID(), grant = crypto.randomUUID();
        grants.set(grant, admission);
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: admission,
          grant_id: grant,
          state: "admitted",
          executed: false,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        };
      }
      if (name === "sandy_api_consume_execution_grant") {
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: grants.get(String(args.p_grant_id)),
        };
      }
      if (name === "sandy_api_finish_execution") {
        return {
          ok: true,
          admission_id: args.p_admission_id,
          state: args.p_outcome,
          reused: false,
        };
      }
      throw Error(`unexpected RPC ${name}`);
    },
    backend: (_url, init) => {
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.operation, child);
      assert.equal(sent.actor_id, extensionActor);
      assert.equal(sent.tenant_id, null);
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-service-credential",
      );
      return Response.json({
        ok: true,
        operation: child,
        contract_version: "1.0.0",
        provider: "gcp",
        request_state: "observed",
        executed: true,
        admission_id: sent.admission_id,
        provider_http_status: 200,
        provider_request_id: "fixture-provider-read",
        result: { name: "operation-test", status: "DONE", id: "22" },
        possibly_truncated: false,
        result_limit: 100,
        next_page: null,
      });
    },
  });
  const response = await h.request({
    action: "execute",
    operation: "system.lifecycle.poll",
    arguments: { scope: "zone", operation_name: "operation-test" },
  });
  assert.equal(
    response.status,
    200,
    JSON.stringify(await response.clone().json()),
  );
  const body = await response.json();
  assert.equal(body.result.terminal, true);
  assert.equal(body.result.effect_confirmed, false);
  assert.match(body.result.read_admission_id, /^[a-f0-9-]{36}$/);
  assert.equal(admissions, 2);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.identityTokens, ["test-user-jwt", "test-user-jwt"]);
});

async function expansionRow(operation: string, verified = false): Promise<Row> {
  const contract = await loadExpandedProviderOperation(operation);
  assert.ok(contract, operation);
  return {
    ...contract,
    handler: "sandy-provider-operation-api",
    api_exposed: true,
    ai_exposed: true,
    verified,
    error_contract: { contract_sha256: contract.contract_sha256 },
  };
}
Deno.test("all 1143 additive provider IDs are installed without replacing baseline handlers or exposing unverified execution", async () => {
  assert.equal(Object.keys(providerOperations).length, 595);
  assert.equal(Object.keys(providerExpansionOperations).length, 1143);
  assert.equal(installedOperationIds.length, 2556);
  const installed = new Set(installedOperationIds);
  for (const operation of Object.keys(providerExpansionOperations)) {
    assert.ok(installed.has(operation), operation);
    assert.equal(Object.hasOwn(providerOperations, operation), false);
  }
  const rows = Object.values(providerExpansionOperations).map((descriptor) => ({
    ...descriptor,
    handler: "sandy-provider-operation-api",
    api_exposed: true,
    ai_exposed: true,
    verified: false,
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    error_contract: { contract_sha256: descriptor.contract_sha256 },
  }));
  const h = harness({ actorId: extensionActor, rows, executionPolicy: true });
  const listed = await (await h.request({ action: "list" })).json();
  assert.equal(listed.operations.length, 1143);
  for (const row of listed.operations) {
    assert.equal(row.executable, false);
    assert.equal(
      row.unavailable_reason,
      "operation_requires_live_verification",
    );
    assert.equal(row.handler, "sandy-provider-operation-api");
  }
  const closed = harness({
    rows: rows.map((row) => ({ ...row, api_exposed: false })),
  });
  assert.deepEqual(
    (await (await closed.request({ action: "list" })).json()).operations,
    [],
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.rpcCalls.length, 0);
});
Deno.test("expanded provider reads and mutations require real owner sessions, current exposure and verification before admission", async () => {
  for (
    const [operation, args] of [
      ["gcp.instance_group_managers.get", {
        path: { instanceGroupManager: "fixture" },
      }],
      ["gcp.instance_group_managers.create", { body: { name: "fixture" } }],
    ] as const
  ) {
    const row = await expansionRow(operation);
    for (
      const [options, expected] of [
        [{ rows: [row] }, 424],
        [{ rows: [{ ...row, verified: true }], role: "admin" }, 403],
        [{ rows: [{ ...row, api_exposed: false }] }, 404],
      ] as const
    ) {
      const h = harness({
        ...options,
        actorId: extensionActor,
        executionPolicy: true,
      });
      const response = await h.request({
        action: "execute",
        operation,
        arguments: args,
      });
      assert.equal(response.status, expected);
      assert.equal(h.calls.length, 0);
      assert.equal(h.rpcCalls.length, 0);
    }
    const key = harness({
      actorId: extensionActor,
      rows: [{ ...row, verified: true }],
      executionPolicy: true,
      resolveCredential: async () => ({
        kind: "api_key",
        principalId: extensionActor,
        allowedOperations: [operation],
      }),
    });
    const denied = await key.request({
      action: "execute",
      operation,
      arguments: args,
    });
    assert.equal(denied.status, 403);
    assert.equal(
      (await denied.json()).error,
      "operation_requires_user_session",
    );
    assert.equal(key.calls.length, 0);
    assert.equal(key.rpcCalls.length, 0);
    const lease = harness({
      actorId: extensionActor,
      rows: [{ ...row, verified: true }],
      executionPolicy: true,
      resolveCredential: async () => ({
        kind: "job_lease",
        principalId: extensionActor,
        allowedOperations: [operation],
        boundExecution: {
          operation,
          arguments: args,
          inputDigest: await argumentDigest(args),
          channel: "api",
        },
      }),
    });
    const leased = await lease.handler(
      new Request("https://local.invalid/v1/internal/execute", {
        method: "POST",
        headers: { authorization: "Bearer internal-service" },
        body: "{}",
      }),
    );
    assert.equal(leased.status, 403);
    assert.equal(
      (await leased.json()).error,
      "operation_requires_user_session",
    );
    assert.equal(lease.calls.length, 0);
    assert.equal(lease.rpcCalls.length, 0);
    const drift = harness({
      actorId: extensionActor,
      rows: [{
        ...row,
        verified: true,
        error_contract: { contract_sha256: "0".repeat(64) },
      }],
      executionPolicy: true,
    });
    assert.equal(
      (await drift.request({ action: "execute", operation, arguments: args }))
        .status,
      503,
    );
    assert.equal(drift.calls.length, 0);
    assert.equal(drift.rpcCalls.length, 0);
  }
});
Deno.test("expanded provider scopes bind server-verified authority and reject missing or foreign configuration before admission", async () => {
  const operation = "gcp.billing.accounts.iam_policy.get",
    row = await expansionRow(operation, true);
  const args = { path: { resource: "billingAccounts/ABCDEF-123456-ABCDEF" } };
  for (const providerConfig of [undefined, { gcpProjectId: "foreign" }]) {
    const h = harness({
      rows: [row],
      actorId: extensionActor,
      executionPolicy: true,
      providerConfig,
    });
    const description =
      await (await h.request({ action: "describe", operation })).json();
    assert.equal(description.operation.executable, false);
    const response = await h.request({
      action: "execute",
      operation,
      arguments: args,
    });
    assert.equal(response.status, 424);
    assert.equal(h.calls.length, 0);
    assert.equal(h.rpcCalls.length, 0);
  }
  const config = {
    verifiedBindings: {
      billing_account: {
        id: "ABCDEF-123456-ABCDEF",
        verified: true as const,
        project_id: "elaborate-haven-511518-a5" as const,
      },
    },
  };
  const h = harness({
    rows: [row],
    actorId: extensionActor,
    executionPolicy: true,
    providerConfig: config,
    async rpcHandler(name, admitted) {
      assert.equal(name, "sandy_api_admit_execution");
      assert.equal(
        admitted.p_scope_sha256,
        await argumentDigest(expandedProviderExecutionScope(operation, config)),
      );
      return {
        ok: false,
        http_status: 403,
        error: "scoped_mutation_approval_required",
      };
    },
  });
  assert.equal(
    (await h.request({ action: "execute", operation, arguments: args })).status,
    403,
  );
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.calls.length, 0);
});
Deno.test("expanded providers compose their actual executor with exact central proof and one backend-owned grant and receipt", async () => {
  const requestId = "60000000-0000-4000-8000-000000000001",
    admission = "60000000-0000-4000-8000-000000000002",
    grant = "60000000-0000-4000-8000-000000000003",
    approval = "60000000-0000-4000-8000-000000000004";
  const cases: [string, Row, Row, string][] = [
    [
      "gcp.instance_group_managers.get",
      { path: { instanceGroupManager: "fixture" } },
      { name: "fixture" },
      "compute.googleapis.com",
    ],
    [
      "github.repos.get_branch_protection",
      { path: { branch: "fixture" } },
      {},
      "api.github.com",
    ],
    ["supabase.v1_get_database_disk", {}, {
      attributes: { iops: 3000, size_gb: 8, type: "gp3" },
    }, "api.supabase.com"],
    ["gcp.instance_group_managers.create", { body: { name: "fixture" } }, {
      name: "fixture",
      id: "123",
    }, "compute.googleapis.com"],
  ];
  for (const [operation, args, providerBody, host] of cases) {
    const row = await expansionRow(operation, true);
    const inputSha = await argumentDigest(args),
      scopeSha = await argumentDigest(
        expandedProviderExecutionScope(operation),
      );
    let consumed = 0, finished = 0, providerCalls = 0;
    const executor = createProviderOperationHandler({
      service: "test-service-credential",
      management: "synthetic-management",
      github: "synthetic-github",
      getGcpAccessToken: () => Promise.resolve("synthetic-gcp"),
      authorizeContext: async (context, descriptor) => {
        assert.equal(context.actor_id, extensionActor);
        assert.equal(context.tenant_id, null);
        assert.equal(context.credential_id, null);
        assert.equal(descriptor.operation, operation);
        return { allowed: true };
      },
      consumeGrant: async (context) => {
        consumed++;
        assert.equal(context.grant_id, grant);
        assert.equal(context.admission_id, admission);
        assert.equal(context.request_id, requestId);
        assert.equal(context.input_sha256, inputSha);
        assert.equal(context.scope_sha256, scopeSha);
        assert.equal(context.contract_sha256, row.contract_sha256);
        return { allowed: true, admission_id: admission };
      },
      finishExecution: async (receipt) => {
        finished++;
        assert.equal(receipt.admission_id, admission);
        return { allowed: true };
      },
      fetch: ((url: string | URL | Request) => {
        providerCalls++;
        assert.equal(new URL(String(url)).hostname, host);
        return Promise.resolve(Response.json(providerBody));
      }) as typeof fetch,
    });
    const h = harness({
      actorId: extensionActor,
      rows: [row],
      executionPolicy: true,
      async rpcHandler(name, admitted) {
        assert.equal(name, "sandy_api_admit_execution");
        assert.equal(admitted.p_actor_id, extensionActor);
        assert.equal(admitted.p_tenant_id, null);
        assert.equal(admitted.p_input_sha256, inputSha);
        assert.equal(admitted.p_scope_sha256, scopeSha);
        assert.equal(admitted.p_contract_sha256, row.contract_sha256);
        assert.equal(admitted.p_approval_id, approval);
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: admission,
          grant_id: grant,
          state: "admitted",
          executed: false,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        };
      },
      backend(url, init) {
        assert.equal(
          url,
          "https://example.supabase.co/functions/v1/sandy-provider-operation-api",
        );
        return executor(new Request(url, init));
      },
    });
    const response = await h.handler(
      new Request("https://local.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer test-user-jwt",
          "x-sandy-request-id": requestId,
          "x-sandy-approval-id": approval,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "execute", operation, arguments: args }),
      }),
    );
    const result = await response.json();
    assert.equal(
      response.status,
      200,
      operation + ":" + JSON.stringify(result),
    );
    assert.equal(result.ok, true);
    assert.equal(
      result.result.request_state,
      row.is_mutation ? "accepted" : "observed",
    );
    if (row.is_mutation) {
      assert.equal(result.result.result.effect_confirmed, false);
    }
    assert.equal(result.verified, undefined);
    assert.equal(JSON.stringify(result).includes("synthetic-"), false);
    assert.deepEqual([h.rpcCalls.length, consumed, finished, providerCalls], [
      1,
      1,
      1,
      1,
    ]);
  }
});
Deno.test("canonical MCP sends expanded operation execution to Sandy API and preserves its closed verification outcome", async () => {
  const operation = "gcp.instance_group_managers.get",
    row = await expansionRow(operation),
    requests: Request[] = [];
  const h = harness({
    rows: [row],
    actorId: extensionActor,
    executionPolicy: true,
  });
  const mcp = createHandler(
    createApi(
      "https://example.supabase.co",
      "test-anon-key",
      (async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.clone());
        return h.handler(request);
      }) as typeof fetch,
    ),
  );
  const response = await mcp(
    new Request("https://local.invalid/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-user-jwt",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: operation,
          arguments: { path: { instanceGroupManager: "fixture" } },
        },
      }),
    }),
  );
  const result = await response.json();
  assert.equal(result.result.isError, true);
  assert.equal(requests.length, 1);
  assert.equal((await requests[0].json()).channel, "mcp");
  assert.equal(
    new Headers(requests[0].headers).get("authorization"),
    "Bearer test-user-jwt",
  );
  assert.equal(
    JSON.parse(result.result.content[0].text).result.error,
    "operation_requires_live_verification",
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.rpcCalls.length, 0);
});

Deno.test("owner metadata uses one customer-bound admission and preserves the original MCP channel", async () => {
  for (
    const [operation, args] of [
      ["system.catalog", {}],
      ["system.connections", {
        customer_id: "ABCDEFAB-0000-4000-8000-000000000002",
      }],
    ] as [string, Row][]
  ) {
    let backendCalls = 0;
    const scope = systemMetadataExecutionScope(operation, args);
    const backend = createSystemMetadataHandler({
      fetch: () => {
        throw Error("unexpected provider request");
      },
      base: "https://zmqlyygzqoidkcwdysok.supabase.co",
      service: "test-service-credential",
      rpc: async (input) => {
        backendCalls++;
        assert.equal(input.p_operation, operation);
        assert.deepEqual(input.p_arguments, args);
        assert.equal(input.p_canonical_scope, canonicalJson(scope));
        assert.equal(input.p_actor_id, extensionActor);
        assert.equal(input.p_channel, "mcp");
        assert.equal(input.p_admission_id, productAdmissionId);
        return {
          ok: true,
          operation,
          contract_version: "1.0.0",
          admission_id: input.p_admission_id,
          request_id: input.p_request_id,
          request_state: "observed",
          executed: true,
          reconciliation_required: false,
          result: {
            items: [],
            item: null,
            next_cursor: null,
            possibly_truncated: false,
            source: "recorded_metadata",
            provider_verified: false,
            executability_not_implied: true,
            schemas_via: "Sandy API describe",
            notice: "Recorded metadata only.",
          },
        };
      },
    });
    const h = harness({
      actorId: extensionActor,
      memoryTenant: null,
      executionPolicy: true,
      rows: [extensionRow(operation, true)],
      rpcHandler: async (name, input) => {
        assert.equal(name, "sandy_api_admit_execution");
        assert.equal(input.p_scope_sha256, await argumentDigest(scope));
        assert.equal(input.p_input_sha256, await argumentDigest(args));
        assert.equal(input.p_approval_id, productAdmissionId);
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: productAdmissionId,
          grant_id: productRequestId,
          state: "admitted",
          executed: false,
          expires_at: "2099-01-01T00:00:00Z",
        };
      },
      backend: (url, init) => {
        assert.equal(
          url,
          "https://example.supabase.co/functions/v1/sandy-system-metadata-api",
        );
        const headers = new Headers(init?.headers);
        assert.equal(
          headers.get("authorization"),
          "Bearer test-service-credential",
        );
        const body = JSON.parse(String(init?.body));
        assert.equal(body.tenant_id, null);
        assert.equal(body.credential_id, null);
        return backend(new Request(url, init));
      },
    });
    const response = await h.request(
      {
        action: "execute",
        operation,
        arguments: args,
        channel: "mcp",
      },
      "Bearer actual-owner-session",
      {
        "x-sandy-request-id": productRequestId,
        "x-sandy-approval-id": productAdmissionId,
      },
    );
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.equal(body.executed, true);
    assert.equal(body.reconciliation_required, false);
    assert.deepEqual([h.rpcCalls.length, h.calls.length, backendCalls], [
      1,
      1,
      1,
    ]);
  }
});

Deno.test("metadata refuses drift and non-owner sessions before admission and preserves atomic versus unknown outcomes", async () => {
  const operation = "system.connections",
    args = { customer_id: extensionTenant };
  for (
    const patch of [
      { requires_approval: false },
      { requires_real_user_session: false },
      { api_key_delegable: true },
    ]
  ) {
    const row = extensionRow(operation, true);
    row.error_contract = { ...(row.error_contract as Row), ...patch };
    const h = harness({
      actorId: extensionActor,
      memoryTenant: null,
      rows: [row],
    });
    assert.equal(
      (await h.request({ action: "execute", operation, arguments: args }))
        .status,
      503,
    );
    assert.deepEqual([h.rpcCalls.length, h.calls.length], [0, 0]);
  }
  for (
    const options of [
      { role: null, memoryTenant: extensionTenant },
      { emailConfirmed: false, memoryTenant: null },
    ]
  ) {
    const h = harness({
      actorId: extensionActor,
      rows: [extensionRow(operation, true)],
      ...options,
    });
    assert.equal(
      (await h.request({ action: "execute", operation, arguments: args }))
        .status,
      403,
    );
    assert.deepEqual([h.rpcCalls.length, h.calls.length], [0, 0]);
  }
  for (const outcome of ["rollback", "unknown", "untyped"] as const) {
    const backend = createSystemMetadataHandler({
      fetch: () => {
        throw Error("unexpected provider request");
      },
      base: "https://zmqlyygzqoidkcwdysok.supabase.co",
      service: "test-service-credential",
      rpc: async () => {
        if (outcome === "unknown") throw Error("lost transport");
        return {
          ok: false,
          error: "system_metadata_target_or_receipt_not_found",
          http_status: 404,
          executed: false,
        };
      },
    });
    const h = harness({
      actorId: extensionActor,
      memoryTenant: null,
      executionPolicy: true,
      rows: [extensionRow(operation, true)],
      rpcData: {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: productAdmissionId,
        grant_id: productRequestId,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      },
      backend: (url, init) =>
        outcome === "untyped"
          ? Response.json({ ok: true })
          : backend(new Request(url, init)),
    });
    const response = await h.request({
      action: "execute",
      operation,
      arguments: args,
    });
    assert.equal(
      response.status,
      outcome === "rollback" ? 404 : outcome === "unknown" ? 503 : 502,
    );
    const body = await response.json();
    assert.equal(body.executed, outcome === "rollback" ? false : null);
    assert.equal(body.reconciliation_required, outcome !== "rollback");
    assert.deepEqual([h.rpcCalls.length, h.calls.length], [1, 1]);
  }
});

Deno.test("relationship-bound branch reads prove the fixed parent before one sanitized provider observation", async () => {
  const operation = "supabase.branches.get_config.bound";
  const branch = "11111111-1111-4111-8111-111111111111";
  const args = { path: { branch_id_or_ref: branch } };
  const scope = boundExecutionScope(operation);
  let consumed = 0, finished = 0;
  const outcomes: string[] = [];
  const providerUrls: string[] = [];
  const backend = createBoundHandler({
    service: "test-service-credential",
    now: () => Date.parse("2026-10-21T01:00:00Z"),
    authorizeContext: async () => ({ allowed: true }),
    consumeGrant: async (input) => {
      consumed++;
      assert.equal(input.actor_id, extensionActor);
      assert.equal(input.scope_sha256, await argumentDigest(scope));
      assert.equal(
        input.contract_sha256,
        boundContracts[operation].contract_sha256,
      );
      return { allowed: true, admission_id: productAdmissionId, reused: false };
    },
    finishExecution: async (input) => {
      finished++;
      outcomes.push(input.outcome);
      return { allowed: true };
    },
    credentialForExecution: async () => "synthetic-management-token",
    saveOpaque: async () => {
      throw Error("No private artifact expected");
    },
    takeOpaque: async () => {
      throw Error("No opaque cursor expected");
    },
    fetch: (async (input, init) => {
      const url = String(input);
      providerUrls.push(url);
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer synthetic-management-token",
      );
      assert.equal(init?.method, "GET");
      if (providerUrls.length === 1) {
        assert.equal(
          url,
          "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/branches",
        );
        return Response.json([{
          id: branch,
          project_ref: "aaaaaaaaaaaaaaaaaaaa",
          parent_project_ref: "zmqlyygzqoidkcwdysok",
          is_default: false,
        }]);
      }
      assert.equal(
        url,
        `https://api.supabase.com/v1/branches/${branch}`,
      );
      return Response.json({
        ref: "aaaaaaaaaaaaaaaaaaaa",
        postgres_version: "17",
        postgres_engine: "postgres",
        release_channel: "ga",
        status: "ACTIVE_HEALTHY",
        db_host: "fixture.supabase.co",
        db_port: 5432,
        db_pass: "PRIVATE_DB_PASSWORD_MUST_NOT_RETURN",
      });
    }) as typeof fetch,
  });
  const h = harness({
    actorId: extensionActor,
    memoryTenant: null,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    rpcHandler: async (name, input) => {
      assert.equal(name, "sandy_api_admit_execution");
      assert.equal(input.p_scope_sha256, await argumentDigest(scope));
      return {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: productAdmissionId,
        grant_id: productRequestId,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    },
    backend: (url, init) => {
      assert.equal(
        url,
        "https://example.supabase.co/functions/v1/sandy-provider-bound-api",
      );
      return backend(new Request(url, init));
    },
  });
  const response = await h.request({
    action: "execute",
    operation,
    arguments: args,
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(outcomes, ["succeeded"]);
  const body = await response.text();
  assert.equal(body.includes("PRIVATE_DB_PASSWORD_MUST_NOT_RETURN"), false);
  assert.equal(body.includes("synthetic-management-token"), false);
  assert.deepEqual([
    h.rpcCalls.length,
    h.calls.length,
    consumed,
    finished,
    providerUrls.length,
  ], [1, 1, 1, 1, 2]);
});

Deno.test("relationship-bound methods keep exact owner approval and configured parent fences before dispatch", async () => {
  const operation = "supabase.branches.get_config.bound";
  const args = { path: { branch_id_or_ref: productRequestId } };
  for (
    const patch of [
      { requires_approval: false },
      { requires_grant: false },
      { api_key_delegable: true },
    ]
  ) {
    const row = extensionRow(operation, true);
    row.error_contract = { ...(row.error_contract as Row), ...patch };
    const h = harness({
      actorId: extensionActor,
      memoryTenant: null,
      rows: [row],
    });
    assert.equal(
      (await h.request({ action: "execute", operation, arguments: args }))
        .status,
      503,
    );
    assert.deepEqual([h.rpcCalls.length, h.calls.length], [0, 0]);
  }
  const firewall = "gcp.firewall_policies.get.bound";
  const h = harness({
    actorId: extensionActor,
    memoryTenant: null,
    executionPolicy: true,
    rows: [extensionRow(firewall, true)],
  });
  const described =
    await (await h.request({ action: "describe", operation: firewall })).json();
  assert.equal(described.operation.executable, false);
  assert.equal(
    described.operation.unavailable_reason,
    "verified_organization_scope_binding_required",
  );
  assert.equal(
    (await h.request({
      action: "execute",
      operation: firewall,
      arguments: { path: { firewallPolicy: "123" } },
    })).status,
    424,
  );
  assert.deepEqual([h.rpcCalls.length, h.calls.length], [0, 0]);
});

Deno.test("legacy original-ID handlers preserve exact scoped owner approval and consume once through the real merge executor", async () => {
  assert.equal(Object.keys(legacyOwnerOperations).length, 7);
  const operation = "github.merge", sha = "a".repeat(40);
  const args = {
    path: { pull_number: 123 },
    body: { sha, merge_method: "merge" },
  };
  const approval = "80000000-0000-4000-8000-000000000003";
  const scope = await argumentDigest(legacyOwnerExecutionScope(operation));
  for (const merged of [true, false]) {
    let admitted: Row | null = null;
    let consumed = 0, finished = 0, providerCalls = 0;
    const backend = createLegacyProviderHandler({
      service: "test-service-credential",
      authorizeContext: async (context, contract) => {
        assert.ok(admitted);
        assert.equal(context.actor_id, extensionActor);
        assert.equal(context.tenant_id, null);
        assert.equal(context.credential_id, null);
        assert.equal(context.admission_id, productAdmissionId);
        assert.equal(contract.operation, operation);
        return { allowed: true };
      },
      consumeGrant: async (input) => {
        assert.ok(admitted);
        assert.equal(++consumed, 1);
        assert.equal(input.operation, operation);
        assert.equal(input.actor_id, extensionActor);
        assert.equal(input.request_id, productRequestId);
        assert.equal(input.grant_id, productRequestId);
        assert.equal(input.input_sha256, admitted.p_input_sha256);
        assert.equal(input.contract_sha256, admitted.p_contract_sha256);
        assert.equal(input.scope_sha256, admitted.p_scope_sha256);
        return {
          allowed: true,
          admission_id: productAdmissionId,
          reused: false,
        };
      },
      finishExecution: async (input) => {
        finished++;
        assert.equal(input.admission_id, productAdmissionId);
        assert.equal(input.outcome, merged ? "accepted" : "failed");
        assert.equal(input.provider_http_status, 200);
        return { allowed: true };
      },
      credentialForExecution: async (_op, context) => {
        assert.equal(consumed, 1);
        assert.equal(context.admissionId, productAdmissionId);
        return "synthetic-provider-token";
      },
      fetch: (async (url, init) => {
        providerCalls++;
        assert.equal(
          String(url),
          "https://api.github.com/repos/ausstyle/web-staging/pulls/123/merge",
        );
        assert.equal(init?.method, "PUT");
        assert.deepEqual(JSON.parse(String(init?.body)), args.body);
        return Response.json({
          merged,
          sha,
          message: merged ? "Merged" : "Head refused",
        });
      }) as typeof fetch,
    });
    const h = harness({
      actorId: extensionActor,
      executionPolicy: true,
      rows: [extensionRow(operation, true)],
      rpcHandler: async (name, input) => {
        assert.equal(
          name,
          "sandy_api_admit_execution",
          "backend owns consume/finish",
        );
        assert.equal(input.p_actor_id, extensionActor);
        assert.equal(input.p_tenant_id, null);
        assert.equal(input.p_operation, operation);
        assert.equal(input.p_request_id, productRequestId);
        assert.equal(input.p_approval_id, approval);
        assert.equal(input.p_input_sha256, await argumentDigest(args));
        assert.equal(input.p_scope_sha256, scope);
        assert.equal(
          input.p_contract_sha256,
          legacyOwnerOperations[operation].contract_sha256,
        );
        admitted = input;
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: productAdmissionId,
          grant_id: productRequestId,
          state: "admitted",
          executed: false,
          expires_at: "2099-01-01T00:00:00Z",
        };
      },
      backend: (url, init) => {
        assert.equal(
          url,
          "https://example.supabase.co/functions/v1/sandy-legacy-compatibility-api",
        );
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer test-service-credential",
        );
        const sent = JSON.parse(String(init?.body));
        assert.equal(sent.operation, operation);
        assert.deepEqual(sent.arguments, args);
        return backend(new Request(url, init));
      },
    });
    const response = await h.request(
      { action: "execute", operation, arguments: args },
      undefined,
      {
        "x-sandy-request-id": productRequestId,
        "x-sandy-approval-id": approval,
      },
    );
    assert.equal(
      response.status,
      merged ? 200 : 409,
      await response.clone().text(),
    );
    const result = await response.json();
    assert.equal(result.executed, merged);
    if (!merged) {
      assert.equal(result.reconciliation_required, false);
      assert.equal(result.provider_attempted, true);
    }
    assert.deepEqual([
      h.rpcCalls.length,
      h.calls.length,
      consumed,
      finished,
      providerCalls,
    ], [1, 1, 1, 1, 1]);
  }
});

Deno.test("financial text redaction composes all five owner routes with one scoped admission and strict policy results", async () => {
  for (
    const suffix of [
      "policies.create",
      "policies.get",
      "policies.revoke",
      "preview",
      "apply",
    ]
  ) {
    const operation = "supabase.tenant.financial.redaction." + suffix;
    const base = {
      tenant_id: extensionTenant,
      manifest: redactionManifest.id,
      expected_manifest_sha256: redactionManifest.manifest_sha256,
    };
    const args = suffix === "policies.create"
      ? {
        ...base,
        resource: "sandy_commerce_accounts",
        record_ids: [productRequestId],
        source_cutoff: "2026-10-21T00:00:00Z",
        effective_at: "2026-10-21T00:00:00Z",
        expires_at: "2026-10-22T00:00:00Z",
        basis: "subject_data_request",
        policy_reference: productRequestId,
        acknowledge_retained_financial_records: true,
        acknowledge_retained_control_copies: true,
      }
      : {
        ...base,
        policy_id: productRequestId,
        ...(suffix === "policies.revoke"
          ? { confirm_policy_revocation: true }
          : {}),
        ...(suffix === "apply"
          ? {
            confirm_text_redaction: true,
            expected_current_sha256: "d".repeat(64),
          }
          : {}),
      };
    let consumed = 0, finished = 0, sql = 0;
    const backend = createTenantLifecycleHandler({
      service: "test-service-credential",
      projectUrl: "https://zmqlyygzqoidkcwdysok.supabase.co",
      authorizeContext: async (context) => {
        assert.equal(context.actor_id, extensionActor);
        return { allowed: true };
      },
      consumeGrant: async (input) => {
        consumed++;
        assert.equal(
          input.scope_sha256,
          await argumentDigest(financialRedactionScope),
        );
        assert.equal(input.operation, operation);
        assert.equal(input.tenant_id, null);
        assert.equal(input.actor_id, extensionActor);
        assert.equal(input.request_id, productRequestId);
        assert.equal(input.grant_id, productRequestId);
        assert.equal(input.input_sha256, await argumentDigest(args));
        assert.equal(
          input.contract_sha256,
          extensionContracts[operation].contract_sha256,
        );
        return {
          allowed: true,
          reused: false,
          admission_id: productAdmissionId,
        };
      },
      finishExecution: async () => {
        finished++;
        return { allowed: true };
      },
      rpc: async (name, input) => {
        sql++;
        assert.equal(name, "sandy_tenant_financial_redaction_execute");
        assert.deepEqual(input, {
          p_actor: extensionActor,
          p_admission: productAdmissionId,
          p_canonical: canonicalJson(args),
        });
        return {
          status: 200,
          error: null,
          data: {
            ok: true,
            reused: false,
            result: {
              policy_id: productRequestId,
              tenant_id: extensionTenant,
              manifest: redactionManifest.id,
              manifest_sha256: redactionManifest.manifest_sha256,
              schema_sha256: redactionManifest.schema_sha256,
              resource: "sandy_commerce_accounts",
              record_count: 1,
              source_sha256: "d".repeat(64),
              consent_revision: 1,
              source_cutoff: "2026-10-21T00:00:00Z",
              effective_at: "2026-10-21T00:00:00Z",
              expires_at: "2026-10-22T00:00:00Z",
              basis: "subject_data_request",
              policy_reference: productRequestId,
              policy_reference_verified: false,
              state: suffix === "apply"
                ? "applied"
                : suffix === "policies.revoke"
                ? "revoked"
                : "active",
              created_at: "2026-10-21T00:00:00Z",
              redacted_fields: ["name"],
              retained_categories: redactionManifest.retained_categories,
              complete_tenant_coverage: false,
              financial_records_preserved: true,
              external_provider_assets_included: false,
              retained_control_copies: true,
              restore_supported: false,
              ...(suffix === "preview"
                ? {
                  current_sha256: "d".repeat(64),
                  source_changed: false,
                  changed_count: 1,
                  eligible: true,
                  hold_or_retention_blocked: false,
                  consent_current: true,
                }
                : {}),
              ...(suffix === "apply"
                ? {
                  before_sha256: "d".repeat(64),
                  after_sha256: "e".repeat(64),
                  changed_count: 1,
                  source_text_redacted: true,
                }
                : {}),
            },
          },
        };
      },
    });
    const h = harness({
      actorId: extensionActor,
      executionPolicy: true,
      rows: [extensionRow(operation, true)],
      rpcHandler: async (name, input) => {
        assert.equal(name, "sandy_api_admit_execution");
        assert.equal(input.p_actor_id, extensionActor);
        assert.equal(input.p_tenant_id, null);
        assert.equal(input.p_operation, operation);
        assert.equal(input.p_approval_id, productAdmissionId);
        assert.equal(input.p_request_id, productRequestId);
        assert.equal(input.p_input_sha256, await argumentDigest(args));
        assert.equal(
          input.p_contract_sha256,
          extensionContracts[operation].contract_sha256,
        );
        assert.equal(
          input.p_scope_sha256,
          await argumentDigest(financialRedactionScope),
        );
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: productAdmissionId,
          grant_id: productRequestId,
          state: "admitted",
          executed: false,
          expires_at: "2099-01-01T00:00:00Z",
        };
      },
      backend: (url, init) => {
        assert.equal(
          url,
          "https://example.supabase.co/functions/v1/sandy-tenant-lifecycle-api",
        );
        return backend(new Request(url, init));
      },
    });
    const response = await h.request(
      { action: "execute", operation, arguments: args },
      undefined,
      {
        "x-sandy-request-id": productRequestId,
        "x-sandy-approval-id": productAdmissionId,
      },
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual([
      h.rpcCalls.length,
      h.calls.length,
      consumed,
      finished,
      sql,
    ], [1, 1, 1, 1, 1]);
  }
});

Deno.test("Composio customer reads preserve JWT and channel, generate or retain request IDs and omit approval metadata", async () => {
  for (const operation of Object.keys(composioReadOperations)) {
    for (const suppliedId of [false, true]) {
      let selectedRequest = "";
      const args = operation === "composio.execute_read"
        ? {
          profile_id: "fixture_read",
          company_id: null,
          arguments: { query: "hello" },
        }
        : {};
      const h = harness({
        actorId: extensionActor,
        role: null,
        memoryTenant: extensionTenant,
        executionPolicy: true,
        rows: [extensionRow(operation, true)],
        backend: (url, init) => {
          assert.equal(
            url,
            "https://example.supabase.co/functions/v1/sandy-composio-read-api",
          );
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            "Bearer test-user-jwt",
          );
          const body = JSON.parse(String(init?.body));
          assert.deepEqual(Object.keys(body).sort(), [
            "arguments",
            "channel",
            "operation",
            "request_id",
          ]);
          assert.equal(body.operation, operation);
          assert.equal(body.channel, "mcp");
          assert.deepEqual(body.arguments, args);
          assert.match(body.request_id, /^[a-f0-9-]{36}$/i);
          selectedRequest = body.request_id;
          if (suppliedId) assert.equal(body.request_id, productRequestId);
          return Response.json({
            ok: true,
            operation,
            contract_version: "1.0.0",
            request_id: body.request_id,
            admission_id: productAdmissionId,
            request_state: "observed",
            executed: true,
            reconciliation_required: false,
            result: {
              toolkits: [],
              data: operation.endsWith("execute_read")
                ? { text: "synthetic read" }
                : null,
              profile_id: operation.endsWith("execute_read")
                ? "fixture_read"
                : null,
              result_sha256: "a".repeat(64),
              provider_verified: true,
              source: "composio_customer_read_service",
              payload_stored: false,
            },
          });
        },
      });
      const response = await h.request(
        { action: "execute", operation, arguments: args, channel: "mcp" },
        undefined,
        {
          ...(suppliedId ? { "x-sandy-request-id": productRequestId } : {}),
          "x-sandy-approval-id": productAdmissionId,
        },
      );
      assert.equal(response.status, 200, await response.clone().text());
      assert.ok(selectedRequest);
      assert.deepEqual(
        [h.calls.length, h.rpcCalls.length],
        [1, 0],
        "customer backend owns admission and receipt",
      );
      const ownerWithoutPortal = harness({
        actorId: extensionActor,
        rows: [extensionRow(operation, true)],
      });
      assert.equal(
        (await ownerWithoutPortal.request({ action: "describe", operation }))
          .status,
        403,
      );
      assert.deepEqual([
        ownerWithoutPortal.calls.length,
        ownerWithoutPortal.rpcCalls.length,
      ], [0, 0]);
    }
  }
});

Deno.test("strict Product actual handler validates recorded PostgreSQL resource shapes through one customer admission", async () => {
  const operation = "customer.profile.get", calls: string[] = [];
  const backend = createStrictProductHandler({
    base: "https://example.supabase.co",
    anon: "test-anon-key",
    service: "test-service-credential",
    env: () => undefined,
    authenticate: async (token) => {
      assert.equal(token, "test-user-jwt");
      return { id: extensionActor, emailConfirmed: true };
    },
    fetch: (() => {
      throw Error("No provider call expected");
    }) as typeof fetch,
    rpc: async (name, input, token, service) => {
      calls.push(name);
      assert.equal(token, "test-user-jwt");
      assert.equal(service, false);
      if (name === "sandy_product_admit") {
        assert.equal(input.p_operation, operation);
        assert.equal(input.p_request_id, productRequestId);
        assert.equal(input.p_channel, "mcp");
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: productAdmissionId,
          grant_id: productRequestId,
        };
      }
      assert.equal(name, "sandy_product_execute_db");
      return await productResponse(operation).json();
    },
  });
  const h = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    executionPolicy: true,
    rows: [extensionRow(operation)],
    backend: (url, init) => backend(new Request(url, init)),
  });
  const response = await h.request(
    { action: "execute", operation, arguments: {}, channel: "mcp" },
    undefined,
    { "x-sandy-request-id": productRequestId },
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(calls, ["sandy_product_admit", "sandy_product_execute_db"]);
  assert.deepEqual([h.rpcCalls.length, h.calls.length], [0, 1]);
  assert.equal((await response.json()).result.contract_version, "1.1.0");
});

Deno.test("Composio actual customer handler owns admission binding and finish while the gateway forwards no tenant authority", async () => {
  const operation = "composio.discover_toolkits", calls: string[] = [];
  let requestId = "", bound = false, providers = 0;
  const backend = createComposioReadHandler({
    base: "https://example.supabase.co",
    anon: "test-anon-key",
    service: "test-service-credential",
    key: "synthetic-composio-key",
    authenticate: async (token) => {
      assert.equal(token, "test-user-jwt");
      return { id: extensionActor, confirmed: true };
    },
    rpc: async (name, input, token, service) => {
      calls.push(name);
      if (name === "sandy_composio_read_admit") {
        assert.equal(token, "test-user-jwt");
        assert.equal(service, false);
        assert.equal(input.p_operation, operation);
        assert.equal(input.p_channel, "mcp");
        requestId = String(input.p_request_id);
        assert.match(requestId, /^[a-f0-9-]{36}$/i);
        return {
          ok: true,
          reused: false,
          admission_id: productAdmissionId,
          grant_id: productRequestId,
          actor_id: extensionActor,
          tenant_id: extensionTenant,
          request_id: requestId,
        };
      }
      assert.equal(token, "test-service-credential");
      assert.equal(service, true);
      if (name === "sandy_composio_read_bind") {
        assert.equal(input.p_actor, extensionActor);
        assert.equal(input.p_admission_id, productAdmissionId);
        assert.equal(input.p_grant_id, productRequestId);
        bound = true;
        return {
          ok: true,
          admission_id: productAdmissionId,
          claim_id: productRequestId,
          actor_id: extensionActor,
          tenant_id: extensionTenant,
          request_id: requestId,
          operation,
          connections: [],
          profiles: [],
          profile: null,
        };
      }
      assert.equal(name, "sandy_composio_read_finish");
      assert.equal(providers, 1);
      return {
        ok: true,
        admission_id: productAdmissionId,
        request_id: requestId,
        state: input.p_outcome,
        result_sha256: input.p_result_sha256,
      };
    },
    fetch: (async (url, init) => {
      assert.equal(bound, true);
      providers++;
      assert.equal(new URL(String(url)).origin, "https://backend.composio.dev");
      assert.equal(
        new URL(String(url)).searchParams.get("user_ids"),
        "sandy_customer_" + extensionTenant,
      );
      assert.equal(
        new Headers(init?.headers).get("x-api-key"),
        "synthetic-composio-key",
      );
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return Response.json({ items: [], next_cursor: null });
    }) as typeof fetch,
  });
  const h = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    backend: (url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(Object.hasOwn(body, "tenant_id"), false);
      assert.equal(Object.hasOwn(body, "actor_id"), false);
      return backend(new Request(url, init));
    },
  });
  const response = await h.request({
    action: "execute",
    operation,
    arguments: {},
    channel: "mcp",
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(calls, [
    "sandy_composio_read_admit",
    "sandy_composio_read_bind",
    "sandy_composio_read_finish",
  ]);
  assert.deepEqual([h.rpcCalls.length, h.calls.length, providers], [0, 1, 1]);
});

Deno.test("dedicated engineering identity never falls back to broad owner access when its policy is absent", async () => {
  const machine = "10000000-0000-4000-8000-000000000001",
    session = "10000000-0000-4000-8000-000000000003";
  const metadata = { sandy_engineering_test: true, sandy_engineering_epoch: 1 };
  const jwt = "synthetic." +
    btoa(
      JSON.stringify({
        sub: machine,
        aud: "authenticated",
        role: "authenticated",
        session_id: session,
        exp: Date.now() / 1000 + 3600,
        app_metadata: metadata,
      }),
    ) + ".signature";
  const h = harness({
    actorId: machine,
    role: "owner",
    authMetadata: metadata,
    rpcHandler: () => ({
      ok: false,
      error: "engineering_identity_not_authorized",
    }),
  });
  const r = await h.handler(
    new Request(
      "https://example.supabase.co/functions/v1/sandy-operation-api",
      {
        method: "POST",
        headers: { authorization: "Bearer " + jwt },
        body: JSON.stringify({
          action: "execute",
          operation: "github.files.update",
          arguments: {},
        }),
      },
    ),
  );
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "engineering_identity_not_authorized");
  assert.equal(h.calls.length, 0);
});
Deno.test("tagged workload still requires normal Auth verification before any scoped policy RPC", async () => {
  const h = harness({
    authMetadata: { sandy_engineering_test: true, sandy_engineering_epoch: 1 },
    authError: true,
  });
  const r = await h.handler(
    new Request(
      "https://example.supabase.co/functions/v1/sandy-operation-api",
      {
        method: "POST",
        headers: { authorization: "Bearer expired.identity.token" },
        body: JSON.stringify({ action: "list" }),
      },
    ),
  );
  assert.equal(r.status, 401);
  assert.equal(h.calls.length, 0);
  assert.equal(h.rpcCalls.length, 0);
});

Deno.test("scoped workload discovery includes approved write handlers without widening ordinary delegated access", async () => {
  const machine = "10000000-0000-4000-8000-000000000001",
    owner = "10000000-0000-4000-8000-000000000002",
    session = "10000000-0000-4000-8000-000000000003";
  const metadata = { sandy_engineering_test: true, sandy_engineering_epoch: 1 };
  const jwt = "synthetic." +
    btoa(
      JSON.stringify({
        sub: machine,
        aud: "authenticated",
        role: "authenticated",
        session_id: session,
        exp: Date.now() / 1000 + 3600,
        app_metadata: metadata,
      }),
    ) + ".signature";
  const digest = await argumentDigest(engineeringPolicy);
  // Resolve the real policy hash; the provider authorization is not mocked as a broad owner.
  const scoped = harness({
    actorId: machine,
    authorityId: owner,
    authMetadata: metadata,
    rows: [extensionRow("github.commit", true), preflight],
    rpcHandler: () => ({
      ok: true,
      identity_user_id: machine,
      owner_authority_id: owner,
      session_id: session,
      credential_epoch: 1,
      policy_sha256: digest,
      operations: engineeringPolicy.operations,
    }),
  });
  const response = await scoped.handler(
    new Request(
      "https://example.supabase.co/functions/v1/sandy-operation-api",
      {
        method: "POST",
        headers: { authorization: "Bearer " + jwt },
        body: JSON.stringify({ action: "list", channel: "mcp" }),
      },
    ),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const value = await response.json();
  assert.deepEqual(value.operations.map((row: Row) => row.operation).sort(), [
    "github.commit",
  ]);
  assert.equal(scoped.calls.length, 0);
});

Deno.test("verified new customer discovers onboarding before a portal account exists", async () => {
  const h = harness({
    actorId: extensionActor,
    role: null,
    emailConfirmed: true,
    rows: [
      extensionRow("customer.onboarding.ensure", true),
      extensionRow("customer.identity.get", true),
    ],
  });
  const r = await h.request({ action: "list", channel: "mcp" });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(
    (await r.json()).operations.map((x: Row) => x.operation).sort(),
    ["customer.identity.get", "customer.onboarding.ensure"],
  );
});
Deno.test("onboarding keeps actual customer bearer and stable request id through gateway", async () => {
  const h = harness({
    actorId: extensionActor,
    role: null,
    emailConfirmed: true,
    rows: [extensionRow("customer.onboarding.ensure", true)],
    backend: () =>
      Response.json({
        ok: false,
        error: "onboarding_required",
        executed: false,
      }, { status: 409 }),
  });
  const r = await h.request({
    action: "execute",
    operation: "customer.onboarding.ensure",
    arguments: {},
    channel: "mcp",
  });
  assert.equal(r.status, 409, await r.clone().text());
  assert.equal(h.calls.length, 1);
  const call = h.calls[0];
  assert.ok(call.url.endsWith("/functions/v1/sandy-customer-provisioning-api"));
});
Deno.test("unverified users cannot discover customer onboarding even without existing portal", async () => {
  const h = harness({
    actorId: extensionActor,
    role: null,
    emailConfirmed: false,
    rows: [extensionRow("customer.onboarding.ensure", true)],
  });
  const r = await h.request({ action: "list", channel: "mcp" });
  assert.equal(r.status, 403);
  assert.equal(h.calls.length, 0);
});

Deno.test("completed onboarding propagates its truthful execution claim through API and MCP", async () => {
  const result = {
    ok: true,
    contract_version: "1.0.0",
    executed: true,
    request_state: "succeeded",
    request_id: productRequestId,
    reconciliation_required: false,
    customer_id: extensionTenant,
    created: true,
    reused: false,
    phase: "verified",
    version: 1,
    display_name: "Fixture",
    organisation_name: null,
    channels: [{
      channel: "email",
      subject: "fixture-user@example.invalid",
      verified: true,
    }],
    permissions_source: "existing_verified_portal_and_channel_grants",
    memory_customer_id: extensionTenant,
    automatic_provisioning: false,
  };
  const h = harness({
    actorId: extensionActor,
    role: null,
    emailConfirmed: true,
    rows: [extensionRow("customer.onboarding.ensure", true)],
    backend: () => Response.json(result),
  });
  const mcp = createMcpHandler(async (_token, body) => {
    const response = await h.request(body);
    return { status: response.status, result: await response.json() };
  });
  const response = await mcp(
    new Request("https://mcp.test.invalid", {
      method: "POST",
      headers: { authorization: "Bearer normal.test.session" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "customer.onboarding.ensure", arguments: {} },
      }),
    }),
  );
  const value = await response.json();
  assert.equal(value.result.isError, false);
  assert.deepEqual(value.result.structuredContent, result);
  assert.equal(h.calls.length, 1);
});

Deno.test("resource provisioning is hidden until a verified customer portal is bound", async () => {
  const rows = [
    extensionRow("customer.onboarding.ensure", true),
    extensionRow("customer.provisioning.execute", true),
    extensionRow("customer.resources.list", true),
  ];
  const fresh = harness({
    actorId: extensionActor,
    role: null,
    emailConfirmed: true,
    rows,
  });
  const before = await fresh.request({ action: "list", channel: "mcp" });
  assert.deepEqual(
    (await before.json()).operations.map((r: Row) => r.operation),
    ["customer.onboarding.ensure"],
  );
  const customer = harness({
    actorId: extensionActor,
    role: null,
    emailConfirmed: true,
    memoryTenant: extensionTenant,
    rows,
  });
  const after = await customer.request({ action: "list", channel: "mcp" });
  assert.deepEqual(
    (await after.json()).operations.map((r: Row) => r.operation).sort(),
    rows.map((r) => r.operation).sort(),
  );
});

Deno.test("owner-approved VM diagnostics retain real workload Auth and fixed service routing through the gateway", async () => {
  const machine = "10000000-0000-4000-8000-000000000001",
    owner = "10000000-0000-4000-8000-000000000002",
    session = "10000000-0000-4000-8000-000000000003";
  const metadata = { sandy_engineering_test: true, sandy_engineering_epoch: 1 };
  const jwt = "synthetic." +
    btoa(
      JSON.stringify({
        sub: machine,
        aud: "authenticated",
        role: "authenticated",
        session_id: session,
        exp: Date.now() / 1000 + 3600,
        app_metadata: metadata,
      }),
    ) + ".signature";
  const vmScope = {
    policy_sha256: await argumentDigest(engineeringVmReadPolicy),
    owner_authority_id: owner,
    source_change_id: productRequestId,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    operations: engineeringVmReadPolicy.operations,
  };
  const digest = await argumentDigest(engineeringPolicy);
  const row = {
    ...videoRead("video.status"),
    input_schema: {
      type: "object",
      properties: { target: { const: "sandy-video" } },
    },
  };
  const h = harness({
    actorId: machine,
    authorityId: owner,
    authMetadata: metadata,
    rows: [row],
    rpcHandler: (name) =>
      name === "sandy_engineering_resolve_identity"
        ? {
          ok: true,
          identity_user_id: machine,
          owner_authority_id: owner,
          session_id: session,
          credential_epoch: 1,
          policy_sha256: digest,
          operations: engineeringPolicy.operations,
          vm_read_scope: vmScope,
        }
        : { ok: true },
    backend: () =>
      Response.json({
        ok: true,
        name: "sandy-video",
        status: "RUNNING",
        instance_id: engineeringVmReadPolicy.instance_id,
      }),
  });
  const r = await h.handler(
    new Request(
      "https://example.supabase.co/functions/v1/sandy-operation-api",
      {
        method: "POST",
        headers: { authorization: "Bearer " + jwt },
        body: JSON.stringify({
          action: "execute",
          operation: "video.status",
          arguments: {},
          channel: "mcp",
        }),
      },
    ),
  );
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).result.name, "sandy-video");
  assert.equal(h.calls.length, 1);
  assert.ok(h.calls[0].url.endsWith("/sandy-deploy-provision"));
  assert.equal(
    JSON.parse(String(h.calls[0].init?.body)).action,
    "video_status",
  );
  assert.ok(h.identityTokens.every((t) => t === jwt));
});
