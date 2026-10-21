import assert from "node:assert/strict";
import { connect } from "node:net";
import { once } from "node:events";

Deno.test("WinRM: pinned TLS over supplied private streams preserves WSMan lifecycle and exact result", async () => {
  const f = await fixture(); let opened = 0;
  try {
    const result = await winrmExecute({ ...f.endpoint, address: "10.132.0.3", port: 5986,
      openStream: async () => { opened++; const socket = connect({ host: "127.0.0.1", port: f.endpoint.port }); await once(socket, "connect"); return socket; },
    }, "whoami");
    assert.equal(result.exit_code, 7);
    assert.equal(new TextDecoder().decode(result.stdout), "synthetic stdout");
    assert.deepEqual(f.commands, ["whoami"]); assert.equal(opened, 5);
  } finally { await f.close(); }
});
import { X509Certificate } from "node:crypto";
import { winrmExecute } from "./winrm.ts";
import { ProtocolRefusal } from "./ssh.ts";
import { verifyWinrmEndpointIdentity } from "./tls_http.ts";
import { createProtocolHandler } from "./index.ts";
import {
  bytesDigest,
  decode64,
} from "../sandy-provider-supplement-api/runtime.ts";
import { PROJECT, VMS, ZONE } from "./bindings.ts";
const S = "http://www.w3.org/2003/05/soap-envelope",
  A = "http://schemas.xmlsoap.org/ws/2004/08/addressing",
  W = "http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd",
  R = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell";
type Mode =
  | "success"
  | "redirect"
  | "wrong_binding"
  | "entities"
  | "wrong_command"
  | "overflow"
  | "delete_fail";
