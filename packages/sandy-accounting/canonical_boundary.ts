import { argumentDigest } from "../../supabase/functions/_shared/sandy_api_protocol.ts";
import type { ExecutionAdmission } from "../../supabase/functions/sandy-operation-api/access_policy.ts";
import type { Actor, Boundary, Evidence, Request, Sql } from "./service.ts";

/** Server-owned context from Sandy API authentication/consumption. Never parse
 * this from Accounting arguments. This module exposes no authentication route. */
export type CanonicalContext = {
  actorId: string;
  apiTenantId: string;
  companyId: string;
  sessionId: string;
  channel: "api" | "mcp" | "runtime";
  admission: ExecutionAdmission;
  contractSha256: string;
};
export type LockedAuthority = {
  admission: ExecutionAdmission;
  actorId: string;
  apiTenantId: string;
  companyId: string;
  sessionId: string;
  tenantCompanyLinked: boolean;
  operationAllowed: boolean;
  grantConsumed: boolean;
  revoked: boolean;
  policyRef: string;
  expiresAt: string;
};
export interface CanonicalOwners {
  /** Lock canonical session/admission, explicit tenant/company relation and
   * revocation writers through the SAME transaction. No sequential REST check
   * or unverified ID equality satisfies this contract. Missing authority=null. */
  lockAuthority(
    tx: Sql,
    context: Readonly<CanonicalContext>,
  ): Promise<LockedAuthority | null>;
  /** Universal Files owner locks current ACL/lifecycle and resolves the exact
   * stored source version/hash. No new blob store or owner table is created. */
  lockFile(tx: Sql, actor: Actor, company: string, source: Evidence): Promise<
    {
      actorId: string;
      apiTenantId: string;
      companyId: string;
      source: Evidence;
      allowed: boolean;
      revoked: boolean;
      deleted: boolean;
    } | null
  >;
}
export function accountingPayload(request: Request) {
  return {
    company_id: request.company_id,
    contract_version: request.contract_version,
    arguments: request.arguments,
    ...(request.idempotency_key === undefined
      ? {}
      : { idempotency_key: request.idempotency_key }),
  };
}
export function accountingScope(
  context: Pick<CanonicalContext, "apiTenantId" | "companyId" | "channel">,
) {
  return {
    tenant_id: context.apiTenantId,
    company_id: context.companyId,
    channel: context.channel,
  };
}
const present = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const deny = (): never => {
  throw Error("canonical_accounting_authority_denied");
};

/** Source-only adapter for existing API contracts. It cannot authenticate,
 * consume grants, install registry entries or infer missing authority relations. */
export function canonicalBoundary(
  context: CanonicalContext,
  owners: CanonicalOwners,
  now: () => string,
): Boundary {
  const c = structuredClone(context);
  Object.freeze(c.admission);
  Object.freeze(c);
  if (
    ![c.actorId, c.apiTenantId, c.companyId, c.sessionId].every(present) ||
    !["api", "mcp", "runtime"].includes(c.channel) ||
    !/^[a-f0-9]{64}$/.test(c.contractSha256)
  ) deny();
  return {
    now,
    async authorize(session, request, inputDigest, tx) {
      if (
        session !== c.sessionId || request.company_id !== c.companyId ||
        request.contract_version !== "1"
      ) deny();
      const locked = await owners.lockAuthority(tx, c);
      const stamp = Date.parse(now());
      const admission = locked?.admission;
      if (!locked || !admission) {
        throw Error("canonical_accounting_authority_denied");
      }
      if (
        !locked || !admission || !Number.isFinite(stamp) ||
        locked.actorId !== c.actorId || locked.apiTenantId !== c.apiTenantId ||
        locked.companyId !== c.companyId || locked.sessionId !== c.sessionId ||
        locked.tenantCompanyLinked !== true ||
        locked.operationAllowed !== true ||
        locked.grantConsumed !== true || locked.revoked !== false ||
        !present(locked.policyRef) ||
        !(Date.parse(locked.expiresAt) > stamp) ||
        !(Date.parse(admission.expiresAt) > stamp) ||
        admission.actorId !== c.actorId ||
        admission.operation !== request.operation ||
        (admission.tenantId !== null && admission.tenantId !== c.apiTenantId) ||
        admission.contractSha256 !== c.contractSha256 ||
        !present(admission.admissionId) || !present(admission.grantId) ||
        !present(admission.requestId) ||
        admission.admissionId !== c.admission.admissionId ||
        admission.grantId !== c.admission.grantId ||
        admission.requestId !== c.admission.requestId ||
        await argumentDigest(admission) !== await argumentDigest(c.admission) ||
        admission.inputSha256 !==
          await argumentDigest(accountingPayload(request)) ||
        admission.scopeSha256 !== await argumentDigest(accountingScope(c)) ||
        inputDigest !==
          await argumentDigest({
            operation: request.operation,
            company_id: request.company_id,
            arguments: request.arguments,
            contract_version: request.contract_version,
          })
      ) deny();
      return {
        actor_id: c.actorId,
        tenant_id: c.apiTenantId,
        company_ids: [c.companyId],
        operations: [request.operation],
        policy_ref: locked.policyRef,
        expires_at: new Date(
          Math.min(
            Date.parse(locked.expiresAt),
            Date.parse(admission.expiresAt),
          ),
        ).toISOString(),
      };
    },
    async evidence(actor, company, source, tx) {
      if (
        actor.actor_id !== c.actorId || actor.tenant_id !== c.apiTenantId ||
        company !== c.companyId
      ) return false;
      const file = await owners.lockFile(
        tx,
        actor,
        company,
        structuredClone(source),
      );
      return !!file && file.actorId === actor.actor_id &&
        file.apiTenantId === actor.tenant_id &&
        file.companyId === company && file.allowed === true &&
        file.revoked === false && file.deleted === false &&
        await argumentDigest(file.source) === await argumentDigest(source);
    },
  };
}
