/** Actual SSHv2 transport. Private endpoint/auth values never enter API results. */
// @ts-types="npm:@types/ssh2@1.15.5"
import ssh2 from "npm:ssh2@1.17.0";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { ClientChannel } from "npm:@types/ssh2@1.15.5";
import type { Duplex } from "node:stream";

import { ProtocolRefusal } from "./errors.ts";
export { ProtocolRefusal } from "./errors.ts";
export type SshEndpoint = {
  address: string;
  port: number;
  username: string;
  privateKey: string;
  hostKeySha256: string;
  stream?: Duplex;
};
export type SshResult = {
  exit_code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  host_key_verified: true;
  protocol: "ssh2";
};
const fail = (code: string): never => {
  throw new ProtocolRefusal(code);
};
function hostPin(value: string): Buffer {
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(value)) {
    fail("verified_ssh_host_key_binding_required");
  }
  const pin = Buffer.from(value.slice(7) + "=", "base64");
  if (
    pin.length !== 32 ||
    pin.toString("base64").replace(/=+$/, "") !== value.slice(7)
  ) fail("verified_ssh_host_key_binding_required");
  return pin;
}
/** Production callers supply only a fresh fixed-VM proven numeric address/port22. */
export async function sshExecute(
  endpoint: SshEndpoint,
  command: string,
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<SshResult> {
  const timeoutMs = options.timeoutMs ?? 30000,
    max = options.maxOutputBytes ?? 65536;
  if (
    isIP(endpoint.address) !== 4 || !Number.isSafeInteger(endpoint.port) ||
    endpoint.port < 1 || endpoint.port > 65535
  ) fail("verified_ssh_endpoint_required");
  if (
    !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(endpoint.username) ||
    typeof endpoint.privateKey !== "string" ||
    endpoint.privateKey.length > 20000 ||
    !endpoint.privateKey.includes("PRIVATE KEY-----")
  ) fail("private_ssh_authentication_binding_required");
  if (
    typeof command !== "string" || !command.length ||
    new TextEncoder().encode(command).length > 16384 || command.includes("\0")
  ) fail("bounded_ssh_command_required");
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000 ||
    !Number.isSafeInteger(max) || max < 1 || max > 65536
  ) fail("bounded_ssh_transport_required");
  const expectedPin = hostPin(endpoint.hostKeySha256);
  return await new Promise<SshResult>((resolve, reject) => {
    const client = new ssh2.Client();
    let stream: ClientChannel | undefined,
      executed = false,
      hostVerified = false,
      hostRefused = false,
      done = false;
    let code: number | undefined, signal: string | undefined, total = 0;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const settle = (error?: ProtocolRefusal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error && executed) {
        try {
          stream?.signal("TERM");
        } catch { /* termination cannot certify outcome */ }
      }
      client.destroy();
      if (error) reject(error);
      else {resolve({
          exit_code: code!,
          stdout: new Uint8Array(Buffer.concat(stdout)),
          stderr: new Uint8Array(Buffer.concat(stderr)),
          host_key_verified: true,
          protocol: "ssh2",
        });}
    };
    const timer = setTimeout(
      () =>
        settle(
          new ProtocolRefusal(
            executed
              ? "ssh_execution_outcome_unknown"
              : "ssh_connection_timeout",
            executed,
          ),
        ),
      timeoutMs,
    );
    const collect = (parts: Buffer[], chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > max) {
        settle(
          new ProtocolRefusal("ssh_output_limit_outcome_unknown", executed),
        );
        return;
      }
      parts.push(Buffer.from(chunk));
    };
    client.on(
      "error",
      () =>
        settle(
          new ProtocolRefusal(
            hostRefused
              ? "ssh_host_key_mismatch"
              : executed
              ? "ssh_execution_outcome_unknown"
              : "ssh_authentication_or_transport_refused",
            executed,
          ),
        ),
    );
    client.on("close", () => {
      if (!done) {
        settle(
          new ProtocolRefusal(
            executed
              ? "ssh_execution_outcome_unknown"
              : "ssh_connection_closed",
            executed,
          ),
        );
      }
    });
    client.on("ready", () => {
      if (done) return;
      if (!hostVerified) {
        settle(new ProtocolRefusal("ssh_host_key_mismatch"));
        return;
      }
      // Mark possible effects before sending exec, including lost acknowledgements.
      executed = true;
      client.exec(command, { pty: false }, (error, channel) => {
        if (done) {
          channel?.close();
          return;
        }
        if (error) {
          settle(new ProtocolRefusal("ssh_execution_outcome_unknown", true));
          return;
        }
        stream = channel;
        channel.on("data", (chunk: Buffer) => collect(stdout, chunk));
        channel.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
        channel.on(
          "exit",
          (exitCode: number | undefined, exitSignal: string | undefined) => {
            code = exitCode;
            signal = exitSignal;
          },
        );
        channel.on(
          "error",
          () =>
            settle(new ProtocolRefusal("ssh_execution_outcome_unknown", true)),
        );
        channel.on("close", () => {
          if (done) return;
          if (
            signal || !Number.isSafeInteger(code) || code! < 0 ||
            code! > 2147483647
          ) {
            settle(new ProtocolRefusal("ssh_execution_outcome_unknown", true));
            return;
          }
          settle();
        });
        channel.end();
      });
    });
    try {
      client.connect({
        ...(endpoint.stream ? { sock: endpoint.stream } : {}),
        host: endpoint.address,
        port: endpoint.port,
        username: endpoint.username,
        privateKey: endpoint.privateKey,
        hostVerifier: (key: Buffer) => {
          const actual = createHash("sha256").update(key).digest();
          hostVerified = timingSafeEqual(actual, expectedPin);
          hostRefused = !hostVerified;
          return hostVerified;
        },
        readyTimeout: Math.min(timeoutMs, 10000),
        keepaliveInterval: 0,
        agentForward: false,
        tryKeyboard: false,
        algorithms: {
          serverHostKey: ["ssh-ed25519", "rsa-sha2-512", "rsa-sha2-256"],
          kex: [
            "curve25519-sha256",
            "curve25519-sha256@libssh.org",
            "ecdh-sha2-nistp256",
            "diffie-hellman-group14-sha256",
          ],
        },
      });
    } catch {
      settle(
        new ProtocolRefusal("private_ssh_authentication_or_transport_invalid"),
      );
    }
  });
}

