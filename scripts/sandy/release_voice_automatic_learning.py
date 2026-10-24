#!/usr/bin/env python3
"""Install only the voice privacy SQL AFTER its fail-closed source is installed.
The existing Runtime slice release owns function upload/custody. Shared05500
source checks, Installer, tracking, leases and immutable audit are reused.
"""
import argparse,json,os,re,subprocess
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write
from release_runtime_slice import inspect,track
from release_automatic_learning_consent import sql_sources
MANIFEST=ROOT/'docs/sandy-engineering/evaluations/voice-automatic-learning-release.json'
VERSION='20261024005600';SLUG='sandy-voice-memory-review'
NEW={'public.sandy_voice_automatic_learning_source(uuid,uuid,timestamptz)','public.sandy_voice_automatic_learning_persist(uuid,uuid,jsonb,jsonb)'}
COMPONENT='sandy-voice-automatic-learning-sql'

def load():
 m=json.loads(MANIFEST.read_bytes())
 if m.get('kind')!='voice-automatic-learning-privacy-v1' or m.get('function')!=SLUG or m.get('migration')!='supabase/migrations/20261024005600_sandy_voice_automatic_learning.sql' or set(m.get('SQL_candidate',{}))!=NEW or set(m.get('SQL_preserved',{}))!={'public.sandy_voice_save_explicit_memory(uuid,text,text)'} or set(m.get('SQL_dependency',{}))!={'public.sandy_automatic_memory_learning_allowed(uuid)'} or m.get('source_manifest')!='docs/sandy-engineering/evaluations/runtime-slices/'+SLUG+'.json':raise Blocked('fixed_voice_privacy_SQL_release_required')
 raw=(ROOT/m['migration']).read_bytes()
 if digest(raw)!=m['migration_sha256']:raise Blocked('reviewed_voice_privacy_migration_changed')
 source=json.loads((ROOT/m['source_manifest']).read_bytes())
 return m,raw,source

def schema(r,m,installed=False):
 sql_sources(r,m['SQL_preserved']);sql_sources(r,m['SQL_dependency'])
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='20261024005500'",True)!=[{'version':'20261024005500'}]:raise Blocked('shared05500_must_be_independently_installed_first')
 history=r.sql("SELECT version,statements FROM supabase_migrations.schema_migrations WHERE version='20261024005600'",True)
 expected=[{'version':VERSION,'statements':[(ROOT/m['migration']).read_text()]}]if installed else []
 if history!=expected:raise Blocked('voice_privacy_SQL_history_requires_reconciliation_no_replay')
 if installed:
  sql_sources(r,m['SQL_candidate'])
  for signature in NEW:
   flags=r.sql("SELECT has_function_privilege('anon',"+quote(signature)+",'EXECUTE')anon,has_function_privilege('authenticated',"+quote(signature)+",'EXECUTE')customer,has_function_privilege('service_role',"+quote(signature)+",'EXECUTE')internal",True)
   if flags!=[{'anon':False,'customer':False,'internal':True}]:raise Blocked('voice_automatic_learning_internal_only_boundary_changed')
 elif r.sql("SELECT proname FROM pg_proc WHERE oid IN("+','.join('to_regprocedure('+quote(s)+')'for s in NEW)+")",True):raise Blocked('partial_voice_privacy_SQL_requires_independent_reconciliation')

def source_check(m):
 sha=os.environ.get('GITHUB_SHA','')
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main' or not re.fullmatch('[a-f0-9]{40}',sha) or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=sha:raise Blocked('protected_committed_main_release_required')
 for p in [MANIFEST.relative_to(ROOT).as_posix(),m['migration'],m['source_manifest'],'scripts/sandy/release_voice_automatic_learning.py','scripts/sandy/release_automatic_learning_consent.py','scripts/sandy/release_runtime_slice.py','scripts/sandy/release_gcp_admin_read.py','scripts/sandy/release_web_canary.py']:
  if subprocess.check_output(['git','show',sha+':'+p],cwd=ROOT)!=(ROOT/p).read_bytes():raise Blocked('reviewed_voice_privacy_release_source_required')
 return sha

