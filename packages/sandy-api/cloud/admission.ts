/** API-owned integration seam, not an authentication endpoint. Only the existing
 * gateway may construct context after authentication; JSON is never a context.
 * Runtime supplies the canonical transaction lock implementation, not a REST
 * precheck. No tenant/customer equivalence or new grant is inferred here.
 */
import type {
  ProductionOwners,
  SqlTransaction,
} from "../../sandy-cloud/postgres/commit.ts";
export interface AuthenticatedCloudContext {
  actorId: string;
  apiTenantId: string;
  sessionId: string;
  deviceId: string | null;
  companyId: string | null;
  admissionId: string;
}
export interface LockedCloudAuthority extends AuthenticatedCloudContext {
  customerId: string;
  workspaceId: string;
  policyEpoch: number;
  expiresAt: number;
  revoked: boolean;
  /** Explicit relation, established by canonical authority, not UUID equality. */
  tenantCustomerLinked: boolean;
  portalCustomerLinked: boolean;
  deviceAllowed: boolean;
  companyAllowed: boolean;
  uploadAllowed: boolean;
}
export interface CloudAuthorityOwner {
  /** Must lock admission, session, portal mapping, explicit tenant/customer
   * relation and optional device/company grants on tx, in canonical lock order.
   * Every revoker must conflict with those locks through commit. Missing rows
   * return null. The adapter cannot establish this DB protocol on its own.
   */
  lock(
    tx: SqlTransaction,
    context: Readonly<AuthenticatedCloudContext>,
    workspaceId: string,
  ): Promise<LockedCloudAuthority | null>;
}
const present = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= 1024;
const deny = (): never => {
  throw new Error("CLOUD_ADMISSION_DENIED");
};
/** Directly implements PR266's ProductionOwners.lockAdmission; reuse on lookup
 * and commit so old receipts cannot bypass revoked access. */
export function cloudAdmissionHook(
  context: AuthenticatedCloudContext,
  owner: CloudAuthorityOwner,
  now = Date.now,
): ProductionOwners["lockAdmission"] {
  const c = Object.freeze({ ...context });
  if (
    ![c.actorId, c.apiTenantId, c.sessionId, c.admissionId].every(present) ||
    (c.deviceId !== null && !present(c.deviceId)) ||
    (c.companyId !== null && !present(c.companyId))
  ) deny();
  return async (tx, intent) => {
    if (
      intent.actorId !== c.actorId || intent.ref.tenantId !== c.apiTenantId ||
      !present(intent.ref.workspaceId)
    ) deny();
    const a = await owner.lock(tx, c, intent.ref.workspaceId);
    const checkedAt = now();
    if (
      !Number.isSafeInteger(checkedAt) || checkedAt < 0 ||
      !a || a.actorId !== c.actorId || a.apiTenantId !== c.apiTenantId ||
      a.sessionId !== c.sessionId || a.deviceId !== c.deviceId ||
      a.companyId !== c.companyId ||
      a.admissionId !== c.admissionId ||
      a.workspaceId !== intent.ref.workspaceId ||
      !present(a.customerId) || a.revoked !== false ||
      a.tenantCustomerLinked !== true ||
      a.portalCustomerLinked !== true || a.uploadAllowed !== true ||
      (c.deviceId !== null && a.deviceAllowed !== true) ||
      (c.companyId !== null && a.companyAllowed !== true) ||
      !Number.isSafeInteger(a.policyEpoch) || a.policyEpoch < 1 ||
      !Number.isSafeInteger(a.expiresAt) || a.expiresAt <= checkedAt
    ) deny();
    return Object.freeze({
      customerId: a!.customerId,
      policyEpoch: a!.policyEpoch,
      admissionId: c.admissionId,
      expiresAt: a!.expiresAt,
    });
  };
}
