/** Synthetic policy/provider components: no customer session or remote VM attestation. */
import assert from "node:assert/strict";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  bytesDigest,
  decode64,
  type Policy,
} from "../sandy-provider-supplement-api/runtime.ts";
import {
  createProtocolHandler,
  protocolContractEnabled,
  type ProtocolHandlerDependencies,
} from "./index.ts";
import { protocolContracts, protocolExecutionScope } from "./contracts.ts";
import { type Obj, PROJECT, VMS, ZONE } from "./bindings.ts";
import { ProtocolRefusal } from "./errors.ts";
const actor = crypto.randomUUID(),
  admission = crypto.randomUUID(),
  bindingId = crypto.randomUUID(),
  commandRef = crypto.randomUUID(),
  custody = crypto.randomUUID(),
  pin = "SHA256:" + "A".repeat(43);
const command = "printf approved-private-command";
const linux = {
  verified: true as const,
  version: bindingId,
  instance_id: VMS["sandy-video"].instance_id,
  ssh: { mode: "private_key" as const, host_key_sha256: pin },
};
const windows = {
  verified: true as const,
  version: bindingId,
  instance_id: VMS["sandy-windows"].instance_id,
  winrm: {
    server_name: "fixture.internal",
    certificate_pem:
      "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----",
    certificate_sha256: "a".repeat(64),
  },
};
function argsFor(id: string): Obj {
  if (id === "gcp.vm.ssh.exec") return { vm_name: "sandy-video", command };
  if (id === "gcp.vm.winrm.exec") return { vm_name: "sandy-windows", command };
  if (id === "cloud.vm.exec") {
    return {
      project_id: PROJECT,
      zone: ZONE,
      instance: "sandy-video",
      command_ref: commandRef,
    };
  }
  if (id.endsWith("bindings.enroll")) {
    return { vm_name: "sandy-video", ssh: linux.ssh };
  }
  if (id.endsWith("bindings.get")) return { vm_name: "sandy-video" };
  if (id.endsWith("bindings.revoke")) {
    return { vm_name: "sandy-video", binding_id: bindingId };
  }
  if (id.endsWith("commands.register")) {
    return { vm_name: "sandy-video", command };
  }
  return { command_ref: commandRef };
}
async function harness(overrides: Partial<ProtocolHandlerDependencies> = {}) {
  const events: string[] = [],
    consumed: Obj[] = [],
    finished: Obj[] = [],
    captures: Obj[] = [],
    sha = await bytesDigest(new TextEncoder().encode(command));
  const deps: ProtocolHandlerDependencies = {
    service: "synthetic-service",
    publicBindings: async (actual) => {
      assert.equal(actual, actor);
      events.push("public-pins");
      return { "sandy-video": linux, "sandy-windows": windows };
    },
    authorizeContext: async () => {
      events.push("authorize");
      return { allowed: true };
    },
    consumeGrant: async (r) => {
      events.push("consume");
      consumed.push(r);
      return { allowed: true, admission_id: admission };
    },
    resolveExecution: async (c) => {
      events.push("resolve");
      return {
        vm_name: c.vmName,
        command,
        command_sha256: sha,
        binding: c.vmName === "sandy-video" ? linux : windows,
      };
    },
    claimExecution: async () => {
      events.push("claim");
    },
    credentialForExecution: async (c) => {
      events.push("credential");
      assert.equal(c.admissionId, admission);
      return "synthetic-provider-token";
    },
    privateAuthentication: () => {
      events.push("private-auth");
      return JSON.stringify({
        "sandy-video": {
          version: bindingId,
          username: "fixture",
          private_key: "-----BEGIN OPENSSH PRIVATE KEY-----synthetic",
        },
        "sandy-windows": {
          version: bindingId,
          username: "fixture",
          password: "synthetic-private-password",
        },
      });
    },
    fetch: async (url, init) => {
      events.push("compute");
      assert.equal(init?.method, "GET");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer synthetic-provider-token",
      );
      const name = String(url).endsWith("sandy-windows")
        ? "sandy-windows"
        : "sandy-video";
      assert.equal(
        String(url),
        `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/${name}`,
      );
      return Response.json({
        id: VMS[name].instance_id,
        name,
        status: "RUNNING",
        zone:
          `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}`,
        serviceAccounts: [{
          email: `sandy-vm-runtime@${PROJECT}.iam.gserviceaccount.com`,
        }],
        networkInterfaces: [{ accessConfigs: [{ natIP: "34.0.0.10" }] }],
      });
    },
    sshExecute: async (endpoint, actual) => {
      events.push("ssh");
      assert.equal(actual, command);
      assert.equal(endpoint.address, "34.0.0.10");
      assert.equal(endpoint.port, 22);
      assert.equal(endpoint.hostKeySha256, pin);
      return {
        protocol: "ssh2",
        exit_code: 0,
        stdout: new TextEncoder().encode("private stdout"),
        stderr: new Uint8Array(),
        host_key_verified: true,
      };
    },
    winrmExecute: async (endpoint, actual) => {
      events.push("winrm");
      assert.equal(actual, command);
      assert.equal(endpoint.address, "34.0.0.10");
      assert.equal(endpoint.port, 5986);
      assert.equal(endpoint.serverName, "fixture.internal");
      return {
        protocol: "winrm_https",
        exit_code: 0,
        stdout: new TextEncoder().encode("private stdout"),
        stderr: new Uint8Array(),
        tls_identity_verified: true,
        shell_deleted: true,
      };
    },
    verifySshIdentity: async (_ip, _port, actual) => {
      events.push("probe");
      assert.equal(actual, pin);
    },
    metadata: async (c, proof) => {
      events.push("metadata");
      if (c.operation.includes("bindings.")) {
        if (c.operation.endsWith(".enroll")) {
          assert.equal(
            proof?.identity_pin_verified,
            true,
          );
        }
        return {
          binding_id: bindingId,
          vm_name: "sandy-video",
          instance_id: VMS["sandy-video"].instance_id,
          state: c.operation.endsWith(".revoke") ? "revoked" : "owner_pinned",
          ssh_host_key_sha256: pin,
          winrm_certificate_sha256: null,
          enrollment_admission_id: admission,
          vm_proof_sha256: "a".repeat(64),
        };
      }
      return {
        command_ref: commandRef,
        vm_name: "sandy-video",
        instance_id: VMS["sandy-video"].instance_id,
        command_sha256: sha,
        allowed_operation: "cloud.vm.exec",
        recipe_sha256: null,
        expires_at: new Date(Date.now() + 600000).toISOString(),
        state: c.operation.endsWith(".revoke") ? "revoked" : "registered",
      };
    },
    saveResult: async (c, r) => {
      events.push("capture");
      assert.equal(c.admissionId, admission);
      captures.push(r);
      const bytes = decode64(r.payload_base64);
      assert.equal(await bytesDigest(bytes), r.payload_sha256);
      return {
        custody_id: custody,
        sha256: r.payload_sha256,
        byte_length: r.byte_length,
      };
    },
    finishExecution: async (r) => {
      events.push("finish");
      finished.push(r);
      return { allowed: true };
    },
    ...overrides,
  };
  const handler = createProtocolHandler(deps);
  const call = (id: string, args = argsFor(id), extra: Obj = {}) =>
    handler(
      new Request("https://local.invalid", {
        method: "POST",
        headers: { authorization: "Bearer synthetic-service" },
        body: JSON.stringify({
          operation: id,
          arguments: args,
          actor_id: actor,
          tenant_id: null,
          credential_id: null,
          request_id: crypto.randomUUID(),
          grant_id: crypto.randomUUID(),
          admission_id: admission,
          ...extra,
        }),
      }),
    );
  return { call, events, consumed, finished, captures, deps };
}
Deno.test("nine typed original/protocol metadata handlers preserve exact grant identity and private outputs", async () => {
  assert.equal(Object.keys(protocolContracts).length, 9);
  for (const [id, op] of Object.entries(protocolContracts)) {
    const h = await harness(),
      args = argsFor(id),
      r = await h.call(id, args),
      body = await r.json();
    assert.equal(r.status, 200, id + ":" + JSON.stringify(body));
    assert.equal(body.operation, id);
    assert.equal(h.consumed.length, 1);
    assert.equal(h.consumed[0].operation, id);
    assert.equal(h.consumed[0].input_sha256, await argumentDigest(args));
    assert.equal(h.consumed[0].contract_sha256, op.contract_sha256);
    assert.equal(h.finished.length, 1);
    assert.equal(h.finished[0].result_sha256, await argumentDigest(body));
    assert.equal(h.finished[0].outcome, "succeeded");
    for (const event of ["credential", "probe", "ssh", "winrm", "metadata"]) {
      if (h.events.includes(event)) {
        assert(h.events.indexOf("consume") < h.events.indexOf(event));
      }
    }
    assert(!JSON.stringify(body).includes("synthetic-private"));
    assert(!JSON.stringify(body).includes("private stdout"));
    assert(!JSON.stringify(body).includes(command));
  }
});
Deno.test("explicit approved native output is returned through the same execution contract and digest-bound receipt", async () => {
  for (const id of ["gcp.vm.ssh.exec", "gcp.vm.winrm.exec", "cloud.vm.exec"]) {
    const h = await harness();
    const response = await h.call(id, { ...argsFor(id), include_output: true });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.contract_version, "1.1.0");
    assert.equal(new TextDecoder().decode(decode64(body.result.stdout_base64)), "private stdout");
    assert.equal(body.result.stderr_base64, "");
    assert.equal(h.finished[0].result_sha256, await argumentDigest(body));
    assert.equal(h.consumed[0].input_sha256, await argumentDigest({ ...argsFor(id), include_output: true }));
    assert(!JSON.stringify(body).includes("synthetic-private"));
  }
});
Deno.test("compiled owner policy cannot drift approval, delegation, session, schema or handler metadata", () => {
  const op = protocolContracts["gcp.vm.ssh.exec"],
    row = {
      ...op,
      api_exposed: true,
      verified: true,
      error_contract: {
        contract_sha256: op.contract_sha256,
        requires_approval: true,
        requires_grant: true,
        requires_real_user_session: true,
        api_key_delegable: false,
      },
    };
  assert(protocolContractEnabled(row, op));
  for (
    const bad of [{ ...row, handler: "legacy" }, { ...row, input_schema: {} }, {
      ...row,
      verified: false,
    }, {
      ...row,
      error_contract: { ...row.error_contract, requires_approval: false },
    }, {
      ...row,
      error_contract: { ...row.error_contract, api_key_delegable: true },
    }, {
      ...row,
      error_contract: {
        ...row.error_contract,
        requires_real_user_session: false,
      },
    }]
  ) assert(!protocolContractEnabled(bad, op));
});
Deno.test("owner denial, delegated identity, foreign resource and caller transport knobs refuse before consumption", async () => {
  const denied = await harness({
    authorizeContext: async () => ({ allowed: false, error: "owner_refused" }),
  });
  assert.equal((await denied.call("gcp.vm.ssh.exec")).status, 403);
  assert.equal(denied.consumed.length, 0);
  for (
    const [args, extra] of [[{ vm_name: "foreign", command }, {}], [{
      vm_name: "sandy-video",
      command,
      host: "169.254.169.254",
    }, {}], [argsFor("gcp.vm.ssh.exec"), {
      credential_id: crypto.randomUUID(),
    }], [argsFor("gcp.vm.ssh.exec"), { tenant_id: crypto.randomUUID() }]] as [
      Obj,
      Obj,
    ][]
  ) {
    const h = await harness();
    assert((await h.call("gcp.vm.ssh.exec", args, extra)).status >= 400);
    assert.equal(h.consumed.length, 0);
    assert(!h.events.includes("credential"));
  }
});
Deno.test("changed binding or command digest and a refused durable attempt never reach provider execution", async () => {
  for (const mode of ["binding", "command", "attempt"]) {
    let reads = 0;
    const h = await harness();
    const base = h.deps.resolveExecution;
    if (mode === "attempt") {
      h.deps.claimExecution = async () => {
        throw new ProtocolRefusal("vm_execution_attempt_replay_refused");
      };
    } else {h.deps.resolveExecution = async (c) => {
        reads++;
        const v = await base(c) as Obj;
        return mode === "command"
          ? { ...v, command_sha256: "f".repeat(64) }
          : reads > 1
          ? { ...v, binding: { ...linux, version: crypto.randomUUID() } }
          : v;
      };}
    const r = await h.call("gcp.vm.ssh.exec");
    assert(r.status >= 400);
    assert(!h.events.includes("ssh"));
    assert(!h.events.includes("winrm"));
    assert.equal(h.finished.length, 1);
  }
});
Deno.test("known nonzero remote exit is failed with executed true and private output capture; no no-effect claim", async () => {
  const h = await harness({
    sshExecute: async () => ({
      protocol: "ssh2",
      exit_code: 7,
      stdout: new TextEncoder().encode("sensitive output"),
      stderr: new Uint8Array(),
      host_key_verified: true,
    }),
  });
  const r = await h.call("gcp.vm.ssh.exec"), body = await r.json();
  assert.equal(r.status, 422);
  assert.equal(body.executed, true);
  assert.equal(body.error, "remote_command_failed");
  assert.equal(body.result.exit_code, 7);
  assert.equal(h.finished[0].outcome, "failed");
  assert.equal(h.captures.length, 1);
  assert(!JSON.stringify(body).includes("sensitive output"));
});
Deno.test("unknown command, cleanup, capture or final receipt never returns payload or retries effects", async () => {
  for (const mode of ["transport", "cleanup", "capture", "finish"]) {
    let effects = 0;
    const h = await harness();
    h.deps.sshExecute = async () => {
      effects++;
      if (mode === "transport" || mode === "cleanup") {
        throw new ProtocolRefusal(
          "synthetic_outcome_unknown",
          true,
          mode === "cleanup",
        );
      }
      return {
        protocol: "ssh2",
        exit_code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
        host_key_verified: true,
      };
    };
    if (mode === "capture") {
      h.deps.saveResult = async () => {
        throw Error("synthetic private material");
      };
    }
    if (mode === "finish") {
      h.deps.finishExecution = async () => ({ allowed: false });
    }
    const r = await h.call("gcp.vm.ssh.exec"), body = await r.json();
    assert.equal(r.status, 503);
    assert.equal(body.executed, null);
    assert.equal(body.reconciliation_required, true);
    assert.equal(effects, 1);
    assert.equal(body.result, undefined);
    assert(!JSON.stringify(body).includes("private material"));
  }
});
Deno.test("active credential refusal never falls back to VM credentials or dispatch, and failed enrollment never stores a binding", async () => {
  const h = await harness({
    credentialForExecution: async () => {
      throw Error("active version refused");
    },
  });
  const r = await h.call("gcp.vm.ssh.exec");
  assert.equal(r.status, 424);
  assert.equal(h.finished[0].outcome, "failed");
  assert(!h.events.includes("private-auth"));
  assert(!h.events.includes("ssh"));
  const f = await harness({
    verifySshIdentity: async () => {
      throw new ProtocolRefusal("ssh_host_key_mismatch");
    },
  });
  assert.equal((await f.call("gcp.vm.protocol_bindings.enroll")).status, 424);
  assert(!f.events.includes("metadata"));
  assert(!f.events.includes("private-auth"));
});
Deno.test("scope and durable claim precede remote execution; private envelope pins original target and command digest", async () => {
  const h = await harness(), args = argsFor("cloud.vm.exec");
  const r = await h.call("cloud.vm.exec");
  assert.equal(r.status, 200);
  assert.equal(
    h.consumed[0].scope_sha256,
    await argumentDigest(
      protocolExecutionScope("cloud.vm.exec", args, { "sandy-video": linux }),
    ),
  );
  assert(h.events.indexOf("claim") < h.events.indexOf("credential"));
  assert(h.events.indexOf("compute") < h.events.indexOf("private-auth"));
  assert(h.events.indexOf("capture") < h.events.indexOf("finish"));
  const privatePayload = JSON.parse(
    new TextDecoder().decode(decode64(h.captures[0].payload_base64)),
  );
  assert.equal(
    privatePayload.command_sha256,
    await bytesDigest(new TextEncoder().encode(command)),
  );
  assert.equal(privatePayload.protocol, "ssh2");
  assert.equal(canonicalJson(args).includes("password"), false);
});
Deno.test("governed native transports receive a fresh same-command same-binding check at the actual dispatch boundary", async () => {
  for (const operation of ["gcp.vm.ssh.exec", "gcp.vm.winrm.exec"]) {
    const h = await harness();
    const resolve = h.deps.resolveExecution;
    let connected = false, rechecks = 0;
    h.deps.resolveExecution = async (context) => {
      const current = await resolve(context) as Obj;
      if (connected) {
        rechecks++;
        return {...current,binding:{...current.binding as Obj,version:crypto.randomUUID()}};
      }
      return current;
    };
    const transport = async (_endpoint: unknown, _command: string, options: {beforeCommand?: () => Promise<void>} = {}) => {
      connected = true;
      assert.equal(typeof options.beforeCommand,"function");
      await options.beforeCommand!();
      throw Error("revoked native command must never dispatch");
    };
    h.deps.sshExecute = transport;
    h.deps.winrmExecute = transport;
    const response = await h.call(operation);
    assert.equal(response.status,424);
    assert.equal(rechecks,1);
    assert.equal(h.finished[0].outcome,"failed");
    assert.deepEqual(h.captures,[]);
  }
});
