import { providerOperations as gatewayOperations } from "./gateway.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { createCredentialConsumer } from "../_shared/sandy_credential_consumer.ts";
import {
  deepStrictEqual as assertEquals,
  throws as assertThrows,
} from "node:assert/strict";
import {
  bindProviderRequest,
  createProviderOperationHandler,
  type FinishRequest,
  normalizeFinishReceipt,
  projectValue,
  type ProviderDependencies,
  providerExecutionScope,
  providerOperations,
  providerOutputSchema,
  validateAllContracts,
} from "./index.ts";
const authSchema =
  (providerOperations["supabase.project.config.auth.get"].$defs as any)
    .AuthConfigResponse_Output;
const authFixture = {
  ...Object.fromEntries(authSchema.required.map((key: string) => {
    const type = authSchema.properties[key].type;
    return [
      key,
      Array.isArray(type) && type.includes("null")
        ? null
        : type === "boolean"
        ? false
        : type === "integer"
        ? 1
        : "",
    ];
  })),
  jwt_exp: 3600,
  site_url: "https://example.test",
  disable_signup: false,
  jwt_secret: "DO_NOT_RETURN",
};
const ACTOR = "10000000-0000-4000-8000-000000000001",
  REQUEST = "10000000-0000-4000-8000-000000000002",
  GRANT = "10000000-0000-4000-8000-000000000003",
  ADMISSION = "10000000-0000-4000-8000-000000000004";
function harness(overrides: Partial<ProviderDependencies> = {}) {
  const finishes: FinishRequest[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  let consumes = 0;
  const deps: ProviderDependencies = {
    service: "internal",
    management: "management-fixture",
    github: "github-fixture",
    getGcpAccessToken: () => Promise.resolve("gcp-fixture"),
    authorizeContext: () => Promise.resolve({ allowed: true }),
    consumeGrant: () => {
      consumes++;
      return Promise.resolve({ allowed: true, admission_id: ADMISSION });
    },
    finishExecution: (r) => {
      finishes.push(r);
      return Promise.resolve({ allowed: true });
    },
    fetch: ((url: URL | string, init: RequestInit) => {
      requests.push({ url: String(url), init });
      return Promise.resolve(
        new Response(JSON.stringify(authFixture), {
          status: 200,
          headers: { "x-request-id": "req-fixture" },
        }),
      );
    }) as typeof fetch,
    ...overrides,
  };
  const handler = createProviderOperationHandler(deps);
  const call = (
    operation = "supabase.project.config.auth.get",
    args: Record<string, unknown> = {},
    body: Record<string, unknown> = {},
  ) =>
    handler(
      new Request("https://sandy.test", {
        method: "POST",
        headers: {
          authorization: "Bearer internal",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation,
          arguments: args,
          actor_id: ACTOR,
          tenant_id: null,
          request_id: REQUEST,
          grant_id: GRANT,
          ...body,
        }),
      }),
    );
  return { call, handler, finishes, requests, consumes: () => consumes };
}
Deno.test("all reviewed input/provider-response/public schemas compile", () =>
  assertEquals(validateAllContracts(), 595));
