"""Execute the actual bounded component selector without deployment/network."""
import contextlib,io,os,re,subprocess,tempfile,textwrap,unittest
from pathlib import Path
from unittest.mock import patch
class GroundingWorkflowTests(unittest.TestCase):
 def test_grounding_checks_both_preimages_then_releases_only_two_reviewed_targets(self):
  workflow=Path('.github/workflows/sandy-runtime-slice-release.yml').read_text()
  choices=re.search(r'options: \[([^\]]+)\]',workflow).group(1)
  self.assertIn('grounding',[value.strip() for value in choices.split(',')])
  start=workflow.index('          import os, subprocess, sys')
  end=workflow.index('          PY',start)
  code=textwrap.dedent(workflow[start:end]);calls=[]
  with tempfile.TemporaryDirectory() as out,patch.dict(os.environ,{'COMPONENT':'grounding','RUNNER_TEMP':out}),patch.object(subprocess,'run',side_effect=lambda argv,**kw:calls.append(argv)):
   exec(compile(code,'reviewed-grounding-component','exec'),{})
  self.assertEqual(len(calls),6)
  self.assertTrue(all('--deploy' not in c and '--verify-installed' not in c for c in calls[:2]))
  manifests={Path(c[2]).name for c in calls}
  self.assertEqual(manifests,{'sandy-agent-runtime-v4.json','sandy-examiner-full-cycle.json'})
  self.assertEqual(sum('--deploy' in c for c in calls),2)
  self.assertEqual(sum('--verify-installed' in c for c in calls),2)
  self.assertTrue(all(c[1]=='scripts/sandy/release_runtime_slice.py' for c in calls))
if __name__=='__main__':unittest.main()
