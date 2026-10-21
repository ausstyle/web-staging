import { strict as a } from "node:assert";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { createInterpretedRegistryValidator } from "../sandy-operation-api/registry_schema_interpreter.ts";
import { productOperations } from "./contracts.ts";
import { createProductHandler, type ProductDependencies } from "./index.ts";
import { createStrictProductHandler } from "./strict_entry.ts";
import {
  productStrictContractMatches,
  productStrictOperations,
  productStrictOwnsGrant,
  productStrictRequiresUserSession,
} from "./strict_gateway.ts";
import { emptyResult } from "./providers.ts";
type Obj = Record<string, any>;
const actor = "10000000-0000-4000-8000-000000000001",
  tenant = "20000000-0000-4000-8000-000000000001",
  rid = "30000000-0000-4000-8000-000000000001",
  admission = "40000000-0000-4000-8000-000000000001",
  grant = "50000000-0000-4000-8000-000000000001";
const deps = (): ProductDependencies => ({
  base: "https://zmqlyygzqoidkcwdysok.supabase.co",
  anon: "anon-key",
  service: "service-key",
  env: () => undefined,
  authenticate: async () => ({ id: actor, emailConfirmed: true }),
  fetch: () => {
    throw Error("unexpected_external_request");
  },
});
const req = (
  operation = "customer.profile.get",
  args: Obj = {},
  extra: Obj = {},
) =>
  new Request("https://api.invalid", {
    method: "POST",
    headers: {
      authorization: "Bearer actual-user-session",
      "content-type": "application/json",
    },
    body: JSON.stringify({ operation, arguments: args, ...extra }),
  });