Deno.test("fixed provider scope rejects altered configured targets", () => {
  assertThrows(() =>
    providerExecutionScope("github.repos.get", { repository: "evil/repo" })
  );
  assertEquals(providerExecutionScope("supabase.domains.inspect"), {
    provider: "supabase",
    project_ref: "zmqlyygzqoidkcwdysok",
  });
});
Deno.test("path binder percent encodes repository refs and never accepts a host override", () => {
  const op = providerOperations["github.refs.get"];
  assertEquals(
    bindProviderRequest(op, { path: { ref: "heads/feature" } }).href,
    "https://api.github.com/repos/ausstyle/web-staging/git/ref/heads%2Ffeature",
  );
  for (const ref of ["../other", "%2e%2e", "a?secret", "a#secret", "a\\b"]) {
    assertThrows(() => bindProviderRequest(op, { path: { ref } }));
  }
});
Deno.test("GCP references cannot escape configured project or region", () => {
  const op = providerOperations["gcp.projects.get"];
  assertEquals(
    bindProviderRequest(op, {}).href,
    "https://cloudresourcemanager.googleapis.com/v3/projects/elaborate-haven-511518-a5",
  );
  for (
    const name of [
      "projects/foreign/roles/x",
      "projects/elaborate-haven-511518-a5/locations/us-east1/x",
      "https://attacker.invalid/payload",
    ]
  ) assertThrows(() => bindProviderRequest(op, { body: { name } }));
});
Deno.test("internal service authentication is mandatory", async () => {
  const h = harness();
  const result = await h.handler(
    new Request("https://sandy.test", { method: "POST", body: "{}" }),
  );
  assertEquals(result.status, 403);
  assertEquals(h.consumes(), 0);
});
Deno.test("unknown argument and context token overrides fail closed", async () => {
  const h = harness();
  for (
    const args of [{ url: "https://attacker.invalid" }, {
      path: { ref: "other" },
    }, { body: { anything: true } }]
  ) assertEquals((await h.call(undefined, args)).status, 400);
  assertEquals((await h.call(undefined, {}, { token: "stolen" })).status, 400);
  assertEquals(h.requests.length, 0);
});
Deno.test("missing one-use grant is rejected before provider HTTP", async () => {
  const h = harness();
  const result = await h.call(undefined, {}, { grant_id: null });
  assertEquals(result.status, 400);
  assertEquals(h.requests.length, 0);
});
Deno.test("owner and current registry authorization refuse without consumption", async () => {
  const h = harness({
    authorizeContext: () =>
      Promise.resolve({
        allowed: false,
        error: "verified_execution_contract_required",
        http_status: 403,
      }),
  });
  assertEquals((await h.call()).status, 403);
  assertEquals(h.consumes(), 0);
  assertEquals(h.requests.length, 0);
});
Deno.test("replayed grant cannot repeat provider execution", async () => {
  let identities = 0;
  const h = harness({
    credentialForExecution: () => {
      identities++;
      return Promise.resolve("unused");
    },
    consumeGrant: () =>
      Promise.resolve({ allowed: true, reused: true, admission_id: ADMISSION }),
  });
  assertEquals((await h.call()).status, 409);
  assertEquals(h.requests.length, 0);
  assertEquals(identities, 0);
});
Deno.test("safe metadata projection strips provider credential fields and records digest receipt", async () => {
  const h = harness();
  const result = await h.call();
  const raw = await result.text();
  assertEquals(result.status, 200);
  assertEquals(raw.includes("DO_NOT_RETURN"), false);
  const value = JSON.parse(raw);
  assertEquals(value.request_state, "observed");
  assertEquals(value.admission_id, ADMISSION);
  assertEquals(value.provider_request_id, "req-fixture");
  assertEquals(h.finishes[0].outcome, "succeeded");
  assertEquals(/^[a-f0-9]{64}$/.test(h.finishes[0].result_sha256), true);
  assertEquals(h.requests[0].init.redirect, "error");
});
Deno.test("provider HTTP2xx mutations only receive acceptance receipts", async () => {
  const h = harness({
    fetch: (() =>
      Promise.resolve(
        new Response(JSON.stringify({}), { status: 200 }),
      )) as typeof fetch,
  });
  const result = await h.call("supabase.projects.pause");
  assertEquals(result.status, 200);
  const value = await result.json();
  assertEquals(value.request_state, "accepted");
  assertEquals(value.result.effect_confirmed, false);
  assertEquals(h.finishes[0].outcome, "accepted");
});
Deno.test("provider transport loss records explicit unknown outcome", async () => {
  const h = harness({
    fetch: (() =>
      Promise.reject(new Error("contains-token-secret"))) as typeof fetch,
  });
  const result = await h.call();
  const raw = await result.text();
  assertEquals(result.status, 502);
  assertEquals(raw.includes("contains-token"), false);
  assertEquals(JSON.parse(raw).executed, true);
  assertEquals(h.finishes[0].outcome, "unknown");
});
Deno.test("lost finish receipt never reports success", async () => {
  const h = harness({
    finishExecution: () => Promise.reject(new Error("lost")),
  });
  const result = await h.call();
  assertEquals(result.status, 503);
  assertEquals((await result.json()).error, "execution_receipt_state_unknown");
});
Deno.test("nonconforming provider JSON is not silently projected", async () => {
  const h = harness({
    fetch: (() =>
      Promise.resolve(
        new Response(JSON.stringify({ jwt_exp: "wrong" }), { status: 200 }),
      )) as typeof fetch,
  });
  const result = await h.call();
  assertEquals(result.status, 502);
  assertEquals(h.finishes[0].outcome, "failed");
});
Deno.test("custom domain entitlement failure is independent of installed handler", async () => {
  const h = harness({
    fetch: (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: "entitlement_required" } }),
          { status: 400 },
        ),
      )) as typeof fetch,
  });
  const result = await h.call("supabase.domains.create", {
    body: { custom_hostname: "api.example.test" },
  });
  assertEquals(result.status, 424);
  assertEquals((await result.json()).error, "provider_entitlement_required");
  assertEquals(h.consumes(), 1);
  assertEquals(h.finishes[0].outcome, "failed");
});
Deno.test("composed provider execution consumes its grant before resolving and using the active custody token", async () => {
  const token = "sbp_synthetic_active_consumer_token";
  const targetId = "10000000-0000-4000-8000-000000000005";
  const versionId = "10000000-0000-4000-8000-000000000006";
  const resource = { secret_name: "SANDY_SUPABASE_MANAGEMENT_TOKEN" };
  const config = await argumentDigest({
    version: "1.0.0",
    target_id: targetId,
    provider: "supabase_edge_secret",
    resource,
  });
  const material = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  const events: string[] = [];
  const withCredential = createCredentialConsumer({
    db: {
      rpc(name, args) {
        events.push("resolve");
        assertEquals(name, "sandy_credential_resolve_consumer");
        assertEquals(args.p_actor, ACTOR);
        assertEquals(args.p_admission, ADMISSION);
        return Promise.resolve({
          error: null,
          data: {
            ok: true,
            source: "vault_active",
            consumer: "supabase_management",
            admission_id: ADMISSION,
            active_version_id: versionId,
            value: token,
            material_sha256: material,
            provider_version_id: "fixture",
            target: {
              id: targetId,
              provider: "supabase_edge_secret",
              resource,
              enabled: true,
              verified: true,
              active_version_id: versionId,
              config_sha256: config,
              scope_sha256: awaitScope,
            },
          },
        });
      },
    },
    legacy: {
      supabase_management: () => {
        throw Error("must not use old token");
      },
      github_api: () => "",
      gcp_access_token: () => "",
    },
  });
  const awaitScope = await argumentDigest({
    sandy_project_ref: "zmqlyygzqoidkcwdysok",
    gcp_project_id: "elaborate-haven-511518-a5",
    github_repository: "ausstyle/web-staging",
    credential_target_id: targetId,
    credential_provider: "supabase_edge_secret",
    target_config_sha256: config,
  });
  const h = harness({
    consumeGrant: () => {
      events.push("consume");
      return Promise.resolve({ allowed: true, admission_id: ADMISSION });
    },
    credentialForExecution: (_op, execution) =>
      withCredential(
        "supabase_management",
        execution,
        (value) => Promise.resolve(value),
      ),
    fetch: ((_, init) => {
      events.push("provider");
      assertEquals(
        (init?.headers as Record<string, string>).authorization,
        `Bearer ${token}`,
      );
      return Promise.resolve(new Response(JSON.stringify(authFixture)));
    }) as typeof fetch,
  });
  const result = await h.call();
  assertEquals(result.status, 200);
  assertEquals(events, ["consume", "resolve", "provider"]);
  assertEquals((await result.text()).includes(token), false);
  assertEquals(JSON.stringify(h.finishes).includes(token), false);
});
Deno.test("active custody refusal finishes a consumed grant without provider dispatch or environment fallback", async () => {
  let legacy = 0;
  const withCredential = createCredentialConsumer({
    db: {
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { message: "consumer_active_pointer_removed" },
        }),
    },
    legacy: {
      supabase_management: () => {
        legacy++;
        return "old_revoked_fixture";
      },
      github_api: () => "",
      gcp_access_token: () => "",
    },
  });
  const h = harness({
    credentialForExecution: (_op, execution) =>
      withCredential(
        "supabase_management",
        execution,
        (token) => Promise.resolve(token),
      ),
  });
  const result = await h.call();
  assertEquals(result.status, 424);
  assertEquals(legacy, 0);
  assertEquals(h.consumes(), 1);
  assertEquals(h.requests.length, 0);
  assertEquals(h.finishes[0].outcome, "failed");
  assertEquals((await result.json()).error, "consumer_active_pointer_removed");
});
Deno.test("domain inspection returns actual nested DNS proofs only", async () => {
  const h = harness({
    fetch: (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "2_initiated",
            custom_hostname: "api.example.test",
            data: {
              success: true,
              errors: [],
              messages: [],
              result: {
                id: "id",
                hostname: "api.example.test",
                ownership_verification: {
                  type: "txt",
                  name: "_verify.api.example.test",
                  value: "public-proof",
                },
                ssl: {
                  validation_records: [{
                    txt_name: "_acme.api.example.test",
                    txt_value: "dns-proof",
                  }],
                  validation_errors: [{ message: "pending" }],
                },
              },
            },
          }),
          { status: 200 },
        ),
      )) as typeof fetch,
  });
  const result = await h.call("supabase.domains.inspect");
  assertEquals(result.status, 200);
  const data = await result.json();
  assertEquals(data.result.ownership_verification.value, "public-proof");
  assertEquals(data.result.ssl_validation_records[0].txt_value, "dns-proof");
  assertEquals(data.result.validation_error_count, 1);
});
Deno.test("nested projections bound arrays and omit opaque values", () => {
  assertEquals(
    projectValue({
      items: [{ name: "a", access_token: "bad" }],
      opaque: { a: "bad" },
    }, {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" } },
            additionalProperties: false,
          },
        },
        opaque: { type: "object", properties: {}, additionalProperties: false },
      },
      additionalProperties: false,
    }, {}),
    { items: [{ name: "a" }], opaque: {} },
  );
});
Deno.test("policy grant digests bind actor input contract and actual target scope", async () => {
  let grant: any;
  const h = harness({
    consumeGrant: (r) => {
      grant = r;
      return Promise.resolve({ allowed: true, admission_id: ADMISSION });
    },
  });
  await h.call();
  assertEquals(grant.actor_id, ACTOR);
  assertEquals(
    grant.contract_sha256,
    providerOperations["supabase.project.config.auth.get"].contract_sha256,
  );
  assertEquals(/^[a-f0-9]{64}$/.test(grant.input_sha256), true);
  assertEquals(/^[a-f0-9]{64}$/.test(grant.scope_sha256), true);
});
Deno.test("provider response stream is bounded even without Content-Length", async () => {
  const h = harness({
    fetch: (() =>
      Promise.resolve(
        new Response('"' + "a".repeat(2 * 1024 * 1024) + '"', { status: 200 }),
      )) as typeof fetch,
  });
  assertEquals((await h.call()).status, 502);
  assertEquals(h.finishes[0].outcome, "unknown");
});

