/** Controller admission for the existing renewable engineering workload. Auth
 * getUser must succeed first. No global Controller role or owner impersonation.
 */
type Obj = Record<string, any>;
export const workloadControlActions = [
  "register",
  "get",
  "list",
  "test",
  "artifact",
] as const;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
export type WorkloadControlGrant = {
  ownerId: string;
  scopePrefixes: string[];
  risks: string[];
};
export async function authorizeWorkloadControl(
  user: Obj,
  token: string,
  body: Obj,
  db: any,
): Promise<WorkloadControlGrant | null> {
  if (
    !uuid(user.id) || user.app_metadata?.sandy_engineering_test !== true ||
    !workloadControlActions.includes(body.action as any)
  ) return null;
  let claims: Obj;
  try {
    claims = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
  } catch {
    return null;
  }
  if (
    !object(claims) || claims.sub !== user.id ||
    claims.role !== "authenticated" || claims.aud !== "authenticated" ||
    claims.is_anonymous === true || !uuid(claims.session_id) ||
    claims.app_metadata?.sandy_engineering_test !== true ||
    !Number.isSafeInteger(claims.app_metadata.sandy_engineering_epoch)
  ) return null;
  const { data, error } = await db.rpc(
    "sandy_engineering_resolve_control_grant",
    {
      p_user_id: user.id,
      p_session_id: claims.session_id,
      p_epoch: claims.app_metadata.sandy_engineering_epoch,
      p_action: body.action,
    },
  );
  if (
    error || !object(data) || data.ok !== true ||
    !uuid(data.owner_authority_id) ||
    !Array.isArray(data.scope_prefixes) ||
    !data.scope_prefixes.every((s: unknown) =>
      typeof s === "string" && s.length > 0
    ) ||
    !Array.isArray(data.allowed_risks) ||
    !data.allowed_risks.every((s: unknown) => typeof s === "string")
  ) return null;
  return {
    ownerId: data.owner_authority_id,
    scopePrefixes: data.scope_prefixes,
    risks: data.allowed_risks,
  };
}
export function workloadRegistrationAllowed(
  body: Obj,
  grant: WorkloadControlGrant,
): boolean {
  return grant.risks.includes(body.risk ?? "normal") &&
    Array.isArray(body.scope) && body.scope.length > 0 &&
    body.scope.length <= 50 &&
    body.scope.every((scope: unknown) =>
      typeof scope === "string" &&
      grant.scopePrefixes.some((prefix) =>
        prefix.endsWith(":")
          ? scope.startsWith(prefix) && scope.length > prefix.length
          : scope === prefix
      )
    );
}
