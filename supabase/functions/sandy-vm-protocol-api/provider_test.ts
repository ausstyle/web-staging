import assert from "node:assert/strict";
import {
  executionScope,
  type Obj,
  parseBindings,
  privateAuthentication,
  PROJECT,
  VMS,
  ZONE,
} from "./bindings.ts";
import { type ProviderCalls, providerCalls, verifyVm, VmProviderFailure } from "./compute.ts";
import { withEphemeralOsLogin } from "./oslogin.ts";
import { ProtocolRefusal } from "./ssh.ts";
import { machineScope } from "../_shared/sandy_machine_identity.ts";
const version = crypto.randomUUID(),
  hostKey = "SHA256:" + "A".repeat(43),
  entry = {
    verified: true,
    version,
    instance_id: VMS["sandy-video"].instance_id,
    ssh: { mode: "oslogin", host_key_sha256: hostKey },
  };
Deno.test("VM provider errors: preserve HTTP/static reason while omitting private provider text", async () => {
  const calls = providerCalls("synthetic", () => Promise.resolve(Response.json({
    error: { message: "private provider credential", details: [{ reason: "SERVICE_DISABLED" }] },
  }, { status: 403 })));
  await assert.rejects(() => calls.request(new URL("https://iap.googleapis.com/v1/fixed"), "POST", {}),
    (error: Error) => error instanceof VmProviderFailure && error.providerHttp === 403 &&
      error.providerReason === "SERVICE_DISABLED" && !JSON.stringify(error).includes("private provider credential"));
});
Deno.test("VM binding: exact fixed identity/version/protocol pins only; caller URLs, private fields and relaxed TLS flags refused", () => {
  const binding = parseBindings(JSON.stringify({ "sandy-video": entry }));
  assert(binding);
  const scope = executionScope(
    "gcp.vm.ssh.exec",
    { vm_name: "sandy-video" },
    binding,
  );
  assert.equal(scope.binding_version, version);
  assert.equal(scope.instance_id, VMS["sandy-video"].instance_id);
  assert.equal(scope.ssh_host_key_sha256, hostKey);
  for (
    const bad of [
      { ...entry, instance_id: "foreign" },
      { ...entry, verified: false },
      { ...entry, host: "https://foreign.invalid" },
      { ...entry, ssh: { ...entry.ssh, private_key: "do-not-expose" } },
      { ...entry, ssh: { ...entry.ssh, insecure: true } },
    ]
  ) {
    assert.equal(
      parseBindings(JSON.stringify({ "sandy-video": bad })),
      undefined,
    );
  }
  assert.throws(
    () => executionScope("gcp.vm.ssh.exec", { vm_name: "foreign" }, binding),
    ProtocolRefusal,
  );
  assert.throws(
    () =>
      privateAuthentication(
        JSON.stringify({
          "sandy-video": {
            version: crypto.randomUUID(),
            username: "fixture",
            private_key: "-----BEGIN OPENSSH PRIVATE KEY-----synthetic",
          },
        }),
        "sandy-video",
        binding["sandy-video"]!,
      ),
    ProtocolRefusal,
  );
});
function vm(overrides: Obj = {}): Obj {
  return {
    id: VMS["sandy-video"].instance_id,
    name: "sandy-video",
    zone:
      `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}`,
    status: "RUNNING",
    serviceAccounts: [{
      email: `sandy-vm-runtime@${PROJECT}.iam.gserviceaccount.com`,
    }],
    metadata: { items: [{ key: "enable-oslogin", value: "TRUE" }] },
    networkInterfaces: [{ accessConfigs: [{ natIP: "34.0.0.10" }] }],
    ...overrides,
  };
}
Deno.test("VM proof: exact fresh VM ID/zone/service-account/running-state and unique public address precede private authentication", async () => {
  const called: string[] = [];
  const calls: ProviderCalls = {
    request: async (url) => {
      called.push(url.toString());
      return { value: vm(), sha256: "a".repeat(64) };
    },
  };
  const good = await verifyVm("sandy-video", calls, true);
  assert.equal(good.address, "34.0.0.10");
  assert.equal(called.length, 1);
  assert.equal(
    called[0],
    `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/sandy-video`,
  );
  for (
    const changed of [
      { id: "foreign" },
      { status: "STOPPED" },
      { zone: "https://foreign.invalid" },
      { serviceAccounts: [{ email: "foreign" }] },
      {
        networkInterfaces: [{ accessConfigs: [{ natIP: "169.254.169.254" }] }],
      },
      {
        networkInterfaces: [{
          accessConfigs: [{ natIP: "34.0.0.10" }, { natIP: "34.0.0.11" }],
        }],
      },
      { metadata: { items: [{ key: "enable-oslogin", value: "FALSE" }] } },
    ]
  ) {
    await assert.rejects(() =>
      verifyVm("sandy-video", {
        request: async () => ({ value: vm(changed), sha256: "b".repeat(64) }),
      }, true), ProtocolRefusal);
  }
  for (
    const project of [{ name: "foreign", id: "1030223524306" }, {
      name: PROJECT,
      id: "foreign",
    }]
  ) {
    await assert.rejects(() =>
      verifyVm("sandy-video", {
        request: async (url) => ({
          value: url.pathname.endsWith("/sandy-video")
            ? vm({ metadata: { items: [] } })
            : {
              ...project,
              commonInstanceMetadata: {
                items: [{ key: "enable-oslogin", value: "TRUE" }],
              },
            },
          sha256: "b".repeat(64),
        }),
      }, true), ProtocolRefusal);
  }
});
Deno.test("VM provider HTTP: fixed hosts only, manual redirects, bounded responses and unknown mutations, never provider error-body output", async () => {
  let calls = 0;
  const client = providerCalls("synthetic-token", async (_url, init) => {
    calls++;
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer synthetic-token",
    );
    assert.equal(init?.redirect, "manual");
    return new Response("private provider error", {
      status: 302,
      headers: { location: "https://foreign.invalid" },
    });
  });
  await assert.rejects(
    () => client.request(new URL("https://foreign.invalid/")),
    ProtocolRefusal,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () => client.request(new URL("https://compute.googleapis.com/fixed")),
    (e) => e instanceof ProtocolRefusal && !e.message.includes("private"),
  );
  assert.equal(calls, 1);
  const unknown = providerCalls(
    "synthetic",
    () => Promise.reject(Error("private failure")),
  );
  await assert.rejects(
    () =>
      unknown.request(
        new URL("https://oslogin.googleapis.com/fixed"),
        "POST",
        {},
      ),
    (e) => e instanceof ProtocolRefusal && e.mayHaveExecuted,
  );
});
function osFixture(
  mode: "success" | "exec_fail" | "cleanup_fail" | "bad_user" = "success",
) {
  let key = "", expires = "", removed = false, executions = 0;
  const urls: string[] = [], fingerprint = "f".repeat(64);
  const profile = () => ({
    name: "users/1234567890",
    posixAccounts: [{
      primary: true,
      operatingSystemType: "LINUX",
      username: mode === "bad_user" ? "foreign/user" : "sa_fixture",
    }],
    sshPublicKeys: removed ? {} : {
      [fingerprint]: {
        key,
        expirationTimeUsec: expires,
        fingerprint,
        name: `users/1234567890/sshPublicKeys/${fingerprint}`,
      },
    },
  });
  const calls: ProviderCalls = {
    request: async (url, method = "GET", body) => {
      urls.push(method + " " + url.toString());
      assert.equal(url.hostname, "oslogin.googleapis.com");
      assert(
        url.pathname.startsWith(
          "/v1/users/" + encodeURIComponent(machineScope.service_account),
        ),
      );
      if (method === "POST") {
        key = String(body?.key);
        expires = String(body?.expirationTimeUsec);
        assert.equal(expires, String((1000000 + 120000) * 1000));
        assert.equal(url.searchParams.get("projectId"), PROJECT);
        return { value: { loginProfile: profile() }, sha256: "a".repeat(64) };
      }
      if (method === "DELETE") {
        assert(url.pathname.endsWith("/sshPublicKeys/" + fingerprint));
        if (mode === "cleanup_fail") {
          throw new ProtocolRefusal("synthetic_cleanup_failure", true);
        }
        removed = true;
        return { value: {}, sha256: "b".repeat(64) };
      }
      return { value: profile(), sha256: "c".repeat(64) };
    },
  };
  const execute = async (endpoint: Obj) => {
    executions++;
    assert.equal(endpoint.username, "sa_fixture");
    assert.equal(endpoint.port, 22);
    assert.equal(endpoint.hostKeySha256, hostKey);
    assert(
      String(endpoint.privateKey).startsWith(
        "-----BEGIN OPENSSH PRIVATE KEY-----",
      ),
    );
    if (mode === "exec_fail") {
      throw new ProtocolRefusal("ssh_execution_outcome_unknown", true);
    }
    return { exit_code: 0 };
  };
  return { calls, execute, urls, counts: () => ({ removed, executions }) };
}
Deno.test("OS Login: fresh ≤120second key, exact profile username, exec, original fixed-user revoke and readback; no private key result", async () => {
  const f = osFixture();
  const result = await withEphemeralOsLogin(
    f.calls,
    "34.0.0.10",
    hostKey,
    f.execute,
    1000000,
  );
  assert.deepEqual(result, { exit_code: 0 });
  assert.deepEqual(f.counts(), { removed: true, executions: 1 });
  assert.equal(f.urls.length, 3);
  assert(!JSON.stringify(result).includes("PRIVATE KEY"));
});
Deno.test("OS Login: failed execution still revokes; bad profile never executes; cleanup failure stays unknown without another import/exec", async () => {
  for (const mode of ["exec_fail", "bad_user", "cleanup_fail"] as const) {
    const f = osFixture(mode);
    await assert.rejects(
      () =>
        withEphemeralOsLogin(f.calls, "34.0.0.10", hostKey, f.execute, 1000000),
      ProtocolRefusal,
    );
    assert.equal(f.urls.filter((s) => s.startsWith("POST")).length, 1);
    assert.equal(f.counts().executions, mode === "bad_user" ? 0 : 1);
    if (mode === "cleanup_fail") {
      assert.equal(f.counts().removed, false);
      assert.equal(f.urls.filter((s) => s.startsWith("DELETE")).length, 1);
    } else assert(f.counts().removed);
  }
});
Deno.test("OS Login: expired-key DELETE404 is not retried and requires independent profile absence before cleanup succeeds", async () => {
  let publicKey = "", expiration = "", removed = false, commands = 0;
  const sequence: string[] = [];
  const profile = () => ({
    name: "users/123456",
    posixAccounts: [{
      primary: true,
      username: "sa_fixture",
      operatingSystemType: "LINUX",
    }],
    sshPublicKeys: removed ? {} : {
      ["f".repeat(64)]: {
        key: publicKey,
        expirationTimeUsec: expiration,
        fingerprint: "f".repeat(64),
      },
    },
  });
  const calls = providerCalls("synthetic", async (_url, init) => {
    const method = init?.method ?? "GET";
    sequence.push(method);
    if (method === "POST") {
      const body = JSON.parse(String(init?.body));
      publicKey = body.key;
      expiration = body.expirationTimeUsec;
      return Response.json({ loginProfile: profile() });
    }
    if (method === "DELETE") {
      removed = true;
      return Response.json({
        error: { code: 404, message: "synthetic expired key" },
      }, { status: 404 });
    }
    return Response.json(profile());
  });
  const result = await withEphemeralOsLogin(
    calls,
    "34.0.0.10",
    hostKey,
    async () => {
      commands++;
      return { exit_code: 0 };
    },
  );
  assert.deepEqual(result, { exit_code: 0 });
  assert.equal(commands, 1);
  assert.deepEqual(sequence, ["POST", "DELETE", "GET"]);
});
