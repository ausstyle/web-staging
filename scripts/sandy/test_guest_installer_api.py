"""Include guest update regressions in the existing API contract CI job.

Fixtures execute generated shell only in /tmp with simulated systemd/root
ownership. They neither install a host service nor establish VM acceptance.
"""
from pathlib import Path
import os
import shutil
import subprocess
import unittest


class GuestInstallerApiTests(unittest.TestCase):
    def test_managed_worker_update_and_stop_failures(self):
        deno = shutil.which("deno")
        if deno is None:
            if os.environ.get("GITHUB_JOB") == "api-contract-tests":
                self.fail("Deno is required by the API contract workflow")
            self.skipTest("Deno fixture runs in the API contract CI job")
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [deno, "test", "--allow-read=/tmp", "--allow-write=/tmp",
             "--allow-run=sh",
             "supabase/functions/sandy-guest-operation-api/installer_lifecycle_test.ts"],
            cwd=root, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, (result.stdout + result.stderr)[-8000:])


if __name__ == "__main__":
    unittest.main()
