import assert from 'node:assert/strict';
import {runWorkloadRead} from './workload_reads.ts';
import {argumentDigest} from '../_shared/sandy_api_protocol.ts';
const job='10000000-0000-4000-8000-000000000001',worker='10000000-0000-4000-8000-000000000002',lease='10000000-0000-4000-8000-000000000003',actor='10000000-0000-4000-8000-000000000004',dispatch='10000000-0000-4000-8000-000000000005',admission='10000000-0000-4000-8000-000000000006';
const claim={job_id:job,lease_token:lease,worker_id:worker,principal_kind:'engineering_workload'};
const credential='fixture-private-bootstrap-'.repeat(3);
async function fixture(options:{deny?:boolean;badDigest?:boolean;finishLost?:boolean;fetchThrow?:boolean;providerDeny?:boolean;runtimeUnavailable?:boolean;apiProjection?:boolean;wrongProjection?:boolean;wrongRequest?:boolean;wrongAdmission?:boolean;wrongContract?:boolean}={}){
 const calls:any[]=[],requests:any[]=[];
 const db={rpc:async(name:string,args:any)=>{calls.push({name,args});
 if(name==='sandy_orch_resolve_workload_dispatch')return{data:options.deny?{ok:false,error:'workload_authorization_or_contract_changed'}:{ok:true,job_id:job,identity_user_id:actor,dispatch_id:dispatch,operation:'github.repos.get',arguments:{},input_sha256:options.badDigest?'a'.repeat(64):await argumentDigest({}),registry_revision:'b'.repeat(64)},error:null};
 if(name==='sandy_engineering_runtime_bootstrap')return{data:{ok:true,credential},error:null};
 if(name==='sandy_orch_finish')return{data:options.finishLost?null:{ok:true,job_id:job,state:args.p_outcome==='succeeded'?'succeeded':args.p_outcome==='failed'?'failed':'queued',reused:false,receipt_outcome:args.p_outcome},error:options.finishLost?{code:'fixture_lost_reply'}:null};
 throw Error('unexpected_RPC');}};
 const request=async(url:any,init:any)=>{requests.push({url:String(url),init});if(options.fetchThrow)throw Error(credential);
 if(options.runtimeUnavailable)return Response.json({error:'engineering_session_unavailable',executed:false,automatic_retry:false},{status:503});
 const body=options.providerDeny?{ok:false,error:'engineering_policy_blocked',executed:false}:{ok:true,operation:'github.repos.get',executed:true,request_state:'observed',provider_http_status:200,admission_id:admission,provider_request_id:'fixture-provider-observation',result:{id:123}};
 const wrapped=options.apiProjection!==false&&!options.providerDeny?{ok:true,operation:'github.repos.get',executed:true,request_id:options.wrongRequest?job:dispatch,admission_id:options.wrongAdmission?job:admission,result:{...body,operation:options.wrongProjection?'github.other.get':'github.repos.get',contract_version:options.wrongContract?'0.0.0':'1.0.0'}}:body;
 return Response.json({jsonrpc:'2.0',id:dispatch,result:{content:[{type:'text',text:JSON.stringify({status:options.providerDeny?403:200,result:wrapped})}],isError:!!options.providerDeny}});};
 const result=await runWorkloadRead({db,base:'https://zmqlyygzqoidkcwdysok.supabase.co',anon:'fixture-anon',fetch:request},claim,worker);return{result,calls,requests};
}
Deno.test('durable workload read uses normal renewable runtime and stable dispatch identity, records actual admission',async()=>{
 const {result,calls,requests}=await fixture();assert.deepEqual(result,{job_id:job,state:'succeeded',persisted:true});assert.equal(requests.length,1);
 assert.equal(requests[0].url,'https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-engineering-runtime');
 const message=JSON.parse(requests[0].init.body);assert.equal(message.params.arguments.__sandy_execution.request_id,dispatch);assert.equal(message.params.name,'github.repos.get');
 const finish=calls.find(x=>x.name==='sandy_orch_finish').args;assert.equal(finish.p_execution_admission_id,admission);assert.equal(finish.p_outcome,'succeeded');assert.equal(JSON.stringify(result).includes(credential),false);assert.equal(JSON.stringify(finish).includes(credential),false);
});
Deno.test('revocation, source drift and invalid input digest stop before bootstrap or provider request',async()=>{
 const denied=await fixture({deny:true});assert.equal(denied.result.persisted,false);assert.equal(denied.requests.length,0);assert.equal(denied.calls.length,1);
 const malformed=await fixture({badDigest:true});assert.equal(malformed.result.state,'failed');assert.equal(malformed.result.persisted,true);assert.equal(malformed.requests.length,0);assert.equal(malformed.calls.length,2);assert.equal(malformed.calls[1].args.p_error_code,'canonical_argument_mismatch');
});
Deno.test('provider authorization denial is a genuine persisted failure and cannot be reported success',async()=>{
 const {result,calls}=await fixture({providerDeny:true});assert.equal(result.state,'failed');assert.equal(calls.find(x=>x.name==='sandy_orch_finish').args.p_outcome,'failed');
});
Deno.test('lost transport never redispatches and lost persistence never claims completion or leaks credentials',async()=>{
 const lost=await fixture({fetchThrow:true});assert.equal(lost.requests.length,1);assert.equal(lost.calls.find(x=>x.name==='sandy_orch_finish').args.p_outcome,'unknown');assert.equal(JSON.stringify(lost.result).includes(credential),false);
 const receipt=await fixture({finishLost:true});assert.equal(receipt.requests.length,1);assert.equal(receipt.result.persisted,false);assert.equal(receipt.result.state,'receipt_persistence_unknown');
});

Deno.test('explicit pre-dispatch renewable authentication failure is persisted without automatic retry',async()=>{
 const {result,calls,requests}=await fixture({runtimeUnavailable:true});assert.equal(requests.length,1);assert.equal(result.state,'failed');const finish=calls.find(x=>x.name==='sandy_orch_finish').args;assert.equal(finish.p_outcome,'failed');assert.equal(finish.p_error_code,'engineering_session_unavailable');assert.equal(finish.p_execution_admission_id,null);
});

Deno.test('real Sandy API public projection persists the inner provider receipt without classifying success as failure',async()=>{
 const {result,calls}=await fixture({apiProjection:true});
 assert.equal(result.state,'succeeded');assert.equal(result.persisted,true);
 const finished=calls.find(x=>x.name==='sandy_orch_finish').args;
 assert.equal(finished.p_outcome,'succeeded');assert.equal(finished.p_execution_admission_id,admission);
 assert.deepEqual(finished.p_result.result,{id:123});assert.equal(finished.p_result.contract_version,'1.0.0');
});
Deno.test('unbound, conflicting or unprojected provider claims cannot establish durable success',async()=>{
 for(const options of [{wrongProjection:true},{wrongRequest:true},{wrongAdmission:true},{wrongContract:true},{apiProjection:false}]){
  const {result,calls}=await fixture(options),finish=calls.find(x=>x.name==='sandy_orch_finish').args;
  assert.notEqual(result.state,'succeeded');assert.equal(finish.p_outcome,'unknown');
  assert.equal(finish.p_execution_admission_id,null);assert.equal(finish.p_error_code,'provider_receipt_contract_mismatch');
 }
});
