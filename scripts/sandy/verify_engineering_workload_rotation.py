import sys,json,pathlib,datetime,argparse
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from engineering_runtime import EngineeringRuntime, BASE
parser=argparse.ArgumentParser(description='Live scoped workload session retirement, renewal, rotation and authorization checks; credentials remain in memory.');parser.add_argument('--output',type=pathlib.Path,required=True);args=parser.parse_args()
r=EngineeringRuntime();out={'personal_controller_session_used':False};state=r.state();uid=state['user_id'];message={'jsonrpc':'2.0','id':'workload-renewal-rotation-check','method':'tools/list','params':{}}
q="SELECT session_id FROM public.sandy_engineering_auth_sessions WHERE identity_user_id="+r._quote(uid)+" AND revoked_at IS NULL ORDER BY created_at DESC"
before=r._sql(q,True);assert before
for row in before:r._rpc('sandy_engineering_retire_session',uid,row['session_id'])
s,v=r.invoke(message);assert s==200 and len(v.get('result',{}).get('tools',[]))==6
after=r._sql(q,True);assert after and not set(x['session_id'] for x in before)&set(x['session_id'] for x in after)
out['actual_revoked_session_renewed']={'passed':True,'old_sessions':len(before),'new_sessions':len(after),'http_status':s}
old_key=r._bootstrap_key();old_epoch=state['credential_epoch'];out['rotation_status']=r.rotate();assert out['rotation_status']['credential_epoch']==old_epoch+1
s,v=r._http('POST',BASE+'/functions/v1/sandy-engineering-runtime',old_key,message,r._api_keys()['anon']);assert s==403 and v.get('error')=='invalid_runtime_credential';out['old_bootstrap_revoked']={'http_status':s,'error':v['error']};old_key=None
s,v=r.invoke(message);assert s==200 and len(v.get('result',{}).get('tools',[]))==6;out['new_bootstrap_fresh_auth_works']={'http_status':s,'tool_count':6}
for credential in ['x'*64,'not.a.user-token']:
 s,v=r._http('POST',BASE+'/functions/v1/sandy-engineering-runtime',credential,message,r._api_keys()['anon']);assert s in(401,403);out.setdefault('invalid_authentication_denials',[]).append({'http_status':s,'error':v.get('error')})
s,v=r.invoke({'jsonrpc':'2.0','id':'workload-out-of-scope','method':'tools/call','params':{'name':'supabase.projects.delete','arguments':{}}});assert s==403;out['out_of_scope_denied']={'http_status':s,'error':v.get('error')}
out['audit_counts']=r._sql("SELECT event_type,count(*) count FROM public.sandy_engineering_identity_events WHERE identity_user_id="+r._quote(uid)+" GROUP BY event_type ORDER BY event_type",True)
out['natural_expiry_test']='unit fake clock; live renewal tested by explicit supported session retirement, not waiting for natural expiry'
args.output.write_text(json.dumps(out,indent=2));print(json.dumps(out))
