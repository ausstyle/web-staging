import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { prepareProtocolEnrollment } from "./prepare_enrollment.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { PROJECT, VMS, ZONE } from "./bindings.ts";

const now = Date.now();
function observation(vm: keyof typeof VMS, time = now) {
  return {
    observed_at: new Date(time).toISOString(),
    instance: {
      name: vm,
      id: VMS[vm].instance_id,
      status: "RUNNING",
      zone:
        `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}`,
      serviceAccounts: [{
        email: `sandy-vm-runtime@${PROJECT}.iam.gserviceaccount.com`,
      }],
      metadata: {
        items: [{ key: "unrelated", value: "not-copied-to-artifact" }],
      },
    },
  };
}
const linux = {
  vm_name: "sandy-video",
  ssh: { mode: "oslogin", host_key_sha256: "SHA256:" + "A".repeat(43) },
};

Deno.test("native preparation binds the existing contract and observation without authorizing or verifying enrollment", async () => {
  const source = observation("sandy-video");
  const result = await prepareProtocolEnrollment(source, linux, now);
  assert.equal(result.operation, "gcp.vm.protocol_bindings.enroll");
  assert.equal(result.target.instance_id, VMS["sandy-video"].instance_id);
  assert.equal(result.observation_sha256, await argumentDigest(source));
  assert.equal(result.enrollment_authorized, false);
  assert.equal(result.enrollment_performed, false);
  assert.equal(result.identity_pin_verified, false);
  assert.equal(result.requires_separate_enrollment_authorization, true);
  assert.equal(result.requires_independent_host_pin_verification, true);
  assert.equal(
    JSON.stringify(result).includes("not-copied-to-artifact"),
    false,
  );
  assert.equal(JSON.stringify(result).includes("grant_id"), false);
  assert.notEqual(result.arguments, linux);
  const { preparation_sha256, ...rest } = result;
  assert.equal(preparation_sha256, await argumentDigest(rest));
});

Deno.test("native preparation refuses stale/replaced targets, wrong runtime and secret or authority fields", async () => {
  for (
    const bad of [
      observation("sandy-video", now - 300001),
      observation("sandy-video", now + 30001),
      { ...observation("sandy-video"), observed_at: "invalid" },
      { ...observation("sandy-video"), token: "MUST_NOT_LEAK" },
    ]
  ) {
    await assert.rejects(
      () => prepareProtocolEnrollment(bad, linux, now),
      /fresh_fixed_vm_observation_required/,
    );
  }
  for (
    const patch of [
      { id: "different" },
      { name: "different" },
      { status: "STOPPED" },
      { zone: "another-project-or-zone" },
      { serviceAccounts: [{ email: "other@example.test" }] },
    ]
  ) {
    const source = observation("sandy-video");
    await assert.rejects(
      () =>
        prepareProtocolEnrollment(
          { ...source, instance: { ...source.instance, ...patch } },
          linux,
          now,
        ),
      /immutable_vm_observation_mismatch/,
    );
  }
  for (
    const patch of [
      { password: "MUST_NOT_LEAK" },
      { private_key: "MUST_NOT_LEAK" },
      { actor_id: crypto.randomUUID() },
      { enrollment_authorized: true },
      { command: "whoami" },
    ]
  ) {
    await assert.rejects(
      () =>
        prepareProtocolEnrollment(observation("sandy-video"), {
          ...linux,
          ...patch,
        }, now),
      /^Error: exact_public_protocol_pin_arguments_required$/,
    );
  }
});

