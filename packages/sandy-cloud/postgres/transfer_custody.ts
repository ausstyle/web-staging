/** Bind Runtime private custody to a Cloud intent before constructing API scope.
 * No session URL is persisted, returned to a client or dispatched by this module.
 */
import type { TransferScope } from "../../sandy-api/cloud/transport.ts";
import type { AuthenticatedCloudContext } from "../../sandy-api/cloud/admission.ts";
import type { SqlTransaction } from "./commit.ts";
export interface CloudTransferIntent {
  intentId: string;
  actorId: string;
  tenantId: string;
  workspaceId: string;
  admissionId: string;
  bucket: string;
  key: string;
  objectPrefix: string;
  size: number;
  sha256: string;
  expiresAt: number;
}
export interface PrivateCustodyRow {
  rowId: string;
  intentId: string;
  actorId: string;
  tenantId: string;
  workspaceId: string;
  admissionId: string;
  sessionId: string;
  deviceId: string | null;
  bucket: string;
  key: string;
  size: number;
  sha256: string;
  expiresAt: number;
  revoked: boolean;
  offset: number;
  sessionUrl?: string;
  generation?: string;
  state: "READY" | "UNKNOWN_OUTCOME" | "COMPLETE";
}
export interface RuntimeTransferCustody {
  /** Exact same pinned tx. Runtime owns private session rows, durable offset CAS,
   * dispatch claims/leases, unknown-outcome marking and status reconciliation.
   * Missing/foreign rows return null. Never import custody from client JSON.
   */
  lock(tx: SqlTransaction, intentId: string): Promise<PrivateCustodyRow | null>;
}
export async function lockedTransferScope(
  tx: SqlTransaction,
  c: Readonly<AuthenticatedCloudContext>,
  intent: Readonly<CloudTransferIntent>,
  custody: RuntimeTransferCustody,
  operation: "start" | "chunk" | "status" | "read",
  now = Date.now,
): Promise<Readonly<TransferScope>> {
  const deny = (): never => {
    throw Error("CLOUD_CUSTODY_DENIED");
  };
  const i = Object.freeze({ ...intent });
  if (
    !["start", "chunk", "status", "read"].includes(operation) ||
    !Number.isSafeInteger(i.size) || i.size < 0 ||
    !/^[a-f0-9]{64}$/.test(i.sha256) ||
    typeof i.objectPrefix !== "string" || !i.objectPrefix ||
    typeof i.key !== "string" || !i.key || i.key.length > 1024
  ) deny();
  if (
    i.actorId !== c.actorId || i.tenantId !== c.apiTenantId ||
    i.admissionId !== c.admissionId
  ) deny();
  const row = await custody.lock(tx, i.intentId);
  if (
    !row || !["READY", "UNKNOWN_OUTCOME", "COMPLETE"].includes(row.state) ||
    !row.rowId || row.intentId !== i.intentId ||
    row.actorId !== c.actorId ||
    row.tenantId !== i.tenantId || row.workspaceId !== i.workspaceId ||
    row.admissionId !== c.admissionId ||
    row.sessionId !== c.sessionId || row.deviceId !== c.deviceId ||
    row.revoked !== false ||
    row.bucket !== i.bucket || row.key !== i.key || row.size !== i.size ||
    row.sha256 !== i.sha256 ||
    !Number.isSafeInteger(row.expiresAt) ||
    !Number.isSafeInteger(i.expiresAt) ||
    Math.min(row.expiresAt, i.expiresAt) <= now() ||
    !Number.isSafeInteger(row.offset) ||
    row.offset < 0 || row.offset > i.size
  ) return deny();
  if (!i.objectPrefix.endsWith("/") || !i.key.startsWith(i.objectPrefix)) {
    deny();
  }
  if (
    operation === "start" &&
    (row.state !== "READY" || row.sessionUrl || row.offset !== 0 ||
      row.generation)
  ) deny();
  if (
    operation === "chunk" &&
    (row.state !== "READY" || !row.sessionUrl || row.generation)
  ) deny();
  if (operation === "status" && (!row.sessionUrl || row.state === "COMPLETE")) {
    deny();
  }
  if (
    operation === "read" &&
    (row.state !== "COMPLETE" || !row.generation || row.offset !== i.size)
  ) deny();
  if (row.sessionUrl) {
    let u: URL;
    try {
      u = new URL(row.sessionUrl);
    } catch {
      return deny();
    }
    if (
      u.protocol !== "https:" || u.host !== "storage.googleapis.com" ||
      u.username || u.password || u.hash ||
      u.pathname !== `/upload/storage/v1/b/${encodeURIComponent(i.bucket)}/o` ||
      [...u.searchParams].length !== 2 ||
      u.searchParams.get("uploadType") !== "resumable" ||
      !u.searchParams.get("upload_id")
    ) deny();
  }
  if (row.generation && !/^[1-9][0-9]{0,39}$/.test(row.generation)) deny();
  return Object.freeze({
    tenantId: i.tenantId,
    workspaceId: i.workspaceId,
    intentId: i.intentId,
    admissionId: c.admissionId,
    bucket: i.bucket,
    key: i.key,
    objectPrefix: i.objectPrefix,
    size: i.size,
    sha256: i.sha256,
    offset: row.offset,
    expiresAt: Math.min(i.expiresAt, row.expiresAt),
    ...(row.sessionUrl ? { sessionUrl: row.sessionUrl } : {}),
    ...(row.generation ? { generation: row.generation } : {}),
  });
}
