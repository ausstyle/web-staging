import assert from "node:assert/strict";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  type ComposioReadDependencies,
  createComposioReadHandler,
} from "./index.ts";
import {
  composioReadContractMatches,
  composioReadOperations,
} from "./contracts.ts";
import { type Obj, reviewedSchema, validReadProfile } from "./providers.ts";
const ACTOR = "10000000-0000-4000-8000-000000000001",
  TENANT = "20000000-0000-4000-8000-000000000001",
  RID = "30000000-0000-4000-8000-000000000001",
  ADMIT = "40000000-0000-4000-8000-000000000001",
  GRANT = "50000000-0000-4000-8000-000000000001",
  CLAIM = "60000000-0000-4000-8000-000000000001";
const schema = (properties: Obj, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
async function harness(
  options: {
    operation?: string;
    provider?: (
      url: string,
      init: RequestInit,
      calls: Obj[],
    ) => Response | Promise<Response>;
    rpc?: (name: string, args: Obj, service: boolean) => Obj | null;
    key?: string;
    auth?: ComposioReadDependencies["authenticate"];
  } = {},
) {
  const operation = options.operation ?? "composio.execute_read",
    definition = {
      slug: "FIXTURE_READ",
      input_parameters: schema({ query: { type: "string", maxLength: 20 } }, [
        "query",
      ]),
      description:
        "Synthetic reviewed component fixture; not an approved live provider profile",
    };
  const profile = {
    profile_id: "fixture_read",
    toolkit_slug: "fixture",
    tool_slug: "FIXTURE_READ",
    provider_definition_sha256: await argumentDigest(definition),
    input_schema: definition.input_parameters,
    output_schema: schema({ text: { type: "string", maxLength: 100 } }, [
      "text",
    ]),
    effect_contract: "reviewed_read_only",
    review_reference: "component-fixture-only-not-provider-proof",
    enabled: true,
  };
  const args = operation === "composio.execute_read"
    ? {
      profile_id: "fixture_read",
      company_id: null,
      arguments: { query: "hello" },
    }
    : {};
  const rpcCalls: any[] = [], providerCalls: any[] = [];
  const context = {
    ok: true,
    admission_id: ADMIT,
    claim_id: CLAIM,
    actor_id: ACTOR,
    tenant_id: TENANT,
    request_id: RID,
    operation,
    connections: [{
      connected_account_id: "fixture_account",
      toolkit_slug: "fixture",
      company_id: null,
      status: "ACTIVE",
    }],
    profiles: [{ profile_id: "fixture_read", toolkit_slug: "fixture" }],
    profile: operation === "composio.execute_read" ? profile : null,
  };
  const deps: ComposioReadDependencies = {
    base: "https://fixed.invalid",
    anon: "anon",
    service: "service",
    key: options.key ?? "component-only",
    authenticate: options.auth ??
      (async () => ({ id: ACTOR, confirmed: true })),
    rpc: async (name, input, bearer, service) => {
      rpcCalls.push({ name, input, bearer, service });
      const override = options.rpc?.(name, input, service);
      if (override) return override;
      if (name === "sandy_composio_read_admit") {
        assert.equal(bearer, "actual-customer-jwt");
        assert.equal(service, false);
        assert.equal(
          input.p_canonical_arguments,
          canonicalJson(input.p_arguments),
        );
        return {
          ok: true,
          reused: false,
          admission_id: ADMIT,
          grant_id: GRANT,
          actor_id: ACTOR,
          tenant_id: TENANT,
          request_id: RID,
        };
      }
      assert.equal(bearer, "service");
      assert.equal(service, true);
      if (name === "sandy_composio_read_bind") return context;
      if (name === "sandy_composio_read_finish") {
        return {
          ok: true,
          admission_id: ADMIT,
          request_id: RID,
          state: input.p_outcome,
          result_sha256: input.p_result_sha256,
        };
      }
      throw Error(name);
    },
    fetch: async (input, init) => {
      const url = String(input);
      providerCalls.push({ url, init });
      assert.ok(url.startsWith("https://backend.composio.dev/api/"));
      assert.equal(init?.redirect, "error");
      assert.equal((init?.headers as Obj)["x-api-key"], "component-only");
      if (options.provider) return options.provider(url, init!, providerCalls);
      if (url.includes("connected_accounts?")) {
        return Response.json({
          items: [{
            id: "fixture_account",
            user_id: "sandy_customer_" + TENANT,
            status: "ACTIVE",
            toolkit: { slug: "fixture" },
          }],
          next_cursor: null,
        });
      }
      if (url.includes("/tools?")) {
        return Response.json({ items: [definition], next_cursor: null });
      }
      assert.ok(url.endsWith("/tools/execute/FIXTURE_READ"));
      assert.deepEqual(JSON.parse(String(init?.body)), {
        connected_account_id: "fixture_account",
        arguments: { query: "hello" },
      });
      return Response.json({
        successful: true,
        error: null,
        data: { text: "bounded customer-owned read" },
        access_token: "MUST_NOT_ESCAPE",
      });
    },
  };
  const handler = createComposioReadHandler(deps);
  const request = (
    change: Obj = {},
    headers: Record<string, string> = {
      authorization: "Bearer actual-customer-jwt",
    },
  ) =>
    new Request("https://local.invalid", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        operation,
        arguments: args,
        channel: "api",
        request_id: RID,
        ...change,
      }),
    });
  return {
    handler,
    request,
    args,
    profile,
    definition,
    rpcCalls,
    providerCalls,
    context,
    deps,
  };
}
Deno.test("two frozen original IDs have exact immutable customer contracts", async () => {
  assert.deepEqual(Object.keys(composioReadOperations).sort(), [
    "composio.discover_toolkits",
    "composio.execute_read",
  ]);
  for (const [name, op] of Object.entries(composioReadOperations)) {
    assert.ok(Object.isFrozen(op.input_schema));
    const { contract_sha256, ...unsigned } = op;
    assert.equal(await argumentDigest(unsigned), contract_sha256);
    const row = { ...op, error_contract: op };
    assert.equal(composioReadContractMatches(name, row), true);
    assert.equal(
      composioReadContractMatches(name, {
        ...row,
        error_contract: { ...op, api_key_delegable: true },
      }),
      false,
    );
  }
});
Deno.test("actual customer discovery projects only owned account state and profile IDs", async () => {
  const h = await harness({ operation: "composio.discover_toolkits" });
  const response = await h.handler(h.request());
  assert.equal(response.status, 200);
  const v = await response.json();
  assert.equal(v.executed, true);
  assert.equal(h.providerCalls.length, 1);
  assert.deepEqual(v.result.toolkits, [{
    toolkit_slug: "fixture",
    company_id: null,
    provider_confirmed_active: true,
    read_profiles: ["fixture_read"],
  }]);
  assert.equal(v.result.payload_stored, false);
  assert.ok(!JSON.stringify(v).includes("fixture_account"));
  assert.deepEqual(h.rpcCalls.map((c) => c.name), [
    "sandy_composio_read_admit",
    "sandy_composio_read_bind",
    "sandy_composio_read_finish",
  ]);
});
Deno.test("reviewed profile executes fixed provider path once and strips provider credential fields", async () => {
  const h = await harness();
  const response = await h.handler(h.request());
  assert.equal(response.status, 200);
  const v = await response.json();
  assert.deepEqual(v.result.data, { text: "bounded customer-owned read" });
  assert.equal(v.result.result_sha256, await argumentDigest(v.result.data));
  assert.equal(h.providerCalls.length, 3);
  assert.equal(
    h.rpcCalls.at(-1)!.input.p_result_sha256,
    v.result.result_sha256,
  );
  assert.ok(!JSON.stringify(v).includes("MUST_NOT_ESCAPE"));
});
Deno.test("service keys, anonymous identity, caller tenant/connection and owner approvals are rejected before dispatch", async () => {
  for (
    const headers of [{ authorization: "Bearer service" }, {
      authorization: "Bearer anon",
    }, { authorization: "Bearer actual-customer-jwt", "x-api-key": "no" }]
  ) {
    const h = await harness();
    assert.equal(
      (await h.handler(h.request({}, headers as Record<string, string>)))
        .status,
      401,
    );
    assert.equal(h.rpcCalls.length, 0);
  }
  const h = await harness({ auth: async () => null });
  assert.equal((await h.handler(h.request())).status, 401);
  for (
    const change of [{ tenant_id: TENANT }, { approval_id: RID }, {
      arguments: {
        profile_id: "fixture_read",
        company_id: null,
        arguments: {},
        connected_account_id: "foreign",
      },
    }]
  ) {
    const f = await harness();
    assert.equal((await f.handler(f.request(change))).status, 400);
    assert.equal(f.providerCalls.length, 0);
  }
});
Deno.test("profile provenance and strict bounded schemas cannot be inferred from read names", async () => {
  const h = await harness();
  assert.equal(validReadProfile(h.profile), true);
  for (
    const patch of [
      { effect_contract: "probably_read" },
      { review_reference: "" },
      {
        output_schema: schema({
          access_token: { type: "string", maxLength: 20 },
        }, ["access_token"]),
      },
      { input_schema: { type: "object", additionalProperties: true } },
      {
        input_schema: schema({
          query: { type: "string", pattern: ".*", maxLength: 20 },
        }, ["query"]),
      },
    ]
  ) assert.equal(validReadProfile({ ...h.profile, ...patch }), false);
  assert.equal(
    reviewedSchema(
      schema({
        list: {
          type: "array",
          maxItems: 1000,
          items: { type: "string", maxLength: 10 },
        },
      }, []),
    ),
    false,
  );
  h.context.profile = { ...h.profile, effect_contract: "prefix_name_only" };
  const r = await h.handler(h.request());
  assert.equal(r.status, 424);
  assert.equal(h.providerCalls.length, 0);
  assert.equal(h.rpcCalls.at(-1)!.input.p_outcome, "failed");
});
Deno.test("incomplete accounts, foreign tenant, toolkit mismatch and definition drift fail before tool execution", async () => {
  for (const mode of ["pagination", "foreign", "toolkit", "definition"]) {
    const h = await harness({
      provider: (url) =>
        url.includes("connected_accounts?")
          ? Response.json({
            items: [{
              id: "fixture_account",
              user_id: mode === "foreign"
                ? "foreign"
                : "sandy_customer_" + TENANT,
              status: "ACTIVE",
              toolkit: { slug: mode === "toolkit" ? "other" : "fixture" },
            }],
            next_cursor: mode === "pagination" ? "more" : null,
          })
          : Response.json({
            items: [{ slug: "FIXTURE_READ", description: "changed" }],
          }),
    });
    const r = await h.handler(h.request());
    assert.ok(r.status >= 400);
    assert.ok(!h.providerCalls.some((c) => c.url.includes("/execute/")));
    assert.equal(h.rpcCalls.at(-1)!.input.p_outcome, "failed");
  }
});
Deno.test("schema-invalid or lost tool response produces unknown receipt and no retry", async () => {
  for (const mode of ["extra", "loss"]) {
    const h = await harness();
    h.deps.fetch = async () => {
      throw Error("not used after factory construction");
    };
    let calls = 0;
    const provider = h.context;
    void provider;
    const g = await harness({
      provider: (url) => {
        calls++;
        if (url.includes("connected_accounts?")) {
          return Response.json({
            items: [{
              id: "fixture_account",
              user_id: "sandy_customer_" + TENANT,
              status: "ACTIVE",
              toolkit: { slug: "fixture" },
            }],
          });
        }
        if (url.includes("/tools?")) {
          return Response.json({ items: [h.definition] });
        }
        if (mode === "loss") throw Error("lost");
        return Response.json({
          successful: true,
          error: null,
          data: { text: "ok", access_token: "MUST_NOT_ESCAPE" },
        });
      },
    });
    const r = await g.handler(g.request());
    assert.equal(r.status, 502);
    const v = await r.json();
    assert.equal(v.executed, null);
    assert.equal(v.reconciliation_required, true);
    assert.equal(calls, 3);
    assert.equal(g.rpcCalls.at(-1)!.input.p_outcome, "unknown");
    assert.ok(!JSON.stringify(v).includes("MUST_NOT_ESCAPE"));
  }
});
Deno.test("receipt persistence ambiguity never retries tool dispatch or finish", async () => {
  const h = await harness({
    rpc: (name) => name === "sandy_composio_read_finish" ? { ok: false } : null,
  });
  const response = await h.handler(h.request());
  assert.equal(response.status, 503);
  const v = await response.json();
  assert.equal(v.executed, null);
  assert.equal(v.reconciliation_required, true);
  assert.equal(h.providerCalls.length, 3);
  assert.equal(
    h.rpcCalls.filter((c) => c.name === "sandy_composio_read_finish").length,
    1,
  );
});
Deno.test("replay returns minimal owned receipt and never rebinds or redispatches", async () => {
  const digest = "a".repeat(64),
    h = await harness({
      key: "",
      rpc: (name) =>
        name === "sandy_composio_read_admit"
          ? {
            ok: true,
            reused: true,
            admission_id: ADMIT,
            request_id: RID,
            state: "succeeded",
            result_sha256: digest,
            executed: true,
          }
          : null,
    });
  const r = await h.handler(h.request());
  assert.equal(r.status, 200);
  const v = await r.json();
  assert.equal(v.request_state, "replayed");
  assert.equal(v.result.data, null);
  assert.equal(v.result.result_sha256, digest);
  assert.equal(v.result.payload_stored, false);
  assert.equal(h.providerCalls.length, 0);
  assert.equal(h.rpcCalls.length, 1);
});
Deno.test("customer admission and service dispatch response identity are independently checked", async () => {
  for (
    const step of ["sandy_composio_read_admit", "sandy_composio_read_bind"]
  ) {
    const h = await harness({
      rpc: (name) =>
        name === step
          ? {
            ok: true,
            reused: false,
            admission_id: ADMIT,
            grant_id: GRANT,
            actor_id: "foreign",
            tenant_id: TENANT,
            request_id: RID,
          }
          : null,
    });
    const r = await h.handler(h.request());
    assert.equal(r.status, 503);
    assert.equal(h.providerCalls.length, 0);
  }
});
