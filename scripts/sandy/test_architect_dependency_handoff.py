"""Focused contract tests for Architect dependency handoff."""
import os
import runpy
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("architect_dependency_handoff.py")

class HandoffTests(unittest.TestCase):
    def execute(self, report):
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.md"
            artifact.write_text(report)
            env = {"ISSUE":"1", "GITHUB_REPOSITORY":"ausstyle/web-staging", "ARCHITECT_REPORT":str(artifact)}
            calls = []
            def fake_run(args, **kwargs):
                calls.append(args)
                return subprocess.CompletedProcess(args, 0, stdout="")
            with patch.dict(os.environ,env),patch("subprocess.run",side_effect=fake_run):
                runpy.run_path(str(SCRIPT),run_name="__main__")
            return calls

    def test_nested_manifest_posted_once(self):
        calls=self.execute('DECISION: BLOCKED\nDEPENDENCIES_JSON:\n{"dependencies":[{"type":"edge_function","name":"sandy-people-network"},{"type":"edge_function","name":"sandy-people-network"}]}')
        self.assertEqual(len(calls),2)
        self.assertEqual(calls[-1][:3],["gh","issue","comment"])
        self.assertEqual(calls[-1][-1].count("sandy-people-network"),1)

    def test_missing_edge_function_queues_protected_audit(self):
        calls = self.execute('DECISION: BLOCKED\\nDEPENDENCIES_JSON:\\n{"dependencies":[{"type":"edge_function","name":"sandy-function-never-present-xyz"}]}')
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[-1][:3], ["gh", "workflow", "run"])
        self.assertIn("edge_function=sandy-function-never-present-xyz", calls[-1])

    def test_non_edge_dependency_does_not_dispatch(self):
        calls = self.execute('DECISION: BLOCKED\\nDEPENDENCIES_JSON:\\n{"dependencies":[{"type":"database_schema","name":"sandy_unknown_table"}]}')
        self.assertEqual(len(calls), 2)

    def test_ready_does_not_post(self):
        self.assertEqual(self.execute("DECISION: READY\n"),[])

    def test_missing_manifest_does_not_post(self):
        self.assertEqual(self.execute("DECISION: BLOCKED\nSome unknown dependency"),[])

if __name__=="__main__":
    unittest.main()
