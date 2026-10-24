/** Cloud assembly of Runtime's canonical loader and lock plan. No lock algorithm,
 * identity relation, scanner trust, route or execution grant is defined here.
 */
import type { AuthenticatedCloudContext } from "../../sandy-api/cloud/admission.ts";
import {
  intentDigest,
  type ProductionOwners,
  type SqlTransaction,
} from "./commit.ts";
import {
  type CloudScanReferenceOwner,
  type RuntimeScanVerifier,
  sharedScanOwner,
} from "./shared_scan.ts";
export interface CompleteCloudPlan {
  actorId: string;
  customerId: string;
  tenantId: string;
  admissionId: string;
  fileId: string;
  artifactId: string;
  receiptId: string;
  scanner: { issuer: string; release: string };
  sessionId: string;
  companyId?: string;
  cloud: { workspaceId: string; intentId: string; writerAssignmentId: string };
}
export interface RuntimeCustodySource {
  lockCustodyPlan(tx: SqlTransaction, plan: CompleteCloudPlan): Promise<void>;
  canonicalCloudReferences: CloudScanReferenceOwner;
  journal: RuntimeScanVerifier;
}
export interface WriterDiscovery {
  /** Non-authorizing read of the actual writer-assignment ID. No row locks or
   * inferred file-ID equality; canonicalFileProjection still authorizes afterward.
   */
  discover(tx: SqlTransaction, fileId: string): Promise<string | null>;
}
const deny = (): never => {
  throw Error("CLOUD_COMPLETE_PLAN_REFUSED");
};
const identifier = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 1000;
const discoverySql =
  `SELECT w.customer_id::text,w.policy_epoch,i.file_id::text,i.actor_id,i.input_sha256,
 r.receipt_id::text,r.artifact_id::text,r.admission_id::text,r.intent_sha256,r.binding,
 s.issuer,s.release FROM sandy_cloud.workspaces w
 JOIN sandy_cloud.upload_intents i ON i.tenant_id=w.tenant_id AND i.workspace_id=w.workspace_id
 JOIN sandy_artifact_custody.cloud_scan_references r ON r.tenant_id=i.tenant_id AND r.workspace_id=i.workspace_id
   AND r.intent_id=i.intent_id AND r.file_id=i.file_id
 JOIN sandy_artifact_custody.scan_receipts s ON s.id=r.receipt_id
 WHERE i.tenant_id=$1 AND i.workspace_id=$2 AND i.intent_id=$3`;
/** Discovery reads no private bytes and establishes NO permission. Full gates
 * precede portal/workspace/intent/file row locks. Changed discovery aborts this
 * transaction; never extend its plan or silently retry an uncertain outcome.
 */
export function prepareCloudTransaction(
  context: AuthenticatedCloudContext,
  runtime: Pick<RuntimeCustodySource, "lockCustodyPlan">,
  writer: WriterDiscovery,
): ProductionOwners["prepareTransaction"] {
  const c = Object.freeze({ ...context });
  return async (tx, input) => {
    const i = Object.freeze({ ...input, ref: Object.freeze({ ...input.ref }) });
    if (
      i.actorId !== c.actorId || i.ref.tenantId !== c.apiTenantId ||
      !identifier(c.sessionId)
    ) deny();
    const discover = async () => {
      const { rows } = await tx.query(discoverySql, [
        i.ref.tenantId,
        i.ref.workspaceId,
        i.id,
      ]);
      const row = rows[0],
        b = row?.binding as Record<string, unknown> | undefined;
      if (
        rows.length !== 1 || !row || !b || row.actor_id !== i.actorId ||
        row.input_sha256 !== intentDigest(i) ||
        row.intent_sha256 !== intentDigest(i) || b.actorId !== i.actorId ||
        b.artifactId !== row.artifact_id || b.admissionId !== row.admission_id
      ) deny();
      const assignment = await writer.discover(tx, String(row.file_id));
      if (
        !identifier(assignment) ||
        ![
          row.customer_id,
          row.file_id,
          row.receipt_id,
          row.artifact_id,
          row.admission_id,
          row.issuer,
          row.release,
        ].every(identifier)
      ) deny();
      return { row, assignment: assignment! };
    };
    const before = await discover();
    const plan: CompleteCloudPlan = {
      actorId: c.actorId,
      customerId: String(before.row.customer_id),
      tenantId: i.ref.tenantId,
      admissionId: String(before.row.admission_id),
      fileId: String(before.row.file_id),
      artifactId: String(before.row.artifact_id),
      receiptId: String(before.row.receipt_id),
      scanner: {
        issuer: String(before.row.issuer),
        release: String(before.row.release),
      },
      sessionId: c.sessionId,
      ...(c.companyId ? { companyId: c.companyId } : {}),
      cloud: {
        workspaceId: i.ref.workspaceId,
        intentId: i.id,
        writerAssignmentId: before.assignment,
      },
    };
    // The currently authenticated admission is an independent binding. Completion
    // requires the canonical reference to belong to this admitted request.
    if (plan.admissionId !== c.admissionId) deny();
    await runtime.lockCustodyPlan(tx, structuredClone(plan));
    const after = await discover();
    if (JSON.stringify(before) !== JSON.stringify(after)) deny();
  };
}
/** The loader is Runtime's implementation, not a Cloud reference callback.
 * Device revokers must take the device owner's actor gate (and old/new actor
 * gates on reassignment); session/company revokers take their respective gates.
 */
export function integrateRuntimeCustody(
  input: {
    context: AuthenticatedCloudContext;
    runtime: RuntimeCustodySource;
    writer: WriterDiscovery;
    lockAdmission: ProductionOwners["lockAdmission"];
    projectVersion: ProductionOwners["projectVersion"];
    contract: { operation: string; sha256: string };
  },
) {
  const owners: ProductionOwners = {
    prepareTransaction: prepareCloudTransaction(
      input.context,
      input.runtime,
      input.writer,
    ),
    lockAdmission: input.lockAdmission,
    projectVersion: input.projectVersion,
  };
  return {
    owners,
    scanner: sharedScanOwner(
      input.runtime.journal,
      input.runtime.canonicalCloudReferences,
      input.contract,
    ),
  };
}
