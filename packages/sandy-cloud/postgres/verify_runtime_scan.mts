/** Executes the pinned Runtime journal unchanged, in an ephemeral PostgreSQL
 * fixture. Ephemeral test signing material never leaves this process/database.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  intentDigest,
  PostgresCommitBoundary,
  type ProductionOwners,
  type SqlDatabase,
  type SqlTransaction,
} from "./commit.ts";
import {
  cloudScanBindingDigest,
  type ScanBinding,
  sharedScanOwner,
} from "./shared_scan.ts";
import { completeUpload } from "../integrity.ts";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const runtimeRoot = process.argv[3];
const { ArtifactJournal } = await import(
  pathToFileURL(runtimeRoot + "/journal.ts").href
);
const { scanBytes } = await import(
  pathToFileURL(runtimeRoot + "/attestation.ts").href
);
const db = new PGlite();
const id = (n: number) =>
  `${String(n).padStart(8, "0")}-0000-4000-8000-000000000001`;
const bytes = new TextEncoder().encode("abc"), expiresAt = Date.now() + 300000;
const intent = {
  id: id(1),
  actorId: id(2),
  traceId: "trace",
  expectedRevision: 0,
  idempotencyKey: "key",
  expiresAt,
  ref: {
    tenantId: id(3),
    workspaceId: id(4),
    bucket: "synthetic-bucket",
    key: "private/object",
    generation: "101",
    size: 3,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  },
};
const fileId = id(5),
  customerId = id(6),
  receiptId = id(9),
  admission = { customerId, policyEpoch: 1 };
const proof = {
  state: "BYTES_VERIFIED" as const,
  ref: intent.ref,
  bytesRead: 3,
  sha256: intent.ref.sha256,
};
const binding: ScanBinding = {
  artifactId: id(7),
  admissionId: id(8),
  actorId: intent.actorId,
  operation: "cloud.upload.complete",
  inputSha256: "b".repeat(64),
  contractSha256: "c".repeat(64),
  scopeSha256: "d".repeat(64),
  bindingSha256: "",
};
binding.bindingSha256 = cloudScanBindingDigest(
  { intent, fileId, admission },
  binding,
);
let transactions = 0,
  pinned: SqlTransaction | undefined,
  failProjection = false;
const connection: SqlDatabase = {
  transaction: async (fn) => {
    transactions++;
    return await db.transaction(async (tx: SqlTransaction) => {
      assert.equal(pinned, undefined, "nested transaction forbidden");
      pinned = tx;
      try {
        return await fn(tx);
      } finally {
        pinned = undefined;
      }
    });
  },
};
const journal = new ArtifactJournal(connection, {
  lockAndResolve: async (tx: SqlTransaction) => {
    assert.equal(tx, pinned);
    return {
      customerId,
      tenantId: intent.ref.tenantId,
      revision: "fixture-revision-1",
    };
  },
});
const scanner = sharedScanOwner(journal, {
  lock: async (tx) => {
    assert.equal(tx, pinned);
    return { receiptId, binding };
  },
}, { operation: binding.operation, sha256: binding.contractSha256 });
const owners: ProductionOwners = {
  lockAdmission: async () => admission,
  projectVersion: async (tx, { receipt }) => {
    assert.equal(tx, pinned);
    await tx.query("UPDATE sandy_universal_files SET sha256=$1", [
      receipt.ref.sha256,
    ]);
    if (failProjection) throw Error("PROJECTION_FAILED");
  },
};
const boundary = new PostgresCommitBoundary(connection, owners, scanner);
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
async function seed() {
  await db.exec(
    "TRUNCATE sandy_cloud.workspaces CASCADE; UPDATE sandy_universal_files SET sha256=NULL;",
  );
  await db.query(
    "INSERT INTO sandy_cloud.workspaces VALUES($1,$2,$3,100,0,3,1)",
    [intent.ref.tenantId, intent.ref.workspaceId, customerId],
  );
  await db.query(
    "INSERT INTO sandy_cloud.file_heads(tenant_id,workspace_id,file_id) VALUES($1,$2,$3)",
    [intent.ref.tenantId, intent.ref.workspaceId, fileId],
  );
  await db.query(
    `INSERT INTO sandy_cloud.upload_intents(tenant_id,workspace_id,intent_id,actor_id,idempotency_key,file_id,input_sha256,
 ref,expected_revision,policy_epoch,expires_at,reserved_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,1,$9,3)`,
    [
      intent.ref.tenantId,
      intent.ref.workspaceId,
      intent.id,
      intent.actorId,
      intent.idempotencyKey,
      fileId,
      intentDigest(intent),
      JSON.stringify(intent.ref),
      new Date(expiresAt),
    ],
  );
}
async function counts() {
  return (await db.query(`SELECT
 (SELECT count(*)::int FROM sandy_cloud.versions) versions,
 (SELECT count(*)::int FROM sandy_cloud.version_scans) scans,
 (SELECT count(*)::int FROM sandy_cloud.commit_receipts) receipts,
 (SELECT count(*)::int FROM sandy_artifact_custody.claims) claims`)).rows[0];
}
const empty = { versions: 0, scans: 0, receipts: 0, claims: 0 };
try {
  await db.exec(
    `CREATE TABLE public.sandy_universal_files(id uuid PRIMARY KEY,owner_customer_id uuid NOT NULL,sha256 text);
 CREATE TABLE public.sandy_api_execution_admissions(id uuid PRIMARY KEY,actor_id uuid,tenant_id uuid,operation text,
 input_sha256 text,contract_sha256 text,scope_sha256 text,state text,expires_at timestamptz);`,
  );
  await db.query("INSERT INTO sandy_universal_files VALUES($1,$2,NULL)", [
    fileId,
    customerId,
  ]);
  await db.query(
    `INSERT INTO sandy_api_execution_admissions VALUES($1,$2,$3,$4,$5,$6,$7,'consumed',$8)`,
    [
      binding.admissionId,
      binding.actorId,
      intent.ref.tenantId,
      binding.operation,
      binding.inputSha256,
      binding.contractSha256,
      binding.scopeSha256,
      new Date(expiresAt),
    ],
  );
  await db.exec(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  await db.exec(await readFile(runtimeRoot + "/schema.sql", "utf8"));
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const key = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey))
    .toString("hex");
  await db.query(
    `INSERT INTO sandy_artifact_custody.scanner_releases VALUES('fixture','ephemeral', $1,1,NULL)`,
    [key],
  );
  const a = {
    version: 1,
    receiptId,
    artifactId: binding.artifactId,
    fileId,
    admissionId: binding.admissionId,
    actorId: binding.actorId,
    customerId,
    generation: intent.ref.generation,
    size: 3,
    sha256: intent.ref.sha256,
    bindingSha256: binding.bindingSha256,
    issuer: "fixture",
    release: "ephemeral",
    trustRevision: 1,
    verdict: "CLEAN",
    issuedAt: Date.now() - 1000,
    expiresAt,
  };
  const signature = Buffer.from(
    await crypto.subtle.sign("Ed25519", pair.privateKey, scanBytes(a)),
  ).toString("hex");
  await journal.recordScan(binding, a, signature);
  await seed();
  await check(
    "actual Runtime verifier shares Cloud transaction; commit stores reference without acquire or seal",
    async () => {
      const before = transactions;
      await boundary.assertScanClean(intent, proof);
      assert.equal(transactions - before, 1);
      const beforeCommit = transactions;
      await boundary.commit(intent, proof);
      assert.equal(transactions - beforeCommit, 1);
      assert.deepEqual(await counts(), {
        versions: 1,
        scans: 1,
        receipts: 1,
        claims: 0,
      });
      assert.equal(
        (await db.query("SELECT receipt_id FROM sandy_cloud.version_scans"))
          .rows[0].receipt_id,
        receiptId,
      );
      assert.equal(
        (await db.query(
          "SELECT to_regclass('sandy_cloud.scan_receipts') AS table_name",
        )).rows[0].table_name,
        null,
      );
    },
  );
  await seed();
  await check(
    "shared signed receipt survives Cloud rollback without a second custody authority",
    async () => {
      failProjection = true;
      await assert.rejects(boundary.commit(intent, proof), /PROJECTION_FAILED/);
      failProjection = false;
      assert.deepEqual(await counts(), empty);
      assert.equal(
        (await db.query(
          "SELECT count(*)::int n FROM sandy_artifact_custody.scan_receipts",
        )).rows[0].n,
        1,
      );
    },
  );
  await check(
    "legacy clean row cannot replace required shared owner",
    async () => {
      const missing = new PostgresCommitBoundary(
        connection,
        owners,
        undefined as never,
      );
      await assert.rejects(
        missing.commit(intent, proof),
        /SHARED_SCAN_OWNER_REQUIRED/,
      );
      assert.deepEqual(await counts(), empty);
    },
  );
  await check(
    "expiry at final settlement rolls back canonical projection and scan reference",
    async () => {
      let projected = false;
      const late = new PostgresCommitBoundary(connection, {
        ...owners,
        projectVersion: async (tx, input) => {
          await owners.projectVersion(tx, input);
          projected = true;
          await tx.query("SELECT pg_sleep(0.3)");
        },
      }, {
        verifyInTransaction: async (tx, input) => ({
          ...await scanner.verifyInTransaction(tx, input),
          expiresAt: Date.now() + 200,
        }),
      });
      await assert.rejects(
        late.commit(intent, proof),
        /SCAN_OR_INTENT_EXPIRED_BEFORE_COMMIT/,
      );
      assert.equal(projected, true);
      assert.deepEqual(await counts(), empty);
      assert.equal(
        (await db.query("SELECT sha256 FROM sandy_universal_files")).rows[0]
          .sha256,
        null,
      );
    },
  );
  await check(
    "committed lost acknowledgement reconciles without another version or repository claim",
    async () => {
      const original = boundary.commit.bind(boundary);
      boundary.commit = async (...args) => {
        await original(...args);
        throw Error("ACK_LOST");
      };
      const result = await completeUpload(
        intent,
        {
          tenantId: intent.ref.tenantId,
          workspaceId: intent.ref.workspaceId,
          allowedBuckets: new Set([intent.ref.bucket]),
          maxBytes: 100,
          signal: AbortSignal.timeout(10000),
        },
        boundary,
        async () => ({
          ref: intent.ref,
          body: new ReadableStream({
            start(c) {
              c.enqueue(bytes);
              c.close();
            },
          }),
        }),
      );
      assert.equal(result.state, "COMMITTED");
      assert.deepEqual(await counts(), {
        versions: 1,
        scans: 1,
        receipts: 1,
        claims: 0,
      });
      await assert.rejects(
        db.exec("DELETE FROM sandy_cloud.version_scans"),
        /IMMUTABLE/,
      );
      boundary.commit = original;
    },
  );
  await seed();
  await check(
    "scanner withdrawal after preflight refuses commit under actual Runtime validation",
    async () => {
      await boundary.assertScanClean(intent, proof);
      await db.exec(
        "UPDATE sandy_artifact_custody.scanner_releases SET revoked_at=clock_timestamp()",
      );
      await assert.rejects(
        boundary.commit(intent, proof),
        /SCANNER_RELEASE_UNTRUSTED/,
      );
      assert.deepEqual(await counts(), empty);
    },
  );
  console.log(
    JSON.stringify({
      suite: "cloud-runtime-shared-scan",
      passed,
      runtimeCommit: "ab2cfa4fb29fc5ba72a72fb77c0665fd1181ae55",
      providerExecuted: false,
      liveDatabaseUsed: false,
      productionTrustActivated: false,
      multiSessionLocksVerified: false,
    }),
  );
} finally {
  await db.close();
}
