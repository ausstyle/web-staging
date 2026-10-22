import {
  createServiceHandler,
  type Dependencies,
  projectUser,
  validateServiceContracts,
} from "./index.ts";
import { serviceOperations, serviceScope } from "./contracts.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    JSON.stringify({ actual, expected }),
  );
}
const actor = "00000000-0000-4000-8000-000000000001",
  tenant = "00000000-0000-4000-8000-000000000002",
  user = "00000000-0000-4000-8000-000000000003",
  admission = "00000000-0000-4000-8000-000000000004",
  grant = "00000000-0000-4000-8000-000000000005",
  request = "00000000-0000-4000-8000-000000000006";
const rawUser = {
  id: user,
  email: "fixture@example.invalid",
  created_at: "2026-01-01T00:00:00Z",
  user_metadata: { password: "do-not-disclose" },
  app_metadata: { secret: "do-not-disclose" },
  encrypted_password: "do-not-disclose",
  identities: [{ token: "do-not-disclose" }],
};
function fixture(overrides: Partial<Dependencies> = {}) {
  const calls: { name: string; value: unknown }[] = [];
  const record = (name: string, value: unknown) => calls.push({ name, value });
  const auth = {
    admin: {
      getUserById: (id: string) => {
        record("getUserById", id);
        return Promise.resolve({ data: { user: rawUser }, error: null });
      },
      createUser: (value: unknown) => {
        record("createUser", value);
        return Promise.resolve({ data: { user: rawUser }, error: null });
      },
    },
  };
  const deps: Dependencies = {
    service: "internal-service",
    projectUrl: "https://zmqlyygzqoidkcwdysok.supabase.co",
    client: { auth } as unknown as Dependencies["client"],
    authorizeContext: async () => ({ allowed: true }),
    consumeGrant: async (value) => {
      record("grant", value);
      return { allowed: true, reused: false, admission_id: admission };
    },
    finishExecution: async (value) => {
      record("finish", value);
      return { allowed: true };
    },
    rpc: async (name, value) => {
      record(name, value);
      return {
        data: {
          ok: true,
          bucket_id: "sandy-service-v1-tenant-" + tenant,
          user_ids: [user],
        },
        error: null,
      };
    },
    ...overrides,
  };
  const handler = createServiceHandler(deps);
  const invoke = (
    operation: string,
    args: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) =>
    handler(
      new Request("https://fixture.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer internal-service",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation,
          arguments: { tenant_id: tenant, ...args },
          actor_id: actor,
          tenant_id: null,
          request_id: request,
          grant_id: grant,
          ...extra,
        }),
      }),
    );
  return { deps, calls, handler, invoke };
}
Deno.test("all 46 service contracts compile; SDK and SQL routes are concrete", () => {
  equal(validateServiceContracts(), 46);
  assert(
    Object.values(serviceOperations).every((op) =>
      ["sdk", "sql"].includes(op.kind)
    ),
  );
  assert(!serviceOperations["supabase.vault.secrets.delete"]);
});
Deno.test("internal identity and fixed project are checked before policy/provider", async () => {
  const f = fixture();
  const denied = await f.handler(
    new Request("https://fixture.invalid", {
      method: "POST",
      headers: { authorization: "Bearer customer-session" },
      body: "{}",
    }),
  );
  equal(denied.status, 401);
  equal(f.calls.length, 0);
  const other = fixture({ projectUrl: "https://other.supabase.co" });
  equal(
    (await other.invoke("supabase.auth.users.get", { user_id: user })).status,
    503,
  );
  equal(other.calls.length, 0);
});
Deno.test("reject caller credential substitution, additional properties and path traversal", async () => {
  for (
    const [op, args] of [
      ["supabase.auth.users.create", {
        email: "fixture@example.invalid",
        email_confirm: true,
      }],
      ["supabase.storage.objects.get", { path: "../private" }],
      ["supabase.storage.objects.get", { path: "safe/%2e%2e/private" }],
      ["supabase.storage.buckets.create", { public: true }],
    ] as const
  ) {
    const f = fixture();
    equal((await f.invoke(op, args)).status, 400);
    equal(f.calls.length, 0);
  }
  const f = fixture();
  equal(
    (await f.invoke("supabase.auth.users.get", { user_id: user }, {
      credential_id: user,
    })).status,
    400,
  );
  equal(f.calls.length, 0);
});
Deno.test("grant is bound to exact input, compiled contract and fixed scope", async () => {
  const f = fixture();
  const response = await f.invoke("supabase.auth.users.get", { user_id: user });
  equal(response.status, 200);
  const consumed = f.calls.find((c) => c.name === "grant")!.value as Record<
    string,
    unknown
  >;
  equal(
    consumed.input_sha256,
    await argumentDigest({ tenant_id: tenant, user_id: user }),
  );
  equal(consumed.scope_sha256, await argumentDigest(serviceScope));
  equal(
    consumed.contract_sha256,
    serviceOperations["supabase.auth.users.get"].contract_sha256,
  );
  assert(
    f.calls.findIndex((c) => c.name === "sandy_supabase_service_authorize") <
      f.calls.findIndex((c) => c.name === "getUserById"),
  );
});
Deno.test("reused and conflicting grants cannot execute a provider", async () => {
  const f = fixture({
    consumeGrant: async () => ({
      allowed: true,
      reused: true,
      admission_id: admission,
    }),
  });
  equal(
    (await f.invoke("supabase.auth.users.get", { user_id: user })).status,
    409,
  );
  equal(f.calls.length, 0);
  const mismatch = fixture();
  equal(
    (await mismatch.invoke("supabase.auth.users.get", { user_id: user }, {
      admission_id: tenant,
    })).status,
    409,
  );
  assert(!mismatch.calls.some((c) => c.name === "getUserById"));
});
Deno.test("tenant consent refusal remains provider-free and records failed receipt", async () => {
  const f = fixture({
    rpc: async () => ({
      data: null,
      error: { message: "tenant policy denied" },
    }),
  });
  const result = await f.invoke("supabase.auth.users.get", { user_id: user });
  equal(result.status, 403);
  assert(!f.calls.some((c) => c.name === "getUserById"));
  const receipt = f.calls.find((c) => c.name === "finish")!.value as Record<
    string,
    unknown
  >;
  equal(receipt.outcome, "failed");
});
Deno.test("Auth projection discloses only selected safe metadata", async () => {
  const f = fixture();
  const result =
    await (await f.invoke("supabase.auth.users.get", { user_id: user })).json();
  assert(result.ok);
  equal(result.result.user.id, user);
  assert(!JSON.stringify(result).includes("do-not-disclose"));
  equal(Object.keys(projectUser(rawUser)), [
    "id",
    "email",
    "created_at",
    "updated_at",
    "email_confirmed_at",
    "last_sign_in_at",
    "banned_until",
    "deleted_at",
  ]);
});
Deno.test("admin creation never confirms email, creates login link or returns a password", async () => {
  const f = fixture();
  const result = await (await f.invoke("supabase.auth.users.create", {
    email: "fixture@example.invalid",
  })).json();
  assert(result.ok);
  equal(result.request_state, "accepted");
  const created = f.calls.find((c) => c.name === "createUser")!.value as Record<
    string,
    unknown
  >;
  equal(created.email_confirm, false);
  assert(
    typeof created.password === "string" && created.password.length === 96,
  );
  assert(!JSON.stringify(result).includes(created.password));
  assert(!Object.keys(created).includes("app_metadata"));
  const receipt = f.calls.find((c) => c.name === "finish")!.value as Record<
    string,
    unknown
  >;
  equal(receipt.outcome, "accepted");
  assert(f.calls.some((c) => c.name === "sandy_supabase_service_bind_user"));
});
Deno.test("provider errors never forward credential-bearing SDK details", async () => {
  const f = fixture();
  f.deps.client.auth.admin.getUserById = () =>
    Promise.reject(Error("authorization=private-service-key"));
  const result =
    await (await f.invoke("supabase.auth.users.get", { user_id: user })).text();
  assert(!result.includes("private-service-key"));
  assert(result.includes("provider_execution_outcome_unknown"));
});
Deno.test("unexpected SQL secret output fails schema projection and is never returned", async () => {
  const f = fixture({
    rpc: async (name) =>
      name === "sandy_supabase_service_execute"
        ? {
          data: { ok: true, result: { secrets: [], value: "private-secret" } },
          error: null,
        }
        : { data: { ok: true }, error: null },
  });
  const r = await f.invoke("supabase.vault.secrets.managed.list", {});
  equal(r.status, 502);
  assert(!(await r.text()).includes("private-secret"));
});
Deno.test("lost finish receipt cannot report completion", async () => {
  const f = fixture({ finishExecution: async () => ({ allowed: false }) });
  const r = await f.invoke("supabase.auth.users.get", { user_id: user });
  equal(r.status, 503);
  const body = await r.json();
  equal(body.ok, false);
  equal(body.reconciliation_required, true);
});
Deno.test("byte-sized request limit rejects oversized bodies", async () => {
  const f = fixture();
  const result = await f.handler(
    new Request("https://fixture.invalid", {
      method: "POST",
      headers: { authorization: "Bearer internal-service" },
      body: JSON.stringify({ padding: "x".repeat(200000) }),
    }),
  );
  equal(result.status, 413);
  equal(f.calls.length, 0);
});
Deno.test("official pinned SDK file-info casing is projected without arbitrary metadata", async () => {
  const { createClient } = await import("npm:@supabase/supabase-js@2.57.4");
  const client = createClient(
    "https://zmqlyygzqoidkcwdysok.supabase.co",
    "sdk-fixture",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input) => {
          assert(
            String(input).includes(
              "/storage/v1/object/info/sandy-service-v1-tenant-" + tenant +
                "/owned/file",
            ),
          );
          return Response.json({
            id: user,
            name: "owned/file",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
            size: 4,
            content_type: "text/plain",
            metadata: { private_token: "never-forward" },
          });
        },
      },
    },
  );
  const f = fixture({ client });
  const result = await (await f.invoke("supabase.storage.objects.get", {
    path: "owned/file",
  })).json();
  assert(result.ok);
  equal(result.result.object.created_at, "2026-01-01T00:00:00Z");
  equal(result.result.object.mimetype, "text/plain");
  assert(!JSON.stringify(result).includes("never-forward"));
});
Deno.test("actual observed provider status and request ID bind the execution receipt", async () => {
  const f = fixture({
    providerHttpMetadata: () => ({
      status: 200,
      request_id: "provider-observation-fixture",
    }),
  });
  await f.invoke("supabase.auth.users.create", {
    email: "fixture@example.invalid",
  });
  const receipt = f.calls.find((c) => c.name === "finish")!.value as Record<
    string,
    unknown
  >;
  equal(receipt.provider_http_status, 200);
  equal(receipt.provider_request_id, "provider-observation-fixture");
});
Deno.test("successful delete acceptance uses mutation HTTP, preserving expected404 readback", async () => {
  const f = fixture({
    providerHttpMetadata: () => ({
      status: 404,
      request_id: "expected-absence-readback",
      mutation_status: 200,
      mutation_request_id: "successful-provider-delete",
    }),
  });
  await f.invoke("supabase.auth.users.create", {
    email: "fixture@example.invalid",
  });
  const receipt = f.calls.find((c) => c.name === "finish")!.value as Record<
    string,
    unknown
  >;
  equal(receipt.provider_http_status, 200);
  equal(receipt.provider_request_id, "successful-provider-delete");
});
