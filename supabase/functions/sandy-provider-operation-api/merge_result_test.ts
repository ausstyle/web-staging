import assert from "node:assert/strict";
import { classifyGithubMergeResult } from "../_shared/sandy_github_merge.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  createProviderOperationHandler,
  type FinishRequest,
  type ProviderDependencies,
  providerOperations,
} from "./index.ts";
import { createLegacyProviderHandler } from "../sandy-legacy-compatibility-api/provider_handler.ts";
import { legacyProviderContracts } from "../sandy-legacy-compatibility-api/provider_contracts.ts";
const ACTOR = "10000000-0000-4000-8000-000000000001",
  RID = "20000000-0000-4000-8000-000000000001",
  GRANT = "30000000-0000-4000-8000-000000000001",
  ADMIT = "40000000-0000-4000-8000-000000000001",
  SHA = "a".repeat(40);
async function run(
  alias: boolean,
  payload: unknown,
  options: {
    lost?: boolean;
    receiptLost?: boolean;
    invalidJson?: boolean;
    status?: number;
  } = {},
) {
  const operation = alias ? "github.merge" : "github.pull_requests.merge",
    op = alias
      ? legacyProviderContracts[operation]
      : providerOperations[operation];
  const calls: string[] = [],
    finishes: FinishRequest[] = [],
    consumes: unknown[] = [];
  const deps: ProviderDependencies = {
    service: "internal",
    github: "fixture-only",
    authorizeContext: async (context, descriptor) => {
      assert.equal((context as any).operation, operation);
      assert.equal(descriptor.operation, operation);
      return { allowed: true };
    },
    consumeGrant: async (proof) => {
      consumes.push(proof);
      assert.equal(proof.operation, operation);
      assert.equal(proof.contract_sha256, op.contract_sha256);
      return { allowed: true, admission_id: ADMIT };
    },
    finishExecution: async (proof) => {
      finishes.push(proof);
      return { allowed: !options.receiptLost };
    },
    fetch: async (input, init) => {
      calls.push(String(input));
      assert.equal(init?.method, "PUT");
      assert.equal(
        String(input),
        "https://api.github.com/repos/ausstyle/web-staging/pulls/17/merge",
      );
      if (options.lost) throw Error("transport_lost");
      return new Response(
        options.invalidJson ? "invalid" : JSON.stringify(payload),
        {
          status: options.status ?? 200,
          headers: { "x-github-request-id": "fixture-merge-request" },
        },
      );
    },
  };
  const handler = alias
    ? createLegacyProviderHandler(deps)
    : createProviderOperationHandler(deps);
  const args = {
    path: { pull_number: 17 },
    body: { sha: SHA, merge_method: "merge" },
  };
  const response = await handler(
    new Request("https://local.invalid", {
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
        credential_id: null,
        request_id: RID,
        grant_id: GRANT,
        admission_id: ADMIT,
      }),
    }),
  );
  return {
    status: response.status,
    body: await response.json(),
    calls,
    finishes,
    consumes,
    contract: op.contract_sha256,
    input: await argumentDigest(args),
  };
}
Deno.test("one merge-result classifier requires an explicit boolean provider result", () => {
  assert.equal(classifyGithubMergeResult({ merged: true }), "merged");
  assert.equal(classifyGithubMergeResult({ merged: false }), "refused");
  for (
    const value of [null, [], {}, true, { merged: "true" }, { merged: 1 }, {
      merged: null,
    }]
  ) assert.equal(classifyGithubMergeResult(value), "unknown");
});
Deno.test("canonical and alias merge accept only validated merged=true without changing original grant identity", async () => {
  for (const alias of [false, true]) {
    const r = await run(alias, { sha: SHA, merged: true, message: "Merged" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.result.accepted, true);
    assert.equal(r.body.result.effect_confirmed, false);
    assert.equal(r.calls.length, 1);
    assert.equal(r.consumes.length, 1);
    assert.equal(r.finishes.length, 1);
    assert.equal(r.finishes[0].outcome, "accepted");
    assert.equal((r.consumes[0] as any).input_sha256, r.input);
  }
});
Deno.test("canonical and alias HTTP200 merged=false finish failed and return deterministic409 no-effect refusal", async () => {
  for (const alias of [false, true]) {
    const r = await run(alias, {
      sha: SHA,
      merged: false,
      message: "Cannot merge token=MUST_NOT_ESCAPE",
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "github_merge_refused");
    assert.equal(r.body.executed, false);
    assert.equal(r.body.provider_attempted, true);
    assert.equal(r.body.provider_http_status, 200);
    assert.equal(r.body.reconciliation_required, false);
    assert.equal(r.calls.length, 1);
    assert.equal(r.finishes.length, 1);
    assert.equal(r.finishes[0].outcome, "failed");
    assert.ok(!JSON.stringify(r.body).includes("MUST_NOT_ESCAPE"));
  }
});
Deno.test("canonical and alias malformed, missing or lost merge receipts stay unknown without automatic retry", async () => {
  for (const alias of [false, true]) {
    for (
      const [payload, options] of [
        [{ sha: SHA, message: "missing" }, {}],
        [{ sha: SHA, merged: "true", message: "malformed" }, {}],
        [{}, { invalidJson: true }],
        [{}, { lost: true }],
        [{}, { status: 503 }],
      ] as const
    ) {
      const r = await run(alias, payload, options);
      assert.ok(r.status >= 500);
      assert.equal(r.body.executed, null);
      assert.equal(r.body.reconciliation_required, true);
      assert.equal(r.calls.length, 1);
      assert.equal(r.finishes.length, 1);
      assert.equal(r.finishes[0].outcome, "unknown");
    }
  }
});
Deno.test("canonical and alias persistence loss cannot claim a confirmed accepted or refused receipt", async () => {
  for (const alias of [false, true]) {
    for (const merged of [false, true]) {
      const r = await run(alias, {
        sha: SHA,
        merged,
        message: "receipt fixture",
      }, { receiptLost: true });
      assert.equal(r.status, 503);
      assert.equal(r.body.executed, null);
      assert.equal(r.body.reconciliation_required, true);
      assert.equal(r.body.error, "execution_receipt_state_unknown");
      assert.equal(r.calls.length, 1);
      assert.equal(r.finishes.length, 1);
    }
  }
});
