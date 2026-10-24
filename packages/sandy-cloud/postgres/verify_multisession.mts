/** Real PostgreSQL sessions. LOCAL SYNTHETIC DATABASE ONLY; no production target. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  intentDigest,
  PostgresCommitBoundary,
  type SqlDatabase,
  type SqlTransaction,
} from "./commit.ts";
import {
  cloudScanBindingDigest,
  type ScanBinding,
  sharedScanOwner,
} from "./shared_scan.ts";
const pg = (await import(pathToFileURL(process.argv[2]).href)).default;
const runtime = process.argv[3], port = Number(process.argv[4]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw Error("LOCAL_FIXTURE_PORT_REQUIRED");
}
const { ArtifactJournal, lockCanonicalScope } = await import(
  pathToFileURL(runtime + "/journal.ts").href
);
const { scanBytes } = await import(
  pathToFileURL(runtime + "/attestation.ts").href
);
const pool = new pg.Pool({
  host: "127.0.0.1",
  port,
  user: "postgres",
  database: "sandy_cloud_fixture",
  max: 8,
  application_name: "sandy-cloud-concurrency-fixture",
  connectionTimeoutMillis: 5000,
});
const db = {
  exec: async (sql: string) => await pool.query(sql),
  query: async (sql: string, args: unknown[] = []) =>
    await pool.query(sql, args),
};
const id = (n: number) =>
  `${String(n).padStart(8, "0")}-0000-4000-8000-000000000001`;
const data = new TextEncoder().encode("abc"), expiry = Date.now() + 300000;
const intent = {
  id: id(1),
  actorId: id(2),
  traceId: "trace",
  expectedRevision: 0,
  idempotencyKey: "fixture-key",
  expiresAt: expiry,
  ref: {
    tenantId: id(3),
    workspaceId: id(4),
    bucket: "synthetic-bucket",
    key: "private/object",
    generation: "101",
    size: 3,
    sha256: createHash("sha256").update(data).digest("hex"),
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
const lockScope = {
  actorId: intent.actorId,
  admissionId: binding.admissionId,
  tenantId: intent.ref.tenantId,
  customerId,
};
const active = new Set<SqlTransaction>();
const pids = new Set<number>();
const connection: SqlDatabase = {
  transaction: async (fn) => {
    const client = await pool.connect();
    client.on("error", () => {});
    let began = false;
    try {
      await client.query("BEGIN");
      began = true;
      await client.query(
        "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'",
      );
      pids.add((await client.query("SELECT pg_backend_pid() pid")).rows[0].pid);
      active.add(client);
      const result = await fn(client);
      await client.query("COMMIT");
      began = false;
      return result;
    } catch (e) {
      if (began) await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      active.delete(client);
      client.release();
    }
  },
};
async function resolve(tx: SqlTransaction) {
  assert(active.has(tx), "must use active pinned transaction");
  await lockCanonicalScope(tx, lockScope);
  const { rows } = await tx.query(
    "SELECT enabled,revision FROM fixture_authority WHERE actor=$1 FOR SHARE",
    [intent.actorId],
  );
  if (rows[0]?.enabled !== true) throw Error("FIXTURE_AUTHORITY_REVOKED");
  return {
    customerId,
    tenantId: intent.ref.tenantId,
    revision: String(rows[0].revision),
  };
}
const journal = new ArtifactJournal(connection, { lockAndResolve: resolve });
const scanner = sharedScanOwner(journal, {
  lock: async (tx) => {
    assert(active.has(tx));
    return { receiptId, binding };
  },
}, { operation: binding.operation, sha256: binding.contractSha256 });
function boundary(
  onProjection: (tx: SqlTransaction) => Promise<void> = async () => {},
  database: SqlDatabase = connection,
) {
  return new PostgresCommitBoundary(database, {
    lockAdmission: async (tx) => {
      await resolve(tx);
      return admission;
    },
    projectVersion: async (tx, { receipt }) => {
      await onProjection(tx);
      await tx.query("UPDATE sandy_universal_files SET sha256=$1 WHERE id=$2", [
        receipt.ref.sha256,
        fileId,
      ]);
    },
  }, scanner);
}
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => open = r);
  return { promise, open };
}
async function blocked(pid: number, blocker: number) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    const r =
      (await db.query("SELECT pg_blocking_pids($1) blockers", [pid])).rows[0]
        .blockers;
    if (r.includes(blocker)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error(`expected PostgreSQL lock wait: ${pid} blocked by ${blocker}`);
}
async function counts() {
  return (await db.query(`SELECT
 (SELECT count(*)::int FROM sandy_cloud.versions) versions,
 (SELECT count(*)::int FROM sandy_cloud.version_scans) scans,
 (SELECT count(*)::int FROM sandy_cloud.commit_receipts) receipts,
 (SELECT count(*)::int FROM sandy_cloud.usage_events) usage,
 (SELECT count(*)::int FROM sandy_cloud.outbox) outbox,
 (SELECT count(*)::int FROM sandy_artifact_custody.claims) claims`)).rows[0];
}
const zero = {
    versions: 0,
    scans: 0,
    receipts: 0,
    usage: 0,
    outbox: 0,
    claims: 0,
  },
  one = { versions: 1, scans: 1, receipts: 1, usage: 1, outbox: 1, claims: 0 };
async function seed() {
  // Fixture resets only; runner accepts no remote host/URL/database argument.
  await db.exec(
    "TRUNCATE sandy_cloud.workspaces CASCADE; UPDATE sandy_universal_files SET sha256=NULL; UPDATE fixture_authority SET enabled=true,revision=1",
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
      new Date(expiry),
    ],
  );
}
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await seed();
  await fn();
  passed++;
  console.log("PASS " + name);
}
try {
  assert.equal(
    (await db.query("SELECT current_database() name")).rows[0].name,
    "sandy_cloud_fixture",
  );
  // Refuse to reset any pre-existing database, including a previous test run.
  assert.equal(
    (await db.query("SELECT to_regclass('public.sandy_universal_files') name"))
      .rows[0].name,
    null,
    "fresh fixture database required",
  );
  await db.exec(
    `CREATE TABLE sandy_universal_files(id uuid PRIMARY KEY,owner_customer_id uuid NOT NULL,sha256 text);
 CREATE TABLE sandy_api_execution_admissions(id uuid PRIMARY KEY,actor_id uuid,tenant_id uuid,operation text,input_sha256 text,contract_sha256 text,
 scope_sha256 text,state text,expires_at timestamptz);
 CREATE TABLE fixture_authority(actor uuid PRIMARY KEY,enabled boolean,revision integer);
 CREATE ROLE fixture_reader; CREATE ROLE fixture_table_owner;
 ALTER DEFAULT PRIVILEGES GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO fixture_reader;`,
  );
  await db.query("INSERT INTO fixture_authority VALUES($1,true,1)", [
    intent.actorId,
  ]);
  await db.query("INSERT INTO sandy_universal_files VALUES($1,$2,NULL)", [
    fileId,
    customerId,
  ]);
  await db.query(
    "INSERT INTO sandy_api_execution_admissions VALUES($1,$2,$3,$4,$5,$6,$7,'consumed',$8)",
    [
      binding.admissionId,
      binding.actorId,
      intent.ref.tenantId,
      binding.operation,
      binding.inputSha256,
      binding.contractSha256,
      binding.scopeSha256,
      new Date(expiry),
    ],
  );
  await db.exec(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    await readFile(new URL("./projection.sql", import.meta.url), "utf8"),
  );
  await db.exec(await readFile(runtime + "/schema.sql", "utf8"));
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const publicHex = Buffer.from(
    await crypto.subtle.exportKey("raw", keys.publicKey),
  ).toString("hex");
  await db.query(
    "INSERT INTO sandy_artifact_custody.scanner_releases VALUES('fixture','ephemeral',$1,1,NULL)",
    [publicHex],
  );
  const attestation = {
    version: 1,
    receiptId,
    artifactId: binding.artifactId,
    fileId,
    admissionId: binding.admissionId,
    actorId: binding.actorId,
    customerId,
    generation: "101",
    size: 3,
    sha256: intent.ref.sha256,
    bindingSha256: binding.bindingSha256,
    issuer: "fixture",
    release: "ephemeral",
    trustRevision: 1,
    verdict: "CLEAN",
    issuedAt: Date.now() - 1000,
    expiresAt: expiry,
  };
  await journal.recordScan(
    binding,
    attestation,
    Buffer.from(
      await crypto.subtle.sign(
        "Ed25519",
        keys.privateKey,
        scanBytes(attestation),
      ),
    ).toString("hex"),
  );
  await check(
    "concurrent duplicate commits serialize on real PostgreSQL locks and settle exactly once",
    async () => {
      const entered = gate(), release = gate();
      let firstPid = 0, secondPid = 0;
      const a = boundary(async (tx) => {
        firstPid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid as number;
        entered.open();
        await release.promise;
      }).commit(intent, proof);
      await entered.promise;
      const secondConnection: SqlDatabase = {
        transaction: (fn) =>
          connection.transaction(async (tx) => {
            secondPid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
              .pid as number;
            return await fn(tx);
          }),
      };
      const b = boundary(undefined, secondConnection).commit(intent, proof);
      while (!secondPid) await new Promise((r) => setTimeout(r, 5));
      try {
        assert.notEqual(firstPid, secondPid);
        await blocked(secondPid, firstPid);
      } finally {
        release.open();
      }
      await Promise.all([a, b]);
      assert.deepEqual(await counts(), one);
    },
  );
  await check(
    "waiting duplicate succeeds after first transaction rolls back",
    async () => {
      const entered = gate(), release = gate();
      let firstPid = 0, secondPid = 0;
      const a = boundary(async (tx) => {
        firstPid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid as number;
        await tx.query("UPDATE sandy_universal_files SET sha256=$1", [
          intent.ref.sha256,
        ]);
        entered.open();
        await release.promise;
        throw Error("ROLLBACK_FIXTURE");
      }).commit(intent, proof);
      const failed = assert.rejects(a, /ROLLBACK_FIXTURE/);
      await entered.promise;
      const secondConnection: SqlDatabase = {
        transaction: (fn) =>
          connection.transaction(async (tx) => {
            secondPid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
              .pid as number;
            return await fn(tx);
          }),
      };
      const b = boundary(undefined, secondConnection).commit(intent, proof);
      while (!secondPid) await new Promise((r) => setTimeout(r, 5));
      try {
        await blocked(secondPid, firstPid);
      } finally {
        release.open();
      }
      await Promise.all([failed, b]);
      assert.deepEqual(await counts(), one);
    },
  );
  await check(
    "revocation queued after scan linearizes after commit and blocks receipt replay",
    async () => {
      const entered = gate(), release = gate();
      let firstPid = 0, revokerPid = 0;
      const a = boundary(async (tx) => {
        firstPid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid as number;
        entered.open();
        await release.promise;
      }).commit(intent, proof);
      await entered.promise;
      const revoke = connection.transaction(async (tx) => {
        revokerPid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid as number;
        await lockCanonicalScope(tx, lockScope);
        await tx.query(
          "UPDATE fixture_authority SET enabled=false,revision=revision+1",
        );
      });
      while (!revokerPid) await new Promise((r) => setTimeout(r, 5));
      try {
        await blocked(revokerPid, firstPid);
      } finally {
        release.open();
      }
      await Promise.all([a, revoke]);
      assert.deepEqual(await counts(), one);
      await assert.rejects(
        boundary().lookup(intent),
        /FIXTURE_AUTHORITY_REVOKED/,
      );
    },
  );
  await check(
    "revocation holding canonical lock first prevents a waiting commit",
    async () => {
      const entered = gate(), release = gate();
      let revokePid = 0, commitPid = 0;
      const revoke = connection.transaction(async (tx) => {
        revokePid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid as number;
        await lockCanonicalScope(tx, lockScope);
        await tx.query(
          "UPDATE fixture_authority SET enabled=false,revision=revision+1",
        );
        entered.open();
        await release.promise;
      });
      await entered.promise;
      const original = connection.transaction;
      const captured: SqlDatabase = {
        transaction: (fn) =>
          original(async (tx) => {
            commitPid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
              .pid as number;
            return await fn(tx);
          }),
      };
      const pending = new PostgresCommitBoundary(captured, {
        lockAdmission: async (tx) => {
          await resolve(tx);
          return admission;
        },
        projectVersion: async () => {},
      }, scanner).commit(intent, proof);
      const refused = assert.rejects(pending, /FIXTURE_AUTHORITY_REVOKED/);
      while (!commitPid) await new Promise((r) => setTimeout(r, 5));
      try {
        await blocked(commitPid, revokePid);
      } finally {
        release.open();
      }
      await revoke;
      await refused;
      assert.deepEqual(await counts(), zero);
    },
  );
  await check(
    "file SHARE to UPDATE waits for a separate reader and completes after reader rollback",
    async () => {
      const reader = await pool.connect();
      await reader.query("BEGIN");
      const readerPid =
        (await reader.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      await reader.query(
        "SELECT id FROM sandy_universal_files WHERE id=$1 FOR SHARE",
        [fileId],
      );
      let writerPid = 0;
      const entered = gate();
      const writer = boundary(async (tx) => {
        writerPid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid as number;
        entered.open();
      }).commit(intent, proof);
      await entered.promise;
      try {
        await blocked(writerPid, readerPid);
      } finally {
        await reader.query("ROLLBACK");
        reader.release();
      }
      await writer;
      assert.deepEqual(await counts(), one);
    },
  );
  await check(
    "backend death before commit rolls back all effects and releases canonical locks",
    async () => {
      const entered = gate(), release = gate();
      let killedPid = 0;
      const dying = boundary(async (tx) => {
        await tx.query("UPDATE sandy_universal_files SET sha256=$1", [
          intent.ref.sha256,
        ]);
        killedPid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid as number;
        entered.open();
        await release.promise;
      }).commit(intent, proof);
      const died = assert.rejects(dying);
      await entered.promise;
      const terminated = await db.query(
        "SELECT pg_terminate_backend(pid) stopped FROM pg_stat_activity WHERE pid=$1 AND datname='sandy_cloud_fixture' AND application_name='sandy-cloud-concurrency-fixture'",
        [killedPid],
      );
      assert.equal(terminated.rows[0].stopped, true);
      release.open();
      await died;
      assert.deepEqual(await counts(), zero);
      assert.equal(
        (await db.query("SELECT sha256 FROM sandy_universal_files")).rows[0]
          .sha256,
        null,
      );
      await boundary().commit(intent, proof);
      assert.deepEqual(await counts(), one);
    },
  );
  await check(
    "RLS denies accidental grants and FORCE RLS applies to a non-bypass table owner",
    async () => {
      await db.exec(
        "GRANT USAGE ON SCHEMA sandy_cloud TO fixture_reader,fixture_table_owner; GRANT CREATE ON SCHEMA sandy_cloud TO fixture_table_owner;",
      );
      const client = await pool.connect();
      try {
        await client.query("SET ROLE fixture_reader");
        assert.equal(
          (await client.query("SELECT * FROM sandy_cloud.workspaces")).rows
            .length,
          0,
        );
        await assert.rejects(
          client.query(
            "INSERT INTO sandy_cloud.workspaces VALUES($1,$2,$3,10,0,0,1)",
            [id(30), id(31), customerId],
          ),
          /row-level security/,
        );
        await assert.rejects(
          client.query("SELECT sandy_cloud.reject_mutation()"),
          /permission denied/,
        );
        await client.query("RESET ROLE");
        await db.exec(
          "ALTER TABLE sandy_cloud.workspaces OWNER TO fixture_table_owner",
        );
        await client.query("SET ROLE fixture_table_owner");
        assert.equal(
          (await client.query("SELECT * FROM sandy_cloud.workspaces")).rows
            .length,
          0,
        );
      } finally {
        await client.query("RESET ROLE");
        client.release();
      }
      const rls = (await db.query(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='sandy_cloud' AND relkind='r'",
      )).rows;
      assert(rls.length >= 8);
      assert(
        rls.every((r: Record<string, unknown>) =>
          r.relrowsecurity && r.relforcerowsecurity
        ),
      );
    },
  );
  await check(
    "scanner withdrawal waits on shared receipt validation and refuses the next commit",
    async () => {
      const entered = gate(), release = gate();
      let writerPid = 0, scannerPid = 0;
      const a = boundary(async (tx) => {
        writerPid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid as number;
        entered.open();
        await release.promise;
      }).commit(intent, proof);
      await entered.promise;
      const withdrawal = connection.transaction(async (tx) => {
        scannerPid = (await tx.query("SELECT pg_backend_pid() pid")).rows[0]
          .pid as number;
        await tx.query(
          "UPDATE sandy_artifact_custody.scanner_releases SET revoked_at=clock_timestamp()",
        );
      });
      while (!scannerPid) await new Promise((r) => setTimeout(r, 5));
      try {
        await blocked(scannerPid, writerPid);
      } finally {
        release.open();
      }
      await Promise.all([a, withdrawal]);
      assert.deepEqual(await counts(), one);
      await seed();
      await assert.rejects(
        boundary().commit(intent, proof),
        /SCANNER_RELEASE_UNTRUSTED/,
      );
      assert.deepEqual(await counts(), zero);
    },
  );
  console.log(
    JSON.stringify({
      suite: "cloud-real-postgresql-multisession",
      passed,
      distinctBackendPids: pids.size,
      postgres: (await db.query("SHOW server_version")).rows[0].server_version,
      runtimeCommit: "ab2cfa4fb29fc5ba72a72fb77c0665fd1181ae55",
      localSyntheticOnly: true,
      productionRelationVerified: false,
      productionTrustActivated: false,
      providerAcceptance: false,
    }),
  );
} finally {
  await pool.end();
}
