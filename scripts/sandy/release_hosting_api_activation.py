#!/usr/bin/env python3
"""Protected exact hosting API activation; no customer impersonation or AI exposure."""
import argparse,base64,gzip,json,os,subprocess,uuid
from pathlib import Path
from check_hosting_api_activation import load,inspect,registry,activation_sql,sha,require,PIN,MANIFEST,COLS
from release_gcp_admin_read import Installer,quote
from release_web_canary import ROOT,original_sources,Blocked
from release_hosting_accounts import store_recovery
TARGET='sandy-operation-api'
COMPONENTS=(TARGET,'sandy-operation-registry:hosting-accounts')
def owner(r,change):
 rows=r.sql(f"""SELECT EXISTS(SELECT 1 FROM public.sandy_engineering_changes c
 JOIN public.sandy_engineering_change_events e ON e.change_id=c.id
 JOIN public.sandy_controller_admins a ON a.auth_user_id=e.actor AND a.enabled AND a.role='owner'
 JOIN auth.users u ON u.id=a.auth_user_id
 WHERE c.id='{change}' AND c.status IN ('approved','implementing')
 AND c.scope @> '["sandy-operation-api","hosting.accounts.create","hosting.accounts.get"]'::jsonb
 AND e.event_type='status_changed' AND e.detail->>'to'='approved'
 AND position('{PIN}' in e.detail->>'reason')>0
 AND position('API-only hosting activation' in e.detail->>'reason')>0
 AND e.occurred_at>clock_timestamp()-interval '24 hours'
 AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true') admitted""",True)
 require(rows==[{'admitted':True}],'exact_authenticated_Owner_activation_required')
def protected():
 require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REF')=='refs/heads/main' and os.environ.get('GITHUB_REPOSITORY')=='ausstyle/web-staging','protected_main_required')
 head=os.environ.get('GITHUB_SHA','')
 require(subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==head,'checkout_drift')
 subprocess.check_call(['git','diff','--exit-code','HEAD'],cwd=ROOT,stdout=subprocess.DEVNULL)
 from release_hosting_read import verify_ci
 rows=json.loads(subprocess.check_output(['gh','api',f'repos/ausstyle/web-staging/commits/{head}/check-runs?per_page=100']))
 verify_ci(rows['check_runs'],head,{'examiner-evidence-tests','offline-contract-tests'})
def event(r,change,kind,detail):
 r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}',{quote('hosting_api_'+kind)},NULL,{quote(json.dumps({'manifest_sha256':PIN,**detail}))}::jsonb)")
def observe(r,m):
 meta=json.loads(r.api('GET','/functions/'+TARGET));body=r.api('GET','/functions/'+TARGET+'/body')
 require(meta.get('status')=='ACTIVE' and meta.get('verify_jwt') is True,'gateway_security_drift')
 hashes={p:sha(b) for p,b in original_sources(body).items()}
 state='candidate' if hashes==m['after_files'] else 'before' if hashes==m['gateway']['files'] else 'foreign'
 rows=registry(r);after=[{**x,'api_exposed':True} for x in m['registry']]
 return {'version':meta['version'],'source':state,'registry':'active' if rows==after else 'inactive' if rows==m['registry'] else 'foreign','customer_acceptance_passed':False}
def upload(r,files):
 boundary='hosting-api-'+uuid.uuid4().hex
 parts=[f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode()+json.dumps({'name':TARGET,'entrypoint_path':TARGET+'/index.ts','verify_jwt':True}).encode()+b'\r\n']
 for p,b in files.items():parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{p}"\r\nContent-Type: application/typescript\r\n\r\n'.encode()+b+b'\r\n')
 parts.append(f'--{boundary}--\r\n'.encode());r.api('POST','/functions/deploy?slug='+TARGET,b''.join(parts),'multipart/form-data; boundary='+boundary)