Deno.test("actual SQL finish reply is normalized and exact receipt replay remains recorded", () => {
  const receipt: FinishRequest = {
    admission_id: ADMISSION,
    outcome: "succeeded",
    provider_http_status: 200,
    provider_request_id: null,
    result_sha256: "a".repeat(64),
  };
  for (const reused of [false, true]) {
    assertEquals(
      normalizeFinishReceipt(receipt, {
        ok: true,
        admission_id: ADMISSION,
        state: "succeeded",
        reused,
      }).allowed,
      true,
    );
  }
  for (
    const value of [
      { ok: true },
      { ok: true, admission_id: ADMISSION, state: "accepted", reused: false },
      { ok: true, admission_id: GRANT, state: "succeeded", reused: false },
      { ok: false, admission_id: ADMISSION, state: "succeeded", reused: false },
    ]
  ) assertEquals(normalizeFinishReceipt(receipt, value).allowed, false);
  assertEquals(
    providerOutputSchema("supabase.project.config.auth.get").properties
      .admission_id.format,
    "uuid",
  );
});

Deno.test("extra organization and billing scopes refuse absent verified server bindings", async () => {
  const h = harness();
  for (
    const op of [
      "gcp.organizations.get",
      "gcp.billing.accounts.get",
      "gcp.folders.get",
    ]
  ) {
    const result = await h.call(op);
    assertEquals(result.status, 424);
    assertEquals((await result.json()).error.startsWith("verified_"), true);
  }
  assertEquals(h.consumes(), 0);
});
Deno.test("configured scope is bound into admission and caller cannot replace its identifier", () => {
  const config = {
    verifiedBindings: {
      organization: {
        id: "12345",
        verified: true as const,
        project_id: "elaborate-haven-511518-a5" as const,
      },
    },
  };
  assertEquals(
    bindProviderRequest(providerOperations["gcp.organizations.get"], {}, config)
      .href,
    "https://cloudresourcemanager.googleapis.com/v3/organizations/12345",
  );
  assertEquals(
    providerExecutionScope("gcp.organizations.get", config).configured_bindings,
    { organization: "organizations/12345" },
  );
  assertThrows(() =>
    bindProviderRequest(providerOperations["gcp.budgets.get"], {
      path: { name: "billingAccounts/AAAAAA-BBBBBB-CCCCCC/budgets/one" },
    }, config)
  );
});
Deno.test("WIF service paths use fixed global location without caller override", () => {
  const op = providerOperations["gcp.workload_identity.pools.list"];
  assertEquals(
    bindProviderRequest(op, {}).href,
    "https://iam.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/global/workloadIdentityPools",
  );
});
Deno.test("bucket project ownership is checked before target object access", async () => {
  let calls = 0;
  const h = harness({
    fetch: (() => {
      calls++;
      return Promise.resolve(
        new Response(JSON.stringify({ projectNumber: "foreign" }), {
          status: 200,
        }),
      );
    }) as typeof fetch,
  });
  const result = await h.call("gcp.storage.objects.get", {
    path: { bucket: "existing-bucket", object: "safe-object" },
  });
  assertEquals(result.status, 403);
  assertEquals(calls, 1);
  assertEquals(h.finishes[0].outcome, "failed");
});
Deno.test("GCP VM identity and scratch disk types survive safe projection", () => {
  const op = providerOperations["gcp.compute.instances.get"];
  assertEquals(
    projectValue(
      {
        id: "123",
        name: "fixture",
        status: "RUNNING",
        disks: [{ type: "SCRATCH", diskEncryptionKey: { rawKey: "secret" } }],
      },
      op.result_schema,
      op.public_defs,
    ),
    {
      id: "123",
      name: "fixture",
      status: "RUNNING",
      disks: [{ type: "SCRATCH" }],
    },
  );
});
Deno.test("GitHub directory metadata follows its own documented type", async () => {
  const h = harness({
    fetch: (() =>
      Promise.resolve(
        new Response(
          JSON.stringify([{
            type: "dir",
            size: 0,
            name: "docs",
            path: "docs",
            sha: "a".repeat(40),
            url:
              "https://api.github.com/repos/ausstyle/web-staging/contents/docs",
            git_url:
              "https://api.github.com/repos/ausstyle/web-staging/git/trees/" +
              "a".repeat(40),
            html_url: "https://github.com/ausstyle/web-staging/tree/main/docs",
            download_url: null,
            _links: {
              self:
                "https://api.github.com/repos/ausstyle/web-staging/contents/docs",
              git:
                "https://api.github.com/repos/ausstyle/web-staging/git/trees/" +
                "a".repeat(40),
              html: "https://github.com/ausstyle/web-staging/tree/main/docs",
            },
          }]),
          { status: 200 },
        ),
      )) as typeof fetch,
  });
  const result = await h.call("github.files.metadata.get", {
    path: { path: "docs" },
  });
  assertEquals(result.status, 200);
  assertEquals((await result.json()).result[0].type, "dir");
});
Deno.test("private file preimage reads are bounded to approved fixture namespace", async () => {
  const h = harness();
  assertEquals(
    (await h.call("github.files.content.get", { path: { path: ".env" } }))
      .status,
    400,
  );
  assertEquals(h.requests.length, 0);
  const op = providerOperations["github.files.content.get"];
  assertEquals(op.api_exposed, false);
  assertEquals(op.requires_grant, true);
});
Deno.test("quota requests bind project/global and retain provider safety checks", () => {
  const op = providerOperations["gcp.quotas.request"];
  assertEquals(
    bindProviderRequest(op, {}).href,
    "https://cloudquotas.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/global/quotaPreferences",
  );
  assertEquals(
    Object.hasOwn(
      (op.input_schema as any).properties.query.properties,
      "ignoreSafetyChecks",
    ),
    false,
  );
  assertEquals(op.api_exposed, false);
});

Deno.test("compact gateway fingerprints match the executable full schemas", async () => {
  assertEquals(Object.keys(gatewayOperations), Object.keys(providerOperations));
  for (const [operation, full] of Object.entries(providerOperations)) {
    const compact = gatewayOperations[operation];
    assertEquals(compact.contract_sha256, full.contract_sha256, operation);
    assertEquals(
      compact.input_schema_sha256,
      await argumentDigest(full.input_schema),
      operation,
    );
    assertEquals(
      compact.output_schema_sha256,
      await argumentDigest(full.output_schema),
      operation,
    );
  }
});
