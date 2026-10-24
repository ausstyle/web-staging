"""Offline safety tests for Sandy's Antigravity Linux bootstrap. No network calls."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().with_name("bootstrap.sh")
TARGET = {
    "SANDY_TARGET_INSTANCE": "sandy-deploy",
    "SANDY_TARGET_PROJECT": "elaborate-haven-511518-a5",
    "SANDY_TARGET_ZONE": "europe-west1-b",
}

def run(args, overrides=None):
    env = os.environ.copy()
    for key in (*TARGET, "ANTIGRAVITY_INSTALLER_SHA256"):
        env.pop(key, None)
    env.update(overrides or {})
    return subprocess.run(["bash", str(SCRIPT), *args], env=env,
                          capture_output=True, text=True, timeout=10)

class BootstrapSafetyTests(unittest.TestCase):
    def test_bash_syntax(self):
        subprocess.run(["bash", "-n", str(SCRIPT)], check=True, timeout=5)

    def test_reject_unknown_action(self):
        self.assertEqual(run(["--execute"], TARGET).returncode, 64)

    def test_target_required(self):
        r = run(["--preflight"])
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("blocked:", r.stderr)

    def test_reject_protected_vm(self):
        r = run(["--preflight"], {**TARGET, "SANDY_TARGET_INSTANCE": "sandy-linux"})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("unprivileged_user_required" if os.geteuid() == 0
                      else "target_identity_not_confirmed", r.stderr)

    def test_no_download_without_approved_checksum(self):
        with tempfile.TemporaryDirectory() as folder:
            sentinel = Path(folder) / "curl-called"
            stub = Path(folder) / "curl"
            stub.write_text("#!/bin/sh\ntouch " + str(sentinel) + "\nexit 94\n")
            stub.chmod(0o755)
            r = run(["--install"], {**TARGET, "PATH": folder + os.pathsep + os.environ["PATH"]})
            self.assertNotEqual(r.returncode, 0)
            self.assertFalse(sentinel.exists())
            self.assertIn("blocked:", r.stderr)

    def test_preflight_never_downloads(self):
        if os.geteuid() == 0:
            self.skipTest("Bootstrapping intentionally refuses root")
        with tempfile.TemporaryDirectory() as folder:
            sentinel = Path(folder) / "curl-called"
            stub = Path(folder) / "curl"
            stub.write_text("#!/bin/sh\ntouch " + str(sentinel) + "\nexit 94\n")
            stub.chmod(0o755)
            r = run(["--preflight"], {**TARGET, "PATH": folder + os.pathsep + os.environ["PATH"]})
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("preflight_complete", r.stdout)
            self.assertFalse(sentinel.exists())

    def test_checksum_mismatch_refuses_execution(self):
        if os.geteuid() == 0:
            self.skipTest("Bootstrapping intentionally refuses root")
        with tempfile.TemporaryDirectory() as folder:
            sentinel = Path(folder) / "installer-executed"
            stub = Path(folder) / "curl"
            stub.write_text('#!/bin/sh\nfor arg do case "$arg" in --output) shift; '
                            'printf "touch %s\\n" "' + str(sentinel) + '" > "$1"; '
                            'exit 0;; esac; shift; done\nexit 88\n')
            stub.chmod(0o755)
            r = run(["--install"], {**TARGET,
                    "ANTIGRAVITY_INSTALLER_SHA256": "0" * 64,
                    "PATH": folder + os.pathsep + os.environ["PATH"]})
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("installer_checksum_mismatch", r.stderr)
            self.assertFalse(sentinel.exists())

if __name__ == "__main__":
    unittest.main()
