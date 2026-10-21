/** Fixed-target read-only IAP/Windows diagnosis. No policy write or guest command. */
import { providerCalls, VmProviderFailure } from "./compute.ts";
import { NUMBER, PROJECT, ZONE, VMS, obj, type Obj } from "./bindings.ts";
import { machineScope } from "../_shared/sandy_machine_identity.ts";
const member = "serviceAccount:" + machineScope.service_account;
const failure = (e: unknown) => e instanceof VmProviderFailure
  ? { http_status: e.providerHttp, reason: e.providerReason, denied_permission: e.deniedPermission }
  : { error: "authority_observation_unavailable" };

export async function diagnoseComputerAuthority(token: string, request: typeof fetch = fetch) {
  const calls = providerCalls(token, request);
  const observe = async (url: string, body: Obj) => {
    try { return { ok: true as const, ...(await calls.request(new URL(url), "POST", body)) }; }
    catch (e) { return { ok: false as const, error: failure(e) }; }
  };
  const zone = await calls.request(new URL(`https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}`));
  if (zone.value.name !== ZONE || !/^[0-9]{1,20}$/.test(String(zone.value.id))) throw Error("fixed_zone_identity_required");
  const zoneId = String(zone.value.id);
  const targets = await Promise.all(Object.entries(VMS).map(async ([name, vm]) => {
    const resource = `projects/${NUMBER}/iap_tunnel/zones/${ZONE}/instances/${vm.instance_id}`;
    const base = "https://iap.googleapis.com/v1/" + resource;
    const [policy, permissions, computePermissions] = await Promise.all([
      observe(base + ":getIamPolicy", { options: { requestedPolicyVersion: 3 } }),
      observe(base + ":testIamPermissions", { permissions: ["iap.tunnelInstances.accessViaIAP", "iap.tunnelInstances.getIamPolicy", "iap.tunnelInstances.setIamPolicy"] }),
      observe(`https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/${name}/testIamPermissions`, { permissions: ["compute.instances.get", "compute.instances.osLogin", "compute.instances.setIamPolicy"] }),
    ]);
    return { vm_name: name, instance_id: vm.instance_id, zone_id: zoneId, iap_resource: resource,
      port: name === "sandy-video" ? 22 : 5986, requested_permission: "iap.tunnelInstances.accessViaIAP",
      policy: policy.ok ? { read_succeeded: true, version: policy.value.version ?? 1,
        principal_bindings: Array.isArray(policy.value.bindings) ? policy.value.bindings.filter(b => obj(b) && Array.isArray(b.members) && b.members.includes(member)).map(b => ({ role: (b as Obj).role, condition: (b as Obj).condition ?? null })) : [] }
        : { read_succeeded: false, error: policy.error },
      iap_permissions: permissions.ok ? { granted: permissions.value.permissions ?? [] } : { error: permissions.error },
      compute_permissions: computePermissions.ok ? { granted: computePermissions.value.permissions ?? [] } : { error: computePermissions.error } };
  }));
  const earliest = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const audit = await observe("https://logging.googleapis.com/v2/entries:list", {
    resourceNames: ["projects/" + PROJECT], pageSize: 10, orderBy: "timestamp desc",
    filter: `protoPayload.serviceName="iap.googleapis.com" AND protoPayload.authenticationInfo.principalEmail="${machineScope.service_account}" AND timestamp>="${earliest}" AND protoPayload.status.code=7`,
  });
  const entries = audit.ok && Array.isArray(audit.value.entries) ? audit.value.entries : [];
  const safeAudit = entries.filter(e => obj(e) && obj(e.protoPayload) && obj(e.protoPayload.authenticationInfo) && e.protoPayload.authenticationInfo.principalEmail === machineScope.service_account)
    .map(e => { const entry = e as Obj, p = entry.protoPayload as Obj;
      return { timestamp: entry.timestamp, resource: p.resourceName, status_code: obj(p.status) ? p.status.code : null,
        authorization: Array.isArray(p.authorizationInfo) ? p.authorizationInfo.filter(a => obj(a) && typeof a.permission === "string" && a.permission.startsWith("iap.tunnelInstances.")).map(a => ({ permission: (a as Obj).permission, granted: (a as Obj).granted, resource: (a as Obj).resource })) : [] }; });
  const windows: Obj = {};
  try {
    const response = await calls.request(new URL(`https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/sandy-windows`));
    if (String(response.value.id) !== VMS["sandy-windows"].instance_id) throw Error("fixed_windows_identity_required");
    const metadata = obj(response.value.metadata) && Array.isArray(response.value.metadata.items) ? response.value.metadata.items : [];
    const script = metadata.find(i => obj(i) && i.key === "windows-startup-script-ps1");
    const text = obj(script) && typeof script.value === "string" ? script.value : "";
    windows.vm_running = response.value.status === "RUNNING";
    windows.interactive_logon_registration = text.includes("CurrentVersion") && text.includes("SandyDesktopAgent");
    windows.script_handles_powershell_command = /act\s*==\s*['"]powershell['"]/.test(text);
    const guest = await calls.request(new URL(`https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/sandy-windows/getGuestAttributes?queryPath=sandy/`));
    windows.guest_reporting = obj(guest.value.queryValue) && Array.isArray(guest.value.queryValue.items)
      ? guest.value.queryValue.items.filter(v => obj(v) && ["agent", "agent_setup", "setup"].includes(String(v.key))).map(v => {
        const row = v as Obj; let state: Obj = {}; try { const parsed = JSON.parse(String(row.value)); if (obj(parsed)) state = parsed; } catch { /* no raw guest value */ }
        return { key: row.key, status: typeof state.status === "string" && /^[a-z_]{1,40}$/.test(state.status) ? state.status : null, time: typeof state.time === "string" && /^[0-9TZ:.+\- ]{1,40}$/.test(state.time) ? state.time : null }; }) : [];
  } catch (e) { windows.error = failure(e); }
  return { principal: machineScope.service_account, project: PROJECT, project_number: NUMBER, zone: ZONE, zone_id: zoneId,
    targets, audit: audit.ok ? { entries: safeAudit } : { error: audit.error }, windows,
    policy_changes: 0, networking_changes: 0, commands_executed: 0, tunnel_attempts: 0, MCP_acceptance: false };
}
