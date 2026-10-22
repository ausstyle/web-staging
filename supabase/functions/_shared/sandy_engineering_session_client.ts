/** Shared private session issuer wiring for the Edge runtime and release tests.
 * The service client never signs in as a user; Auth uses a separate client. */
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createEngineeringSessionProvider, type EngineeringAuth, type IssuedSession } from "./sandy_engineering_session.ts";
import policy from "../sandy-operation-api/engineering_identity_policy.json" with { type: "json" };

export function createEngineeringSessionClient(base: string, service: string, request: typeof fetch = fetch) {
  if (base !== `https://${policy.project_ref}.supabase.co` || !service) throw Error("engineering_auth_configuration_invalid");
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: request } };
  const db = createClient(base, service, options);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const result = await db.rpc(name, args);
    if (result.error) throw Error("engineering_auth_policy_unavailable");
    return result.data;
  };
  const auth = () => createClient(base, service, options).auth as unknown as EngineeringAuth;
  const sessions = createEngineeringSessionProvider({
    auth,
    register: async (id, session, epoch, expiry) => (await rpc("sandy_engineering_register_session", {
      p_user_id: id, p_session_id: session, p_epoch: epoch, p_expires_at: expiry,
    }))?.ok === true,
    retire: async (id, session) => (await rpc("sandy_engineering_retire_session", {
      p_user_id: id, p_session_id: session,
    }))?.ok === true,
    acquire: async workload => {
      const value = await rpc("sandy_engineering_claim_auth_issue", { p_user_id: workload.userId, p_epoch: workload.epoch });
      if (value?.ok !== true) throw Error("engineering_auth_issue_not_authorized");
      return typeof value.lease_id === "string" ? value.lease_id : null;
    },
    release: async (id, lease) => { await rpc("sandy_engineering_release_auth_issue", { p_user_id: id, p_lease_id: lease }); },
  });
  return {
    get: sessions.get,
    invalidate: sessions.invalidate,
    async retireIssued(session: IssuedSession) {
      sessions.invalidate();
      if ((await rpc("sandy_engineering_retire_session", { p_user_id: session.workload.userId, p_session_id: session.sessionId }))?.ok !== true)
        throw Error("engineering_auth_retirement_failed");
      const result = await auth().admin.signOut?.(session.token, "local");
      if (result?.error) throw Error("engineering_auth_retirement_failed");
    },
  };
}