async function windowsFixture() {
  const dir = await Deno.makeTempDir({ prefix: "sandy-native-pin-only-" });
  try {
    const generated = await new Deno.Command("openssl", {
      args: [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-keyout",
        dir + "/key.pem",
        "-out",
        dir + "/cert.pem",
        "-subj",
        "/CN=fixture.internal",
        "-addext",
        "subjectAltName=DNS:fixture.internal",
      ],
      stdout: "null",
      stderr: "null",
    }).output();
    assert.equal(generated.success, true);
    const certificate_pem = await Deno.readTextFile(dir + "/cert.pem");
    const cert = new X509Certificate(certificate_pem);
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(cert.raw)),
    );
    return {
      vm_name: "sandy-windows",
      winrm: {
        server_name: "fixture.internal",
        certificate_pem,
        certificate_sha256: [...hash].map((v) =>
          v.toString(16).padStart(2, "0")
        ).join(""),
      },
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("Windows preparation validates certificate bytes, host, validity and platform without connecting", async () => {
  const pins = await windowsFixture(), time = Date.now();
  const result = await prepareProtocolEnrollment(
    observation("sandy-windows", time),
    pins,
    time,
  );
  assert.equal(result.enrollment_performed, false);
  assert.equal(result.identity_pin_verified, false);
  for (
    const patch of [
      { server_name: "wrong.internal" },
      { certificate_sha256: "0".repeat(64) },
      { certificate_pem: "-----BEGIN CERTIFICATE-----\ninvalid" },
    ]
  ) {
    await assert.rejects(
      () =>
        prepareProtocolEnrollment(observation("sandy-windows", time), {
          ...pins,
          winrm: { ...pins.winrm, ...patch },
        }, time),
      /public_winrm_certificate_pin_invalid/,
    );
  }
  const expired = time + 2 * 86400000;
  await assert.rejects(
    () =>
      prepareProtocolEnrollment(
        observation("sandy-windows", expired),
        pins,
        expired,
      ),
    /public_winrm_certificate_pin_invalid/,
  );
  await assert.rejects(
    () =>
      prepareProtocolEnrollment(observation("sandy-video", time), {
        ...pins,
        vm_name: "sandy-video",
      }, time),
    /protocol_platform_mismatch/,
  );
  await assert.rejects(
    () =>
      prepareProtocolEnrollment(observation("sandy-windows", time), {
        ...linux,
        vm_name: "sandy-windows",
      }, time),
    /protocol_platform_mismatch/,
  );
});

Deno.test("offline CLI writes private artifact, refuses overwrite and needs no network or enrollment permission", async () => {
  const dir = await Deno.makeTempDir({
    prefix: "sandy-native-preparation-cli-",
  });
  try {
    const input = dir + "/observation.json",
      pins = dir + "/pins.json",
      out = dir + "/prepared.json";
    await Deno.writeTextFile(
      input,
      JSON.stringify(observation("sandy-video", Date.now())),
    );
    await Deno.writeTextFile(pins, JSON.stringify(linux));
    const run = () =>
      new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--cached-only",
          "--no-lock",
          "--allow-read",
          `--allow-write=${dir}`,
          new URL("./prepare_enrollment.ts", import.meta.url).pathname,
          input,
          pins,
          out,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
    const result = await run();
    assert.equal(result.success, true, new TextDecoder().decode(result.stderr));
    assert.equal((await Deno.stat(out)).mode! & 0o777, 0o600);
    const first = await Deno.readTextFile(out);
    assert.equal(JSON.parse(first).enrollment_performed, false);
    assert.equal(
      JSON.parse(new TextDecoder().decode(result.stdout)).identity_pin_verified,
      false,
    );
    const repeated = await run();
    assert.equal(repeated.success, false);
    assert.equal(
      JSON.parse(new TextDecoder().decode(repeated.stderr)).error,
      "private_preparation_output_exists",
    );
    assert.equal(await Deno.readTextFile(out), first);
    await Deno.writeTextFile(
      pins,
      '{"PRIVATE_TEST_TOKEN_MUST_NOT_LEAK":invalid}',
    );
    const malformed = await run();
    assert.equal(malformed.success, false);
    assert.equal(
      JSON.parse(new TextDecoder().decode(malformed.stderr)).error,
      "native_enrollment_preparation_failed",
    );
    assert.equal(
      new TextDecoder().decode(malformed.stderr).includes("PRIVATE_TEST_TOKEN"),
      false,
    );
    assert.equal(await Deno.readTextFile(out), first);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
