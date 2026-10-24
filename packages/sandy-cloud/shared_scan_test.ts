import { deepStrictEqual, rejects } from "node:assert/strict";
import {
  cloudScanBindingDigest,
  type ScanBinding,
  type ScanCommitInput,
  sharedScanOwner,
  type VerifiedRuntimeScan,
} from "./postgres/shared_scan.ts";
const id = (n: number) =>
  `${String(n).padStart(8, "0")}-0000-4000-8000-000000000001`;
const ref = {
  tenantId: id(1),
  workspaceId: id(2),
  bucket: "synthetic",
  key: "tenant/object",
  generation: "101",
  size: 3,
  sha256: "a".repeat(64),
};
const input: ScanCommitInput = {
  intent: {
    id: id(3),
    actorId: id(4),
    traceId: "trace",
    expectedRevision: 0,
    idempotencyKey: "idempotency",
    expiresAt: 2000,
    ref,
  },
  fileId: id(5),
  admission: {
    customerId: id(6),
    policyEpoch: 7,
    admissionId: id(8),
    expiresAt: 2000,
  },
  proof: { state: "BYTES_VERIFIED", ref, bytesRead: 3, sha256: ref.sha256 },
};
const binding: ScanBinding = {
  artifactId: id(7),
  admissionId: id(8),
  actorId: input.intent.actorId,
  operation: "cloud.upload.complete",
  inputSha256: "b".repeat(64),
  contractSha256: "c".repeat(64),
  scopeSha256: "d".repeat(64),
  bindingSha256: "",
};
binding.bindingSha256 = cloudScanBindingDigest(input, binding);
const record: VerifiedRuntimeScan = {
  customerId: id(6),
  tenantId: id(1),
  authorityRevision: "canonical-revision-9",
  record: {
    version: 1,
    receiptId: id(9),
    artifactId: id(7),
    fileId: id(5),
    admissionId: id(8),
    actorId: id(4),
    customerId: id(6),
    generation: "101",
    size: 3,
    sha256: ref.sha256,
    bindingSha256: binding.bindingSha256,
    issuer: "fixture-scanner",
    release: "test-only",
    trustRevision: 3,
    verdict: "CLEAN",
    issuedAt: 0,
    expiresAt: 1800,
  },
};
const tx = { query: async () => ({ rows: [] }) };
function fixture() {
  let verified = structuredClone(record),
    source = { receiptId: id(9), binding: { ...binding } },
    clock = 1000,
    calls = 0;
  let rejection = false;
  const owner = sharedScanOwner(
    {
      verifyScanInTransaction: async (got, b, receipt) => {
        deepStrictEqual(got, tx);
        deepStrictEqual(b, source.binding);
        deepStrictEqual(receipt, id(9));
        calls++;
        if (rejection) throw Error("SCANNER_RELEASE_UNTRUSTED");
        return verified;
      },
    },
    {
      lock: async (got) => {
        deepStrictEqual(got, tx);
        return source;
      },
    },
    { operation: binding.operation, sha256: binding.contractSha256 },
    () => clock,
  );
  return {
    owner,
    get calls() {
      return calls;
    },
    set record(v: VerifiedRuntimeScan) {
      verified = v;
    },
    set source(v: typeof source) {
      source = v;
    },
    set clock(v: number) {
      clock = v;
    },
    set rejection(v: boolean) {
      rejection = v;
    },
  };
}
Deno.test("shared scan reuses supplied transaction and emits reference only, without claim or seal", async () => {
  const f = fixture();
  const e = await f.owner.verifyInTransaction(tx, input);
  deepStrictEqual(e, {
    receiptId: id(9),
    bindingSha256: binding.bindingSha256,
    scannerIdentity: "fixture-scanner",
    scannerVersion: "test-only",
    trustRevision: 3,
    authorityRevision: "canonical-revision-9",
    expiresAt: 1800,
  });
  deepStrictEqual(f.calls, 1);
});
Deno.test("Cloud digest binds bucket/key/workspace/input/revision and rejects before shared validator", async () => {
  for (
    const changed of [
      {
        ...input,
        intent: { ...input.intent, ref: { ...ref, key: "foreign" } },
      },
      {
        ...input,
        intent: { ...input.intent, ref: { ...ref, bucket: "foreign" } },
      },
      {
        ...input,
        intent: { ...input.intent, ref: { ...ref, workspaceId: id(30) } },
      },
      { ...input, intent: { ...input.intent, expectedRevision: 1 } },
      { ...input, admission: { ...input.admission, policyEpoch: 8 } },
      { ...input, fileId: id(30) },
    ]
  ) {
    const f = fixture();
    await rejects(
      f.owner.verifyInTransaction(tx, changed),
      /SHARED_SCAN_BINDING_REFUSED/,
    );
    deepStrictEqual(f.calls, 0);
  }
});
Deno.test("shared receipt exact owner, artifact, generation, digest, scanner identity and lifetime are required", async () => {
  const variants: VerifiedRuntimeScan[] = [{ ...record, customerId: id(30) }, {
    ...record,
    tenantId: id(30),
  }, { ...record, authorityRevision: "" }];
  for (
    const patch of [
      { fileId: id(30) },
      { receiptId: id(30) },
      { artifactId: id(30) },
      { admissionId: id(30) },
      { actorId: id(30) },
      { customerId: id(30) },
      { generation: "102" },
      { size: 4 },
      { sha256: "e".repeat(64) },
      { bindingSha256: "e".repeat(64) },
      { verdict: "REJECTED" as const },
      { issuer: "" },
      { release: "" },
      { trustRevision: 0 },
      { expiresAt: 1000 },
      { issuedAt: 1001 },
    ]
  ) variants.push({ ...record, record: { ...record.record, ...patch } });
  for (const changed of variants) {
    const f = fixture();
    f.record = changed;
    await rejects(
      f.owner.verifyInTransaction(tx, input),
      /SHARED_SCAN_BINDING_REFUSED/,
    );
  }
  const f = fixture();
  f.rejection = true;
  await rejects(
    f.owner.verifyInTransaction(tx, input),
    /SCANNER_RELEASE_UNTRUSTED/,
  );
});
Deno.test("invalid clock fails before verification and expired authority never extends on replay", async () => {
  for (const clock of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture();
    f.clock = clock;
    await rejects(
      f.owner.verifyInTransaction(tx, input),
      /SHARED_SCAN_BINDING_REFUSED/,
    );
    deepStrictEqual(f.calls, 0);
  }
  const f = fixture();
  await f.owner.verifyInTransaction(tx, input);
  f.clock = 1800;
  await rejects(
    f.owner.verifyInTransaction(tx, input),
    /SHARED_SCAN_BINDING_REFUSED/,
  );
});
