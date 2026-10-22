/** Private fixed-endpoint HTTPS SOAP transport; no redirect, DNS relay or auth downgrade. */
import tls from "node:tls";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { ProtocolRefusal } from "./errors.ts";
import type { Duplex } from "node:stream";
export type WinrmEndpoint = {
  address: string;
  port: number;
  serverName: string;
  certificatePem: string;
  certificateSha256: string;
  username: string;
  password: string;
  openStream?: () => Promise<Duplex>;
};
export type SoapHttpReply = { status: number; body: Uint8Array };
const MAX_BODY = 524288, MAX_HEADERS = 32768;
function parse(raw: Buffer): SoapHttpReply {
  const split = raw.indexOf("\r\n\r\n");
  if (split < 0 || split > MAX_HEADERS) {
    throw new ProtocolRefusal("winrm_http_response_invalid");
  }
  const lines = raw.subarray(0, split).toString("latin1").split("\r\n"),
    status = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: [\x20-\x7e]*)?$/.exec(
      lines.shift() ?? "",
    );
  if (!status) throw new ProtocolRefusal("winrm_http_response_invalid");
  const headers = new Map<string, string>();
  for (const line of lines) {
    const m = /^([A-Za-z0-9!#$%&'*+.^_`|~-]+):[ \t]*([^\r\n]*)$/.exec(line);
    if (!m) throw new ProtocolRefusal("winrm_http_response_invalid");
    const key = m[1].toLowerCase();
    if (
      headers.has(key) &&
      [
        "content-length",
        "transfer-encoding",
        "content-type",
        "content-encoding",
      ].includes(key)
    ) throw new ProtocolRefusal("winrm_http_response_invalid");
    headers.set(key, m[2].trim());
  }
  if (
    headers.has("content-encoding") &&
    headers.get("content-encoding") !== "identity"
  ) throw new ProtocolRefusal("winrm_compressed_response_refused");
  let body = raw.subarray(split + 4);
  if (headers.has("transfer-encoding")) {
    if (
      headers.get("transfer-encoding") !== "chunked" ||
      headers.has("content-length")
    ) throw new ProtocolRefusal("winrm_http_response_invalid");
    const parts: Buffer[] = [];
    let offset = 0, size = 0;
    while (true) {
      const end = body.indexOf("\r\n", offset);
      if (end < 0 || end - offset > 16) {
        throw new ProtocolRefusal("winrm_http_response_invalid");
      }
      const line = body.subarray(offset, end).toString("ascii");
      if (!/^[0-9a-fA-F]{1,8}$/.test(line)) {
        throw new ProtocolRefusal("winrm_http_response_invalid");
      }
      const n = parseInt(line, 16);
      offset = end + 2;
      if (n === 0) {
        if (body.subarray(offset).toString("ascii") !== "\r\n") {
          throw new ProtocolRefusal("winrm_http_trailer_refused");
        }
        break;
      }
      if (
        n > MAX_BODY || offset + n + 2 > body.length ||
        body.subarray(offset + n, offset + n + 2).toString("ascii") !== "\r\n"
      ) throw new ProtocolRefusal("winrm_http_response_invalid");
      size += n;
      if (size > MAX_BODY) {
        throw new ProtocolRefusal("winrm_response_size_limit");
      }
      parts.push(body.subarray(offset, offset + n));
      offset += n + 2;
    }
    body = Buffer.concat(parts);
  } else if (headers.has("content-length")) {
    const length = headers.get("content-length")!;
    if (!/^[0-9]{1,8}$/.test(length) || Number(length) !== body.length) {
      throw new ProtocolRefusal("winrm_http_response_incomplete");
    }
  }
  if (body.length > MAX_BODY) {
    throw new ProtocolRefusal("winrm_response_size_limit");
  }
  if (
    Number(status[1]) === 200 &&
    !/^(application\/soap\+xml|text\/xml)(?:;|$)/i.test(
      headers.get("content-type") ?? "",
    )
  ) throw new ProtocolRefusal("winrm_soap_content_type_required");
  return { status: Number(status[1]), body: new Uint8Array(body) };
}
export type WinrmIdentity = Omit<WinrmEndpoint, "username" | "password">;
function validateIdentity(endpoint: WinrmIdentity) {
  if (
    isIP(endpoint.address) !== 4 || !Number.isSafeInteger(endpoint.port) ||
    endpoint.port < 1 || endpoint.port > 65535 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(
      endpoint.serverName,
    ) || endpoint.serverName.includes("..") ||
    !/^([a-f0-9]{64})$/.test(endpoint.certificateSha256) ||
    endpoint.certificatePem.length > 32768 ||
    !endpoint.certificatePem.startsWith("-----BEGIN CERTIFICATE-----")
  ) throw new ProtocolRefusal("verified_winrm_tls_binding_required");
}
async function pinnedSocket(endpoint: WinrmIdentity) {
  const stream = await endpoint.openStream?.();
  return tls.connect({
    ...(stream ? { socket: stream } : {}),
    host: endpoint.address,
    port: endpoint.port,
    servername: endpoint.serverName,
    ca: endpoint.certificatePem,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  });
}
function verifyIdentity(socket: tls.TLSSocket, endpoint: WinrmIdentity) {
  const cert = socket.getPeerCertificate(true),
    nameError = tls.checkServerIdentity(endpoint.serverName, cert);
  if (
    !socket.authorized || nameError || !cert.raw ||
    !timingSafeEqual(
      createHash("sha256").update(cert.raw).digest(),
      Buffer.from(endpoint.certificateSha256, "hex"),
    )
  ) throw new ProtocolRefusal("winrm_tls_identity_refused");
}
/** Pinned TLS proof before enrollment; sends no HTTP or credential material. */
export async function verifyWinrmEndpointIdentity(
  endpoint: WinrmIdentity,
): Promise<void> {
  validateIdentity(endpoint);
  const socket = await pinnedSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: ProtocolRefusal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new ProtocolRefusal("winrm_tls_identity_probe_timeout")),
      10000,
    );
    socket.on("secureConnect", () => {
      try {
        verifyIdentity(socket, endpoint);
        finish();
      } catch {
        finish(new ProtocolRefusal("winrm_tls_identity_refused"));
      }
    });
    socket.on(
      "error",
      () => finish(new ProtocolRefusal("winrm_tls_identity_refused")),
    );
    socket.on("close", () => {
      if (!done) finish(new ProtocolRefusal("winrm_tls_identity_refused"));
    });
  });
}
/** Raw TCP address is freshly proven to the fixed VM; TLS authenticates its configured hostname and exact certificate. */
export async function soapHttps(
  endpoint: WinrmEndpoint,
  body: string,
  timeoutMs: number,
): Promise<SoapHttpReply> {
  validateIdentity(endpoint);
  if (
    !endpoint.username || endpoint.username.length > 200 ||
    /[\r\n:\x00]/.test(endpoint.username) || !endpoint.password ||
    endpoint.password.length > 4096 || /[\r\n\x00]/.test(endpoint.password)
  ) throw new ProtocolRefusal("private_winrm_authentication_binding_required");
  if (
    new TextEncoder().encode(body).length > 65536 ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
  ) throw new ProtocolRefusal("bounded_winrm_request_required");
  const socket = await pinnedSocket(endpoint);
  return await new Promise((resolve, reject) => {
    const pieces: Buffer[] = [];
    let size = 0, done = false, written = false;
    const finish = (error?: ProtocolRefusal, value?: SoapHttpReply) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(new ProtocolRefusal(error.code, written));
      else resolve(value!);
    };
    const timer = setTimeout(
      () => finish(new ProtocolRefusal("winrm_http_timeout", written)),
      timeoutMs,
    );
    socket.on("secureConnect", () => {
      try {
        verifyIdentity(socket, endpoint);
        const bytes = Buffer.from(body, "utf8"),
          authorization = Buffer.from(
            endpoint.username + ":" + endpoint.password,
            "utf8",
          ).toString("base64");
        written = true;
        socket.write(
          `POST /wsman HTTP/1.1\r\nHost: ${endpoint.serverName}:${endpoint.port}\r\nContent-Type: application/soap+xml; charset=UTF-8\r\nAccept: application/soap+xml\r\nAccept-Encoding: identity\r\nAuthorization: Basic ${authorization}\r\nContent-Length: ${bytes.length}\r\nConnection: close\r\n\r\n`,
        );
        socket.write(bytes);
      } catch {
        finish(new ProtocolRefusal("winrm_tls_identity_refused"));
      }
    });
    socket.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY + MAX_HEADERS) {
        finish(new ProtocolRefusal("winrm_response_size_limit", written));
        return;
      }
      pieces.push(Buffer.from(chunk));
    });
    socket.on("end", () => {
      if (done) return;
      try {
        finish(undefined, parse(Buffer.concat(pieces)));
      } catch (e) {
        finish(
          e instanceof ProtocolRefusal
            ? e
            : new ProtocolRefusal("winrm_http_response_invalid", written),
        );
      }
    });
    socket.on(
      "error",
      () =>
        finish(
          new ProtocolRefusal(
            written
              ? "winrm_http_outcome_unknown"
              : "winrm_tls_or_connection_refused",
            written,
          ),
        ),
    );
    socket.on("close", () => {
      if (!done) {
        finish(new ProtocolRefusal("winrm_http_response_incomplete", written));
      }
    });
  });
}
