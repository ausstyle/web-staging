"""Offline contract and exact private source-class regression checks."""
from pathlib import Path
import json,re,hashlib,unittest
from jsonschema import Draft7Validator
ROOT=Path(__file__).resolve().parents[2]
class Artifact(unittest.TestCase):
 def test_draft7_and_exact_six_source_classes(self):
  op=json.loads((ROOT/'supabase/functions/sandy-provider-artifact-api/contracts.json').read_text())[0]
  Draft7Validator.check_schema(op['input_schema']);Draft7Validator.check_schema(op['output_schema'])
  self.assertTrue(op['requires_approval']);self.assertTrue(op['requires_grant']);self.assertFalse(op['api_key_delegable'])
  sources=op['input_schema']['properties']['source_operation']['enum'];self.assertEqual(len(sources),6)
  self.assertFalse(any(any(x in source for x in ['kms','sensitive','functions','identity','cursor','token']) for source in sources))
 def test_timestamp_replacement_uses_exact_reviewed_original_and_single_instant(self):
  raw=(ROOT/'supabase/migrations/20261021008400_sandy_provider_supplement.sql').read_text()
  body=re.search(r'CREATE FUNCTION public\.sandy_provider_supplement_save_opaque\(p_context jsonb\)[\s\S]*? AS \$\$([\s\S]*?)\$\$;',raw).group(1)
  sql=(ROOT/'supabase/migrations/20261021008800_sandy_provider_artifact_delivery.sql').read_text()
  self.assertIn(hashlib.sha256(body.encode()).hexdigest(),sql)
  new=re.search(r'CREATE OR REPLACE FUNCTION public\.sandy_provider_supplement_save_opaque\(p_context jsonb\).*? AS \'((?:\'\'|[^\'])*)\';',sql).group(1).replace("''","'")
  restored=new.replace(' capture_time:=clock_timestamp();\n','').replace('; capture_time timestamptz;',';').replace('(created_at,actor_id,','(actor_id,').replace('VALUES(capture_time,admission.actor_id,','VALUES(admission.actor_id,').replace("capture_time+CASE WHEN p_context->>'kind'='artifact'","clock_timestamp()+CASE WHEN p_context->>'kind'='artifact'")
  self.assertEqual(restored,body)
 def test_closed_registry_no_automatic_retry_or_credential_resolver(self):
  sql=(ROOT/'supabase/migrations/20261021008800_sandy_provider_artifact_delivery.sql').read_text()
  self.assertIn("'sandy-provider-artifact-api',false,false,false,false",sql)
  source=(ROOT/'supabase/functions/sandy-provider-artifact-api/index.ts').read_text()
  self.assertNotIn('createCredentialConsumer',source);self.assertNotIn('createMachineAccessToken',source)
  self.assertIn('request_may_have_executed: true',source)
if __name__=='__main__':unittest.main()
