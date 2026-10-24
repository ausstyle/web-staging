"""Exact existing-source preservation for the source-only voice extension."""
import hashlib,json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
digest=lambda raw:hashlib.sha256(raw).hexdigest()
MANIFEST=ROOT/'docs/sandy-engineering/evaluations/voice-context-session-source.json'
class VoiceSourceTests(unittest.TestCase):
 def test_existing_media_and_explicit_memory_logic_is_exactly_preserved(self):
  m=json.loads(MANIFEST.read_bytes());s=(ROOT/'supabase/functions/sandy-voice-call/index.ts').read_text()
  s=s.replace('import {handleVoiceContextSession} from "./context_session.ts";\n','',1)
  s=s.replace('\n if(url.pathname.endsWith("/context/session")||url.pathname.endsWith("/context/retire"))return handleVoiceContextSession(request,{base:Deno.env.get("SUPABASE_URL")||"",anonKey:Deno.env.get("SUPABASE_ANON_KEY")||"",createClient});','',1)
  s=s.replace('trusted_memory,purpose")','trusted_memory")',1)
  s=s.replace('\n if(link.purpose==="context_only")return json({error:"context_only_session_cannot_access_voice_or_provider_operations"},403);','',1)
  self.assertEqual(digest(s.encode()),m['functions']['sandy-voice-call']['before_files']['index.ts'])
 def test_source_manifest_pins_every_candidate_module_and_migration(self):
  m=json.loads(MANIFEST.read_bytes())
  self.assertFalse(m['deployed']);self.assertEqual(m['catalogue_changes'],0)
  self.assertEqual(digest((ROOT/m['migration']).read_bytes()),m['migration_sha256'])
  for item in m['functions'].values():
   for p,h in item['candidate_files'].items():self.assertEqual(digest((ROOT/'supabase/functions'/p).read_bytes()),h,p)
  self.assertEqual(m['functions']['sandy-voice-call']['version'],40)
  self.assertEqual(m['functions']['sandy-voice-account-context']['version'],22)
 def test_existing_voice_context_permissions_and_consent_fences_are_preserved(self):
  m=json.loads(MANIFEST.read_bytes())['functions']['sandy-voice-account-context']['before_files']
  s=(ROOT/'supabase/functions/sandy-voice-account-context/index.ts').read_text()
  s=s.replace('token_sha256,revoked_at,purpose")','token_sha256,revoked_at")',1)
  s=s.replace(' if(executive&&link.purpose==="context_only")return reply({error:"context_only_session_cannot_execute_turns"},403);\n','',1)
  self.assertEqual(digest(s.encode()),m['sandy-voice-account-context/index.ts'])
  s=(ROOT/'supabase/functions/_shared/sandy-agent-operations/voice_source.ts').read_text()
  s=s.replace('revoked_at,purpose")','revoked_at")',1)
  s=s.replace('''  if(link.data?.purpose==="context_only"){
    const current=await db.rpc("sandy_voice_context_authority_current",{p_session:sessionId});
    return !link.error&&!link.data.revoked_at&&!auth.error&&!!auth.data?.verified_at&&!current.error&&current.data===true;
  }
''','',1)
  self.assertEqual(digest(s.encode()),m['_shared/sandy-agent-operations/voice_source.ts'])
 def test_no_owner_identity_catalogue_or_unrestricted_provider_executor_is_added(self):
  sql=(ROOT/'supabase/migrations/20261024005400_sandy_voice_context_session.sql').read_text()
  self.assertNotIn('sandy_operation_registry',sql);self.assertNotIn('sandy_controller_admins',sql)
  self.assertNotIn('INSERT INTO auth.users',sql);self.assertNotIn('CREATE TABLE',sql)
  self.assertIn("auth.role() IS DISTINCT FROM 'authenticated'",sql)
  self.assertIn("context_auth_session_id",sql)
  self.assertIn("starts=0",sql) # An old media-claim counter cannot consume context-only links.
if __name__=='__main__':unittest.main()
