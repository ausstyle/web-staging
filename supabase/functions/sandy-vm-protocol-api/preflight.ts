/** Administrative read/connect probe only. No SSH login, command or guest change. */
import { once } from "node:events";
import { providerCalls, verifyVm } from "./compute.ts";
import { IapFailure, openIapTunnel } from "./iap.ts";
import { ProtocolRefusal } from "./errors.ts";
import { type VmName, PROJECT, ZONE } from "./bindings.ts";

export async function inspectComputerAccess(token: string, request: typeof fetch = fetch,
  tunnel: typeof openIapTunnel = openIapTunnel) {
  const calls = providerCalls(token, request), results = [];
  for (const name of ["sandy-video", "sandy-windows"] as VmName[]) {
    const result: Record<string, unknown> = { vm_name: name, remote_command_executed: false,
      host_identity_verified: false, customer_or_MCP_execution: false };
    try {
      const proof = await verifyVm(name, calls, name === "sandy-video");
      result.vm_identity_verified = true; result.vm_proof_sha256 = proof.proof_sha256;
      result.public_address_required = false; result.iap_port = name === "sandy-video" ? 22 : 5986;
      try {
        const permission = name === "sandy-video" ? "compute.instances.osLogin" : "compute.instances.get";
        const response = await calls.request(new URL(`https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/${name}/testIamPermissions`), "POST", { permissions: [permission] });
        result.target_permission = { permission, granted: Array.isArray(response.value.permissions) && response.value.permissions.includes(permission) };
      } catch { result.target_permission_observation_unavailable = true; }
      const stream = await tunnel(name, name === "sandy-video" ? 22 : 5986, token);
      const closed = once(stream, "close"); stream.destroy(); await closed;
      result.iap_tcp_connected = true; result.local_tunnel_closed = true;
    } catch (error) {
      result.iap_tcp_connected = false;
      result.error = error instanceof ProtocolRefusal ? error.code : "computer_access_preflight_failed";
      if (error instanceof IapFailure) {
        result.provider_http = error.providerHttp ?? null;
        result.provider_close_code = error.providerClose ?? null;
      }
    }
    results.push(result);
  }
  return { ok: results.every(r => r.iap_tcp_connected === true), administrative_readiness_only: true,
    provider_configuration_changed: false, commands_executed: 0, targets: results };
}
