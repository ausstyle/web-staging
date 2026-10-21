import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  canonical,
  executeTask,
  flushReceipts,
  runOnce,
  safeFile,
  validateArguments,
  verifyTask,
} from "./worker.mjs";
const hash = (x) => crypto.createHash("sha256").update(x).digest("hex");
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sandy-guest-test-"));
  const pair = crypto.generateKeyPairSync("ed25519");
  const config = {
    key_id: "fixture-v1",
    vm_name: "sandy-video",
    instance_id: "6831598645020395570",
    project_id: "elaborate-haven-511518-a5",
    generation: 1,
    public_key_spki_b64: pair.publicKey.export({ format: "der", type: "spki" })
      .toString("base64"),
    platform: "linux",
    file_root: path.join(root, "files"),
    journal_root: path.join(root, "journal"),
    boot_id: "test-boot-id",
  };
  fs.mkdirSync(config.file_root);
  const args = {
    vm_name: config.vm_name,
    path: "fixture.txt",
    content_base64: Buffer.from("fixture").toString("base64"),
    sha256: hash("fixture"),
  };
  const task = {
    version: "1.0.0",
    key_id: config.key_id,
    vm_name: config.vm_name,
    instance_id: config.instance_id,
    project_id: config.project_id,
    generation: 1,
    job_id: crypto.randomUUID(),
    lease_id: crypto.randomUUID(),
    nonce: crypto.randomUUID(),
    operation: "gcp.vm.files.upload",
    arguments: args,
    input_sha256: hash(canonical(args)),
    issued_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 100,
  };
  const sign = (t) => ({
    task: t,
    signature: crypto.sign(null, Buffer.from(canonical(t)), pair.privateKey)
      .toString("base64url"),
  });
  return {
    root,
    config,
    task,
    sign,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
test("signed guest task binds VM, project, generation, digest and expiration", () => {
  const f = setup();
  try {
    assert.deepEqual(verifyTask(f.sign(f.task), f.config), f.task);
    const tampered = f.sign(f.task);
    tampered.task = { ...tampered.task, operation: "gcp.vm.reboot" };
    assert.throws(() => verifyTask(tampered, f.config), /signature_invalid/);
    for (
      const patch of [
        { vm_name: "sandy-windows" },
        { instance_id: "1" },
        { project_id: "other-project" },
        { generation: 2 },
        { key_id: "other" },
      ]
    ) {
      assert.throws(
        () => verifyTask(f.sign({ ...f.task, ...patch }), f.config),
        /binding_denied/,
      );
    }
    assert.throws(
      () =>
        verifyTask(
          f.sign({ ...f.task, expires_at: Math.floor(Date.now() / 1000) - 1 }),
          f.config,
        ),
      /expired/,
    );
    assert.throws(
      () =>
        verifyTask(
          f.sign({
            ...f.task,
            arguments: { ...f.task.arguments, path: "other" },
          }),
          f.config,
        ),
      /digest_mismatch/,
    );
  } finally {
    f.cleanup();
  }
});
test("real local file upload and download verify readback within managed root", async () => {
  const f = setup();
  try {
    const result = await executeTask(f.task, f.config);
    assert.equal(result.outcome, "completed");
    assert.equal(result.evidence.sha256, hash("fixture"));
    const download = await executeTask({
      ...f.task,
      operation: "gcp.vm.files.download",
      arguments: { vm_name: "sandy-video", path: "fixture.txt" },
    }, f.config);
    assert.equal(
      download.evidence.content_base64,
      Buffer.from("fixture").toString("base64"),
    );
    assert.equal(download.evidence.sha256, hash("fixture"));
    for (
      const value of [
        "../escape",
        "/etc/passwd",
        "a/../../escape",
        "C:\\Windows\\file",
        "a//b",
        ".",
        "a/..",
      ]
    ) {
      assert.throws(
        () => safeFile(f.config.file_root, value),
        /managed_file_path_required/,
      );
    }
    const external = path.join(f.root, "outside");
    fs.mkdirSync(external);
    fs.symlinkSync(external, path.join(f.config.file_root, "linked"));
    assert.throws(
      () => safeFile(f.config.file_root, "linked/escape"),
      /symlink_or_non_directory_denied/,
    );
  } finally {
    f.cleanup();
  }
});
test("disk replay journal prevents every second execution and keeps ambiguous start unknown", async () => {
  const f = setup();
  try {
    let starts = 0, executions = 0;
    const callbacks = {
      start: async () => {
        starts++;
        return true;
      },
      execute: async () => {
        executions++;
        return { outcome: "completed", evidence: { kind: "fixture_only" } };
      },
    };
    const first = await runOnce(f.sign(f.task), f.config, callbacks),
      second = await runOnce(f.sign(f.task), f.config, callbacks);
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(starts, 1);
    assert.equal(executions, 1);
    const ambiguous = { ...f.task, job_id: crypto.randomUUID() };
    await assert.rejects(
      () =>
        runOnce(f.sign(ambiguous), f.config, {
          start: async () => {
            throw Error("lost_reply");
          },
          execute: callbacks.execute,
        }),
      /lost_reply/,
    );
    const recovered = await runOnce(f.sign(ambiguous), f.config, callbacks);
    assert.equal(recovered.outcome, "unknown");
    assert.equal(executions, 1);
    assert.equal(starts, 1);
  } finally {
    f.cleanup();
  }
});
test("unavailable SSH/WinRM and dangerous arguments never reach a process", () => {
  for (const operation of ["gcp.vm.ssh.exec", "gcp.vm.winrm.exec"]) {
    assert.throws(() =>
      validateArguments(operation, {
        vm_name: "sandy-video",
        command: "whoami",
      }), /not_supported/);
  }
  for (const packages of [["--allow-unauthenticated"], ["name;id"], []]) {
    assert.throws(() =>
      validateArguments("gcp.vm.packages.install", {
        vm_name: "sandy-video",
        manager: "apt",
        packages,
      }), /invalid_packages/);
  }
  assert.throws(
    () =>
      validateArguments("gcp.vm.services.restart", {
        vm_name: "sandy-video",
        service: "x'; whoami",
      }),
    /invalid_service/,
  );
  assert.throws(
    () =>
      validateArguments("gcp.vm.firewall_guest.manage", {
        vm_name: "sandy-video",
        action: "allow",
        rule_id: "fixture",
        protocol: "tcp",
        port: 80,
        source_cidr: "999.1.1.1/32",
      }),
    /invalid_source_cidr/,
  );
  assert.throws(
    () =>
      validateArguments("gcp.vm.reboot", {
        vm_name: "sandy-video",
        delay_seconds: 0,
      }),
    /invalid_reboot_delay/,
  );
});
test("service completion requires observed target health and never arbitrary shell interpolation", async () => {
  const f = setup();
  try {
    const calls = [];
    const run = async (command, args) => {
      calls.push({ command, args });
      return {
        exit_code: 0,
        stdout: args[0] === "show"
          ? "ActiveState=inactive\nSubState=dead\n"
          : "",
        stderr: "",
      };
    };
    const result = await executeTask(
      {
        ...f.task,
        operation: "gcp.vm.services.start",
        arguments: { vm_name: "sandy-video", service: "fixture.service" },
      },
      f.config,
      run,
    );
    assert.equal(result.outcome, "failed");
    assert.deepEqual(calls[0], {
      command: "systemctl",
      args: ["start", "--", "fixture.service"],
    });
    assert.equal(calls.length, 2);
  } finally {
    f.cleanup();
  }
});
test("package manager success without inventory and scheduled reboot remain accepted", async () => {
  const f = setup();
  try {
    const run = async () => ({ exit_code: 0, stdout: "", stderr: "" });
    const pkg = await executeTask(
      {
        ...f.task,
        operation: "gcp.vm.packages.install",
        arguments: {
          vm_name: "sandy-video",
          manager: "apt",
          packages: ["fixture-package"],
        },
      },
      f.config,
      run,
    );
    assert.equal(pkg.outcome, "accepted");
    const reboot = await executeTask(
      {
        ...f.task,
        operation: "gcp.vm.reboot",
        arguments: { vm_name: "sandy-video", delay_seconds: 60 },
      },
      f.config,
      run,
    );
    assert.equal(reboot.outcome, "accepted");
    assert.equal(reboot.evidence.reboot_observed, false);
    assert.equal(reboot.evidence.before_boot_id_sha256, hash(f.config.boot_id));
  } finally {
    f.cleanup();
  }
});
test("owned Linux firewall removal uses persisted exact specification, never global flush", async () => {
  const f = setup();
  try {
    const calls = [];
    let present = false;
    const run = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "allow") present = true;
      if (args[0] === "--force") present = false;
      return {
        exit_code: 0,
        stdout: args[0] === "status" && present
          ? "80/tcp ALLOW IN 192.0.2.0/24 # SandyGuest-fixture"
          : "",
        stderr: "",
      };
    };
    const args = {
      vm_name: "sandy-video",
      action: "allow",
      rule_id: "fixture",
      protocol: "tcp",
      port: 80,
      source_cidr: "192.0.2.0/24",
    };
    assert.equal(
      (await executeTask(
        {
          ...f.task,
          operation: "gcp.vm.firewall_guest.manage",
          arguments: args,
        },
        f.config,
        run,
      )).outcome,
      "completed",
    );
    assert.equal(
      (await executeTask(
        {
          ...f.task,
          operation: "gcp.vm.firewall_guest.manage",
          arguments: {
            vm_name: "sandy-video",
            action: "remove",
            rule_id: "fixture",
          },
        },
        f.config,
        run,
      )).outcome,
      "completed",
    );
    assert.deepEqual(calls[2], {
      command: "ufw",
      args: [
        "--force",
        "delete",
        "allow",
        "proto",
        "tcp",
        "from",
        "192.0.2.0/24",
        "to",
        "any",
        "port",
        "80",
      ],
    });
    assert.equal(
      calls.some((c) => c.args.includes("reset") || c.args.includes("disable")),
      false,
    );
  } finally {
    f.cleanup();
  }
});

