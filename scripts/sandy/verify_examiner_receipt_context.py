#!/usr/bin/env python3
"""Bounded fixed-pilot Examiner regression; never impersonates a customer/Owner.
Uses the worker's established private service ingress, not a user API session.
Management/source readback and persisted request/task outcomes are independent of
its model verdict. No score is a full Master Scope acceptance certification.
"""
import argparse,hashlib,json,os,re,urllib.request,urllib.error,uuid
from pathlib import Path
from release_gcp_admin_read import Installer,quote
from release_web_canary import Blocked,original_sources,NoRedirect
PROJECT='zmqlyygzqoidkcwdysok'
SLUG='sandy-examiner-full-cycle'
MANIFEST=Path(__file__).resolve().parents[2]/'docs/sandy-engineering/evaluations/runtime-examiner-receipt-context-20261024.json'
BASELINE='production:4678cfe3-9f5e-49c6-b787-37e9e64d6fa1'
PILOT='a01792d6-7cd8-4c07-9520-d8e1dec1fceb'
CASES=['current_time','task_overview','tool_evidence']
URL=f'https://{PROJECT}.supabase.co/functions/v1/{SLUG}'

def source(r):
 m=json.loads(MANIFEST.read_bytes());meta=json.loads(r.api('GET','/functions/'+SLUG));body=r.api('GET','/functions/'+SLUG+'/body')
 files=original_sources(body)
 if meta.get('status')!='ACTIVE' or meta.get('verify_jwt') is not False or {n:hashlib.sha256(v).hexdigest() for n,v in files.items()}!=m['replacement_files']:
  raise Blocked('examiner_candidate_not_independently_installed')
 return {'function':SLUG,'version':meta['version'],'source_modules_verified':len(files),'bundle_sha256':hashlib.sha256(body).hexdigest()}

def request(body,credential):
 req=urllib.request.Request(URL,data=json.dumps(body).encode(),headers={'authorization':'Bearer '+credential,'content-type':'application/json'},method='POST')
 opener=urllib.request.build_opener(NoRedirect())
 try:
  with opener.open(req,timeout=30) as response:return response.status,json.loads(response.read(32768))
 except urllib.error.HTTPError as e:
  return e.code,{} # No raw provider body or headers are surfaced.
 except Exception:raise Blocked('examiner_launch_outcome_unknown_do_not_retry') from None

def start(r):
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_workflow_required')
 commit=os.environ.get('GITHUB_SHA','')
 if not re.fullmatch('[a-f0-9]{40}',commit):raise Blocked('source_commit_required')
 readback=source(r)
 router_meta=json.loads(r.api('GET','/functions/sandy-agent-runtime'));router_body=r.api('GET','/functions/sandy-agent-runtime/body');router_files=original_sources(router_body)
 if set(router_files)!={'index.ts'} or 'sandy-agent-runtime-v4' not in router_files['index.ts'].decode() or r.sql("SELECT enabled,rollback_runtime FROM public.sandy_v4_release_control WHERE id=1",True)!=[{'enabled':True,'rollback_runtime':'sandy-agent-runtime-v2'}]:raise Blocked('existing_runtime_v4_route_not_active')
 readback['runtime_router']={'version':router_meta['version'],'bundle_sha256':hashlib.sha256(router_body).hexdigest(),'v4_enabled':True}
 # The existing consented pilot association must not be silently expanded.
 if r.sql(f"SELECT DISTINCT customer_id::text FROM public.sandy_v2_qa_executions WHERE run_key={quote(BASELINE)}",True)!=[{'customer_id':PILOT}]:raise Blocked('existing_pilot_association_changed')
 keys=json.loads(r.api('GET','/api-keys'));service=[row.get('api_key') for row in keys if row.get('name')=='service_role' and row.get('api_key')]
 if len(service)!=1:raise Blocked('existing_private_examiner_ingress_credential_unavailable')
 credential=service[0]
 # Negative auth and arbitrary-question selection must fail before any run/task.
 if request({'run_key':'production:'+str(uuid.uuid4()),'customer_id':PILOT,'case_keys':CASES},'invalid-examiner-credential')[0]!=403:raise Blocked('examiner_auth_boundary_failed')
 if request({'run_key':'production:'+str(uuid.uuid4()),'customer_id':PILOT,'case_keys':['arbitrary_question']},credential)[0]!=400:raise Blocked('examiner_fixed_case_boundary_failed')
 run='production:'+str(uuid.uuid4())
 detail={'mode':'focused_regression_v1','source_commit':commit,'baseline_run':BASELINE,'selected_case_keys':CASES,'window_start':'2026-10-24T00:00:00Z','window_end':'2026-10-24T00:00:00Z','full_master_acceptance':False}
 r.sql(f"INSERT INTO public.sandy_v2_qa_runs(run_key,status,selection_audit) VALUES({quote(run)},'running',{quote(json.dumps(detail))}::jsonb)")
 status,body=request({'run_key':run,'customer_id':PILOT,'case_keys':CASES},credential)
 credential=None;service.clear();keys.clear()
 if status!=202 or body.get('run_key')!=run or body.get('status')!='running':raise Blocked('examiner_launch_not_accepted_do_not_retry')
 return {**readback,'run_key':run,'launch_http_status':status,'negative_auth_http_status':403,'arbitrary_case_http_status':400,'selected_case_keys':CASES,'historical_thread_scan_requested':False,'full_master_acceptance':False}

