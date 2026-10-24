"""Reviewed live-source patch tests only; no production mutation or provider."""
import subprocess,unittest
from pathlib import Path
from release_delegated_durable_reads import candidate,Blocked,SLUG,NEW_MODULE
from release_durable_dispatch_schedule import SOURCE_FILES
from release_gcp_admin_read import digest
from release_web_canary import ROOT
class DelegatedDurableSourceTests(unittest.TestCase):
 def before(self):
  return {name:subprocess.check_output(['git','show','aad60d6:supabase/functions/'+name],cwd=ROOT) for name in SOURCE_FILES}
 def test_exact_reviewed_patch_preserves_original_shared_module(self):
  old=self.before();new=candidate(old)
  self.assertEqual(set(new)-set(old),{NEW_MODULE})
  self.assertEqual([name for name in old if old[name]!=new[name]],[SLUG+'/index.ts'])
  self.assertEqual(new['_shared/sandy_api_protocol.ts'],old['_shared/sandy_api_protocol.ts'])
  self.assertEqual({name:digest(value) for name,value in old.items()},SOURCE_FILES)
 def test_changed_provider_dispatch_anchor_and_already_installed_module_refuse_patch(self):
  old=self.before();old[SLUG+'/index.ts']=old[SLUG+'/index.ts'].replace(b'      let body: ObjectValue | undefined, httpStatus: number | null = null;',b'changed source')
  with self.assertRaisesRegex(Blocked,'anchor_required'):candidate(old)
  old=self.before();old[NEW_MODULE]=b'previous installation'
  with self.assertRaisesRegex(Blocked,'anchor_required'):candidate(old)
 def test_unknown_preexisting_entry_changes_are_not_silently_overwritten(self):
  old=self.before();old[SLUG+'/index.ts']=b'// independently changed source\n'+old[SLUG+'/index.ts']
  with self.assertRaisesRegex(Blocked,'not_exact_preserving_patch'):candidate(old)
if __name__=='__main__':unittest.main()
