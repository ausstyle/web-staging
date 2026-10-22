import assert from "node:assert/strict";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  captureLifecyclePreimage,
  executeProviderLifecycle,
  gitBlobSha,
  isProviderLifecycleOperation,
  type LifecycleContext,
  providerLifecycleContractMatches,
  providerLifecycleContracts,
} from "./provider_lifecycle.ts";
type ObjectValue = Record<string, unknown>;
const actor = "30000000-0000-4000-8000-000000000001",
  sourceRequest = "30000000-0000-4000-8000-000000000002",
  sourceAdmission = "30000000-0000-4000-8000-000000000003";
const snapshotId = "30000000-0000-4000-8000-000000000004",
  readAdmission = "30000000-0000-4000-8000-000000000005",
  readApproval = "30000000-0000-4000-8000-000000000006";
const observationId = "30000000-0000-4000-8000-000000000007",
  inverseRequest = "30000000-0000-4000-8000-000000000008",
  inverseApproval = "30000000-0000-4000-8000-000000000009",
  inverseAdmission = "30000000-0000-4000-8000-000000000010";
const context: LifecycleContext = {
  actorId: actor,
  kind: "user",
  requestId: sourceRequest,
  originalChannel: "api",
};
const path = "docs/sandy-api/compensation-fixtures/example.txt";
const before = btoa("before\n"), after = btoa("after\n");
const zone =
  "https://www.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b";
