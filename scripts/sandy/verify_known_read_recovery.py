#!/usr/bin/env python3
"""Fully rolled-back fault injection on the previously approved read fixture.
No admission/provider call, new job, Owner session or retained queue mutation.
"""
import argparse,json,os,re
from pathlib import Path
from release_gcp_admin_read import Installer,quote
from release_web_canary import Blocked,private_write,ROOT
from release_known_read_recovery import verify,inspect_worker,MIGRATION,VERSION
JOB='d98a23a4-3740-41b5-902c-3cf9be7460da'
ADMISSION='23092318-776c-44b4-9e55-5a49720fbc8d'
DISPATCH='d27cdc5e-dad8-49ac-aa53-f6445cd74323'
ACTOR='7a519da9-2ee3-4edf-adec-42697da5a560'

def snapshot(r):
 return r.sql("SELECT encode(sha256(convert_to(to_jsonb(j)::text,'UTF8')),'hex') job_sha256,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') outbox_sha256,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') attempt_sha256 FROM public.sandy_orch_jobs j JOIN public.sandy_orch_outbox o ON o.job_id=j.id JOIN public.sandy_orch_attempts t ON t.job_id=j.id AND t.attempt=j.attempts WHERE j.id='"+JOB+"'",True)

def exercise(r):
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main' or not re.fullmatch('[a-f0-9]{40}',os.environ.get('GITHUB_SHA','')):raise Blocked('protected_main_fault_acceptance_required')
 inspect_worker(r);verify(r,(ROOT/MIGRATION).read_text())
 before=snapshot(r)
 if len(before)!=1:raise Blocked('existing_approved_read_fixture_required')
 result=r.sql("""BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';
 LOCK TABLE public.sandy_orch_jobs,public.sandy_orch_outbox,public.sandy_orch_attempts IN SHARE ROW EXCLUSIVE MODE;
 DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_orch_jobs WHERE state IN('queued','leased','running') AND id<>'"""+JOB+"""') THEN RAISE EXCEPTION 'recovery_fault_acceptance_requires_idle_queue';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_orch_jobs j JOIN public.sandy_orch_attempts t ON t.job_id=j.id AND t.attempt=j.attempts JOIN public.sandy_api_execution_admissions a ON a.id=t.execution_admission_id
 WHERE j.id='"""+JOB+"""' AND j.actor_id='"""+ACTOR+"""' AND j.principal_kind='engineering_workload' AND NOT j.is_mutation AND j.operation='github.repos.get' AND j.state='succeeded' AND j.attempts=1
 AND t.dispatch_id='"""+DISPATCH+"""' AND t.outcome='succeeded' AND a.id='"""+ADMISSION+"""' AND a.state='succeeded' AND a.provider_http_status=200
 AND a.result_sha256='358d852441f72ec1a68e50fa79a37fbe39a201ff70661526da5977412d0daeb8') THEN RAISE EXCEPTION 'approved_original_read_proof_changed';END IF;
 END $$;
 UPDATE public.sandy_orch_jobs SET state='running',result=NULL,error_code=NULL,finished_at=NULL WHERE id='"""+JOB+"""';
 UPDATE public.sandy_orch_attempts SET finished_at=NULL,outcome=NULL,result_sha256=NULL,execution_admission_id=NULL WHERE job_id='"""+JOB+"""' AND attempt=1;
 UPDATE public.sandy_orch_outbox o SET worker_id=t.worker_id,lease_token=t.lease_token,lease_until=clock_timestamp()-interval '1 second' FROM public.sandy_orch_attempts t WHERE t.job_id=o.job_id AND t.attempt=1 AND o.job_id='"""+JOB+"""';
 DO $$ DECLARE result jsonb;BEGIN result:=public.sandy_orch_claim(gen_random_uuid(),1,90);IF result->>'ok' IS DISTINCT FROM 'true' OR result->'claims'<>'[]'::jsonb THEN RAISE EXCEPTION 'fault_recovery_attempted_new_claim';END IF;END $$;
 SELECT j.state,j.attempts,j.result IS NULL durable_result_unavailable,t.execution_admission_id,t.outcome,
 (SELECT count(*) FROM public.sandy_orch_events WHERE job_id=j.id AND event_type='expired_read_canonical_receipt_observed') recovery_events
 FROM public.sandy_orch_jobs j JOIN public.sandy_orch_attempts t ON t.job_id=j.id AND t.attempt=1 WHERE j.id='"""+JOB+"""';ROLLBACK;""")
 expected=[{'state':'needs_reconciliation','attempts':1,'durable_result_unavailable':True,'execution_admission_id':ADMISSION,'outcome':'lease_expired_canonical_read_observed','recovery_events':1}]
 if result!=expected:raise Blocked('known_read_fault_recovery_not_verified')
 if snapshot(r)!=before:raise Blocked('fault_fixture_rollback_not_verified')
 receipt={'passed':True,'migration':VERSION,'fixture_job_id':JOB,'existing_provider_admission':ADMISSION,'actual_database_fault_recovery':result[0],'fixture_rollback_verified':True,'provider_calls':0,'new_jobs':0,'Owner_sessions':0,'provider_result_replayed':False,'full_autonomous_code_release_accepted':False}
 tracking=r.sql("SELECT change_id FROM public.sandy_engineering_change_events WHERE event_type='known_read_receipt_recovery_installed' AND detail->>'migration'='"+VERSION+"' AND detail->>'source_commit'="+quote(os.environ['GITHUB_SHA'])+" ORDER BY occurred_at DESC LIMIT 1",True)
 if len(tracking)!=1:raise Blocked('protected_recovery_tracking_evidence_required')
 r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(tracking[0]['change_id'])+",'known_read_recovery_fault_verified',NULL,"+quote(json.dumps(receipt))+"::jsonb)")
 return receipt

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--evidence-dir',type=Path,required=True);a=p.parse_args();r=Installer(a.evidence_dir/'private');report={'passed':False,'provider_calls':0}
 try:report.update(exercise(r))
 except Exception as e:report['error']=str(e) if isinstance(e,Blocked) else 'fault_acceptance_failed_reconcile_before_retry'
 a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'known-read-fault-acceptance.json',json.dumps(report,indent=2).encode());print('::notice title=Known read recovery fault acceptance::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
