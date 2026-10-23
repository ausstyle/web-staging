import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'npm:jose@5.10.0';
import { handleIapRepairCallback, repairAudience, verifyIapRepairRuntime } from './iap_repair.ts';
import { argumentDigest } from '../_shared/sandy_api_protocol.ts';
const id='10000000-0000-4000-8000-000000000001',sid='10000000-0000-4000-8000-000000000002';
const ticket={admission_id:'10000000-0000-4000-8000-000000000003',grant_id:'10000000-0000-4000-8000-000000000004',request_id:'10000000-0000-4000-8000-000000000005'};
const user={id,app_metadata:{sandy_engineering_test:true,sandy_engineering_epoch:2}};
const token='verified.'+btoa(JSON.stringify({sub:id,role:'authenticated',aud:'authenticated',session_id:sid,app_metadata:user.app_metadata,exp:Date.now()/1000+3600}))+'.signature';
const activation={source_sha256:'a'.repeat(64),worker_revision:'sandy-engineering-mcp-fixture'};
const common={...ticket,...activation,worker_identity:'fixture-google-signed'};
Deno.test('repair callback requires distinct signed Google audience and exact runtime identity',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const sign=(aud=repairAudience,patch:any={})=>new SignJWT({email:'sandy-mcp-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com',email_verified:true,...patch}).setProtectedHeader({alg:'RS256'}).setIssuer('https://accounts.google.com').setAudience(aud).setExpirationTime('5m').sign(privateKey);
 assert.equal(await verifyIapRepairRuntime(await sign(),publicKey),true);
 await assert.rejects(()=>sign('sandy-gcp-admin-readonly-zmqlyygzqoidkcwdysok').then(t=>verifyIapRepairRuntime(t,publicKey)));
 assert.equal(await verifyIapRepairRuntime(await sign(undefined,{email:'other@example.invalid'}),publicKey),false);
 assert.equal(await verifyIapRepairRuntime(await sign(undefined,{email_verified:false}),publicKey),false);
});
Deno.test('normal workload, pinned runtime source, schema and Google identity precede any custody RPC',async()=>{
 let calls=0;
 const db={rpc:()=>{calls++;return {data:{ok:true,admission_id:ticket.admission_id}};}};
 const b={...common,action:'gcp_iap_repair_claim'};
 for(const [u,t,args,config,verify] of [
  [{id},token,b,activation,async()=>true],
  [user,'invalid',b,activation,async()=>true],
  [user,token,b,undefined,async()=>true],
  [user,token,{...b,source_sha256:'f'.repeat(64)},activation,async()=>true],
  [user,token,{...b,worker_revision:'sandy-engineering-mcp-other'},activation,async()=>true],
  [user,token,{...b,url:'https://evil.invalid'},activation,async()=>true],
  [user,token,b,activation,async()=>false],
 ]as const)assert.notEqual((await handleIapRepairCallback(db,u,t,args,config,verify)).status,200);
 assert.equal(calls,0);
 assert.equal((await handleIapRepairCallback(db,user,token,b,activation,async()=>true)).status,200);assert.equal(calls,1);
});
Deno.test('full policy custody validates exact bounded effect and strips identity token before persistence',async()=>{
 const names=['sandy-video','sandy-windows'],ids=['6831598645020395570','8120150462304566315'],ports=[22,5986];
 const expires_at='2026-10-30T21:17:00Z';
 const plans=await Promise.all(names.map(async(vm_name,i)=>{
  const before={version:3,etag:'before',bindings:[{role:'roles/viewer',members:['group:private@example.invalid']}]};
  const candidate={...before,bindings:[...before.bindings,{role:'roles/iap.tunnelResourceAccessor',members:['serviceAccount:sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com'],condition:{title:`sandy-fixed-${vm_name}-port-${ports[i]}`,description:'Authorized Sandy access to this immutable VM and port only',expression:`destination.port == ${ports[i]} && request.time < timestamp("${expires_at}")`}}]};
  return {vm_name,instance_id:ids[i],port:ports[i],expires_at,before,candidate,before_sha256:await argumentDigest(before),candidate_sha256:await argumentDigest(candidate),change_required:true};
 }));
 let payload:any,calls=0;
 const db={rpc:(name:string,args:any)=>{calls++;assert.equal(name,'sandy_iap_repair_finish');assert.equal(args.p_session,sid);payload=args.p_payload;return {data:{ok:true,admission_id:ticket.admission_id,state:'succeeded'}};}};
 const receipts=names.flatMap((name,i)=>[
  {endpoint:`https://compute.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/${name}`,http_status:200},
  {endpoint:`https://iap.googleapis.com/v1/projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/${ids[i]}:getIamPolicy`,http_status:200},
 ]);
 const b={...common,action:'gcp_iap_repair_finish',phase:'plan_preserved',mode:'plan',revision:1,plans,provider_receipts:receipts};
 const good=await handleIapRepairCallback(db,user,token,b,activation,async()=>true);assert.equal(good.status,200);assert.equal(JSON.stringify(payload).includes('fixture-google-signed'),false);assert.equal((await good.text()).includes('private@example.invalid'),false);
 const malicious=structuredClone(b);malicious.plans[0].candidate.bindings[0].role='roles/owner';malicious.plans[0].candidate_sha256=await argumentDigest(malicious.plans[0].candidate);
 assert.equal((await handleIapRepairCallback(db,user,token,malicious,activation,async()=>true)).status,400);assert.equal(calls,1);
 const arbitrary=structuredClone(b);arbitrary.provider_receipts[0].endpoint='https://evil.invalid';assert.equal((await handleIapRepairCallback(db,user,token,arbitrary,activation,async()=>true)).status,400);
});
Deno.test('write reservation rejects unfixed targets, secret fields and missing one-use context',async()=>{
 let args:any;
 const db={rpc:(name:string,a:any)=>{assert.equal(name,'sandy_iap_repair_write_started');args=a;return {data:{ok:false}};}};
 const b={...common,action:'gcp_iap_repair_write_started',vm_name:'sandy-video',instance_id:'6831598645020395570',revision:1,scope_sha256:'b'.repeat(64),before_sha256:'c'.repeat(64),candidate_sha256:'d'.repeat(64)};
 assert.equal((await handleIapRepairCallback(db,user,token,{...b,vm_name:'unapproved'},activation,async()=>true)).status,400);
 assert.equal((await handleIapRepairCallback(db,user,token,{...b,access_token:'do-not-store'},activation,async()=>true)).status,400);
 assert.equal((await handleIapRepairCallback(db,user,token,b,activation,async()=>true)).status,403);assert.equal(args.p_actor,id);
});
