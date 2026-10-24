#!/usr/bin/env python3
"""Activate the reviewed normal-Auth context-only voice lifecycle.

Issuer stays revoked until BOTH exact source guards are independently read back.
No media, model, Owner authority, customer consent or identity records are created.
Unknown outcomes require reconciliation; this tool never retries or restores source.
"""
import argparse,json,os,re,subprocess
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write,original_sources
from release_runtime_slice import hashes,track
from release_automatic_learning_consent import sql_sources
MANIFEST=ROOT/'docs/sandy-engineering/evaluations/voice-context-session-release.json'
VERSION='20261024005400'
CALL='sandy-voice-call';CONTEXT='sandy-voice-account-context'
ISSUE='public.sandy_voice_context_session_issue(uuid)'
RETIRE='public.sandy_voice_context_session_retire(uuid)'
AUTHORITY='public.sandy_voice_context_authority_current(uuid)'
NEW={ISSUE,RETIRE,AUTHORITY,'public.sandy_voice_context_actor(boolean)','public.sandy_voice_context_expire()'}
CHANGED={CALL:{CALL+'/index.ts',CALL+'/context_session.ts'},CONTEXT:{CONTEXT+'/index.ts','_shared/sandy-agent-operations/voice_source.ts'}}
HOLD='REVOKE ALL ON FUNCTION '+ISSUE+' FROM PUBLIC,anon,authenticated,service_role;'
ACTIVATE='GRANT EXECUTE ON FUNCTION '+ISSUE+' TO authenticated;'
COMPONENTS=('sandy-voice-context-session',CALL,CONTEXT)

def load():
 m=json.loads(MANIFEST.read_bytes())
 if m.get('kind')!='protected-normal-customer-voice-context-release-v1' or set(m.get('functions',{}))!={CALL,CONTEXT} or set(m.get('SQL_candidate',{}))!=NEW or m.get('migration')!='supabase/migrations/20261024005400_sandy_voice_context_session.sql':raise Blocked('fixed_voice_context_release_required')
 raw=(ROOT/m['migration']).read_bytes()
 if digest(raw)!=m['migration_sha256']:raise Blocked('reviewed_context_SQL_changed')
 for slug,item in m['functions'].items():
  if item['verify_jwt'] is not False or not isinstance(item['version'],int):raise Blocked('fixed_voice_context_auth_required')
  for name in CHANGED[slug]:
   if digest((ROOT/'supabase/functions'/name).read_bytes())!=item['candidate_files'][name]:raise Blocked('reviewed_context_source_changed')
  expected=dict(item['before_files'])
  if slug==CALL:
   if set(expected)!={'index.ts'}:raise Blocked('exact_legacy_voice_flat_source_required')
   expected={}
  expected.update({p:item['candidate_files'][p]for p in CHANGED[slug]})
  if expected!=item['candidate_files']:raise Blocked('unchanged_context_modules_must_be_preserved')
 return m,raw

def read(r,m,slug,installed=False):
 item=m['functions'][slug];meta=json.loads(r.api('GET','/functions/'+slug));body=r.api('GET','/functions/'+slug+'/body');files=original_sources(body)
 if meta.get('slug')!=slug or meta.get('status')!='ACTIVE' or meta.get('verify_jwt')is not False or meta.get('version')!=item['version']+int(installed) or meta.get('import_map')is True or meta.get('import_map_path') or hashes(files)!=item['candidate_files'if installed else'before_files'] or(not installed and digest(body)!=item['body_sha256']):raise Blocked('context_source_drift_reconcile_no_retry')
 return meta,body,files

def candidate(m,slug,before):
 if hashes(before)!=m['functions'][slug]['before_files']:raise Blocked('all_original_context_modules_required')
 files={}if slug==CALL else dict(before)
 for name in CHANGED[slug]:files[name]=(ROOT/'supabase/functions'/name).read_bytes()
 if hashes(files)!=m['functions'][slug]['candidate_files']:raise Blocked('context_candidate_hashes_changed')
 return files