const approved = () => ({
  ok: true,
  allowed: true,
  admission_id: admission,
  grant_id: grant,
});
const out = (item: unknown) => ({
  ok: true,
  admission_id: admission,
  request_id: rid,
  request_state: "observed",
  executed: true,
  result: { ...emptyResult(), item },
  reconciliation_required: false,
});
Deno.test("strict98 requires exact resource/approval/auth contract revision with only two additive paging inputs", async () => {
  a.equal(Object.keys(productStrictOperations).length, 98);
  for (const o of Object.values(productStrictOperations)) {
    const { contract_sha256, ...rest } = o;
    a.equal(await argumentDigest(rest), contract_sha256);
    a.equal(o.contract_version, "1.1.0");
    a.notEqual(contract_sha256, productOperations[o.operation].contract_sha256);
    if (
      ![
        "commerce.invoice_forward.receipt",
        "product.configuration.providers.list",
      ].includes(o.operation)
    ) a.deepEqual(o.input_schema, productOperations[o.operation].input_schema);
    a.equal(productStrictOwnsGrant(o.operation), true);
    a.equal(productStrictRequiresUserSession(o.operation), true);
    const row = {
      handler: "sandy-product-service-api",
      permission_scope: (o.authorization === "owner" ? "system:" : "product:") +
        (o.is_mutation ? "write" : "read"),
      is_mutation: o.is_mutation,
      input_schema: o.input_schema,
      output_schema: o.output_schema,
      error_contract: {
        contract_sha256,
        requires_approval: o.authorization === "owner" &&
          (o.is_mutation || o.sensitive),
        requires_real_user_session: true,
        api_key_delegable: false,
      },
    };
    a.equal(productStrictContractMatches(o.operation, row), true);
    for (
      const drift of [
        { requires_real_user_session: false },
        { api_key_delegable: true },
        { requires_approval: !row.error_contract.requires_approval },
        { contract_sha256: productOperations[o.operation].contract_sha256 },
      ]
    ) {
      a.equal(
        productStrictContractMatches(o.operation, {
          ...row,
          error_contract: { ...row.error_contract, ...drift },
        }),
        false,
      );
    }
  }
});
Deno.test("defaultfactory remains1.0 while strict same executor refuses missing profile fields", async () => {
  const d = deps();
  let calls = 0;
  d.rpc = async (name) => {
    calls++;
    return name === "sandy_product_admit" ? approved() : out({ id: tenant });
  };
  a.equal((await createProductHandler(d)(req())).status, 200);
  const response = await createStrictProductHandler(d)(
    req(undefined, {}, { request_id: rid }),
  );
  a.equal(response.status, 502);
  const failed = await response.json();
  a.equal(failed.error, "product_response_contract_mismatch");
  a.equal(failed.executed, null);
  a.equal(failed.reconciliation_required, true);
  a.equal(calls, 4);
});
Deno.test("strict source uses one real-user admit/execute path and complete typed profile", async () => {
  const d = deps(), calls: string[] = [];
  d.rpc = async (name, _args, bearer, service) => {
    calls.push(name);
    a.equal(bearer, "actual-user-session");
    a.equal(service, false);
    return name === "sandy_product_admit" ? approved() : out({
      id: tenant,
      display_name: "Fixture",
      created_at: "2026-10-21T00:00:00Z",
      updated_at: "2026-10-21T00:00:00Z",
    });
  };
  const response = await createStrictProductHandler(d)(
    req(undefined, {}, { request_id: rid }),
  );
  a.equal(response.status, 200);
  a.equal((await response.json()).contract_version, "1.1.0");
  a.deepEqual(calls, ["sandy_product_admit", "sandy_product_execute_db"]);
});
Deno.test("Auth rejects unconfirmed/anonymous/non-authenticated roles and reports actual outages503", async () => {
  for (
    const value of [
      { id: actor, email_confirmed_at: "2026-10-21", role: "service_role" },
      { id: actor, email_confirmed_at: "2026-10-21", role: "anon" },
      {
        id: actor,
        email_confirmed_at: "2026-10-21",
        role: "authenticated",
        is_anonymous: true,
      },
      { id: actor, email_confirmed_at: null, role: "authenticated" },
    ]
  ) {
    const d = deps();
    delete d.authenticate;
    d.fetch = async () => Response.json(value);
    a.equal((await createStrictProductHandler(d)(req())).status, 401);
  }
  for (const status of [0, 400, 401, 403, 422, 429, 500, 503, 504]) {
    const d = deps();
    delete d.authenticate;
    let calls = 0;
    d.rpc = async () => {
      calls++;
      return {};
    };
    d.fetch = async () =>
      status === 0
        ? Response.error()
        : Response.json({ error: "private_auth_diagnostics" }, { status });
    const response = await createStrictProductHandler(d)(req());
    a.equal(response.status, [400, 401, 403, 422].includes(status) ? 401 : 503);
    a.equal(calls, 0);
    a.ok(
      !JSON.stringify(await response.json()).includes(
        "private_auth_diagnostics",
      ),
    );
  }
  const d = deps();
  delete d.authenticate;
  d.fetch = () => {
    throw Error("private_network_diagnostics");
  };
  const r = await createStrictProductHandler(d)(req());
  a.equal(r.status, 503);
  a.equal((await r.json()).executed, false);
});
const evidencePath = Deno.env.get("PRODUCT_STRICT_PG_EVIDENCE_PATH");
if (evidencePath) {
  const evidence = JSON.parse(await Deno.readTextFile(evidencePath));
  const outputs: Obj[] = evidence.evidence[0].evidence.outputs;
  const ajv = new Ajv({ strict: false, formats: fullFormats });
  const cache = new Map<string, ReturnType<Ajv["compile"]>>();
  const validate = (o: Obj) => {
    let v = cache.get(o.operation);
    if (!v) {
      v = ajv.compile(productStrictOperations[o.operation].output_schema);
      cache.set(o.operation, v);
    }
    return v;
  };
  Deno.test("real rollback product database outputs pass strict AJV and the executable gateway interpreter", () => {
    a.equal(evidence.http, 201);
    const gate = createInterpretedRegistryValidator();
    const seen = new Set<string>();
    for (const output of outputs) {
      const v = validate(output);
      a.equal(
        v(output),
        true,
        JSON.stringify({
          operation: output.operation,
          errors: v.errors,
          result: output.result,
        }),
      );
      a.equal(
        gate.isValid(
          productStrictOperations[output.operation].output_schema,
          output,
        ),
        true,
        output.operation,
      );
      seen.add(output.operation);
    }
    a.equal(seen.size, 48);
    for (
      const op of Object.values(productStrictOperations).filter((o) =>
        o.executor === "db" || o.executor === "receipt"
      )
    ) a.ok(seen.has(op.operation), op.operation);
  });
  Deno.test("real populated product resources reject missing required fields and unknown columns recursively", () => {
    let checks = 0;
    for (const output of outputs) {
      const v = validate(output);
      function visit(value: unknown, path: (string | number)[]) {
        if (Array.isArray(value)) {
          value.forEach((x, i) => visit(x, [...path, i]));
          return;
        }
        if (!value || typeof value !== "object") return;
        for (const [key, item] of Object.entries(value)) {
          const changed = structuredClone(output);
          let parent = changed;
          for (const p of path) parent = parent[p];
          delete parent[key];
          a.equal(
            v(changed),
            false,
            output.operation + " missing " + [...path, key].join("."),
          );
          checks++;
          visit(item, [...path, key]);
        }
        const changed = structuredClone(output);
        let parent = changed;
        for (const p of path) parent = parent[p];
        parent.unselected_private_field = "must_not_escape";
        a.equal(v(changed), false);
        checks++;
      }
      if (output.result.item !== null) {
        visit(output.result.item, ["result", "item"]);
      }
      visit(output.result.items, ["result", "items"]);
    }
    a.ok(checks > 200);
  });
}
Deno.test("malformed provider resources become truthful durable failures before any accepted success receipt", async () => {
  for (
    const operation of ["graph.mailboxes.get", "graph.mail_folders.create"]
  ) {
    const mutation = operation.endsWith(".create");
    const d = deps();
    d.env = () => "synthetic-config";
    let finished: Obj | null = null;
    d.fetch = async (url) =>
      String(url).startsWith("https://login.microsoftonline.com/")
        ? Response.json({ access_token: "synthetic-provider-token" })
        : Response.json({
          id: "provider-fixture",
          unselected_private_field: "must-not-escape",
        });
    d.rpc = async (name, args) => {
      if (name === "sandy_product_admit") return approved();
      if (name === "sandy_product_bind_provider") {
        return {
          ok: true,
          actor_id: actor,
          tenant_id: null,
          context: {},
        };
      }
      a.equal(name, "sandy_product_finish_provider");
      finished = args;
      return {
        ok: true,
        admission_id: admission,
        request_id: rid,
        request_state: args.p_outcome,
        executed: mutation ? null : true,
        reconciliation_required: mutation,
        result: args.p_result,
      };
    };
    const response = await createStrictProductHandler(d)(
      req(
        operation,
        mutation ? { display_name: "Fixture", idempotency_key: rid } : {},
        { request_id: rid, approval_id: grant },
      ),
    );
    a.equal(response.status, 502);
    const body = await response.json();
    a.equal(body.error, "provider_response_contract_mismatch");
    a.equal(body.executed, mutation ? null : true);
    a.equal(body.reconciliation_required, mutation);
    a.ok(finished);
    a.equal((finished as Obj).p_outcome, mutation ? "unknown" : "failed");
    a.equal(
      (finished as Obj).p_result.item.error,
      "provider_response_contract_mismatch",
    );
    a.ok(!JSON.stringify(body).includes("must-not-escape"));
  }
});
Deno.test("incompatible historical receipt preserves recorded execution metadata and never redispatches", async () => {
  const d = deps();
  let calls = 0;
  d.rpc = async (name) => {
    calls++;
    a.equal(name, "sandy_product_get_receipt");
    return {
      ...out({
        operation: "customer.profile.get",
        state: "succeeded",
        result: { ...emptyResult(), item: { id: tenant } },
        redispatch_permitted: false,
        created_at: "2026-10-21T00:00:00Z",
        finished_at: "2026-10-21T00:00:00Z",
      }),
      request_state: "replayed",
    };
  };
  const response = await createStrictProductHandler(d)(
    req("product.executions.get", { request_id: rid }),
  );
  a.equal(response.status, 502);
  const body = await response.json();
  a.equal(body.executed, true);
  a.equal(body.stored_payload_schema_valid, false);
  a.equal(body.reconciliation_required, true);
  a.equal(calls, 1);
  a.ok(!JSON.stringify(body).includes("display_name"));
});
if (evidencePath) {
  Deno.test("actual192k-budget support page passes strict default600k transport and preserves its cursor", async () => {
    const evidence = JSON.parse(await Deno.readTextFile(evidencePath));
    const page = evidence.evidence[0].evidence.outputs.find((o: Obj) =>
      o.operation === "support.cases.list" && JSON.stringify(o).length > 100000
    );
    a.ok(page);
    a.ok(new TextEncoder().encode(JSON.stringify(page)).length < 195000);
    a.equal(page.result.possibly_truncated, true);
    a.ok(page.result.items.length < 50);
    const d = deps();
    let calls = 0;
    d.fetch = async (url, init) => {
      calls++;
      a.ok(String(url).startsWith(d.base + "/rest/v1/rpc/"));
      a.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer actual-user-session",
      );
      return Response.json(
        String(url).endsWith("sandy_product_admit") ? approved() : page,
      );
    };
    const response = await createStrictProductHandler(d)(
      req("support.cases.list", { limit: 50 }),
    );
    a.equal(response.status, 200);
    a.deepEqual((await response.json()).result, page.result);
    a.equal(calls, 2);
  });
}
if (evidencePath) {
  Deno.test("actual product date/version/state and delivery flags reject malformed semantic values", async () => {
    const evidence = JSON.parse(await Deno.readTextFile(evidencePath));
    const ajv = new Ajv({ strict: false, formats: fullFormats });
    let checks = 0;
    for (const output of evidence.evidence[0].evidence.outputs as Obj[]) {
      const validate = ajv.compile(
        productStrictOperations[output.operation].output_schema,
      );
      function visit(value: unknown, path: (string | number)[]) {
        if (Array.isArray(value)) {
          value.forEach((item, i) => visit(item, [...path, i]));
          return;
        }
        if (!value || typeof value !== "object") return;
        for (const [key, item] of Object.entries(value)) {
          let bad: unknown;
          if (key.endsWith("_at") && typeof item === "string") {
            bad = "not-a-date";
          } else if (key === "version" && typeof item === "number") bad = 0;
          else if (key === "delivery_verified") bad = true;
          else if (key === "state") bad = "fabricated_success";
          if (bad !== undefined) {
            const changed = structuredClone(output);
            let parent = changed;
            for (const p of path) parent = parent[p];
            parent[key] = bad;
            a.equal(
              validate(changed),
              false,
              output.operation + " " + [...path, key].join("."),
            );
            checks++;
          }
          visit(item, [...path, key]);
        }
      }
      visit(output.result, ["result"]);
    }
    a.ok(checks > 100);
  });
}
