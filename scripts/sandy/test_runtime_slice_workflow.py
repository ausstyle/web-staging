"""Release queue isolation and fixed native release selection; no network."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/sandy-runtime-slice-release.yml'


class RuntimeSliceWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.source = WORKFLOW.read_text()

    def test_pr_validation_cannot_occupy_or_replace_the_production_queue(self):
        # Parse the deliberately bounded GitHub concurrency expression, then
        # evaluate both branches for independent PRs and dispatches. A literal
        # global group (the reproduced defect) fails this guard.
        match = re.search(
            r"^concurrency:\n(?:  #.*\n)*  group: \$\{\{ github.event_name == '([^']+)' "
            r"&& '([^']+)' \|\| format\('([^']+)', github.event.pull_request.number\) \}\}\n"
            r"  cancel-in-progress: (false|true)$", self.source, re.M)
        self.assertIsNotNone(match)
        event, deployment, template, cancel = match.groups()
        self.assertEqual(event, 'workflow_dispatch')
        self.assertEqual(deployment, 'sandy-engineering-mcp-deploy')
        self.assertEqual(cancel, 'false')
        group = lambda name, pr: deployment if name == event else template.format(pr)
        self.assertEqual(group('workflow_dispatch', None), deployment)
        self.assertNotEqual(group('pull_request', 243), deployment)
        self.assertNotEqual(group('pull_request', 243), group('pull_request', 244))
        self.assertEqual(group('pull_request', 243), group('pull_request', 243))

    def test_validation_is_read_only_and_production_remains_explicit_main_dispatch(self):
        self.assertIn("permissions:\n  contents: read\n", self.source)
        self.assertIn("    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'", self.source)
        triggers = self.source.split('permissions:', 1)[0]
        self.assertNotIn('\n  push:', triggers)
        self.assertNotIn('\n  schedule:', triggers)

    def test_native_selection_is_only_the_fresh_three_module_v3_release(self):
        self.assertIn("extra['native']=['sandy-vm-protocol-api']", self.source)
        manifest = json.loads((ROOT / 'docs/sandy-engineering/evaluations/runtime-slices/sandy-vm-protocol-api.json').read_text())
        self.assertEqual(manifest['version'], 3)
        self.assertIs(manifest['verify_jwt'], True)
        self.assertEqual(set(manifest['replacements']), {
            'sandy-vm-protocol-api/executor.ts',
            'sandy-vm-protocol-api/ssh.ts',
            'sandy-vm-protocol-api/winrm.ts',
        })


if __name__ == '__main__':
    unittest.main()