test("lost result replies retry only durable receipts and never the OS operation", async () => {
  const f = setup();
  try {
    let executed = 0, sends = 0;
    await runOnce(f.sign(f.task), f.config, {
      start: async () => true,
      execute: async () => {
        executed++;
        return { outcome: "completed", evidence: { kind: "fixture_only" } };
      },
    });
    const send = async () => {
      sends++;
      if (sends === 1) throw Error("lost_reply");
      return { recorded: true };
    };
    await flushReceipts(f.config, send);
    await flushReceipts(f.config, send);
    await flushReceipts(f.config, send);
    assert.equal(executed, 1);
    assert.equal(sends, 2);
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(f.config.journal_root, f.task.job_id + ".json"),
          "utf8",
        ),
      ).receipt_acknowledged,
      true,
    );
  } finally {
    f.cleanup();
  }
});

test("acknowledged journal history cannot starve later pending receipts", async () => {
  const f = setup();
  try {
    fs.mkdirSync(f.config.journal_root, { recursive: true });
    for (let i = 0; i < 205; i++) {
      fs.writeFileSync(
        path.join(
          f.config.journal_root,
          `00000000-0000-4000-8000-${String(i).padStart(12, "0")}.json`,
        ),
        JSON.stringify({ receipt_acknowledged: true }),
      );
    }
    const pending = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    fs.writeFileSync(
      path.join(f.config.journal_root, pending + ".json"),
      JSON.stringify({
        job_id: pending,
        outcome: "completed",
        evidence: { kind: "fixture_only" },
      }),
    );
    const sent = [];
    await flushReceipts(f.config, async (receipt) => {
      sent.push(receipt.job_id);
      return { recorded: true };
    });
    assert.deepEqual(sent, [pending]);
  } finally {
    f.cleanup();
  }
});
test("package removal cannot claim completion from failed or mixed inventory", async () => {
  const f = setup();
  try {
    const apt = await executeTask(
      {
        ...f.task,
        operation: "gcp.vm.packages.remove",
        arguments: {
          vm_name: "sandy-video",
          manager: "apt",
          packages: ["fixture"],
        },
      },
      f.config,
      async (command) => ({
        exit_code: command === "apt-get" ? 0 : 2,
        stdout: "",
        stderr: "",
      }),
    );
    assert.equal(apt.outcome, "accepted");
    assert.equal(apt.evidence.inventory_confirmed, false);
    const dnf = await executeTask(
      {
        ...f.task,
        operation: "gcp.vm.packages.remove",
        arguments: {
          vm_name: "sandy-video",
          manager: "dnf",
          packages: ["removed", "still-installed"],
        },
      },
      f.config,
      async (command, args) =>
        command === "dnf"
          ? { exit_code: 0, stdout: "", stderr: "" }
          : args.at(-1) === "removed"
          ? {
            exit_code: 1,
            stdout: "package removed is not installed\n",
            stderr: "",
          }
          : {
            exit_code: 0,
            stdout: "still-installed-1.0-1.x86_64\n",
            stderr: "",
          },
    );
    assert.equal(dnf.outcome, "accepted");
    assert.equal(dnf.evidence.inventory_confirmed, false);
  } finally {
    f.cleanup();
  }
});
