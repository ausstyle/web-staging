/** Approved credential custody and provider phases. Material never enters responses. */
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  argumentDigest,
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  createMachineAccessToken,
  type MachineAuth,
} from "../_shared/sandy_machine_identity.ts";
import {
  ConsumerCredentialError,
  type ConsumerExecution,
  createCredentialConsumer,
} from "../_shared/sandy_credential_consumer.ts";
import {
  type CredentialContract,
  credentialContracts,
  credentialExecutionScope,
} from "./contracts.ts";
import {
  createCredentialProviders,
  CredentialProviderError,
  type Material,
  type ProviderCredentials,
  type Rotation,
  type Target,
} from "./providers.ts";
import type {
  ExecutionContext,
  FinishRequest,
  GrantRequest,
  PolicyResult,
} from "../sandy-provider-operation-api/index.ts";
export interface CustodyStore {
  target: (id: string) => Promise<Target | null>;
  rotation: (id: string) => Promise<Rotation | null>;
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<Record<string, any>>;
}
export type CredentialDependencies = {
  service: string;
  store: CustodyStore;
  providers?: ReturnType<typeof createCredentialProviders>;
  providersForExecution?: (
    execution: ConsumerExecution,
  ) => ReturnType<typeof createCredentialProviders>;
  authorize: (
    context: ExecutionContext,
    contract: CredentialContract,
  ) => Promise<PolicyResult>;
  consume: (args: GrantRequest) => Promise<PolicyResult>;
  finish: (args: FinishRequest) => Promise<PolicyResult>;
};
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const reply = (status: number, value: Record<string, unknown>) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const refuse = (status: number, error: string) =>
  reply(status, { ok: false, error, executed: false });
const ajv = new Ajv({ strict: true, allowUnionTypes: true });
for (const [k, v] of Object.entries(fullFormats)) ajv.addFormat(k, v);
const allowedResultKeys = new Set([
  "target_id",
  "rotation_id",
  "version_id",
  "active_version_id",
  "retained_version_id",
  "verification_admission_id",
  "provider_version_id",
  "provider_verified",
  "provider_readback_verified",
  "provider_revocation_observed",
  "previous_credential_revoked",
  "custody_deleted",
  "provider_credential_revoked",
  "encrypted_at_rest",
  "active",
  "material_sha256",
  "target_config_sha256",
  "probe_kind",
  "revocation_scope",
  "issued_tokens_may_remain_valid",
  "atomic_provider_cas",
  "reconciliation_required",
  "effect_confirmed",
  "accepted",
]);
const safeResult = (value: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => allowedResultKeys.has(key)),
  );
