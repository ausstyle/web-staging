/** Canonical compatibility entry. The service bearer is transport identity only;
 * original actual-user admission and approval are rechecked by the private SQL. */
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createCredentialConsumer } from "../_shared/sandy_credential_consumer.ts";
import {
  type ExecutionContext,
  normalizeFinishReceipt,
  type PolicyResult,
  type ProviderDependencies,
} from "../sandy-provider-operation-api/index.ts";
import { createLegacyOwnerHandler } from "./owner_handler.ts";
import { createGithubVerificationClient } from "../_shared/sandy_github_verification_client.ts";
export { createLegacyProviderHandler } from "./provider_handler.ts";
if (import.meta.main) {
  const base = "https://zmqlyygzqoidkcwdysok.supabase.co";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(base, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> => {
    const { data, error } = await db.rpc(name, args);
    if (error) {
      return {
        allowed: false,
        error: "execution_policy_unavailable",
        http_status: 503,
      };
    }
    return data as PolicyResult;
  };
  const credentials = createCredentialConsumer({
    db,
    legacy: {
      github_api: () =>
        Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN") ??
          Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN") ?? "",
      supabase_management: () =>
        Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN") ?? "",
      gcp_access_token: () => {
        throw Error("legacy_adapter_has_no_gcp_consumer");
      },
    },
  });
  const authorizeLegacy = (
    context: ExecutionContext,
    operation: { operation: string },
  ) =>
    rpc("sandy_legacy_provider_context", {
      p_context: {
        ...context,
        operation: operation.operation,
        canonical_arguments: canonicalJson(
          (context as unknown as Record<string, unknown>).arguments,
        ),
      },
      p_expected_state: "admitted",
    });
  const providerDependencies: ProviderDependencies = {
    service,
    verifyGithubMutation: createGithubVerificationClient(db),
    authorizeContext: authorizeLegacy,
    consumeGrant: (r) =>
      rpc("sandy_api_consume_execution_grant", {
        p_grant_id: r.grant_id,
        p_actor_id: r.actor_id,
        p_tenant_id: null,
        p_operation: r.operation,
        p_input_sha256: r.input_sha256,
        p_request_id: r.request_id,
        p_contract_sha256: r.contract_sha256,
        p_scope_sha256: r.scope_sha256,
      }),
    finishExecution: async (r) =>
      normalizeFinishReceipt(
        r,
        await rpc("sandy_api_finish_execution", {
          p_admission_id: r.admission_id,
          p_outcome: r.outcome,
          p_provider_http_status: r.provider_http_status,
          p_provider_request_id: r.provider_request_id,
          p_result_sha256: r.result_sha256,
        }),
      ),
    credentialForExecution: (op, execution) =>
      credentials(
        op.provider === "github" ? "github_api" : "supabase_management",
        execution,
        async (token) => token,
      ),
  };
  Deno.serve(createLegacyOwnerHandler(providerDependencies, {
    service,
    authorizeContext: authorizeLegacy,
    consumeGrant: providerDependencies.consumeGrant,
    finishExecution: providerDependencies.finishExecution,
    credentialForExecution: (op, execution) =>
      credentials(
        op.provider === "github" ? "github_api" : "supabase_management",
        execution,
        async (token) => token,
      ),
    saveOpaque: async () => {
      throw Error("legacy_workflows_do_not_capture_opaque_material");
    },
    takeOpaque: async () => {
      throw Error("legacy_workflows_do_not_accept_opaque_handles");
    },
  }));
}
