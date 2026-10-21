import assert from "node:assert/strict";
import { inspectComputerAccess } from "./preflight.ts";
import { PROJECT, ZONE, VMS } from "./bindings.ts";
Deno.test("Computer readiness: exact IAP target permission tests do not retry denied tunnels or run commands", async () => {
  const paths: string[] = [];
  const request: typeof fetch = (input, options) => {
    const url = new URL(String(input)); paths.push(url.toString());
    if (url.pathname.endsWith("/zones/" + ZONE)) return Promise.resolve(Response.json({ name: ZONE, id: "2101" }));
    if (url.pathname.endsWith(":testIamPermissions")) {
      if (url.hostname === "iap.googleapis.com") assert(url.pathname.includes("/zones/2101/instances/"));
      assert.equal(options?.method, "POST");
      return Promise.resolve(Response.json({ permissions: url.hostname === "iap.googleapis.com" ? [] : ["compute.instances.osLogin", "compute.instances.get"] }));
    }
    const name = url.pathname.endsWith("/sandy-video") ? "sandy-video" : "sandy-windows";
    return Promise.resolve(Response.json({ id: VMS[name].instance_id, name, status: "RUNNING",
      zone: `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}`,
      serviceAccounts: [{ email: `sandy-vm-runtime@${PROJECT}.iam.gserviceaccount.com` }],
      metadata: { items: [{ key: "enable-oslogin", value: "TRUE" }] },
      networkInterfaces: [{ name: "nic0", networkIP: "10.132.0.2" }],
    }));
  };
  const result = await inspectComputerAccess("synthetic", request, () => { throw Error("no_repeat_tunnel_attempt_allowed"); }, true);
  assert.equal(result.commands_executed, 0);
  assert.equal(result.targets.length, 2);
  assert(result.targets.every(row => row.tunnel_attempted === false));
  assert(result.targets.every(row => (row.iap_permission as { granted: boolean }).granted === false));
  assert.equal(paths.filter(path => path.startsWith("https://iap.googleapis.com/")).length, 2);
});
