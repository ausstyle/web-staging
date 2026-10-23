#!/usr/bin/env python3
"""Source-preserving eligibility release only. No IAM, grant, session or guest changes."""
import argparse,hashlib,json,os,subprocess,uuid
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote,replace_once
from release_web_canary import ROOT,Blocked,original_sources,private_write
SLUG='sandy-computer-worker'
BASELINE='scripts/sandy/fixtures/computer-worker-v58.ts'
BEFORE='a573c602239682947239073e75b092dd6481294984d8b9bc72860e3c450760b9'
SOURCE='07c52143be403fed7073a6bd05362a2f47cdbbe704498bdd87862c624782628d'
MODULES=['sandy-computer-worker/eligibility.ts','_shared/sandy-agent-operations/worker_computer_identity.ts']

def patch(raw):
 if digest(raw)!=SOURCE:raise Blocked('reviewed_worker_preimage_required')
 s=raw.decode()
 s='import {computerEligibilityFetch} from "./eligibility.ts";\n'+s
 s=replace_once(s,' try{\n  if(!sessionId)', ' let computerDispatched=false;\n try{\n  if(!sessionId)')
 # The wrapper rechecks both DB records immediately before each provider call.
 needle='  const headers={Authorization:"Bearer "+apiKey,"Content-Type":"application/json"};'
 wrapper='''  const computerFetch=computerEligibilityFetch(db,{taskId:id,sessionId,sandboxId,attempt:Number(task.attempts),agent:task.task_type==="browser_agent"},async(input,init)=>{computerDispatched=true;return await fetch(input,init)});
'''
 s=replace_once(s,needle,wrapper+needle)
 start=s.index('  const info=await fetch(');end=s.index('\n }catch(e){',start)
 part=s[start:end]
 if part.count('await fetch(')!=6:raise Blocked('provider_dispatch_anchors_changed')
 s=s[:start]+part.replace('await fetch(','await computerFetch(')+s[end:]
 # Never requeue a task after a provider request may have been dispatched.
 s=replace_once(s,'  const message=e instanceof Error?e.message:String(e);', '''  if(computerDispatched||(e instanceof Error&&e.message==="computer_dispatch_eligibility_refused")){
   await finish("failed",{reason:"computer_dispatch_stopped",executed:computerDispatched?null:false,reconciliation_required:computerDispatched},"computer_dispatch_stopped");
   return reply({ok:false,task_id:id,error:"computer_dispatch_stopped",executed:computerDispatched?null:false,reconciliation_required:computerDispatched},computerDispatched?409:403);
  }
  const message=e instanceof Error?e.message:String(e);''')
 return s.encode()

def files():
 raw=(ROOT/BASELINE).read_bytes();out={SLUG+'/index.ts':patch(raw)}
 for name in MODULES:out[name]=(ROOT/'supabase/functions'/name).read_bytes()
 return out

def inspect(r,installed=False):
 meta=json.loads(r.api('GET','/functions/'+SLUG));body=r.api('GET','/functions/'+SLUG+'/body');observed=original_sources(body)
 expected=files() if installed else {'index.ts':(ROOT/BASELINE).read_bytes()}
 if {p:digest(v) for p,v in observed.items()}!={p:digest(v) for p,v in expected.items()} or meta.get('verify_jwt') is not False or meta.get('status')!='ACTIVE':raise Blocked('worker_source_or_configuration_drift')
 if not installed and (meta.get('version')!=58 or digest(body)!=BEFORE):raise Blocked('worker_version_or_bundle_drift')
 if installed and meta.get('version',0)<=58:raise Blocked('worker_version_not_advanced')
 return meta,body

def tracking_sql(sha):
 return "INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Computer session eligibility enforcement','Worker does not recheck current session expiry before dispatch','Fail closed before provider calls for ineligible sessions','SANDY-ENG-0001 source-preserving security release','Enforce expiry and takeover without granting authority','[\"sandy-computer-worker\"]','[\"No grants or provider actions by installer\"]','[\"Source attestation and denied unauthenticated ingress\"]','normal',i.user_id,'computer-eligibility-"+sha+"','proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' RETURNING id"

def run(r,deploy=False,installed=False):
 before,body=inspect(r,installed)
 if installed:return {'installed_source_verified':True,'version':before['version'],'JWT_setting_preserved':True}
 if not deploy:return {'preflight_passed':True,'prior_version':before['version'],'candidate_modules':{p:digest(v) for p,v in files().items()}}
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
 sha=os.environ.get('GITHUB_SHA','')
 if len(sha)!=40:raise Blocked('source_commit_required')
 # Require source and dependencies to be exactly the checked-out immutable commit.
 for name,value in {BASELINE:(ROOT/BASELINE).read_bytes(),**{'supabase/functions/'+k:v for k,v in files().items() if k!=SLUG+'/index.ts'}}.items():
  if subprocess.check_output(['git','show',sha+':'+name],cwd=ROOT)!=value:raise Blocked('source_commit_mismatch')
 r.out.mkdir(parents=True,exist_ok=False,mode=0o700)
 private_write(r.out,'before.body',body);private_write(r.out,'before.json',json.dumps(before).encode())
 private_write(r.out,'rollback.json',json.dumps({'function':SLUG,'expected_prior_version':58,'source_commit':sha,'restore_only_after_fresh_candidate_digest_check':True,'preserved_body':'before.body','no_automatic_unknown_outcome_retry':True}).encode())
 change=r.sql(tracking_sql(sha))
 cid=str(uuid.UUID(change[0]['id']));holder='computer-eligibility-'+uuid.uuid4().hex
 r.sql(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{SLUG}','{holder}','{cid}','{BEFORE}',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
 try:
  inspect(r);r.stage='upload_worker';r.upload(SLUG,files(),False)
  result=run(r,installed=True)
  r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{cid}','computer_eligibility_source_installed',NULL,jsonb_build_object('source_commit','{sha}','IAM_changes',0,'grant_changes',0))")
  return {**result,'source_commit':sha,'tracking_change_id':cid,'rollback_preserved':True}
 finally:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{SLUG}' AND holder='{holder}'")

if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--deploy',action='store_true');g.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',required=True);a=p.parse_args();root=Path(a.evidence_dir);r=Installer(root/'source-preservation');report={'passed':False,'IAM_changes':0,'grant_changes':0,'VM_commands':0,'Cloud_Run_changes':0}
 try:report.update(run(r,a.deploy,a.verify_installed),passed=True)
 except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'release_failed_or_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request)
 root.mkdir(parents=True,exist_ok=True);private_write(root,'computer-eligibility-release.json',json.dumps(report,indent=2).encode());print('::notice title=Computer eligibility release::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
