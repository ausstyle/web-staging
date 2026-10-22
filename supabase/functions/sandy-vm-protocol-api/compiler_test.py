"""Source invariants; these are not external-provider/auth evidence."""
import hashlib,json,pathlib,re,unittest
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[2]
class SourceContracts(unittest.TestCase):
 def test_all_nine_closed_and_strict(self):
  ops=json.loads((HERE/'contracts.json').read_text());self.assertEqual(len(ops),9)
  for op in ops:
   unhashed={k:v for k,v in op.items() if k!='contract_sha256'};canonical=json.dumps(unhashed,sort_keys=True,separators=(',',':'),ensure_ascii=False)
   self.assertEqual(hashlib.sha256(canonical.encode()).hexdigest(),op['contract_sha256']);self.assertTrue(op['requires_approval']);self.assertTrue(op['requires_grant']);self.assertFalse(op['api_key_delegable']);self.assertFalse(op['input_schema']['additionalProperties'])
  sql=(ROOT/'supabase/migrations/20261021008910_sandy_vm_protocol_contracts.sql').read_text();self.assertEqual(sql.count('INSERT INTO public.sandy_vm_protocol_contracts'),9);self.assertEqual(sql.count('UPDATE public.sandy_operation_registry SET'),3);self.assertEqual(sql.count('INSERT INTO public.sandy_operation_registry('),6);self.assertNotIn('api_exposed=true',sql);self.assertNotIn('verified=true',sql)
 def test_consumer_extension_preserves_entire_post108_baseline(self):
  before=(HERE/'consumer_before.sql').read_text();sql=(ROOT/'supabase/migrations/20261021008900_sandy_vm_protocol_boundary.sql').read_text();after=sql.split('AS $consumer$',1)[1].split('$consumer$;',1)[0]
  restored=after.replace(",'sandy-vm-protocol-api')",")")
  restored=re.sub(r" IF entry.handler='sandy-vm-protocol-api' THEN\n.*? END IF;\n",'',restored,count=1,flags=re.S)
  restored=restored.replace("CASE WHEN p_operation='cloud.vm.exec' AND entry.handler='sandy-vm-protocol-api' THEN 'gcp_access_token' WHEN p_operation LIKE 'supabase.%'","CASE WHEN p_operation LIKE 'supabase.%'")
  self.assertEqual(restored,before);self.assertIn(hashlib.sha256(before.encode()).hexdigest(),sql);self.assertIn("entry.handler='sandy-legacy-compatibility-api'",after)
 def test_no_changes_to_generic_finish_or_older_migrations(self):
  sql=(ROOT/'supabase/migrations/20261021008900_sandy_vm_protocol_boundary.sql').read_text();self.assertNotIn('CREATE OR REPLACE FUNCTION public.sandy_api_finish_execution',sql)
  self.assertIn("provider_http_status=NULL",sql);self.assertIn("'native_readback',true,'provider_effect_confirmed',false",sql);self.assertIn('clock_timestamp()',sql);self.assertIn('arguments_vault_id uuid',sql);self.assertNotIn(',arguments_canonical text NOT NULL',sql)
if __name__=='__main__':unittest.main()
