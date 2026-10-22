import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { once } from "node:events";
import { iapConnectUrl, iapAckFrame, iapDataFrame, openIapTunnel, IAP_PROTOCOL, type IapSocket } from "./iap.ts";
import { verifyVm } from "./compute.ts";
import { PROJECT, ZONE, VMS } from "./bindings.ts";
class Socket extends EventEmitter {
  protocol = IAP_PROTOCOL; readyState = 1; terminated = false; frames: Buffer[] = [];
  send(frame: Buffer) { this.frames.push(frame); }
  close() { this.emit("close", 1000); }
  terminate() { this.terminated = true; }
}
function connected() { const b = Buffer.alloc(9); b.writeUInt16BE(1); b.writeUInt32BE(3, 2); b.write("sid", 6); return b; }
function fixture() {
  const socket = new Socket();
  const promise = openIapTunnel("sandy-video", 22, "synthetic", () => socket as unknown as IapSocket);
  socket.emit("open"); socket.emit("message", connected(), true);
  return { socket, promise };
}
Deno.test("IAP: fixed private target, protocol and ports never accept caller URLs", () => {
  const u = iapConnectUrl("sandy-video", 22);
  assert.equal(u.origin, "wss://tunnel.cloudproxy.app");
  assert.equal(u.searchParams.get("interface"), "nic0");
  assert.equal(u.searchParams.get("project"), PROJECT);
  assert.throws(() => iapConnectUrl("foreign" as never, 22));
  assert.throws(() => iapConnectUrl("sandy-video", 3389));
  assert.throws(() => iapConnectUrl("sandy-windows", 80 as never));
  assert.equal(iapDataFrame(Buffer.from("abc")).toString("hex"), "000400000003616263");
  assert.equal(iapAckFrame(3).toString("hex"), "00070000000000000003");
});
Deno.test("IAP: confirmed private stream transports exact bytes and closes with its consumer", async () => {
  const { socket, promise } = fixture(), stream = await promise;
  const incoming = once(stream, "data");
  socket.emit("message", iapDataFrame(Buffer.from("SSH-2.0-fixture\r\n")), true);
  assert.equal((await incoming)[0].toString(), "SSH-2.0-fixture\r\n");
  stream.write("client bytes");
  assert.equal(socket.frames.at(-1)!.subarray(6).toString(), "client bytes");
  socket.emit("message", iapAckFrame(12), true);
  stream.destroy(); assert.equal(socket.terminated, true);
});
Deno.test("IAP: early data, text, duplicate connect and impossible ACK fail closed without reconnection", async () => {
  for (const kind of ["early", "text", "duplicate", "ack"]) {
    const socket = new Socket(); let calls = 0;
    const promise = openIapTunnel("sandy-video", 22, "synthetic", () => { calls++; return socket as unknown as IapSocket; });
    if (kind === "early" || kind === "text") {
      socket.emit("message", iapDataFrame(Buffer.from("bad")), kind !== "text");
      await assert.rejects(promise);
    } else {
      socket.emit("message", connected(), true); const stream = await promise;
      const error = once(stream, "error");
      socket.emit("message", kind === "duplicate" ? connected() : iapAckFrame(1), true);
      assert.match((await error)[0].message, /^iap_/);
    }
    assert.equal(socket.terminated, true); assert.equal(calls, 1);
  }
});
Deno.test("IAP: receive buffering is bounded and raw provider failures never escape", async () => {
  const { socket, promise } = fixture(), stream = await promise;
  const error = once(stream, "error");
  for (let i = 0; i < 9; i++) socket.emit("message", iapDataFrame(Buffer.alloc(16384)), true);
  assert.equal((await error)[0].message, "iap_receive_limit");
  assert.equal(socket.terminated, true);
  const failed = new Socket();
  const rejected = openIapTunnel("sandy-video", 22, "synthetic", () => failed as unknown as IapSocket);
  failed.emit("error", Error("private credential text"));
  await assert.rejects(rejected, (e: Error) => e.message === "iap_connection_refused");
});
Deno.test("VM: private-only fixed identity selects IAP and rejects unbound/multiple interfaces", async () => {
  const vm = { id: VMS["sandy-video"].instance_id, name: "sandy-video", status: "RUNNING",
    zone: `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}`,
    serviceAccounts: [{ email: `sandy-vm-runtime@${PROJECT}.iam.gserviceaccount.com` }],
    networkInterfaces: [{ name: "nic0", networkIP: "10.132.0.2" }] };
  const proof = await verifyVm("sandy-video", { request: async () => ({ value: vm, sha256: "a".repeat(64) }) }, false);
  assert.equal(proof.transport, "iap"); assert.equal(proof.address, "10.132.0.2");
  for (const nics of [[{ name: "foreign", networkIP: "10.0.0.1" }], [{ name: "nic0", networkIP: "169.254.169.254" }], [...vm.networkInterfaces, ...vm.networkInterfaces]]) {
    await assert.rejects(() => verifyVm("sandy-video", { request: async () => ({ value: { ...vm, networkInterfaces: nics }, sha256: "b".repeat(64) }) }, false));
  }
});
