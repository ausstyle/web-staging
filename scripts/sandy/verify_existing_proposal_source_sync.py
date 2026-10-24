#!/usr/bin/env python3
"""Observe existing cron resuming existing proposals. Never invoke the scanner,
paid investigation, provider executor or Architect admission directly.
"""
import argparse,json,os,re,time
from pathlib import Path
from release_gcp_admin_read import Installer,quote
from release_web_canary import ROOT,Blocked,private_write
from release_existing_proposal_source_sync import verify,MIGRATION,VERSION,CASES,proposals

def observe(r,timeout=360):
 source=os.environ.get('GITHUB_SHA','')
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main' or not re.fullmatch('[a-f0-9]{40}',source):raise Blocked('protected_main_source_resume_observer_required')
 verify(r,(ROOT/MIGRATION).read_text())
 tracking=r.sql("SELECT change_id,occurred_at,detail->'proposal_before' proposal_before FROM public.sandy_engineering_change_events WHERE event_type='existing_proposal_source_sync_installed' AND detail->>'migration'='"+VERSION+"' AND detail->>'source_commit'="+quote(source)+" ORDER BY occurred_at DESC LIMIT 1",True)
 if len(tracking)!=1:raise Blocked('existing_protected_source_sync_receipt_required')
 ref=tracking[0];deadline=time.monotonic()+timeout;rows=[];cron=[]
 while time.monotonic()<deadline:
  rows=r.sql("SELECT c.issue_key,c.phase,c.status,c.risk_level,c.attempt_count,c.next_action,c.evidence->'proposal_source_review' review FROM public.sandy_autonomous_engineering_cycles c WHERE c.issue_key IN("+','.join(quote(x) for x in CASES)+") ORDER BY c.issue_key",True)
  ready=len(rows)==3 and all(x['phase']=='source_evidence' and x['status']=='waiting_evidence' and x['next_action']=='review_existing_proposal_against_bound_source' and x['risk_level']=='unassessed' and x['attempt_count']==0 and isinstance(x['review'],dict) and len(x['review'].get('source_snapshots',[]))==2 and x['review'].get('independent_source_review_complete') is False and x['review'].get('capability_accepted') is False for x in rows)
  if ready:
   cron=r.sql("SELECT j.jobname,d.status,d.start_time,d.end_time FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE j.jobname IN('sandy-autonomous-engineering-scan-15m','sandy-autonomous-engineering-reconcile-5m') AND d.status='succeeded' AND d.start_time>="+quote(ref['occurred_at'])+"::timestamptz ORDER BY d.end_time DESC LIMIT 2",True)
   if cron:break
  time.sleep(10)
 else:raise Blocked('existing_cron_source_resume_not_observed_no_direct_replay')
 if proposals(r)!=ref['proposal_before']:raise Blocked('original_proposal_or_diagnosis_changed')
 evidence=[]
 for row in rows:
  review=row['review'];related=review.get('related_grounding')
  if row['issue_key'].endswith('cross_channel') and related is not None:raise Blocked('unrelated_grounding_evidence_attached')
  if related and (related.get('run_key')!='production:c706fc05-5dcb-49b4-adda-1ab9cd00279c' or related.get('full_handoff_accepted') is not False):raise Blocked('partial_grounding_receipt_misclassified')
  evidence.append({'issue_key':row['issue_key'],'phase':row['phase'],'status':row['status'],'next_action':row['next_action'],'attempt_count':row['attempt_count'],'risk_level':row['risk_level'],'source_snapshot_versions':{x['snapshot']['function']:x['snapshot']['metadata_version'] for x in review['source_snapshots']},'related_grounding':related,'proposal_only':review['proposal_only'],'independent_architect_review_required':True})
 result={'passed':True,'migration':VERSION,'actual_existing_cron_receipts':cron,'existing_proposals_resumed':evidence,'proposal_and_diagnosis_preserved':True,'new_issues':0,'paid_investigations':0,'new_approvals':0,'full_autonomous_code_release_accepted':False}
 r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(ref['change_id'])+",'existing_proposal_cron_resume_verified',NULL,"+quote(json.dumps(result))+"::jsonb)")
 return result

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--evidence-dir',type=Path,required=True);a=p.parse_args();r=Installer(a.evidence_dir/'private');report={'passed':False}
 try:report.update(observe(r))
 except Exception as e:report['error']=str(e) if isinstance(e,Blocked) else 'source_resume_observation_failed_reconcile_no_replay'
 a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'proposal-source-cron-acceptance.json',json.dumps(report,indent=2).encode());print('::notice title=Existing programme cron resume::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
