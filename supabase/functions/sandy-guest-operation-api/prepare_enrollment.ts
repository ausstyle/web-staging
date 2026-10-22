/** Offline artifact preparation only. Never enrolls, installs or calls a VM. */
import {
  type AgentConfig,
  installMetadata,
  WORKER_SHA256,
} from "./installer.ts";
import { guestVms } from "./index.ts";

export function prepareEnrollment(
  instance: Record<string, unknown>,
  config: AgentConfig,
) {
  const target = guestVms[config.vm_name];
  if (
    !target || config.instance_id !== target.instance_id ||
    String(instance.id) !== target.instance_id ||
    instance.name !== target.vm_name ||
    config.platform !== target.platform ||
    config.project_id !== target.project_id ||
    config.generation !== 1 || !/^[A-Za-z0-9_-]{1,80}$/.test(config.key_id) ||
    !config.anon_jwt || !config.public_key_spki_b64 ||
    Object.keys(config).some((key) =>
      ![
        "endpoint",
        "anon_jwt",
        "vm_name",
        "instance_id",
        "project_id",
        "generation",
        "key_id",
        "public_key_spki_b64",
        "platform",
      ].includes(key)
    )
  ) {
    throw Error("exact_initial_enrollment_configuration_required");
  }
  const metadata = instance.metadata as { fingerprint?: string } | undefined;
  if (!metadata?.fingerprint) {
    throw Error("fresh_metadata_fingerprint_required");
  }
  return {
    vm_name: target.vm_name,
    instance_id: target.instance_id,
    worker_sha256: WORKER_SHA256,
    enrollment_authorized: false,
    enrollment_performed: false,
    deployment_performed: false,
    requires_separate_enrollment_authorization: true,
    expected_metadata_fingerprint: metadata.fingerprint,
    metadata: installMetadata(instance, metadata.fingerprint, config, false),
  };
}

if (import.meta.main) {
  const [instancePath, configPath, outputPath] = Deno.args;
  if (!instancePath || !configPath || !outputPath || Deno.args.length !== 3) {
    throw Error(
      "usage_prepare_enrollment_instance_json_config_json_private_output_json",
    );
  }
  const result = prepareEnrollment(
    JSON.parse(await Deno.readTextFile(instancePath)),
    JSON.parse(await Deno.readTextFile(configPath)),
  );
  const artifact = new TextEncoder().encode(
    JSON.stringify(result, null, 2) + "\n",
  );
  const file = await Deno.open(outputPath, {
    write: true,
    createNew: true,
    mode: 0o600,
  });
  try {
    let offset = 0;
    while (offset < artifact.length) {
      offset += await file.write(artifact.subarray(offset));
    }
  } finally {
    file.close();
  }
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", artifact)),
  ].map((x) => x.toString(16).padStart(2, "0")).join("");
  console.log(JSON.stringify({
    vm_name: result.vm_name,
    instance_id: result.instance_id,
    artifact_sha256: sha256,
    enrollment_performed: false,
    deployment_performed: false,
    requires_separate_enrollment_authorization: true,
  }));
}
