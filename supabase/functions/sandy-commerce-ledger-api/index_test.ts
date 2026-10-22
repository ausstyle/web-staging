import { strict as a } from "node:assert";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { type CommerceDependencies, createCommerceHandler } from "./index.ts";
import { commerceContractMatches, commerceOperations } from "./contracts.ts";
import {
  commerceOwnsGrant,
  commerceRequiresUserSession,
  commerceScopeSha256,
  isCommerceOperation,
} from "./gateway.ts";
import {
  configuredCommerceProcessor,
  requireCommerceProcessor,
} from "./processor.ts";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
const actor = "10000000-0000-4000-8000-000000000001",
  tenant = "20000000-0000-4000-8000-000000000001",
  rid = "30000000-0000-4000-8000-000000000001",
  admission = "40000000-0000-4000-8000-000000000001",
  grant = "50000000-0000-4000-8000-000000000001";
const request = (
  operation = "commerce.configuration.get",
  args: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) =>
  new Request("https://api.invalid", {
    method: "POST",
    headers: {
      authorization: "Bearer actual-user-session",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ operation, arguments: args, ...metadata }),
  });
const empty = (item: unknown = null) => ({
  item,
  items: [],
  changed: false,
  next_cursor: null,
  possibly_truncated: false,
  source: "internal_commerce_records",
  payment_executed: false,
  provider_verified: false,
});
const receipt = (item: unknown = null) => ({
  ok: true,
  admission_id: admission,
  request_id: rid,
  request_state: "observed",
  executed: true,
  reconciliation_required: false,
  result: empty(item),
});
const common = (): CommerceDependencies => ({
  base: "https://zmqlyygzqoidkcwdysok.supabase.co",
  anon: "anon-key",
  service: "service-key",
  authenticate: async () => ({ id: actor, emailConfirmed: true }),
  fetch: () => {
    throw Error("unexpected_external_request");
  },
});
const approved = () => ({
  ok: true,
  allowed: true,
  reused: false,
  admission_id: admission,
  grant_id: grant,
});
Deno.test("all53 commerce contracts are typed, exact-hashed, nondelegable and isolated from processor claims", async () => {
  a.equal(Object.keys(commerceOperations).length, 53);
  a.equal(
    Object.values(commerceOperations).filter((o) => o.is_mutation).length,
    27,
  );
  for (const op of Object.values(commerceOperations)) {
    const { contract_sha256, ...rest } = op;
    a.equal(await argumentDigest(rest), contract_sha256);
    a.equal(op.input_schema.additionalProperties, false);
    const row = {
      handler: op.handler,
      permission_scope: op.permission_scope,
      is_mutation: op.is_mutation,
      input_schema: op.input_schema,
      output_schema: op.output_schema,
      error_contract: {
        contract_sha256,
        requires_approval: op.requires_approval,
        api_key_delegable: false,
      },
    };
    a.equal(commerceContractMatches(op.operation, row), true);
    a.equal(
      commerceContractMatches(op.operation, {
        ...row,
        error_contract: { ...row.error_contract, api_key_delegable: true },
      }),
      false,
    );
    a.equal(
      commerceContractMatches(op.operation, {
        ...row,
        error_contract: {
          ...row.error_contract,
          requires_approval: !op.requires_approval,
        },
      }),
      false,
    );
    a.equal(
      commerceContractMatches(op.operation, { ...row, input_schema: {} }),
      false,
    );
    if (op.is_mutation) {
      a.ok((op.input_schema.required as string[]).includes("idempotency_key"));
    }
    a.equal(commerceOwnsGrant(op.operation), true);
    a.equal(commerceRequiresUserSession(op.operation), true);
    a.equal(isCommerceOperation(op.operation), true);
    const out = op.output_schema.properties as Record<
      string,
      Record<string, unknown>
    >;
    const rp = out.result.properties as Record<string, Record<string, unknown>>;
    a.equal(rp.payment_executed.const, false);
    a.equal(rp.provider_verified.const, false);
  }
  a.equal(isCommerceOperation("commerce.payments.create"), false);
});
Deno.test("actual confirmed user session required before any commerce RPC", async () => {
  const deniedHeaders: Record<string, string>[] = [
    { authorization: "Bearer service-key" },
    { authorization: "Bearer anon-key" },
    { authorization: "" },
    { "x-api-key": "opaque-customer-key" },
  ];
  for (const headers of deniedHeaders) {
    const deps = common();
    let calls = 0;
    deps.rpc = async () => {
      calls++;
      return {};
    };
    a.equal(
      (await createCommerceHandler(deps)(request(undefined, {}, {}, headers)))
        .status,
      401,
    );
    a.equal(calls, 0);
  }
  const deps = common();
  deps.authenticate = async () => ({ id: actor, emailConfirmed: false });
  a.equal((await createCommerceHandler(deps)(request())).status, 401);
});
Deno.test("default Auth verification rejects anonymous, unconfirmed and service sessions", async () => {
  for (
    const user of [
      {
        id: actor,
        role: "authenticated",
        is_anonymous: true,
        email_confirmed_at: "2026-01-01",
      },
      { id: actor, role: "authenticated", email_confirmed_at: null },
      { id: actor, role: "service_role", email_confirmed_at: "2026-01-01" },
    ]
  ) {
    const deps = common();
    delete deps.authenticate;
    deps.fetch = async (url, init) => {
      a.equal(String(url), deps.base + "/auth/v1/user");
      a.equal(new Headers(init?.headers).get("apikey"), "anon-key");
      a.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer actual-user-session",
      );
      return Response.json(user);
    };
    a.equal((await createCommerceHandler(deps)(request())).status, 401);
  }
});
Deno.test("Auth rejection remains401 while actual Auth transport/provider outages remain503", async () => {
  for (const providerStatus of [401, 403, 500, 503]) {
    const deps = common();
    delete deps.authenticate;
    deps.fetch = async () =>
      Response.json({ error: "provider_failure_private_details" }, {
        status: providerStatus,
      });
    const response = await createCommerceHandler(deps)(request());
    a.equal(response.status, [401, 403].includes(providerStatus) ? 401 : 503);
    const body = await response.json();
    if ([500, 503].includes(providerStatus)) a.equal(body.executed, false);
    else a.equal(body.error, "actual_confirmed_customer_session_required");
    a.ok(!JSON.stringify(body).includes("provider_failure_private_details"));
  }
  const deps = common();
  delete deps.authenticate;
  deps.fetch = () => {
    throw Error("egress_private_diagnostics");
  };
  const response = await createCommerceHandler(deps)(request());
  a.equal(response.status, 503);
  a.equal((await response.json()).executed, false);
});
Deno.test("tenant overrides, card details, raw SQL and malformed amounts never reach admission", async () => {
  const deps = common();
  let calls = 0;
  deps.rpc = async () => {
    calls++;
    return {};
  };
  const h = createCommerceHandler(deps);
  for (
    const r of [
      request(undefined, { customer_id: tenant }),
      request(undefined, {}, { actor_id: actor }),
      request(undefined, {}, { channel: "owner" }),
      request("commerce.invoices.create", {
        card_number: "4242424242424242",
        idempotency_key: rid,
      }),
      request("commerce.accounts.list", { sql: "select 1" }),
      request("commerce.prices.create", {
        plan_id: tenant,
        currency: "NZD",
        minor_unit_exponent: 2,
        unit_minor: 9007199254740992,
        interval: "month",
        idempotency_key: rid,
      }),
      request("commerce.prices.create", {
        plan_id: tenant,
        currency: "NZD",
        minor_unit_exponent: 2,
        unit_minor: "1.50",
        interval: "month",
        idempotency_key: rid,
      }),
      request("commerce.consent.set", {
        terms_version: "test.v1",
        invoice_forwarding_allowed: true,
        automatic_renewal_recorded: true,
        expires_at: "tomorrow",
        idempotency_key: rid,
      }),
    ]
  ) a.equal((await h(r)).status, 400);
  a.equal(calls, 0);
});
Deno.test("mutation UUID binds outer request ID before dispatch", async () => {
  const deps = common();
  let calls = 0;
  deps.rpc = async () => {
    calls++;
    return {};
  };
  const h = createCommerceHandler(deps);
  a.equal(
    (await h(
      request("commerce.consent.revoke", { idempotency_key: rid }, {
        request_id: tenant,
      }),
    )).status,
    400,
  );
  a.equal((await h(request("commerce.consent.revoke", {}))).status, 400);
  a.equal(calls, 0);
});
Deno.test("gateway and SQL scope bind operation, real actor, tenant, channel and contract", async () => {
  const op = "commerce.accounts.list", contract = commerceOperations[op];
  const raw = "sandy_commerce_v1:" + actor + ":" + tenant + ":" + op + ":api:" +
    contract.contract_sha256;
  const expected = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
    ),
  ].map((x) => x.toString(16).padStart(2, "0")).join("");
  a.equal(await commerceScopeSha256(op, actor, tenant), expected);
  a.notEqual(await commerceScopeSha256(op, actor, tenant, "mcp"), expected);
  a.notEqual(await commerceScopeSha256(op, rid, tenant), expected);
  await a.rejects(() => commerceScopeSha256(op, actor, null));
  await a.rejects(() =>
    commerceScopeSha256("commerce.plans.list", actor, tenant)
  );
});
Deno.test("actual user bearer, canonical arguments and exact approval forward through one admission lifecycle", async () => {
  const deps = common();
  const calls: string[] = [];
  const args = {
    name: "Local account",
    code: "cash",
    kind: "asset",
    idempotency_key: rid,
  };
  deps.rpc = async (name, body, token) => {
    a.equal(token, "actual-user-session");
    calls.push(name);
    if (name === "sandy_commerce_admit") {
      a.equal(body.p_canonical_arguments, canonicalJson(args));
      a.equal(body.p_request_id, rid);
      a.equal(body.p_channel, "mcp");
      a.equal(body.p_approval_id, tenant);
      return approved();
    }
    a.equal(body.p_grant_id, grant);
    return {
      ...receipt({ id: tenant }),
      request_state: "accepted",
      reconciliation_required: true,
    };
  };
  const response = await createCommerceHandler(deps)(
    request("commerce.accounts.create", args, {
      channel: "mcp",
      approval_id: tenant,
    }),
  );
  a.equal(response.status, 200);
  a.deepEqual(calls, ["sandy_commerce_admit", "sandy_commerce_execute"]);
  const body = await response.json();
  a.equal(body.result.payment_executed, false);
  a.equal(body.result.provider_verified, false);
});
Deno.test("read request IDs are generated and no owner or service credential substitutes for bearer", async () => {
  const deps = common();
  deps.rpc = async (name, args, token) => {
    a.equal(token, "actual-user-session");
    if (name === "sandy_commerce_admit") {
      a.match(String(args.p_request_id), /^[a-f0-9-]{36}$/);
      return approved();
    }
    return receipt({ configured: false, version: 0, processor: null });
  };
  a.equal((await createCommerceHandler(deps)(request())).status, 200);
});
Deno.test("replay returns stored state and never consumes or executes twice", async () => {
  const deps = common();
  const calls: string[] = [];
  deps.rpc = async (name) => {
    calls.push(name);
    return {
      ok: true,
      reused: true,
      allowed: false,
      admission_id: admission,
      state: "accepted",
      executed: true,
      receipt: empty({ id: tenant }),
    };
  };
  const res = await createCommerceHandler(deps)(
    request("commerce.consent.revoke", { idempotency_key: rid }),
  );
  a.equal(res.status, 200);
  const body = await res.json();
  a.equal(body.request_state, "replayed");
  a.equal(body.reconciliation_required, true);
  a.deepEqual(calls, ["sandy_commerce_admit"]);
});
Deno.test("receipt reads call dedicated identity-checked RPC with no redispatch admission", async () => {
  const deps = common();
  const calls: string[] = [];
  deps.rpc = async (name, args) => {
    calls.push(name);
    a.equal(args.p_request_id, rid);
    return {
      ...receipt({ state: "accepted", redispatch_permitted: false }),
      request_state: "replayed",
    };
  };
  a.equal(
    (await createCommerceHandler(deps)(
      request("commerce.executions.get", { request_id: rid }),
    )).status,
    200,
  );
  a.deepEqual(calls, ["sandy_commerce_get_receipt"]);
});
Deno.test("closed admission is returned unchanged and never executes", async () => {
  const deps = common();
  let calls = 0;
  deps.rpc = async () => {
    calls++;
    return {
      ok: false,
      allowed: false,
      error: "product_contract_not_enabled",
      http_status: 403,
    };
  };
  a.equal((await createCommerceHandler(deps)(request())).status, 403);
  a.equal(calls, 1);
});
Deno.test("incomplete admission is not executed", async () => {
  const deps = common();
  let calls = 0;
  deps.rpc = async () => {
    calls++;
    return { ok: true, allowed: true, admission_id: admission };
  };
  a.equal((await createCommerceHandler(deps)(request())).status, 502);
  a.equal(calls, 1);
});
Deno.test("malformed monetary output and fake provider success are rejected after execution with unknown outcome", async () => {
  for (
    const result of [empty({ unit_minor: 9007199254740992 }), {
      ...empty({ id: tenant }),
      payment_executed: true,
    }, { ...empty({ id: tenant }), provider_verified: true }]
  ) {
    const deps = common();
    deps.rpc = async (name) =>
      name === "sandy_commerce_admit" ? approved() : { ...receipt(), result };
    const res = await createCommerceHandler(deps)(request());
    a.equal(res.status, 502);
    const body = await res.json();
    a.equal(body.executed, null);
    a.equal(body.reconciliation_required, true);
  }
});
Deno.test("decimal money above JavaScript safe integers survives exact input and output", async () => {
  const deps = common();
  deps.rpc = async (name, args) => {
    if (name === "sandy_commerce_admit") {
      a.equal(
        (args.p_arguments as Record<string, unknown>).unit_minor,
        "9007199254740993",
      );
      return approved();
    }
    return {
      ...receipt({ id: tenant, unit_minor: "9007199254740993" }),
      request_state: "accepted",
      reconciliation_required: true,
    };
  };
  const res = await createCommerceHandler(deps)(
    request("commerce.prices.create", {
      plan_id: tenant,
      currency: "NZD",
      minor_unit_exponent: 2,
      unit_minor: "9007199254740993",
      interval: "month",
      idempotency_key: rid,
    }),
  );
  a.equal(res.status, 200);
  a.equal((await res.json()).result.item.unit_minor, "9007199254740993");
});
Deno.test("RPC transport failure after execution is unknown; before execution is unexecuted", async () => {
  for (const stage of ["admit", "execute"]) {
    const deps = common();
    deps.rpc = async (name) => {
      if (stage === "execute" && name === "sandy_commerce_admit") {
        return approved();
      }
      throw Error("private_backend_details_should_not_leak");
    };
    const res = await createCommerceHandler(deps)(request());
    a.equal(res.status, 503);
    const body = await res.json();
    a.equal(body.executed, stage === "execute" ? null : false);
    a.equal(body.reconciliation_required, stage === "execute");
    a.ok(!JSON.stringify(body).includes("private_backend_details"));
  }
});
Deno.test("processor interface is explicitly unconfigured and cannot invent payment, refund or tax evidence", () => {
  a.equal(configuredCommerceProcessor, null);
  a.throws(
    requireCommerceProcessor,
    /explicit_processor_and_merchant_policy_required/,
  );
  a.ok(
    !Object.keys(commerceOperations).some((op) =>
      /payments|refunds|payouts|tax.calculate/.test(op)
    ),
  );
});
const evidencePath = Deno.env.get("COMMERCE_PG_EVIDENCE_PATH");
if (evidencePath) {
  Deno.test("every real rollback PostgreSQL output validates against its executable JS response schema", async () => {
    const evidence = JSON.parse(await Deno.readTextFile(evidencePath));
    const outputs = evidence.evidence[0].evidence.outputs;
    const ajv = new Ajv({ strict: false, formats: fullFormats });
    const seen = new Set();
    for (const output of outputs) {
      const op = commerceOperations[output.operation];
      a.ok(op);
      const validate = ajv.compile(op.output_schema);
      a.equal(
        validate(output),
        true,
        JSON.stringify({
          operation: output.operation,
          errors: validate.errors,
          output,
        }),
      );
      seen.add(output.operation);
    }
    a.equal(seen.size, 53);
  });
}
if (evidencePath) {
  Deno.test("real byte-budgeted invoice page survives the default bounded RPC transport", async () => {
    const evidence = JSON.parse(await Deno.readTextFile(evidencePath));
    const page = evidence.evidence[0].evidence.outputs.find((
      x: Record<string, unknown>,
    ) =>
      x.operation === "commerce.invoices.list" &&
      JSON.stringify(x).length > 100000
    );
    a.ok(page);
    a.ok(new TextEncoder().encode(JSON.stringify(page)).length < 195000);
    a.equal(page.result.possibly_truncated, true);
    a.ok(page.result.next_cursor);
    a.ok(page.result.items.length < 50);
    const deps = common();
    let calls = 0;
    deps.fetch = async (url, init) => {
      a.ok(String(url).startsWith(deps.base + "/rest/v1/rpc/"));
      a.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer actual-user-session",
      );
      calls++;
      return Response.json(
        String(url).endsWith("sandy_commerce_admit") ? approved() : page,
      );
    };
    const response = await createCommerceHandler(deps)(
      request("commerce.invoices.list", { limit: 50 }),
    );
    a.equal(response.status, 200);
    a.equal(calls, 2);
    a.equal(
      (await response.json()).result.next_cursor,
      page.result.next_cursor,
    );
  });
}
Deno.test("default RPC transport still fails closed on an over-budget backend body", async () => {
  const deps = common();
  deps.fetch = async (url) =>
    Response.json(
      String(url).endsWith("sandy_commerce_admit")
        ? approved()
        : receipt({ oversized: "x".repeat(610000) }),
    );
  const response = await createCommerceHandler(deps)(request());
  a.equal(response.status, 503);
  const body = await response.json();
  a.equal(body.executed, null);
  a.equal(body.reconciliation_required, true);
});
