"""Read-only CI provenance checks; never used to construct a deployment.

Historical Runtime slice receipts remain immutable when a later reviewed slice
changes source. Only the two explicitly reviewed voice-context upgrades below
can validate old bytes from their pinned Git ancestor instead of current files.
"""
import json
from pathlib import Path
import re
import subprocess
from release_gcp_admin_read import digest
from release_runtime_slice import MODULES,validate
from release_web_canary import ROOT,Blocked

UPGRADE=ROOT/'docs/sandy-engineering/evaluations/voice-context-session-source.json'
PRIOR_MODULES={'_shared/sandy-agent-operations/voice_source.ts','sandy-voice-account-context/index.ts'}

def git_prior_source(commit,module):
 if subprocess.run(['git','merge-base','--is-ancestor',commit,'HEAD'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
  raise Blocked('reviewed_historical_source_must_be_ancestor')
 return subprocess.check_output(['git','show',commit+':supabase/functions/'+module],cwd=ROOT)

def source_for_ci(m,module,pin):
 current=(ROOT/'supabase/functions'/module).read_bytes()
 if digest(current)==pin:return current
 if m.get('function')!='sandy-voice-account-context' or m.get('version')!=20 or module not in PRIOR_MODULES:
  raise Blocked('runtime_slice_current_source_mismatch:'+module)
 upgrade=json.loads(UPGRADE.read_bytes());candidate=upgrade.get('functions',{}).get('sandy-voice-account-context',{})
 commit=upgrade.get('historical_source_commit','')
 if (upgrade.get('kind')!='source-only-normal-customer-voice-context-v1' or not re.fullmatch('[a-f0-9]{40}',commit)
  or candidate.get('before_files',{}).get(module)!=pin
  or candidate.get('candidate_files',{}).get(module)!=digest(current)):
  raise Blocked('exact_reviewed_voice_upgrade_source_required')
 original=git_prior_source(commit,module)
 if digest(original)!=pin:raise Blocked('historical_runtime_slice_source_changed')
 return original

def main():
 for slug in MODULES:
  m=json.loads((ROOT/'docs/sandy-engineering/evaluations/runtime-slices'/(slug+'.json')).read_bytes());validate(m)
  for module,pin in m['replacements'].items():source_for_ci(m,module,pin)
 print('All reviewed Runtime sources and exact historical upgrade provenance verified; no deployment performed.')

if __name__=='__main__':main()
