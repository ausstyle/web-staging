import assert from "node:assert/strict";
import computeBinding from "./compute_instance_binding.json" with {
  type: "json",
};
import {
  createGuestOperationHandler,
  type GuestDependencies,
  guestExecutionScope,
  guestOperations,
  guestVms,
  type SigningConfig,
  signingKeys,
  signTask,
} from "./index.ts";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import { installMetadata, WORKER_SHA256 } from "./installer.ts";
const actor = "10000000-0000-4000-8000-000000000001",
  request = "10000000-0000-4000-8000-000000000002",
  grant = "10000000-0000-4000-8000-000000000003",
  admission = "10000000-0000-4000-8000-000000000004",
  job = "10000000-0000-4000-8000-000000000005";
const endpoint =
  "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-guest-operation-api";
async function signing(): Promise<SigningConfig> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const b64 = (v: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(v)));
  return {
    keyId: "fixture-v1",
    privateKeyPkcs8B64: b64(
      await crypto.subtle.exportKey("pkcs8", pair.privateKey),
    ),
    publicKeySpkiB64: b64(
      await crypto.subtle.exportKey("spki", pair.publicKey),
    ),
  };
}
function setup(overrides: Partial<GuestDependencies> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [],
    grants: Record<string, unknown>[] = [];
  const deps: GuestDependencies = {
    service: "fixture-service",
    anonJwt: "fixture-public-anon",
    endpoint,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        error: null,
        data: name === "sandy_api_finish_execution"
          ? { ok: true }
          : name === "sandy_guest_enqueue"
          ? {
            ok: true,
            job_id: job,
            state: "queued",
            reused: false,
            executed: false,
            redispatch_permitted: false,
          }
          : name === "sandy_guest_get_status"
          ? {
            ok: true,
            vm_name: "sandy-video",
            enabled: false,
            generation: 0,
            instance_id: "6831598645020395570",
            project_id: "elaborate-haven-511518-a5",
            platform: "linux",
            last_seen_at: null,
            agent_version: null,
            agent_connected: false,
            installed_software_attested: false,
            ssh_transport_available: false,
            winrm_transport_available: false,
          }
          : name === "sandy_guest_claim"
          ? { ok: true, task: null }
          : { ok: true },
      };
    },
    verifyVm: async () => null,
    authorizeContext: async () => ({ allowed: true }),
    consumeGrant: async (args) => {
      grants.push(args);
      return { allowed: true, admission_id: admission, reused: false };
    },
    ...overrides,
  };
  return { deps, calls, grants, handler: createGuestOperationHandler(deps) };
}
function api(
  operation: string,
  args: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  authorization = "fixture-service",
) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer " + authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      operation,
      arguments: args,
      actor_id: actor,
      tenant_id: null,
      request_id: request,
      grant_id: grant,
      ...extra,
    }),
  });
}
function vm(body: unknown, bearer = "fixture-public-anon") {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer " + bearer,
      "x-sandy-vm-identity": "fixture-google-signed-identity",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
Deno.test("guest service boundary rejects unauthenticated, delegated key and mixed VM transport before dispatch", async () => {
  const f = setup();
  assert.equal(
    (await f.handler(
      api("gcp.vm.agent.status", { vm_name: "sandy-video" }, {}, "invalid"),
    )).status,
    403,
  );
  assert.equal(
    (await f.handler(
      api("gcp.vm.agent.status", { vm_name: "sandy-video" }, {
        credential_id: actor,
      }),
    )).status,
    400,
  );
  assert.equal(
    (await f.handler(vm({ action: "poll" }, "fixture-service"))).status,
    403,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.grants.length, 0);
});
Deno.test("SSH and WinRM remain explicit unavailable transports, never converted to managed shell commands", async () => {
  const f = setup();
  for (const op of ["gcp.vm.ssh.exec", "gcp.vm.winrm.exec"]) {
    const response = await f.handler(
      api(op, { vm_name: "sandy-video", command: "fixture" }),
    );
    assert.equal(response.status, 424);
    assert.match((await response.json()).error, /transport_unavailable/);
  }
  assert.equal(f.grants.length, 0);
  assert.equal(f.calls.length, 0);
});
Deno.test("owner verification and absent signing configuration refuse mutations without consuming a grant", async () => {
  const denied = setup({
    authorizeContext: async () => ({
      allowed: false,
      error: "guest_verified_approval_required",
      http_status: 403,
    }),
  });
  assert.equal(
    (await denied.handler(
      api("gcp.vm.services.restart", {
        vm_name: "sandy-video",
        service: "fixture.service",
      }),
    )).status,
    403,
  );
  assert.equal(denied.grants.length, 0);
  const f = setup();
  assert.equal(
    (await f.handler(
      api("gcp.vm.services.restart", {
        vm_name: "sandy-video",
        service: "fixture.service",
      }),
    )).status,
    503,
  );
  assert.equal(f.grants.length, 0);
});
Deno.test("queue acceptance binds exact actor, operation, canonical input, contract and fixed VM scope without execution", async () => {
  const f = setup({ signing: await signing() });
  const args = { vm_name: "sandy-video", service: "fixture.service" };
  const response = await f.handler(api("gcp.vm.services.restart", args));
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.executed, false);
  assert.equal(body.accepted, true);
  assert.equal(body.request_state, "queued");
  assert.equal(f.grants.length, 1);
  assert.equal(f.grants[0].actor_id, actor);
  assert.equal(f.grants[0].input_sha256, await argumentDigest(args));
  assert.equal(
    f.grants[0].scope_sha256,
    await argumentDigest(guestExecutionScope("sandy-video")),
  );
  assert.equal(
    f.grants[0].contract_sha256,
    guestOperations["gcp.vm.services.restart"].contract_sha256,
  );
  assert.equal(f.calls[0].name, "sandy_guest_enqueue");
  assert.equal(f.calls[0].args.p_arguments_canonical, canonicalJson(args));
  assert.equal(f.calls[0].args.p_admission_id, admission);
  assert.equal(
    f.calls.some((c) => c.name === "sandy_api_finish_execution"),
    false,
  );
});
Deno.test("reused or ambiguous grants cannot enqueue a second guest operation", async () => {
  const f = setup({
    signing: await signing(),
    consumeGrant: async () => ({
      allowed: false,
      reused: true,
      error: "execution_grant_used_or_expired",
      http_status: 409,
    }),
  });
  assert.equal(
    (await f.handler(
      api("gcp.vm.services.restart", {
        vm_name: "sandy-video",
        service: "fixture.service",
      }),
    )).status,
    409,
  );
  assert.equal(f.calls.length, 0);
  const unknown = setup({
    signing: await signing(),
    consumeGrant: async () => {
      throw Error("lost_reply");
    },
  });
  const response = await unknown.handler(
    api("gcp.vm.reboot", { vm_name: "sandy-video", delay_seconds: 60 }),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reconciliation_required, true);
  assert.equal(unknown.calls.length, 0);
});
Deno.test("agent status remains independent of missing signer and reports absent enrollment truthfully", async () => {
  const f = setup();
  const response = await f.handler(
    api("gcp.vm.agent.status", { vm_name: "sandy-video" }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.enabled, false);
  assert.equal(body.result.agent_connected, false);
  assert.equal(body.request_state, "observed");
  assert.equal(f.calls.at(-1)?.name, "sandy_api_finish_execution");
});
Deno.test("Google VM identity must be verified before any private transport RPC", async () => {
  const f = setup({ signing: await signing() });
  assert.equal((await f.handler(vm({ action: "poll" }))).status, 403);
  assert.equal(f.calls.length, 0);
  const accepted = setup({
    signing: await signing(),
    verifyVm: async () => guestVms["sandy-video"],
  });
  const response = await accepted.handler(vm({ action: "poll" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, envelope: null });
  assert.equal(accepted.calls[0].name, "sandy_guest_claim");
  assert.equal(
    accepted.calls[0].args.p_instance_id,
    guestVms["sandy-video"].instance_id,
  );
});
Deno.test("Ed25519 task signatures bind canonical payload and reject mismatched configured key pairs", async () => {
  const config = await signing(),
    task = {
      key_id: config.keyId,
      job_id: job,
      operation: "gcp.vm.services.status",
      arguments: { service: "fixture", vm_name: "sandy-video" },
    };
  const envelope = await signTask(task, config),
    keys = await signingKeys(config);
  const sig = Uint8Array.from(
    atob(envelope.signature.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
  assert.equal(
    await crypto.subtle.verify(
      "Ed25519",
      keys.publicKey,
      sig,
      new TextEncoder().encode(canonicalJson(task)),
    ),
    true,
  );
  assert.equal(
    await crypto.subtle.verify(
      "Ed25519",
      keys.publicKey,
      sig,
      new TextEncoder().encode(
        canonicalJson({ ...task, operation: "gcp.vm.reboot" }),
      ),
    ),
    false,
  );
  const other = await signing();
  await assert.rejects(
    () => signingKeys({ ...config, publicKeySpkiB64: other.publicKeySpkiB64 }),
    /key_pair_mismatch/,
  );
});
Deno.test("installer preserves unrelated metadata, rejects overwrite and stages public config only", () => {
  const config = {
    endpoint,
    anon_jwt: "fixture-public-anon",
    vm_name: "sandy-video",
    instance_id: "6831598645020395570",
    project_id: "elaborate-haven-511518-a5",
    generation: 1,
    key_id: "fixture-v1",
    public_key_spki_b64: "fixture-public-key",
    platform: "linux" as const,
    privateKeyPkcs8B64: "must-never-be-staged",
  };
  const instance = {
    metadata: {
      fingerprint: "fixture-fingerprint",
      items: [{ key: "existing-label", value: "preserved" }],
    },
  };
  const result = installMetadata(
    instance,
    "fixture-fingerprint",
    config,
    false,
  );
  assert.equal(result.items[0].value, "preserved");
  assert.equal(JSON.stringify(result).includes("must-never-be-staged"), false);
  assert.equal(result.items.at(-1)?.value.includes(WORKER_SHA256), true);
  assert.throws(
    () => installMetadata(instance, "changed", config, false),
    /fingerprint_changed/,
  );
  assert.throws(
    () =>
      installMetadata(
        {
          metadata: {
            fingerprint: "fixture-fingerprint",
            items: [{
              key: "startup-script",
              value: "#!/bin/sh\nexisting production script",
            }],
          },
        },
        "fixture-fingerprint",
        config,
        false,
      ),
    /unrelated_startup_script_preserved/,
  );
  assert.throws(
    () => installMetadata(instance, "fixture-fingerprint", config, true),
    /update_requires_managed_install/,
  );
});
Deno.test("staging source cannot claim software installation or run a remote reboot", async () => {
  const fetches: { url: string; method: string }[] = [];
  const f = setup({
    signing: await signing(),
    getGcpAccessToken: async () => "fixture-provider-token",
    rpc: async (name) => ({
      error: null,
      data: name === "sandy_guest_get_status"
        ? { ok: true, enabled: true, generation: 1 }
        : { ok: true },
    }),
    fetch: async (input, init) => {
      fetches.push({ url: String(input), method: init?.method ?? "GET" });
      return Response.json(
        init?.method === "POST"
          ? { name: "fixture-provider-operation", status: "PENDING" }
          : {
            id: guestVms["sandy-video"].instance_id,
            metadata: { fingerprint: "fixture-fingerprint", items: [] },
          },
      );
    },
  });
  const response = await f.handler(
    api("gcp.vm.agent.install", {
      vm_name: "sandy-video",
      expected_metadata_fingerprint: "fixture-fingerprint",
    }),
  );
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.result.installation_confirmed, false);
  assert.equal(body.request_state, "metadata_request_accepted");
  assert.equal(body.result.metadata_staged, false);
  assert.equal(body.result.metadata_readback_confirmed, false);
  assert.equal(fetches.length, 3);
  assert.equal(fetches[1].url.endsWith("/setMetadata"), true);
  assert.equal(fetches.some((x) => /reset|start|stop/.test(x.url)), false);
});

Deno.test("every guest capability has a normalized ID, requirement mapping and pinned worker contract", () => {
  assert.equal(Object.keys(guestOperations).length, 21);
  for (const op of Object.values(guestOperations)) {
    assert.match(op.operation, /^[a-z][a-z0-9_.-]{2,100}$/);
    assert.ok(op.requirement >= 35 && op.requirement <= 44);
    assert.match(op.contract_sha256, /^[a-f0-9]{64}$/);
    assert.equal(op.worker_sha256, WORKER_SHA256);
  }
});

Deno.test("heartbeat binds current installed worker digest before private VM state writes", async () => {
  const f = setup({
    signing: await signing(),
    verifyVm: async () => guestVms["sandy-video"],
  });
  const data = {
    action: "heartbeat",
    agent_version: "1.0.0",
    key_id: "fixture-v1",
    generation: 1,
    platform: "linux",
    boot_id: "fixture-boot",
    worker_sha256: WORKER_SHA256,
  };
  assert.equal((await f.handler(vm(data))).status, 200);
  assert.equal(f.calls[0].name, "sandy_guest_heartbeat");
  assert.equal(f.calls[0].args.p_worker_sha256, WORKER_SHA256);
  const before = f.calls.length;
  assert.equal(
    (await f.handler(vm({ ...data, worker_sha256: "a".repeat(64) }))).status,
    400,
  );
  assert.equal(f.calls.length, before);
});

Deno.test("Compute metadata operation errors never claim staging, and success requires exact readback", async () => {
  for (const fail of [true, false]) {
    let posted: unknown = null;
    const f = setup({
      signing: await signing(),
      getGcpAccessToken: async () => "fixture-provider-token",
      rpc: async (name) => ({
        error: null,
        data: name === "sandy_guest_get_status"
          ? { ok: true, enabled: true, generation: 1 }
          : { ok: true },
      }),
      fetch: async (_input, init) => {
        if (init?.method === "POST") {
          posted = JSON.parse(String(init.body));
          return Response.json(
            fail
              ? {
                name: "fixture-op",
                status: "DONE",
                error: { errors: [{ code: "RESOURCE_NOT_READY" }] },
              }
              : { name: "fixture-op", status: "DONE" },
          );
        }
        return Response.json({
          id: guestVms["sandy-video"].instance_id,
          metadata: posted ?? { fingerprint: "fixture-fingerprint", items: [] },
        });
      },
    });
    const response = await f.handler(
        api("gcp.vm.agent.install", {
          vm_name: "sandy-video",
          expected_metadata_fingerprint: "fixture-fingerprint",
        }),
      ),
      body = await response.json();
    if (fail) {
      assert.equal(response.status, 502);
      assert.equal(body.error, "guest_metadata_provider_operation_failed");
      assert.equal(body.result, undefined);
    } else {
      assert.equal(response.status, 202);
      assert.equal(body.request_state, "metadata_staged");
      assert.equal(body.result.metadata_readback_confirmed, true);
      assert.equal(body.result.installation_confirmed, false);
    }
  }
});
Deno.test("bootstrap logs address immutable instance ID accepted by the pinned Compute schema", async () => {
  const urls: string[] = [];
  const f = setup({
    getGcpAccessToken: async () => "fixture-provider-token",
    fetch: async (input) => {
      urls.push(String(input));
      return Response.json({ contents: "fixture boot diagnostic", next: "24" });
    },
  });
  const response = await f.handler(
    api("gcp.vm.bootstrap.get_logs", { vm_name: "sandy-video", start: "0" }),
  );
  assert.equal(response.status, 200);
  assert.equal(urls.length, 1);
  assert.equal(
    urls[0].includes("/instances/6831598645020395570/serialPort?"),
    true,
  );
  assert.equal(urls[0].includes("/instances/sandy-video/"), false);
});

Deno.test("provider discovery binding explicitly permits immutable numeric instance identifiers", () => {
  for (const method of Object.values(computeBinding.methods)) {
    for (const vm of Object.values(guestVms)) {
      assert.equal(
        new RegExp("^(?:" + method.instance_parameter.pattern + ")$").test(
          vm.instance_id,
        ),
        true,
      );
    }
  }
});
Deno.test("invalid file digests, traversal and firewall rules cannot consume execution grants", async () => {
  const f = setup({ signing: await signing() });
  for (
    const [operation, args] of [
      ["gcp.vm.files.upload", {
        vm_name: "sandy-video",
        path: "safe.txt",
        content_base64: btoa("fixture"),
        sha256: "a".repeat(64),
      }],
      ["gcp.vm.files.download", { vm_name: "sandy-video", path: "../outside" }],
      ["gcp.vm.firewall_guest.manage", {
        vm_name: "sandy-video",
        action: "allow",
        rule_id: "fixture",
        protocol: "tcp",
        port: 80,
        source_cidr: "999.1.1.1/32",
      }],
      ["gcp.vm.packages.install", {
        vm_name: "sandy-windows",
        manager: "apt",
        packages: ["fixture"],
      }],
    ] as const
  ) assert.equal((await f.handler(api(operation, args))).status, 400);
  assert.equal(f.grants.length, 0);
  assert.equal(f.calls.length, 0);
});
