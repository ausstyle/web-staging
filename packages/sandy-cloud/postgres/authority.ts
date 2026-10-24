/** Cloud-owned validation of canonical locked facts. Installs no relation/grant.
 * Runtime must supply the actual authoritative rows using the pinned transaction.
 */
import type {
  AuthenticatedCloudContext,
  CloudAuthorityOwner,
  LockedCloudAuthority,
} from "../../sandy-api/cloud/admission.ts";
import type { SqlTransaction } from "./commit.ts";
export interface GrantRow {
  rowId: string;
  revoked: boolean;
  expiresAt: number;
}
export interface LockedRuntimeFacts {
  admission: GrantRow & AuthenticatedCloudContext & {
    workspaceId: string;
    uploadAllowed: boolean;
    policyEpoch: number;
  };
  session: GrantRow & { sessionId: string; actorId: string };
  tenantCustomer: GrantRow & { apiTenantId: string; customerId: string };
  device:
    | (GrantRow & {
      deviceId: string;
      actorId: string;
      workspaceId: string;
      allowed: boolean;
    })
    | null;
  company:
    | (GrantRow & {
      companyId: string;
      customerId: string;
      workspaceId: string;
      actorId: string;
      allowed: boolean;
    })
    | null;
}
export interface RuntimeAuthorityRows {
  /** Lock order: admission -> session -> explicit tenant/customer -> device ->
   * company; then Cloud locks portal -> workspace -> intent -> file. All grant
   * revokers must participate. Return null for absent authority. No cached JWT
   * claims, REST prechecks or fabricated mapping rows. This interface grants
   * nothing and does not select a relation table that has not been identified.
   */
  lock(
    tx: SqlTransaction,
    context: Readonly<AuthenticatedCloudContext>,
    workspaceId: string,
  ): Promise<LockedRuntimeFacts | null>;
}
const present = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 1024;
const current = (g: GrantRow | null, now: number): g is GrantRow =>
  !!g && present(g.rowId) && g.revoked === false &&
  Number.isSafeInteger(g.expiresAt) && g.expiresAt > now;
export function canonicalCloudAuthority(
  runtime: RuntimeAuthorityRows,
  now = Date.now,
): CloudAuthorityOwner {
  return {
    async lock(tx, c, w): Promise<LockedCloudAuthority | null> {
      const facts = await runtime.lock(tx, c, w);
      if (!facts) return null;
      const {
        admission: a,
        session: s,
        tenantCustomer: r,
        device: d,
        company: g,
      } = structuredClone(facts);
      const time = now();
      if (
        !current(a, time) || !current(s, time) || !current(r, time) ||
        a.actorId !== c.actorId || a.apiTenantId !== c.apiTenantId ||
        a.sessionId !== c.sessionId ||
        a.deviceId !== c.deviceId || a.companyId !== c.companyId ||
        a.admissionId !== c.admissionId ||
        a.workspaceId !== w || a.uploadAllowed !== true ||
        !Number.isSafeInteger(a.policyEpoch) || a.policyEpoch < 1 ||
        s.sessionId !== c.sessionId || s.actorId !== c.actorId ||
        r.apiTenantId !== c.apiTenantId || !present(r.customerId)
      ) return null;
      if (
        c.deviceId !== null &&
        (!current(d, time) || d.deviceId !== c.deviceId ||
          d.actorId !== c.actorId || d.workspaceId !== w || d.allowed !== true)
      ) return null;
      if (
        c.companyId !== null &&
        (!current(g, time) || g.companyId !== c.companyId ||
          g.customerId !== r.customerId || g.actorId !== c.actorId ||
          g.workspaceId !== w || g.allowed !== true)
      ) return null;
      // Known canonical table, inspected metadata-only. SHARE conflicts with UPDATE
      // and DELETE revocation; selecting more than one active mapping is ambiguous.
      const { rows } = await tx.query(
        `SELECT auth_user_id::text,customer_id::text,revoked_at
      FROM public.sandy_memory_portal_accounts WHERE auth_user_id=$1::uuid FOR SHARE`,
        [c.actorId],
      );
      if (
        rows.length !== 1 || rows[0].auth_user_id !== c.actorId ||
        rows[0].customer_id !== r.customerId || rows[0].revoked_at !== null
      ) return null;
      const expiresAt = Math.min(
        a.expiresAt,
        s.expiresAt,
        r.expiresAt,
        c.deviceId !== null ? d!.expiresAt : Infinity,
        c.companyId !== null ? g!.expiresAt : Infinity,
      );
      if (expiresAt <= now()) return null;
      return {
        ...c,
        customerId: r.customerId,
        workspaceId: w,
        policyEpoch: a.policyEpoch,
        expiresAt,
        revoked: false,
        tenantCustomerLinked: true,
        portalCustomerLinked: true,
        deviceAllowed: c.deviceId === null || d!.allowed,
        companyAllowed: c.companyId === null || g!.allowed,
        uploadAllowed: true,
      };
    },
  };
}
