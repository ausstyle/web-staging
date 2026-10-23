/** Normal Owner sign-in for the protected acceptance runner. No Auth-admin
 * issuance, password resets, refresh-token persistence or role changes. */
export const ownerAuthBase = "https://zmqlyygzqoidkcwdysok.supabase.co";
export const ownerAcceptanceId = "ffba8e24-f452-44c8-ba9d-228b8657e3cc";
const management = "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok";
type Obj = Record<string, any>;
export type OwnerCredential = {
  version: 1; project: "zmqlyygzqoidkcwdysok"; purpose: "sandy-gcp-admin-read-acceptance";
  email: string; password: string; issued_at: string; expires_at: string;
};
export function parseOwnerCredential(raw: string, now = Date.now()): OwnerCredential {
  let c: Obj;
  try { c = JSON.parse(raw); } catch { throw Error("owner_credential_invalid"); }
  if (!c || Array.isArray(c) || Object.keys(c).sort().join(",") !==
    "email,expires_at,issued_at,password,project,purpose,version" || c.version !== 1 ||
    c.project !== "zmqlyygzqoidkcwdysok" || c.purpose !== "sandy-gcp-admin-read-acceptance" ||
    typeof c.email !== "string" || c.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) ||
    typeof c.password !== "string" || c.password.length < 6 || c.password.length > 1024 ||
    typeof c.issued_at !== "string" || typeof c.expires_at !== "string") throw Error("owner_credential_invalid");
  const issued = Date.parse(c.issued_at), expiry = Date.parse(c.expires_at);
  if (!Number.isFinite(issued) || !Number.isFinite(expiry) || issued > now + 60000 || expiry <= now ||
    expiry <= issued || expiry - issued > 7 * 86400000) throw Error("owner_credential_expired_or_window_invalid");
  return c as OwnerCredential;
}

if (import.meta.main) {
  if (Deno.args.length !== 1 || Deno.args[0] !== "--check") throw Error("owner_credential_check_only");
  parseOwnerCredential(Deno.env.get("SANDY_OWNER_ACCEPTANCE_CREDENTIAL") ?? "");
  console.log("Owner acceptance credential window validated; no provider request made.");
}
export function freshSessionClaims(token: string, now: number) {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (p.sub !== ownerAcceptanceId || p.role !== "authenticated" || p.aud !== "authenticated" ||
      p.iss !== ownerAuthBase + "/auth/v1" || typeof p.session_id !== "string" ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.session_id) ||
      !Number.isInteger(p.exp) || p.exp * 1000 <= now + 120000 || p.exp * 1000 > now + 3610000)
      throw Error();
    return { sessionId: p.session_id as string, expiresAt: p.exp * 1000 };
  } catch { throw Error("owner_session_claims_invalid"); }
}
/** Claims are only input validation. Independent /user verification AND current
 * Controller membership are required before returning any authenticated token. */
