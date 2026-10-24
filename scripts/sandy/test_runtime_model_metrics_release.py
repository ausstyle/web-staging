import copy,hashlib,json,re,unittest
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
 def test_manifest_preserves_existing_live_bundle_and_entrypoint_provenance(self):
  m=json.loads(schema.MANIFEST.read_bytes());validate(m)
  self.assertGreaterEqual(m['version'],35)
  # Later reviewed slices preserve the already installed telemetry module;
  # this test proves it remains pinned rather than freezing a spent deployment.
  metrics='_shared/sandy-agent-operations/runtime_model_metrics.ts'
  self.assertEqual(m['replacements'].get(metrics,m['before_files'].get(metrics)),hashlib.sha256(Path('supabase/functions',metrics).read_bytes()).hexdigest())
  self.assertGreaterEqual(len(m['before_files']),31)
  entry=hashlib.sha256(Path('supabase/functions/sandy-agent-runtime-v4/index.ts').read_bytes()).hexdigest()
  transport=Path('supabase/functions/_shared/sandy-agent-operations/runtime_conversation_v4_transport.ts').read_text()
  self.assertEqual(re.findall(r'sourceSha256: "([a-f0-9]{64})"',transport),[entry])
  self.assertEqual(entry,m['before_files']['sandy-agent-runtime-v4/index.ts'])
  forged=copy.deepcopy(m);forged['replacements']['unrestricted.ts']='a'*64
  with self.assertRaises(Blocked):validate(forged)
 def test_installed_schema_reconcile_requires_exact_history(self):
  class R:
   def sql(self,*args):return []
  with self.assertRaises(Blocked):schema.verify(R(),'reviewed migration')

if __name__=='__main__':unittest.main()
