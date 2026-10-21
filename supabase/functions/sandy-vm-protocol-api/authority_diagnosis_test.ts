import assert from "node:assert/strict";
import { diagnoseComputerAuthority } from "./authority_diagnosis.ts";
import { VMS, PROJECT, ZONE } from "./bindings.ts";
Deno.test("IAP authority: documented zone-name resource, exact targets and bounded failure projection; no write or tunnel", async () => {
  const routes: string[] = [];
  const request: typeof fetch = (input, init) => {
    const u = new URL(String(input)); routes.push(u.toString());
    assert(!u.pathname.includes(":setIamPolicy"));
    if (u.pathname.endsWith("/zones/" + ZONE)) return Promise.resolve(Response.json({ name: ZONE, id: "2000" }));
    if (u.hostname === "iap.googleapis.com") {
      assert(u.pathname.includes("/zones/" + ZONE + "/instances/"));
      assert(Object.values(VMS).some(vm => u.pathname.includes(vm.instance_id)));
      if (u.pathname.endsWith(":getIamPolicy")) return Promise.resolve(Response.json({ error: { message: "Permission 'iap.tunnelInstances.getIamPolicy' denied: private text" } }, { status: 403 }));
      return Promise.resolve(Response.json({ permissions: [] }));
    }
    if (u.hostname === "logging.googleapis.com") {
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)); assert.equal(body.pageSize, 10);
      assert(body.filter.includes('principalEmail="sandy-computer@'));
      return Promise.resolve(Response.json({ entries: [] }));
    }
    if (u.pathname.endsWith(":testIamPermissions")) return Promise.resolve(Response.json({ permissions: ["compute.instances.get", "compute.instances.osLogin"] }));
    if (u.pathname.endsWith("/getGuestAttributes")) return Promise.resolve(Response.json({ queryValue: { items: [{ key: "agent", value: '{"status":"connection_error","time":"2026-10-21T00:00:00Z","private":"never return"}' }] } }));
    assert.equal(u.pathname, `/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/sandy-windows`);
    return Promise.resolve(Response.json({ id: VMS["sandy-windows"].instance_id, status: "RUNNING", metadata: { items: [{ key: "windows-startup-script-ps1", value: "CurrentVersion SandyDesktopAgent private script" }] } }));
  };
  const result = await diagnoseComputerAuthority("synthetic", request);
  assert.equal(result.zone_id, "2000"); assert.equal(result.policy_changes, 0);
  assert.equal(result.targets[0].policy.error?.denied_permission, "iap.tunnelInstances.getIamPolicy");
  assert.deepEqual(result.targets[0].iap_permissions.granted, []);
  assert.equal(result.windows.interactive_logon_registration, true);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["private text", "private script", "never return"]) assert(!serialized.includes(forbidden));
  assert.equal(routes.filter(url => url.includes("iap.googleapis.com")).length, 4);
});
