#!/usr/bin/env python3
"""Protected release binding after independent Cloud Run readback. No IAM.
Never overwrite an existing binding on a retry: reconcile unknown outcomes.
"""
import argparse,json,os,re,subprocess
from pathlib import Path
from release_gcp_admin_read import Installer,quote,digest
from release_web_canary import ROOT,Blocked,private_write
from prepare_iap_repair_transport import worker_manifest
from verify_iap_transport_installation import verify
IDENTITY='sandy-mcp-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com'
NAMES=['SANDY_IAP_REPAIR_WORKER_URL','SANDY_IAP_REPAIR_SOURCE_SHA256','SANDY_IAP_REPAIR_WORKER_REVISION']
def validate(before,after,revision,source,run,attempt,manifest):
 expected='sandy-engineering-mcp-iap-'+run+'-'+attempt
 if not re.fullmatch('[a-f0-9]{40}',source) or not re.fullmatch('[1-9][0-9]{0,14}',run) or not re.fullmatch('[1-9][0-9]{0,14}',attempt):raise Blocked('release_source_identifiers_required')
 if before.get('service')!='sandy-engineering-mcp' or before.get('project')!='elaborate-haven-511518-a5' or before.get('source_commit_candidate')!=source or before.get('verified_runtime_identity')!=IDENTITY:raise Blocked('preserved_release_source_identity_required')
 if not re.fullmatch(r'https://sandy-engineering-mcp-[a-z0-9]+-ew\.a\.run\.app',before.get('url','')):raise Blocked('fixed_cloud_run_service_url_required')
 status=after.get('status',{});tag=[t for t in status.get('traffic',[]) if t.get('tag')=='sandy-iap-repair-review']
 if len(tag)!=1 or tag[0].get('revisionName')!=expected or tag[0].get('url')!='https://sandy-iap-repair-review---'+before['url'].removeprefix('https://'):raise Blocked('distinct_fixed_candidate_tag_required')
 active=lambda rows:sorted((r['revisionName'],r['percent']) for r in rows if r.get('percent',0)>0)
 if active(before.get('traffic',[]))!=active(status.get('traffic',[])) or sum(r.get('percent',0) for r in status.get('traffic',[]))!=100:raise Blocked('production_traffic_must_remain_unchanged')
 old=[t for t in before.get('traffic',[]) if t.get('tag')=='sandy-api-review'];now=[t for t in status.get('traffic',[]) if t.get('tag')=='sandy-api-review']
 stable=lambda rows:[{k:r.get(k) for k in ['revisionName','tag','url']} for r in rows]
 if len(old)!=1 or old[0].get('revisionName')!='sandy-engineering-mcp-api-39849886412-4' or stable(old)!=stable(now):raise Blocked('original_candidate_tag_must_remain_unchanged')
 if revision.get('revision')!=expected or revision.get('runtime_identity')!=IDENTITY or revision.get('source_commit')!=source or revision.get('source_sha256')!=manifest['source_sha256'] or revision.get('transport_enabled')!='true' or revision.get('ready') is not True or not isinstance(revision.get('image_digest'),str) or '@sha256:' not in revision['image_digest']:raise Blocked('independent_revision_source_identity_readback_required')
 return {'source_commit':source,'source_sha256':manifest['source_sha256'],'revision':expected,'url':tag[0]['url'],'runtime_identity':IDENTITY,'image_digest':revision['image_digest'],'production_traffic_unchanged':True,'original_candidate_tag_preserved':True}
def bind(r,release):
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
 sha=os.environ.get('GITHUB_SHA','');run=os.environ.get('GITHUB_RUN_ID','');attempt=os.environ.get('GITHUB_RUN_ATTEMPT','')
 if subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=sha:raise Blocked('checked_out_source_mismatch')
 read=lambda n:json.loads((release/n).read_text())
 proof=validate(read('before.json'),read('after.json'),read('iap-runtime-identity.json'),sha,run,attempt,worker_manifest())
 prerequisite=verify(r)
 if not prerequisite['passed']:raise Blocked('installed_protected_transport_required')
 existing=json.loads(r.api('GET','/secrets'))
 if any(x.get('name') in NAMES for x in existing):raise Blocked('existing_iap_binding_reconcile_before_retry_no_overwrite')
 values=[proof['url'],proof['source_sha256'],proof['revision']]
 private_write(r.out,'rollback-remove-new-runtime-bindings.json',json.dumps(NAMES).encode())
 # All values are non-credential configuration. The existing administrator-read
 # binding and every unrelated secret remain untouched.
 r.api('POST','/secrets',json.dumps([{'name':n,'value':v} for n,v in zip(NAMES,values)]).encode())
 observed=json.loads(r.api('GET','/secrets'))
 if any(not any(x.get('name')==name and x.get('value')==digest(value.encode()) for x in observed) for name,value in zip(NAMES,values)):
  raise Blocked('runtime_binding_hash_readback_unverified_reconcile_no_retry')
 r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('52d56740-59c8-4db1-b7e6-a137c7699b86','iap_transport_runtime_bound',NULL,"+quote(json.dumps({**proof,'grant_established':False,'IAM_changes':0,'audit_actor':'protected_management_release'}))+"::jsonb)")
 return {'passed':True,**proof,'installed_transport_verified':True,'binding_names':NAMES,'grant_established':False,'IAM_changes':0,'provider_execution_verified':False}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--release-dir',required=True);a=p.parse_args();root=Path(a.release_dir);r=Installer(root)
 try:report=bind(r,root)
 except Blocked as e:report={'passed':False,'error':str(e),'IAM_changes':0,'grant_established':False}
 except Exception:report={'passed':False,'error':'runtime_binding_failed_or_unknown_reconcile_before_retry','IAM_changes':0,'grant_established':False}
 private_write(root,'iap-runtime-binding.json',json.dumps(report,indent=2).encode());print('::notice title=Protected IAP runtime binding::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
