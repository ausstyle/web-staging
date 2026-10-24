import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { argumentDigest } from "./sandy_api_protocol.ts";
import {
  type ArtifactContext,
  type ArtifactCustodyOwner,
  type SealedArtifact,
  stageRepositoryArtifact,
} from "./sandy_repository_artifact_custody.ts";
import { repositoryText } from "./sandy_repository_text.ts";
const context = (): ArtifactContext => ({
  artifactId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  customerId: "55555555-5555-4555-8555-555555555555",
  tenantId: null,
  admissionId: "33333333-3333-4333-8333-333333333333",
  operation: "github.files.create",
  repository: "ausstyle/web-staging",
  path: "engineering-smoke/fixture.bin",
  ref: "refs/heads/engineering/artifact",
  inputSha256: "a".repeat(64),
  contractSha256: "b".repeat(64),
  scopeSha256: "c".repeat(64),
});
async function fixture(bytes: Uint8Array, c = context()) {
  const record: SealedArtifact = {
    artifactId: c.artifactId,
    ownerActorId: c.actorId,
    ownerCustomerId: c.customerId,
    tenantId: c.tenantId,
    authorityRevision: "revision-1",
    generation: "7",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bindingSha256: await argumentDigest(c),
    expiresAt: 1000,
    scanReceiptId: "scan-1",
    state: "sealed",
  };
  const stats = {
    open: 0,
    append: 0,
    seal: 0,
    discard: 0,
    claim: 0,
    revalidate: 0,
    claimed: false,
  };
  const owner: ArtifactCustodyOwner = {
    withClaim: async (c, work) => {
      stats.claim++;
      if (stats.claimed) throw Error("duplicate claim");
      stats.claimed = true;
      return await work(record);
    },
    verifyScan: () =>
      Promise.resolve({
        receiptId: record.scanReceiptId,
        artifactId: record.artifactId,
        generation: record.generation,
        sha256: record.sha256,
        size: record.size,
        bindingSha256: record.bindingSha256,
        scannerIdentity: "fixture-scanner",
        scannerVersion: "v1",
        verdict: "clean",
        expiresAt: 1000,
      }),
    openGeneration: async () => {
      stats.open++;
      let offset = 0;
      return {
        artifactId: record.artifactId,
        generation: record.generation,
        body: new ReadableStream({
          pull(controller) {
            if (offset === bytes.length) {
              controller.close();
              return;
            }
            const part = bytes.slice(offset, offset + 65536);
            offset += part.length;
            controller.enqueue(part);
          },
        }),
      };
    },
    stage: async () => ({
      append: async () => {
        stats.append++;
      },
      seal: async (proof, fence) => {
        assert.equal(fence.authorityRevision, record.authorityRevision);
        assert.equal(fence.customerId, c.customerId);
        assert.equal(fence.tenantId, c.tenantId);
        assert.equal(fence.scanReceiptId, record.scanReceiptId);
        stats.seal++;
        return { privateHandle: "private-artifact-1", proof };
      },
      discard: async () => {
        stats.discard++;
      },
    }),
    revalidate: async () => {
      stats.revalidate++;
      return true;
    },
  };
  return { record, stats, owner, c };
}
Deno.test("binary custody streams a large artifact to private staging without weakening text guard", async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024 + 3);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  assert.throws(() => repositoryText(btoa(String.fromCharCode(0, 255, 1))));
  const f = await fixture(bytes);
  const result = await stageRepositoryArtifact(
    f.c,
    f.owner,
    new AbortController().signal,
    () => 10,
  );
  assert.equal(result.proof.sha256, f.record.sha256);
  assert.equal(result.proof.size, bytes.length);
  assert.ok(f.stats.append > 1);
  assert.equal(f.stats.seal, 1);
  assert.equal(f.stats.discard, 0);
  assert.deepEqual(Object.keys(result).sort(), ["privateHandle", "proof"]);
  assert.ok(!("content" in result.proof) && !("base64" in result.proof));
  await assert.rejects(
    () =>
      stageRepositoryArtifact(
        f.c,
        f.owner,
        new AbortController().signal,
        () => 10,
      ),
    /duplicate/,
  );
});
Deno.test("foreign actor, admission, path, generation binding and stale scan never open bytes", async () => {
  for (
    const patch of [
      { actorId: "44444444-4444-4444-8444-444444444444" },
      { admissionId: "44444444-4444-4444-8444-444444444444" },
      { path: "other.bin" },
      { contractSha256: "d".repeat(64) },
      { scopeSha256: "d".repeat(64) },
    ]
  ) {
    const f = await fixture(new Uint8Array([0, 255]));
    await assert.rejects(() =>
      stageRepositoryArtifact(
        { ...f.c, ...patch },
        f.owner,
        new AbortController().signal,
        () => 10,
      )
    );
    assert.equal(f.stats.open, 0);
  }
  const f = await fixture(new Uint8Array());
  f.owner.verifyScan = () => Promise.resolve(null);
  await assert.rejects(() =>
    stageRepositoryArtifact(
      f.c,
      f.owner,
      new AbortController().signal,
      () => 10,
    )
  );
  assert.equal(f.stats.open, 0);
});
Deno.test("short, corrupt and oversize artifacts discard staging without publishing", async () => {
  for (
    const edit of [
      (r: SealedArtifact) => r.size++,
      (r: SealedArtifact) => r.size--,
      (r: SealedArtifact) => r.sha256 = "0".repeat(64),
    ]
  ) {
    const f = await fixture(new Uint8Array([1, 2, 3]));
    edit(f.record);
    await assert.rejects(() =>
      stageRepositoryArtifact(
        f.c,
        f.owner,
        new AbortController().signal,
        () => 10,
      )
    );
    assert.equal(f.stats.seal, 0);
    assert.equal(f.stats.discard, 1);
  }
  const f = await fixture(new Uint8Array());
  f.record.size = 8 * 1024 * 1024 + 1;
  await assert.rejects(() =>
    stageRepositoryArtifact(
      f.c,
      f.owner,
      new AbortController().signal,
      () => 10,
    )
  );
  assert.equal(f.stats.open, 0);
});
Deno.test("revocation and expiry at publication fail closed after byte verification", async () => {
  for (const revoke of [true, false]) {
    const f = await fixture(new Uint8Array([0, 255]));
    let time = 10;
    f.owner.revalidate = async () => {
      time = revoke ? 10 : 1000;
      return !revoke;
    };
    await assert.rejects(() =>
      stageRepositoryArtifact(
        f.c,
        f.owner,
        new AbortController().signal,
        () => time,
      )
    );
    assert.equal(f.stats.seal, 0);
    assert.equal(f.stats.discard, 1);
  }
});
Deno.test("unknown seal preserves private evidence and never retries or discards", async () => {
  const f = await fixture(new Uint8Array([0, 255]));
  f.owner.stage = async () => ({
    append: async () => {},
    seal: async () => {
      f.stats.seal++;
      throw Error("lost acknowledgement");
    },
    discard: async () => {
      f.stats.discard++;
    },
  });
  await assert.rejects(
    () =>
      stageRepositoryArtifact(
        f.c,
        f.owner,
        new AbortController().signal,
        () => 10,
      ),
    /COMMIT_UNKNOWN/,
  );
  assert.equal(f.stats.seal, 1);
  assert.equal(f.stats.discard, 0);
});
Deno.test("abort cancels stalled byte stream and never seals", async () => {
  const f = await fixture(new Uint8Array([0]));
  const controller = new AbortController();
  let cancelled = false;
  f.owner.openGeneration = async () => ({
    artifactId: f.record.artifactId,
    generation: f.record.generation,
    body: new ReadableStream({
      pull() {
        queueMicrotask(() => controller.abort());
        return new Promise(() => {});
      },
      cancel() {
        cancelled = true;
      },
    }),
  });
  await assert.rejects(() =>
    stageRepositoryArtifact(f.c, f.owner, controller.signal, () => 10)
  );
  assert.equal(cancelled, true);
  assert.equal(f.stats.seal, 0);
  assert.equal(f.stats.discard, 1);
});
Deno.test("empty artifacts work; untrusted generation and oversized chunks cannot stage verified output", async () => {
  const empty = await fixture(new Uint8Array());
  assert.equal(
    (await stageRepositoryArtifact(
      empty.c,
      empty.owner,
      new AbortController().signal,
      () => 10,
    )).proof.size,
    0,
  );
  for (const mismatch of [true, false]) {
    const f = await fixture(new Uint8Array(1024 * 1024 + 1));
    let cancelled = false;
    f.owner.openGeneration = async () => ({
      artifactId: f.record.artifactId,
      generation: mismatch ? "other" : f.record.generation,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel() {
          cancelled = true;
        },
      }),
    });
    await assert.rejects(() =>
      stageRepositoryArtifact(
        f.c,
        f.owner,
        new AbortController().signal,
        () => 10,
      )
    );
    assert.equal(f.stats.seal, 0);
    assert.equal(cancelled, true);
  }
});
Deno.test("private seal digest mismatch remains unknown and unsafe targets never claim", async () => {
  const f = await fixture(new Uint8Array([1]));
  f.owner.stage = async () => ({
    append: async () => {},
    discard: async () => {
      f.stats.discard++;
    },
    seal: async (proof) => ({
      privateHandle: "private-1",
      proof: { ...proof, size: 999 },
    }),
  });
  await assert.rejects(
    () =>
      stageRepositoryArtifact(
        f.c,
        f.owner,
        new AbortController().signal,
        () => 10,
      ),
    /COMMIT_UNKNOWN/,
  );
  assert.equal(f.stats.discard, 0);
  for (
    const patch of [{ path: ".env" }, { path: "../foreign" }, {
      ref: "refs/heads/main",
    }, { ref: "refs/heads/engineering/../main" }]
  ) {
    const f = await fixture(new Uint8Array());
    await assert.rejects(() =>
      stageRepositoryArtifact(
        { ...f.c, ...patch },
        f.owner,
        new AbortController().signal,
        () => 10,
      )
    );
    assert.equal(f.stats.claim, 0);
  }
});

