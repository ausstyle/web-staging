/** PostgreSQL transaction adapter. No network, credentials, route or role grants.
 * The canonical API owner supplies admission and canonical-file projection hooks;
 * both run on the SAME transaction, never via an independent REST write.
 */
import type { ScanCommitOwner } from "./shared_scan.ts";
import { createHash, randomUUID } from "node:crypto";
import {
  type CommitBoundary,
  IntegrityError,
  type IntegrityReceipt,
  type UploadIntent,
  validateRef,
  type VersionReceipt,
} from "../integrity.ts";
export interface SqlTransaction {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface SqlDatabase {
  /** Must pin a connection, BEGIN, await callback, COMMIT; rollback on any throw.
   * No automatic retry after an ambiguous commit acknowledgement.
   */
  transaction<T>(fn: (tx: SqlTransaction) => Promise<T>): Promise<T>;
}
export interface CanonicalAdmission {
  customerId: string;
  policyEpoch: number;
}
export interface ProductionOwners {
  /** Resolve authenticated actor/session/device and API-tenant/customer/company
   * membership from canonical sources. Lock relevant revocation/policy rows until
   * commit; reject unestablished shares. Never trust identity from request JSON.
   * All writers of those grants must participate in that locking protocol.
   */
  lockAdmission(
    tx: SqlTransaction,
    intent: Readonly<UploadIntent>,
  ): Promise<CanonicalAdmission>;
  /** Must use tx to CAS the existing universal-file projection and append its
   * lifecycle audit. Verify this is a Cloud-owned canonical file and ownership
   * matches customerId. No REST/fetch/second DB; throwing rolls back everything.
   */
  projectVersion(
    tx: SqlTransaction,
    input: {
      customerId: string;
      fileId: string;
      expectedRevision: number;
      receipt: VersionReceipt;
    },
  ): Promise<void>;
}
const fail = (code: string): never => {
  throw new IntegrityError(code);
};
export function intentDigest(i: Readonly<UploadIntent>): string {
  // Fixed ordering; includes every input used by the coordinator and projection.
  return createHash("sha256").update(JSON.stringify([
    i.id,
    i.actorId,
    i.traceId,
    i.expectedRevision,
    i.idempotencyKey,
    i.expiresAt,
    i.ref.tenantId,
    i.ref.workspaceId,
    i.ref.bucket,
    i.ref.key,
    i.ref.generation,
    i.ref.size,
    i.ref.sha256,
  ])).digest("hex");
}
const scope = (
  i: Readonly<UploadIntent>,
) => [i.ref.tenantId, i.ref.workspaceId];
type IntentRow = Record<string, unknown> & {
  file_id: string;
  state: string;
  input_sha256: string;
  actor_id: string;
  idempotency_key: string;
  expected_revision: string | number;
  reserved_bytes: string | number;
  policy_epoch: string | number;
  unexpired: boolean;
  ref_matches: boolean;
};
export class PostgresCommitBoundary implements CommitBoundary {
  constructor(
    private readonly db: SqlDatabase,
    private readonly owners: ProductionOwners,
    private readonly scanner: ScanCommitOwner,
  ) {}

