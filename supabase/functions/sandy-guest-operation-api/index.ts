/** Fixed-resource managed guest API. API callers and VM transport are separate identities. */
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.10.0";
import manifest from "./contracts.json" with { type: "json" };
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
  type AgentConfig,
  installMetadata,
  WORKER_SHA256,
} from "./installer.ts";
export const guestOperations = Object.freeze(
  Object.fromEntries(manifest.operations.map((op) => [op.operation, op])),
);
export type GuestOperation = typeof manifest.operations[number];
type ObjectValue = Record<string, unknown>;
/** Read-only enrollment observations can be verified by their first real call.
 * Writes and task-result reads retain their existing verification prerequisite.
 * The caller must still have a real owner authority and consume its exact grant.
 */
export function guestRegistryReady(
  row: ObjectValue | null,
  op: GuestOperation,
  ownerVerified: boolean,
): boolean {
  return ownerVerified && row?.handler === "sandy-guest-operation-api" &&
    row.api_exposed === true && obj(row.error_contract) &&
    row.error_contract.contract_sha256 === op.contract_sha256 &&
    (row.verified === true || (op.kind === "status" && op.is_mutation === false));
}
export type GuestVm = {
  vm_name: string;
  instance_id: string;
  project_id: string;
  zone: string;
  service_account: string;
  platform: "linux" | "win32";
};
export const guestVms: Record<string, GuestVm> = Object.freeze({
  "sandy-windows": {
    vm_name: "sandy-windows",
    instance_id: "8120150462304566315",
    project_id: manifest.project_id,
    zone: manifest.zone,
    service_account:
      "sandy-vm-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com",
    platform: "win32",
  },
  "sandy-video": {
    vm_name: "sandy-video",
    instance_id: "6831598645020395570",
    project_id: manifest.project_id,
    zone: manifest.zone,
    service_account:
      "sandy-vm-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com",
    platform: "linux",
  },
});
export function guestExecutionScope(vmName: string): ObjectValue {
  const vm = guestVms[vmName];
  if (!vm) throw Error("fixed_vm_required");
  return {
    provider: "gcp_guest",
    project_id: vm.project_id,
    zone: vm.zone,
    vm_name: vm.vm_name,
    instance_id: vm.instance_id,
  };
}
export type SigningConfig = {
  keyId: string;
  privateKeyPkcs8B64: string;
  publicKeySpkiB64: string;
};
export type GuestDependencies = {
  service: string;
  anonJwt: string;
  endpoint: string;
  signing?: SigningConfig;
  rpc: (
    name: string,
    args: ObjectValue,
  ) => Promise<{ data: unknown; error: unknown }>;
  verifyVm: (jwt: string, audience: string) => Promise<GuestVm | null>;
  authorizeContext: (
    context: ObjectValue,
    operation: GuestOperation,
  ) => Promise<{ allowed: boolean; error?: string; http_status?: number }>;
  consumeGrant: (
    context: ObjectValue,
  ) => Promise<
    {
      allowed: boolean;
      admission_id?: string;
      reused?: boolean;
      error?: string;
      http_status?: number;
    }
  >;
  getGcpAccessToken?: () => Promise<string>;
  withGcpCredential?: <T>(
    execution: ConsumerExecution,
    use: (token: string) => Promise<T>,
  ) => Promise<T>;
  fetch?: typeof fetch;
};
const obj = (v: unknown): v is ObjectValue =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const reply = (status: number, value: ObjectValue) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
const refuse = (status: number, error: string, extra: ObjectValue = {}) =>
  reply(status, { ok: false, error, executed: false, ...extra });
