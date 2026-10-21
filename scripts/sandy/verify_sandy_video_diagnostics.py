"""Authenticated, read-only VM diagnostics through runtime -> MCP -> Sandy API.
Uses an existing real owner-approved change for a separately revocable read scope.
Never authorizes installation, IAM/network writes or arbitrary remote commands.
Only a fixed operational projection is retained; credentials/guest values are not.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import uuid
from engineering_runtime import EngineeringRuntime,MANAGEMENT
ROOT=Path(__file__).resolve().parents[2]
POLICY=json.loads((ROOT/'supabase/functions/sandy-operation-api/engineering_vm_read_policy.json').read_text())
BASE=json.loads((ROOT/'supabase/functions/sandy-operation-api/engineering_identity_policy.json').read_text())
SOURCE_CHANGE='232d8d7e-ac98-4669-9907-93302303a7c1'
SAFE_FIELDS={'ok','exists','name','zone','status','vm','vm_status','instance_id','machine_type','external_ip_present','external_ip_attached','oslogin_enabled','block_project_ssh_keys','granted_roles','missing_roles','granted','missing','osconfig_enabled','osconfig_http','inventory_available','http_status','google_http','error_status','error_message','error','installation_authorized','installation_executed','livekit_verified','ssh_connectivity_verified','remote_execution_available','reason','cloud_nat_http','cloud_nat_routers','subnetwork_http','private_google_access_enabled','regional_addresses_http','routers_http','nat_routers','firewalls_http','metadata_keys','firewall_http','assignments','guest_reporting'}
def clean(value):
    if isinstance(value,str):
        value=re.sub(r'eyJ[A-Za-z0-9._-]{15,}','[REDACTED]',value)
        value=re.sub(r'gh[pousr]_[A-Za-z0-9_]{20,}','[REDACTED]',value)
        return value[:700]
    if isinstance(value,list):return [clean(x) for x in value[:50] if isinstance(x,(str,bool,int,float))]
    if isinstance(value,dict):return {k:clean(v) for k,v in value.items() if k in {'available','item_count','values_redacted'}}
    return value if value is None or isinstance(value,(bool,int,float)) else None

def run(output,gateway_version=30,retry_from=None):
    r=EngineeringRuntime();report={'personal_controller_session_used':False,'provider_writes_authorized':False,'source_change_id':SOURCE_CHANGE,'target':{k:POLICY[k] for k in ['project_id','zone','instance_name','instance_id']},'calls':[],'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    def save():output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n')
    def discovery(label):
        status,value=r.invoke({'jsonrpc':'2.0','id':str(uuid.uuid4()),'method':'tools/list','params':{}})
        assert status==200
        names=[t['name'] for t in value.get('result',{}).get('tools',[])]
        report[label]={'http_status':status,'tool_count':len(names),'tools':names};save();return names
    for slug,version,jwt in [('sandy-operation-api',gateway_version,True),('sandy-engineering-runtime',4,False)]:
        status,meta=r._http('GET',MANAGEMENT+'/functions/'+slug,r._management)
        if status!=200 or meta.get('version')!=version or meta.get('status')!='ACTIVE' or meta.get('verify_jwt') is not jwt:raise RuntimeError('reviewed_vm_diagnostic_deployment_not_active')
    before=discovery('before_vm_authorization');assert set(BASE['operations'])<=set(before)
    if retry_from is None:assert set(before)==set(BASE['operations'])
    report['authorization']=r.authorize_vm_reads(SOURCE_CHANGE);save()
    selected=POLICY['operations']
    if retry_from is not None:
        previous=json.loads(retry_from.read_text());selected=[x['operation'] for x in previous['calls'] if not x['positive_execution_verified']];assert set(selected)<=set(POLICY['operations']);report['retry_source_evidence_sha256']=hashlib.sha256(retry_from.read_bytes()).hexdigest();report['previous_scope_revocation_verified']=previous.get('revoked_vm_call_denied',{}).get('api_status')==403
    after=discovery('after_vm_authorization');report['authorized_but_not_discoverable']=sorted(set(POLICY['operations'])-set(after));save()
    for operation in selected:
        request_id=str(uuid.uuid4());call={'operation':operation,'request_id':request_id,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        try:
            status,value=r.invoke({'jsonrpc':'2.0','id':request_id,'method':'tools/call','params':{'name':operation,'arguments':{'__sandy_execution':{'request_id':request_id},'arguments':{}}}})
            result=value.get('result',{});envelope=json.loads(result.get('content',[{}])[0].get('text','{}'));body=envelope.get('result',{})
            payload=result.get('structuredContent') if result.get('isError') is False else body.get('result',body)
            call.update(http_status=status,api_status=envelope.get('status',status),is_error=result.get('isError'),executed=body.get('executed'),api_error=clean(body.get('error')),response_sha256=hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest())
            if isinstance(payload,dict):
                call['provider_observation']={k:clean(v) for k,v in payload.items() if k in SAFE_FIELDS}
                if isinstance(payload.get('upstream_error'),dict):call['provider_observation']['upstream_error']={k:clean(v) for k,v in payload['upstream_error'].items() if k in {'error','error_status','error_message','message','google_http','http_status','google_error_status','google_error_message','osconfig_http'}}
            call['positive_execution_verified']=status==200 and result.get('isError') is False and envelope.get('status')==200 and isinstance(payload,dict) and payload.get('ok') is True
            if operation=='video.network.preflight' and call['positive_execution_verified']:
                call['positive_execution_verified']=all(isinstance(payload.get(k),int) and 200<=payload[k]<300 for k in ['regional_addresses_http','routers_http','firewalls_http','subnetwork_http'])
            if operation=='video.status' and call['positive_execution_verified']:
                call['target_identity_matches']=payload.get('name')==POLICY['instance_name'] and payload.get('instance_id')==POLICY['instance_id']
                if not call['target_identity_matches']:call['positive_execution_verified']=False
        except Exception as error:
            call.update(positive_execution_verified=False,transport_error=type(error).__name__)
        report['calls'].append(call);save()
        print(json.dumps({'operation':operation,'api_status':call.get('api_status'),'positive_execution_verified':call['positive_execution_verified'],'api_error':call.get('api_error')}),flush=True)
    if retry_from is None:
        report['scope_revocation']=r.revoke_vm_reads();revoked=discovery('after_scope_revocation');assert set(revoked)==set(BASE['operations'])
        status,value=r.invoke({'jsonrpc':'2.0','id':str(uuid.uuid4()),'method':'tools/call','params':{'name':'video.status','arguments':{}}});result=value.get('result',{});env=json.loads(result.get('content',[{}])[0].get('text','{}'));assert status==200 and result.get('isError') is True and env.get('status')==403
        report['revoked_vm_call_denied']={'http_status':status,'api_status':403,'error':clean(env.get('result',{}).get('error'))}
    report['scope_restored']=r.authorize_vm_reads(SOURCE_CHANGE);report['identity_status']=r.public_status();report['complete']=True
    report['positive_operations']=sum(c['positive_execution_verified'] for c in report['calls']);report['unresolved_operations']=len(report['calls'])-report['positive_operations'];report['remote_execution_verified']=False;report['conference_verified']=False;save()
    for call in report['calls']:
        evidence={'recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'evidence_level':'actual_owner_authorized_normal_Auth_workload_MCP_to_Sandy_API_attempt','mcp_end_to_end_verified':call['positive_execution_verified'],'scope':'fixed sandy-video diagnostics only; no provider writes','normal_workload_auth':True,'personal_controller_session_used':False,'controller_memberships':0,'source_change_id':SOURCE_CHANGE,'call':call,'remote_execution_verified':False,'conference_verified':False,'source_evidence_sha256':hashlib.sha256(output.read_bytes()).hexdigest()}
        literal=r._quote(json.dumps(evidence))+'::jsonb'
        q="UPDATE public.sandy_operation_registry SET last_test_result=coalesce(last_test_result,'{}'::jsonb)||jsonb_build_object('sandy_video_workload_diagnostic_20261021',"+literal+"),updated_at=now()"
        if call['positive_execution_verified']:q+=',verified=true,last_verified_at=now()'
        r._sql(q+' WHERE operation='+r._quote(call['operation']))
    print(json.dumps({'diagnostics_completed':True,'positive_operations':report['positive_operations'],'unresolved_operations':report['unresolved_operations'],'remote_execution_verified':False,'conference_verified':False}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--gateway-version',type=int,default=30);parser.add_argument('--retry-from',type=Path);args=parser.parse_args();run(args.output,args.gateway_version,args.retry_from)