def release(r,m,raw,source,deploy=False):
 # Mandatory source-first ordering: an interrupted SQL stage leaves the strict
 # handler contained. The old unconsented handler must never regain admission.
 before=inspect(r,source,True);schema(r,m)
 if not deploy:return {'preflight_passed':True,'handler_version':before[0]['version'],'mutations':0,'provider_model_calls':0}
 sha=source_check(m);r.out.mkdir(mode=0o700,parents=True,exist_ok=False)
 private_write(r.out,'installed-contained-source.body',before[1]);private_write(r.out,'installed-contained-source.json',json.dumps(before[0]).encode());private_write(r.out,'manifest.json',MANIFEST.read_bytes())
 private_write(r.out,'forward-recovery.json',json.dumps({'never_restore_unconsented_handler':True,'preserve_raw_transcripts_calls_existing_temporal_jobs_and_explicit_saves':True,'unknown_SQL_outcome_requires_history_and_source_readback':True,'automatic_retry':False}).encode())
 change=track(r,{'function':SLUG,'replacements':m['SQL_candidate']},sha)
 r.sql("DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)VALUES("+quote(COMPONENT)+','+quote(r.holder)+','+quote(change)+','+quote(m['migration_sha256'])+",clock_timestamp()+interval '10 minutes')ON CONFLICT(component)DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
 dispatched=verified=False
 try:
  inspect(r,source,True);schema(r,m)
  if r.sql("SELECT count(*)::int held FROM public.sandy_engineering_component_leases WHERE component="+quote(COMPONENT)+' AND holder='+quote(r.holder)+' AND change_id='+quote(change)+' AND expires_at>clock_timestamp()',True)!=[{'held':1}]:raise Blocked('voice_privacy_SQL_lease_lost')
  r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)VALUES("+quote(change)+",'voice_privacy_SQL_dispatch',NULL,"+quote(json.dumps({'source_commit':sha,'strict_handler_preverified':True,'Owner_approval_created':False,'consent_or_identity_changes':False,'provider_model_calls':0}))+"::jsonb)")
  sql=re.sub(r'\bBEGIN;','',raw.decode(),count=1);sql=re.sub(r'COMMIT;\s*$','',sql)
  dispatched=True
  r.sql('BEGIN;'+sql+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key)VALUES('20261024005600',ARRAY["+quote(raw.decode())+"],'sandy_voice_automatic_learning','protected_github_management_release','voice-automatic-learning-20261024005600');COMMIT;")
  schema(r,m,True);inspect(r,source,True)
  result={'source_commit':sha,'tracking_change_id':change,'migration':VERSION,'strict_handler_and_SQL_verified':True,'explicit_writer_source_and_ACL_preserved':True,'raw_sources_or_consent_modified':False,'automatic_temporal_dispatch_contained':True,'provider_model_calls':0,'positive_live_learning_verified':False}
  r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)VALUES("+quote(change)+",'voice_privacy_SQL_verified',NULL,"+quote(json.dumps(result))+"::jsonb)");verified=True;return result
 except Exception:
  if dispatched:
   try:r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)VALUES("+quote(change)+",'voice_privacy_SQL_outcome_unknown',NULL,'{\"automatic_retry\":false,\"reconcile_before_retry\":true,\"strict_handler_retained\":true}'::jsonb)")
   except Exception:pass
  raise
 finally:
  if not dispatched or verified:r.sql("DELETE FROM public.sandy_engineering_component_leases WHERE component="+quote(COMPONENT)+' AND holder='+quote(r.holder)+' AND change_id='+quote(change))

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--deploy',action='store_true');p.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',type=Path,required=True);a=p.parse_args()
 if a.deploy and a.verify_installed:p.error('choose one activation or independent readback')
 r=Installer(a.evidence_dir/'private-custody');report={'passed':False}
 try:
  m,raw,source=load()
  if a.verify_installed:inspect(r,source,True);schema(r,m,True);report.update(source_and_SQL_verified=True,mutations=0)
  else:report.update(release(r,m,raw,source,a.deploy))
  report['passed']=True
 except Exception as error:report.update(error=str(error)if isinstance(error,Blocked)else'voice_privacy_SQL_unknown_reconcile_before_retry',last_management_request=r.last_request,automatic_retry=False)
 a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'redacted-receipt.json',json.dumps(report,indent=2).encode());print('::notice title=Voice automatic learning privacy SQL::'+json.dumps(report));return 0 if report['passed']else 1
if __name__=='__main__':raise SystemExit(main())
