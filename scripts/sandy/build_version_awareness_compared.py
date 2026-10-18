#!/usr/bin/env python3
"""Build only version metadata changes; compare the same tests before and after.
No production release gate is changed. Existing failures remain visible; a new
or changed failure blocks the patch. No test source is modified or skipped.
"""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import build_version_awareness as build

# These three failures were observed in unchanged Examiner code in run 39134484780.
UNRELATED_EXAMINER = {
 'test_v2_examiner_design.TestExaminerIntelligentDesign.test_dedupe_and_receipts',
 'test_v2_examiner_design.TestExaminerIntelligentDesign.test_dynamic_execution_is_scoped_and_gated',
 'test_v2_examiner_design.TestExaminerIntelligentDesign.test_model_guidance_matches_validation_requirements',
}

def sha(b): return hashlib.sha256(b).hexdigest()

def main():
 root=Path.cwd().resolve(); out=(root/build.OUT);out.mkdir(exist_ok=True)
 raw=build.SOURCE.read_bytes()
 blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
 if blob!=build.EXPECTED_BLOB:raise RuntimeError('Repository source drift')
 helper=(root/'scripts/sandy/version-awareness.js').read_bytes()
 (out/'version-awareness.js').write_bytes(helper)
 manifest={'base_repo_blob':blob,'source_commit':os.environ.get('GITHUB_SHA'),'release_routing_changed':False,'runtimes':{}}
 for tag in ('v1','v2'):
  base=build.preserved_live_source(raw.decode())
  if tag=='v2':base=build.v2_gmail_fixes(base)
  component='sandy-agent-runtime'+('-v2' if tag=='v2' else '')
  patched=build.add_awareness(base,component)
  (out/f'original-{tag}.ts').write_text(base)
  (out/f'runtime-{tag}.ts').write_text(patched)
  subprocess.run(['node','--experimental-strip-types','--check',str(out/f'runtime-{tag}.ts')],check=True)
  manifest['runtimes'][tag]={'component':component,'baseline_sha256':sha(base.encode()),'patched_sha256':sha(patched.encode())}
 (out/'version-tests.mjs').write_text(build.TESTS)
 tests=subprocess.run(['node',str(out/'version-tests.mjs')],check=True,text=True,capture_output=True)
 (out/'version-test-results.json').write_text(tests.stdout)
 print(tests.stdout)
 reports=[]
 with tempfile.TemporaryDirectory(prefix='sandy-version-compare-') as temp:
  for label,filename in [('baseline','original-v2.ts'),('candidate','runtime-v2.ts')]:
   target=Path(temp)/label
   shutil.copytree(root,target,ignore=shutil.ignore_patterns('.git','node_modules','__pycache__','sandy-version-awareness-release','artifacts'))
   (target/build.SOURCE).write_bytes((out/filename).read_bytes())
   (target/build.SOURCE.parent/'version-awareness.js').write_bytes(helper)
   for path in (root/'scripts/sandy').glob('test_*.py'):
    if path.read_bytes()!=(target/'scripts/sandy'/path.name).read_bytes():raise RuntimeError('Test source changed')
   output=out/f'{label}-suite.json'
   subprocess.run([sys.executable,str(target/'scripts/sandy/compare_v2_core_regressions.py'),'--collect',str(target),'--output',str(output)],cwd=target,env=dict(os.environ,GITHUB_WORKSPACE=str(target),PYTHONDONTWRITEBYTECODE='1'),check=True,timeout=180)
   reports.append(json.loads(output.read_text()))
 old,new=reports
 if old['test_ids']!=new['test_ids'] or old['tests_run']!=new['tests_run'] or old['tests_run']<191:raise RuntimeError('Coverage changed')
 if old['skipped']!=new['skipped'] or old['expected_failures']!=new['expected_failures'] or new['unexpected_successes']:raise RuntimeError('Tests reclassified')
 failures=new['failures'];prior=old['failures']
 changed=[k for k in failures if k not in prior or failures[k]['trace_sha256']!=prior[k]['trace_sha256'] or failures[k]['kind']!=prior[k]['kind']]
 unrelated=all(k in UNRELATED_EXAMINER for k in failures)
 result={'tests_per_version':new['tests_run'],'baseline_failures':list(prior),'candidate_failures':list(failures),'new_or_changed_failures':changed,'all_tests_passed':new['successful'],'patch_has_no_new_regression':not changed and unrelated,'test_sources_unchanged':True,'full_production_acceptance':False,'scope':'version-awareness only; independent existing Examiner failures remain unresolved'}
 (out/'comparison.json').write_text(json.dumps(result,indent=2))
 print(json.dumps(result,indent=2))
 if not result['patch_has_no_new_regression']:raise RuntimeError('Version patch introduced regression or failure outside observed unchanged Examiner code')
 if build.SOURCE.read_bytes()!=raw:raise RuntimeError('Default branch runtime altered')
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
 print(json.dumps(manifest,indent=2))

if __name__=='__main__':main()
