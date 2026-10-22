#!/usr/bin/env python3
"""Subscription-only Codex pilot worker.

This is a one-shot, manually invoked worker, NOT a standing production supervisor.
It intentionally refuses API-key fallback, protects the existing repository,
and records an honest local execution receipt. Run only in a sandboxed checkout
under the engineering identity after a user has signed in via the official
Codex CLI browser/device flow.

Example:
  python3 scripts/sandy/codex_subscription_worker.py \
    --repo /work/sandy-checkout --prompt-file /work/task.txt \
    --receipt /work/receipts/job-001.json --execute

Without --execute the worker only performs a safety preflight.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run(argv: list[str], *, cwd: Path | None = None, timeout: int = 30,
        env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, cwd=cwd, env=env, text=True,
                          capture_output=True, timeout=timeout, check=False)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--repo", type=Path, required=True)
    p.add_argument("--prompt-file", type=Path, required=True)
    p.add_argument("--receipt", type=Path, required=True)
    p.add_argument("--execute", action="store_true",
                   help="Opt in to running Codex; default is preflight only")
    p.add_argument("--timeout-seconds", type=int, default=1800)
    a = p.parse_args()

    receipt: dict[str, object] = {
        "started_at": now(), "mode": "execute" if a.execute else "preflight",
        "status": "failed", "subscription_billing_verified": False,
        "production_deployed": False,
    }
    exit_code = 1
    try:
        repo = a.repo.resolve(strict=True)
        prompt_path = a.prompt_file.resolve(strict=True)
        if not repo.is_dir() or not (repo / ".git").exists():
            raise ValueError("repo must be an existing isolated Git checkout")
        if prompt_path.stat().st_size > 64_000:
            raise ValueError("prompt file exceeds 64 KB safety limit")
        prompt = prompt_path.read_text(encoding="utf-8").strip()
        if not prompt:
            raise ValueError("prompt file is empty")
        if not 1 <= a.timeout_seconds <= 3600:
            raise ValueError("timeout must be between 1 and 3600 seconds")
        codex = shutil.which("codex")
        if not codex:
            raise ValueError("codex CLI is not installed")
        # Do not allow accidental API-key billing; inherit local ChatGPT login.
        env = {k: v for k, v in os.environ.items()
               if k not in ("OPENAI_API_KEY", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID")}
        login = run([codex, "login", "status"], cwd=repo, env=env)
        receipt["login_status_exit"] = login.returncode
        if login.returncode != 0:
            raise RuntimeError("Codex is not signed in; interactive owner sign-in required")
        # The CLI can be authenticated with an API key despite a successful
        # login-status check. This pilot must NOT infer subscription coverage.
        # Operator must independently verify login provider/account + usage.
        receipt["status"] = "preflight_passed"
        if not a.execute:
            exit_code = 0
        else:
            # Intentionally no --full-auto, --dangerously-bypass-approvals,
            # or API fallback. The worker cannot push, merge or deploy itself.
            command = [codex, "exec", "--cd", str(repo), "--json", prompt]
            result = run(command, cwd=repo, env=env,
                         timeout=a.timeout_seconds)
            receipt["exit_code"] = result.returncode
            receipt["stdout_tail"] = result.stdout[-12000:]
            receipt["stderr_tail"] = result.stderr[-4000:]
            receipt["status"] = (
                "command_exited_zero_unverified" if result.returncode == 0
                else "command_failed"
            )
            exit_code = result.returncode or 0
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as e:
        receipt["status"] = "failed"
        receipt["error"] = type(e).__name__ + ": " + str(e)
    finally:
        receipt["finished_at"] = now()
        destination = a.receipt.expanduser().resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        tmp = destination.with_suffix(destination.suffix + ".tmp")
        tmp.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n",
                       encoding="utf-8")
        tmp.replace(destination)
        print(json.dumps({"status": receipt["status"],
                          "receipt": str(destination)}))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