def schema(r,m,state='absent'):
 sql_sources(r,m['SQL_preserved'])
 rows=r.sql("SELECT version,statements FROM supabase_migrations.schema_migrations WHERE version='20261024005400'",True)
 expected=[]if state=='absent'else[{'version':VERSION,'statements':[(ROOT/m['migration']).read_text(),HOLD]}]
 if rows!=expected:raise Blocked('context_migration_history_requires_reconciliation')
 if state=='absent':
  if r.sql('SELECT oid::text FROM pg_proc WHERE oid IN('+','.join('to_regprocedure('+quote(s)+')'for s in sorted(NEW))+')',True):raise Blocked('partial_context_SQL_requires_reconciliation')
  return
 sql_sources(r,m['SQL_candidate'])
 for sig in sorted(NEW):
  acl=r.sql("SELECT has_function_privilege('anon',"+quote(sig)+",'EXECUTE')anon,has_function_privilege('authenticated',"+quote(sig)+",'EXECUTE')customer,has_function_privilege('service_role',"+quote(sig)+",'EXECUTE')internal",True)
  expected={'anon':False,'customer':sig==RETIRE or(sig==ISSUE and state=='active'),'internal':sig==AUTHORITY}
  if acl!=[expected]:raise Blocked('context_RPC_authority_boundary_changed')
 scheduler=r.sql("SELECT count(*)::int n FROM cron.job WHERE jobname='sandy-voice-context-expiry' AND active AND schedule='* * * * *' AND command='SELECT public.sandy_voice_context_expire()'",True)
 if scheduler!=[{'n':1}]:raise Blocked('context_private_expiry_scheduler_required')

def source_check(m):
 sha=os.environ.get('GITHUB_SHA','')
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main' or not re.fullmatch('[a-f0-9]{40}',sha) or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=sha:raise Blocked('protected_committed_main_context_release_required')
 paths=[MANIFEST.relative_to(ROOT).as_posix(),m['migration'],'scripts/sandy/release_voice_context_session.py','.github/workflows/sandy-voice-context-session-release.yml','scripts/sandy/test_voice_context_release.py','scripts/sandy/release_automatic_learning_consent.py','scripts/sandy/release_runtime_slice.py','scripts/sandy/release_gcp_admin_read.py','scripts/sandy/release_web_canary.py']+['supabase/functions/'+p for names in CHANGED.values()for p in names]
 for p in paths:
  if subprocess.check_output(['git','show',sha+':'+p],cwd=ROOT)!=(ROOT/p).read_bytes():raise Blocked('committed_context_release_source_required')
 return sha

def event(r,change,name,detail):
 r.sql('INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)VALUES('+quote(change)+','+quote(name)+',NULL,'+quote(json.dumps(detail))+ '::jsonb)')

