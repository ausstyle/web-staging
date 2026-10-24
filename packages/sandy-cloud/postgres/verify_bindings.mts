import { fixtureScanner, fixtureScanSchema } from "./fixture_scan.mts";
// Isolated PostgreSQL fixtures; actual API admission hook + Cloud commit adapter.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { cloudAdmissionHook } from "../../sandy-api/cloud/admission.ts";
import {
  canonicalCloudAuthority,
  type LockedRuntimeFacts,
} from "./authority.ts";
import {
  canonicalFileProjection,
  type LockedFileWriter,
} from "./projection.ts";
import {
  intentDigest,
  PostgresCommitBoundary,
  type SqlDatabase,
  type SqlTransaction,
} from "./commit.ts";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const actor = "10000000-0000-4000-8000-000000000001",
  customer = "20000000-0000-4000-8000-000000000001",
  file = "30000000-0000-4000-8000-000000000001";
const context = {
  actorId: actor,
  apiTenantId: "distinct-api-tenant",
  sessionId: "session",
  deviceId: "device",
  companyId: "company",
  admissionId: "60000000-0000-4000-8000-000000000001",
};
const expiration = Date.now() + 3600000;
const grant = { rowId: "synthetic-row", revoked: false, expiresAt: expiration };
const originalFacts: LockedRuntimeFacts = {
  admission: {
    ...grant,
    ...context,
    workspaceId: "workspace",
    uploadAllowed: true,
    policyEpoch: 1,
  },
  session: { ...grant, sessionId: context.sessionId, actorId: actor },
  tenantCustomer: {
    ...grant,
    apiTenantId: context.apiTenantId,
    customerId: customer,
  },
  device: {
    ...grant,
    deviceId: "device",
    actorId: actor,
    workspaceId: "workspace",
    allowed: true,
  },
  company: {
    ...grant,
    companyId: "company",
    customerId: customer,
    workspaceId: "workspace",
    actorId: actor,
    allowed: true,
  },
};
let facts: LockedRuntimeFacts | null = structuredClone(originalFacts);
let writer: LockedFileWriter | null = {
  assignmentId: "fixture-only-assignment",
  writer: "sandy-cloud",
  fileId: file,
  customerId: customer,
  tenantId: context.apiTenantId,
  workspaceId: "workspace",
  revision: 0,
  revoked: false,
  expiresAt: expiration,
};
const ref = {
  tenantId: context.apiTenantId,
  workspaceId: "workspace",
  bucket: "synthetic-bucket",
  key: "private/file",
  generation: "101",
  size: 0,
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};
const intent = {
  id: "upload",
  actorId: actor,
  traceId: "trace",
  expectedRevision: 0,
  idempotencyKey: "unique-key",
  expiresAt: expiration,
  ref,
};
const proof = {
  state: "BYTES_VERIFIED" as const,
  ref,
  bytesRead: 0,
  sha256: ref.sha256,
};
let pinned: SqlTransaction | undefined;
const connection: SqlDatabase = {
  transaction: async (fn) =>
    await db.transaction(async (tx: SqlTransaction) => {
      pinned = tx;
      try {
        return await fn(tx);
      } finally {
        pinned = undefined;
      }
    }),
};
const admission = cloudAdmissionHook(
  context,
  canonicalCloudAuthority({
    lock: async (tx) => {
      assert.equal(tx, pinned);
      return facts;
    },
  }),
);
const projection = canonicalFileProjection({
  lock: async (tx) => {
    assert.equal(tx, pinned);
    return writer;
  },
});
const boundary = new PostgresCommitBoundary(connection, {
  prepareTransaction: async () => {},
  lockAdmission: admission,
  projectVersion: projection,
}, fixtureScanner);
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
try {
  await db.exec(
    "CREATE TABLE public.sandy_api_execution_admissions(id uuid,actor_id text,tenant_id text,state text,expires_at timestamptz)",
  );
  await db.query(
    "INSERT INTO public.sandy_api_execution_admissions VALUES($1,$2,$3,'consumed',$4)",
    [context.admissionId, actor, context.apiTenantId, new Date(expiration)],
  );
  await db.exec(
    `CREATE TABLE public.sandy_memory_portal_accounts(auth_user_id uuid PRIMARY KEY,customer_id uuid NOT NULL,revoked_at timestamptz);
 CREATE TABLE public.sandy_universal_files(id uuid PRIMARY KEY,owner_customer_id uuid NOT NULL,sha256 text,byte_size bigint,
 storage_bucket text,storage_path text,provider text,provider_file_id text,metadata jsonb NOT NULL,updated_at timestamptz,
 display_name text,description text,library_state text);`,
  );
  await db.query(
    "INSERT INTO sandy_memory_portal_accounts VALUES($1,$2,NULL)",
    [actor, customer],
  );
  await db.query(
    `INSERT INTO sandy_universal_files(id,owner_customer_id,metadata,display_name,description,library_state)
 VALUES($1,$2,'{"preserved":"existing metadata"}','Original title','Original description','active')`,
    [file, customer],
  );
  await db.exec(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  await db.exec(fixtureScanSchema);
  await db.exec(
    await readFile(new URL("./projection.sql", import.meta.url), "utf8"),
  );
  await db.query(
    `INSERT INTO sandy_cloud.workspaces VALUES($1,'workspace',$2,100,0,0,1)`,
    [context.apiTenantId, customer],
  );
  await db.query(
    `INSERT INTO sandy_cloud.file_heads(tenant_id,workspace_id,file_id) VALUES($1,'workspace',$2)`,
    [context.apiTenantId, file],
  );
  await db.query(
    `INSERT INTO sandy_cloud.upload_intents(tenant_id,workspace_id,intent_id,actor_id,idempotency_key,file_id,input_sha256,ref,
 expected_revision,policy_epoch,expires_at,reserved_bytes) VALUES($1,'workspace','upload',$2,'unique-key',$3,$4,$5,0,1,$6,0)`,
    [
      context.apiTenantId,
      actor,
      file,
      intentDigest(intent),
      JSON.stringify(ref),
      new Date(expiration),
    ],
  );
  await db.query(
    `INSERT INTO sandy_cloud.scan_receipts VALUES($1,'workspace','upload',$2,'synthetic-scanner','CLEAN',$3)`,
    [context.apiTenantId, JSON.stringify(ref), new Date(expiration)],
  );
  await check(
    "API hook validates distinct tenant/customer through explicit locked relation and real portal row",
    async () => {
      await boundary.authorize(intent);
    },
  );
  await check(
    "missing relation, mismatched principal/session/company/device and revoked grants deny",
    async () => {
      const cases: Array<LockedRuntimeFacts | null> = [null, {
        ...originalFacts,
        tenantCustomer: {
          ...originalFacts.tenantCustomer,
          customerId: context.apiTenantId,
        },
      }, {
        ...originalFacts,
        tenantCustomer: { ...originalFacts.tenantCustomer, revoked: true },
      }, {
        ...originalFacts,
        session: { ...originalFacts.session, sessionId: "foreign" },
      }, {
        ...originalFacts,
        admission: { ...originalFacts.admission, uploadAllowed: false },
      }, {
        ...originalFacts,
        device: { ...originalFacts.device!, actorId: "foreign" },
      }, {
        ...originalFacts,
        company: { ...originalFacts.company!, workspaceId: "foreign" },
      }, {
        ...originalFacts,
        company: { ...originalFacts.company!, expiresAt: 0 },
      }];
      for (const f of cases) {
        facts = f;
        await assert.rejects(
          boundary.authorize(intent),
          /CLOUD_ADMISSION_DENIED/,
        );
      }
      facts = structuredClone(originalFacts);
    },
  );
  await check(
    "actual portal revoke or customer rebind denies current admission",
    async () => {
      await db.exec(
        "UPDATE sandy_memory_portal_accounts SET revoked_at=clock_timestamp()",
      );
      await assert.rejects(
        boundary.authorize(intent),
        /CLOUD_ADMISSION_DENIED/,
      );
      await db.query(
        "UPDATE sandy_memory_portal_accounts SET revoked_at=NULL,customer_id=$1",
        [file],
      );
      await assert.rejects(
        boundary.authorize(intent),
        /CLOUD_ADMISSION_DENIED/,
      );
      await db.query("UPDATE sandy_memory_portal_accounts SET customer_id=$1", [
        customer,
      ]);
    },
  );
  await check(
    "revocation between admission and commit blocks every metadata write",
    async () => {
      await boundary.authorize(intent);
      facts!.session.revoked = true;
      await assert.rejects(
        boundary.commit(intent, proof),
        /CLOUD_ADMISSION_DENIED/,
      );
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM sandy_cloud.versions"))
          .rows[0].n,
        0,
      );
      facts = structuredClone(originalFacts);
    },
  );
  await check(
    "absent, revoked or foreign writer assignment cannot change canonical file",
    async () => {
      const original = writer;
      for (
        const w of [null, { ...original!, revoked: true }, {
          ...original!,
          customerId: file,
        }, { ...original!, revision: 4 }]
      ) {
        writer = w;
        await assert.rejects(
          boundary.commit(intent, proof),
          /CLOUD_FILE_WRITER_DENIED/,
        );
      }
      writer = original;
      assert.equal(
        (await db.query("SELECT sha256 FROM sandy_universal_files")).rows[0]
          .sha256,
        null,
      );
    },
  );
  await check(
    "projection audit failure rolls back canonical file, version and accounting",
    async () => {
      await db.exec(
        `CREATE FUNCTION public.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AUDIT_FAILED'; END $$;
   CREATE TRIGGER fail BEFORE INSERT ON sandy_cloud.projection_events FOR EACH ROW EXECUTE FUNCTION public.fail_audit();`,
      );
      await assert.rejects(boundary.commit(intent, proof), /AUDIT_FAILED/);
      assert.equal(
        (await db.query("SELECT sha256 FROM sandy_universal_files")).rows[0]
          .sha256,
        null,
      );
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM sandy_cloud.versions"))
          .rows[0].n,
        0,
      );
      await db.exec("DROP TRIGGER fail ON sandy_cloud.projection_events");
    },
  );
  await check(
    "canonical projection preserves metadata and text while pinning new exact-generation bytes",
    async () => {
      await boundary.commit(intent, proof);
      await boundary.commit(intent, proof);
      const row =
        (await db.query("SELECT * FROM sandy_universal_files")).rows[0];
      assert.equal(row.provider, "gcs");
      assert.equal(row.provider_file_id, "101");
      assert.equal(row.storage_bucket, ref.bucket);
      assert.equal(row.storage_path, ref.key);
      assert.equal(row.sha256, ref.sha256);
      assert.equal(row.metadata.preserved, "existing metadata");
      assert.deepEqual(row.metadata.sandy_cloud_version.ref, ref);
      assert.equal(row.display_name, "Original title");
      assert.equal(row.description, "Original description");
      assert.equal(row.library_state, "active");
      assert.equal(
        (await db.query(
          "SELECT count(*)::int AS n FROM sandy_cloud.projection_events",
        )).rows[0].n,
        1,
      );
      await assert.rejects(
        db.exec("DELETE FROM sandy_cloud.projection_events"),
        /IMMUTABLE/,
      );
    },
  );
  await check(
    "receipt replay remains denied after real portal revocation",
    async () => {
      await db.exec(
        "UPDATE sandy_memory_portal_accounts SET revoked_at=clock_timestamp()",
      );
      await assert.rejects(boundary.lookup(intent), /CLOUD_ADMISSION_DENIED/);
    },
  );
  console.log(
    JSON.stringify({
      suite: "cloud-canonical-bindings",
      passed,
      liveDatabaseUsed: false,
      runtimeFacts:
        "synthetic authority rows, no actual tenant/customer relation installed",
      multiSessionLocksVerified: false,
    }),
  );
} finally {
  await db.close();
}