def inspect(r,run):
 if not re.fullmatch(r'production:[a-f0-9-]{36}',run):raise Blocked('invalid_run_key')
 state=r.sql(f"SELECT run_key,status,attempted,passed,failed,reviews,selection_audit->>'mode' AS mode FROM public.sandy_v2_qa_runs WHERE run_key={quote(run)}",True)
 rows=r.sql(f"SELECT e.case_key,e.request_id,e.edge_status,e.verdict,e.evidence->>'mode' AS mode,e.evidence->'judge_score' AS judge_score,e.reason LIKE 'judge_gateway_http_%' AS judge_http_failed,t.status AS task_status,jsonb_array_length(e.tool_trace) AS trace_entries FROM public.sandy_v2_qa_executions e LEFT JOIN public.sandy_agent_tasks t ON t.request_id=e.request_id AND t.customer_id=e.customer_id WHERE e.run_key={quote(run)} ORDER BY e.case_key",True)
 model_receipts=r.sql(f"SELECT DISTINCT a.source_runtime,a.source_sha256,a.selected_model,a.state FROM public.sandy_runtime_conversation_audit a JOIN public.sandy_v2_qa_executions e ON e.request_id=a.request_id AND e.customer_id=a.customer_id WHERE e.run_key={quote(run)} ORDER BY a.source_runtime,a.source_sha256,a.selected_model,a.state",True)
 effects=r.sql(f"SELECT count(*)::int AS successful_mutations FROM public.sandy_v2_qa_executions e CROSS JOIN LATERAL jsonb_array_elements(e.tool_trace) x WHERE e.run_key={quote(run)} AND x->>'tool' ~* '(send|delete|create|update|write|payment|purchase)' AND x->>'success'='true'",True)
 completed=len(state)==1 and state[0]['status']=='complete' and len(rows)==len(CASES) and sorted(x['case_key'] for x in rows)==sorted(CASES)
 functional=completed and all(x['edge_status']==200 and x['task_status']=='completed' and x['mode']=='focused_regression_v1' and x['judge_score'] is not None and not x['judge_http_failed'] for x in rows) and effects==[{'successful_mutations':0}] and bool(model_receipts) and all(x['source_runtime']=='sandy-agent-runtime-v4' and x['state']=='succeeded' for x in model_receipts)
 return {'run':state[0] if state else None,'cases':rows,'model_receipts':model_receipts,'effects':effects,'execution_and_judging_verified':functional,'full_master_acceptance':False}

def main():
 p=argparse.ArgumentParser();p.add_argument('--start',action='store_true');p.add_argument('--run-key');p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 r=Installer(a.output.parent)
 try:
  if a.start and a.run_key:raise Blocked('start_or_readback_not_both')
  result=start(r) if a.start else inspect(r,a.run_key) if a.run_key else source(r)
  a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
 except Blocked as error:print(json.dumps({'ok':False,'error':str(error)}));raise SystemExit(1)
if __name__=='__main__':main()
