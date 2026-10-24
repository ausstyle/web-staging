/** Source-only universal-file projection, no writer assignment or live routing.
 * Requires the file owner's locked explicit writer assignment. Existing readers
 * must understand GCS generation metadata before any activation of this adapter.
 */
import type { ProductionOwners, SqlTransaction } from "./commit.ts";
import { validateRef } from "../integrity.ts";
export interface LockedFileWriter {
  assignmentId: string;
  writer: "sandy-cloud";
  fileId: string;
  customerId: string;
  tenantId: string;
  workspaceId: string;
  revision: number;
  revoked: boolean;
  expiresAt: number;
}
export interface CanonicalFileWriterOwner {
  /** Same tx; conflicts with assignment revoke/reassignment. Lock order follows
   * Cloud's file head and precedes the universal-file row. Must not install an
   * assignment implicitly. Return null for legacy/unassigned/foreign files.
   */
  lock(tx: SqlTransaction, fileId: string): Promise<LockedFileWriter | null>;
}
export function canonicalFileProjection(
  owner: CanonicalFileWriterOwner,
  now = Date.now,
): ProductionOwners["projectVersion"] {
  return async (tx, input) => {
    const { expectedRevision: revision, fileId, customerId } = input;
    const r = Object.freeze({
      ...input.receipt,
      ref: Object.freeze({ ...input.receipt.ref }),
    });
    const deny = (): never => {
      throw Error("CLOUD_FILE_WRITER_DENIED");
    };
    validateRef(r.ref, {
      tenantId: r.ref.tenantId,
      workspaceId: r.ref.workspaceId,
      allowedBuckets: new Set([r.ref.bucket]),
      maxBytes: Number.MAX_SAFE_INTEGER,
      signal: new AbortController().signal,
    });
    const { rows: heads } = await tx.query(
      `SELECT revision FROM sandy_cloud.file_heads
      WHERE tenant_id=$1 AND workspace_id=$2 AND file_id=$3 FOR UPDATE`,
      [r.ref.tenantId, r.ref.workspaceId, fileId],
    );
    if (heads.length !== 1 || Number(heads[0].revision) !== revision) deny();
    const a = await owner.lock(tx, fileId);
    if (
      !a || !a.assignmentId || a.writer !== "sandy-cloud" ||
      a.fileId !== fileId || a.customerId !== customerId ||
      a.tenantId !== r.ref.tenantId || a.workspaceId !== r.ref.workspaceId ||
      a.revision !== revision ||
      a.revoked !== false || !Number.isSafeInteger(a.expiresAt) ||
      a.expiresAt <= now() || r.state !== "COMMITTED" ||
      r.revision !== revision + 1
    ) deny();
    const { rows } = await tx.query(
      `SELECT owner_customer_id::text,sha256,byte_size,storage_bucket,
      storage_path,provider,provider_file_id,metadata FROM public.sandy_universal_files
      WHERE id=$1::uuid FOR UPDATE`,
      [fileId],
    );
    if (rows.length !== 1 || rows[0].owner_customer_id !== customerId) deny();
    const prior = rows[0];
    if (
      !prior.metadata || typeof prior.metadata !== "object" ||
      Array.isArray(prior.metadata)
    ) deny();
    const nextMetadata = {
      ...(prior.metadata as Record<string, unknown>),
      sandy_cloud_version: {
        versionId: r.versionId,
        revision: r.revision,
        ref: r.ref,
      },
    };
    const updated = await tx.query(
      `UPDATE public.sandy_universal_files SET sha256=$3,
      byte_size=$4,storage_bucket=$5,storage_path=$6,provider='gcs',provider_file_id=$7,
      metadata=$8::jsonb,updated_at=clock_timestamp()
      WHERE id=$1::uuid AND owner_customer_id=$2::uuid RETURNING id`,
      [
        fileId,
        customerId,
        r.ref.sha256,
        r.ref.size,
        r.ref.bucket,
        r.ref.key,
        r.ref.generation,
        JSON.stringify(nextMetadata),
      ],
    );
    if (updated.rows.length !== 1) deny();
    // Same transaction as canonical projection, version, quota, receipt and outbox.
    await tx.query(
      `INSERT INTO sandy_cloud.projection_events
      (tenant_id,workspace_id,version_id,file_id,customer_id,writer_assignment_id,
       expected_revision,revision,prior_storage,projected_ref,trace_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
      [
        r.ref.tenantId,
        r.ref.workspaceId,
        r.versionId,
        fileId,
        customerId,
        a!.assignmentId,
        revision,
        r.revision,
        JSON.stringify({
          sha256: prior.sha256,
          size: prior.byte_size,
          bucket: prior.storage_bucket,
          key: prior.storage_path,
          provider: prior.provider,
          providerFileId: prior.provider_file_id,
        }),
        JSON.stringify(r.ref),
        r.traceId,
      ],
    );
  };
}
