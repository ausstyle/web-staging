"""Execute the release utility's actual argparse against committed workflow argv.

Network and mutation boundaries are replaced, but neither argv construction nor
main/argparse is mocked. This catches a flag incorrectly replacing a positional.
"""
import contextlib,io,json,re,shlex,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import release_runtime_slice as slices

WORKFLOW=Path('.github/workflows/sandy-runtime-model-metrics-release.yml')
class TelemetryWorkflowTests(unittest.TestCase):
 def test_actual_release_cli_accepts_every_committed_workflow_invocation(self):
  commands=[line.strip().removeprefix('run: ') for line in WORKFLOW.read_text().splitlines() if 'python3 scripts/sandy/release_runtime_slice.py ' in line]
  self.assertEqual(len(commands),2)
  with tempfile.TemporaryDirectory() as out:
   for index,command in enumerate(commands):
    args=shlex.split(command.replace('$RUNNER_TEMP',out))
    evidence=Path(args[args.index('--evidence-dir')+1])
    fake=type('PrivateInstaller',(),{'out':evidence/'private-preimages'})()
    with patch.object(sys,'argv',args[1:]),patch.object(slices,'Installer',return_value=fake),patch.object(slices,'release',return_value={'source_uploaded':True}) as release,patch.object(slices,'inspect',return_value=({'version':36},b'',{})) as inspect,contextlib.redirect_stdout(io.StringIO()):
     self.assertEqual(slices.main(),0)
     if '--verify-installed' in args:
      release.assert_not_called();self.assertTrue(inspect.call_args.args[2])
     else:
      inspect.assert_not_called();self.assertTrue(release.call_args.args[2]);self.assertEqual(release.call_args.args[3],Path('docs/sandy-engineering/evaluations/runtime-slices/sandy-agent-runtime-v4.json'))
    self.assertTrue(json.loads((evidence/'redacted-receipt.json').read_text())['passed'])
 def test_resume_verifies_schema_before_source_and_does_not_reinstall_it(self):
  workflow=WORKFLOW.read_text()
  schema=workflow.index('      - name: Reconcile the already installed receipt schema before resuming Runtime only')
  source=workflow.index('      - name: Install reviewed Runtime source slice once')
  acceptance=workflow.index('      - name: Verify one real normal-customer turn')
  self.assertLess(schema,source);self.assertLess(source,acceptance)
  resume=workflow[schema:source]
  self.assertIn("if: inputs.action == 'resume-runtime-and-accept'",resume)
  self.assertIn('release_runtime_model_metrics.py --verify-installed',resume)
  self.assertNotIn('--deploy',resume)
  install=workflow[workflow.index('      - name: Install additive receipt schema once'):schema]
  self.assertIn("if: inputs.action == 'install-and-accept'",install)
  self.assertNotIn('resume-runtime-and-accept',install)
  self.assertIn("if: inputs.action == 'install-and-accept' || inputs.action == 'resume-runtime-and-accept'",workflow[source:acceptance])
if __name__=='__main__':unittest.main()
