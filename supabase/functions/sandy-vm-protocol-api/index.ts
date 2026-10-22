/** Approved actual-owner protocol execution; service bearer is transport identity. */
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { X509Certificate } from "node:crypto";
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import { createCredentialConsumer } from "../_shared/sandy_credential_consumer.ts";
import {
  createMachineAccessToken,
  type MachineAuth,
} from "../_shared/sandy_machine_identity.ts";
import { normalizePrivateFinishReceipt } from "../_shared/sandy_finish_receipt.ts";
import {
  argumentDigest,
  type Finish,
  type Policy,
  refusal,
  requestJson,
  response,
  UUID,
  validate,
} from "../sandy-provider-supplement-api/runtime.ts";
import {
  type Bindings,
  type Obj,
  obj,
  parseBindings,
  type VmName,
  VMS,
} from "./bindings.ts";
import {
  type Contract,
  protocolContractMatches,
  protocolContracts,
  protocolExecutionScope,
} from "./contracts.ts";
import { providerCalls, verifyVm } from "./compute.ts";
import { ProtocolRefusal } from "./errors.ts";
import {
  executeRegisteredProtocol,
  type ProtocolDependencies,
  type ProtocolExecution,
} from "./executor.ts";
import { verifySshEndpointIdentity } from "./ssh.ts";
import { verifyWinrmEndpointIdentity } from "./tls_http.ts";
import { openIapTunnel } from "./iap.ts";
export type Context = {
  actor_id: string;
  tenant_id: null;
  credential_id: null;
  request_id: string;
  grant_id: string;
  admission_id?: string;
  operation: string;
  arguments: Obj;
};
export type ProtocolHandlerDependencies = ProtocolDependencies & {
  service: string;
  publicBindings: (actor: string) => Promise<Bindings | undefined>;
  authorizeContext: (
    context: Context,
    op: Contract,
    scope: Obj,
  ) => Promise<Policy>;
  consumeGrant: (
    request: Context & {
      input_sha256: string;
      scope_sha256: string;
      contract_sha256: string;
    },
  ) => Promise<Policy>;
  metadata: (context: ProtocolExecution, proof?: Obj) => Promise<unknown>;
  finishExecution: (
    receipt: Finish & { output_canonical?: string },
  ) => Promise<Policy>;
  verifySshIdentity?: typeof verifySshEndpointIdentity;
  verifyWinrmIdentity?: typeof verifyWinrmEndpointIdentity;
};
export function protocolContractEnabled(row: unknown, op: Contract): boolean {
  return protocolContractMatches(row, op);
}
export function createProtocolHandler(deps: ProtocolHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return refusal(405, "method_not_allowed");
    if (
      !deps.service ||
      request.headers.get("authorization") !== `Bearer ${deps.service}` ||
      request.headers.has("x-api-key")
    ) return refusal(403, "internal_service_transport_required");
    let value: unknown;
    try {
      value = await requestJson(request, 100000);
    } catch {
      return refusal(400, "invalid_request");
    }
    if (
      !obj(value) || Object.keys(value).some((k) =>
        ![
          "operation",
          "arguments",
          "actor_id",
          "tenant_id",
          "credential_id",
          "request_id",
          "grant_id",
          "admission_id",
        ].includes(k)
      )
    ) return refusal(400, "invalid_request");
    const op = typeof value.operation === "string"
      ? protocolContracts[value.operation]
      : undefined;
    if (!op) return refusal(404, "operation_not_implemented");
    if (!obj(value.arguments) || !validate(op.input_schema, value.arguments)) {
      return refusal(400, "invalid_operation_arguments");
    }
    if (
      value.tenant_id !== null || value.credential_id !== null ||
      [value.actor_id, value.request_id, value.grant_id].some((v) =>
        typeof v !== "string" || !UUID.test(v)
      ) ||
      value.admission_id !== undefined &&
        (typeof value.admission_id !== "string" ||
          !UUID.test(value.admission_id))
    ) return refusal(403, "actual_owner_session_admission_required");
    const context = value as Context, args = value.arguments;
    let scope: Obj, bindings: Bindings | undefined;
    try {
      // This service-only lookup exposes public pins only; SQL independently requires
      // an actual confirmed current owner and succeeded enrollment evidence.
      if (["ssh", "winrm", "registered_exec"].includes(op.kind)) {
        bindings = await deps.publicBindings(context.actor_id);
      }
      scope = protocolExecutionScope(op.operation, args, bindings);
    } catch {
      return refusal(424, "verified_vm_protocol_binding_required");
    }
    let policy: Policy;
    try {
      policy = await deps.authorizeContext(context, op, scope);
    } catch {
      return refusal(503, "execution_policy_unavailable");
    }
    if (!policy.allowed || policy.reused) {
      return refusal(
        policy.http_status ?? 403,
        policy.error ?? "execution_policy_refused",
      );
    }
    let grant: Policy;
    try {
      grant = await deps.consumeGrant({
        ...context,
        input_sha256: await argumentDigest(args),
        scope_sha256: await argumentDigest(scope),
        contract_sha256: op.contract_sha256,
      });
    } catch {
      return refusal(503, "execution_grant_state_unknown");
    }
    if (
      !grant.allowed || grant.reused || !grant.admission_id ||
      !UUID.test(grant.admission_id)
    ) {
      return refusal(
        grant.http_status ?? 409,
        grant.error ?? "execution_grant_refused",
      );
    }
    const admission = grant.admission_id,
      vm = (args.vm_name ?? args.instance) as VmName;
    const execution: ProtocolExecution = {
      actorId: context.actor_id,
      admissionId: admission,
      operation: op.operation,
      argumentsCanonical: canonicalJson(args),
      scopeCanonical: canonicalJson(scope),
      vmName: vm,
      ...(op.kind === "registered_exec"
        ? { commandRef: String(args.command_ref) }
        : {}),
    };
    const finish = async (outcome: Finish["outcome"], result: unknown) => {
      try {
        const r = await deps.finishExecution({
          admission_id: admission,
          outcome,
          provider_http_status: null,
          provider_request_id: null,
          result_sha256: await argumentDigest(result),
          output_canonical: canonicalJson(result),
        });
        return r.allowed && !r.reused;
      } catch {
        return false;
      }
    };
    try {
      let result: unknown;
      if (["ssh", "winrm", "registered_exec"].includes(op.kind)) {
        result = await executeRegisteredProtocol(deps, execution);
      } else if (op.kind === "binding_enroll") {
        const probeBinding = {
          verified: true,
          instance_id: VMS[vm].instance_id,
          version: admission,
          ...(args.ssh ? { ssh: args.ssh } : {}),
          ...(args.winrm ? { winrm: args.winrm } : {}),
        };
        const parsed = parseBindings(JSON.stringify({ [vm]: probeBinding })),
          binding = parsed?.[vm];
        if (!binding) {
          throw new ProtocolRefusal("fixed_vm_identity_pin_required");
        }
        if (binding.winrm) {
          let cert: X509Certificate;
          try {
            cert = new X509Certificate(binding.winrm.certificate_pem);
          } catch {
            throw new ProtocolRefusal("winrm_certificate_pin_invalid");
          }
          const actual = Array.from(
            new Uint8Array(
              await crypto.subtle.digest("SHA-256", new Uint8Array(cert.raw)),
            ),
            (b) => b.toString(16).padStart(2, "0"),
          ).join("");
          if (
            actual !== binding.winrm.certificate_sha256 ||
            !cert.checkHost(binding.winrm.server_name)
          ) throw new ProtocolRefusal("winrm_certificate_pin_invalid");
        }
        let token: string;
        try {
          token = await deps.credentialForExecution(execution);
        } catch {
          throw new ProtocolRefusal("vm_provider_credential_unavailable");
        }
        if (!token) {
          throw new ProtocolRefusal("vm_provider_credential_unavailable");
        }
        const proof = await verifyVm(
          vm,
          providerCalls(token, deps.fetch),
          binding.ssh?.mode === "oslogin",
        );
        if (binding.ssh) {
          const stream = proof.transport === "iap" ? await (deps.iapTunnel ?? openIapTunnel)(vm, 22, token) : undefined;
          try { await (deps.verifySshIdentity ?? verifySshEndpointIdentity)(
            proof.address,
            22,
            binding.ssh.host_key_sha256,
            stream,
          ); } finally { stream?.destroy(); }
        }
        if (binding.winrm) {
          await (deps.verifyWinrmIdentity ?? verifyWinrmEndpointIdentity)({
            ...(proof.transport === "iap" ? { openStream: () => (deps.iapTunnel ?? openIapTunnel)(vm, 5986, token) } : {}),
            address: proof.address,
            port: 5986,
            serverName: binding.winrm.server_name,
            certificatePem: binding.winrm.certificate_pem,
            certificateSha256: binding.winrm.certificate_sha256,
          });
        }
        result = await deps.metadata(execution, {
          vm_proof_sha256: proof.proof_sha256,
          identity_pin_verified: true,
        });
      } else result = await deps.metadata(execution);
      const successful = !obj(result) || result.command_succeeded !== false;
      const output = {
        ok: successful,
        operation: op.operation,
        contract_version: op.contract_version,
        request_state: successful
          ? (op.is_mutation ? "completed" : "observed")
          : "failed",
        executed: true,
        admission_id: admission,
        result,
        reconciliation_required: false,
        ...(!successful ? { error: "remote_command_failed" } : {}),
      };
      if (!validate(op.output_schema, output)) {
        throw new ProtocolRefusal(
          "vm_execution_receipt_contract_unknown",
          true,
        );
      }
      if (!await finish(successful ? "succeeded" : "failed", output)) {
        return refusal(503, "execution_receipt_state_unknown", {
          admission_id: admission,
          request_may_have_executed: true,
        });
      }
      return response(successful ? 200 : 422, output);
    } catch (error) {
      const known = error instanceof ProtocolRefusal,
        unknown = !known || error.mayHaveExecuted,
        code = known ? error.code : "vm_protocol_outcome_unknown";
      const recorded = await finish(unknown ? "unknown" : "failed", {
        error: code,
        cleanup_required: known && error.cleanupRequired,
      });
      return refusal(
        unknown || !recorded ? 503 : 424,
        recorded ? code : "execution_receipt_state_unknown",
        {
          admission_id: admission,
          request_may_have_executed: unknown || !recorded,
          cleanup_required: known && error.cleanupRequired,
        },
      );
    }
  };
}
if (import.meta.main) {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    db = createClient("https://zmqlyygzqoidkcwdysok.supabase.co", service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const rpc = async (name: string, args: Obj) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw Error("private_protocol_state_unavailable");
    return data;
  };
  const sqlContext = (c: ProtocolExecution) => ({
    p_actor: c.actorId,
    p_admission: c.admissionId,
    p_operation: c.operation,
    p_arguments_canonical: c.argumentsCanonical,
    p_scope_canonical: c.scopeCanonical,
  });
  const consumer = createCredentialConsumer({
    db,
    legacy: {
      gcp_access_token: createMachineAccessToken(
        db.auth as unknown as MachineAuth,
      ),
      github_api: () => {
        throw Error("unsupported_consumer");
      },
      supabase_management: () => {
        throw Error("unsupported_consumer");
      },
    },
  });
  Deno.serve(createProtocolHandler({
    service,
    publicBindings: async (actor) =>
      parseBindings(
        JSON.stringify(
          await rpc("sandy_vm_protocol_public_bindings", { p_actor: actor }),
        ),
      ),
    authorizeContext: async (c, _op, scope) =>
      await rpc("sandy_vm_protocol_context", {
        p_context: {
          ...c,
          canonical_arguments: canonicalJson(c.arguments),
          canonical_scope: canonicalJson(scope),
        },
        p_expected_state: "admitted",
      }) as Policy,
    consumeGrant: async (c) =>
      await rpc("sandy_api_consume_execution_grant", {
        p_grant_id: c.grant_id,
        p_actor_id: c.actor_id,
        p_tenant_id: null,
        p_operation: c.operation,
        p_input_sha256: c.input_sha256,
        p_request_id: c.request_id,
        p_contract_sha256: c.contract_sha256,
        p_scope_sha256: c.scope_sha256,
      }) as Policy,
    resolveExecution: (c) =>
      rpc("sandy_vm_protocol_resolve_execution", {
        ...sqlContext(c),
        p_expected_command_sha256: c.expectedCommandSha256 ?? null,
        p_expected_recipe_sha256: c.expectedRecipeSha256 ?? null,
      }),
    claimExecution: async (c) => {
      await rpc("sandy_vm_protocol_claim_execution", sqlContext(c));
    },
    credentialForExecution: (c) =>
      consumer("gcp_access_token", c, async (token) => token),
    privateAuthentication: () => Deno.env.get("SANDY_VM_PROTOCOL_AUTH_JSON"),
    metadata: (c, proof) =>
      rpc("sandy_vm_protocol_metadata", {
        ...sqlContext(c),
        p_proof: proof ?? null,
      }),
    saveResult: (c, result) =>
      rpc("sandy_vm_protocol_save_result", {
        ...sqlContext(c),
        p_result: result,
      }),
    finishExecution: async (r) =>
      normalizePrivateFinishReceipt(
        r,
        await rpc("sandy_vm_protocol_finish", {
          p_admission_id: r.admission_id,
          p_outcome: r.outcome,
          p_result_sha256: r.result_sha256,
          p_output_canonical: r.output_canonical ?? null,
        }),
      ),
  }));
}