const ajv = new Ajv({
  strict: true,
  strictTypes: false,
  allowUnionTypes: true,
});
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const evidenceValidator = ajv.compile(manifest.evidence_schema);
const validators = new Map(
  manifest.operations.map((op) => [op.operation, ajv.compile(op.input_schema)]),
);
const outputValidators = new Map(
  manifest.operations.map(
    (op) => [op.operation, ajv.compile(op.output_schema)],
  ),
);
function bytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
const base64url = (value: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
async function rawSha(value: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
async function boundedProviderJson(response: Response): Promise<unknown> {
  if (!response.body) throw Error("guest_provider_response_invalid");
  const reader = response.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 1048576) {
        await reader.cancel();
        throw Error("guest_provider_response_size_limit");
      }
      parts.push(chunk.value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      all.set(part, offset);
      offset += part.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
  } finally {
    reader.releaseLock();
  }
}
export async function signingKeys(config: SigningConfig) {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(config.keyId)) {
    throw Error("guest_signing_configuration_required");
  }
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    bytes(config.privateKeyPkcs8B64),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    bytes(config.publicKeySpkiB64),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const challenge = crypto.getRandomValues(new Uint8Array(32)),
    signature = await crypto.subtle.sign("Ed25519", privateKey, challenge);
  if (!await crypto.subtle.verify("Ed25519", publicKey, signature, challenge)) {
    throw Error("guest_signing_key_pair_mismatch");
  }
  return {
    privateKey,
    publicKey,
    publicKeySha256: await rawSha(bytes(config.publicKeySpkiB64)),
  };
}
export async function signTask(task: ObjectValue, config: SigningConfig) {
  if (task.key_id !== config.keyId) {
    throw Error("guest_signer_rotation_required");
  }
  const key = await signingKeys(config);
  return {
    task,
    signature: base64url(
      await crypto.subtle.sign(
        "Ed25519",
        key.privateKey,
        new TextEncoder().encode(canonicalJson(task)),
      ),
    ),
  };
}
export function createGuestOperationHandler(deps: GuestDependencies) {
  const fetcher = deps.fetch ?? fetch;
  async function call(name: string, args: ObjectValue) {
    const result = await deps.rpc(name, args);
    if (result.error || !obj(result.data)) {
      throw Error("guest_database_unavailable");
    }
    return result.data;
  }
  function resultResponse(
    data: ObjectValue,
    operation: string,
    state: string,
    executed: boolean | null,
    accepted = false,
    status = 200,
  ) {
    const payload = {
      ok: true,
      operation,
      contract_version: "1.0.0",
      accepted,
      executed,
      request_state: state,
      result: data,
    };
    if (!outputValidators.get(operation)?.(payload)) {
      return refuse(502, "guest_response_contract_mismatch", {
        executed,
        reconciliation_required: true,
      });
    }
    return reply(status, payload);
  }
  return async (req: Request) => {
    if (req.method !== "POST") return refuse(405, "method_not_allowed");
    const authorization = req.headers.get("authorization"),
      vmJwt = req.headers.get("x-sandy-vm-identity");
    const service = !!deps.service &&
      authorization === `Bearer ${deps.service}`;
    if (
      vmJwt && (!deps.anonJwt || authorization !== `Bearer ${deps.anonJwt}`)
    ) return refuse(403, "guest_vm_transport_requires_anon_bearer");
    if (!service && !vmJwt) {
      return refuse(403, "service_or_enrolled_vm_required");
    }
    let body: unknown;
    try {
      body = await requestJson(req, 262144);
    } catch (e) {
      return refuse(
        e instanceof JsonRequestError ? e.status : 400,
        "invalid_request",
      );
    }
    if (!obj(body)) return refuse(400, "invalid_request");
    if (vmJwt) {
      let vm: GuestVm | null;
      try {
        vm = await deps.verifyVm(vmJwt, deps.endpoint);
      } catch {
        return refuse(403, "guest_vm_identity_denied");
      }
      if (!vm || guestVms[vm.vm_name]?.instance_id !== vm.instance_id) {
        return refuse(403, "guest_vm_identity_denied");
      }
      const action = body.action;
      if (!["heartbeat", "poll", "start", "finish"].includes(String(action))) {
        return refuse(403, "guest_vm_action_denied");
      }
      if (!deps.signing) {
        return refuse(503, "guest_signing_configuration_required");
      }
      try {
        let data: ObjectValue;
        if (action === "heartbeat") {
          if (
            Object.keys(body).some((k) =>
              ![
                "action",
                "agent_version",
                "key_id",
                "generation",
                "platform",
                "boot_id",
                "worker_sha256",
              ].includes(k)
            ) || body.agent_version !== "1.0.0" ||
            body.key_id !== deps.signing.keyId ||
            !Number.isSafeInteger(body.generation) ||
            Number(body.generation) < 1 || body.platform !== vm.platform ||
            typeof body.boot_id !== "string" ||
            body.worker_sha256 !== WORKER_SHA256
          ) return refuse(400, "guest_heartbeat_invalid");
          data = await call("sandy_guest_heartbeat", {
            p_vm_name: vm.vm_name,
            p_instance_id: vm.instance_id,
            p_generation: body.generation,
            p_key_id: body.key_id,
            p_agent_version: body.agent_version,
            p_platform: body.platform,
            p_boot_id: body.boot_id,
            p_worker_sha256: body.worker_sha256,
          });
        } else if (action === "poll") {
          if (Object.keys(body).some((k) => k !== "action")) {
            return refuse(400, "guest_poll_invalid");
          }
          // Configuration is checked before claiming a one-use job.
          const signer = await signingKeys(deps.signing);
          data = await call("sandy_guest_claim", {
            p_vm_name: vm.vm_name,
            p_instance_id: vm.instance_id,
            p_key_id: deps.signing.keyId,
            p_public_key_sha256: signer.publicKeySha256,
            p_worker_sha256: WORKER_SHA256,
          });
          if (data.ok === true) {
            if (data.task === null) {
              return reply(200, { ok: true, envelope: null });
            }
            if (!obj(data.task)) throw Error("guest_task_invalid");
            return reply(200, {
              ok: true,
              envelope: await signTask(data.task, deps.signing),
            });
          }
        } else {
          const permitted = action === "start"
            ? ["action", "job_id", "lease_id", "nonce"]
            : ["action", "job_id", "lease_id", "nonce", "outcome", "evidence"];
          if (
            Object.keys(body).some((k) => !permitted.includes(k)) ||
            ![body.job_id, body.lease_id, body.nonce].every(uuid)
          ) return refuse(400, "guest_lease_invalid");
          const args = {
            p_vm_name: vm.vm_name,
            p_instance_id: vm.instance_id,
            p_job_id: body.job_id,
            p_lease_id: body.lease_id,
            p_nonce: body.nonce,
          };
          if (action === "start") data = await call("sandy_guest_start", args);
          else {
            if (
              !["completed", "accepted", "failed", "unknown"].includes(
                String(body.outcome),
              ) || !obj(body.evidence) || !evidenceValidator(body.evidence) ||
              Object.keys(body.evidence).some((k) =>
                /(password|secret|token|credential|private.?key)/i.test(k)
              )
            ) return refuse(400, "guest_result_invalid");
            const serialized = canonicalJson(body.evidence);
            if (new TextEncoder().encode(serialized).length > 100000) {
              return refuse(413, "guest_result_size_limit");
            }
            data = await call("sandy_guest_finish", {
              ...args,
              p_outcome: body.outcome,
              p_evidence_canonical: serialized,
              p_result_sha256: await argumentDigest(body.evidence),
            });
          }
        }
        return data.ok === true ? reply(200, data) : refuse(
          Number(data.http_status) || 409,
          String(data.error || "guest_policy_denied"),
        );
      } catch {
        return refuse(503, "guest_transport_outcome_unknown", {
          reconciliation_required: true,
        });
      }
    }
    if (
      Object.keys(body).some((k) =>
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
      )
    ) return refuse(400, "invalid_execution_context");
    const op = typeof body.operation === "string"
      ? guestOperations[body.operation]
      : undefined;
    if (!op) return refuse(404, "operation_not_implemented");
    if (op.kind === "unsupported_transport") {
      return refuse(
        424,
        "guest_" + (op.operation.includes(".ssh.") ? "ssh" : "winrm") +
          "_transport_unavailable",
      );
    }
    if (
      !uuid(body.actor_id) || body.tenant_id !== null ||
      body.credential_id != null || !uuid(body.request_id) ||
      !uuid(body.grant_id) || !obj(body.arguments) ||
      !validators.get(op.operation)?.(body.arguments)
    ) return refuse(400, "invalid_operation_arguments");
    const args = body.arguments;
    let allowed;
    try {
      allowed = await deps.authorizeContext(body, op);
    } catch {
      return refuse(503, "guest_policy_unavailable");
    }
    if (!allowed.allowed) {
      return refuse(
        allowed.http_status ?? 403,
        allowed.error ?? "guest_verified_approval_required",
      );
    }
    const vm = typeof args.vm_name === "string"
      ? guestVms[args.vm_name]
      : undefined;
    if (op.operation === "gcp.vm.files.upload") {
      const content = bytes(String(args.content_base64));
      if (content.length > 65536 || await rawSha(content) !== args.sha256) {
        return refuse(400, "guest_file_digest_or_size_invalid");
      }
    }
    if (
      op.operation.startsWith("gcp.vm.packages.") &&
      ((vm?.platform === "win32") !== (args.manager === "winget"))
    ) return refuse(400, "guest_package_manager_os_mismatch");
    if (op.operation === "gcp.vm.firewall_guest.manage") {
      if (args.action === "remove") {
        if (
          Object.keys(args).some((k) =>
            !["vm_name", "action", "rule_id"].includes(k)
          )
        ) return refuse(400, "guest_firewall_remove_invalid");
      } else {
        const match = typeof args.source_cidr === "string"
          ? args.source_cidr.match(
            /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/,
          )
          : null;
        if (
          !["tcp", "udp"].includes(String(args.protocol)) ||
          !Number.isInteger(args.port) || Number(args.port) < 1 ||
          Number(args.port) > 65535 || !match || match.slice(1, 5).some((x) =>
            Number(x) > 255
          ) || Number(match[5]) > 32
        ) return refuse(400, "guest_firewall_rule_invalid");
      }
    }
    let scope: ObjectValue;
    if (vm) scope = guestExecutionScope(vm.vm_name);
    else if (op.kind === "task_status") {
      scope = {
        provider: "gcp_guest",
        project_id: manifest.project_id,
        receipt_actor_id: body.actor_id,
      };
    } else return refuse(400, "fixed_vm_required");
    let signer: Awaited<ReturnType<typeof signingKeys>> | undefined;
    if (
      ["access", "install", "queue"].includes(op.kind) &&
      op.operation !== "gcp.vm.access.revoke"
    ) {
      if (!deps.signing) {
        return refuse(503, "guest_signing_configuration_required");
      }
      try {
        signer = await signingKeys(deps.signing);
      } catch {
        return refuse(503, "guest_signing_configuration_required");
      }
    }
    if (
      ["install", "logs"].includes(op.kind) && !deps.getGcpAccessToken &&
      !deps.withGcpCredential
    ) return refuse(424, "guest_provider_identity_unavailable");
    const inputSha = await argumentDigest(args);
    let grant;
    try {
      grant = await deps.consumeGrant({
        ...body,
        operation: op.operation,
        input_sha256: inputSha,
        contract_sha256: op.contract_sha256,
        scope_sha256: await argumentDigest(scope),
      });
    } catch {
      return refuse(503, "guest_execution_grant_unknown", {
        reconciliation_required: true,
      });
    }
    if (!grant.allowed || grant.reused || !uuid(grant.admission_id)) {
      return refuse(
        grant.http_status ?? 409,
        grant.error ?? "guest_execution_grant_denied",
      );
    }
    const common = { p_actor_id: body.actor_id };
    const record = async (
      outcome: string,
      status: number | null,
      result: ObjectValue,
    ) => {
      const saved = await call("sandy_api_finish_execution", {
        p_admission_id: grant.admission_id,
        p_outcome: outcome,
        p_provider_http_status: status,
        p_provider_request_id: null,
        p_result_sha256: await argumentDigest(result),
      });
      if (saved.ok !== true) throw Error("guest_receipt_recording_unknown");
    };
    try {
      let data: ObjectValue;
      if (op.kind === "status" || op.kind === "task_status") {
        data = await call("sandy_guest_get_status", {
          ...common,
          p_vm_name: vm?.vm_name ?? null,
          p_job_id: op.kind === "task_status" ? args.job_id : null,
        });
        if (data.ok !== true) {
          return refuse(Number(data.http_status) || 403, String(data.error));
        }
        await record("succeeded", 200, data);
        return resultResponse(data, op.operation, "observed", true);
      }
      if (op.kind === "access") {
        data = await call("sandy_guest_access", {
          ...common,
          p_vm_name: vm!.vm_name,
          p_operation: op.operation,
          p_admission_id: grant.admission_id,
          p_input_sha256: inputSha,
          p_key_id: deps.signing?.keyId ?? null,
          p_public_key_sha256: signer?.publicKeySha256 ?? null,
          p_worker_sha256: WORKER_SHA256,
        });
        if (data.ok !== true) {
          return refuse(Number(data.http_status) || 403, String(data.error));
        }
        await record("accepted", 200, data);
        return resultResponse(data, op.operation, "enrollment_updated", true);
      }
      if (op.kind === "queue") {
        data = await call("sandy_guest_enqueue", {
          ...common,
          p_vm_name: vm!.vm_name,
          p_operation: op.operation,
          p_admission_id: grant.admission_id,
          p_request_id: body.request_id,
          p_arguments_canonical: canonicalJson(args),
          p_input_sha256: inputSha,
        });
        if (data.ok !== true) {
          return refuse(Number(data.http_status) || 403, String(data.error));
        }
        return resultResponse(
          data,
          op.operation,
          String(data.state),
          data.reused === true ? null : false,
          true,
          202,
        );
      }
      const provider = async (token: string): Promise<Response> => {
        if (!token) throw Error("guest_provider_identity_unavailable");
        const url =
          `https://compute.googleapis.com/compute/v1/projects/${manifest.project_id}/zones/${manifest.zone}/instances/${
            vm!.instance_id
          }`;
        const headers = {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        };
        if (op.kind === "logs") {
          const upstream = await fetcher(
            url + "/serialPort?port=1&start=" +
              encodeURIComponent(String(args.start)),
            { headers, redirect: "error", signal: AbortSignal.timeout(20000) },
          );
          const raw = await boundedProviderJson(upstream);
          if (!upstream.ok || !obj(raw) || typeof raw.contents !== "string") {
            return refuse(502, "guest_bootstrap_logs_unavailable", {
              provider_http_status: upstream.status,
            });
          }
          const projection = {
            contents: raw.contents.slice(-8192),
            next: typeof raw.next === "string" ? raw.next : null,
            truncated: raw.contents.length > 8192,
            source: "compute_serial_port",
            agent_installation_confirmed: false,
          };
          await record("succeeded", upstream.status, projection);
          return resultResponse(projection, op.operation, "observed", true);
        }
        const enrollment = await call("sandy_guest_get_status", {
          ...common,
          p_vm_name: vm!.vm_name,
          p_job_id: null,
        });
        if (
          enrollment.enabled !== true ||
          !Number.isSafeInteger(enrollment.generation)
        ) return refuse(424, "guest_enrollment_required");
        const observed = await fetcher(url, {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        });
        const instance = await boundedProviderJson(observed);
        if (
          !observed.ok || !obj(instance) ||
          String(instance.id) !== vm!.instance_id
        ) return refuse(409, "guest_instance_binding_changed");
        const config: AgentConfig = {
          endpoint: deps.endpoint,
          anon_jwt: deps.anonJwt,
          vm_name: vm!.vm_name,
          instance_id: vm!.instance_id,
          project_id: vm!.project_id,
          generation: Number(enrollment.generation),
          key_id: deps.signing!.keyId,
          public_key_spki_b64: deps.signing!.publicKeySpkiB64,
          platform: vm!.platform,
        };
        const metadata = installMetadata(
          instance,
          String(args.expected_metadata_fingerprint),
          config,
          op.operation.endsWith(".update"),
        );
        const staged = await fetcher(url + "/setMetadata", {
          method: "POST",
          headers,
          body: JSON.stringify(metadata),
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        });
        const receipt = await boundedProviderJson(staged);
        if (!staged.ok || !obj(receipt)) {
          await record(
            staged.status >= 500 ? "unknown" : "failed",
            staged.status,
            { error: "guest_install_metadata_not_accepted" },
          );
          return refuse(502, "guest_install_metadata_not_accepted", {
            executed: true,
            provider_http_status: staged.status,
          });
        }
        if (receipt.error != null) {
          await record("failed", staged.status, {
            error: "guest_metadata_provider_operation_failed",
          });
          return refuse(502, "guest_metadata_provider_operation_failed", {
            executed: true,
          });
        }
        if (
          typeof receipt.name !== "string" ||
          !["PENDING", "RUNNING", "DONE"].includes(String(receipt.status))
        ) {
          await record("unknown", staged.status, {
            error: "guest_provider_operation_contract_mismatch",
          });
          return refuse(502, "guest_provider_operation_contract_mismatch", {
            executed: true,
            reconciliation_required: true,
          });
        }
        let confirmed = false;
        try {
          const readback = await fetcher(url, {
            headers,
            redirect: "error",
            signal: AbortSignal.timeout(20000),
          });
          const current = await boundedProviderJson(readback);
          const currentMetadata = obj(current) && obj(current.metadata)
            ? current.metadata
            : null;
          const expected = metadata.items.find((item) =>
            item.key ===
              (vm!.platform === "win32"
                ? "windows-startup-script-ps1"
                : "startup-script")
          );
          confirmed = readback.ok && obj(current) &&
            String(current.id) === vm!.instance_id && !!expected &&
            Array.isArray(currentMetadata?.items) &&
            currentMetadata.items.some((item) =>
              obj(item) && item.key === expected.key &&
              item.value === expected.value
            );
        } catch {
          /* The accepted provider request remains accepted; no staging proof is invented. */
        }
        const projection = {
          metadata_request_accepted: true,
          metadata_staged: confirmed,
          metadata_readback_confirmed: confirmed,
          provider_operation: receipt.name,
          provider_operation_status: String(receipt.status),
          worker_sha256: WORKER_SHA256,
          installation_confirmed: false,
          startup_execution_requires_reboot_or_provider_startup_runner: true,
        };
        await record("accepted", staged.status, projection);
        return resultResponse(
          projection,
          op.operation,
          confirmed ? "metadata_staged" : "metadata_request_accepted",
          true,
          true,
          202,
        );
      };
      return deps.withGcpCredential
        ? await deps.withGcpCredential({
          actorId: String(body.actor_id),
          admissionId: grant.admission_id,
          operation: op.operation,
        }, provider)
        : await provider(await deps.getGcpAccessToken!());
    } catch (e) {
      if (e instanceof ConsumerCredentialError && !e.requestMayHaveExecuted) {
        try {
          await record("failed", e.providerHttpStatus, { error: e.code });
        } catch {
          /* The canonical admission remains available for reconciliation. */
        }
        return refuse(e.status, e.code);
      }
      return refuse(
        503,
        e instanceof Error &&
          [
            "guest_metadata_fingerprint_changed",
            "unrelated_startup_script_preserved",
            "guest_update_requires_managed_install",
            "guest_already_staged_use_update",
            "guest_install_configuration_invalid",
          ].includes(e.message)
          ? e.message
          : "guest_execution_outcome_unknown",
        { executed: null, reconciliation_required: true },
      );
    }
  };
}
if (import.meta.main) {
  const root = Deno.env.get("SUPABASE_URL") ?? "",
    service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    anonJwt = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const db = createClient(root, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const keys = createRemoteJWKSet(
    new URL("https://www.googleapis.com/oauth2/v3/certs"),
  );
  const privateKeyPkcs8B64 =
      Deno.env.get("SANDY_GUEST_ED25519_PRIVATE_KEY_PKCS8_B64") ?? "",
    publicKeySpkiB64 =
      Deno.env.get("SANDY_GUEST_ED25519_PUBLIC_KEY_SPKI_B64") ?? "",
    keyId = Deno.env.get("SANDY_GUEST_SIGNING_KEY_ID") ?? "";
  const machine = createMachineAccessToken(db.auth as unknown as MachineAuth);
  const consumer = createCredentialConsumer({
    db,
    legacy: {
      gcp_access_token: machine,
      supabase_management: () => {
        throw Error("credential_consumer_not_configured");
      },
      github_api: () => {
        throw Error("credential_consumer_not_configured");
      },
    },
  });
  Deno.serve(createGuestOperationHandler({
    service,
    anonJwt,
    endpoint: root + "/functions/v1/sandy-guest-operation-api",
    signing: privateKeyPkcs8B64 && publicKeySpkiB64 && keyId
      ? { privateKeyPkcs8B64, publicKeySpkiB64, keyId }
      : undefined,
    rpc: async (name, args) => await db.rpc(name, args),
    withGcpCredential: (execution, use) =>
      consumer("gcp_access_token", execution, use),
    verifyVm: async (jwt, audience) => {
      const { payload } = await jwtVerify(jwt, keys, {
        audience,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        algorithms: ["RS256"],
        clockTolerance: 20,
      });
      const gce = (payload.google as {
        compute_engine?: {
          instance_id?: string;
          project_id?: string;
          zone?: string;
        };
      } | undefined)?.compute_engine;
      return Object.values(guestVms).find((vm) =>
        payload.email === vm.service_account &&
        payload.email_verified === true &&
        gce?.instance_id === vm.instance_id &&
        gce.project_id === vm.project_id && gce.zone === vm.zone
      ) ?? null;
    },
    authorizeContext: async (context, op) => {
      const [owner, registry] = await Promise.all([
        db.from("sandy_controller_admins").select("auth_user_id").eq(
          "auth_user_id",
          context.actor_id,
        ).eq("role", "owner").eq("enabled", true).maybeSingle(),
        db.from("sandy_operation_registry").select(
          "handler,api_exposed,verified,error_contract",
        ).eq("operation", op.operation).maybeSingle(),
      ]);
      return {
        allowed: !registry.error && guestRegistryReady(
          registry.data,
          op,
          !owner.error && !!owner.data,
        ),
        error: "guest_verified_approval_required",
        http_status: 403,
      };
    },
    consumeGrant: async (context) => {
      const { data, error } = await db.rpc(
        "sandy_api_consume_execution_grant",
        {
          p_grant_id: context.grant_id,
          p_actor_id: context.actor_id,
          p_tenant_id: null,
          p_operation: context.operation,
          p_input_sha256: context.input_sha256,
          p_request_id: context.request_id,
          p_contract_sha256: context.contract_sha256,
          p_scope_sha256: context.scope_sha256,
        },
      );
      return error
        ? {
          allowed: false,
          error: "guest_execution_policy_unavailable",
          http_status: 503,
        }
        : data;
    },
  }));
}