def run(r,mode,change,artifact=None):
 m=load()
 if mode=='reconcile':return observe(r,m)
 if mode=='preflight':inspect(r,m);return {'preflight_passed':True,'mutations':0,'manifest_sha256':PIN}
 change=str(uuid.UUID(change));protected();owner(r,change)
 for component in COMPONENTS:
  r.sql(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
 VALUES({quote(component)},{quote(r.holder)},'{change}','{PIN}',clock_timestamp()+interval '15 minutes')
 ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at
 WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component leased';END IF;END $$;""")
 dispatched=False;finished=False
 try:
  require(r.sql(f"SELECT count(*)::int n FROM public.sandy_engineering_change_events WHERE change_id='{change}' AND event_type='hosting_api_intent' AND detail->>'mode'={quote(mode)}",True)==[{'n':0}],'previous_dispatch_reconcile_no_retry')
  if mode=='deploy':
   files=inspect(r,m);body=r.api('GET','/functions/'+TARGET+'/body');require(sha(body)==m['gateway']['bundle_sha256'],'backup_drift')
   # Reuse the bounded private transfer implementation with its explicit target set.
   import release_hosting_accounts as recovery
   recovery.TARGET=TARGET
   artifact=recovery.store_recovery(r,m,change,m['gateway']['version'],body,PIN)
   inspect(r,m)
  else:
   state=observe(r,m);require(state['source']=='candidate' and state['registry'] in ('active','inactive'),'rollback_foreign_state')
   rows=r.sql(f"SELECT metadata FROM public.sandy_engineering_artifacts WHERE id='{str(uuid.UUID(artifact))}' AND change_id='{change}' AND target='{TARGET}'",True)
   require(len(rows)==1,'rollback_artifact_missing');v=rows[0]['metadata']
   require(v.get('manifest_sha256')==PIN and v.get('bundle_transfer_state')=='complete','rollback_artifact_incomplete')
   packed=base64.b64decode(v['bundle_gzip_base64'],validate=True);require(sha(packed)==v['compressed_sha256'],'rollback_digest')
   body=gzip.decompress(packed);require(sha(body)==m['gateway']['bundle_sha256'],'rollback_preimage');files=original_sources(body)
  owner(r,change)
  require(r.sql(f"SELECT count(*)::int n FROM public.sandy_engineering_component_leases WHERE holder={quote(r.holder)} AND change_id='{change}' AND component IN ({','.join(quote(c) for c in COMPONENTS)}) AND expires_at>clock_timestamp()",True)==[{'n':2}],'lease_lost')
  event(r,change,'intent',{'mode':mode,'artifact':artifact,'github_run_id':os.environ.get('GITHUB_RUN_ID'),'automatic_retry':False});dispatched=True
  if mode=='rollback' and state['registry']=='active':
   # Exact guarded reverse exposure change; never remove account/receipt data.
   reverse=json.loads(json.dumps(m))
   reverse['registry']=[{**x,'api_exposed':False} for x in m['registry']]
   sql=activation_sql(reverse).replace('SET api_exposed=true','SET api_exposed=false')
   for row in m['registry']:
    sql=sql.replace(quote(json.dumps(row)),quote(json.dumps({**row,'api_exposed':True})))
   r.sql(sql)
  upload(r,files)
  state=observe(r,m);require(state['source']==('candidate' if mode=='deploy' else 'before'),'upload_unverified_no_retry')
  if mode=='deploy':
   require(state['registry']=='inactive','registry_changed_before_activation');owner(r,change);r.sql(activation_sql(m))
  result=observe(r,m);require(result['registry']==('active' if mode=='deploy' else 'inactive'),'registry_postcondition')
  event(r,change,'verified',{'mode':mode,'artifact':artifact,**result});finished=True;return result
 finally:
  if not dispatched or finished:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE holder={quote(r.holder)} AND change_id='{change}' AND component IN ({','.join(quote(c) for c in COMPONENTS)})")
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--mode',choices=['preflight','deploy','reconcile','rollback'],default='preflight');p.add_argument('--owner-change-id');p.add_argument('--artifact');a=p.parse_args()
 try:print(json.dumps(run(Installer(Path('/tmp')),a.mode,a.owner_change_id,a.artifact)))
 except Exception as e:print(json.dumps({'ok':False,'error':str(e) if isinstance(e,Blocked) else 'failed_or_unknown_reconcile_no_retry','automatic_retry':False}));raise SystemExit(1)
