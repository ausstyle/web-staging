/** Fixed-target Google IAP v4 transport. No public IP, proxy URL or TLS override.
 * Wire constants/layout are reviewed against official Google Cloud SDK 590.0.0.
 * This transport never retries/replays a command or resumes a lost connection.
 */
// @ts-types="npm:@types/ws@8.18.1"
import WebSocket from "npm:ws@8.18.3";
import { Duplex } from "node:stream";
import { PROJECT, ZONE, VMS, type VmName } from "./bindings.ts";
import { ProtocolRefusal } from "./errors.ts";

export const IAP_PROTOCOL = "relay.tunnel.cloudproxy.app";
export class IapFailure extends ProtocolRefusal {
  constructor(code: string, public providerHttp?: number, public providerClose?: number) { super(code); }
}
const MAX_FRAME = 16384, MAX_BUFFER = 131072, MAX_TOTAL = 2097152;
export type IapPort = 22 | 5986 | 3389;
export function iapConnectUrl(vm: VmName, port: IapPort): URL {
  if (!Object.hasOwn(VMS, vm) || ![22, 5986, 3389].includes(port) ||
    (vm === "sandy-video" && port !== 22)) {
    throw new ProtocolRefusal("iap_fixed_target_required");
  }
  const url = new URL("wss://tunnel.cloudproxy.app/v4/connect");
  for (const [key, value] of Object.entries({
    project: PROJECT, zone: ZONE, instance: vm, interface: "nic0",
    port: String(port), newWebsocket: "True",
  })) url.searchParams.set(key, value);
  return url;
}
export function iapDataFrame(data: Uint8Array): Buffer {
  if (!data.length || data.length > MAX_FRAME) throw new ProtocolRefusal("iap_frame_size_invalid");
  const frame = Buffer.alloc(data.length + 6);
  frame.writeUInt16BE(4); frame.writeUInt32BE(data.length, 2); frame.set(data, 6);
  return frame;
}
export function iapAckFrame(bytes: number): Buffer {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new ProtocolRefusal("iap_ack_invalid");
  const frame = Buffer.alloc(10); frame.writeUInt16BE(7); frame.writeBigUInt64BE(BigInt(bytes), 2);
  return frame;
}
export type IapSocket = Pick<WebSocket, "on" | "send" | "close" | "terminate" | "readyState" | "protocol">;
export type IapFactory = (url: URL, token: string) => IapSocket;
const productionSocket: IapFactory = (url, token) => new WebSocket(url, IAP_PROTOCOL, {
  headers: { Authorization: "Bearer " + token, Origin: "bot:iap-tunneler" },
  rejectUnauthorized: true, followRedirects: false, perMessageDeflate: false,
  handshakeTimeout: 10000, maxPayload: MAX_FRAME + 6,
});

/** Called only after the API's exact target grant, credential and fresh VM proof. */
export async function openIapTunnel(vm: VmName, port: IapPort, token: string,
  factory: IapFactory = productionSocket): Promise<Duplex> {
  const url = iapConnectUrl(vm, port);
  if (!token || /[\s\r\n]/.test(token)) throw new ProtocolRefusal("iap_credential_required");
  let socket: IapSocket;
  try { socket = factory(url, token); } catch { throw new ProtocolRefusal("iap_connection_refused"); }
  let connected = false, closed = false, sent = 0, acknowledged = 0, received = 0;
  let resolveReady: (stream: Duplex) => void, rejectReady: (error: ProtocolRefusal) => void;
  const ready = new Promise<Duplex>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const stream = new Duplex({
    readableHighWaterMark: MAX_BUFFER, writableHighWaterMark: MAX_BUFFER,
    read() {},
    write(chunk, _encoding, callback) {
      if (!connected || closed || chunk.length + sent - acknowledged > MAX_BUFFER || sent + chunk.length > MAX_TOTAL) {
        callback(new ProtocolRefusal("iap_send_window_or_state_invalid")); return;
      }
      try {
        for (let offset = 0; offset < chunk.length; offset += MAX_FRAME) {
          const part = chunk.subarray(offset, offset + MAX_FRAME);
          sent += part.length; socket.send(iapDataFrame(part), { binary: true });
        }
        callback();
      } catch { callback(new ProtocolRefusal("iap_send_outcome_unknown")); }
    },
    final(callback) { socket.close(1000); callback(); },
    destroy(error, callback) {
      closed = true; clearTimeout(timer); socket.terminate();
      if (!connected) rejectReady!(new ProtocolRefusal("iap_connection_refused"));
      callback(error);
    },
  });
  // The caller may not have received the stream when an early protocol error occurs.
  stream.on("error", () => {});
  const fail = (code: string, providerHttp?: number, providerClose?: number) => {
    const error = new IapFailure(code, providerHttp, providerClose);
    if (!connected) rejectReady!(error);
    stream.destroy(error);
  };
  const timer = setTimeout(() => fail("iap_connect_timeout"), 10000);
  socket.on("open", () => {
    if (socket.protocol !== IAP_PROTOCOL) fail("iap_subprotocol_required");
  });
  socket.on("unexpected-response", (_request, response) => {
    // Never forward Google's raw error body or credential-bearing request.
    response.resume();
    fail([401, 403].includes(response.statusCode ?? 0) ? "iap_authorization_denied" : "iap_handshake_refused", response.statusCode);
  });
  socket.on("error", () => fail("iap_connection_refused"));
  socket.on("close", (code) => {
    if (closed) return;
    fail(connected ? "iap_connection_closed" : "iap_connection_refused", undefined, code);
  });
  socket.on("message", (raw, binary) => {
    if (closed) return;
    const frame = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    if (!binary || frame.length < 2 || frame.length > MAX_FRAME + 6) { fail("iap_frame_invalid"); return; }
    const tag = frame.readUInt16BE();
    if (tag === 1) {
      if (connected || frame.length < 7 || frame.readUInt32BE(2) !== frame.length - 6 || frame.length > 1030) { fail("iap_connect_frame_invalid"); return; }
      connected = true; clearTimeout(timer); resolveReady!(stream); return;
    }
    if (!connected) { fail("iap_connect_confirmation_required"); return; }
    if (tag === 7) {
      if (frame.length !== 10) { fail("iap_ack_invalid"); return; }
      const count = frame.readBigUInt64BE(2);
      if (count < BigInt(acknowledged) || count > BigInt(sent)) { fail("iap_ack_invalid"); return; }
      acknowledged = Number(count); return;
    }
    if (tag !== 4 || frame.length < 7 || frame.readUInt32BE(2) !== frame.length - 6) { fail("iap_frame_invalid"); return; }
    const data = frame.subarray(6); received += data.length;
    if (received > MAX_TOTAL || stream.readableLength + data.length > MAX_BUFFER) { fail("iap_receive_limit"); return; }
    stream.push(data);
    try { socket.send(iapAckFrame(received), { binary: true }); } catch { fail("iap_ack_send_failed"); }
  });
  return await ready;
}
