/** Fresh fixed GCP VM proof, never a caller-selected network target. */
import { isIP } from "node:net";
import { ProtocolRefusal } from "./errors.ts";
import { type Obj, obj, PROJECT, type VmName, VMS, ZONE } from "./bindings.ts";
import { bytesDigest } from "../sandy-provider-supplement-api/runtime.ts";
export type ProviderCalls = {
  request: (
    url: URL,
    method?: string,
    body?: Obj,
    additionallyAccepted?: number[],
  ) => Promise<{ value: Obj; sha256: string }>;
};
export function providerCalls(
  token: string,
  fetcher: typeof fetch = fetch,
): ProviderCalls {
  return {
    request: async (url, method = "GET", body, additionallyAccepted = []) => {
      if (
        url.protocol !== "https:" ||
        !["compute.googleapis.com", "oslogin.googleapis.com", "iap.googleapis.com"].includes(
          url.hostname,
        ) || url.username || url.password || url.port || url.hash
      ) throw new ProtocolRefusal("vm_provider_scope_mismatch");
      let response: Response;
      try {
        response = await fetcher(url, {
          method,
          headers: {
            authorization: "Bearer " + token,
            accept: "application/json",
            ...(body ? { "content-type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        throw new ProtocolRefusal(
          method === "GET"
            ? "vm_provider_request_failed"
            : "vm_identity_mutation_outcome_unknown",
          method !== "GET",
        );
      }
      const reader = response.body?.getReader(), parts: Uint8Array[] = [];
      let length = 0;
      if (reader) {
        try {
          while (true) {
            const x = await reader.read();
            if (x.done) break;
            length += x.value.length;
            if (length > 131072) {
              await reader.cancel();
              throw new ProtocolRefusal(
                "vm_provider_response_size_limit",
                method !== "GET",
              );
            }
            parts.push(x.value);
          }
        } catch (e) {
          if (e instanceof ProtocolRefusal) throw e;
          throw new ProtocolRefusal(
            "vm_provider_response_incomplete",
            method !== "GET",
          );
        } finally {
          reader.releaseLock();
        }
      }
      if (!response.ok && !additionallyAccepted.includes(response.status)) {
        throw new ProtocolRefusal(
          response.status >= 300 && response.status < 400
            ? "vm_provider_redirect_refused"
            : [401, 403].includes(response.status)
            ? "vm_provider_iam_or_identity_refused"
            : "vm_provider_http_error",
          method !== "GET" && response.status >= 500,
        );
      }
      const bytes = new Uint8Array(length);
      let off = 0;
      for (const p of parts) {
        bytes.set(p, off);
        off += p.length;
      }
      let value: unknown;
      try {
        value = bytes.length
          ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
          : {};
      } catch {
        throw new ProtocolRefusal(
          "vm_provider_response_invalid",
          method !== "GET",
        );
      }
      if (!obj(value)) {
        throw new ProtocolRefusal(
          "vm_provider_response_invalid",
          method !== "GET",
        );
      }
      return { value, sha256: await bytesDigest(bytes) };
    },
  };
}
function metadata(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  if (!obj(value) || !Array.isArray(value.items)) return result;
  for (const item of value.items) {
    if (
      obj(item) && typeof item.key === "string" &&
      typeof item.value === "string"
    ) result.set(item.key, item.value);
  }
  return result;
}
export async function verifyVm(
  name: VmName,
  calls: ProviderCalls,
  needsOsLogin: boolean,
) {
  const fixed = VMS[name],
    reply = await calls.request(
      new URL(
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/${name}`,
      ),
    ),
    vm = reply.value;
  if (
    String(vm.id) !== fixed.instance_id || vm.name !== name ||
    vm.status !== "RUNNING" ||
    vm.zone !==
      `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}` ||
    !Array.isArray(vm.serviceAccounts) || vm.serviceAccounts.length !== 1 ||
    !vm.serviceAccounts.every((v) =>
      obj(v) &&
      v.email === `sandy-vm-runtime@${PROJECT}.iam.gserviceaccount.com`
    )
  ) throw new ProtocolRefusal("fixed_vm_identity_or_running_state_required");
  if (needsOsLogin) {
    const instance = metadata(vm.metadata);
    let enabled = instance.get("enable-oslogin");
    if (enabled === undefined) {
      const project = await calls.request(
        new URL(
          `https://compute.googleapis.com/compute/v1/projects/${PROJECT}`,
        ),
      );
      if (
        project.value.name !== PROJECT ||
        String(project.value.id) !== "1030223524306"
      ) throw new ProtocolRefusal("fixed_project_identity_required");
      enabled = metadata(project.value.commonInstanceMetadata).get(
        "enable-oslogin",
      );
    }
    if (enabled?.toUpperCase() !== "TRUE") {
      throw new ProtocolRefusal("vm_oslogin_configuration_required");
    }
  }
  const addresses = Array.isArray(vm.networkInterfaces)
    ? vm.networkInterfaces.flatMap((n) =>
      obj(n) && Array.isArray(n.accessConfigs)
        ? n.accessConfigs.flatMap((a) =>
          obj(a) && typeof a.natIP === "string" ? [a.natIP] : []
        )
        : []
    )
    : [];
  const safe = addresses.filter((ip) =>
    isIP(ip) === 4 &&
    !/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/
      .test(ip) &&
    Number(ip.split(".")[0]) < 224
  );
  if (addresses.length === 0) {
    const nics = vm.networkInterfaces;
    const nic = Array.isArray(nics) && nics.length === 1 ? nics[0] : undefined;
    if (!obj(nic) || nic.name !== "nic0" || typeof nic.networkIP !== "string" ||
      isIP(nic.networkIP) !== 4 ||
      !/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(nic.networkIP)) {
      throw new ProtocolRefusal("fixed_vm_private_interface_required");
    }
    return { address: nic.networkIP, instance_id: fixed.instance_id,
      proof_sha256: reply.sha256, transport: "iap" as const };
  }
  if (safe.length !== 1) {
    throw new ProtocolRefusal("fixed_vm_public_endpoint_required");
  }
  return {
    address: safe[0],
    instance_id: fixed.instance_id,
    proof_sha256: reply.sha256,
    transport: "direct" as const,
  };
}
