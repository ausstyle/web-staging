/** Sandy managed guest worker v1.0.0. Node 22+, standard library only.
 * Install only through an approved VM change. Never re-execute an ambiguous job.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
export const VERSION = "1.0.0";
export const MAX_FILE_BYTES = 65536;
const digest = (x) => crypto.createHash("sha256").update(x).digest("hex");
export function canonical(value) {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((k) =>
      JSON.stringify(k) + ":" + canonical(value[k])
    ).join(",") + "}";
  }
  throw Error("invalid_json");
}
export function verifyTask(envelope, config, now = Date.now()) {
  if (
    !envelope || typeof envelope !== "object" ||
    typeof envelope.signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature) || !envelope.task
  ) throw Error("invalid_signed_task");
  const task = envelope.task;
  if (
    task.version !== VERSION || task.key_id !== config.key_id ||
    task.vm_name !== config.vm_name ||
    task.instance_id !== config.instance_id ||
    task.project_id !== config.project_id ||
    task.generation !== config.generation
  ) throw Error("task_binding_denied");
  if (
    !Number.isSafeInteger(task.issued_at) ||
    !Number.isSafeInteger(task.expires_at) ||
    task.issued_at * 1000 > now + 20000 || task.expires_at * 1000 <= now ||
    task.expires_at - task.issued_at > 120
  ) throw Error("task_expired");
  for (const k of ["job_id", "lease_id", "nonce"]) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        task[k],
      )
    ) throw Error("task_identity_invalid");
  }
  if (digest(canonical(task.arguments)) !== task.input_sha256) {
    throw Error("task_argument_digest_mismatch");
  }
  const key = crypto.createPublicKey({
    key: Buffer.from(config.public_key_spki_b64, "base64"),
    format: "der",
    type: "spki",
  });
  if (
    !crypto.verify(
      null,
      Buffer.from(canonical(task)),
      key,
      Buffer.from(envelope.signature, "base64url"),
    )
  ) throw Error("task_signature_invalid");
  return task;
}
function exact(args, keys, required = keys) {
  if (
    !args || typeof args !== "object" || Array.isArray(args) ||
    Object.keys(args).some((k) => !keys.includes(k)) ||
    required.some((k) => !(k in args))
  ) throw Error("invalid_arguments");
}
const name = (value, max = 120) =>
  typeof value === "string" && value.length <= max &&
  /^[A-Za-z0-9][A-Za-z0-9_.@:+-]*$/.test(value) && !value.includes("..");
const int = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max;
export function validateArguments(operation, args) {
  if (operation === "gcp.vm.files.upload") {
    exact(args, ["vm_name", "path", "content_base64", "sha256"]);
    if (
      typeof args.path !== "string" || !args.path.length ||
      args.path.length > 180 || typeof args.content_base64 !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        args.content_base64,
      ) || !/^[a-f0-9]{64}$/.test(args.sha256)
    ) throw Error("invalid_file");
    const data = Buffer.from(args.content_base64, "base64");
    if (data.length > MAX_FILE_BYTES || digest(data) !== args.sha256) {
      throw Error("file_digest_or_size_invalid");
    }
  } else if (operation === "gcp.vm.files.download") {
    exact(args, ["vm_name", "path"]);
    if (
      typeof args.path !== "string" || !args.path.length ||
      args.path.length > 180
    ) throw Error("invalid_file");
  } else if (/^gcp\.vm\.packages\.(install|update|remove)$/.test(operation)) {
    exact(args, ["vm_name", "manager", "packages"]);
    if (
      !["apt", "dnf", "winget"].includes(args.manager) ||
      !Array.isArray(args.packages) || args.packages.length < 1 ||
      args.packages.length > 20 || !args.packages.every((x) => name(x, 120)) ||
      new Set(args.packages).size !== args.packages.length
    ) throw Error("invalid_packages");
  } else if (
    /^gcp\.vm\.services\.(start|stop|restart|status)$/.test(operation)
  ) {
    exact(args, ["vm_name", "service"]);
    if (!name(args.service)) throw Error("invalid_service");
  } else if (operation === "gcp.vm.reboot") {
    exact(args, ["vm_name", "delay_seconds"]);
    if (!int(args.delay_seconds, 60, 300)) throw Error("invalid_reboot_delay");
  } else if (operation === "gcp.vm.firewall_guest.manage") {
    exact(args, [
      "vm_name",
      "action",
      "rule_id",
      "protocol",
      "port",
      "source_cidr",
    ], ["vm_name", "action", "rule_id"]);
    if (
      !["allow", "deny", "remove"].includes(args.action) ||
      !name(args.rule_id, 48)
    ) throw Error("invalid_firewall_rule");
    if (args.action !== "remove") {
      if (
        !["tcp", "udp"].includes(args.protocol) || !int(args.port, 1, 65535) ||
        typeof args.source_cidr !== "string"
      ) throw Error("invalid_firewall_rule");
      const m = args.source_cidr.match(
        /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/,
      );
      if (
        !m || m.slice(1, 5).some((x) => Number(x) > 255) || Number(m[5]) > 32
      ) throw Error("invalid_source_cidr");
    } else if (
      Object.keys(args).some((k) =>
        !["vm_name", "action", "rule_id"].includes(k)
      )
    ) throw Error("invalid_firewall_remove");
  } else throw Error("managed_guest_operation_not_supported");
  if (!["sandy-windows", "sandy-video"].includes(args.vm_name)) {
    throw Error("fixed_vm_required");
  }
  return args;
}
export function safeFile(root, relative) {
  if (
    typeof relative !== "string" || !relative.length || relative.length > 180 ||
    relative.includes("\\") || relative.includes(":") ||
    path.isAbsolute(relative) ||
    relative.split("/").some((x) =>
      !x || x === "." || x === ".." || !/^[A-Za-z0-9_.-]+$/.test(x)
    )
  ) throw Error("managed_file_path_required");
  const base = path.resolve(root);
  let current = base;
  if (fs.lstatSync(base).isSymbolicLink()) throw Error("symlink_root_denied");
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink() || (i < parts.length - 1 && !st.isDirectory())) {
        throw Error("symlink_or_non_directory_denied");
      }
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      if (i < parts.length - 1) fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  return current;
}
export async function runProcess(command, args, timeout = 120000) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, DEBIAN_FRONTEND: "noninteractive", LC_ALL: "C" },
    });
    let stdout = "", stderr = "", bytes = 0, done = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!done) {
        done = true;
        reject(Error("process_timeout_outcome_unknown"));
      }
    }, timeout);
    const collect = (kind, data) => {
      bytes += data.length;
      if (bytes > 65536) {
        child.kill("SIGKILL");
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(Error("process_output_limit_outcome_unknown"));
        }
      } else if (kind === "stdout") stdout += data.toString();
      else stderr += data.toString();
    };
    child.stdout.on("data", (d) => collect("stdout", d));
    child.stderr.on("data", (d) => collect("stderr", d));
    child.on("error", (e) => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        reject(Error("executable_unavailable_" + (e.code || "unknown")));
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        resolve({ exit_code: code, stdout, stderr });
      }
    });
  });
}
const psQuote = (x) => "'" + x.replaceAll("'", "''") + "'";
export async function executeTask(task, config, run = runProcess) {
  const args = validateArguments(task.operation, task.arguments),
    win = (config.platform || process.platform) === "win32";
  const processRunner = run, deadline = Date.now() + 90000;
  run = (command, args, timeout = 120000) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error("process_timeout_outcome_unknown");
    return processRunner(command, args, Math.min(timeout, remaining));
  };
  if (task.operation === "gcp.vm.files.upload") {
    const target = safeFile(config.file_root, args.path),
      data = Buffer.from(args.content_base64, "base64"),
      temporary = target + "." + task.job_id + ".tmp";
    fs.writeFileSync(temporary, data, { flag: "wx", mode: 0o600, flush: true });
    fs.renameSync(temporary, target);
    const observed = fs.readFileSync(target);
    if (digest(observed) !== args.sha256) throw Error("file_readback_mismatch");
    return {
      outcome: "completed",
      evidence: {
        kind: "file_readback",
        path: args.path,
        bytes: observed.length,
        sha256: digest(observed),
      },
    };
  }
  if (task.operation === "gcp.vm.files.download") {
    const target = safeFile(config.file_root, args.path),
      fd = fs.openSync(
        target,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
      );
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        throw Error("file_size_or_type_denied");
      }
      const data = fs.readFileSync(fd);
      return {
        outcome: "completed",
        evidence: {
          kind: "file_read",
          path: args.path,
          bytes: data.length,
          sha256: digest(data),
          content_base64: data.toString("base64"),
        },
      };
    } finally {
      fs.closeSync(fd);
    }
  }
  if (task.operation.startsWith("gcp.vm.packages.")) {
    const verb = task.operation.split(".").at(-1), packages = args.packages;
    if (win !== (args.manager === "winget")) {
      throw Error("package_manager_os_mismatch");
    }
    let result;
    if (args.manager === "apt") {
      result = await run("apt-get", [
        verb === "remove" ? "remove" : "install",
        "--yes",
        ...(verb === "update" ? ["--only-upgrade"] : []),
        "--",
        ...packages,
      ]);
    } else if (args.manager === "dnf") {
      result = await run("dnf", [
        "--assumeyes",
        verb === "update" ? "upgrade" : verb,
        ...packages,
      ]);
    } else {
      const results = [];
      for (const pkg of packages) {
        results.push(
          await run("winget.exe", [
            verb === "remove"
              ? "uninstall"
              : verb === "update"
              ? "upgrade"
              : "install",
            "--id",
            pkg,
            "--exact",
            "--silent",
            "--disable-interactivity",
          ]),
        );
      }
      result = {
        exit_code: results.every((r) => r.exit_code === 0) ? 0 : 1,
        stdout: results.map((r) => r.stdout).join("\n"),
        stderr: results.map((r) => r.stderr).join("\n"),
      };
    }
    const readback = await run(
      win ? "winget.exe" : args.manager === "apt" ? "dpkg-query" : "rpm",
      win
        ? ["list", "--disable-interactivity"]
        : args.manager === "apt"
        ? ["-W", "-f=${Package}=${Version} ${db:Status-Status}\\n", ...packages]
        : ["-q", ...packages],
    );
    let dnfAbsent = false;
    if (args.manager === "dnf" && verb === "remove") {
      const results = [];
      for (const pkg of packages) {
        const check = await run("rpm", ["-q", "--", pkg]);
        results.push(
          check.exit_code === 1 &&
            check.stdout.trim() === `package ${pkg} is not installed`,
        );
      }
      dnfAbsent = results.every(Boolean);
    }
    const inventoryConfirmed = args.manager === "apt"
      ? (verb === "remove"
        ? [0, 1].includes(readback.exit_code) &&
          !/ installed(?:\n|$)/.test(readback.stdout)
        : readback.exit_code === 0 &&
          readback.stdout.split("\n").filter(Boolean).length >=
            packages.length &&
          readback.stdout.split("\n").filter(Boolean).every((line) =>
            / installed$/.test(line)
          ))
      : args.manager === "dnf"
      ? (verb === "remove" ? dnfAbsent : readback.exit_code === 0)
      : false;
    return {
      outcome: result.exit_code !== 0
        ? "failed"
        : inventoryConfirmed
        ? "completed"
        : "accepted",
      evidence: {
        kind: "package_manager_result",
        inventory_confirmed: inventoryConfirmed,
        exit_code: result.exit_code,
        output_sha256: digest(result.stdout + "\n" + result.stderr),
        readback_exit_code: readback.exit_code,
        readback: readback.stdout.slice(0, 8192),
        completion_basis: "package_manager_exit_and_observed_inventory",
      },
    };
  }
  if (task.operation.startsWith("gcp.vm.services.")) {
    const verb = task.operation.split(".").at(-1);
    let result = { exit_code: 0, stdout: "", stderr: "" };
    if (win) {
      if (verb !== "status") {
        result = await run("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$ErrorActionPreference='Stop'; ${
            verb === "start" ? "Start" : verb === "stop" ? "Stop" : "Restart"
          }-Service -Name ${psQuote(args.service)};`,
        ]);
      }
      const observed = await run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference='Stop'; (Get-Service -Name ${
          psQuote(args.service)
        }).Status.ToString()`,
      ]);
      const state = observed.stdout.trim();
      return {
        outcome: result.exit_code === 0 && observed.exit_code === 0 &&
            (verb === "status" ||
              (verb === "stop" ? state === "Stopped" : state === "Running"))
          ? "completed"
          : "failed",
        evidence: {
          kind: "service_readback",
          service: args.service,
          state,
          mutation_exit_code: result.exit_code,
          readback_exit_code: observed.exit_code,
        },
      };
    }
    if (verb !== "status") {
      result = await run("systemctl", [verb, "--", args.service]);
    }
    const observed = await run("systemctl", [
      "show",
      "--property=ActiveState",
      "--property=SubState",
      "--",
      args.service,
    ]);
    const active = observed.stdout.match(/^ActiveState=(.*)$/m)?.[1] ||
      "unknown";
    return {
      outcome: result.exit_code === 0 && observed.exit_code === 0 &&
          (verb === "status" ||
            (verb === "stop" ? active === "inactive" : active === "active"))
        ? "completed"
        : "failed",
      evidence: {
        kind: "service_readback",
        service: args.service,
        state: active,
        mutation_exit_code: result.exit_code,
        readback_exit_code: observed.exit_code,
      },
    };
  }
  if (task.operation === "gcp.vm.reboot") {
    const result = await run(
      win ? "shutdown.exe" : "shutdown",
      win
        ? ["/r", "/t", String(args.delay_seconds), "/d", "p:4:1"]
        : ["-r", "+" + Math.ceil(args.delay_seconds / 60)],
    );
    return {
      outcome: result.exit_code === 0 ? "accepted" : "failed",
      evidence: {
        kind: "reboot_scheduled",
        exit_code: result.exit_code,
        before_boot_id_sha256: config.boot_id ? digest(config.boot_id) : null,
        reboot_observed: false,
        reconciliation_required: result.exit_code === 0,
      },
    };
  }
  if (task.operation === "gcp.vm.firewall_guest.manage") {
    const rule = "SandyGuest-" + args.rule_id;
    let result;
    if (win) {
      const script = args.action === "remove"
        ? `Get-NetFirewallRule -DisplayName ${
          psQuote(rule)
        } -ErrorAction Stop | Remove-NetFirewallRule`
        : `New-NetFirewallRule -DisplayName ${
          psQuote(rule)
        } -Direction Inbound -Action ${
          args.action === "allow" ? "Allow" : "Block"
        } -Protocol ${args.protocol.toUpperCase()} -LocalPort ${args.port} -RemoteAddress ${
          psQuote(args.source_cidr)
        } -ErrorAction Stop | Out-Null`;
      result = await run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop'; " + script,
      ]);
    } else {
      // Linux UFW removal must target a complete rule specification. Removing by
      // caller-supplied rule number can delete another controller's firewall rule.
      const ruleRoot = path.join(config.journal_root, "firewall");
      fs.mkdirSync(ruleRoot, { recursive: true, mode: 0o700 });
      const record = path.join(ruleRoot, args.rule_id + ".json");
      if (args.action === "remove") {
        const prior = JSON.parse(fs.readFileSync(record, "utf8"));
        if (
          !["allow", "deny"].includes(prior.action) ||
          prior.rule_id !== args.rule_id
        ) throw Error("owned_firewall_rule_required");
        result = await run("ufw", [
          "--force",
          "delete",
          prior.action,
          "proto",
          prior.protocol,
          "from",
          prior.source_cidr,
          "to",
          "any",
          "port",
          String(prior.port),
        ]);
        if (result.exit_code === 0) fs.unlinkSync(record);
      } else {
        if (fs.existsSync(record)) {
          throw Error("owned_firewall_rule_exists_remove_before_replace");
        }
        result = await run("ufw", [
          args.action,
          "proto",
          args.protocol,
          "from",
          args.source_cidr,
          "to",
          "any",
          "port",
          String(args.port),
          "comment",
          rule,
        ]);
        if (result.exit_code === 0) {
          fs.writeFileSync(record, JSON.stringify(args), {
            flag: "wx",
            mode: 0o600,
            flush: true,
          });
        }
      }
    }
    const observed = await run(
      win ? "powershell.exe" : "ufw",
      win
        ? [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-NetFirewallRule -DisplayName ${
            psQuote(rule)
          } -ErrorAction SilentlyContinue | Select-Object DisplayName,Enabled,Action | ConvertTo-Json -Compress`,
        ]
        : ["status"],
    );
    let confirmed = false;
    if (observed.exit_code === 0) {
      if (win) {
        try {
          const parsed = observed.stdout.trim()
            ? JSON.parse(observed.stdout)
            : null;
          confirmed = args.action === "remove"
            ? parsed === null
            : parsed?.DisplayName === rule &&
              String(parsed.Enabled) === "True" &&
              String(parsed.Action) ===
                (args.action === "allow" ? "Allow" : "Block");
        } catch {
          confirmed = false;
        }
      } else {confirmed = args.action === "remove"
          ? !observed.stdout.includes(rule)
          : observed.stdout.includes(rule);}
    }
    return {
      outcome: result.exit_code !== 0
        ? "failed"
        : confirmed
        ? "completed"
        : "accepted",
      evidence: {
        kind: "firewall_readback",
        effect_confirmed: confirmed,
        rule_id: args.rule_id,
        mutation_exit_code: result.exit_code,
        readback_exit_code: observed.exit_code,
        readback: observed.stdout.slice(0, 8192),
      },
    };
  }
  throw Error("managed_guest_operation_not_supported");
}
export async function runOnce(envelope, config, callbacks) {
  const task = verifyTask(envelope, config);
  validateArguments(task.operation, task.arguments);
  fs.mkdirSync(config.journal_root, { recursive: true, mode: 0o700 });
  const journal = path.join(config.journal_root, task.job_id + ".json");
  try {
    const previous = JSON.parse(fs.readFileSync(journal, "utf8"));
    if (previous.input_sha256 !== task.input_sha256) {
      throw Error("replay_digest_conflict");
    }
    return { ...previous, reused: true };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const entry = {
    job_id: task.job_id,
    lease_id: task.lease_id,
    nonce: task.nonce,
    input_sha256: task.input_sha256,
    outcome: "unknown",
    evidence: { kind: "execution_interrupted_or_reply_lost" },
  };
  // Durable intent precedes the execution-start request and every OS side effect.
  fs.writeFileSync(journal, JSON.stringify(entry), {
    flag: "wx",
    mode: 0o600,
    flush: true,
  });
  const approved = await callbacks.start(task);
  if (!approved) throw Error("execution_start_not_authorized");
  let result;
  try {
    result = await (callbacks.execute || executeTask)(task, config);
  } catch (e) {
    result = {
      outcome: /outcome_unknown/.test(e.message) ? "unknown" : "failed",
      evidence: {
        kind: "worker_error",
        code: /^[A-Za-z0-9_]+$/.test(e.message)
          ? e.message
          : "guest_operation_failed",
      },
    };
  }
  const completed = { ...entry, ...result };
  const temporary = journal + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(completed), {
    flag: "wx",
    mode: 0o600,
    flush: true,
  });
  fs.renameSync(temporary, journal);
  return { ...completed, reused: false };
}
export async function flushReceipts(config, send) {
  if (!fs.existsSync(config.journal_root)) return;
  let pending = 0;
  for (
    const name of fs.readdirSync(config.journal_root).filter((n) =>
      /^[a-f0-9-]{36}\.json$/i.test(n)
    )
  ) {
    const journal = path.join(config.journal_root, name),
      entry = JSON.parse(fs.readFileSync(journal, "utf8"));
    if (entry.receipt_acknowledged || entry.receipt_reconciliation_required) {
      continue;
    }
    if (pending++ >= 200) break;
    try {
      const receipt = await send(entry);
      if (receipt?.recorded !== true) throw Error("guest_result_not_recorded");
      const temporary = journal + "." + crypto.randomUUID() + ".tmp";
      fs.writeFileSync(
        temporary,
        JSON.stringify({ ...entry, receipt_acknowledged: true }),
        { flag: "wx", mode: 0o600, flush: true },
      );
      fs.renameSync(temporary, journal);
    } catch (e) {
      if (/^guest_api_(403|409)$/.test(e.message)) {
        const temporary = journal + "." + crypto.randomUUID() + ".tmp";
        fs.writeFileSync(
          temporary,
          JSON.stringify({ ...entry, receipt_reconciliation_required: true }),
          { flag: "wx", mode: 0o600, flush: true },
        );
        fs.renameSync(temporary, journal);
      }
      // A lost receipt reply is retried as a receipt only; OS execution is never retried.
    }
  }
}
async function identity(config) {
  const url =
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=" +
    encodeURIComponent(config.endpoint) + "&format=full";
  const response = await fetch(url, {
    headers: { "Metadata-Flavor": "Google" },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error("vm_identity_unavailable");
  return await response.text();
}
export async function main(config) {
  const endpoint = new URL(config.endpoint);
  if (
    endpoint.origin !== "https://zmqlyygzqoidkcwdysok.supabase.co" ||
    endpoint.pathname !== "/functions/v1/sandy-guest-operation-api" ||
    endpoint.search || endpoint.hash
  ) throw Error("fixed_api_endpoint_required");
  if (
    !["sandy-video", "sandy-windows"].includes(config.vm_name) ||
    config.project_id !== "elaborate-haven-511518-a5"
  ) throw Error("fixed_vm_required");
  fs.mkdirSync(config.file_root, { recursive: true, mode: 0o700 });
  config.boot_id = process.platform === "linux"
    ? fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
    : (await runProcess("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')",
    ])).stdout.trim();
  if (!config.boot_id || config.boot_id.length > 100) {
    throw Error("boot_identity_unavailable");
  }
  async function request(action, data = {}) {
    const jwt = await identity(config);
    const response = await fetch(config.endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        authorization: "Bearer " + config.anon_jwt,
        "x-sandy-vm-identity": jwt,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action, ...data }),
    });
    if (!response.ok) throw Error("guest_api_" + response.status);
    return await response.json();
  }
  for (;;) {
    try {
      await request("heartbeat", {
        agent_version: VERSION,
        key_id: config.key_id,
        generation: config.generation,
        platform: process.platform,
        boot_id: config.boot_id,
        worker_sha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))),
      });
      await flushReceipts(
        config,
        (result) =>
          request("finish", {
            job_id: result.job_id,
            lease_id: result.lease_id,
            nonce: result.nonce,
            outcome: result.outcome,
            evidence: result.evidence,
          }),
      );
      const work = await request("poll");
      if (work.envelope) {
        const result = await runOnce(work.envelope, config, {
          start: async (task) =>
            (await request("start", {
              job_id: task.job_id,
              lease_id: task.lease_id,
              nonce: task.nonce,
            })).allowed === true,
        });
        await flushReceipts(
          config,
          (result) =>
            request("finish", {
              job_id: result.job_id,
              lease_id: result.lease_id,
              nonce: result.nonce,
              outcome: result.outcome,
              evidence: result.evidence,
            }),
        );
      }
    } catch (e) {
      console.error(
        JSON.stringify({
          kind: "guest_worker_error",
          code: /^[A-Za-z0-9_]+$/.test(e.message)
            ? e.message
            : "worker_request_failed",
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const config = JSON.parse(fs.readFileSync(process.argv[2] || "", "utf8"));
  await main(config);
}
