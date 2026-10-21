import assert from "node:assert/strict";
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import {
  ARTIFACT_OPERATION,
  artifactContract,
  artifactExecutionScope,
  type Obj,
  SOURCE_OPERATIONS,
} from "./contracts.ts";
import {
  artifactContractEnabled,
  type ArtifactDependencies,
  createArtifactHandler,
  DeliveryRefusal,
} from "./index.ts";
import {
  argumentDigest,
  bytesDigest,
  encode64,
} from "../sandy-provider-supplement-api/runtime.ts";
const actor = crypto.randomUUID(),
  admission = crypto.randomUUID(),
  id = crypto.randomUUID(),
  bytes = new TextEncoder().encode("SYNTHETIC-DOWNLOAD-NOT-A-CREDENTIAL"),
  sha = await bytesDigest(bytes);
const argsFor = (source = SOURCE_OPERATIONS[0]): Obj => ({
  custody_id: id,
  expected_sha256: sha,
  source_operation: source,
  source_input_sha256: "a".repeat(64),
  source_scope_sha256: "b".repeat(64),
});
function harness(transform: (value: Obj) => unknown = (v) => v) {
  const events: string[] = [],
    receipts: Obj[] = [],
    deps: ArtifactDependencies = {
      service: "synthetic-service",
      authorizeContext: async () => {
        events.push("authorize");
        return { allowed: true };
      },
      consumeGrant: async (r) => {
        events.push("consume");
        assert.equal(r.input_sha256, await argumentDigest(r.arguments));
        assert.equal(
          r.scope_sha256,
          await argumentDigest(
            artifactExecutionScope(ARTIFACT_OPERATION, r.arguments),
          ),
        );
        assert.equal(r.contract_sha256, artifactContract.contract_sha256);
        return { allowed: true, admission_id: admission };
      },
      deliver: async (a, adm, argsCanonical, scopeCanonical) => {
        events.push("deliver");
        assert.equal(a, actor);
        assert.equal(adm, admission);
        const args = JSON.parse(argsCanonical);
        assert.equal(argsCanonical, canonicalJson(args));
        assert.equal(
          scopeCanonical,
          canonicalJson(artifactExecutionScope(ARTIFACT_OPERATION, args)),
        );
        return transform({
          custody_id: id,
          sha256: sha,
          byte_length: bytes.length,
          media_type: "application/octet-stream",
          content_base64: encode64(bytes),
          source_operation: args.source_operation,
          source_input_sha256: args.source_input_sha256,
          source_scope_sha256: args.source_scope_sha256,
          artifact_class: "provider_download",
          consumed: true,
          content_returned: true,
        });
      },
      finishExecution: async (r) => {
        events.push("finish:" + r.outcome);
        receipts.push(r);
        return { allowed: true };
      },
    };
  const handler = createArtifactHandler(deps),
    run = async (args = argsFor(), extra: Obj = {}) => {
      const r = await handler(
        new Request("https://synthetic.invalid", {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic-service",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            operation: ARTIFACT_OPERATION,
            arguments: args,
            actor_id: actor,
            tenant_id: null,
            request_id: crypto.randomUUID(),
            grant_id: crypto.randomUUID(),
            ...extra,
          }),
        }),
      );
      return { status: r.status, body: await r.json() };
    };
  return { deps, events, receipts, run, handler };
}
Deno.test("artifact: six exact download classes deliver byte-exact typed output only after policy and consumed grant", async () => {
  for (const source of SOURCE_OPERATIONS) {
    const f = harness(), result = await f.run(argsFor(source));
    assert.equal(result.status, 200);
    assert.equal(result.body.result.content_base64, encode64(bytes));
    assert.equal(result.body.result.sha256, sha);
    assert.deepEqual(f.events, [
      "authorize",
      "consume",
      "deliver",
      "finish:succeeded",
    ]);
    assert.equal(result.body.reconciliation_required, false);
  }
  const f = harness();
  assert.equal(
    (await f.run({ ...argsFor(), custody_id: id.toUpperCase() })).status,
    200,
  );
});
Deno.test("artifact: credential/token/identity/functionsource/cursor/signedURL classes cannot reach policy or custody", async () => {
  for (
    const source of [
      "supabase.functions.body.capture",
      "gcp.kms.key_versions.decrypt.capture",
      "gcp.backups.data_sources.access_token.capture",
      "gcp.compute.instances.shielded_identity.capture",
      "gcp.pubsub.snapshots.list.bound",
      "github.actions.logs.redirect",
    ]
  ) {
    const f = harness();
    assert.equal(
      (await f.run({ ...argsFor(), source_operation: source })).status,
      400,
    );
    assert.deepEqual(f.events, []);
  }
  const f = harness();
  assert.equal(
    (await f.run({
      ...argsFor(),
      url: "https://signed.invalid/?token=private",
    })).status,
    400,
  );
  assert.deepEqual(f.events, []);
});
Deno.test("artifact: service, normal-owner-only, approval and no-delegation contract boundaries fail closed", async () => {
  const f = harness();
  assert.equal(
    (await f.handler(
      new Request("https://synthetic.invalid", { method: "POST", body: "{}" }),
    )).status,
    403,
  );
  for (
    const extra of [{ tenant_id: crypto.randomUUID() }, {
      credential_id: crypto.randomUUID(),
    }, { actor_id: null }]
  ) assert.equal((await f.run(argsFor(), extra)).status, 400);
  const row = {
    handler: artifactContract.handler,
    api_exposed: true,
    verified: true,
    is_mutation: false,
    permission_scope: "infrastructure:write",
    error_contract: {
      contract_sha256: artifactContract.contract_sha256,
      requires_grant: true,
      requires_approval: true,
      api_key_delegable: false,
    },
  };
  assert(artifactContractEnabled(row));
  for (
    const [key, value] of [
      ["requires_grant", false],
      ["requires_approval", false],
      ["api_key_delegable", true],
      ["contract_sha256", "f".repeat(64)],
    ] as const
  ) {
    assert.equal(
      artifactContractEnabled({
        ...row,
        error_contract: { ...row.error_contract, [key]: value },
      }),
      false,
    );
  }
  assert.deepEqual(f.events, []);
});
Deno.test("artifact: refused policy and reused admission never decrypt or deliver", async () => {
  const f = harness();
  f.deps.authorizeContext = async () => ({ allowed: false });
  assert.equal((await f.run()).status, 403);
  assert.deepEqual(f.events, []);
  const g = harness();
  g.deps.consumeGrant = async () => ({
    allowed: true,
    reused: true,
    admission_id: admission,
  });
  assert.equal((await g.run()).status, 409);
  assert.deepEqual(g.events, ["authorize"]);
});
Deno.test("artifact: explicit transactional custody refusal is failed; ambiguous delivery or malformed bytes requires reconciliation", async () => {
  const f = harness();
  f.deps.deliver = async () => {
    throw new DeliveryRefusal("artifact_delivery_binding_expired_or_used");
  };
  const denied = await f.run();
  assert.equal(denied.status, 409);
  assert.equal(denied.body.executed, false);
  assert.equal(f.receipts[0].outcome, "failed");
  for (
    const transform of [
      (v: Obj) => ({ ...v, sha256: "f".repeat(64) }),
      (v: Obj) => ({ ...v, byte_length: 0 }),
      (v: Obj) => ({
        ...v,
        source_operation: "supabase.functions.body.capture",
      }),
      (v: Obj) => ({ ...v, content_base64: "notcanonical" }),
      (v: Obj) => ({ ...v, content_base64: encode64(new Uint8Array(1048577)) }),
      (v: Obj) => ({ ...v, url: "https://signed.invalid" }),
    ]
  ) {
    const g = harness(transform), r = await g.run();
    assert.equal(r.status, 503);
    assert.equal(r.body.executed, null);
    assert.equal(r.body.reconciliation_required, true);
    assert.equal(g.receipts[0].outcome, "unknown");
    assert(!JSON.stringify(r).includes("content_base64"));
  }
  const g = harness();
  g.deps.deliver = async () => {
    throw Error("private network failure");
  };
  const unknown = await g.run();
  assert.equal(unknown.body.executed, null);
  assert(!JSON.stringify(unknown).includes("private network"));
});
Deno.test("artifact: receipt-write uncertainty never returns payload or acknowledges complete delivery", async () => {
  const f = harness();
  f.deps.finishExecution = async () => ({ allowed: false });
  const result = await f.run();
  assert.equal(result.status, 503);
  assert.equal(result.body.executed, null);
  assert.equal(result.body.reconciliation_required, true);
  assert(!JSON.stringify(result).includes("content_base64"));
});
