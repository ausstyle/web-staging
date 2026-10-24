#!/usr/bin/env python3
"""Resume persisted proposal/source evidence using current protected snapshots.
No model call, issue creation, approval, queue or Edge deployment is introduced.
"""
import argparse,json,os,re,subprocess,uuid
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write,original_sources
from release_runtime_slice import source_snapshot,hashes
VERSION='20261024005700';MIGRATION='supabase/migrations/'+VERSION+'_sandy_existing_proposal_source_sync.sql'
FIXTURE='scripts/sandy/fixtures/autonomous-scan-v1.sql';PROFILE='scripts/sandy/fixtures/proposal-source-snapshots-20261024.json'
SIGNATURE='public.sandy_autonomous_engineering_scan()';HELPER='public.sandy_autonomous_proposal_source_review(uuid)'
PREIMAGE='729cb1d0acd9ef439a41b6feb8bdf7ffda0307a21036b4e19ec242b6227f8e61'
COMPONENT='sandy-autonomous-engineering-cycle-events'
CASES=['v2:auto_qa:v2_dynamic_qa_clock','v2:auto_qa:v2_dynamic_qa_task_count','v2:auto_qa:v2_dynamic_qa_cross_channel']

def candidate(sql):
 before=(ROOT/FIXTURE).read_text().split('$function$')[1]
 if digest(before.encode())!=PREIMAGE:raise Blocked('reviewed_scan_preimage_changed')
 old=re.search(r'old:=\$old\$(.*?)\$old\$;',sql,re.S);new=re.search(r'replacement:=\$replacement\$(.*?)\$replacement\$;',sql,re.S)
 anchor='declare n integer := 0; v_count integer := 0;'
 if not old or not new or before.count(old[1])!=1 or before.count(anchor)!=1:raise Blocked('fixed_scan_patch_anchors_required')
 return before.replace(anchor,'declare n integer := 0; v_count integer := 0; v_proposals integer := 0; r record; review jsonb;',1).replace(old[1],new[1],1)

def function(r):
 rows=r.sql("SELECT prosrc,prosecdef,proconfig,proacl::text acl,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid="+quote(SIGNATURE)+"::regprocedure",True)
 if len(rows)!=1:raise Blocked('existing_engineering_scanner_required')
 return rows[0]

def inspect_sources(r):
 profiles=json.loads((ROOT/PROFILE).read_bytes());result={}
 if profiles.get('kind')!='reviewed-existing-proposal-source-snapshots-v1' or set(profiles['functions'])!={'sandy-agent-runtime-v4','sandy-examiner-full-cycle'}:raise Blocked('fixed_reviewed_proposal_source_profiles_required')
 for slug,expected in profiles['functions'].items():
  meta=json.loads(r.api('GET','/functions/'+slug));body=r.api('GET','/functions/'+slug+'/body');files=original_sources(body)
  if meta.get('version')!=expected['version'] or meta.get('verify_jwt')!=expected['verify_jwt'] or digest(body)!=expected['body_sha256'] or hashes(files)!=expected['modules']:raise Blocked('proposal_source_snapshot_drift_reconcile_no_redeploy')
  result[slug]={'metadata':meta,'body':body,'snapshot':source_snapshot(slug,meta,body,files)}
 return result

def proposals(r):
 return r.sql("SELECT h.issue_key,encode(sha256(convert_to(to_jsonb(h)::text,'UTF8')),'hex') handoff_sha256,encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex') diagnosis_sha256,encode(sha256(convert_to(d.proposed_fix::text,'UTF8')),'hex') proposal_sha256 FROM public.sandy_qa_engineering_handoffs h JOIN public.sandy_auto_improve_runs d ON d.id::text=h.evidence->>'diagnosis_id' WHERE h.issue_key IN("+','.join(quote(x) for x in CASES)+") ORDER BY h.issue_key",True)

