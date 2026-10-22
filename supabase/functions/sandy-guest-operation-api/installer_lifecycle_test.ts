import assert from "node:assert/strict";
import { type AgentConfig, installMetadata } from "./installer.ts";

const config: AgentConfig = {
  endpoint:
    "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-guest-operation-api",
  anon_jwt: "fixture-public-anon",
  vm_name: "sandy-video",
  instance_id: "6831598645020395570",
  project_id: "elaborate-haven-511518-a5",
  generation: 2,
  key_id: "fixture-v1",
  public_key_spki_b64: "fixture-public-key",
  platform: "linux",
};

function staged(platform: "linux" | "win32") {
  return installMetadata(
    {
      metadata: {
        fingerprint: "fixture",
        items: [{
          key: platform === "linux"
            ? "startup-script"
            : "windows-startup-script-ps1",
          value: platform === "linux"
            ? "#!/bin/sh\n# SANDY_MANAGED_GUEST_V1"
            : "# SANDY_MANAGED_GUEST_V1",
        }],
      },
    },
    "fixture",
    { ...config, platform },
    true,
  ).items[0].value;
}

// Execute the actual generated shell program in a temporary filesystem. Only
// systemd, node and root ownership are fixture boundaries; no host service or VM
// is touched. These are installer regressions, not provider acceptance evidence.
for (const scenario of ["update", "stop_failure", "unrelated_service"]) {
  Deno.test({
    name: "guest Linux installer lifecycle: " + scenario,
    ignore: Deno.build.os !== "linux",
    async fn() {
      const dir = await Deno.makeTempDir({ prefix: "sandy-installer-" });
      try {
        const root = dir + "/guest",
          unit = dir + "/worker.service",
          bin = dir + "/bin";
        await Deno.mkdir(root, { mode: 0o700 });
        await Deno.mkdir(bin);
        await Deno.writeTextFile(root + "/worker.mjs", "old-worker", {
          mode: 0o600,
        });
        await Deno.writeTextFile(root + "/config.json", "old-config", {
          mode: 0o600,
        });
        await Deno.writeTextFile(
          unit,
          scenario === "unrelated_service"
            ? "# unrelated service\n"
            : "# SANDY_MANAGED_GUEST_V1\n",
        );
        const programs = {
          node: "printf true",
          stat:
            'if [ "$2" = "%u" ]; then echo 0; else exec /usr/bin/stat "$@"; fi',
          install: 'exec /usr/bin/install -d -m 0700 "$FIXTURE_ROOT"',
          systemctl: `echo "$*" >> "$FIXTURE_CALLS"
if [ "$1" = stop ]; then
 [ "$(cat "$FIXTURE_ROOT/worker.mjs")" = old-worker ] || exit 90
 [ "$(cat "$FIXTURE_ROOT/config.json")" = old-config ] || exit 91
 [ "$FIXTURE_SCENARIO" != stop_failure ] || exit 92
fi`,
        };
        for (const [name, program] of Object.entries(programs)) {
          await Deno.writeTextFile(
            bin + "/" + name,
            "#!/bin/sh\nset -eu\n" + program + "\n",
            { mode: 0o700 },
          );
        }
        const script = staged("linux")
          .replaceAll("/var/lib/sandy-guest", root)
          .replaceAll("/etc/systemd/system/sandy-managed-guest.service", unit);
        await Deno.writeTextFile(dir + "/install.sh", script);
        const output = await new Deno.Command("sh", {
          args: [dir + "/install.sh"],
          // This fixture needs only its explicitly supplied variables. Inherit
          // neither runtime credentials nor CI loader injection variables.
          clearEnv: true,
          env: {
            PATH: bin + ":/usr/bin:/bin",
            FIXTURE_ROOT: root,
            FIXTURE_CALLS: dir + "/calls",
            FIXTURE_SCENARIO: scenario,
          },
        }).output();
        if (scenario === "update") {
          assert.equal(output.code, 0, new TextDecoder().decode(output.stderr));
          assert.deepEqual(
            (await Deno.readTextFile(dir + "/calls")).trim().split("\n"),
            [
              "stop sandy-managed-guest.service",
              "daemon-reload",
              "enable --now sandy-managed-guest.service",
            ],
          );
          assert.equal(
            JSON.parse(await Deno.readTextFile(root + "/config.json"))
              .generation,
            2,
          );
          assert.notEqual(
            await Deno.readTextFile(root + "/worker.mjs"),
            "old-worker",
          );
        } else {
          assert.notEqual(output.code, 0);
          assert.equal(
            await Deno.readTextFile(root + "/worker.mjs"),
            "old-worker",
          );
          assert.equal(
            await Deno.readTextFile(root + "/config.json"),
            "old-config",
          );
          if (scenario === "unrelated_service") {
            await assert.rejects(
              () => Deno.readTextFile(dir + "/calls"),
              Deno.errors.NotFound,
            );
          } else {assert.equal(
              (await Deno.readTextFile(dir + "/calls")).trim(),
              "stop sandy-managed-guest.service",
            );}
        }
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}

Deno.test("Windows update requires the exact managed task and confirmed stop before file replacement", () => {
  const script = staged("win32");
  const guard = script.indexOf("throw 'UnrelatedGuestTaskPreserved'");
  const stop = script.indexOf("Stop-ScheduledTask");
  const confirmation = script.indexOf("throw 'GuestTaskStopUnconfirmed'");
  const write = script.indexOf("[IO.File]::WriteAllBytes");
  assert(
    guard > 0 && guard < stop && stop < confirmation && confirmation < write,
  );
  assert(script.includes("-TaskPath '\\' -ErrorAction Stop | Where-Object"));
  assert(script.includes("$existingTask.Actions[0].Execute -ne $node"));
  assert(script.includes("$existingTask.Actions[0].Arguments -ne $arguments"));
  assert(script.includes("$existingTask.Principal.UserId -notin"));
  assert(script.indexOf("Register-ScheduledTask") > write);
  assert(
    script.indexOf("Start-ScheduledTask") >
      script.indexOf("Register-ScheduledTask"),
  );
});
