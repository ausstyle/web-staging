/** Offline preparation of the existing private protocol enrollment contract.
 * Input observations are evidence to review, never authority or verified pins.
 * This module has no provider client and performs no enrollment or execution.
 */
import { X509Certificate } from "node:crypto";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { validate } from "../sandy-provider-supplement-api/runtime.ts";
import { obj, PROJECT, type VmName, VMS, ZONE } from "./bindings.ts";
import { protocolContracts } from "./contracts.ts";

export async function prepareProtocolEnrollment(
  observation: unknown,
  argumentsValue: unknown,
  now = Date.now(),
) {
  const op = protocolContracts["gcp.vm.protocol_bindings.enroll"];
  if (!obj(argumentsValue) || !validate(op.input_schema, argumentsValue)) {
    throw Error("exact_public_protocol_pin_arguments_required");
  }
  if (
    !obj(observation) ||
    Object.keys(observation).some((k) =>
      !["observed_at", "instance"].includes(k)
    ) ||
    typeof observation.observed_at !== "string" || !obj(observation.instance)
  ) throw Error("fresh_fixed_vm_observation_required");
  const observed = Date.parse(observation.observed_at);
  if (
    !Number.isFinite(now) || !Number.isFinite(observed) ||
    observed > now + 30000 || now - observed > 300000
  ) {
    throw Error("fresh_fixed_vm_observation_required");
  }
  const vm = argumentsValue.vm_name as VmName, instance = observation.instance;
  if (
    instance.name !== vm || String(instance.id) !== VMS[vm].instance_id ||
    instance.status !== "RUNNING" ||
    instance.zone !==
      `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}` ||
    !Array.isArray(instance.serviceAccounts) ||
    instance.serviceAccounts.length !== 1 ||
    !obj(instance.serviceAccounts[0]) ||
    instance.serviceAccounts[0].email !==
      `sandy-vm-runtime@${PROJECT}.iam.gserviceaccount.com`
  ) throw Error("immutable_vm_observation_mismatch");
  // Follow the runtime's platform boundary: Windows HTTPS WinRM and Linux
  // OS Login/SSH. A matching public pin does not authorize its enrollment.
  if (
    vm === "sandy-video" && argumentsValue.winrm !== undefined ||
    vm === "sandy-windows" && argumentsValue.ssh !== undefined
  ) {
    throw Error("protocol_platform_mismatch");
  }
  if (obj(argumentsValue.winrm)) {
    const pin = argumentsValue.winrm;
    try {
      const cert = new X509Certificate(String(pin.certificate_pem));
      const actual = await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(cert.raw),
      );
      const hex = [...new Uint8Array(actual)].map((v) =>
        v.toString(16).padStart(2, "0")
      ).join("");
      if (
        hex !== pin.certificate_sha256 ||
        !cert.checkHost(String(pin.server_name)) ||
        Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now
      ) {
        throw Error();
      }
    } catch {
      throw Error("public_winrm_certificate_pin_invalid");
    }
  }
  const prepared = {
    operation: op.operation,
    contract_version: op.contract_version,
    contract_sha256: op.contract_sha256,
    arguments: structuredClone(argumentsValue),
    target: {
      project_id: PROJECT,
      zone: ZONE,
      vm_name: vm,
      instance_id: VMS[vm].instance_id,
    },
    observation_sha256: await argumentDigest(observation),
    observation_expires_at: new Date(observed + 300000).toISOString(),
    enrollment_authorized: false,
    enrollment_performed: false,
    identity_pin_verified: false,
    requires_separate_enrollment_authorization: true,
    requires_independent_host_pin_verification: true,
  };
  return { ...prepared, preparation_sha256: await argumentDigest(prepared) };
}

async function main() {
  const [observationPath, publicPinsPath, outputPath] = Deno.args;
  if (
    !observationPath || !publicPinsPath || !outputPath || Deno.args.length !== 3
  ) {
    throw Error(
      "usage_prepare_protocol_enrollment_observation_json_public_pins_json_private_output_json",
    );
  }
  const result = await prepareProtocolEnrollment(
    JSON.parse(await Deno.readTextFile(observationPath)),
    JSON.parse(await Deno.readTextFile(publicPinsPath)),
  );
  const file = await Deno.open(outputPath, {
    write: true,
    createNew: true,
    mode: 0o600,
  });
  try {
    const bytes = new TextEncoder().encode(
      JSON.stringify(result, null, 2) + "\n",
    );
    let offset = 0;
    while (offset < bytes.length) {
      offset += await file.write(bytes.subarray(offset));
    }
    await file.sync();
  } finally {
    file.close();
  }
  console.log(JSON.stringify({
    vm_name: result.target.vm_name,
    preparation_sha256: result.preparation_sha256,
    enrollment_performed: false,
    identity_pin_verified: false,
  }));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    // JSON/OS errors can contain input fragments or private paths. Never echo
    // their message, stack or the input artifact to an engineering transcript.
    const safe = new Set([
      "exact_public_protocol_pin_arguments_required",
      "fresh_fixed_vm_observation_required",
      "immutable_vm_observation_mismatch",
      "protocol_platform_mismatch",
      "public_winrm_certificate_pin_invalid",
      "usage_prepare_protocol_enrollment_observation_json_public_pins_json_private_output_json",
    ]);
    const code = error instanceof Deno.errors.AlreadyExists
      ? "private_preparation_output_exists"
      : error instanceof Error && safe.has(error.message)
      ? error.message
      : "native_enrollment_preparation_failed";
    console.error(
      JSON.stringify({ ok: false, error: code, enrollment_performed: false }),
    );
    Deno.exit(1);
  }
}
