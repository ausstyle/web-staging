import { cloudAdmissionHook } from "../../sandy-api/cloud/admission.ts";
import { canonicalCloudAuthority } from "./authority.ts";
import { canonicalFileProjection } from "./projection.ts";
import { integrateRuntimeCustody } from "./runtime_integration.ts";
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
import { cloudScanBindingDigest, type ScanBinding } from "./shared_scan.ts";
const pg = (await import(pathToFileURL(process.argv[2]).href)).default;
const runtime = process.argv[3], port = Number(process.argv[4]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw Error("LOCAL_FIXTURE_PORT_REQUIRED");
}
const { ArtifactJournal } = await import(
  pathToFileURL(runtime + "/journal.ts").href
);
const { lockCustodyPlan, lockCustodyResources, scopedResourceId } =
  await import(pathToFileURL(runtime + "/locking.ts").href);
const { canonicalCloudReferences, recordCloudReference } = await import(
  pathToFileURL(runtime + "/cloud_reference.ts").href
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
  admission = {
    customerId,
    policyEpoch: 1,
    admissionId: id(8),
    expiresAt: expiry,
  };
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
const context = {
  actorId: intent.actorId,
  apiTenantId: intent.ref.tenantId,
  admissionId: binding.admissionId,
  sessionId: id(10),
  companyId: id(11),
  deviceId: id(12),
};
const plan = {
  actorId: intent.actorId,
  customerId,
  tenantId: intent.ref.tenantId,
  admissionId: binding.admissionId,
  fileId,
  artifactId: binding.artifactId,
  receiptId,
  scanner: { issuer: "fixture", release: "ephemeral" },
  sessionId: context.sessionId,
  companyId: context.companyId,
  cloud: {
    workspaceId: intent.ref.workspaceId,
    intentId: intent.id,
    writerAssignmentId: "fixture-writer-assignment",
  },
};
const codec = {
  operation: binding.operation,
  contractSha256: binding.contractSha256,
  digest: cloudScanBindingDigest,
};
const active = new Set<SqlTransaction>();
const pids = new Set<number>();
const connection: SqlDatabase = {
  transaction: async (fn) => {
    const client = await pool.connect();
    const ignoreError = () => {};
    client.on("error", ignoreError);
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
      client.removeListener("error", ignoreError);
      client.release();
    }
  },
};
async function resolve(tx: SqlTransaction) {
  assert(active.has(tx), "must use active pinned transaction");
  await lockCustodyPlan(tx, plan);
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
const discoverWriter = async (tx: SqlTransaction) =>
  String(
    (await tx.query("SELECT assignment FROM fixture_writer WHERE file_id=$1", [
      fileId,
    ])).rows[0]?.assignment ?? "",
  );
const deadlines = {
  admission: expiry,
  session: expiry,
  tenantCustomer: expiry,
  device: expiry,
  company: expiry,
  writer: expiry,
};
const canonicalAdmission = cloudAdmissionHook(
  context,
  canonicalCloudAuthority({
    lock: async (tx) => {
      await resolve(tx);
      const grant = (kind: keyof typeof deadlines) => ({
        rowId: "fixture-" + kind,
        revoked: false,
        expiresAt: deadlines[kind],
      });
      return {
        admission: {
          ...context,
          ...grant("admission"),
          workspaceId: intent.ref.workspaceId,
          uploadAllowed: true,
          policyEpoch: 1,
        },
        session: {
          ...grant("session"),
          sessionId: context.sessionId,
          actorId: context.actorId,
        },
        tenantCustomer: {
          ...grant("tenantCustomer"),
          apiTenantId: context.apiTenantId,
          customerId,
        },
        device: {
          ...grant("device"),
          deviceId: context.deviceId,
          actorId: context.actorId,
          workspaceId: intent.ref.workspaceId,
          allowed: true,
        },
        company: {
          ...grant("company"),
          companyId: context.companyId,
          actorId: context.actorId,
          customerId,
          workspaceId: intent.ref.workspaceId,
          allowed: true,
        },
      };
    },
  }),
);
const canonicalProjection = canonicalFileProjection({
  lock: async (tx) => {
    const row = (await tx.query(
      "SELECT assignment FROM fixture_writer WHERE file_id=$1 FOR SHARE",
      [fileId],
    )).rows[0];
    return row
      ? {
        assignmentId: String(row.assignment),
        writer: "sandy-cloud",
        fileId,
        customerId,
        tenantId: context.apiTenantId,
        workspaceId: intent.ref.workspaceId,
        revision: 0,
        revoked: false,
        expiresAt: deadlines.writer,
      }
      : null;
  },
});
const composition = integrateRuntimeCustody({
  context,
  runtime: { lockCustodyPlan, canonicalCloudReferences, journal },
  writer: { discover: discoverWriter },
  contract: { operation: binding.operation, sha256: binding.contractSha256 },
  lockAdmission: canonicalAdmission,
  projectVersion: canonicalProjection,
});
const scanner = composition.scanner;
function boundary(
  onProjection: (tx: SqlTransaction) => Promise<void> = async () => {},
  database: SqlDatabase = connection,
  afterProjection: (tx: SqlTransaction) => Promise<void> = async () => {},
) {
  return new PostgresCommitBoundary(database, {
    ...composition.owners,
    projectVersion: async (tx, input) => {
      await onProjection(tx);
      const result = await canonicalProjection(tx, input);
      await afterProjection(tx);
      return result;
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
 (SELECT count(*)::int FROM sandy_cloud.projection_events) projections,
 (SELECT count(*)::int FROM sandy_cloud.versions) versions,
 (SELECT count(*)::int FROM sandy_cloud.version_scans) scans,
 (SELECT count(*)::int FROM sandy_cloud.commit_receipts) receipts,
 (SELECT count(*)::int FROM sandy_cloud.usage_events) usage,
 (SELECT count(*)::int FROM sandy_cloud.outbox) outbox,
 (SELECT count(*)::int FROM sandy_artifact_custody.claims) claims`)).rows[0];
}
const zero = {
    projections: 0,
    versions: 0,
    scans: 0,
    receipts: 0,
    usage: 0,
    outbox: 0,
    claims: 0,
  },
  one = {
    projections: 1,
    versions: 1,
    scans: 1,
    receipts: 1,
    usage: 1,
    outbox: 1,
    claims: 0,
  };
async function seed() {
  for (const key of Object.keys(deadlines) as (keyof typeof deadlines)[]) {
    deadlines[key] = expiry;
  }
  await db.query("UPDATE sandy_api_execution_admissions SET expires_at=$1", [
    new Date(expiry),
  ]);
  // Fixture resets only; runner accepts no remote host/URL/database argument.
  await db.exec(
    "TRUNCATE sandy_cloud.workspaces CASCADE; UPDATE sandy_universal_files SET sha256=NULL; UPDATE fixture_authority SET enabled=true,revision=1; UPDATE fixture_writer SET assignment='fixture-writer-assignment'",
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
  await connection.transaction(async (tx) => {
    await lockCustodyPlan(tx, plan);
    await recordCloudReference(
      tx,
      { intent, fileId, receiptId, binding },
      journal,
      codec,
    );
  });
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
    `CREATE TABLE sandy_universal_files(id uuid PRIMARY KEY,owner_customer_id uuid NOT NULL,sha256 text,byte_size bigint,storage_bucket text,storage_path text,provider text,provider_file_id text,metadata jsonb NOT NULL DEFAULT '{}',updated_at timestamptz);
 CREATE TABLE sandy_memory_portal_accounts(auth_user_id uuid PRIMARY KEY,customer_id uuid,revoked_at timestamptz);
 CREATE TABLE sandy_api_execution_admissions(id uuid PRIMARY KEY,actor_id uuid,tenant_id uuid,operation text,input_sha256 text,contract_sha256 text,
 scope_sha256 text,state text,expires_at timestamptz);
 CREATE TABLE fixture_authority(actor uuid PRIMARY KEY,enabled boolean,revision integer);
 CREATE TABLE fixture_writer(file_id uuid PRIMARY KEY,assignment text NOT NULL);
 CREATE ROLE fixture_reader; CREATE ROLE fixture_table_owner;
 ALTER DEFAULT PRIVILEGES GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO fixture_reader;`,
  );
  await db.query(
    "INSERT INTO sandy_memory_portal_accounts VALUES($1,$2,NULL)",
    [context.actorId, customerId],
  );
  await db.query("INSERT INTO fixture_writer VALUES($1,$2)", [
    fileId,
    plan.cloud.writerAssignmentId,
  ]);
  await db.query("INSERT INTO fixture_authority VALUES($1,true,1)", [
    intent.actorId,
  ]);
  await db.query(
    "INSERT INTO sandy_universal_files(id,owner_customer_id,sha256) VALUES($1,$2,NULL)",
    [
      fileId,
      customerId,
    ],
  );
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
  await db.exec(
    await readFile(runtime + "/cloud_reference_schema.sql", "utf8"),
  );
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
        await lockCustodyResources(tx, [{
          kind: "session",
          id: context.sessionId,
        }]);
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
        await lockCustodyResources(tx, [{
          kind: "actor",
          id: context.actorId,
        }]);
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
        ...composition.owners,
        lockAdmission: async (tx) => {
          await resolve(tx);
          return admission;
        },
        projectVersion: async () => ({ expiresAt: expiry }),
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
    "writer reassignment between discovery and complete locks aborts before projection",
    async () => {
      const discovered = gate(), resume = gate();
      let reads = 0, projected = false;
      const assembly = integrateRuntimeCustody({
        context,
        runtime: { lockCustodyPlan, canonicalCloudReferences, journal },
        writer: {
          discover: async (tx) => {
            const found = await discoverWriter(tx);
            if (++reads === 1) {
              discovered.open();
              await resume.promise;
            }
            return found;
          },
        },
        contract: {
          operation: binding.operation,
          sha256: binding.contractSha256,
        },
        lockAdmission: composition.owners.lockAdmission,
        projectVersion: async () => {
          projected = true;
          return { expiresAt: expiry };
        },
      });
      const pending = new PostgresCommitBoundary(
        connection,
        assembly.owners,
        assembly.scanner,
      ).commit(intent, proof);
      const refused = assert.rejects(pending, /CLOUD_COMPLETE_PLAN_REFUSED/);
      await discovered.promise;
      try {
        await connection.transaction(async (tx) => {
          await lockCustodyResources(tx, [
            { kind: "writer", id: plan.cloud.writerAssignmentId },
            { kind: "writer", id: "replacement-writer" },
            { kind: "file", id: fileId },
          ]);
          await tx.query(
            "UPDATE fixture_writer SET assignment='replacement-writer' WHERE file_id=$1",
            [fileId],
          );
        });
      } finally {
        resume.open();
      }
      await refused;
      assert.equal(projected, false);
      assert.deepEqual(await counts(), zero);
    },
  );
  await check(
    "writer expires while canonical projection waits for a real file row lock",
    async () => {
      deadlines.writer = Date.now() + 500;
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
      const pending = boundary(async (tx) => {
        writerPid = Number(
          (await tx.query("SELECT pg_backend_pid() pid")).rows[0].pid,
        );
        entered.open();
      }).commit(intent, proof);
      const refused = assert.rejects(pending, /COMMIT_DEADLINE_EXPIRED/);
      await entered.promise;
      try {
        await blocked(writerPid, readerPid);
        await reader.query("SELECT pg_sleep(0.6)");
      } finally {
        await reader.query("ROLLBACK");
        reader.release();
      }
      await refused;
      assert.deepEqual(await counts(), zero);
      assert.equal(
        (await db.query("SELECT sha256 FROM sandy_universal_files")).rows[0]
          .sha256,
        null,
      );
    },
  );
  await check(
    "receipt replay rechecks database-clock authority after awaited receipt lookup",
    async () => {
      await boundary().commit(intent, proof);
      deadlines.session = Date.now() + 500;
      const delayed: SqlDatabase = {
        transaction: (fn) =>
          connection.transaction(async (tx) => {
            const original = tx.query.bind(tx);
            tx.query = async (sql, args) => {
              const result = await original(sql, args);
              if (sql.includes("FROM sandy_cloud.commit_receipts")) {
                await original("SELECT pg_sleep(0.6)");
              }
              return result;
            };
            try {
              return await fn(tx);
            } finally {
              tx.query = original;
            }
          }),
      };
      await assert.rejects(
        boundary(undefined, delayed).commit(intent, proof),
        /AUTHORITY_EXPIRED/,
      );
      assert.deepEqual(await counts(), one);
    },
  );
  for (
    const kind of [
      "admission",
      "session",
      "tenantCustomer",
      "device",
      "company",
      "writer",
      "apiAdmission",
    ] as const
  ) {
    await check(
      `real canonical ${kind} expiry during delayed projection rolls back all effects`,
      async () => {
        const deadline = Date.now() + 500;
        if (kind === "apiAdmission") {
          await db.query(
            "UPDATE sandy_api_execution_admissions SET expires_at=$1",
            [new Date(deadline)],
          );
        } else deadlines[kind] = deadline;
        let projected = false;
        await assert.rejects(
          boundary(undefined, connection, async (tx) => {
            projected = true;
            await tx.query(
              "SELECT pg_sleep(GREATEST(0,($1-extract(epoch from clock_timestamp())*1000)/1000)+0.05)",
              [deadline],
            );
          }).commit(intent, proof),
          /COMMIT_DEADLINE_EXPIRED/,
        );
        assert.equal(projected, true);
        assert.deepEqual(await counts(), zero);
        assert.equal(
          (await db.query("SELECT sha256 FROM sandy_universal_files")).rows[0]
            .sha256,
          null,
        );
        assert.deepEqual(
          (await db.query(
            "SELECT used_bytes::int used,reserved_bytes::int reserved FROM sandy_cloud.workspaces",
          )).rows[0],
          { used: 0, reserved: 3 },
        );
      },
    );
  }
  await check(
    "missing and invalid authority/writer deadlines fail closed",
    async () => {
      for (const expiresAt of [undefined, NaN, Infinity, 0, -1, 1.5]) {
        const bad = new PostgresCommitBoundary(connection, {
          ...composition.owners,
          lockAdmission: async (tx, i) => ({
            ...await canonicalAdmission(tx, i),
            expiresAt: expiresAt as number,
          }),
        }, scanner);
        await assert.rejects(bad.commit(intent, proof));
        assert.deepEqual(await counts(), zero);
        const writer = new PostgresCommitBoundary(connection, {
          ...composition.owners,
          projectVersion: async (tx, input) => {
            await canonicalProjection(tx, input);
            return { expiresAt: expiresAt as number };
          },
        }, scanner);
        await assert.rejects(
          writer.commit(intent, proof),
          /WRITER_DEADLINE_REQUIRED/,
        );
        assert.deepEqual(await counts(), zero);
      }
    },
  );
  for (const method of ["authorize", "lookup", "assertScanClean"] as const) {
    await check(
      `authority expiry during ${method} refuses completion`,
      async () => {
        deadlines.session = Date.now() + 500;
        // Keep Runtime's transaction-object identity stable: wrap only stored-row SQL
        // on the actual pinned client, then restore it at callback completion.
        const pinnedDelay: SqlDatabase = {
          transaction: (fn) =>
            connection.transaction(async (tx) => {
              const original = tx.query.bind(tx);
              tx.query = async (sql, args) => {
                const result = await original(sql, args);
                if (
                  sql.includes("FROM sandy_cloud.upload_intents") &&
                  sql.includes("FOR UPDATE")
                ) await original("SELECT pg_sleep(0.6)");
                return result;
              };
              try {
                return await fn(tx);
              } finally {
                tx.query = original;
              }
            }),
        };
        const b = boundary(undefined, pinnedDelay);
        await assert.rejects(
          method === "assertScanClean"
            ? b[method](intent, proof)
            : b[method](intent),
          /AUTHORITY_EXPIRED|SHARED_SCAN_BINDING_REFUSED/,
        );
        assert.deepEqual(await counts(), zero);
      },
    );
  }
  await check(
    "scanner withdrawal waits on the complete gate and refuses subsequent scan validation",
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
        await lockCustodyResources(tx, [{
          kind: "scanner",
          id: scopedResourceId("fixture", "ephemeral"),
        }]);
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
      await assert.rejects(
        boundary().assertScanClean(intent, proof),
        /SCANNER_RELEASE_UNTRUSTED/,
      );
      assert.deepEqual(await counts(), one);
    },
  );
  console.log(
    JSON.stringify({
      suite: "cloud-real-postgresql-multisession",
      passed,
      distinctBackendPids: pids.size,
      postgres: (await db.query("SHOW server_version")).rows[0].server_version,
      runtimeCommit: "cd6f6cf659e924bd0c9090445a7794ae122746ab",
      localSyntheticOnly: true,
      productionRelationVerified: false,
      productionTrustActivated: false,
      providerAcceptance: false,
    }),
  );
} finally {
  await pool.end();
}
