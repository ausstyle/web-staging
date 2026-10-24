/** TEST FIXTURE ONLY. Not packaged for release. This is not scanner authority. */
import type { SqlTransaction } from "./commit.ts";
import { intentDigest } from "./commit.ts";
import type { ScanCommitOwner } from "./shared_scan.ts";
export const fixtureScanSchema = `CREATE TABLE sandy_cloud.scan_receipts (
 tenant_id text,workspace_id text,intent_id text,ref jsonb,scanner_release text,
 verdict text,valid_until timestamptz,
 FOREIGN KEY(tenant_id,workspace_id,intent_id) REFERENCES sandy_cloud.upload_intents
);`;
export const fixtureScanner: ScanCommitOwner = {
  async verifyInTransaction(tx: SqlTransaction, { intent: i }) {
    const { rows } = await tx.query(
      `SELECT verdict, floor(extract(epoch from valid_until)*1000)::bigint expires_ms
 FROM sandy_cloud.scan_receipts WHERE tenant_id=$1 AND workspace_id=$2 AND intent_id=$3
 AND ref=$4::jsonb AND valid_until>clock_timestamp() FOR SHARE`,
      [i.ref.tenantId, i.ref.workspaceId, i.id, JSON.stringify(i.ref)],
    );
    if (rows[0]?.verdict !== "CLEAN") throw Error("SCAN_NOT_CLEAN");
    return {
      receiptId: "50000000-0000-4000-8000-000000000001",
      bindingSha256: intentDigest(i),
      scannerIdentity: "test-only",
      scannerVersion: "fixture",
      trustRevision: 1,
      authorityRevision: "fixture",
      expiresAt: Number(rows[0].expires_ms),
    };
  },
};
