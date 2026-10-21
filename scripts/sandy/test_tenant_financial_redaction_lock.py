"""Portable synthetic Management API lock regression; reads credential only from env."""
from pathlib import Path
import concurrent.futures,json,re,uuid,time,hashlib,os,urllib.request,urllib.error,argparse
r=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description="Two real PostgreSQL sessions; advisory key only, full rollback, no customer records or provider calls.")
parser.add_argument("--evidence",type=Path,default=Path("/tmp/sandy-financial-redaction-lock-evidence.json"))
args=parser.parse_args()
project="zmqlyygzqoidkcwdysok"
token=os.environ["SANDY_SUPABASE_MANAGEMENT_TOKEN"]
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*_args,**_kwargs):return None
tenant=str(uuid.uuid4());key="hashtextextended('sandy_financial_invoice_boundary_v1:"+tenant+"',0)"
def query(sql):
 request=urllib.request.Request("https://api.supabase.com/v1/projects/"+project+"/database/query",data=json.dumps({"query":sql}).encode(),headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"},method="POST")
 try:
  with urllib.request.build_opener(NoRedirect()).open(request,timeout=30)as response:
   if response.status!=201:raise RuntimeError("Management database query failed HTTP "+str(response.status))
   return json.load(response)
 except urllib.error.HTTPError as error:raise RuntimeError("Management database query failed HTTP "+str(error.code))from None
holder_sql='BEGIN;SELECT pg_advisory_xact_lock('+key+');SELECT pg_sleep(8);ROLLBACK;'
source=(r/'supabase/migrations/20261021007310_sandy_tenant_financial_redaction_primitives.sql').read_text();fn=re.search(r'CREATE FUNCTION public\.sandy_tenant_financial_invoice_pending\(.*?\$\$;',source,re.S).group(0);temporary_fn=fn.replace('CREATE FUNCTION public.sandy_tenant_financial_invoice_pending(', 'CREATE FUNCTION pg_temp.sandy_tenant_financial_invoice_pending(',1)
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 holder=pool.submit(query,holder_sql);held=False
 for _ in range(12):
  held=query('SELECT NOT pg_try_advisory_xact_lock('+key+') AS held;')[0]['held']
  if held:break
  time.sleep(.1)
 assert held,'holder_not_observed'
 sql='BEGIN;'+temporary_fn+"\nREVOKE ALL ON FUNCTION pg_temp.sandy_tenant_financial_invoice_pending(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;DO $test$DECLARE refused boolean:=false;BEGIN BEGIN PERFORM pg_temp.sandy_tenant_financial_invoice_pending('"+tenant+"',true);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'financial_redaction_invoice_boundary_busy' THEN RAISE;END IF;refused:=true;END;IF NOT refused THEN RAISE EXCEPTION 'invoice_busy_lock_not_refused';END IF;PERFORM pg_temp.sandy_tenant_financial_invoice_pending('"+tenant+"',false);END$test$;SELECT jsonb_build_object('concurrent_holder_observed',true,'invoice_apply_busy_before_change',true,'nonmutating_inspection_not_blocked',true,'real_customer_rows',false,'real_provider_call',false) AS evidence;ROLLBACK;"
 start=time.monotonic();result=query(sql);elapsed=time.monotonic()-start;holder.result();assert elapsed<7,elapsed
 v={'http':201,'checks':3,'two_real_database_sessions':True,'full_rollback':True,'apply_elapsed_seconds':elapsed,'evidence':result,'source_sha256':hashlib.sha256(fn.encode()).hexdigest(),'note':'Synthetic random customer UUID, no customer rows or Auth created; only an advisory transaction key is held for eight seconds. No provider/API session claim.'};args.evidence.parent.mkdir(parents=True,exist_ok=True);v['harness_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest();v['harness_path']=str(Path(__file__).relative_to(r));args.evidence.write_text(json.dumps(v,indent=2)+'\n');print('HTTP201 concurrent database lock regression checks3; busy refusal in',round(elapsed,3),'seconds')
