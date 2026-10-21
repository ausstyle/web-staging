/** Closed typed protocol, owner-pinned identity and immutable command contracts. */
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import { approvedOwnerContract } from "../_shared/sandy_approval_contract.ts";
import {
  type Bindings,
  executionScope as transportScope,
  type Obj,
  PROJECT,
  VMS,
  ZONE,
} from "./bindings.ts";
export type Contract = {
  operation: string;
  kind: string;
  handler: string;
  permission_scope: string;
  is_mutation: boolean;
  requires_approval: true;
  requires_grant: true;
  api_key_delegable: false;
  requires_real_user_session: true;
  owner_only: true;
  contract_version: string;
  input_schema: Obj;
  output_schema: Obj;
  contract_sha256: string;
};
const str = (max: number, min = 1) => ({
    type: "string",
    minLength: min,
    maxLength: max,
  }),
  digest = { type: "string", pattern: "^[a-f0-9]{64}$" },
  uuid = {
    type: "string",
    format: "uuid",
    pattern:
      "^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
  },
  vm = { type: "string", enum: Object.keys(VMS) },
  nullable = (v: Obj) => ({ anyOf: [v, { type: "null" }] }),
  object = (props: Obj, required = Object.keys(props)): Obj => ({
    type: "object",
    properties: props,
    required,
    additionalProperties: false,
  });
const definitions: Record<string, Omit<Contract, "contract_sha256">> = {};
const define = (
  operation: string,
  kind: string,
  input: Obj,
  result: Obj,
  mutation: boolean,
  permission = "infrastructure:write",
) => {
  definitions[operation] = {
    operation,
    kind,
    handler: "sandy-vm-protocol-api",
    permission_scope: permission,
    is_mutation: mutation,
    requires_approval: true,
    requires_grant: true,
    api_key_delegable: false,
    requires_real_user_session: true,
    owner_only: true,
    contract_version: ["ssh", "winrm", "registered_exec"].includes(kind) ? "1.1.0" : "1.0.0",
    input_schema: input,
    output_schema: object({
      ok: { type: "boolean" },
      operation: { const: operation },
      contract_version: { const: ["ssh", "winrm", "registered_exec"].includes(kind) ? "1.1.0" : "1.0.0" },
      request_state: { enum: ["completed", "failed", "observed", "accepted"] },
      executed: { const: true },
      admission_id: uuid,
      result,
      error: { const: "remote_command_failed" },
      reconciliation_required: { const: false },
    }, [
      "ok",
      "operation",
      "contract_version",
      "request_state",
      "executed",
      "admission_id",
      "result",
      "reconciliation_required",
    ]),
  };
};
const includeOutput = { type: "boolean", default: false };
const commandInput = object({ vm_name: vm, command: str(4096), include_output: includeOutput }, ["vm_name", "command"]);
const executionResult = object({
  vm_name: vm,
  instance_id: str(30),
  protocol: { enum: ["ssh2", "winrm_https"] },
  exit_code: { type: "integer", minimum: 0, maximum: 2147483647 },
  command_succeeded: { type: "boolean" },
  effect_confirmed: { const: false },
  command_sha256: digest,
  stdout_bytes: { type: "integer", minimum: 0, maximum: 65536 },
  stdout_sha256: digest,
  stderr_bytes: { type: "integer", minimum: 0, maximum: 65536 },
  stderr_sha256: digest,
  custody_id: uuid,
  output_sha256: digest,
  binding_id: uuid,
  vm_proof_sha256: digest,
  credential_cleanup_verified: nullable({ const: true }),
  shell_deleted: nullable({ const: true }),
});
(executionResult.properties as Obj).stdout_base64 = str(87384, 0);
(executionResult.properties as Obj).stderr_base64 = str(87384, 0);
define("gcp.vm.ssh.exec", "ssh", commandInput, executionResult, true);
define(
  "gcp.vm.winrm.exec",
  "winrm",
  object({ vm_name: { const: "sandy-windows" }, command: str(4096), include_output: includeOutput }, ["vm_name", "command"]),
  executionResult,
  true,
);
define(
  "cloud.vm.exec",
  "registered_exec",
  object({
    project_id: { const: PROJECT },
    zone: { const: ZONE },
    instance: vm,
    command_ref: uuid,
    include_output: includeOutput,
  }, ["project_id", "zone", "instance", "command_ref"]),
  executionResult,
  true,
  "infrastructure:execute",
);
const ssh = object({
    mode: { type: "string", enum: ["oslogin", "private_key"] },
    host_key_sha256: { type: "string", pattern: "^SHA256:[A-Za-z0-9+/]{43}$" },
  }),
  winrm = object({
    server_name: {
      ...str(253),
      pattern: "^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$",
    },
    certificate_pem: str(32768),
    certificate_sha256: digest,
  });
