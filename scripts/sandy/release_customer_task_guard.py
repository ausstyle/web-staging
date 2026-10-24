"""Additive SQL-only repair on exact installed API65; no Edge uploads or effects."""
import argparse,json,os,re
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write
from release_runtime_slice import track

MANIFEST=ROOT/'docs/sandy-engineering/evaluations/customer-task-guard-release.json'
def load():
 m=json.loads(MANIFEST.read_bytes())
 if m['migration']!='supabase/migrations/20261024022000_sandy_customer_task_guard_commit.sql' or m['version']!='20261024022000':raise Blocked('fixed_task_guard_repair_required')
 raw=(ROOT/m['migration']).read_text()
 if digest(raw.encode())!=m['migration_sha256']:raise Blocked('task_guard_migration_source_changed')
 return m,raw

def state(r,require=False):
 m,raw=load()
 history=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='20261024022000'",True)
 if history not in ([],[{'statements':[raw]}]):raise Blocked('task_guard_migration_history_drift')
 if require and not history:raise Blocked('task_guard_repair_required_before_finite_retry')
 guard=r.sql("SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') sha,p.prosecdef,t.tgdeferrable,t.tginitdeferred,t.tgenabled,t.tgtype::int type,t.tgisinternal internal,t.tgqual IS NULL no_predicate,t.tgattr=''::int2vector no_columns,(SELECT count(*)::int FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname='sandy_agenda_task_company_check') names FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.sandy_tasks'::regclass AND t.tgname='sandy_agenda_task_company_check' AND p.oid='public.sandy_agenda_task_company_guard()'::regprocedure",True)
 if guard!=[{'sha':m['guard_sha256'],'prosecdef':False,'tgdeferrable':True,'tginitdeferred':True,'tgenabled':'O','type':21,'internal':False,'no_predicate':True,'no_columns':True,'names':1}]:raise Blocked('original_task_guard_authority_changed')
 return m['after_rpc_sha256' if history else 'before_rpc_sha256']

def run(r,deploy=False):
 from release_customer_mutation_certification import load as original_load,functions,schema,source_check
 original,_=original_load();m,raw=load()
 functions(r,original,True);before=schema(r,original,True)
 if state(r)==m['after_rpc_sha256']:raise Blocked('repair_already_installed_verify_only_no_replay')
 if not deploy:return {'preflight_passed':True,'deployed':False,'Edge_deployments':0}
 sha=source_check(original)
 r.out.mkdir(mode=0o700,parents=True,exist_ok=False)
 private_write(r.out,'before-canonical-RPC.json',json.dumps(before).encode())
 private_write(r.out,'rollback.json',json.dumps({'manual_only':True,'restore_definition_from':'before-canonical-RPC.json','only_if_current_RPC_sha256':m['after_rpc_sha256'],'preserve_receipts_and_revocations':True,'reconcile_migration_history':True,'no_automatic_down_migration':True}).encode())
 change=track(r,{'function':'sandy-operation-api','replacements':{'deferred_task_guard':m['migration_sha256']}},sha)
 r.sql("BEGIN;DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('sandy-operation-api',"+quote(r.holder)+","+quote(change)+","+quote(m['before_rpc_sha256'])+",clock_timestamp()+interval '15 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;COMMIT;")
 dispatched=False;verified=False
 try:
  functions(r,original,True);current=schema(r,original,True)
  if current!=before or state(r)!=m['before_rpc_sha256']:raise Blocked('repair_preimage_changed')
  if r.sql('SELECT count(*)::int held FROM public.sandy_engineering_component_leases WHERE component=\'sandy-operation-api\' AND holder='+quote(r.holder)+' AND change_id='+quote(change)+' AND expires_at>clock_timestamp()',True)!=[{'held':1}]:raise Blocked('repair_lease_lost')
  r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(change)+",'customer_task_guard_repair_dispatch',NULL,"+quote(json.dumps({'source_commit':sha,'github_run_id':os.environ.get('GITHUB_RUN_ID'),'migration':m['version'],'before_rpc_sha256':m['before_rpc_sha256'],'after_rpc_sha256':m['after_rpc_sha256'],'Edge_deployments':0}))+"::jsonb)")
  dispatched=True
  sql=re.sub(r'\bBEGIN;','',raw,count=1);sql=re.sub(r'COMMIT;\s*$','',sql)
  lease_guard="DO $$ BEGIN PERFORM 1 FROM public.sandy_engineering_component_leases WHERE component='sandy-operation-api' AND holder="+quote(r.holder)+" AND change_id="+quote(change)+" AND expires_at>clock_timestamp() FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'repair_lease_lost';END IF;END $$;"
  r.sql('BEGIN;'+lease_guard+sql+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('20261024022000',ARRAY["+quote(raw)+"],'sandy_customer_task_guard_commit','protected_github_management_release','customer-task-guard-20261024022000');COMMIT;")
  functions(r,original,True);after=schema(r,original,True);state(r,True)
  if any(after[k]!=before[k] for k in ['row_oid','acl','prosecdef','proconfig','customer','anon','service']):raise Blocked('canonical_RPC_authority_changed')
  result={'passed':True,'source_commit':sha,'change_id':change,'migration':m['version'],'RPC_sha256':after['sha'],'Edge_deployments':0,'grants_changed':False,'customer_acceptance':False}
  r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(change)+",'customer_task_guard_repair_verified',NULL,"+quote(json.dumps(result))+"::jsonb)")
  verified=True;return result
 except Exception:
  if dispatched:
   try:r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(change)+",'customer_task_guard_repair_outcome_unknown',NULL,'{\"reconcile_before_retry\":true,\"automatic_retry\":false}'::jsonb)")
   except Exception:pass
  raise
 finally:
  if not dispatched or verified:r.sql('DELETE FROM public.sandy_engineering_component_leases WHERE holder='+quote(r.holder)+' AND change_id='+quote(change))

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--deploy',action='store_true');p.add_argument('--evidence-dir',type=Path,required=True);a=p.parse_args()
 r=Installer(a.evidence_dir/'private-preimages');result={'passed':False}
 try:result.update(run(r,a.deploy));result['passed']=True
 except Exception as e:result.update(error=str(e) if isinstance(e,Blocked) else 'repair_failed_or_unknown_reconcile_before_retry',automatic_retry=False)
 a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'receipt.json',json.dumps(result).encode());print('::notice::'+json.dumps(result));return 0 if result['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
