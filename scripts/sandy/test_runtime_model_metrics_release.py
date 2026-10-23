import copy,json,unittest
from unittest.mock import patch
from pathlib import Path
import release_runtime_model_metrics as schema
from release_web_canary import Blocked
from release_runtime_slice import validate,candidate

class MetricsReleaseTests(unittest.TestCase):
 def test_exact_guard_patch_does_not_edit_authority_or_receipt_binding(self):
  source=Path('supabase/migrations/20261021010000_sandy_runtime_conversation.sql').read_text()
  source=source[source.index('CREATE FUNCTION public.sandy_runtime_conversation_receipt_guard()'):source.index('REVOKE ALL ON FUNCTION public.sandy_runtime_conversation_receipt_guard()')]
  after=schema.expected_definition(source)
  self.assertIn('OR NEW.model_metrics IS NOT NULL THEN',after)
  self.assertEqual(after.count("'finished_at','model_metrics']"),2)
  self.assertIn('runtime_conversation_receipt_scope_immutable',after)
  with self.assertRaises(Blocked):schema.expected_definition(source.replace("'finished_at'","'changed_at'"))
 def test_manifest_only_preserves_existing_live_bundle_plus_two_modules(self):
  m=json.loads(schema.MANIFEST.read_bytes());validate(m)
  self.assertEqual(m['version'],35)
  self.assertEqual(set(m['replacements']),{'_shared/sandy-agent-operations/runtime_conversation.ts','_shared/sandy-agent-operations/runtime_model_metrics.ts'})
  self.assertEqual(len(m['before_files']),31)
  forged=copy.deepcopy(m);forged['replacements']['unrestricted.ts']='a'*64
  with self.assertRaises(Blocked):validate(forged)
 def test_installed_schema_reconcile_requires_exact_history(self):
  class R:
   def sql(self,*args):return []
  with self.assertRaises(Blocked):schema.verify(R(),'reviewed migration')

if __name__=='__main__':unittest.main()
