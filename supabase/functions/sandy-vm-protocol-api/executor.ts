/** Shared governed execution service. Original operation/admission stay intact. */
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import {
  bytesDigest,
  encode64,
} from "../sandy-provider-supplement-api/runtime.ts";
import {
  type Binding,
  type Obj,
  obj,
  parseBindings,
  privateAuthentication,
  type VmName,
  VMS,
} from "./bindings.ts";
import { providerCalls, verifyVm } from "./compute.ts";
import { ProtocolRefusal } from "./errors.ts";
import { withEphemeralOsLogin } from "./oslogin.ts";
import { type SshEndpoint, sshExecute, type SshResult } from "./ssh.ts";
import { winrmExecute, type WinrmResult } from "./winrm.ts";
import type { WinrmEndpoint } from "./tls_http.ts";
export type ProtocolExecution = {
  actorId: string;
  admissionId: string;
  operation: string;
  argumentsCanonical: string;
  scopeCanonical: string;
  vmName: VmName;
  commandRef?: string;
  expectedCommandSha256?: string;
  expectedRecipeSha256?: string;
};
export type ProtocolDependencies = {
  resolveExecution: (context: ProtocolExecution) => Promise<unknown>;
  claimExecution: (context: ProtocolExecution) => Promise<void>;
  credentialForExecution: (
    context: { actorId: string; admissionId: string; operation: string },
  ) => Promise<string>;
  privateAuthentication: () => string | undefined;
  saveResult: (
    context: ProtocolExecution,
    result: {
      payload_base64: string;
      payload_sha256: string;
      byte_length: number;
      command_sha256: string;
      public_metadata: Obj;
    },
  ) => Promise<unknown>;
  fetch?: typeof fetch;
  sshExecute?: typeof sshExecute;
  winrmExecute?: typeof winrmExecute;
};
/** The caller already consumed the ORIGINAL exact owner grant. SQL verifies that fact again. */
export async function executeRegisteredProtocol(
  deps: ProtocolDependencies,
  context: ProtocolExecution,
): Promise<Obj> {
  const resolved = await deps.resolveExecution(context);
  if (
    !obj(resolved) || resolved.vm_name !== context.vmName ||
    typeof resolved.command !== "string" ||
    typeof resolved.command_sha256 !== "string" || !obj(resolved.binding)
  ) throw new ProtocolRefusal("vm_protocol_scoped_resolution_required");
  const bindings = parseBindings(
      JSON.stringify({ [context.vmName]: resolved.binding }),
    ),
    binding = bindings?.[context.vmName];
  if (!binding || !Object.hasOwn(VMS, context.vmName)) {
    throw new ProtocolRefusal("verified_vm_protocol_binding_required");
  }
  const command = resolved.command,
    commandSha = await bytesDigest(new TextEncoder().encode(command));
  if (
    commandSha !== resolved.command_sha256 ||
    context.expectedCommandSha256 &&
      context.expectedCommandSha256 !== commandSha ||
    context.expectedRecipeSha256 &&
      resolved.recipe_sha256 !== context.expectedRecipeSha256
  ) throw new ProtocolRefusal("registered_vm_command_integrity_required");
  const protocol = context.operation === "gcp.vm.winrm.exec" ||
      context.operation !== "gcp.vm.ssh.exec" &&
        context.vmName === "sandy-windows"
    ? "winrm"
    : "ssh";
  if (!binding[protocol]) {
    throw new ProtocolRefusal("verified_vm_protocol_binding_required");
  }
  // A durable one-use attempt precedes provider identity writes and all remote
  // commands. Neither a lost acknowledgement nor a second factory caller retries.
  await deps.claimExecution(context);
  let token: string;
  try {
    token = await deps.credentialForExecution(context);
  } catch {
    throw new ProtocolRefusal("vm_provider_credential_unavailable");
  }
  if (!token) throw new ProtocolRefusal("vm_provider_credential_unavailable");
  const calls = providerCalls(token, deps.fetch),
    proof = await verifyVm(
      context.vmName,
      calls,
      protocol === "ssh" && binding.ssh?.mode === "oslogin",
    );
  // Recheck the same binding and immutable command after provider metadata proof.
  const current = await deps.resolveExecution(context);
  if (
    !obj(current) || !obj(current.binding) ||
    current.binding.version !== binding.version ||
    current.command_sha256 !== commandSha ||
    canonicalJson(current.binding) !== canonicalJson(resolved.binding)
  ) throw new ProtocolRefusal("vm_protocol_binding_changed_during_execution");
  let result: SshResult | WinrmResult, cleanup: true | null = null;
  if (protocol === "ssh") {
    if (binding.ssh!.mode === "oslogin") {
      result = await withEphemeralOsLogin(
        calls,
        proof.address,
        binding.ssh!.host_key_sha256,
        (endpoint) => (deps.sshExecute ?? sshExecute)(endpoint, command),
      );
      cleanup = true;
    } else {
      const auth = privateAuthentication(
        deps.privateAuthentication(),
        context.vmName,
        binding,
      );
      if (!auth.privateKey) {
        throw new ProtocolRefusal(
          "private_ssh_authentication_binding_required",
        );
      }
      const endpoint: SshEndpoint = {
        address: proof.address,
        port: 22,
        username: auth.username,
        privateKey: auth.privateKey,
        hostKeySha256: binding.ssh!.host_key_sha256,
      };
      result = await (deps.sshExecute ?? sshExecute)(endpoint, command);
    }
  } else {
    const auth = privateAuthentication(
      deps.privateAuthentication(),
      context.vmName,
      binding,
    );
    if (!auth.password) {
      throw new ProtocolRefusal(
        "private_winrm_authentication_binding_required",
      );
    }
    const endpoint: WinrmEndpoint = {
      address: proof.address,
      port: 5986,
      serverName: binding.winrm!.server_name,
      certificatePem: binding.winrm!.certificate_pem,
      certificateSha256: binding.winrm!.certificate_sha256,
      username: auth.username,
      password: auth.password,
    };
    result = await (deps.winrmExecute ?? winrmExecute)(endpoint, command);
  }
  const stdoutSha = await bytesDigest(result.stdout),
    stderrSha = await bytesDigest(result.stderr),
    payload = new TextEncoder().encode(
      canonicalJson({
        protocol: result.protocol,
        exit_code: result.exit_code,
        command_sha256: commandSha,
        stdout_base64: encode64(result.stdout),
        stderr_base64: encode64(result.stderr),
      }),
    ),
    payloadSha = await bytesDigest(payload);
  const publicMetadata: Obj = {
    vm_name: context.vmName,
    instance_id: VMS[context.vmName].instance_id,
    protocol: result.protocol,
    exit_code: result.exit_code,
    command_succeeded: result.exit_code === 0,
    effect_confirmed: false,
    command_sha256: commandSha,
    stdout_bytes: result.stdout.length,
    stdout_sha256: stdoutSha,
    stderr_bytes: result.stderr.length,
    stderr_sha256: stderrSha,
    binding_id: binding.version,
    vm_proof_sha256: proof.proof_sha256,
    credential_cleanup_verified: cleanup,
    shell_deleted: result.protocol === "winrm_https" ? true : null,
  };
  let receipt: unknown;
  try {
    receipt = await deps.saveResult(context, {
      payload_base64: encode64(payload),
      payload_sha256: payloadSha,
      byte_length: payload.length,
      command_sha256: commandSha,
      public_metadata: publicMetadata,
    });
  } catch {
    throw new ProtocolRefusal("vm_result_custody_outcome_unknown", true);
  }
  if (
    !obj(receipt) || typeof receipt.custody_id !== "string" ||
    receipt.sha256 !== payloadSha || receipt.byte_length !== payload.length
  ) throw new ProtocolRefusal("vm_result_custody_outcome_unknown", true);
  return {
    ...publicMetadata,
    custody_id: receipt.custody_id,
    output_sha256: payloadSha,
  };
}