def verify(r,sql):
 history=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True);row=function(r)
 helper=r.sql("SELECT prosrc,prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') authenticated,has_function_privilege('service_role',oid,'EXECUTE') service FROM pg_proc WHERE oid="+quote(HELPER)+"::regprocedure",True)
 expected=re.search(r'CREATE FUNCTION public.sandy_autonomous_proposal_source_review.*?AS \$\$(.*?)\$\$;',sql,re.S)[1]
 if history!=[{'statements':[sql]}] or row['prosrc']!=candidate(sql) or not row['prosecdef'] or row['proconfig']!=['search_path=public, pg_temp'] or helper!=[{'prosrc':expected,'prosecdef':True,'proconfig':['search_path=pg_catalog, pg_temp'],'anon':False,'authenticated':False,'service':False}]:raise Blocked('proposal_source_sync_source_or_permissions_mismatch')
 cron=r.sql("SELECT jobname,schedule,active FROM cron.job WHERE jobname IN('sandy-autonomous-engineering-scan-15m','sandy-autonomous-engineering-reconcile-5m') ORDER BY jobname",True)
 if cron!=[{'jobname':'sandy-autonomous-engineering-reconcile-5m','schedule':'*/5 * * * *','active':True},{'jobname':'sandy-autonomous-engineering-scan-15m','schedule':'*/15 * * * *','active':True}]:raise Blocked('existing_programme_cron_binding_changed')
 return {'installed_source_verified':True,'migration':VERSION,'existing_cron_preserved':True,'paid_investigations':0,'issues_created':0,'approvals_created':0,'capability_acceptance_inferred':False,'Edge_deployments':0}

