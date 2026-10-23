/** Header selection AFTER the gateway's normal Auth.getUser and owner checks.
 * Never forwards an API-key/delegated/service identity as a customer session.
 * The receiving handler independently calls Auth.getUser again.
 */
export function functionInvocationSessionHeaders(
  operation: string,
  token: string,
  actor: string,
  credential: unknown,
): Record<string, string> {
  if (
    operation !== "supabase.functions.invoke" || credential ||
    token.length > 10000
  ) return {};
  try {
    const claims = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (
      claims.role !== "authenticated" || claims.aud !== "authenticated" ||
      claims.sub !== actor || claims.is_anonymous === true ||
      claims.app_metadata?.sandy_engineering_test === true ||
      typeof claims.session_id !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(claims.session_id) ||
      !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000
    ) return {};
    return { "x-sandy-user-session": token };
  } catch {
    return {};
  }
}