const vm = {
  id: "1234567890123456789",
  name: "sandy-fixture",
  zone,
  selfLink: `${zone}/instances/sandy-fixture`,
  creationTimestamp: "2026-10-20T00:00:00Z",
  status: "TERMINATED",
  disks: [{ type: "PERSISTENT" }],
};
async function harness(
  options: {
    vm?: boolean;
    missingReadApproval?: boolean;
    mutateFailure?: boolean;
    sourceOptions?: ObjectValue;
    customRead?: (operation: string) => Response | ObjectValue;
    reserveFailure?: boolean;
  } = {},
) {
  const beforeSha = (await gitBlobSha(before))!,
    afterSha = (await gitBlobSha(after))!;
  const operation = options.vm
    ? "gcp.compute.instances.start"
    : "github.files.upsert";
  const args: ObjectValue = options.sourceOptions ??
    (options.vm ? { path: { instance: vm.name } } : {
      path: { path },
      body: {
        message: "fixture",
        branch: "main",
        content: after,
        sha: beforeSha,
      },
    });
  let record: ObjectValue | null = null,
    compensation: ObjectValue | null = null;
  let metadataSha = afterSha, currentVm: ObjectValue = { ...vm };
  const observations: ObjectValue[] = [],
    dbCalls: { name: string; args: ObjectValue }[] = [],
    canonicalCalls: {
      context: LifecycleContext;
      operation: string;
      args: ObjectValue;
    }[] = [];
  const dependencies = {
    db: {
      rpc(name: string, parameters: ObjectValue) {
        dbCalls.push({ name, args: parameters });
        return Promise.resolve().then(async () => {
          let data: ObjectValue;
          if (name === "sandy_lifecycle_source_guard") {
            data = {
              ok: true,
              source_request_id: sourceRequest,
              source_operation: operation,
              source_input_sha256: await argumentDigest(args),
              preimage_read_approval_id: options.missingReadApproval
                ? null
                : readApproval,
            };
          } else if (name === "sandy_lifecycle_capture") {
            record = parameters.p_record as ObjectValue;
            data = {
              ok: true,
              snapshot_id: snapshotId,
              reused: false,
              provider_dispatched: false,
            };
          } else if (name === "sandy_lifecycle_context") {
            data = record
              ? {
                ok: true,
                snapshot: {
                  id: snapshotId,
                  actor_id: actor,
                  source_request_id: sourceRequest,
                  source_operation: operation,
                  captured_at: "2026-10-20T00:00:01Z",
                  record,
                },
                source_state: "accepted",
                compensation,
                observations,
              }
              : {
                ok: false,
                error: "immutable_provider_preimage_missing",
                http_status: 424,
              };
          } else if (name === "sandy_lifecycle_observe") {
            observations.push({
              id: observationId,
              phase: parameters.p_phase,
              matched: parameters.p_matched,
            });
            if (
              parameters.p_phase === "compensation" && parameters.p_matched &&
              compensation
            ) compensation.state = "verified";
            data = {
              ok: true,
              observation_id: observationId,
              read_admission_id: parameters.p_read_admission_id,
              effect_confirmed: parameters.p_matched,
              phase: parameters.p_phase,
            };
          } else if (name === "sandy_lifecycle_reserve_compensation") {
            if (options.reserveFailure) {
              throw Error("private-reservation-error");
            }
            compensation = {
              request_id: inverseRequest,
              state: "reserved",
              admission_id: null,
            };
            data = {
              ok: true,
              reused: false,
              request_id: inverseRequest,
              state: "reserved",
              redispatch_permitted: true,
            };
          } else if (name === "sandy_lifecycle_finish_compensation") {
            compensation = {
              request_id: inverseRequest,
              state: options.mutateFailure ? "unknown" : "accepted",
              admission_id: options.mutateFailure ? null : inverseAdmission,
            };
            data = {
              ok: true,
              ...compensation,
              effect_confirmed: false,
              redispatch_permitted: false,
            };
          } else throw Error("unexpected private RPC");
          return { data, error: null };
        });
      },
    },
    executeCanonical: async (
      callContext: LifecycleContext,
      id: string,
      parameters: ObjectValue,
    ) => {
      canonicalCalls.push({
        context: callContext,
        operation: id,
        args: parameters,
      });
      let value: ObjectValue;
      if (
        id === "github.files.upsert" || id === "github.files.delete" ||
        id === "gcp.compute.instances.stop" ||
        id === "gcp.compute.instances.start"
      ) {
        if (options.mutateFailure) throw Error("private-dispatch-timeout");
        return Response.json({
          ok: true,
          operation: id,
          executed: true,
          request_state: "accepted",
          admission_id: inverseAdmission,
          result: { accepted: true, effect_confirmed: false },
        });
      }
      const custom = options.customRead?.(id);
      if (custom instanceof Response) return custom;
      if (custom) value = custom;
      else if (id === "github.files.content.get") {
        value = {
          path,
          sha: beforeSha,
          type: "file",
          size: 7,
          encoding: "base64",
          content: before,
        };
      } else if (id === "github.files.metadata.get") {
        value = {
          path,
          sha: metadataSha,
          type: "file",
          size: 6,
          encoding: "base64",
          html_url: null,
          name: "example.txt",
        };
      } else if (id === "gcp.compute.instances.get") value = currentVm;
      else value = { name: "operation-fixture", status: "DONE" };
      return Response.json({
        ok: true,
        operation: id,
        executed: true,
        request_state: "observed",
        admission_id: readAdmission,
        result: value,
      });
    },
  };
  return {
    dependencies,
    args,
    operation,
    beforeSha,
    afterSha,
    dbCalls,
    canonicalCalls,
    observations,
    capture: () =>
      captureLifecyclePreimage(
        dependencies,
        context,
        sourceAdmission,
        operation,
        args,
      ),
    record: () => record!,
    setMetadataSha: (value: string) => {
      metadataSha = value;
    },
    setVm: (value: ObjectValue) => {
      currentVm = value;
    },
    compensation: () => compensation,
  };
}
Deno.test("lifecycle contracts compile strictly and Git blob hashing is the real Git object algorithm", async () => {
  const ajv = new Ajv({ strict: true, validateFormats: true });
  for (const [name, format] of Object.entries(fullFormats)) {
    ajv.addFormat(name, format);
  }
  for (const [id, contract] of Object.entries(providerLifecycleContracts)) {
    ajv.compile(contract.input_schema);
    ajv.compile(contract.output_schema);
    assert.equal(isProviderLifecycleOperation(id), true);
    assert.equal(
      providerLifecycleContractMatches(id, {
        ...contract,
        handler: "sandy-operation-api",
      }),
      true,
    );
    assert.equal(
      providerLifecycleContractMatches(id, {
        ...contract,
        handler: "arbitrary-handler",
      }),
      false,
    );
  }
  assert.equal(
    await gitBlobSha(btoa("hello\n")),
    "ce013625030ba8dba906f756967f9e9ca394464a",
  );
  assert.equal(await gitBlobSha("invalid:content"), null);
});
Deno.test("GitHub update preimage is captured only from an approved canonical read and immutable actual evidence", async () => {
  const h = await harness();
  const response = await h.capture();
  assert.equal(response.status, 200);
  assert.deepEqual(h.canonicalCalls.map((c) => c.operation), [
    "github.files.content.get",
  ]);
  assert.equal(h.canonicalCalls[0].context.scope?.approvalId, readApproval);
  assert.notEqual(h.canonicalCalls[0].context.requestId, sourceRequest);
  const record = h.record();
  assert.equal(record.read_admission_id, readAdmission);
  assert.equal(record.source_arguments_canonical, canonicalJson(h.args));
  assert.equal(record.read_result_canonical, canonicalJson(record.read_result));
  assert.deepEqual(record.compensation_arguments, {
    path: { path },
    body: {
      message: `Sandy compensation for ${sourceRequest}`,
      branch: "main",
      sha: h.afterSha,
      content: before,
    },
  });
  assert.equal(
    record.compensation_input_sha256,
    await argumentDigest(record.compensation_arguments),
  );
  assert.equal(JSON.stringify(await response.json()).includes(before), false);
});
Deno.test("preimage capture refuses absent approval, caller/provider precondition mismatch and false 404 receipts", async () => {
  const missing = await harness({ missingReadApproval: true });
  assert.equal((await missing.capture()).status, 424);
  assert.equal(missing.canonicalCalls.length, 0);
  const wrong = await harness({
    sourceOptions: {
      path: { path },
      body: {
        branch: "main",
        message: "fixture",
        content: after,
        sha: "0".repeat(40),
      },
    },
  });
  assert.equal((await wrong.capture()).status, 409);
  assert.equal(
    wrong.dbCalls.some((c) => c.name === "sandy_lifecycle_capture"),
    false,
  );
  const forbidden = await harness({
    sourceOptions: {
      path: { path: ".env" },
      body: { branch: "main", message: "fixture", content: after },
    },
  });
  assert.equal((await forbidden.capture()).status, 422);
  assert.equal(forbidden.canonicalCalls.length, 0);
  const forged = await harness({
    sourceOptions: {
      path: { path },
      body: { branch: "main", message: "fixture", content: after },
    },
    customRead: (op) =>
      Response.json({
        ok: false,
        operation: op,
        error: "provider_resource_not_found",
        provider_http_status: 404,
        admission_id: readAdmission,
        executed: true,
        request_state: "failed",
        receipt_recorded: false,
      }, { status: 404 }),
  });
  assert.equal((await forged.capture()).status, 424);
});
Deno.test("GitHub create compensation derives a conditional delete only from a real recorded absent preimage", async () => {
  const h = await harness({
    sourceOptions: {
      path: { path },
      body: { branch: "main", message: "fixture", content: after },
    },
    customRead: (op) =>
      Response.json({
        ok: false,
        operation: op,
        error: "provider_resource_not_found",
        provider_http_status: 404,
        admission_id: readAdmission,
        executed: true,
        request_state: "failed",
        receipt_recorded: true,
      }, { status: 404 }),
  });
  assert.equal((await h.capture()).status, 200);
  assert.equal(h.record().compensation_operation, "github.files.delete");
  assert.deepEqual(h.record().baseline, { exists: false });
  assert.deepEqual(h.record().compensation_arguments, {
    path: { path },
    body: {
      message: `Sandy compensation for ${sourceRequest}`,
      branch: "main",
      sha: h.afterSha,
    },
  });
});
Deno.test("VM capture binds numeric identity/original state and rejects scratch disks, transitional states and unsafe options", async () => {
  const h = await harness({ vm: true });
  assert.equal((await h.capture()).status, 200);
  assert.equal(
    (h.record().compensation_arguments as ObjectValue).path &&
      ((h.record().compensation_arguments as ObjectValue).path as ObjectValue)
        .instance,
    vm.id,
  );
  assert.deepEqual(h.record().verify_arguments, { path: { instance: vm.id } });
  for (
    const bad of [
      { ...vm, disks: [{ type: "SCRATCH" }] },
      { ...vm, status: "STAGING" },
      { ...vm, id: undefined },
      { ...vm, zone: "https://other.invalid/zones/other" },
    ]
  ) {
    const denied = await harness({ vm: true, customRead: () => bad });
    assert.equal((await denied.capture()).status, 424);
    assert.equal(
      denied.dbCalls.some((c) => c.name === "sandy_lifecycle_capture"),
      false,
    );
  }
  const unsafe = await harness({
    vm: true,
    sourceOptions: {
      path: { instance: vm.name },
      query: { discardLocalSsd: true },
    },
  });
  assert.equal((await unsafe.capture()).status, 422);
  assert.equal(unsafe.canonicalCalls.length, 0);
});
Deno.test("source readback records actual observed effect and drift without ever dispatching a mutation", async () => {
  const h = await harness();
  await h.capture();
  const first = await executeProviderLifecycle(
    h.dependencies,
    context,
    "system.lifecycle.verify",
    { source_request_id: sourceRequest },
  );
  assert.equal(first.status, 200);
  assert.equal((await first.json()).effect_confirmed, true);
  h.setMetadataSha("f".repeat(40));
  const drift = await executeProviderLifecycle(
    h.dependencies,
    context,
    "system.lifecycle.verify",
    { source_request_id: sourceRequest },
  );
  assert.equal((await drift.json()).effect_confirmed, false);
  assert.deepEqual(h.observations.map((o) => o.matched), [true, false]);
  assert.equal(
    h.canonicalCalls.some((c) => c.operation === "github.files.upsert"),
    false,
  );
  const status = await executeProviderLifecycle(
    h.dependencies,
    context,
    "system.lifecycle.get",
    { source_request_id: sourceRequest },
  );
  const body = await status.json();
  assert.equal(body.latest_source_effect_confirmed, false);
  assert.equal(JSON.stringify(body).includes(before), false);
  assert.equal(Object.hasOwn(body, "source_arguments"), false);
});
Deno.test("GitHub compensation uses exact stored SHA/preimage, separate approval and once-only canonical dispatch", async () => {
  const h = await harness();
  await h.capture();
  const response = await executeProviderLifecycle(
    h.dependencies,
    context,
    "system.lifecycle.compensate",
    {
      source_request_id: sourceRequest,
      compensation_approval_id: inverseApproval,
    },
  );
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.request_state, "accepted");
  assert.equal(body.effect_confirmed, false);
  assert.equal(body.redispatch_permitted, false);
  assert.equal(body.reconciliation_required, true);
  const mutations = h.canonicalCalls.filter((c) =>
    c.operation === "github.files.upsert"
  );
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].context.requestId, inverseRequest);
  assert.equal(mutations[0].context.scope?.approvalId, inverseApproval);
  assert.deepEqual(mutations[0].args, h.record().compensation_arguments);
  const count = h.canonicalCalls.length;
  await executeProviderLifecycle(
    h.dependencies,
    context,
    "system.lifecycle.compensate",
    {
      source_request_id: sourceRequest,
      compensation_approval_id: inverseApproval,
    },
  );
  assert.equal(h.canonicalCalls.length, count);
});
Deno.test("drift and lost reservation prevent compensation while ambiguous provider dispatch is never retried", async () => {
  const drift = await harness();
  await drift.capture();
  drift.setMetadataSha("f".repeat(40));
  assert.equal(
    (await executeProviderLifecycle(
      drift.dependencies,
      context,
      "system.lifecycle.compensate",
      {
        source_request_id: sourceRequest,
        compensation_approval_id: inverseApproval,
      },
    )).status,
    409,
  );
  assert.equal(
    drift.dbCalls.some((c) =>
      c.name === "sandy_lifecycle_reserve_compensation"
    ),
    false,
  );
  const reservation = await harness({ reserveFailure: true });
  await reservation.capture();
  const rejected = await executeProviderLifecycle(
    reservation.dependencies,
    context,
    "system.lifecycle.compensate",
    {
      source_request_id: sourceRequest,
      compensation_approval_id: inverseApproval,
    },
  );
  assert.equal(rejected.status, 503);
  assert.equal(
    reservation.canonicalCalls.filter((c) =>
      c.operation === "github.files.upsert"
    ).length,
    0,
  );
  const lost = await harness({ mutateFailure: true });
  await lost.capture();
  const unknown = await executeProviderLifecycle(
    lost.dependencies,
    context,
    "system.lifecycle.compensate",
    {
      source_request_id: sourceRequest,
      compensation_approval_id: inverseApproval,
    },
  );
  const body = await unknown.json();
  assert.equal(body.request_state, "unknown");
  assert.equal(body.executed, null);
  assert.equal(body.effect_confirmed, false);
  assert.equal(body.redispatch_permitted, false);
  await executeProviderLifecycle(
    lost.dependencies,
    context,
    "system.lifecycle.compensate",
    {
      source_request_id: sourceRequest,
      compensation_approval_id: inverseApproval,
    },
  );
  assert.equal(
    lost.canonicalCalls.filter((c) => c.operation === "github.files.upsert")
      .length,
    1,
  );
  assert.equal(JSON.stringify(body).includes("private-"), false);
});
Deno.test("VM inverse checks actual ID/state immediately and cannot target a replacement VM by name", async () => {
  const h = await harness({ vm: true });
  await h.capture();
  h.setVm({ ...vm, status: "RUNNING", id: "9999999999999999999" });
  assert.equal(
    (await executeProviderLifecycle(
      h.dependencies,
      context,
      "system.lifecycle.compensate",
      {
        source_request_id: sourceRequest,
        compensation_approval_id: inverseApproval,
      },
    )).status,
    409,
  );
  assert.equal(
    h.canonicalCalls.some((c) => c.operation === "gcp.compute.instances.stop"),
    false,
  );
  h.setVm({ ...vm, status: "RUNNING" });
  assert.equal(
    (await executeProviderLifecycle(
      h.dependencies,
      context,
      "system.lifecycle.compensate",
      {
        source_request_id: sourceRequest,
        compensation_approval_id: inverseApproval,
      },
    )).status,
    202,
  );
  const inverse = h.canonicalCalls.find((c) =>
    c.operation === "gcp.compute.instances.stop"
  )!;
  assert.deepEqual(inverse.args.path, { instance: vm.id });
});
Deno.test("compensation becomes verified only after a separate canonical readback of the original state", async () => {
  const h = await harness();
  await h.capture();
  await executeProviderLifecycle(
    h.dependencies,
    context,
    "system.lifecycle.compensate",
    {
      source_request_id: sourceRequest,
      compensation_approval_id: inverseApproval,
    },
  );
  assert.equal(h.compensation()?.state, "accepted");
  h.setMetadataSha(h.beforeSha);
  const response = await executeProviderLifecycle(
    h.dependencies,
    context,
    "system.lifecycle.verify",
    { source_request_id: sourceRequest, phase: "compensation" },
  );
  assert.equal((await response.json()).effect_confirmed, true);
  assert.equal(h.compensation()?.state, "verified");
});
Deno.test("GCP polling uses one genuine canonical GET and never treats DONE or an error as confirmed resource effect", async () => {
  for (
    const raw of [{ name: "operation-fixture", status: "DONE", error: {} }, {
      name: "operation-fixture",
      status: "RUNNING",
    }]
  ) {
    const h = await harness({ customRead: () => raw });
    const response = await executeProviderLifecycle(
      h.dependencies,
      context,
      "system.lifecycle.poll",
      { scope: "zone", operation_name: "operation-fixture" },
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.effect_confirmed, false);
    assert.equal(body.automatic_retry, false);
    assert.equal(body.terminal, raw.status === "DONE");
    assert.equal(body.provider_reported_error, Object.hasOwn(raw, "error"));
    assert.deepEqual(h.canonicalCalls.map((c) => c.operation), [
      "gcp.compute.zone_operations.get",
    ]);
    assert.equal(h.dbCalls.length, 0);
  }
});
Deno.test("missing historical snapshots and untrusted identities/arguments fail closed with sanitized dependencies", async () => {
  const h = await harness();
  const missing = await executeProviderLifecycle(
    h.dependencies,
    context,
    "system.lifecycle.get",
    { source_request_id: sourceRequest },
  );
  assert.equal(missing.status, 424);
  assert.equal(
    (await missing.json()).error,
    "immutable_provider_preimage_missing",
  );
  const count = h.dbCalls.length;
  assert.equal(
    (await executeProviderLifecycle(
      h.dependencies,
      { ...context, kind: "api_key" },
      "system.lifecycle.get",
      { source_request_id: sourceRequest },
    )).status,
    403,
  );
  assert.equal(
    (await executeProviderLifecycle(
      h.dependencies,
      context,
      "system.lifecycle.compensate",
      {
        source_request_id: sourceRequest,
        compensation_approval_id: inverseApproval,
        preimage: { content: "forged" },
      },
    )).status,
    400,
  );
  assert.equal(h.dbCalls.length, count);
  assert.equal(h.canonicalCalls.length, 0);
});
async function standingRecoveryHarness(
  options: {
    wrongBaseline?: boolean;
    changedResource?: boolean;
    reserveLost?: boolean;
  } = {},
) {
  const branch = "engineering/recovery-canary",
    file = "engineering-smoke/recovery.txt";
  const baselineSha = (await gitBlobSha(before))!,
    effectSha = (await gitBlobSha(after))!;
  const commitSha = "a".repeat(40), parentSha = "b".repeat(40);
  let record: ObjectValue | undefined, compensation: ObjectValue | null = null;
  let currentSha = options.changedResource ? "c".repeat(40) : effectSha;
  let writes = 0;
  const calls: { operation: string; args: ObjectValue }[] = [];
  const engineering = {
    userId: "40000000-0000-4000-8000-000000000001",
    sessionId: "40000000-0000-4000-8000-000000000002",
    epoch: 1,
  };
  const deps = {
    db: {
      async rpc(name: string, args: ObjectValue) {
        if (name.startsWith("sandy_engineering_")) {
          assert.equal(args.p_user_id, engineering.userId);
        }
        let data: ObjectValue;
        if (name === "sandy_engineering_recovery_context") {
          data = {
            ok: true,
            snapshot_exists: !!record,
            admission_id: sourceAdmission,
            commit_sha: commitSha,
            blob_sha: effectSha,
            path: file,
            branch,
            expected_blob_sha: baselineSha,
          };
        } else if (name === "sandy_engineering_capture_recovery") {
          record = args.p_record as ObjectValue;
          assert.equal(
            (record.compensation_arguments as ObjectValue).body &&
              ((record.compensation_arguments as ObjectValue)
                .body as ObjectValue).sha,
            effectSha,
          );
          assert.equal(record.compensation_operation, "github.files.update");
          data = { ok: true, snapshot_id: snapshotId, reused: false };
        } else if (name === "sandy_lifecycle_context") {
          data = {
            ok: true,
            source_state: "succeeded",
            snapshot: {
              id: snapshotId,
              actor_id: actor,
              source_request_id: sourceRequest,
              source_operation: "github.files.update",
              captured_at: "2026-10-22T00:00:00Z",
              record,
            },
            compensation,
            observations: [],
          };
        } else if (name === "sandy_lifecycle_observe") {
          if (args.p_phase === "compensation" && args.p_matched === true) {
            compensation = { ...compensation, state: "verified" };
          }
          data = {
            ok: true,
            observation_id: observationId,
            phase: args.p_phase,
            read_admission_id: args.p_read_admission_id,
            effect_confirmed: args.p_matched,
          };
        } else if (name === "sandy_engineering_reserve_compensation") {
          if (options.reserveLost) return { data: null, error: true };
          data = {
            ok: true,
            request_id: inverseRequest,
            authorization_id: inverseApproval,
            reused: false,
            redispatch_permitted: true,
          };
        } else if (name === "sandy_lifecycle_finish_compensation") {
          compensation = {
            request_id: inverseRequest,
            state: "accepted",
            admission_id: inverseAdmission,
          };
          data = { ok: true, ...compensation, redispatch_permitted: false };
        } else throw Error("Unexpected private RPC " + name);
        return { data, error: null };
      },
    },
    async executeCanonical(
      childContext: LifecycleContext,
      operation: string,
      args: ObjectValue,
    ) {
      assert.deepEqual(childContext.engineering, engineering);
      calls.push({ operation, args });
      let result: ObjectValue;
      if (operation === "github.git.commits.get") {
        result = { sha: commitSha, parents: [{ sha: parentSha }] };
      } else if (operation === "github.files.content.get") {
        assert.deepEqual(args, {
          path: { path: file },
          query: { ref: parentSha },
        });
        result = {
          path: file,
          sha: baselineSha,
          type: "file",
          encoding: "base64",
          content: options.wrongBaseline ? after : before,
        };
      } else if (operation === "github.files.metadata.get") {
        result = { path: file, type: "file", sha: currentSha };
      } else if (operation === "github.files.update") {
        writes++;
        assert.equal(childContext.scope?.approvalId, inverseApproval);
        assert.deepEqual(args, record!.compensation_arguments);
        currentSha = baselineSha;
        return Response.json({
          ok: true,
          executed: true,
          operation,
          admission_id: inverseAdmission,
        });
      } else throw Error("Unexpected provider operation " + operation);
      // The production gateway wraps its validated provider result.
      return Response.json({
        ok: true,
        executed: true,
        operation,
        admission_id: readAdmission,
        result: {
          ok: true,
          operation,
          admission_id: readAdmission,
          executed: true,
          request_state: "observed",
          result,
        },
      });
    },
  };
  return {
    calls,
    writes: () => writes,
    run: (operation: string) =>
      executeProviderLifecycle(deps, { ...context, engineering }, operation, {
        source_request_id: sourceRequest,
      }),
  };
}
Deno.test("standing recovery derives its immutable baseline through canonical source reads and executes one reauthorized conditional inverse", async () => {
  const h = await standingRecoveryHarness();
  const result = await h.run("system.lifecycle.compensate");
  assert.equal(result.status, 200, await result.clone().text());
  const value = await result.json();
  assert.equal(value.effect_confirmed, true);
  assert.equal(value.request_state, "verified");
  assert.equal(value.redispatch_permitted, false);
  assert.equal(h.writes(), 1);
  const second = await h.run("system.lifecycle.compensate");
  assert.equal(second.status, 200);
  assert.equal((await second.json()).effect_confirmed, true);
  assert.equal(h.writes(), 1);
});
Deno.test("standing recovery refuses an altered baseline, changed current file and uncertain reservation before any inverse dispatch", async () => {
  for (
    const options of [{ wrongBaseline: true }, { changedResource: true }, {
      reserveLost: true,
    }]
  ) {
    const h = await standingRecoveryHarness(options);
    const result = await h.run("system.lifecycle.compensate");
    assert.equal(
      result.status,
      options.reserveLost ? 503 : 409,
      await result.clone().text(),
    );
    assert.equal(h.writes(), 0);
  }
});