def run(r,deploy=False,installed=False):
 sql=(ROOT/MIGRATION).read_text();after=candidate(sql)
 if installed:return verify(r,sql)
 before=function(r);sources=inspect_sources(r);prior=proposals(r)
 if digest(before['prosrc'].encode())!=PREIMAGE or before['proconfig']!=['search_path=public, pg_temp'] or not before['prosecdef']:raise Blocked('existing_scan_source_changed')
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True):raise Blocked('proposal_source_sync_already_installed_reconcile_no_replay')
 if len(prior)!=3:raise Blocked('three_existing_proposals_required')
 if not deploy:return {'preflight_passed':True,'source_targets':list(sources),'existing_proposals':prior,'model_requests':0}
 source=os.environ.get('GITHUB_SHA','');run=os.environ.get('GITHUB_RUN_ID','')
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main' or not re.fullmatch('[a-f0-9]{40}',source) or not re.fullmatch('[0-9]{5,20}',run):raise Blocked('protected_main_source_sync_release_required')
 for path in [MIGRATION,FIXTURE,PROFILE,'scripts/sandy/release_runtime_slice.py','scripts/sandy/release_existing_proposal_source_sync.py','scripts/sandy/verify_existing_proposal_source_sync.py','.github/workflows/sandy-delegated-durable-read-release.yml']:
  if subprocess.check_output(['git','show',source+':'+path],cwd=ROOT)!=(ROOT/path).read_bytes():raise Blocked('committed_source_sync_required')
 r.out.mkdir(parents=True,exist_ok=False,mode=0o700);private_write(r.out,'scan-before.json',json.dumps(before).encode());private_write(r.out,'proposal-before.json',json.dumps(prior).encode())
 for slug,s in sources.items():private_write(r.out,slug+'-source.json',json.dumps(s['snapshot']).encode());private_write(r.out,slug+'-source.body',s['body'])
 private_write(r.out,'rollback-scan.sql',("BEGIN;DO $$ BEGIN IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='"+SIGNATURE+"'::regprocedure) IS DISTINCT FROM '"+digest(after.encode())+"' THEN RAISE EXCEPTION 'current_scan_source_changed';END IF;END $$;"+before['definition']+";DROP FUNCTION "+HELPER+";COMMIT;\n-- Preserve source snapshots, proposal provenance and programme audit. Do not replay model requests.\n").encode())
 track=r.sql("INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Resume existing proposal source review','Recovered proposals remain queued for duplicate investigation when no target was confirmed','Reuse bound proposal and reviewed source evidence without paid reinvestigation or false acceptance','SANDY-ENG-0004 supported programme continuation','Existing cron resumes source review and records immutable provenance','[\"sandy-autonomous-engineering-scan\"]','[\"No risk/Owner approval, new issue, paid request or deployment inference\"]','[\"Existing three proposal source review, exact source pins and unchanged handoffs\"]','normal',i.user_id,'proposal-source-sync-'||gen_random_uuid()::text,'proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' RETURNING id")
 cid=str(uuid.UUID(track[0]['id']));holder='proposal-source-sync-'+uuid.uuid4().hex
 components={COMPONENT:PREIMAGE,**{slug:s['snapshot']['bundle_sha256'] for slug,s in sources.items()}}
 values=','.join('('+','.join([quote(c),quote(holder),quote(cid),quote(pin),"clock_timestamp()+interval '10 minutes'"])+')' for c,pin in components.items())
 r.sql("DO $$ DECLARE held integer;BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES"+values+" ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();GET DIAGNOSTICS held=ROW_COUNT;IF held<>3 THEN RAISE EXCEPTION 'source components already leased';END IF;END $$")
 dispatched=verified=False
 try:
  if function(r)!=before or proposals(r)!=prior:raise Blocked('scan_or_proposals_changed_before_sync')
  inspect_sources(r)
  core=sql[sql.index('BEGIN;')+6:sql.rindex('COMMIT;')];events=''
  for slug,s in sources.items():
   detail={'function':slug,'source_commit':source,'github_run_id':run,'source_snapshot':s['snapshot'],'all_module_digests_verified':True,'snapshot_only':True,'actor_kind':'project_management_release','Owner_approval_created':False,'Edge_deployments':0,'capability_acceptance_inferred':False}
   events+="INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(cid)+",'runtime_slice_snapshot_verified',NULL,"+quote(json.dumps(detail))+"::jsonb);"
  dispatched=True;r.stage='install_existing_proposal_source_sync'
  r.sql("BEGIN;DO $$ DECLARE held integer;BEGIN PERFORM 1 FROM public.sandy_engineering_component_leases WHERE holder="+quote(holder)+" AND expires_at>clock_timestamp() FOR UPDATE;GET DIAGNOSTICS held=ROW_COUNT;IF held<>3 THEN RAISE EXCEPTION 'source_sync_component_lease_lost';END IF;END $$;"+core+events+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+VERSION+"',ARRAY["+quote(sql)+"],'sandy_existing_proposal_source_sync','protected_github_management_release','existing-proposal-source-sync-v1');COMMIT;")
  result=verify(r,sql)
  if function(r)['acl']!=before['acl'] or proposals(r)!=prior:raise Blocked('scan_permissions_or_proposals_changed')
  result.update(source_commit=source,tracking_change_id=cid,proposal_before=prior,source_snapshot_versions={slug:s['snapshot']['metadata_version'] for slug,s in sources.items()})
  r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(cid)+",'existing_proposal_source_sync_installed',NULL,"+quote(json.dumps(result))+"::jsonb)")
  verified=True;return result
 finally:
  if not dispatched or verified:r.sql("DELETE FROM public.sandy_engineering_component_leases WHERE holder="+quote(holder))

if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--deploy',action='store_true');g.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',type=Path,required=True);a=p.parse_args();r=Installer(a.evidence_dir/'source-preservation');report={'passed':False}
 try:report.update(run(r,a.deploy,a.verify_installed),passed=True)
 except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'source_sync_failed_or_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request)
 a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'proposal-source-sync.json',json.dumps(report,indent=2).encode());print('::notice title=Existing proposal source sync::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