  private async admitted(tx: SqlTransaction, i: Readonly<UploadIntent>) {
    // Domain locks follow authority locks, always workspace -> intent -> file.
    const admitted = await this.owners.lockAdmission(tx, i);
    if (
      !admitted || !Number.isSafeInteger(admitted.policyEpoch) ||
      admitted.policyEpoch < 1 || typeof admitted.customerId !== "string"
    ) {
      fail("NOT_FOUND");
    }
    const { rows } = await tx.query(
      `SELECT customer_id, policy_epoch,
      used_bytes, reserved_bytes, quota_bytes FROM sandy_cloud.workspaces
      WHERE tenant_id=$1 AND workspace_id=$2 FOR UPDATE`,
      scope(i),
    );
    const w = rows[0];
    if (
      !w || w.customer_id !== admitted.customerId ||
      Number(w.policy_epoch) !== admitted.policyEpoch
    ) fail("NOT_FOUND");
    return { admitted, workspace: w };
  }
  private async stored(tx: SqlTransaction, i: Readonly<UploadIntent>) {
    const { rows } = await tx.query<IntentRow>(
      `SELECT *,
      expires_at > clock_timestamp() AS unexpired, ref = $4::jsonb AS ref_matches
      FROM sandy_cloud.upload_intents
      WHERE tenant_id=$1 AND workspace_id=$2 AND intent_id=$3 FOR UPDATE`,
      [...scope(i), i.id, JSON.stringify(i.ref)],
    );
    const row = rows[0];
    if (!row || row.actor_id !== i.actorId) fail("NOT_FOUND");
    if (
      row.input_sha256 !== intentDigest(i) || !row.ref_matches ||
      row.idempotency_key !== i.idempotencyKey ||
      Number(row.expected_revision) !== i.expectedRevision ||
      Number(row.reserved_bytes) !== i.ref.size
    ) fail("IDEMPOTENCY_CONFLICT");
    return row;
  }
  private async receipt(tx: SqlTransaction, i: Readonly<UploadIntent>) {
    const { rows } = await tx.query(
      `SELECT receipt FROM sandy_cloud.commit_receipts
      WHERE tenant_id=$1 AND workspace_id=$2 AND intent_id=$3`,
      [...scope(i), i.id],
    );
    return (rows[0]?.receipt as VersionReceipt | undefined) ?? null;
  }
  private proof(i: Readonly<UploadIntent>, p: IntegrityReceipt) {
    validateRef(i.ref, {
      tenantId: i.ref.tenantId,
      workspaceId: i.ref.workspaceId,
      allowedBuckets: new Set([i.ref.bucket]),
      maxBytes: Number.MAX_SAFE_INTEGER,
      signal: new AbortController().signal,
    });
    if (
      p.state !== "BYTES_VERIFIED" || p.bytesRead !== i.ref.size ||
      p.sha256 !== i.ref.sha256 ||
      intentDigest({ ...i, ref: p.ref }) !== intentDigest(i)
    ) fail("INVALID_BYTE_PROOF");
  }
  async authorize(i: Readonly<UploadIntent>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.admitted(tx, i);
      await this.stored(tx, i);
    });
  }
  async lookup(i: Readonly<UploadIntent>): Promise<VersionReceipt | null> {
    return await this.db.transaction(async (tx) => {
      await this.admitted(tx, i);
      await this.stored(tx, i);
      return await this.receipt(tx, i);
    });
  }
  async assertScanClean(
    i: Readonly<UploadIntent>,
    p: IntegrityReceipt,
  ): Promise<void> {
    this.proof(i, p);
    await this.db.transaction(async (tx) => {
      const { admitted } = await this.admitted(tx, i);
      const row = await this.stored(tx, i);
      if (!this.scanner) fail("SHARED_SCAN_OWNER_REQUIRED");
      await this.scanner.verifyInTransaction(tx, {
        intent: i,
        fileId: row.file_id,
        admission: admitted,
        proof: p,
      });
    });
  }
  async commit(i: Readonly<UploadIntent>, p: IntegrityReceipt): Promise<void> {
    this.proof(i, p);
    await this.db.transaction(async (tx) => {
      const { admitted, workspace } = await this.admitted(tx, i);
      const row = await this.stored(tx, i);
      const existing = await this.receipt(tx, i);
      if (existing) return; // current admission is still required on replay
      if (row.state !== "OPEN" || !row.unexpired || Date.now() >= i.expiresAt) {
        fail("INTENT_EXPIRED");
      }
      if (Number(row.policy_epoch) !== admitted.policyEpoch) {
        fail("POLICY_CHANGED");
      }
      if (!this.scanner) fail("SHARED_SCAN_OWNER_REQUIRED");
      const scan = await this.scanner.verifyInTransaction(tx, {
        intent: i,
        fileId: row.file_id,
        admission: admitted,
        proof: p,
      });
      if (
        !scan || !Number.isSafeInteger(scan.expiresAt) ||
        scan.expiresAt <= Date.now()
      ) fail("SCAN_NOT_CLEAN");
      if (
        Number(workspace.reserved_bytes) < i.ref.size ||
        Number(workspace.used_bytes) + Number(workspace.reserved_bytes) >
          Number(workspace.quota_bytes)
      ) fail("QUOTA_EXCEEDED");
      const { rows: heads } = await tx.query(
        `SELECT revision FROM sandy_cloud.file_heads
        WHERE tenant_id=$1 AND workspace_id=$2 AND file_id=$3 FOR UPDATE`,
        [...scope(i), row.file_id],
      );
      if (Number(heads[0]?.revision) !== i.expectedRevision) {
        fail("REVISION_CONFLICT");
      }
      const receipt: VersionReceipt = {
        state: "COMMITTED",
        intentId: i.id,
        versionId: randomUUID(),
        revision: i.expectedRevision + 1,
        ref: { ...i.ref },
        traceId: i.traceId,
      };
      await tx.query(
        `INSERT INTO sandy_cloud.versions
        (tenant_id,workspace_id,version_id,file_id,intent_id,revision,ref)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          ...scope(i),
          receipt.versionId,
          row.file_id,
          i.id,
          receipt.revision,
          JSON.stringify(i.ref),
        ],
      );
      await tx.query(
        `INSERT INTO sandy_cloud.version_scans
        (tenant_id,workspace_id,version_id,receipt_id,evidence) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [...scope(i), receipt.versionId, scan.receiptId, JSON.stringify(scan)],
      );
      await this.owners.projectVersion(tx, {
        customerId: admitted.customerId,
        fileId: row.file_id,
        expectedRevision: i.expectedRevision,
        receipt,
      });
      await tx.query(
        `UPDATE sandy_cloud.file_heads SET revision=$4,current_version_id=$5
        WHERE tenant_id=$1 AND workspace_id=$2 AND file_id=$3`,
        [...scope(i), row.file_id, receipt.revision, receipt.versionId],
      );
      await tx.query(
        `UPDATE sandy_cloud.workspaces
        SET used_bytes=used_bytes+$3,reserved_bytes=reserved_bytes-$3
        WHERE tenant_id=$1 AND workspace_id=$2`,
        [...scope(i), i.ref.size],
      );
      await tx.query(
        `INSERT INTO sandy_cloud.usage_events VALUES ($1,$2,$3,$4)`,
        [...scope(i), receipt.versionId, i.ref.size],
      );
      await tx.query(
        `INSERT INTO sandy_cloud.outbox(tenant_id,workspace_id,version_id,event)
        VALUES ($1,$2,$3,$4::jsonb)`,
        [
          ...scope(i),
          receipt.versionId,
          JSON.stringify({
            kind: "cloud.version.committed",
            fileId: row.file_id,
            receipt,
            scanReceiptId: scan.receiptId,
          }),
        ],
      );
      await tx.query(
        `INSERT INTO sandy_cloud.commit_receipts VALUES ($1,$2,$3,$4::jsonb)`,
        [...scope(i), i.id, JSON.stringify(receipt)],
      );
      const settled = await tx.query(
        `UPDATE sandy_cloud.upload_intents SET state='COMMITTED'
        WHERE tenant_id=$1 AND workspace_id=$2 AND intent_id=$3
        AND expires_at>clock_timestamp() AND to_timestamp($4/1000.0)>clock_timestamp()
        RETURNING intent_id`,
        [...scope(i), i.id, scan.expiresAt],
      );
      if (settled.rows.length !== 1) {
        fail("SCAN_OR_INTENT_EXPIRED_BEFORE_COMMIT");
      }
    });
  }
}
