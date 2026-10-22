import assert from "node:assert/strict";
import { prepareEnrollment } from "./prepare_enrollment.ts";
const config = {
  endpoint:
    "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-guest-operation-api",
  anon_jwt: "PUBLIC_FIXTURE_ONLY",
  vm_name: "sandy-video",
  instance_id: "6831598645020395570",
  project_id: "elaborate-haven-511518-a5",
  generation: 1,
  key_id: "fixture-v1",
  public_key_spki_b64: "PUBLIC_FIXTURE_ONLY",
  platform: "linux" as const,
};
const instance = {
  id: config.instance_id,
  name: config.vm_name,
  metadata: {
    fingerprint: "fixture-fingerprint",
    items: [{ key: "customer-key", value: "preserve-fixture" }],
  },
};
Deno.test("offline enrollment creates real reviewed installer metadata while preserving separate authorization", () => {
  const prepared = prepareEnrollment(instance, config);
  assert.equal(prepared.enrollment_performed, false);
  assert.equal(prepared.deployment_performed, false);
  assert.equal(prepared.requires_separate_enrollment_authorization, true);
  assert.equal(prepared.metadata.items[0].value, "preserve-fixture");
  assert.ok(
    prepared.metadata.items.find((item) => item.key === "startup-script")?.value
      .includes("SANDY_MANAGED_GUEST_V1"),
  );
});
Deno.test("enrollment preparation rejects wrong immutable target, platform, rotation and secret fields", () => {
  for (
    const bad of [
      { ...config, instance_id: "999" },
      { ...config, platform: "win32" as const },
      { ...config, generation: 2 },
      { ...config, private_key: "NEVER_OUTPUT" },
    ]
  ) {
    assert.throws(
      () => prepareEnrollment(instance, bad),
      /exact_initial_enrollment_configuration_required/,
    );
  }
  assert.throws(
    () =>
      prepareEnrollment({
        ...instance,
        metadata: {
          fingerprint: "known",
          items: [{ key: "startup-script", value: "customer startup program" }],
        },
      }, config),
    /unrelated_startup_script_preserved/,
  );
});
