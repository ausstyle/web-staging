#!/usr/bin/env python3
"""Read-only verification of one existing candidate. No deploy, binding or IAM."""
import argparse,json,os,subprocess
from pathlib import Path
from release_web_canary import ROOT,Blocked,private_write
from release_gcp_admin_read import Installer,digest
from bind_iap_transport_runtime import validate,NAMES
from prepare_iap_repair_transport import worker_manifest
from release_iap_transport import load,verify_installed
RUN='40047740407';ATTEMPT='1';SOURCE='9ca456d2705c649388d6a12a714a648e6ebea472'
REVISION='sandy-engineering-mcp-iap-'+RUN+'-'+ATTEMPT
PROJECT='elaborate-haven-511518-a5'
WORKER_HASH='1b9ee79c72b160b15d2b3a6d6a44838e15eaf5d33c2db4fcb01de6a7e7ad0df1'
IMAGE='1bb7a80c6764bfd1823ba22d274e1ccc2e49b345c5ac5ea338ee1747804811b7'
def cloud(*args):
 result=subprocess.run(['gcloud',*args,'--project',PROJECT,'--format=json'],capture_output=True,text=True)
 if result.returncode:
  # Do not persist arbitrary provider logs or CLI output, which may contain
  # access URLs or credential configuration. Exact bounded classification only.
  text=result.stderr.lower();code='permission_denied' if 'permission' in text or 'forbidden' in text else 'unauthenticated' if 'unauthenticated' in text else 'provider_read_failed'
  raise Blocked('gcloud_'+code)
 return json.loads(result.stdout)
def service():
 value=cloud('run','services','describe','sandy-engineering-mcp','--region','europe-west1')
 return {'status':{k:value.get('status',{}).get(k) for k in ['traffic','latestCreatedRevisionName','latestReadyRevisionName']}}
def revision():
 value=cloud('run','revisions','describe',REVISION,'--region','europe-west1');meta=value.get('metadata',{});spec=value.get('spec',{});status=value.get('status',{})
 env={r.get('name'):r.get('value') for r in spec.get('containers',[{}])[0].get('env',[]) if r.get('name') in ['SANDY_IAP_REPAIR_SOURCE_SHA256','SANDY_IAP_REPAIR_ENABLED']}
 return {'revision':meta.get('name'),'runtime_identity':spec.get('serviceAccountName'),'source_commit':meta.get('labels',{}).get('sandy-source-commit'),'source_sha256':env.get('SANDY_IAP_REPAIR_SOURCE_SHA256'),'transport_enabled':env.get('SANDY_IAP_REPAIR_ENABLED'),'ready':any(c.get('type')=='Ready' and c.get('status')=='True' for c in status.get('conditions',[])),'image_digest':status.get('imageDigest')}
def readback(original):
 before=json.loads((original/'before.json').read_text());actual=service();rev=revision();manifest=worker_manifest()
 if manifest['source_sha256']!=WORKER_HASH:raise Blocked('candidate_worker_source_changed')
 proof=validate(before,actual,rev,SOURCE,RUN,ATTEMPT,manifest)
 if not proof['image_digest'].endswith('@sha256:'+IMAGE):raise Blocked('existing_candidate_image_mismatch')
 return {**proof,'passed':True,'new_candidate_created':False,'bindings_changed':False,'IAM_changes':0},actual,rev
def verify(r,original):
 proof,actual,rev=readback(original)
 manifest,_,migration=load();installed=verify_installed(r,manifest,migration)
 observed=json.loads(r.api('GET','/secrets'));values=[proof['url'],proof['source_sha256'],proof['revision']]
 if any(not any(x.get('name')==n and x.get('value')==digest(v.encode()) for x in observed) for n,v in zip(NAMES,values)):raise Blocked('existing_runtime_binding_hash_mismatch')
 return {**proof,'installed_source_and_RPC_ACL_verified':installed['passed'],'existing_binding_hashes_verified':True},actual,rev
def logs():
 # Cloud Run request records only. Never return textPayload/jsonPayload,
 # complete request URLs, identities, headers, body or tokens.
 query='resource.type="cloud_run_revision" AND resource.labels.service_name="sandy-engineering-mcp" AND resource.labels.revision_name="'+REVISION+'" AND httpRequest.requestUrl:"/healthz"'
 try:
  rows=cloud('logging','read',query,'--limit','20','--freshness','2d')
  return {'available':True,'health_requests':[{'timestamp':r.get('timestamp'),'severity':r.get('severity'),'http_status':r.get('httpRequest',{}).get('status'),'method':r.get('httpRequest',{}).get('requestMethod')} for r in rows]}
 except Blocked as e:return {'available':False,'error':str(e),'attempted_operation':'logging.entries.list'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--original-dir',required=True,type=Path);p.add_argument('--output-dir',required=True,type=Path);p.add_argument('--final',action='store_true');a=p.parse_args();a.output_dir.mkdir(parents=True,exist_ok=True)
 try:
  if a.final:proof,actual,rev=readback(a.original_dir)
  else:proof,actual,rev=verify(Installer(a.output_dir/'management-readback'),a.original_dir)
  private_write(a.output_dir,'iap-final-provider-readback.json' if a.final else 'iap-runtime-binding.json',json.dumps(proof,indent=2).encode())
  private_write(a.output_dir,'final-service.json' if a.final else 'existing-service.json',json.dumps(actual,indent=2).encode())
  private_write(a.output_dir,'final-revision.json' if a.final else 'existing-revision.json',json.dumps(rev,indent=2).encode())
  private_write(a.output_dir,'health-request-logs.json',json.dumps(logs(),indent=2).encode())
  print(json.dumps(proof));
 except Blocked as e:
  private_write(a.output_dir,'final-readback-failure.json' if a.final else 'existing-readback-failure.json',json.dumps({'passed':False,'error':str(e),'IAM_changes':0,'automatic_retry':False}).encode());print('::error::'+str(e));raise SystemExit(1)
