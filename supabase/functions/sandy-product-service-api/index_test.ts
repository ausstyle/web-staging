import { strict as a } from "node:assert";
import { createProductHandler, type ProductDependencies } from "./index.ts";
import { productContractMatches, productOperations } from "./contracts.ts";
import { emptyResult } from "./providers.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
const actor = "10000000-0000-4000-8000-000000000001",
  tenant = "20000000-0000-4000-8000-000000000001",
  rid = "30000000-0000-4000-8000-000000000001",
  admission = "40000000-0000-4000-8000-000000000001",
  grant = "50000000-0000-4000-8000-000000000001";
const request = (
  op = "customer.profile.get",
  args: Record<string, unknown> = {},
  other: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) =>
  new Request("https://api.invalid", {
    method: "POST",
    headers: {
      authorization: "Bearer actual-user-session",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ operation: op, arguments: args, ...other }),
  });
const common = (): ProductDependencies => ({
  base: "https://zmqlyygzqoidkcwdysok.supabase.co",
  anon: "anon-key",
  service: "service-key",
  env: () => undefined,
  authenticate: async () => ({ id: actor, emailConfirmed: true }),
  fetch: () => {
    throw Error("unexpected_external_request");
  },
});
const receipt = (result: Record<string, unknown> = emptyResult()) => ({
  ok: true,
  admission_id: admission,
  request_id: rid,
  request_state: "observed",
  executed: true,
  result,
  reconciliation_required: false,
});
Deno.test("all98 contract hashes agree, are closed-schema typed, and contract routing rejects drift", async () => {
  a.equal(Object.keys(productOperations).length, 98);
  a.equal(
    Object.values(productOperations).filter((v) => v.is_mutation).length,
    45,
  );
  for (const op of Object.values(productOperations)) {
    const { contract_sha256, ...without } = op;
    a.equal(await argumentDigest(without), contract_sha256);
    a.equal(op.input_schema.additionalProperties, false);
    const row = {
      handler: "sandy-product-service-api",
      input_schema: op.input_schema,
      output_schema: op.output_schema,
      is_mutation: op.is_mutation,
      permission_scope:
        (op.authorization === "owner" ? "system:" : "product:") +
        (op.is_mutation ? "write" : "read"),
      error_contract: {
        contract_sha256,
        requires_approval: op.authorization === "owner" &&
          (op.is_mutation || op.sensitive),
        api_key_delegable: false,
      },
    };
    a.equal(productContractMatches(op.operation, row), true);
    a.equal(
      productContractMatches(op.operation, {
        ...row,
        is_mutation: !op.is_mutation,
      }),
      false,
    );
    if (op.is_mutation) {
      a.ok((op.input_schema.required as string[]).includes("idempotency_key"));
    }
  }
});
Deno.test("service,anon,opaque keys and unconfirmed sessions never enter product admission", async () => {
  for (
    const headers of ([{ authorization: "Bearer service-key" }, {
      authorization: "Bearer anon-key",
    }, { "x-api-key": "opaque" }] as Record<string, string>[])
  ) {
    let calls = 0;
    const deps = common();
    deps.rpc = async () => {
      calls++;
      return {};
    };
    a.equal(
      (await createProductHandler(deps)(request(undefined, {}, {}, headers)))
        .status,
      401,
    );
    a.equal(calls, 0);
  }
  const deps = common();
  deps.authenticate = async () => ({ id: actor, emailConfirmed: false });
  a.equal((await createProductHandler(deps)(request())).status, 401);
});
Deno.test("default Auth separates invalid sessions from throttling and outages before admission", async () => {
  for (const status of [0, 400, 401, 403, 422, 429, 500, 503, 504]) {
    const deps = common();
    delete deps.authenticate;
    let calls = 0;
    deps.rpc = async () => {
      calls++;
      return {};
    };
    deps.fetch = async () =>
      status === 0
        ? Response.error()
        : Response.json({ error: "private_auth_diagnostics" }, { status });
    const response = await createProductHandler(deps)(request());
    a.equal(response.status, [400, 401, 403, 422].includes(status) ? 401 : 503);
    const body = await response.json();
    a.equal(body.executed, response.status === 401 ? undefined : false);
    a.equal(calls, 0);
    a.ok(!JSON.stringify(body).includes("private_auth_diagnostics"));
  }
});
Deno.test("tenant overrides, extra metadata, bad arguments and unstable mutation IDs fail before RPC", async () => {
  const deps = common();
  let calls = 0;
  deps.rpc = async () => {
    calls++;
    return {};
  };
  const handler = createProductHandler(deps);
  a.equal(
    (await handler(request(undefined, { customer_id: tenant }))).status,
    400,
  );
  a.equal(
    (await handler(request(undefined, {}, { actor_id: actor }))).status,
    400,
  );
  a.equal(
    (await handler(request("customer.profile.update", { display_name: "x" })))
      .status,
    400,
  );
  a.equal(
    (await handler(
      request("customer.profile.update", {
        display_name: "x",
        idempotency_key: rid,
      }, { request_id: actor }),
    )).status,
    400,
  );
  a.equal(calls, 0);
});
Deno.test("normal user token alone admits and atomically executes a DB operation", async () => {
  const deps = common();
  const calls: unknown[] = [];
  deps.rpc = async (name, args, bearer, service) => {
    calls.push({ name, args, bearer, service });
    return name === "sandy_product_admit"
      ? { ok: true, allowed: true, admission_id: admission, grant_id: grant }
      : receipt({
        ...emptyResult(),
        item: {
          id: tenant,
          display_name: "Fixture",
          created_at: "2026-10-21T00:00:00Z",
          updated_at: "2026-10-21T00:00:00Z",
        },
      });
  };
  const r = await createProductHandler(deps)(
    request(undefined, {}, { request_id: rid, channel: "mcp" }),
  );
  a.equal(r.status, 200);
  a.deepEqual((calls as { name: string }[]).map((v) => v.name), [
    "sandy_product_admit",
    "sandy_product_execute_db",
  ]);
  a.ok(
    calls.every((v) =>
      (v as { bearer: string; service: boolean }).bearer ===
        "actual-user-session" && !(v as { service: boolean }).service
    ),
  );
  a.equal(r.headers.get("cache-control"), "no-store");
});
Deno.test("owner and tenant replays retrieve persisted result without consume or redispatch", async () => {
  const deps = common();
  let calls = 0;
  deps.rpc = async () => {
    calls++;
    return {
      ok: true,
      allowed: false,
      reused: true,
      admission_id: admission,
      state: "accepted",
      executed: true,
      receipt: emptyResult(),
    };
  };
  const response = await createProductHandler(deps)(
    request("customer.profile.update", {
      display_name: "x",
      idempotency_key: rid,
    }),
  );
  a.equal(response.status, 200);
  a.equal((await response.json()).request_state, "replayed");
  a.equal(calls, 1);
});
Deno.test("missing provider configuration fails before reservation with names and no secrets", async () => {
  const deps = common();
  let calls = 0;
  deps.rpc = async () => {
    calls++;
    return {};
  };
  const r = await createProductHandler(deps)(
    request("graph.messages.get", { message_id: rid }),
  );
  a.equal(r.status, 424);
  const body = await r.json();
  a.ok(body.requirements.includes("MS_GRAPH_CLIENT_SECRET"));
  a.equal(calls, 0);
});
Deno.test("provider ownership rejection cannot dispatch, and private finish never uses customer token", async () => {
  const deps = common();
  deps.env = () => "configured";
  let outbound = 0;
  deps.fetch = async () => {
    outbound++;
    return Response.json({});
  };
  deps.rpc = async (name) =>
    name === "sandy_product_admit"
      ? { ok: true, allowed: true, admission_id: admission, grant_id: grant }
      : { ok: false, http_status: 404, error: "product_resource_not_found" };
  a.equal(
    (await createProductHandler(deps)(
      request("graph.messages.get", { message_id: rid }),
    )).status,
    404,
  );
  a.equal(outbound, 0);
});
Deno.test("transport loss after DB RPC is unknown and never claimed unexecuted", async () => {
  const deps = common();
  deps.rpc = async (name) => {
    if (name === "sandy_product_admit") {
      return {
        ok: true,
        allowed: true,
        admission_id: admission,
        grant_id: grant,
      };
    }
    throw Error("transport lost");
  };
  const r = await createProductHandler(deps)(
    request("customer.profile.update", {
      display_name: "x",
      idempotency_key: rid,
    }),
  );
  a.equal(r.status, 503);
  const body = await r.json();
  a.equal(body.executed, null);
  a.equal(body.reconciliation_required, true);
});
Deno.test("product execution receipt uses actual user directly and never redispatches", async () => {
  const deps = common();
  const names: string[] = [];
  deps.rpc = async (name, _args, bearer, service) => {
    names.push(name);
    a.equal(bearer, "actual-user-session");
    a.equal(service, false);
    return receipt({
      ...emptyResult(),
      item: {
        operation: "customer.profile.get",
        state: "succeeded",
        redispatch_permitted: false,
      },
    });
  };
  const r = await createProductHandler(deps)(
    request("product.executions.get", { request_id: rid }),
  );
  a.equal(r.status, 200);
  a.deepEqual(names, ["sandy_product_get_receipt"]);
});
Deno.test("actual auth endpoint and user PostgREST RPC use anon project key with original JWT", async () => {
  const deps = common();
  delete deps.authenticate;
  const calls: { url: string; headers: Headers }[] = [];
  deps.fetch = async (input, init) => {
    const url = String(input), headers = new Headers(init?.headers);
    calls.push({ url, headers });
    if (url.endsWith("/auth/v1/user")) {
      return Response.json({
        id: actor,
        email_confirmed_at: "2026-10-21T00:00:00Z",
        is_anonymous: false,
        role: "authenticated",
      });
    }
    if (url.endsWith("/sandy_product_admit")) {
      return Response.json({
        ok: true,
        allowed: true,
        admission_id: admission,
        grant_id: grant,
      });
    }
    return Response.json(receipt());
  };
  a.equal(
    (await createProductHandler(deps)(
      request(undefined, {}, { request_id: rid }),
    )).status,
    200,
  );
  a.equal(calls.length, 3);
  for (const c of calls) {
    a.equal(c.headers.get("authorization"), "Bearer actual-user-session");
    a.equal(c.headers.get("apikey"), "anon-key");
    a.ok(c.url.startsWith(deps.base + "/"));
  }
});
Deno.test("product approval scope uses the exact raw SQL digest protocol and binds tenant/channel", async () => {
  const { productScopeSha256 } = await import("./gateway.ts");
  const op = productOperations["customer.profile.get"];
  const raw = "sandy_product_v1:" + actor + ":" + tenant +
    ":customer.profile.get:api:" + op.contract_sha256;
  const { createHash } = await import("node:crypto");
  a.equal(
    await productScopeSha256(op.operation, actor, tenant),
    createHash("sha256").update(raw).digest("hex"),
  );
  a.notEqual(
    await productScopeSha256(op.operation, actor, tenant),
    await productScopeSha256(op.operation, actor, tenant, "mcp"),
  );
  await a.rejects(() =>
    productScopeSha256("product.configuration.providers.update", actor, tenant)
  );
});
Deno.test("send requires reviewed content hash and version before admission", async () => {
  const d = common();
  let calls = 0;
  d.rpc = async () => {
    calls++;
    return {};
  };
  const r = await createProductHandler(d)(
    request("graph.drafts.confirm_send", {
      draft_id: rid,
      confirm: true,
      max_provider_units: 1,
      idempotency_key: rid,
    }),
  );
  a.equal(r.status, 400);
  a.equal(calls, 0);
});
Deno.test("WhatsApp bigint IDs preserve decimal strings beyond JavaScript safe integer range", async () => {
  const d = common();
  let value: unknown = "9007199254740993";
  d.rpc = async (name) =>
    name === "sandy_product_admit"
      ? { ok: true, allowed: true, admission_id: admission, grant_id: grant }
      : receipt({
        ...emptyResult(),
        items: [{
          id: value,
          meta_message_id: "synthetic-provider-id",
          processing_status: "received",
        }],
      });
  const handler = createProductHandler(d);
  let r = await handler(
    request("whatsapp.messages.list", {}, { request_id: rid }),
  );
  a.equal(r.status, 200);
  a.equal((await r.json()).result.items[0].id, "9007199254740993");
  value = Number("9007199254740993");
  r = await handler(request("whatsapp.messages.list", {}, { request_id: rid }));
  a.equal(r.status, 502);
});
