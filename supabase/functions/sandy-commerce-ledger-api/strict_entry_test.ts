import { strict as a } from "node:assert";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { createInterpretedRegistryValidator } from "../sandy-operation-api/registry_schema_interpreter.ts";
import { commerceOperations } from "./contracts.ts";
import { type CommerceDependencies, createCommerceHandler } from "./index.ts";
import { createStrictCommerceHandler } from "./strict_entry.ts";
import {
  commerceStrictContractMatches,
  commerceStrictOperations,
  commerceStrictOwnsGrant,
  commerceStrictRequiresUserSession,
  commerceStrictScopeSha256,
  isCommerceStrictOperation,
} from "./strict_gateway.ts";

type Obj = Record<string, any>;
const actor = "10000000-0000-4000-8000-000000000001";
const tenant = "20000000-0000-4000-8000-000000000001";
const rid = "30000000-0000-4000-8000-000000000001";
const admission = "40000000-0000-4000-8000-000000000001";
const grant = "50000000-0000-4000-8000-000000000001";
const empty = () => ({
  item: null,
  items: [],
  changed: false,
  next_cursor: null,
  possibly_truncated: false,
  source: "internal_commerce_records",
  payment_executed: false,
  provider_verified: false,
});
const configured = () => ({ configured: false, version: 0, processor: null });
const output = (item: unknown = configured()) => ({
  ok: true,
  admission_id: admission,
  request_id: rid,
  request_state: "observed",
  executed: true,
  reconciliation_required: false,
  result: { ...empty(), item },
});
const deps = (): CommerceDependencies => ({
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
const req = (
  operation = "commerce.configuration.get",
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
const validators = new Ajv({ strict: false, formats: fullFormats });
const compiled = new Map(
  Object.values(commerceStrictOperations).map(
    (o) => [o.operation, validators.compile(o.output_schema)],
  ),
);
const typed = (operation: string, body: Obj) => ({
  ...body,
  operation,
  contract_version: "1.1.0",
});

Deno.test("strict53 revises required resource contracts without changing accepted inputs or business executor", async () => {
  a.equal(Object.keys(commerceStrictOperations).length, 53);
  for (const op of Object.values(commerceStrictOperations)) {
    const { contract_sha256, ...rest } = op;
    a.equal(await argumentDigest(rest), contract_sha256);
    a.equal(op.version, "1.1.0");
    a.equal(op.handler, "sandy-commerce-ledger-api");
    a.notEqual(
      contract_sha256,
      commerceOperations[op.operation].contract_sha256,
    );
    a.deepEqual(op.input_schema, commerceOperations[op.operation].input_schema);
    a.equal(op.authorization, commerceOperations[op.operation].authorization);
    a.equal(
      op.requires_approval,
      commerceOperations[op.operation].requires_approval,
    );
    a.equal(commerceStrictOwnsGrant(op.operation), true);
    a.equal(commerceStrictRequiresUserSession(op.operation), true);
    a.equal(isCommerceStrictOperation(op.operation), true);
    const row = {
      ...op,
      error_contract: {
        contract_sha256,
        requires_approval: op.requires_approval,
        requires_real_user_session: true,
        api_key_delegable: false,
      },
    };
    a.equal(commerceStrictContractMatches(op.operation, row), true);
    for (
      const changed of [
        { api_key_delegable: true },
        { requires_real_user_session: false },
        { requires_approval: !op.requires_approval },
        { contract_sha256: commerceOperations[op.operation].contract_sha256 },
      ]
    ) {
      a.equal(
        commerceStrictContractMatches(op.operation, {
          ...row,
          error_contract: { ...row.error_contract, ...changed },
        }),
        false,
      );
    }
    const tenantId = op.authorization === "owner" ? null : tenant;
    a.match(
      await commerceStrictScopeSha256(op.operation, actor, tenantId),
      /^[a-f0-9]{64}$/,
    );
  }
  a.equal(isCommerceStrictOperation("commerce.payments.create"), false);
  await a.rejects(() =>
    commerceStrictScopeSha256("commerce.plans.create", actor, tenant)
  );
  await a.rejects(() =>
    commerceStrictScopeSha256("commerce.configuration.get", actor, null)
  );
});
Deno.test("same handler factory preserves v1 default while strict entry refuses incomplete success resources", async () => {
  const d = deps();
  d.rpc = async (name) =>
    name === "sandy_commerce_admit" ? approved() : output({ version: 0 });
  a.equal((await createCommerceHandler(d)(req())).status, 200);
  const response = await createStrictCommerceHandler(d)(
    req(undefined, {}, { request_id: rid }),
  );
  a.equal(response.status, 502);
  a.deepEqual(await response.json(), {
    ok: false,
    error: "commerce_response_contract_mismatch",
    request_id: rid,
    executed: null,
    reconciliation_required: true,
  });
});
Deno.test("strict entry uses the actual session and one admit/execute lifecycle with v1.1 response", async () => {
  const d = deps();
  const calls: string[] = [];
  d.rpc = async (name, args, bearer) => {
    a.equal(bearer, "actual-user-session");
    calls.push(name);
    if (name === "sandy_commerce_admit") {
      a.equal(args.p_request_id, rid);
      return approved();
    }
    return output();
  };
  const response = await createStrictCommerceHandler(d)(
    req(undefined, {}, { request_id: rid }),
  );
  a.equal(response.status, 200);
  a.equal((await response.json()).contract_version, "1.1.0");
  a.deepEqual(calls, ["sandy_commerce_admit", "sandy_commerce_execute"]);
});
Deno.test("strict closed reads retain real-user requirement before any RPC", async () => {
  const d = deps();
  let calls = 0;
  d.authenticate = async () => null;
  d.rpc = async () => {
    calls++;
    return {};
  };
  a.equal((await createStrictCommerceHandler(d)(req())).status, 401);
  a.equal(calls, 0);
});
Deno.test("pending and known-failed replay are representable but incomplete claimed success is rejected", async () => {
  for (
    const receipt of [null, {
      ...empty(),
      item: {
        error: "commerce_state_or_version_conflict",
        internal_effect_committed: false,
      },
    }]
  ) {
    const d = deps();
    let calls = 0;
    d.rpc = async () => {
      calls++;
      return {
        ok: true,
        allowed: false,
        reused: true,
        admission_id: admission,
        executed: receipt ? false : null,
        state: receipt ? "failed" : "admitted",
        receipt,
      };
    };
    const response = await createStrictCommerceHandler(d)(
      req(undefined, {}, { request_id: rid }),
    );
    a.equal(response.status, 200);
    a.equal(calls, 1);
    const body = await response.json();
    a.equal(body.request_state, "replayed");
    a.equal(body.executed, receipt ? false : null);
  }
  for (const executed of [true, false, null]) {
    const candidate = typed("commerce.configuration.get", {
      ...output({ version: 0 }),
      executed,
      request_state: "replayed",
    });
    a.equal(compiled.get(candidate.operation)!(candidate), false);
  }
});

const path = Deno.env.get("COMMERCE_STRICT_PG_EVIDENCE_PATH");
if (path) {
  const evidence = JSON.parse(await Deno.readTextFile(path));
  const outputs: Obj[] = evidence.evidence[0].evidence.outputs;
  Deno.test("all53 real PostgreSQL operations and81 result variants pass strict AJV and central gateway validation", () => {
    const gateway = createInterpretedRegistryValidator();
    const seen = new Set();
    a.equal(evidence.http, 201);
    a.equal(evidence.evidence[0].evidence.checks, 126);
    for (const body of outputs) {
      const op = commerceStrictOperations[body.operation];
      a.ok(op);
      const validate = compiled.get(body.operation)!;
      a.equal(
        validate(body),
        true,
        JSON.stringify({ operation: body.operation, errors: validate.errors }),
      );
      a.equal(
        gateway.isValid(op.output_schema, body),
        true,
        "gateway " + body.operation,
      );
      seen.add(body.operation);
    }
    a.equal(seen.size, 53);
    a.equal(outputs.length, 81);
  });
  Deno.test("populated real resources require every returned field and reject unknown projections recursively", () => {
    let omissions = 0;
    let leaks = 0;
    for (const body of outputs) {
      const validate = compiled.get(body.operation)!;
      function visit(v: unknown, path: (string | number)[]) {
        if (Array.isArray(v)) {
          v.forEach((x, i) => visit(x, [...path, i]));
          return;
        }
        if (!v || typeof v !== "object") return;
        const record = v as Obj;
        for (const key of Object.keys(record)) {
          const changed = structuredClone(body);
          let parent = changed;
          for (const p of path) parent = parent[p];
          delete parent[key];
          a.equal(
            validate(changed),
            false,
            body.operation + " missing " + [...path, key].join("."),
          );
          omissions++;
          visit(record[key], [...path, key]);
        }
        const changed = structuredClone(body);
        let parent = changed;
        for (const p of path) parent = parent[p];
        parent.unreviewed_private_field = "must_not_leak";
        a.equal(
          validate(changed),
          false,
          body.operation + " unknown " + path.join("."),
        );
        leaks++;
      }
      if (body.result.item !== null) {
        visit(body.result.item, ["result", "item"]);
      }
      body.result.items.forEach((item: Obj, i: number) =>
        visit(item, ["result", "items", i])
      );
    }
    a.ok(omissions > 1000);
    a.ok(leaks > 100);
  });
  Deno.test("strict money, dates and business states reject coercion and fabricated provider verification", () => {
    let checks = 0;
    for (const body of outputs) {
      const validate = compiled.get(body.operation)!;
      function visit(v: unknown, path: (string | number)[]) {
        if (Array.isArray(v)) {
          v.forEach((x, i) => visit(x, [...path, i]));
          return;
        }
        if (!v || typeof v !== "object") return;
        for (const [key, val] of Object.entries(v)) {
          let bad: unknown;
          if (key.endsWith("_minor") && typeof val === "string") {
            bad = 9007199254740992;
          } else if (key.endsWith("_at") && typeof val === "string") {
            bad = "not-a-date";
          } else if (
            ["state", "payment_status", "tax_provenance"].includes(key)
          ) bad = "fabricated_success";
          else if (
            [
              "provider_verified",
              "payment_verified",
              "payment_executed",
              "provider_price_created",
              "invoice_source_correspondence_verified",
            ].includes(key)
          ) bad = true;
          if (bad !== undefined) {
            const changed = structuredClone(body);
            let parent = changed;
            for (const p of path) parent = parent[p];
            parent[key] = bad;
            a.equal(
              validate(changed),
              false,
              body.operation + " corrupt " + [...path, key].join("."),
            );
            checks++;
          }
          visit(val, [...path, key]);
        }
      }
      visit(body.result, ["result"]);
    }
    a.ok(checks > 500);
  });
  Deno.test("receipt readback validates the original operation's required resource fields", () => {
    const body = structuredClone(
      outputs.find((o) => o.operation === "commerce.executions.get"),
    );
    a.ok(body);
    const gateway = createInterpretedRegistryValidator();
    delete body.result.item.result.item.currency;
    a.equal(compiled.get(body.operation)!(body), false);
    a.equal(
      gateway.isValid(
        commerceStrictOperations[body.operation].output_schema,
        body,
      ),
      false,
    );
  });
  Deno.test("actual bounded large invoice page survives strict entry and default600k remote cap", async () => {
    const page = outputs.find((o) =>
      o.operation === "commerce.invoices.list" &&
      JSON.stringify(o).length > 100000
    );
    a.ok(page);
    a.ok(new TextEncoder().encode(JSON.stringify(page)).length < 195000);
    a.equal(page.result.possibly_truncated, true);
    a.ok(page.result.items.length < 50);
    const d = deps();
    let calls = 0;
    d.fetch = async (url) => {
      calls++;
      return Response.json(
        String(url).endsWith("sandy_commerce_admit") ? approved() : page,
      );
    };
    const response = await createStrictCommerceHandler(d)(
      req(page.operation, { limit: 50 }),
    );
    a.equal(response.status, 200);
    a.equal(calls, 2);
    a.deepEqual((await response.json()).result, page.result);
  });
}
