import assert from 'node:assert/strict';
import {handleIapRepairJob} from './iap_repair_jobs.ts';
import {iapRepairProposal,iapRepairTarget} from '../_shared/sandy_iap_repair_contract.ts';
const actor='10000000-0000-4000-8000-000000000001',sid='10000000-0000-4000-8000-000000000002',job='10000000-0000-4000-8000-000000000003';
const ticket={admission_id:'10000000-0000-4000-8000-000000000004',grant_id:'10000000-0000-4000-8000-000000000005',request_id:'10000000-0000-4000-8000-000000000006'};
const user={id:actor,app_metadata:{sandy_engineering_test:true,sandy_engineering_epoch:2}};
const token='verified.'+btoa(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',session_id:sid,app_metadata:user.app_metadata,exp:Date.now()/1000+3600}))+'.signature';
const activation={url:'https://sandy-iap-repair-review---sandy-engineering-mcp-fixture-ew.a.run.app',source_sha256:'a'.repeat(64),worker_revision:'sandy-engineering-mcp-fixture'};
const prepare={action:'implementation_request',change_id:iapRepairProposal,provider:'google_cloud',operation:'iap.repair.plan',target:iapRepairTarget,idempotency_key:'fixture-iap-job-001',payload:{}};
const execute={action:'execute_job',change_id:iapRepairProposal,job_id:job};
const names=['sandy-video','sandy-windows'],ids=['6831598645020395570','8120150462304566315'];
function fixture(){
 const calls:any[]=[];let denied=false,status='succeeded',lost=false,requests=0,secret=false;
 const result={ok:true,admission_id:ticket.admission_id,mode:'plan',administrator_identity:'sandy-cloud-administrator@elaborate-haven-511518-a5.iam.gserviceaccount.com',policy_changes:0,
  targets:names.map((vm_name,i)=>({vm_name,instance_id:ids[i],port:[22,5986][i],expires_at:'2026-10-30T21:17:00Z',before_sha256:'b'.repeat(64),candidate_sha256:'c'.repeat(64),change_required:true})),
  provider_receipts:names.flatMap((name,i)=>[{endpoint:`https://compute.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/${name}`,http_status:200},{endpoint:`https://iap.googleapis.com/v1/projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/${ids[i]}:getIamPolicy`,http_status:200}]),token_recorded:false,tunnel_execution_verified:false,OS_commands:0};
 const db={rpc:async(name:string,args:any)=>{calls.push({name,args});assert.equal(args.p_actor,actor);assert.equal(args.p_session,sid);
  if(denied)return {error:{code:'42501'}};
  if(name==='sandy_iap_repair_prepare_job')return {data:{ok:true,reused:false,job:{id:job,engineering_change_id:iapRepairProposal,requested_by:actor,status:'authorized_by_policy'},execution:'not_started'}};
  if(name==='sandy_iap_repair_job_context')return {data:{ok:true,job:{id:job,engineering_change_id:iapRepairProposal,payload:{mode:'plan'}}}};
  if(name==='sandy_iap_repair_job_admit')return {data:ticket};
  if(name==='sandy_iap_repair_status')return {data:{ok:true,admission_id:ticket.admission_id,job_id:job,state:status,mode:'plan',...activation,result_sha256:'d'.repeat(64)}};
  assert.equal(name,'sandy_iap_repair_finish');assert.equal(args.p_payload.reconciliation_required,true);return {data:{ok:true,state:'unknown'}};
 }};
 const request=async(url:RequestInfo|URL,init?:RequestInit)=>{requests++;assert.equal(url,activation.url+'/internal/gcp-admin/iap-repair');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+token);assert.deepEqual(JSON.parse(String(init?.body)),ticket);if(lost)throw Error('PRIVATE_PROVIDER_ERROR');return Response.json(secret?{...result,access_token:'PRIVATE_MUST_NOT_LEAK'}:result);};
 return {calls,run:(body:any=execute,config=activation)=>handleIapRepairJob(db,user,token,body,config,request as typeof fetch),deny:()=>denied=true,unknown:()=>status='unknown',lost:()=>lost=true,secret:()=>secret=true,requests:()=>requests};
}
Deno.test('fixed job admission requires normal workload and protected activation; preparation never executes a provider',async()=>{
 const f=fixture();const good=await f.run(prepare);assert.equal(good.status,201);assert.equal(f.requests(),0);assert.equal(f.calls[0].args.p_mode,'plan');assert.equal(f.calls[0].args.p_source_sha256,activation.source_sha256);
 for(const args of [{...prepare,provider:'github'},{...prepare,operation:'setIamPolicy'},{...prepare,payload:{url:'https://evil.invalid'}},{...prepare,change_id:actor}])assert.equal((await f.run(args)).status,400);
 const blocked=fixture();blocked.deny();assert.equal((await blocked.run(prepare)).status,403);assert.equal(blocked.requests(),0);
 const unavailable=fixture();assert.equal((await unavailable.run(prepare,{...activation,url:'https://evil.invalid'})).status,424);assert.equal(unavailable.calls.length,0);
});
Deno.test('job completion requires independent durable receipt and bounded provider output',async()=>{
 const f=fixture();const r=await f.run();assert.equal(r.status,200);const value=await r.json();assert.equal(value.execution,'completed');assert.equal(value.result.policy_changes,0);assert.equal(value.result.OS_commands,0);assert.equal(f.requests(),1);
 for(const alter of ['unknown','secret']as const){const g=fixture();g[alter]();const response=await g.run();assert.equal(response.status,424);assert.equal((await response.text()).includes('PRIVATE'),false);assert.equal(g.requests(),1);assert.equal(g.calls.at(-1).name,'sandy_iap_repair_finish');}
});
Deno.test('unknown dispatch is retained without automatic retry; no grant means no worker call',async()=>{
 const f=fixture();f.lost();const r=await f.run();assert.equal(r.status,424);const value=await r.json();assert.equal(value.executed,null);assert.equal(value.reconciliation_required,true);assert.equal(f.requests(),1);
 const g=fixture();g.deny();assert.equal((await g.run()).status,403);assert.equal(g.requests(),0);
});
Deno.test('own durable job status stays readable when worker transport configuration is unavailable',async()=>{
 const f=fixture();const r=await f.run({action:'job_status',change_id:iapRepairProposal,job_id:job},{...activation,url:''});assert.equal(r.status,200);assert.equal((await r.json()).job.id,job);assert.equal(f.requests(),0);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'sandy_iap_repair_job_context');
 const denied=fixture();denied.deny();assert.equal((await denied.run({action:'job_status',change_id:iapRepairProposal,job_id:job})).status,403);
});