/** Ephemeral technical identity for an approved OS Login execution, never a user session. */
export function ephemeralSshKey() {
  // ssh2 1.17 trims all leading zero bytes from the Ed25519 BIT STRING,
  // occasionally producing a malformed key. Reject locally before any OS Login
  // enrollment. Regeneration has no remote effect and is strictly bounded.
  for (let attempt = 0; attempt < 8; attempt++) {
    const pair = ssh2.utils.generateKeyPairSync("ed25519");
    const parsed = ssh2.utils.parseKey(pair.private);
    if (!(parsed instanceof Error) && !Array.isArray(parsed) &&
        pair.public === parsed.type + " " + parsed.getPublicSSH().toString("base64")) {
      return { publicKey: pair.public, privateKey: pair.private };
    }
  }
  throw new ProtocolRefusal("ephemeral_ssh_key_generation_invalid");
}

/** Prove possession of the already owner-pinned host key, stopping before user authentication. */
export async function verifySshEndpointIdentity(
  address: string,
  port: number,
  pin: string,
  stream?: Duplex,
): Promise<void> {
  if (
    isIP(address) !== 4 || !Number.isSafeInteger(port) || port < 1 ||
    port > 65535
  ) fail("verified_ssh_endpoint_required");
  const expected = hostPin(pin);
  await new Promise<void>((resolve, reject) => {
    const client = new ssh2.Client();
    let verified = false, done = false;
    const finish = (code?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.destroy();
      if (code) reject(new ProtocolRefusal(code));
      else resolve();
    };
    const timer = setTimeout(() => finish("ssh_identity_probe_timeout"), 10000);
    client.on("handshake", () => {
      if (verified) finish();
      else finish("ssh_host_key_mismatch");
    });
    client.on("error", () => finish("ssh_identity_probe_refused"));
    client.on("close", () => {
      if (!done) finish("ssh_identity_probe_refused");
    });
    try {
      client.connect({
        ...(stream ? { sock: stream } : {}),
        host: address,
        port,
        username: "sandy_identity_probe",
        authHandler: [],
        hostVerifier: (key: Buffer) => {
          verified = timingSafeEqual(
            createHash("sha256").update(key).digest(),
            expected,
          );
          return verified;
        },
        readyTimeout: 10000,
        keepaliveInterval: 0,
        algorithms: {
          serverHostKey: ["ssh-ed25519", "rsa-sha2-512", "rsa-sha2-256"],
          kex: [
            "curve25519-sha256",
            "curve25519-sha256@libssh.org",
            "ecdh-sha2-nistp256",
            "diffie-hellman-group14-sha256",
          ],
        },
      });
    } catch {
      finish("ssh_identity_probe_refused");
    }
  });
}