Deno.test("canonical customer and tenant mismatch reject even a matching caller digest", async () => {
  for (
    const patch of [
      { customerId: "66666666-6666-4666-8666-666666666666" },
      { tenantId: "66666666-6666-4666-8666-666666666666" },
    ]
  ) {
    const f = await fixture(new Uint8Array([1]));
    const altered = { ...f.c, ...patch };
    f.record.bindingSha256 = await argumentDigest(altered);
    await assert.rejects(() =>
      stageRepositoryArtifact(
        altered,
        f.owner,
        new AbortController().signal,
        () => 10,
      )
    );
    assert.equal(f.stats.open, 0);
  }
});
Deno.test("scanner receipt must bind exact bytes generation identity version and lifetime", async () => {
  for (
    const patch of [
      { generation: "8" },
      { sha256: "f".repeat(64) },
      { size: 999 },
      { artifactId: "other" },
      { receiptId: "other" },
      { bindingSha256: "f".repeat(64) },
      { scannerIdentity: "" },
      { scannerVersion: "" },
      { verdict: "infected" },
      { expiresAt: 10 },
    ]
  ) {
    const f = await fixture(new Uint8Array([1]));
    const scan = await f.owner.verifyScan(f.record, f.record.bindingSha256);
    f.owner.verifyScan = async () =>
      ({ ...scan!, ...patch }) as unknown as NonNullable<typeof scan>;
    await assert.rejects(
      () =>
        stageRepositoryArtifact(
          f.c,
          f.owner,
          new AbortController().signal,
          () => 10,
        ),
      /SCAN_REQUIRED/,
    );
    assert.equal(f.stats.open, 0);
  }
});
Deno.test("scan expiry during streaming prevents seal even when artifact remains valid", async () => {
  const f = await fixture(new Uint8Array([1]));
  const scan = await f.owner.verifyScan(f.record, f.record.bindingSha256);
  f.owner.verifyScan = async () => ({ ...scan!, expiresAt: 20 });
  let time = 10;
  const stage = f.owner.stage;
  f.owner.stage = async (c) => {
    const result = await stage(c);
    return {
      ...result,
      append: async (bytes) => {
        await result.append(bytes);
        time = 20;
      },
    };
  };
  await assert.rejects(() =>
    stageRepositoryArtifact(
      f.c,
      f.owner,
      new AbortController().signal,
      () => time,
    )
  );
  assert.equal(f.stats.seal, 0);
  assert.equal(f.stats.discard, 1);
});
Deno.test("revocation after revalidation is fenced at seal without retry or cleanup", async () => {
  const f = await fixture(new Uint8Array([1]));
  f.owner.revalidate = async () => {
    f.record.authorityRevision = "revision-2";
    return true;
  };
  // The canonical owner must do this comparison under its shared transaction lock.
  f.owner.stage = async () => ({
    append: async () => {},
    discard: async () => {
      f.stats.discard++;
    },
    seal: async (_proof, fence) => {
      f.stats.seal++;
      assert.notEqual(fence.authorityRevision, f.record.authorityRevision);
      throw Error("canonical revision changed");
    },
  });
  await assert.rejects(
    () =>
      stageRepositoryArtifact(
        f.c,
        f.owner,
        new AbortController().signal,
        () => 10,
      ),
    /COMMIT_UNKNOWN/,
  );
  assert.equal(f.stats.seal, 1);
  assert.equal(f.stats.discard, 0);
});