function assertProvider(operation: string, target: Target): void {
  const expected = operation.startsWith("github.")
    ? "github_actions_secret"
    : operation.startsWith("supabase.functions.")
    ? "supabase_edge_secret"
    : operation.startsWith("gcp.service_accounts.")
    ? "gcp_service_account_key"
    : operation.startsWith("gcp.secrets.")
    ? "gcp_secret"
    : null;
  if (expected && target.provider !== expected) {
    throw new Error("credential_operation_target_mismatch");
  }
}
export function credentialRegistryAllows(
  row: unknown,
  contract: CredentialContract,
): boolean {
  return object(row) && row.handler === "sandy-credential-lifecycle-api" &&
    row.api_exposed === true && row.verified === true &&
    row.permission_scope === contract.permission_scope &&
    row.is_mutation === contract.is_mutation && object(row.error_contract) &&
    row.error_contract.contract_sha256 === contract.contract_sha256 &&
    row.error_contract.requires_approval === true &&
    row.error_contract.api_key_delegable === false;
}
export function createCredentialLifecycleHandler(deps: CredentialDependencies) {
  return async (req: Request) => {
    if (
      req.method !== "POST" || !deps.service ||
      req.headers.get("authorization") !== `Bearer ${deps.service}`
    ) return refuse(403, "service_authorization_required");
    let body: any;
    try {
      body = await requestJson(req, 1024 * 1024);
    } catch (error) {
      return refuse(
        error instanceof JsonRequestError ? error.status : 400,
        "invalid_request",
      );
    }
    if (
      !object(body) || Object.keys(body).some((k) =>
        ![
          "operation",
          "arguments",
          "actor_id",
          "tenant_id",
          "request_id",
          "grant_id",
          "admission_id",
          "credential_id",
        ].includes(k)
      ) || typeof body.operation !== "string"
    ) return refuse(400, "invalid_request");
    const contract = (await credentialContracts())[body.operation];
    if (!contract) return refuse(404, "operation_not_implemented");
    const args = body.arguments ?? {};
    if (!object(args) || !ajv.validate(contract.input_schema, args)) {
      return refuse(400, "invalid_operation_arguments");
    }
    if (
      ![body.actor_id, body.request_id, body.grant_id].every((v) =>
        typeof v === "string" && UUID.test(v)
      ) || body.tenant_id !== null ||
      body.credential_id !== undefined && body.credential_id !== null
    ) return refuse(403, "normal_owner_scoped_execution_required");
    const context = body as ExecutionContext;
    let target: Target;
    let scope: Record<string, unknown>;
    try {
      const value = await deps.store.target(args.target_id);
      if (!value) return refuse(424, "verified_credential_target_required");
      target = value;
      assertProvider(contract.operation, target);
      scope = await credentialExecutionScope(target);
    } catch {
      return refuse(424, "verified_credential_target_required");
    }
    let authorization: PolicyResult;
    try {
      authorization = await deps.authorize(context, contract);
    } catch {
      return refuse(503, "credential_policy_unavailable");
    }
    if (!authorization.allowed || authorization.reused) {
      return refuse(
        authorization.http_status ?? 403,
        authorization.error ?? "credential_policy_refused",
      );
    }
    let grant: PolicyResult;
    try {
      grant = await deps.consume({
        ...context,
        operation: contract.operation,
        input_sha256: await argumentDigest(args),
        scope_sha256: await argumentDigest(scope),
        contract_sha256: contract.contract_sha256,
      });
    } catch {
      return refuse(503, "execution_grant_state_unknown");
    }
    if (
      !grant.allowed || grant.reused || !grant.admission_id ||
      !UUID.test(grant.admission_id)
    ) {
      return refuse(
        grant.http_status ?? 409,
        grant.error ?? "execution_grant_refused",
      );
    }
    const admission = grant.admission_id;
    let rotation: Rotation | null = null;
    let producedProviderVersion: string | null = null;
    let producedProviderMaterial = false;
    let custodyMutationStarted = false;
    let observationRecorded = false;
    const finish = async (
      outcome: FinishRequest["outcome"],
      result: Record<string, unknown>,
      status: number | null = null,
    ) => {
      try {
        return (await deps.finish({
          admission_id: admission,
          outcome,
          provider_http_status: status,
          provider_request_id: null,
          result_sha256: await argumentDigest(result),
        })).allowed;
      } catch {
        return false;
      }
    };
    const rpc = async (name: string, extra: Record<string, unknown> = {}) => {
      if (
        !["sandy_credential_material", "sandy_credential_revoke_material"]
          .includes(name)
      ) custodyMutationStarted = true;
      const data = await deps.store.rpc(name, {
        p_actor: context.actor_id,
        p_admission: admission,
        ...extra,
      });
      if (data.ok !== true) throw new Error("credential_custody_refused");
      return data;
    };
    const loadRotation = async (id: string): Promise<Rotation> => {
      const value = await deps.store.rotation(id);
      if (
        !value || value.target_id !== target.id ||
        value.target_config_sha256 !== target.config_sha256
      ) throw new Error("credential_rotation_not_bound");
      return value;
    };
    const material = async (slot: string): Promise<Material> => {
      const value = await rpc("sandy_credential_material", {
        p_rotation: rotation!.id,
        p_slot: slot,
      });
      if (
        typeof value.value !== "string" ||
        typeof value.material_sha256 !== "string"
      ) throw new Error("credential_material_unavailable");
      return value as Material;
    };
    let result: Record<string, any>;
    try {
      const providers = deps.providersForExecution?.({
        actorId: context.actor_id,
        admissionId: admission,
        operation: contract.operation,
      }) ?? deps.providers;
      if (!providers) {
        throw new ConsumerCredentialError(
          "consumer_execution_context_required",
        );
      }
      if (contract.operation === "supabase.vault.secrets.create_version") {
        result = safeResult(
          await rpc("sandy_credential_store_version", {
            p_target: target.id,
            p_material: args.value,
          }),
        );
      } else if (contract.operation === "supabase.vault.secrets.delete") {
        result = safeResult(
          await rpc("sandy_credential_delete_staged", {
            p_target: target.id,
            p_version: args.version_id,
          }),
        );
      } else if (contract.operation === "system.credentials.provider.verify") {
        rotation = await loadRotation(args.rotation_id);
        const staged = await material("staged");
        const observed = await providers.verify(target, rotation, staged);
        result = {
          rotation_id: rotation.id,
          target_id: target.id,
          material_sha256: staged.material_sha256,
          target_config_sha256: target.config_sha256,
          provider_verified: true,
          provider_version_id: observed.provider_version_id,
          probe_kind: observed.probe_kind,
          atomic_provider_cas: false,
        };
        if (
          !ajv.validate(
            (contract.output_schema as any).properties.result,
            result,
          )
        ) {
          throw new Error("credential_result_contract_mismatch");
        }
        if (!await finish("succeeded", result, 200)) {
          return reply(503, {
            ok: false,
            error: "execution_receipt_state_unknown",
            admission_id: admission,
            executed: true,
            reconciliation_required: true,
          });
        }
        observationRecorded = true;
        await rpc("sandy_credential_record_verification", {
          p_rotation: rotation.id,
          p_evidence: result,
          p_canonical: canonicalJson(result),
        });
        return reply(200, {
          ok: true,
          operation: contract.operation,
          contract_version: "1.0.0",
          admission_id: admission,
          executed: true,
          request_state: "observed",
          result,
        });
      } else if (
        contract.operation === "system.credentials.provider.reconcile"
      ) {
        rotation = await loadRotation(args.rotation_id);
        if (
          !["unknown", "accepted", "verified", "cleanup_claimed"].includes(
            rotation.state,
          )
        ) {
          throw new Error("credential_reconciliation_not_required");
        }
        if (!rotation.staged_version_id) {
          if (
            target.provider === "gcp_service_account_key" &&
            ![
              "system.credentials.provider.adopt",
              "system.credentials.provider.rollback",
            ].includes(rotation.source_operation ?? "")
          ) {
            if (!rotation.provider_version_id) {
              throw new Error("credential_provider_resource_identity_unknown");
            }
            const binding = await rpc("sandy_credential_claim_unstaged_key", {
              p_rotation: rotation.id,
            });
            if (
              binding.claimed !== true ||
              typeof binding.provider_version_id !== "string" ||
              binding.provider_version_id !== rotation.provider_version_id
            ) throw new Error("credential_unstaged_key_identity_unconfirmed");
            await providers.cleanupUnstagedKey(
              target,
              binding.provider_version_id,
              binding.dispatch_allowed === true,
            );
            result = safeResult(
              await rpc("sandy_credential_resolve_unstaged_key", {
                p_rotation: rotation.id,
              }),
            );
          } else {
            const source = await material("source");
            const observedVersion =
              target.provider === "gcp_service_account_key"
                ? (await providers.verify(target, rotation, source))
                  .provider_version_id
                : target.provider === "gcp_secret"
                ? (await providers.secretAccess(
                  target,
                  String(target.resource.name) + "/versions/latest",
                  source.material_sha256,
                )).version
                : await providers.hiddenMetadata(target);
            const stored = await rpc("sandy_credential_stage", {
              p_rotation: rotation.id,
              p_material: source.value,
              p_provider_version: observedVersion,
            });
            rotation = await loadRotation(rotation.id);
            result = {
              target_id: target.id,
              rotation_id: rotation.id,
              version_id: stored.version_id,
              provider_version_id: observedVersion,
              reconciliation_required: true,
            };
          }
        } else {result = {
            target_id: target.id,
            rotation_id: rotation.id,
            version_id: rotation.staged_version_id,
            provider_version_id: rotation.provider_version_id,
            reconciliation_required: true,
          };}
        if (
          target.provider === "github_actions_secret" &&
          rotation.staged_version_id
        ) {
          const probe = await rpc("sandy_credential_probe_start", {
            p_rotation: rotation.id,
          });
          if (probe.started === true) {
            await providers.dispatchProbe(target, rotation);
          }
        }
      } else if (
        contract.operation === "system.credentials.provider.activate"
      ) {
        rotation = await loadRotation(args.rotation_id);
        if (
          rotation.state !== "verified" ||
          rotation.verification_admission_id !==
            args.verification_admission_id ||
          !rotation.verification_evidence ||
          typeof rotation.verification_canonical !== "string"
        ) throw new Error("credential_live_readback_required");
        await providers.verify(target, rotation, await material("staged"));
        result = safeResult(
          await rpc("sandy_credential_activate", {
            p_rotation: rotation.id,
            p_verification_admission: args.verification_admission_id,
            p_evidence: rotation.verification_evidence,
            p_evidence_canonical: rotation.verification_canonical,
          }),
        );
      } else if (contract.operation === "system.credentials.provider.revoke") {
        rotation = await loadRotation(args.verification_rotation_id);
        if (
          rotation.state !== "activated" ||
          rotation.staged_version_id !== target.active_version_id ||
          args.version_id === target.active_version_id
        ) throw new Error("active_credential_cannot_be_revoked");
        const active = await rpc("sandy_credential_revoke_material", {
          p_target: target.id,
          p_version: target.active_version_id,
        });
        const prior = await rpc("sandy_credential_revoke_material", {
          p_target: target.id,
          p_version: args.version_id,
        });
        if (active.provider_version_id === prior.provider_version_id) {
          throw new Error("active_provider_credential_cannot_be_revoked");
        }
        await providers.verify(target, rotation, active as Material);
        await providers.revoke(target, prior as Material);
        result = {
          ...safeResult(
            await rpc("sandy_credential_record_revocation", {
              p_target: target.id,
              p_version: args.version_id,
            }),
          ),
          revocation_scope: target.provider === "gcp_service_account_key"
            ? "new_key_authentication"
            : "secret_version_access",
          issued_tokens_may_remain_valid:
            target.provider === "gcp_service_account_key",
        };
      } else {
        let sourceVersion = args.source_version_id ?? null;
        if (contract.operation === "system.credentials.provider.rollback") {
          const original = await loadRotation(args.rollback_rotation_id);
          if (
            original.state !== "activated" ||
            target.active_version_id !== original.staged_version_id ||
            !original.prior_version_id
          ) throw new Error("credential_rollback_preimage_changed");
          sourceVersion = original.prior_version_id;
        }
        const claim = await rpc("sandy_credential_begin", {
          p_operation: contract.operation,
          p_target: target.id,
          p_source_version: sourceVersion,
          p_scope_sha256: target.scope_sha256,
        });
        if (claim.reused === true) {
          return reply(409, {
            ok: false,
            error: "credential_rotation_already_recorded",
            executed: false,
            admission_id: admission,
            rotation_id: claim.rotation_id,
            redispatch_permitted: false,
          });
        }
        rotation = await loadRotation(claim.rotation_id);
        let next: { value: string; provider_version_id: string };
        if (contract.operation === "gcp.secrets.access") {
          const observed = await providers.secretAccess(
            target,
            String(target.resource.name) + "/versions/latest",
          );
          next = {
            value: observed.value,
            provider_version_id: observed.version,
          };
        } else if (contract.operation === "system.credentials.provider.adopt") {
          const source = await material("source");
          const version = target.provider === "github_actions_secret" ||
              target.provider === "supabase_edge_secret"
            ? await providers.hiddenMetadata(target)
            : (await providers.verify(target, rotation, source))
              .provider_version_id;
          next = { value: source.value, provider_version_id: version };
        } else {
          const prior = rotation.prior_version_id
            ? await material("prior")
            : null;
          if (!prior && contract.operation !== "gcp.secrets.create_version") {
            throw new CredentialProviderError(
              "verified_custodied_preimage_required",
            );
          }
          const source = target.provider === "gcp_service_account_key" &&
              contract.operation !== "system.credentials.provider.rollback"
            ? prior!
            : await material("source");
          next = !prior
            ? await providers.createFirstVersion(target, source)
            : contract.operation === "system.credentials.provider.rollback" &&
                target.provider === "gcp_service_account_key"
            ? await providers.restoreKey(target, source)
            : await providers.rotate(target, rotation, source, prior);
        }
        producedProviderVersion = next.provider_version_id;
        producedProviderMaterial =
          contract.operation !== "system.credentials.provider.adopt" &&
          contract.operation !== "gcp.secrets.access";
        const stored = await rpc("sandy_credential_stage", {
          p_rotation: rotation.id,
          p_material: next.value,
          p_provider_version: next.provider_version_id,
        });
        if (target.provider === "github_actions_secret") {
          const probe = await rpc("sandy_credential_probe_start", {
            p_rotation: rotation.id,
          });
          if (probe.started === true) {
            await providers.dispatchProbe(target, rotation);
          }
        }
        result = {
          target_id: target.id,
          rotation_id: rotation.id,
          version_id: stored.version_id,
          provider_version_id: next.provider_version_id,
          accepted: true,
          effect_confirmed: false,
          reconciliation_required: true,
          previous_credential_revoked: false,
          encrypted_at_rest: true,
          atomic_provider_cas: false,
        };
      }
      result = { ...result, accepted: true, effect_confirmed: false };
      if (
        !ajv.validate((contract.output_schema as any).properties.result, result)
      ) throw new Error("credential_result_contract_mismatch");
      if (!await finish("accepted", result, 200)) {
        return reply(503, {
          ok: false,
          error: "execution_receipt_state_unknown",
          admission_id: admission,
          executed: true,
          reconciliation_required: true,
        });
      }
      return reply(200, {
        ok: true,
        operation: contract.operation,
        contract_version: "1.0.0",
        admission_id: admission,
        executed: true,
        request_state: "accepted",
        result,
      });
    } catch (error) {
      if (observationRecorded) {
        return reply(503, {
          ok: false,
          error: "credential_verification_recording_incomplete",
          admission_id: admission,
          executed: true,
          request_state: "observed",
          reconciliation_required: true,
        });
      }
      const code = error instanceof CredentialProviderError ||
          error instanceof ConsumerCredentialError
        ? error.code
        : error instanceof Error &&
            /^credential_[a-z_]+$|^active_[a-z_]+$|^verified_[a-z_]+$/.test(
              error.message,
            )
        ? error.message
        : "credential_execution_failed";
      const unknown = contract.is_mutation &&
        (producedProviderMaterial ||
          error instanceof ConsumerCredentialError &&
            error.requestMayHaveExecuted ||
          error instanceof CredentialProviderError && error.unknown ||
          custodyMutationStarted &&
            !(error instanceof CredentialProviderError) &&
            !(error instanceof ConsumerCredentialError));
      if (!unknown && rotation && contract.is_mutation) {
        try {
          await rpc("sandy_credential_record_failed", {
            p_rotation: rotation.id,
          });
        } catch { /* refusal never permits redispatch */ }
      }
      if (unknown && rotation) {
        try {
          await rpc("sandy_credential_record_unknown", {
            p_rotation: rotation.id,
            p_provider_version: producedProviderVersion,
          });
        } catch { /* the immutable admission still records unknown */ }
      }
      const result = { error: code, reconciliation_required: unknown };
      await finish(
        unknown ? "unknown" : "failed",
        result,
        error instanceof CredentialProviderError ? error.status : null,
      );
      return reply(
        error instanceof ConsumerCredentialError
          ? error.status
          : code === "credential_consumer_probe_pending"
          ? 409
          : 502,
        {
          ok: false,
          error: code,
          admission_id: admission,
          executed: true,
          reconciliation_required: unknown,
          request_state: unknown ? "unknown" : "failed",
        },
      );
    }
  };
}
if (import.meta.main) {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const call = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(name, args);
    if (error || !object(data)) {
      throw new Error("credential_custody_unavailable");
    }
    return data;
  };
  const legacy = {
    supabase_management: () =>
      Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN") ?? "",
    github_api: () =>
      Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN") ??
        Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN") ?? "",
    gcp_access_token: createMachineAccessToken(
      db.auth as unknown as MachineAuth,
    ),
  };
  const withCredential = createCredentialConsumer({ db, legacy });
  Deno.serve(createCredentialLifecycleHandler({
    service,
    providersForExecution: (execution) =>
      createCredentialProviders({
        service,
        management: () =>
          withCredential("supabase_management", execution, (token) =>
            Promise.resolve(token)),
        github: () =>
          withCredential("github_api", execution, (token) =>
            Promise.resolve(token)),
        gcp: () =>
          withCredential("gcp_access_token", execution, (token) =>
            Promise.resolve(token)),
      }),
    store: {
      target: async (id) => {
        const { data, error } = await db.from("sandy_credential_targets")
          .select("*").eq("id", id).maybeSingle();
        if (error) throw new Error("credential_custody_unavailable");
        return data as Target | null;
      },
      rotation: async (id) => {
        const { data, error } = await db.from("sandy_credential_rotations")
          .select("*").eq("id", id).maybeSingle();
        if (error) throw new Error("credential_custody_unavailable");
        return data as Rotation | null;
      },
      rpc: call,
    },
    authorize: async (context, contract) => {
      const [owner, registry] = await Promise.all([
        db.from("sandy_controller_admins").select("role").eq(
          "auth_user_id",
          context.actor_id,
        ).eq("role", "owner").eq("enabled", true).maybeSingle(),
        db.from("sandy_operation_registry").select(
          "handler,permission_scope,api_exposed,verified,is_mutation,error_contract",
        ).eq("operation", contract.operation).maybeSingle(),
      ]);
      const row = registry.data;
      return {
        allowed: !owner.error && !registry.error && !!owner.data &&
          credentialRegistryAllows(row, contract),
      };
    },
    consume: async (r) =>
      await call("sandy_api_consume_execution_grant", {
        p_grant_id: r.grant_id,
        p_actor_id: r.actor_id,
        p_tenant_id: r.tenant_id,
        p_operation: r.operation,
        p_input_sha256: r.input_sha256,
        p_request_id: r.request_id,
        p_contract_sha256: r.contract_sha256,
        p_scope_sha256: r.scope_sha256,
      }) as PolicyResult,
    finish: async (r) => {
      const value = await call("sandy_api_finish_execution", {
        p_admission_id: r.admission_id,
        p_outcome: r.outcome,
        p_provider_http_status: r.provider_http_status,
        p_provider_request_id: r.provider_request_id,
        p_result_sha256: r.result_sha256,
      });
      return {
        allowed: value.ok === true && value.admission_id === r.admission_id &&
          value.state === r.outcome && typeof value.reused === "boolean",
      };
    },
  }));
}