async function fixture(mode: Mode = "success") {
  const dir = await Deno.makeTempDir({ prefix: "sandy-winrm-synthetic-" }),
    keyPath = dir + "/key.pem",
    certPath = dir + "/cert.pem";
  const result = await new Deno.Command("openssl", {
    args: [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      "/CN=fixture.internal",
      "-addext",
      "subjectAltName=DNS:fixture.internal",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
    ],
    stdout: "null",
    stderr: "null",
  }).output();
  if (!result.success) throw Error("synthetic_tls_fixture_generation_failed");
  const key = await Deno.readTextFile(keyPath),
    cert = await Deno.readTextFile(certPath),
    shell = crypto.randomUUID(),
    command = crypto.randomUUID(),
    requests: string[] = [],
    commands: string[] = [];
  let receives = 0;
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    key,
    cert,
    onListen() {},
  }, async (request) => {
    assert.equal(request.method, "POST");
    assert.equal(new URL(request.url).pathname, "/wsman");
    assert.equal(
      request.headers.get("authorization"),
      "Basic " + btoa("fixture_user:synthetic_password"),
    );
    const text = await request.text(),
      action = /<a:Action[^>]*>([^<]+)<\/a:Action>/.exec(text)?.[1],
      id = /<a:MessageID>([^<]+)<\/a:MessageID>/.exec(text)?.[1];
    assert(action && id);
    const kind = action.slice(action.lastIndexOf("/") + 1);
    requests.push(kind);
    if (mode === "redirect") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "https://foreign.invalid/wsman?secret=not-returned",
        },
      });
    }
    if (mode === "delete_fail" && kind === "Delete") {
      return new Response("synthetic private error body", { status: 500 });
    }
    let body = "";
    if (kind === "Create") {
      body =
        `<w:ResourceCreated><w:SelectorSet><w:Selector Name="ShellId">${shell}</w:Selector></w:SelectorSet></w:ResourceCreated>`;
    } else {
      assert(text.includes(`<w:Selector Name="ShellId">${shell}</w:Selector>`));
      if (kind === "Command") {
        const encoded =
          /<rsp:Arguments>-NoLogo -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)<\/rsp:Arguments>/
            .exec(text)?.[1];
        assert(encoded);
        commands.push(Buffer.from(encoded, "base64").toString("utf16le"));
        body =
          `<rsp:CommandResponse><rsp:CommandId>${command}</rsp:CommandId></rsp:CommandResponse>`;
      } else if (kind === "Receive") {
        assert(text.includes(`CommandId="${command}"`));
        receives++;
        const payload = Buffer.from(
            mode === "overflow"
              ? "x".repeat(100)
              : receives === 1
              ? "synthetic stdout"
              : "synthetic stderr",
          ).toString("base64"),
          outputId = mode === "wrong_command" ? crypto.randomUUID() : command;
        body = `<rsp:ReceiveResponse><rsp:Stream Name="${
          receives === 1 ? "stdout" : "stderr"
        }" CommandId="${outputId}">${payload}</rsp:Stream><rsp:CommandState CommandId="${command}" State="${R}/CommandState/${
          receives === 1 ? "Running" : "Done"
        }">${
          receives === 2 ? "<rsp:ExitCode>7</rsp:ExitCode>" : ""
        }</rsp:CommandState></rsp:ReceiveResponse>`;
      } else assert.equal(kind, "Delete");
    }
    let output =
      `<s:Envelope xmlns:s="${S}" xmlns:a="${A}" xmlns:w="${W}" xmlns:rsp="${R}"><s:Header><a:Action>${action}Response</a:Action><a:RelatesTo>${
        mode === "wrong_binding" ? "uuid:" + crypto.randomUUID() : id
      }</a:RelatesTo></s:Header><s:Body>${body}</s:Body></s:Envelope>`;
    if (mode === "entities") {
      output = '<!DOCTYPE test [<!ENTITY x SYSTEM "file:///private">]>' +
        output;
    }
    return new Response(output, {
      headers: { "content-type": "application/soap+xml; charset=UTF-8" },
    });
  });
  return {
    endpoint: {
      address: "127.0.0.1",
      port: server.addr.port,
      serverName: "fixture.internal",
      certificatePem: cert,
      certificateSha256: new X509Certificate(cert).fingerprint256.replaceAll(
        ":",
        "",
      ).toLowerCase(),
      username: "fixture_user",
      password: "synthetic_password",
    },
    requests,
    commands,
    close: async () => {
      await server.shutdown();
      await Deno.remove(dir, { recursive: true });
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };
}
Deno.test("WinRM: actual pinned TLS WSMan Create/Command/twoReceive/Delete preserves exact command and bounded streams", async () => {
  const f = await fixture();
  try {
    const result = await winrmExecute(
      f.endpoint,
      "Write-Output 'synthetic approved command'",
    );
    assert.equal(result.protocol, "winrm_https");
    assert.equal(result.exit_code, 7);
    assert.equal(new TextDecoder().decode(result.stdout), "synthetic stdout");
    assert.equal(new TextDecoder().decode(result.stderr), "synthetic stderr");
    assert(result.shell_deleted);
    assert.deepEqual(f.commands, ["Write-Output 'synthetic approved command'"]);
    assert.deepEqual(f.requests, [
      "Create",
      "Command",
      "Receive",
      "Receive",
      "Delete",
    ]);
  } finally {
    await f.close();
  }
});
Deno.test("WinRM: actual governed handler composes synthetic policy with pinned local TLS shell once, deletion and private output receipt", async () => {
  const f = await fixture(),
    actor = crypto.randomUUID(),
    admission = crypto.randomUUID(),
    bindingId = crypto.randomUUID(),
    command = "Write-Output 'synthetic governed command'",
    sha = await bytesDigest(new TextEncoder().encode(command)),
    binding = {
      verified: true as const,
      version: bindingId,
      instance_id: VMS["sandy-windows"].instance_id,
      winrm: {
        server_name: f.endpoint.serverName,
        certificate_pem: f.endpoint.certificatePem,
        certificate_sha256: f.endpoint.certificateSha256,
      },
    },
    events: string[] = [];
  let captures = 0, finishes = 0;
  try {
    const handler = createProtocolHandler({
      service: "synthetic",
      publicBindings: async () => ({ "sandy-windows": binding }),
      authorizeContext: async () => ({ allowed: true }),
      consumeGrant: async () => {
        events.push("consume");
        return { allowed: true, admission_id: admission };
      },
      resolveExecution: async () => ({
        vm_name: "sandy-windows",
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
          "sandy-windows": {
            version: bindingId,
            username: f.endpoint.username,
            password: f.endpoint.password,
          },
        }),
      fetch: async () =>
        Response.json({
          id: VMS["sandy-windows"].instance_id,
          name: "sandy-windows",
          status: "RUNNING",
          zone:
            `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}`,
          serviceAccounts: [{
            email: `sandy-vm-runtime@${PROJECT}.iam.gserviceaccount.com`,
          }],
          networkInterfaces: [{ accessConfigs: [{ natIP: "34.0.0.10" }] }],
        }),
      winrmExecute: async (endpoint, actual) => {
        assert.equal(endpoint.address, "34.0.0.10");
        assert.equal(endpoint.port, 5986);
        assert.equal(endpoint.password, f.endpoint.password);
        events.push("exec");
        return await winrmExecute({
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
        assert.equal(result.public_metadata.shell_deleted, true);
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
        throw Error("not metadata");
      },
    });
    const r = await handler(
        new Request("https://local.invalid", {
          method: "POST",
          headers: { authorization: "Bearer synthetic" },
          body: JSON.stringify({
            operation: "gcp.vm.winrm.exec",
            arguments: { vm_name: "sandy-windows", command },
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
    assert.equal(body.result.shell_deleted, true);
    assert.equal(captures, 1);
    assert.equal(finishes, 1);
    assert.deepEqual(events, ["consume", "claim", "credential", "exec"]);
    assert.deepEqual(f.commands, [command]);
    assert.deepEqual(f.requests, [
      "Create",
      "Command",
      "Receive",
      "Receive",
      "Delete",
    ]);
    assert(!JSON.stringify(body).includes("synthetic stdout"));
    assert(!JSON.stringify(body).includes("synthetic_password"));
  } finally {
    await f.close();
  }
});
Deno.test("WinRM: wrong pinned certificate refuses before HTTP credentials or shell creation", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () =>
        winrmExecute(
          { ...f.endpoint, certificateSha256: "f".repeat(64) },
          "synthetic",
        ),
      (e) => e instanceof ProtocolRefusal && !e.mayHaveExecuted,
    );
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
});
Deno.test("WinRM: enrollment validates supplied CA/hostname/pinned certificate with no HTTP or credentials", async () => {
  const f = await fixture();
  try {
    await verifyWinrmEndpointIdentity(f.endpoint);
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
});
Deno.test("WinRM: redirect, unrelated SOAP response and XML entities fail closed without command redispatch", async () => {
  for (const mode of ["redirect", "wrong_binding", "entities"] as const) {
    const f = await fixture(mode);
    try {
      await assert.rejects(
        () => winrmExecute(f.endpoint, "synthetic"),
        (e) =>
          e instanceof ProtocolRefusal && e.mayHaveExecuted &&
          !e.message.includes("private"),
      );
      assert.deepEqual(f.requests, ["Create"]);
      assert.equal(f.commands.length, 0);
    } finally {
      await f.close();
    }
  }
});
Deno.test("WinRM: foreign command/output overflow cleans shell once; failed Delete is never automatically retried", async () => {
  for (const mode of ["wrong_command", "overflow", "delete_fail"] as const) {
    const f = await fixture(mode);
    try {
      await assert.rejects(
        () =>
          winrmExecute(f.endpoint, "synthetic", {
            maxOutputBytes: mode === "overflow" ? 10 : 65536,
          }),
        (e) =>
          e instanceof ProtocolRefusal && e.mayHaveExecuted &&
          (mode !== "delete_fail" || e.cleanupRequired),
      );
      assert.equal(f.commands.length, 1);
      assert.equal(f.requests.filter((x) => x === "Delete").length, 1);
    } finally {
      await f.close();
    }
  }
});
