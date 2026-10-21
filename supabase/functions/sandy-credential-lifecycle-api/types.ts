/** Private credential phase types and fixed administration scope. */
export const PROJECT = "zmqlyygzqoidkcwdysok",
  GCP_PROJECT = "elaborate-haven-511518-a5",
  REPOSITORY = "ausstyle/web-staging";
export type Target = {
  id: string;
  provider:
    | "github_actions_secret"
    | "supabase_edge_secret"
    | "gcp_secret"
    | "gcp_service_account_key";
  resource: Record<string, any>;
  config_sha256: string;
  scope_sha256: string;
  enabled: boolean;
  verified: boolean;
  active_version_id: string | null;
};
export type Rotation = {
  id: string;
  target_id: string;
  state: string;
  source_operation?: string;
  probe_challenge: string;
  probe_started_at?: string | null;
  provider_version_id: string | null;
  prior_version_id: string | null;
  staged_version_id: string | null;
  verification_admission_id: string | null;
  target_config_sha256: string;
  verification_evidence?: Record<string, unknown>;
  verification_canonical?: string;
};
export type Material = {
  value: string;
  material_sha256: string;
  provider_version_id: string | null;
  version_id: string | null;
};
export type ProviderCredentials = {
  service: string;
  management: string | (() => Promise<string>);
  github: string | (() => Promise<string>);
  gcp: () => Promise<string>;
  fetch?: typeof fetch;
};
export class CredentialProviderError extends Error {
  constructor(
    public code: string,
    public unknown = false,
    public status: number | null = null,
  ) {
    super(code);
  }
}