export function createOwnerAcceptanceAuth(options: {
  credential: string; anon: string; management: string; request: typeof fetch;
  now?: () => number; mask?: (secret: string) => void; report: Obj;
}) {
  const now = options.now ?? Date.now, report = options.report;
  let current: { token: string; sessionId: string; expiresAt: number } | undefined;
  let cleanupToken: string | undefined, cleanupSession: string | undefined;
  const send = async (path: string, token: string, body?: Obj) => options.request(ownerAuthBase + path, {
    method: body ? "POST" : "GET", redirect: "error",
    headers: { apikey: options.anon, authorization: "Bearer " + token, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const query = async (sql: string) => {
    const r = await options.request(management + "/database/query", { method: "POST", redirect: "error",
      headers: { authorization: "Bearer " + options.management, "content-type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: true }) });
    if (!r.ok) throw Error("owner_authority_readback_unavailable");
    return await r.json();
  };
  const retire = async () => {
    current = undefined;
    if (!cleanupToken) return;
    const response = await options.request(ownerAuthBase + "/auth/v1/logout?scope=local", {
      method: "POST", redirect: "error", headers: { apikey: options.anon, authorization: "Bearer " + cleanupToken },
    });
    report.Owner_session_retirement_http_status = response.status;
    if (!response.ok) throw Error("owner_session_retirement_failed");
    await response.body?.cancel();
    if (!cleanupSession) throw Error("owner_session_retirement_readback_unavailable");
    const rows = await query(`SELECT count(*)::integer AS remaining FROM auth.sessions WHERE id='${cleanupSession}'::uuid AND user_id='${ownerAcceptanceId}'::uuid`);
    if (rows?.[0]?.remaining !== 0) throw Error("owner_session_retirement_readback_failed");
    report.normal_Auth_session_retired = true;
    report.Owner_session_retirement_independently_verified = true;
    // Supabase logout revokes the refresh session; an already issued JWT can
    // remain valid until exp. Never claim immediate access-token revocation.
    report.access_JWT_immediate_revocation_claimed = false;
    cleanupToken = cleanupSession = undefined;
  };
  return {
    retire,
    async get() {
      const credential = parseOwnerCredential(options.credential, now());
      if (current && current.expiresAt > now() + 120000) return current.token;
      await retire();
      options.mask?.(credential.password);
      report.authentication_method = "normal_password_grant_fresh_session";
      const signed = await send("/auth/v1/token?grant_type=password", options.anon,
        { email: credential.email, password: credential.password });
      report.Owner_sign_in_http_status = signed.status;
      if (!signed.ok) {
        const denied = await signed.json().catch(() => ({}));
        const code = denied.error_code ?? denied.code;
        report.Owner_sign_in_error = ["invalid_credentials", "email_not_confirmed", "user_banned", "over_request_rate_limit", "captcha_failed"].includes(code) ? code : "authentication_rejected";
        throw Error("owner_normal_sign_in_failed");
      }
      const value = await signed.json();
      if (typeof value.access_token !== "string" || value.token_type?.toLowerCase() !== "bearer") throw Error("owner_session_response_invalid");
      options.mask?.(value.access_token);
      if (typeof value.refresh_token === "string") options.mask?.(value.refresh_token);
      cleanupToken = value.access_token;
      report.normal_Auth_session_retired = false;
      // Extract only for cleanup first; malformed claims cannot authorize access.
      try {
        const p = JSON.parse(atob(value.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (typeof p.session_id === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.session_id)) cleanupSession = p.session_id;
      } catch { /* retirement still attempted on validation failure */ }
      const claims = freshSessionClaims(value.access_token, now());
      const verified = await send("/auth/v1/user", value.access_token);
      report.normal_Auth_http_status = verified.status;
      if (!verified.ok) { await verified.body?.cancel(); throw Error("owner_normal_Auth_verification_failed"); }
      const user = await verified.json();
      if (user.id !== ownerAcceptanceId || user.email?.toLowerCase() !== credential.email.toLowerCase() ||
        !user.email_confirmed_at || user.app_metadata?.sandy_engineering_test === true)
        throw Error("owner_identity_verification_failed");
      const owners = await query(`SELECT count(*)::integer AS enabled_owner, (SELECT count(*)::integer FROM auth.mfa_factors WHERE user_id='${ownerAcceptanceId}'::uuid AND status='verified') AS verified_mfa FROM public.sandy_controller_admins WHERE auth_user_id='${ownerAcceptanceId}'::uuid AND enabled AND role='owner'`);
      if (owners?.[0]?.enabled_owner !== 1) throw Error("current_owner_authority_required");
      // Fail closed if MFA is enabled; do not downgrade or create an AAL1 path.
      if (owners?.[0]?.verified_mfa !== 0 || Array.isArray(user.factors) && user.factors.some((f: Obj) => f.status === "verified")) throw Error("owner_MFA_interactive_sign_in_required");
      current = { token: value.access_token, ...claims };
      report.normal_Auth_user_verified = true;
      report.current_Owner_membership_verified = true;
      report.Owner_access_token_expires_at = new Date(claims.expiresAt).toISOString();
      report.Owner_credential_use_expires_at = credential.expires_at;
      report.refresh_token_persisted = false;
      report.fresh_Owner_sessions_issued = (report.fresh_Owner_sessions_issued ?? 0) + 1;
      return current.token;
    },
  };
}
