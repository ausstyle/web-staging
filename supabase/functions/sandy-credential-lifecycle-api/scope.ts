import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { machineScope } from "../_shared/sandy_machine_identity.ts";
import {
  CredentialProviderError,
  GCP_PROJECT,
  PROJECT,
  REPOSITORY,
  type Target,
} from "./types.ts";
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const secretName = (target: Target): string => {
  const name = target.resource.secret_name;
  if (typeof name !== "string" || !/^[A-Z_][A-Z0-9_]{0,99}$/.test(name)) {
    throw new CredentialProviderError("verified_secret_name_binding_required");
  }
  return name;
};
export const gcpSecret = (target: Target): string => {
  const name = target.resource.name;
  if (
    typeof name !== "string" ||
    !new RegExp(
      `^projects/(?:${GCP_PROJECT}|1030223524306)/secrets/[A-Za-z0-9_-]{1,255}$`,
    ).test(name)
  ) {
    throw new CredentialProviderError(
      "verified_secret_resource_binding_required",
    );
  }
  return name.replace(/^projects\/1030223524306\//, `projects/${GCP_PROJECT}/`);
};
export function gcpKey(target: Target, version: string): string {
  if (
    target.resource.service_account !== machineScope.service_account ||
    !new RegExp(
      `^projects/(?:${GCP_PROJECT}|1030223524306|-)/serviceAccounts/${
        machineScope.service_account.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      }/keys/[a-f0-9]{20,64}$`,
    ).test(version)
  ) {
    throw new CredentialProviderError(
      "verified_service_account_key_binding_required",
    );
  }
  return version.replace(
    /^projects\/(?:1030223524306|-)\//,
    `projects/${GCP_PROJECT}/`,
  );
}
export function keyCredential(
  target: Target,
  value: string,
): Record<string, string> {
  let key: any;
  try {
    key = JSON.parse(value);
  } catch {
    throw new CredentialProviderError("custodied_key_format_invalid");
  }
  if (
    !object(key) || key.type !== "service_account" ||
    key.project_id !== GCP_PROJECT ||
    key.client_email !== machineScope.service_account ||
    target.resource.service_account !== machineScope.service_account ||
    key.token_uri !== "https://oauth2.googleapis.com/token" ||
    typeof key.private_key !== "string" ||
    typeof key.private_key_id !== "string" ||
    !/^[a-f0-9]{20,64}$/.test(key.private_key_id)
  ) throw new CredentialProviderError("custodied_key_scope_mismatch");
  return key as Record<string, string>;
}
export function validateTarget(target: Target): void {
  if (
    target.enabled !== true || target.verified !== true ||
    ![
      "github_actions_secret",
      "supabase_edge_secret",
      "gcp_secret",
      "gcp_service_account_key",
    ].includes(target.provider)
  ) {
    throw new CredentialProviderError("verified_credential_target_required");
  }
  const allowed: Record<string, string[]> = {
    github_actions_secret: [
      "secret_name",
      "repository",
      "workflow_id",
      "workflow_ref",
      "workflow_head_sha",
      "source_vault_secret_id",
    ],
    supabase_edge_secret: ["secret_name", "source_vault_secret_id"],
    gcp_secret: ["name", "source_vault_secret_id"],
    gcp_service_account_key: ["service_account", "source_vault_secret_id"],
  };
  if (
    !object(target.resource) ||
    Object.keys(target.resource).some((key) =>
      !allowed[target.provider].includes(key)
    ) ||
    target.resource.source_vault_secret_id !== undefined &&
      (typeof target.resource.source_vault_secret_id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
          .test(target.resource.source_vault_secret_id))
  ) throw new CredentialProviderError("verified_credential_target_required");
  if (target.provider === "gcp_secret") gcpSecret(target);
  else if (target.provider === "gcp_service_account_key") {
    if (target.resource.service_account !== machineScope.service_account) {
      throw new CredentialProviderError(
        "verified_service_account_key_binding_required",
      );
    }
  } else {
    secretName(target);
    if (
      target.provider === "github_actions_secret" &&
      (target.resource.repository !== REPOSITORY ||
        !Number.isSafeInteger(target.resource.workflow_id) ||
        target.resource.workflow_id < 1 ||
        typeof target.resource.workflow_ref !== "string" ||
        !/^[A-Za-z0-9_./-]{1,200}$/.test(target.resource.workflow_ref) ||
        typeof target.resource.workflow_head_sha !== "string" ||
        !/^[a-f0-9]{40}$/.test(target.resource.workflow_head_sha))
    ) {
      throw new CredentialProviderError(
        "verified_github_consumer_probe_required",
      );
    }
  }
}
export async function credentialExecutionScope(
  target: Target,
): Promise<Record<string, unknown>> {
  validateTarget(target);
  const hash = await argumentDigest({
    version: "1.0.0",
    target_id: target.id,
    provider: target.provider,
    resource: target.resource,
  });
  if (hash !== target.config_sha256) {
    throw new Error("credential_target_configuration_integrity_failed");
  }
  const scope = {
    sandy_project_ref: PROJECT,
    gcp_project_id: GCP_PROJECT,
    github_repository: REPOSITORY,
    credential_target_id: target.id,
    credential_provider: target.provider,
    target_config_sha256: target.config_sha256,
  };
  if (await argumentDigest(scope) !== target.scope_sha256) {
    throw new Error("credential_target_scope_integrity_failed");
  }
  return scope;
}
