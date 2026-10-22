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
    def _run_deno(self, arguments):
        deno = shutil.which("deno")
        if deno is None:
            if os.environ.get("GITHUB_JOB") == "api-contract-tests":
                self.fail("Deno is required by the API contract workflow")
            self.skipTest("Deno fixture runs in the API contract CI job")
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [deno, "test", *arguments],
            cwd=root, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, (result.stdout + result.stderr)[-8000:])

    def test_managed_worker_update_and_stop_failures(self):
        self._run_deno([
            "--allow-read=/tmp", "--allow-write=/tmp", "--allow-run=sh",
            "supabase/functions/sandy-guest-operation-api/installer_lifecycle_test.ts",
        ])

    def test_guest_readiness_and_mutation_authorization(self):
        self._run_deno([
            "--import-map=scripts/sandy/testing/edge_types_import_map.json",
            "supabase/functions/sandy-guest-operation-api/index_test.ts",
        ])


if __name__ == "__main__":
    unittest.main()
