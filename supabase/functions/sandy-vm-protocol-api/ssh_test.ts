import assert from "node:assert/strict";
// @ts-types="npm:@types/ssh2@1.15.5"
import ssh2 from "npm:ssh2@1.17.0";
import { createHash, timingSafeEqual } from "node:crypto";
import { connect } from "node:net";
import { once } from "node:events";
import { createProtocolHandler } from "./index.ts";
import {
  bytesDigest,
  decode64,
} from "../sandy-provider-supplement-api/runtime.ts";
import { type Obj, PROJECT, VMS, ZONE } from "./bindings.ts";
import {
  ephemeralSshKey,
  ProtocolRefusal,
  sshExecute,
  verifySshEndpointIdentity,
} from "./ssh.ts";
type Mode = "success" | "disconnect" | "overflow" | "hang" | "maximum";
Deno.test("SSH: supplied private tunnel stream retains host verification, real output and disconnect", async () => {
  const f = await fixture();
  const stream = connect({ host: "127.0.0.1", port: f.endpoint.port });
  await once(stream, "connect");
  try {
    const result = await sshExecute({ ...f.endpoint, address: "10.132.0.2", port: 22, stream }, "whoami");
    assert.equal(result.exit_code, 7);
    assert.equal(new TextDecoder().decode(result.stdout), "synthetic stdout");
    assert.deepEqual(f.commands, ["whoami"]);
  } finally { stream.destroy(); await f.close(); }
});
async function fixture(mode: Mode = "success") {
  const host = ephemeralSshKey(),
    user = ephemeralSshKey(),
    parsed = ssh2.utils.parseKey(user.privateKey);
  if (parsed instanceof Error) throw Error("synthetic_ssh_key_parse_failed");
  let executions = 0, authentications = 0;
  const commands: string[] = [],
    clients: { end: () => void }[] = [];
  const server = new ssh2.Server({ hostKeys: [host.privateKey] }, (client) => {
    clients.push(client);
    client.on("error", () => undefined);
    client.on("authentication", (ctx) => {
      authentications++;
      if (
        ctx.method !== "publickey" || ctx.username !== "synthetic_user" ||
        !timingSafeEqual(ctx.key.data, parsed.getPublicSSH())
      ) return ctx.reject();
      if (
        !ctx.signature ||
        parsed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true
      ) ctx.accept();
      else ctx.reject();
    });
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (accept, _reject, info) => {
          executions++;
          commands.push(info.command);
          const channel = accept();
          if (mode === "disconnect") {
            client.end();
            return;
          }
          if (mode === "overflow") {
            channel.write(Buffer.alloc(70000));
            return;
          }
          if (mode === "hang") return;
          if (mode === "maximum") {
            channel.write(Buffer.alloc(65536, 120));
            channel.exit(0);
            channel.end();
            return;
          }
          channel.write("synthetic stdout");
          channel.stderr.write("synthetic stderr");
          channel.exit(7);
          channel.end();
        });
      }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw Error("synthetic_ssh_listener_failed");
  }
  const hostKey = ssh2.utils.parseKey(host.privateKey);
  if (hostKey instanceof Error) throw Error("synthetic_host_key_parse_failed");
  const pin = "SHA256:" +
    createHash("sha256").update(hostKey.getPublicSSH()).digest("base64")
      .replace(/=+$/, "");
  return {
    endpoint: {
      address: "127.0.0.1",
      port: address.port,
      username: "synthetic_user",
      privateKey: user.privateKey,
      hostKeySha256: pin,
    },
    commands,
    counts: () => ({ executions, authentications }),
    close: async () => {
      for (const client of clients) client.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };
}
Deno.test("SSH: actual pinned-host public-key handshake executes exact approved command with separate bounded streams and exit status", async () => {
  const f = await fixture();
  try {
    const result = await sshExecute(
      f.endpoint,
      "printf synthetic-approved-command",
    );
    assert.equal(result.protocol, "ssh2");
    assert.equal(result.host_key_verified, true);
    assert.equal(result.exit_code, 7);
    assert.equal(new TextDecoder().decode(result.stdout), "synthetic stdout");
    assert.equal(new TextDecoder().decode(result.stderr), "synthetic stderr");
    assert.deepEqual(f.commands, ["printf synthetic-approved-command"]);
  } finally {
    await f.close();
  }
});
Deno.test("SSH: actual governed handler composes synthetic owner/grant policy with real pinned loopback command once and private output custody", async () => {
  const f = await fixture(),
    actor = crypto.randomUUID(),
    admission = crypto.randomUUID(),
    bindingId = crypto.randomUUID(),
    command = "printf synthetic-governed-command",
    sha = await bytesDigest(new TextEncoder().encode(command)),
    events: string[] = [],
    binding = {
      verified: true as const,
      version: bindingId,
      instance_id: VMS["sandy-video"].instance_id,
      ssh: {
        mode: "private_key" as const,
        host_key_sha256: f.endpoint.hostKeySha256,
      },
    };
  let captures = 0, finishes = 0;
  try {
    const handler = createProtocolHandler({
      service: "synthetic",
      publicBindings: async () => ({ "sandy-video": binding }),
      authorizeContext: async () => ({ allowed: true }),
      consumeGrant: async () => {
        events.push("consume");
        return { allowed: true, admission_id: admission };
      },
      resolveExecution: async () => ({
        vm_name: "sandy-video",
        binding,
        command,
        command_sha256: sha,
      }),
      claimExecution: async () => {
        events.push("claim");
      },
      credentialForExecution: async () => {
        events.push("credential");
        return "synthetic";
      },
      privateAuthentication: () =>
        JSON.stringify({
          "sandy-video": {
            version: bindingId,
            username: f.endpoint.username,
            private_key: f.endpoint.privateKey,
          },
        }),
      fetch: async () =>
        Response.json({
          id: VMS["sandy-video"].instance_id,
          name: "sandy-video",
          status: "RUNNING",
          zone:
            `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}`,
          serviceAccounts: [{
            email: `sandy-vm-runtime@${PROJECT}.iam.gserviceaccount.com`,
          }],
          networkInterfaces: [{ accessConfigs: [{ natIP: "34.0.0.10" }] }],
        }),
      sshExecute: async (endpoint, actual) => {
        assert.equal(endpoint.address, "34.0.0.10");
        assert.equal(endpoint.port, 22);
        assert.equal(endpoint.privateKey, f.endpoint.privateKey);
        events.push("exec");
        return await sshExecute({
          ...endpoint,
          address: f.endpoint.address,
          port: f.endpoint.port,
        }, actual);
      },
      saveResult: async (_c, result) => {
        captures++;
        const captured = JSON.parse(
          new TextDecoder().decode(decode64(result.payload_base64)),
        );
        assert.equal(captured.exit_code, 7);
        assert.equal(
          new TextDecoder().decode(decode64(captured.stdout_base64)),
          "synthetic stdout",
        );
        return {
          custody_id: crypto.randomUUID(),
          sha256: result.payload_sha256,
          byte_length: result.byte_length,
        };
      },
      finishExecution: async (r) => {
        finishes++;
        assert.equal(r.outcome, "failed");
        return { allowed: true };
      },
      metadata: async () => {
        throw Error("not a metadata operation");
      },
    });
    const r = await handler(
        new Request("https://local.invalid", {
          method: "POST",
          headers: { authorization: "Bearer synthetic" },
          body: JSON.stringify({
            operation: "gcp.vm.ssh.exec",
            arguments: { vm_name: "sandy-video", command },
            actor_id: actor,
            tenant_id: null,
            credential_id: null,
            request_id: crypto.randomUUID(),
            grant_id: crypto.randomUUID(),
            admission_id: admission,
          }),
        }),
      ),
      body = await r.json();
    assert.equal(r.status, 422);
    assert.equal(body.executed, true);
    assert.equal(body.result.exit_code, 7);
    assert.equal(captures, 1);
    assert.equal(finishes, 1);
    assert.deepEqual(f.commands, [command]);
    assert.deepEqual(events, ["consume", "claim", "credential", "exec"]);
    assert(!JSON.stringify(body).includes("synthetic stdout"));
    assert(!JSON.stringify(body).includes("PRIVATE KEY"));
  } finally {
    await f.close();
  }
});
Deno.test("SSH: wrong host key refuses before authentication or exec and reveals no private material", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () =>
        sshExecute(
          { ...f.endpoint, hostKeySha256: "SHA256:" + "A".repeat(43) },
          "synthetic",
        ),
      (e) =>
        e instanceof ProtocolRefusal && e.code === "ssh_host_key_mismatch" &&
        !e.mayHaveExecuted,
    );
    assert.equal(f.counts().executions, 0);
    assert.equal(f.counts().authentications, 0);
  } finally {
    await f.close();
  }
});
Deno.test("SSH: enrollment proves the supplied host key without user authentication, command or first-use trust", async () => {
  const f = await fixture();
  try {
    await verifySshEndpointIdentity(
      f.endpoint.address,
      f.endpoint.port,
      f.endpoint.hostKeySha256,
    );
    assert.equal(f.counts().authentications, 0);
    assert.equal(f.counts().executions, 0);
  } finally {
    await f.close();
  }
});
Deno.test("SSH: wrong user key never executes; lost exec acknowledgement remains unknown without redispatch", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () =>
        sshExecute(
          { ...f.endpoint, privateKey: ephemeralSshKey().privateKey },
          "synthetic",
        ),
      (e) => e instanceof ProtocolRefusal && !e.mayHaveExecuted,
    );
    assert.equal(f.counts().executions, 0);
  } finally {
    await f.close();
  }
  const g = await fixture("disconnect");
  try {
    await assert.rejects(
      () => sshExecute(g.endpoint, "synthetic"),
      (e) => e instanceof ProtocolRefusal && e.mayHaveExecuted,
    );
    assert.equal(g.counts().executions, 1);
  } finally {
    await g.close();
  }
});
Deno.test("SSH: output overflow and execution timeout refuse as unknown and never retry the command", async () => {
  for (const mode of ["overflow", "hang"] as const) {
    const f = await fixture(mode);
    try {
      await assert.rejects(
        () => sshExecute(f.endpoint, "synthetic", { timeoutMs: 3000 }),
        (e) => e instanceof ProtocolRefusal && e.mayHaveExecuted,
      );
      assert.equal(f.counts().executions, 1);
    } finally {
      await f.close();
    }
  }
});
Deno.test("SSH: exact combined64KiB output cap is accepted in a real identity-pinned session", async () => {
  const f = await fixture("maximum");
  try {
    const result = await sshExecute(f.endpoint, "printf synthetic-maximum");
    assert.equal(result.stdout.length, 65536);
    assert.equal(result.stderr.length, 0);
    assert.equal(result.exit_code, 0);
    assert.equal(f.counts().executions, 1);
  } finally {
    await f.close();
  }
});

Deno.test("SSH: invalid generated keys are rejected locally before a bounded replacement is returned",()=>{
 const generate=ssh2.utils.generateKeyPairSync;
 const valid=ephemeralSshKey();let calls=0;
 try {
  ssh2.utils.generateKeyPairSync=(()=>{calls++;return calls===1?{public:"invalid",private:"invalid"}:{public:valid.publicKey,private:valid.privateKey};}) as typeof generate;
  assert.deepEqual(ephemeralSshKey(),valid);assert.equal(calls,2);
  calls=0;
  ssh2.utils.generateKeyPairSync=(()=>{calls++;return {public:"invalid",private:"invalid"};}) as typeof generate;
  assert.throws(()=>ephemeralSshKey(),(e)=>e instanceof ProtocolRefusal&&e.code==="ephemeral_ssh_key_generation_invalid"&&!e.mayHaveExecuted);
  assert.equal(calls,8);
 } finally {ssh2.utils.generateKeyPairSync=generate;}
});
