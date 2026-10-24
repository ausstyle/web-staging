import { fixtureScanner, fixtureScanSchema } from "./fixture_scan.mts";
// Isolated PostgreSQL engine, synthetic data only. No Supabase connection.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  intentDigest,
  PostgresCommitBoundary,
  type ProductionOwners,
  type SqlDatabase,
} from "./commit.ts";
import { completeUpload } from "../integrity.ts";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const file = "10000000-0000-4000-8000-000000000001";
const customer = "20000000-0000-4000-8000-000000000001";
const ref = {
  tenantId: "tenant-a",
  workspaceId: "workspace-a",
  bucket: "synthetic",
  key: "object",
  generation: "1",
  size: 0,
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};
let i = {
  id: "intent",
  actorId: "actor-a",
  traceId: "trace",
  expectedRevision: 0,
  idempotencyKey: "idem",
  expiresAt: Date.now() + 3600000,
  ref,
};
const proof = {
  state: "BYTES_VERIFIED" as const,
  ref,
  bytesRead: 0,
  sha256: ref.sha256,
};
let revoked = false, loseAck = false, failProjection = false;
const owners: ProductionOwners = {
  prepareTransaction: async () => {},
  async lockAdmission(tx, input) {
    // Test authority only. Production hook is supplied by the canonical owner.
    if (
      revoked || input.actorId !== "actor-a" ||
      input.ref.tenantId !== "tenant-a"
    ) {
      throw Error("NOT_FOUND");
    }
    return { customerId: customer, policyEpoch: 1 };
  },
  async projectVersion(tx, input) {
    await tx.query(
      `UPDATE public.sandy_universal_files SET sha256=$1,metadata=$2
      WHERE id=$3 AND owner_customer_id=$4`,
      [
        input.receipt.ref.sha256,
        JSON.stringify({ version: input.receipt.versionId }),
        input.fileId,
        input.customerId,
      ],
    );
    if (failProjection) throw Error("PROJECTION_FAILED");
  },
};
const connection: SqlDatabase = {
  async transaction(fn) {
    const result = await db.transaction(fn);
    if (loseAck) {
      loseAck = false;
      throw Error("LOST_ACK");
    }
    return result;
  },
};
const boundary = new PostgresCommitBoundary(connection, owners, fixtureScanner);
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
async function seed() {
  await db.exec(`TRUNCATE sandy_cloud.workspaces CASCADE;
    UPDATE public.sandy_universal_files SET sha256=NULL,metadata='{}';`);
  revoked = false;
  loseAck = false;
  failProjection = false;
  i = { ...i, expiresAt: Date.now() + 3600000 };
  await db.query(
    `INSERT INTO sandy_cloud.workspaces VALUES($1,$2,$3,100,0,0,1)`,
    [ref.tenantId, ref.workspaceId, customer],
  );
  await db.query(
    `INSERT INTO sandy_cloud.file_heads(tenant_id,workspace_id,file_id)
    VALUES($1,$2,$3)`,
    [ref.tenantId, ref.workspaceId, file],
  );
  await db.query(
    `INSERT INTO sandy_cloud.upload_intents
    (tenant_id,workspace_id,intent_id,actor_id,idempotency_key,file_id,input_sha256,
     ref,expected_revision,policy_epoch,expires_at,reserved_bytes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,1,$9,0)`,
    [
      ref.tenantId,
      ref.workspaceId,
      i.id,
      i.actorId,
      i.idempotencyKey,
      file,
      intentDigest(i),
      JSON.stringify(ref),
      new Date(i.expiresAt),
    ],
  );
  await db.query(
    `INSERT INTO sandy_cloud.scan_receipts VALUES($1,$2,$3,$4,'fixture-v1','CLEAN',$5)`,
    [
      ref.tenantId,
      ref.workspaceId,
      i.id,
      JSON.stringify(ref),
      new Date(i.expiresAt),
    ],
  );
}
async function state() {
  return (await db.query(`SELECT
    (SELECT count(*)::int FROM sandy_cloud.versions) AS versions,
    (SELECT count(*)::int FROM sandy_cloud.commit_receipts) AS receipts,
    (SELECT count(*)::int FROM sandy_cloud.usage_events) AS usage,
    (SELECT count(*)::int FROM sandy_cloud.outbox) AS outbox,
    (SELECT revision::int FROM sandy_cloud.file_heads) AS revision,
    (SELECT sha256 FROM public.sandy_universal_files) AS digest`)).rows[0];
}
const empty = {
  versions: 0,
  receipts: 0,
  usage: 0,
  outbox: 0,
  revision: 0,
  digest: null,
};
try {
  await db.exec(`CREATE TABLE public.sandy_universal_files(id uuid PRIMARY KEY,
    owner_customer_id uuid NOT NULL,sha256 text,metadata jsonb NOT NULL DEFAULT '{}');
    CREATE ROLE fixture_unprivileged;`);
  await db.query(
    "INSERT INTO public.sandy_universal_files(id,owner_customer_id) VALUES($1,$2)",
    [file, customer],
  );
  await db.exec(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  await db.exec(fixtureScanSchema);
  await check(
    "candidate schema has no PUBLIC access, FORCE RLS denies accidental grants",
    async () => {
      const grants = (await db.query(
        `SELECT has_schema_privilege('fixture_unprivileged','sandy_cloud','USAGE') AS allowed`,
      )).rows[0];
      assert.equal(grants.allowed, false);
      await db.exec(`GRANT USAGE ON SCHEMA sandy_cloud TO fixture_unprivileged;
      GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA sandy_cloud TO fixture_unprivileged;`);
      await seed();
      await db.exec("SET ROLE fixture_unprivileged");
      try {
        assert.equal(
          (await db.query("SELECT * FROM sandy_cloud.workspaces")).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            `INSERT INTO sandy_cloud.workspaces VALUES('x','x',$1,10,0,0,1)`,
            [customer],
          ),
        );
      } finally {
        await db.exec("RESET ROLE");
      }
    },
  );
  await seed();
  await check(
    "one transaction projects canonical file and records version, usage, outbox, receipt",
    async () => {
      await boundary.commit(i, proof);
      assert.deepEqual(await state(), {
        versions: 1,
        receipts: 1,
        usage: 1,
        outbox: 1,
        revision: 1,
        digest: ref.sha256,
      });
      assert.equal((await boundary.lookup(i))?.ref.sha256, ref.sha256);
    },
  );
  await check(
    "replay and concurrent queued replay settle exactly once",
    async () => {
      const original = await boundary.lookup(i);
      await Promise.all(
        Array.from({ length: 5 }, () => boundary.commit(i, proof)),
      );
      assert.deepEqual(await boundary.lookup(i), original);
      assert.equal((await state()).versions, 1);
    },
  );
  await check("idempotency payload substitutions rejected", async () => {
    for (
      const changed of [
        { ...i, traceId: "other" },
        { ...i, expectedRevision: 1 },
        { ...i, expiresAt: i.expiresAt + 1 },
        { ...i, ref: { ...ref, generation: "2" } },
      ]
    ) {
      await assert.rejects(boundary.lookup(changed), /IDEMPOTENCY_CONFLICT/);
    }
  });
  await check(
    "cross tenant, actor, workspace and revoked replay never expose receipt",
    async () => {
      for (
        const changed of [{ ...i, actorId: "actor-b" }, {
          ...i,
          ref: { ...ref, tenantId: "tenant-b" },
        }, { ...i, ref: { ...ref, workspaceId: "workspace-b" } }]
      ) {
        await assert.rejects(boundary.lookup(changed), /NOT_FOUND/);
      }
      revoked = true;
      await assert.rejects(boundary.lookup(i), /NOT_FOUND/);
      revoked = false;
    },
  );
  await check("immutable records reject update and delete", async () => {
    for (const table of ["versions", "commit_receipts", "usage_events"]) {
      await assert.rejects(
        db.exec(`DELETE FROM sandy_cloud.${table}`),
        /IMMUTABLE/,
      );
    }
    await assert.rejects(
      db.exec(`UPDATE sandy_cloud.versions SET revision=2`),
      /IMMUTABLE/,
    );
  });
  await seed();
  await check(
    "canonical projection failure rolls back all metadata and canonical changes",
    async () => {
      failProjection = true;
      await assert.rejects(boundary.commit(i, proof), /PROJECTION_FAILED/);
      assert.deepEqual(await state(), empty);
      failProjection = false;
    },
  );
  await check(
    "outbox failure rolls back version, quota, canonical projection and receipt",
    async () => {
      await db.exec(
        `CREATE FUNCTION public.fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'OUTBOX_FAILED'; END $$;
      CREATE TRIGGER fail_outbox BEFORE INSERT ON sandy_cloud.outbox FOR EACH ROW EXECUTE FUNCTION public.fixture_failure();`,
      );
      await assert.rejects(boundary.commit(i, proof), /OUTBOX_FAILED/);
      assert.deepEqual(await state(), empty);
      await db.exec("DROP TRIGGER fail_outbox ON sandy_cloud.outbox");
    },
  );
  await check(
    "scan change between preflight and transaction blocks commit",
    async () => {
      await boundary.assertScanClean(i, proof);
      await db.exec(`UPDATE sandy_cloud.scan_receipts SET verdict='REJECTED'`);
      await assert.rejects(boundary.commit(i, proof), /SCAN_NOT_CLEAN/);
      assert.deepEqual(await state(), empty);
    },
  );
  await seed();
  await check(
    "policy epoch, revision, expiry and proof failure each fail closed",
    async () => {
      await db.exec("UPDATE sandy_cloud.upload_intents SET policy_epoch=2");
      await assert.rejects(boundary.commit(i, proof), /POLICY_CHANGED/);
      await db.exec("UPDATE sandy_cloud.upload_intents SET policy_epoch=1");
      await db.exec("UPDATE sandy_cloud.file_heads SET revision=1");
      await assert.rejects(boundary.commit(i, proof), /REVISION_CONFLICT/);
      await db.exec("UPDATE sandy_cloud.file_heads SET revision=0");
      await db.exec(
        `UPDATE sandy_cloud.upload_intents SET expires_at=clock_timestamp()-interval '1 second'`,
      );
      await assert.rejects(boundary.commit(i, proof), /INTENT_EXPIRED/);
      await assert.rejects(
        boundary.commit(i, { ...proof, sha256: "0".repeat(64) }),
        /INVALID_BYTE_PROOF/,
      );
      assert.deepEqual(await state(), empty);
    },
  );
  await seed();
  await check(
    "lost commit acknowledgement resolves via durable authorized readback",
    async () => {
      const original = boundary.commit.bind(boundary);
      boundary.commit = async (...args) => {
        loseAck = true;
        await original(...args);
      };
      const outcome = await completeUpload(
        i,
        {
          tenantId: ref.tenantId,
          workspaceId: ref.workspaceId,
          allowedBuckets: new Set([ref.bucket]),
          maxBytes: 100,
          signal: AbortSignal.timeout(30000),
        },
        boundary,
        async () => ({
          ref,
          body: new ReadableStream({
            start(c) {
              c.close();
            },
          }),
        }),
      );
      assert.equal(outcome.state, "COMMITTED");
      assert.equal((await state()).versions, 1);
      boundary.commit = original;
    },
  );
  await seed();
  await check(
    "non-empty upload settles reserved bytes exactly once and preserves versioned usage",
    async () => {
      const bytes = new TextEncoder().encode("synthetic nonempty version");
      const nonemptyRef = {
        ...ref,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      const upload = { ...i, ref: nonemptyRef };
      const verified = {
        state: "BYTES_VERIFIED" as const,
        ref: nonemptyRef,
        bytesRead: bytes.length,
        sha256: nonemptyRef.sha256,
      };
      await db.query("UPDATE sandy_cloud.workspaces SET reserved_bytes=$1", [
        bytes.length,
      ]);
      await db.query(
        "UPDATE sandy_cloud.upload_intents SET reserved_bytes=$1,ref=$2,input_sha256=$3",
        [bytes.length, JSON.stringify(nonemptyRef), intentDigest(upload)],
      );
      await db.query("UPDATE sandy_cloud.scan_receipts SET ref=$1", [
        JSON.stringify(nonemptyRef),
      ]);
      await boundary.commit(upload, verified);
      await boundary.commit(upload, verified);
      const usage = (await db.query(
        "SELECT used_bytes::int,reserved_bytes::int FROM sandy_cloud.workspaces",
      )).rows[0];
      assert.deepEqual(usage, { used_bytes: bytes.length, reserved_bytes: 0 });
      assert.equal(
        (await db.query(
          "SELECT sum(logical_bytes)::int AS total FROM sandy_cloud.usage_events",
        )).rows[0].total,
        bytes.length,
      );
    },
  );
  await seed();
  await check(
    "server reservation mismatch cannot expose or settle bytes",
    async () => {
      const upload = { ...i, ref: { ...ref, size: 1 } };
      const verified = { ...proof, ref: upload.ref, bytesRead: 1 };
      await db.query(
        "UPDATE sandy_cloud.upload_intents SET reserved_bytes=1,ref=$1,input_sha256=$2",
        [JSON.stringify(upload.ref), intentDigest(upload)],
      );
      await db.query("UPDATE sandy_cloud.scan_receipts SET ref=$1", [
        JSON.stringify(upload.ref),
      ]);
      await assert.rejects(boundary.commit(upload, verified), /QUOTA_EXCEEDED/);
      assert.deepEqual(await state(), empty);
    },
  );
  await seed();
  await check(
    "caller mutation after scan cannot replace the verified generation",
    async () => {
      const upload = structuredClone(i), verified = structuredClone(proof);
      const guarded = new PostgresCommitBoundary(connection, owners, {
        verifyInTransaction: async (tx, input) => {
          const evidence = await fixtureScanner.verifyInTransaction(tx, input);
          upload.ref.generation = "unverified-generation";
          upload.traceId = "replaced-trace";
          return evidence;
        },
      });
      await guarded.commit(upload, verified);
      const receipt =
        (await db.query("SELECT receipt FROM sandy_cloud.commit_receipts"))
          .rows[0].receipt;
      assert.equal(receipt.ref.generation, i.ref.generation);
      assert.equal(receipt.traceId, i.traceId);
      const version =
        (await db.query("SELECT ref FROM sandy_cloud.versions")).rows[0].ref;
      assert.deepEqual(version, i.ref);
    },
  );
  await check(
    "all boundary entry points retain original identity across preparation awaits",
    async () => {
      for (
        const method of [
          "authorize",
          "lookup",
          "assertScanClean",
          "commit",
        ] as const
      ) {
        await seed();
        const upload = structuredClone(i), verified = structuredClone(proof);
        const guarded = new PostgresCommitBoundary(connection, {
          ...owners,
          prepareTransaction: async () => {
            upload.actorId = "foreign-actor";
            upload.ref.tenantId = "foreign-tenant";
          },
        }, fixtureScanner);
        if (method === "authorize" || method === "lookup") {
          await guarded[method](upload);
        } else await guarded[method](upload, verified);
        assert.equal(
          (await db.query("SELECT count(*)::int n FROM sandy_cloud.versions"))
            .rows[0].n,
          method === "commit" ? 1 : 0,
        );
      }
    },
  );
  console.log(
    JSON.stringify({
      suite: "cloud-postgresql-transaction",
      passed,
      engine: "PGlite 0.3.14",
      providerExecuted: false,
      liveDatabaseUsed: false,
      limitation:
        "single embedded connection; multi-connection revocation/deadlock tests still required",
    }),
  );
} finally {
  await db.close();
}
