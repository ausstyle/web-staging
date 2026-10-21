/** Reuse the existing dedicated machine principal. Never mint a human session. */
export const machineScope = Object.freeze({
  project_id: "elaborate-haven-511518-a5",
  region: "europe-west1",
  zone: "europe-west1-b",
  service_account:
    "sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com",
  audience:
    "//iam.googleapis.com/projects/1030223524306/locations/global/workloadIdentityPools/sandy-supabase/providers/sandy-supabase-auth",
});
const EMAIL = "sandy-gcp-machine@sandy-ai.internal";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
type User = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
};
export interface MachineAuth {
  admin: {
    listUsers(
      args: { page: number; perPage: number },
    ): Promise<{ data: { users: User[] }; error: unknown }>;
    generateLink(
      args: { type: "magiclink"; email: string },
    ): Promise<
      { data: { properties?: { hashed_token?: string } }; error: unknown }
    >;
  };
  verifyOtp(
    args: { type: "magiclink"; token_hash: string },
  ): Promise<
    { data: { session?: { access_token: string } | null }; error: unknown }
  >;
  getUser(
    token: string,
  ): Promise<{ data: { user: User | null }; error: unknown }>;
}
const tagged = (user: User | null | undefined) =>
  user?.email === EMAIL && user.app_metadata?.sandy_gcp_machine === true;
/** A closure holds short-lived provider credentials; tokens are never returned by handlers. */
export function createMachineAccessToken(
  auth: MachineAuth,
  fetcher: typeof fetch = fetch,
): () => Promise<string> {
  let cached: { token: string; expires: number } | undefined;
  let inflight: Promise<string> | undefined;
  async function mint(): Promise<string> {
    const users = await auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (users.error) throw new Error("machine_identity_lookup_failed");
    const candidates = users.data.users.filter(tagged);
    if (candidates.length !== 1) {
      throw new Error("dedicated_machine_identity_required");
    }
    const machine = candidates[0];
    const link = await auth.admin.generateLink({
      type: "magiclink",
      email: EMAIL,
    });
    const hash = link.data.properties?.hashed_token;
    if (link.error || !hash) {
      throw new Error("machine_identity_credential_failed");
    }
    const session = await auth.verifyOtp({
      type: "magiclink",
      token_hash: hash,
    });
    const jwt = session.data.session?.access_token;
    if (session.error || !jwt) {
      throw new Error("machine_identity_credential_failed");
    }
    // Verify at the Auth server; client-asserted/decoded metadata is insufficient.
    const verified = await auth.getUser(jwt);
    if (
      verified.error || !tagged(verified.data.user) ||
      verified.data.user?.id !== machine.id
    ) throw new Error("machine_identity_verification_failed");
    const parts = jwt.split(".");
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      throw new Error("machine_identity_claims_invalid");
    }
    if (
      claims.sub !== machine.id || claims.aud !== "authenticated" ||
      typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000 ||
      !(claims.app_metadata as Record<string, unknown>)?.sandy_gcp_machine
    ) throw new Error("machine_identity_claims_invalid");
    const sts = await fetcher("https://sts.googleapis.com/v1/token", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(22000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        audience: machineScope.audience,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        subject_token: jwt,
        scope: OAUTH_SCOPE,
      }),
    });
    const exchange = await sts.json().catch(() => null);
    if (!sts.ok || !exchange || typeof exchange.access_token !== "string") {
      throw new Error(`machine_federation_rejected_${sts.status}`);
    }
    const access = await fetcher(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${machineScope.service_account}:generateAccessToken`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(22000),
        headers: {
          authorization: `Bearer ${exchange.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ scope: [OAUTH_SCOPE], lifetime: "1800s" }),
      },
    );
    const credential = await access.json().catch(() => null);
    const expires = Date.parse(credential?.expireTime);
    if (
      !access.ok || typeof credential?.accessToken !== "string" ||
      !Number.isFinite(expires) || expires <= Date.now() + 60000
    ) throw new Error(`machine_impersonation_rejected_${access.status}`);
    cached = {
      token: credential.accessToken,
      expires: Math.min(expires, Date.now() + 1800000),
    };
    return cached.token;
  }
  return async () => {
    if (cached && cached.expires > Date.now() + 60000) return cached.token;
    if (!inflight) {
      inflight = mint().finally(() => {
        inflight = undefined;
      });
    }
    return await inflight;
  };
}
