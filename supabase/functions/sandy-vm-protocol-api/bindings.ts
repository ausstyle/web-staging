/** Server-only fixed VM identity and public protocol identity bindings. */
import { ProtocolRefusal } from "./errors.ts";
export type Obj = Record<string, unknown>;
export const PROJECT = "elaborate-haven-511518-a5",
  ZONE = "europe-west1-b",
  NUMBER = "1030223524306";
export const VMS = Object.freeze({
  "sandy-video": {
    name: "sandy-video",
    instance_id: "6831598645020395570",
    platform: "linux",
  },
  "sandy-windows": {
    name: "sandy-windows",
    instance_id: "8120150462304566315",
    platform: "win32",
  },
});
export type VmName = keyof typeof VMS;
export type SshBinding = {
  mode: "oslogin" | "private_key";
  host_key_sha256: string;
};
export type WinrmBinding = {
  server_name: string;
  certificate_pem: string;
  certificate_sha256: string;
};
export type Binding = {
  verified: true;
  instance_id: string;
  version: string;
  ssh?: SshBinding;
  winrm?: WinrmBinding;
};
export type Bindings = Partial<Record<VmName, Binding>>;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const obj = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: Obj, keys: string[]) =>
  !Object.keys(v).some((k) => !keys.includes(k));
export function parseBindings(raw: string | undefined): Bindings | undefined {
  if (!raw) return undefined;
  if (raw.length > 80000) return undefined;
  try {
    const value = JSON.parse(raw);
    if (!obj(value) || !exact(value, Object.keys(VMS))) return undefined;
    for (const [name, item] of Object.entries(value)) {
      if (
        !obj(item) ||
        !exact(item, ["verified", "instance_id", "version", "ssh", "winrm"]) ||
        item.verified !== true ||
        item.instance_id !== VMS[name as VmName].instance_id ||
        typeof item.version !== "string" || !UUID.test(item.version)
      ) return undefined;
      if (item.ssh !== undefined) {
        const s = item.ssh;
        if (
          !obj(s) || !exact(s, ["mode", "host_key_sha256"]) ||
          !["oslogin", "private_key"].includes(String(s.mode)) ||
          typeof s.host_key_sha256 !== "string" ||
          !/^SHA256:[A-Za-z0-9+/]{43}$/.test(s.host_key_sha256) ||
          s.mode === "oslogin" && name !== "sandy-video"
        ) return undefined;
      }
      if (item.winrm !== undefined) {
        const w = item.winrm;
        if (
          name !== "sandy-windows" || !obj(w) ||
          !exact(w, ["server_name", "certificate_pem", "certificate_sha256"]) ||
          typeof w.server_name !== "string" ||
          !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(
            w.server_name,
          ) || w.server_name.includes("..") ||
          typeof w.certificate_pem !== "string" ||
          w.certificate_pem.length > 32768 ||
          !w.certificate_pem.startsWith("-----BEGIN CERTIFICATE-----") ||
          typeof w.certificate_sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(w.certificate_sha256)
        ) return undefined;
      }
      if (item.ssh === undefined && item.winrm === undefined) return undefined;
    }
    return value as Bindings;
  } catch {
    return undefined;
  }
}
export function requireBinding(
  vm: string,
  protocol: "ssh" | "winrm",
  bindings: Bindings | undefined,
): Binding {
  const binding = bindings?.[vm as VmName];
  if (!binding || !binding[protocol]) {
    throw new ProtocolRefusal("verified_vm_protocol_binding_required");
  }
  return binding;
}
export function executionScope(
  operation: string,
  args: Obj,
  bindings: Bindings | undefined,
): Obj {
  const vm = operation === "cloud.vm.exec" ? args.instance : args.vm_name;
  if (typeof vm !== "string" || !Object.hasOwn(VMS, vm)) {
    throw new ProtocolRefusal("fixed_vm_required");
  }
  const protocol = operation === "gcp.vm.winrm.exec" ||
      operation === "cloud.vm.exec" && vm === "sandy-windows"
    ? "winrm"
    : "ssh";
  const binding = requireBinding(vm, protocol, bindings),
    target = VMS[vm as VmName];
  return {
    provider: "gcp",
    project_id: PROJECT,
    zone: ZONE,
    vm_name: vm,
    instance_id: target.instance_id,
    protocol,
    binding_version: binding.version,
    ...(protocol === "ssh"
      ? {
        ssh_host_key_sha256: binding.ssh!.host_key_sha256,
        ssh_authentication_mode: binding.ssh!.mode,
      }
      : {
        winrm_certificate_sha256: binding.winrm!.certificate_sha256,
        winrm_server_name: binding.winrm!.server_name,
      }),
    ...(operation === "cloud.vm.exec" ? { command_ref: args.command_ref } : {}),
  };
}
export function privateAuthentication(
  raw: string | undefined,
  vm: VmName,
  binding: Binding,
): { username: string; password?: string; privateKey?: string } {
  if (!raw || raw.length > 60000) {
    throw new ProtocolRefusal("private_vm_protocol_credential_required");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProtocolRefusal("private_vm_protocol_credential_required");
  }
  const auth = obj(value) ? value[vm] : undefined;
  if (
    !obj(auth) ||
    !exact(auth, ["version", "username", "password", "private_key"]) ||
    auth.version !== binding.version || typeof auth.username !== "string" ||
    !auth.username || auth.username.length > 200 ||
    /[\x00-\x1f\x7f:]/.test(auth.username) ||
    auth.password !== undefined &&
      (typeof auth.password !== "string" || !auth.password ||
        auth.password.length > 4096) ||
    auth.private_key !== undefined &&
      (typeof auth.private_key !== "string" ||
        auth.private_key.length > 20000 ||
        !auth.private_key.includes("PRIVATE KEY-----"))
  ) throw new ProtocolRefusal("private_vm_protocol_credential_binding_invalid");
  return {
    username: auth.username,
    ...(typeof auth.password === "string" ? { password: auth.password } : {}),
    ...(typeof auth.private_key === "string"
      ? { privateKey: auth.private_key }
      : {}),
  };
}