const bindingResult = object({
  binding_id: uuid,
  vm_name: vm,
  instance_id: str(30),
  state: { enum: ["owner_pinned", "revoked"] },
  ssh_host_key_sha256: nullable(str(50)),
  winrm_certificate_sha256: nullable(digest),
  enrollment_admission_id: uuid,
  vm_proof_sha256: digest,
});
define(
  "gcp.vm.protocol_bindings.enroll",
  "binding_enroll",
  {
    ...object({ vm_name: vm, ssh, winrm }, ["vm_name"]),
    anyOf: [{ required: ["ssh"] }, { required: ["winrm"] }],
  },
  bindingResult,
  true,
);
define(
  "gcp.vm.protocol_bindings.get",
  "binding_get",
  object({ vm_name: vm }),
  bindingResult,
  false,
);
define(
  "gcp.vm.protocol_bindings.revoke",
  "binding_revoke",
  object({ vm_name: vm, binding_id: uuid }),
  bindingResult,
  true,
);
const allowedRecipeOperations = [
  "cloud.vm.exec",
  "video.install",
  "video.logs",
  "video.restart",
  "video.verify_call",
];
const commandResult = object({
  command_ref: uuid,
  vm_name: vm,
  instance_id: str(30),
  command_sha256: digest,
  allowed_operation: { enum: allowedRecipeOperations },
  recipe_sha256: nullable(digest),
  expires_at: { type: "string", format: "date-time" },
  state: { enum: ["registered", "revoked"] },
});
define(
  "cloud.vm.commands.register",
  "command_register",
  object({
    vm_name: vm,
    command: str(4096),
    expires_in_seconds: {
      type: "integer",
      minimum: 60,
      maximum: 3600,
      default: 600,
    },
    allowed_operation: {
      type: "string",
      enum: allowedRecipeOperations,
      default: "cloud.vm.exec",
    },
    recipe_sha256: digest,
  }, ["vm_name", "command"]),
  commandResult,
  true,
  "infrastructure:execute",
);
define(
  "cloud.vm.commands.get",
  "command_get",
  object({ command_ref: uuid }),
  commandResult,
  false,
  "infrastructure:execute",
);
define(
  "cloud.vm.commands.revoke",
  "command_revoke",
  object({ command_ref: uuid }),
  commandResult,
  true,
  "infrastructure:execute",
);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const protocolContracts = freeze(
  Object.fromEntries(
    await Promise.all(
      Object.entries(definitions).map(async (
        [id, op],
      ) => [
        id,
        Object.freeze({ ...op, contract_sha256: await argumentDigest(op) }),
      ]),
    ),
  ),
) as Readonly<Record<string, Contract>>;
export const protocolOperations = protocolContracts;
export function protocolContractMatches(row: unknown, op: Contract): boolean {
  const r = row as Obj | null;
  try {
    return approvedOwnerContract(row, op) && !!r &&
      r.permission_scope === op.permission_scope &&
      typeof r.error_contract === "object" && r.error_contract !== null &&
      (r.error_contract as Obj).requires_grant === true &&
      (r.error_contract as Obj).requires_real_user_session === true &&
      canonicalJson(r.input_schema) === canonicalJson(op.input_schema) &&
      canonicalJson(r.output_schema) === canonicalJson(op.output_schema);
  } catch {
    return false;
  }
}
export function protocolExecutionScope(
  operation: string,
  args: Obj,
  bindings?: Bindings,
): Obj {
  const op = protocolContracts[operation];
  if (!op) throw Error("operation_not_implemented");
  if (["ssh", "winrm", "registered_exec"].includes(op.kind)) {
    return transportScope(operation, args, bindings);
  }
  if (op.kind.startsWith("command_") && op.kind !== "command_register") {
    return {
      provider: "gcp_vm_command_metadata",
      project_id: PROJECT,
      zone: ZONE,
      command_ref: args.command_ref,
    };
  }
  const name = String(args.vm_name);
  if (!Object.hasOwn(VMS, name)) throw Error("fixed_vm_required");
  return {
    provider: op.kind.startsWith("binding_")
      ? "gcp_vm_protocol_config"
      : "gcp_vm_command_metadata",
    project_id: PROJECT,
    zone: ZONE,
    vm_name: name,
    instance_id: VMS[name as keyof typeof VMS].instance_id,
    ...(op.kind === "binding_enroll"
      ? {
        ssh_host_key_sha256: typeof args.ssh === "object" && args.ssh
          ? (args.ssh as Obj).host_key_sha256
          : null,
        winrm_certificate_sha256: typeof args.winrm === "object" && args.winrm
          ? (args.winrm as Obj).certificate_sha256
          : null,
      }
      : {}),
    ...(op.kind === "binding_revoke" ? { binding_id: args.binding_id } : {}),
    ...(op.kind === "command_register"
      ? {
        allowed_operation: args.allowed_operation ?? "cloud.vm.exec",
        recipe_sha256: args.recipe_sha256 ?? null,
      }
      : {}),
  };
}
