import { deepStrictEqual, rejects, throws } from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  type CommitBoundary,
  completeUpload,
  type ObjectRef,
  type ReadPolicy,
  type UploadIntent,
  verifyObject,
} from "./integrity.ts";
import {
  portablePath,
  type SnapshotManifest,
  validateManifest,
  verifyRestore,
} from "./restore.ts";

const data = new TextEncoder().encode("Synthetic Sandy Cloud fixture\n");
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const ref: ObjectRef = {
  tenantId: "tenant-a",
  workspaceId: "personal-a",
  bucket: "synthetic-only",
  key: "opaque/object",
  generation: "101",
  size: data.length,
  sha256: hash(data),
};
const policy = (): ReadPolicy => ({
  tenantId: ref.tenantId,
  workspaceId: ref.workspaceId,
  allowedBuckets: new Set([ref.bucket]),
  maxBytes: 1024,
  signal: new AbortController().signal,
});
function body(bytes = data) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.subarray(0, 3));
      c.enqueue(bytes.subarray(3));
      c.close();
    },
  });
}
const open = async () => ({ ref: { ...ref }, body: body() });
const intent = (): UploadIntent => ({
  id: "upload-1",
  actorId: "actor-a",
  traceId: "trace-1",
  expectedRevision: 4,
  idempotencyKey: "key-1",
  expiresAt: Date.now() + 60000,
  ref: { ...ref },
});
function fixture() {
  let receipt: Awaited<ReturnType<CommitBoundary["lookup"]>> = null;
  let writes = 0;
  const boundary: CommitBoundary = {
    authorize: async () => {},
    lookup: async () => receipt,
    assertScanClean: async () => {},
    commit: async (i) => {
      writes++;
      receipt = {
        state: "COMMITTED",
        intentId: i.id,
        versionId: "version-1",
        revision: i.expectedRevision + 1,
        ref: { ...i.ref },
        traceId: i.traceId,
      };
    },
  };
  return { boundary, writes: () => writes };
}
Deno.test("independent streaming digest includes every chunk and handles empty objects", async () => {
  deepStrictEqual((await verifyObject(ref, policy(), open)).sha256, hash(data));
  const empty = { ...ref, size: 0, sha256: hash(new Uint8Array()) };
  deepStrictEqual(
    (await verifyObject(
      empty,
      policy(),
      async () => ({ ref: empty, body: body(new Uint8Array()) }),
    )).bytesRead,
    0,
  );
});
Deno.test("short, oversized, corrupt and substituted-generation reads fail", async () => {
  for (
    const bytes of [
      data.subarray(1),
      new Uint8Array(data.length + 1),
      new Uint8Array(data.length),
    ]
  ) {
    await rejects(
      verifyObject(ref, policy(), async () => ({ ref, body: body(bytes) })),
      /SIZE_MISMATCH|CHECKSUM_MISMATCH/,
    );
  }
  await rejects(
    verifyObject(
      ref,
      policy(),
      async () => ({ ref: { ...ref, generation: "102" }, body: body() }),
    ),
    /OBJECT_GENERATION_MISMATCH/,
  );
});
Deno.test("100 synthetic tenant/workspace substitutions denied before provider read", async () => {
  let reads = 0;
  for (let i = 0; i < 100; i++) {
    const wrong = {
      ...ref,
      ...(i % 2 ? { tenantId: `other-${i}` } : { workspaceId: `company-${i}` }),
    };
    await rejects(
      verifyObject(wrong, policy(), async () => {
        reads++;
        return await open();
      }),
      /NOT_FOUND/,
    );
  }
  deepStrictEqual(reads, 0);
});
Deno.test("invalid size, digest, bucket, generation rejected before IO", async () => {
  for (
    const patch of [
      { size: NaN },
      { size: -1 },
      { size: 1025 },
      { sha256: "client assertion" },
      { generation: "0" },
      { bucket: "other" },
    ]
  ) {
    await rejects(
      verifyObject({ ...ref, ...patch }, policy(), open),
      /INVALID_OBJECT_REFERENCE/,
    );
  }
});
Deno.test("abort cancels stalled stream and never verifies partial bytes", async () => {
  const abort = new AbortController();
  let cancelled = false;
  const result = verifyObject(
    ref,
    { ...policy(), signal: abort.signal },
    async () => ({
      ref,
      body: new ReadableStream({
        pull() {
          abort.abort();
        },
        cancel() {
          cancelled = true;
        },
      }),
    }),
  );
  await rejects(result);
  deepStrictEqual(cancelled, true);
});
Deno.test("interrupted stream propagates failure", async () => {
  await rejects(
    verifyObject(
      ref,
      policy(),
      async () => ({
        ref,
        body: new ReadableStream({
          start(c) {
            c.enqueue(data.subarray(0, 3));
            c.error(new Error("disconnected"));
          },
        }),
      }),
    ),
    /disconnected/,
  );
});
Deno.test("commit independently read back; replay does not read provider or write twice", async () => {
  const { boundary, writes } = fixture();
  const i = intent();
  const first = await completeUpload(i, policy(), boundary, open);
  const second = await completeUpload(i, policy(), boundary, async () => {
    throw Error("must not read");
  });
  deepStrictEqual(first.state, "COMMITTED");
  deepStrictEqual(second, first);
  deepStrictEqual(writes(), 1);
});
Deno.test("lost acknowledgement reconciles durable commit, never repeats write", async () => {
  const { boundary, writes } = fixture();
  const commit = boundary.commit;
  boundary.commit = async (i, p) => {
    await commit(i, p);
    throw Error("lost ack");
  };
  deepStrictEqual(
    (await completeUpload(intent(), policy(), boundary, open)).state,
    "COMMITTED",
  );
  deepStrictEqual(writes(), 1);
});
Deno.test("uncertain commit returns unknown, never false success or automatic retry", async () => {
  const { boundary } = fixture();
  let writes = 0;
  boundary.commit = async () => {
    writes++;
    throw Error("network lost");
  };
  const result = await completeUpload(intent(), policy(), boundary, open);
  deepStrictEqual(result.state, "UNKNOWN_OUTCOME");
  deepStrictEqual(writes, 1);
});
Deno.test("malware, expiry and revocation prevent commit", async () => {
  for (const mode of ["malware", "expiry", "revocation"]) {
    const { boundary, writes } = fixture();
    const i = intent();
    let authorized = 0;
    if (mode === "malware") {
      boundary.assertScanClean = async () => {
        throw Error("MALWARE_QUARANTINED");
      };
    }
    if (mode === "expiry") i.expiresAt = 0;
    if (mode === "revocation") {
      boundary.authorize = async () => {
        if (++authorized > 1) throw Error("REVOKED");
      };
    }
    await rejects(completeUpload(i, policy(), boundary, open));
    deepStrictEqual(writes(), 0);
  }
});
Deno.test("bad durable receipt is not treated as verified completion", async () => {
  const { boundary } = fixture();
  const i = intent();
  boundary.lookup = async () => ({
    state: "COMMITTED",
    intentId: i.id,
    versionId: "v",
    revision: 5,
    ref: { ...ref, tenantId: "other" },
    traceId: i.traceId,
  });
  await rejects(
    completeUpload(i, policy(), boundary, open),
    /COMMIT_RECEIPT_MISMATCH/,
  );
});
const manifest = (): SnapshotManifest => ({
  id: "snapshot-1",
  tenantId: ref.tenantId,
  workspaceId: ref.workspaceId,
  entries: [{ path: "Folder", kind: "directory" }, {
    path: "Folder/file.txt",
    kind: "file",
    ref: { ...ref },
  }],
});
Deno.test("portable restore paths reject traversal, Windows devices, aliases and missing parents", () => {
  for (
    const path of [
      "../secret",
      "/etc/passwd",
      "a\\b",
      "C:ads",
      "a//b",
      "a/./b",
      "NUL.txt",
      "COM¹",
      "a. ",
      "a/..",
      "a\u0000b",
    ]
  ) throws(() => portablePath(path));
  const m = manifest();
  m.entries.push({ path: "folder", kind: "directory" });
  throws(() => validateManifest(m, policy()));
  const missing = manifest();
  missing.entries.shift();
  throws(() => validateManifest(missing, policy()));
});
Deno.test("restore checks independent target tree and bytes", async () => {
  const m = manifest();
  const target = {
    list: async () => m.entries.map(({ path, kind }) => ({ path, kind })),
    open: async () => body(),
  };
  deepStrictEqual(await verifyRestore(m, policy(), target), {
    state: "RESTORE_BYTES_VERIFIED",
    snapshotId: m.id,
    files: 1,
    bytes: data.length,
  });
  await rejects(
    verifyRestore(m, policy(), {
      ...target,
      open: async () => body(new Uint8Array(data.length)),
    }),
    /CHECKSUM_MISMATCH/,
  );
  await rejects(
    verifyRestore(m, policy(), {
      ...target,
      list: async () => [{ path: "Folder", kind: "directory" }],
    }),
    /RESTORE_TREE_MISMATCH/,
  );
});