def release(r,m,raw,deploy=False):
 before={slug:read(r,m,slug)for slug in (CALL,CONTEXT)};schema(r,m)
 after={slug:candidate(m,slug,before[slug][2])for slug in before}
 if not deploy:return {'preflight_passed':True,'mutations':0,'provider_model_media_calls':0}
 sha=source_check(m);r.out.mkdir(mode=0o700,parents=True,exist_ok=False)
 for slug,(meta,body,_)in before.items():private_write(r.out,slug+'.before.body',body);private_write(r.out,slug+'.before.json',json.dumps(meta).encode())
 private_write(r.out,'manifest.json',MANIFEST.read_bytes());private_write(r.out,'recovery.json',json.dumps({'automatic_retry':False,'revoke_issuer_before_recovery':HOLD,'never_restore_old_source_while_context_capabilities_exist':True,'required_before_source_restore':'revoke context_only links, run expiry cleanup and independently verify zero usable context tokens/private_auth/Vault custody','preserve_additive_schema_and_immutable_receipts':True,'no_restore_implemented_by_this_tool':True}).encode())
 change=track(r,{'function':CALL,'replacements':{p:m['functions'][s]['candidate_files'][p]for s in CHANGED for p in CHANGED[s]}},sha)
 values=','.join('('+quote(c)+','+quote(r.holder)+','+quote(change)+','+quote(m['migration_sha256'])+",clock_timestamp()+interval '15 minutes')"for c in COMPONENTS)
 r.sql('DO $$ DECLARE acquired integer;BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)VALUES'+values+' ON CONFLICT(component)DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();GET DIAGNOSTICS acquired=ROW_COUNT;IF acquired<>3 THEN RAISE EXCEPTION \'context components already leased\';END IF;END $$')
 dispatched=verified=False
 try:
  for slug in before:read(r,m,slug)
  schema(r,m)
  if r.sql('SELECT count(*)::int n FROM public.sandy_engineering_component_leases WHERE component IN('+','.join(quote(c)for c in COMPONENTS)+')AND holder='+quote(r.holder)+' AND change_id='+quote(change)+' AND expires_at>clock_timestamp()',True)!=[{'n':3}]:raise Blocked('context_component_custody_lost')
  event(r,change,'voice_context_held_install_dispatch',{'source_commit':sha,'issuer_held_until_both_sources_verified':True,'Owner_authority_or_consent_created':False})
  dispatched=True;r.stage='context_held_SQL'
  sql=re.sub(r'\bBEGIN;','',raw.decode(),count=1);sql=re.sub(r'COMMIT;\s*$','',sql)
  r.sql('BEGIN;'+sql+HOLD+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key)VALUES('20261024005400',ARRAY["+quote(raw.decode())+','+quote(HOLD)+"],'sandy_voice_context_session','protected_github_management_release','voice-context-20261024005400');COMMIT;")
  schema(r,m,'held')
  for slug in (CALL,CONTEXT):
   r.stage='context_source_'+slug;read(r,m,slug);schema(r,m,'held');private_write(r.out,slug+'.provider.json',r.upload(slug,after[slug],False));observed=read(r,m,slug,True);private_write(r.out,slug+'.after.body',observed[1])
  for slug in before:read(r,m,slug,True)
  schema(r,m,'held');r.stage='context_issuer_activation'
  event(r,change,'voice_context_issuer_activation_dispatch',{'source_commit':sha,'both_exact_source_maps_verified':True,'normal_customer_auth_and_existing_consent_required':True})
  r.sql(ACTIVATE);schema(r,m,'active')
  for slug in before:read(r,m,slug,True)
  result={'source_commit':sha,'tracking_change_id':change,'migration':VERSION,'deployed_versions':{slug:m['functions'][slug]['version']+1 for slug in before},'all_source_and_SQL_guards_verified':True,'normal_Auth_context_issue_read_retire_acceptance':False,'media_or_provider_acceptance':False,'provider_model_media_calls':0,'customer_consent_or_identity_changes':False}
  event(r,change,'voice_context_source_activation_verified',result);verified=True;return result
 except Exception:
  if dispatched:
   try:event(r,change,'voice_context_activation_unknown',{'stage':r.stage,'automatic_retry':False,'reconcile_before_retry':True,'issuer_may_be_active':r.stage=='context_issuer_activation','source_restore_requires_capability_retirement':True})
   except Exception:pass
  raise
 finally:
  if not dispatched or verified:r.sql('DELETE FROM public.sandy_engineering_component_leases WHERE component IN('+','.join(quote(c)for c in COMPONENTS)+')AND holder='+quote(r.holder)+' AND change_id='+quote(change))

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--deploy',action='store_true');p.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',type=Path,required=True);a=p.parse_args()
 if a.deploy and a.verify_installed:p.error('choose one activation or independent readback')
 r=Installer(a.evidence_dir/'private-custody');report={'passed':False}
 try:
  m,raw=load()
  if a.verify_installed:
   for slug in (CALL,CONTEXT):read(r,m,slug,True)
   schema(r,m,'active');report.update(source_and_SQL_verified=True,mutations=0)
  else:report.update(release(r,m,raw,a.deploy))
  report['passed']=True
 except Exception as e:report.update(error=str(e)if isinstance(e,Blocked)else'context_activation_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request,automatic_retry=False)
 a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'redacted-receipt.json',json.dumps(report,indent=2).encode());print('::notice title=Voice context activation::'+json.dumps(report));return 0 if report['passed']else 1
if __name__=='__main__':raise SystemExit(main())
