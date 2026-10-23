// Fixed-target provider component for the protected Sandy API worker.
// Not mounted by server.mjs: independent grant + durable claim/write-start/finish
// callbacks must be installed and verified before a release may activate it.
import { createHash } from 'node:crypto';
import { project, runtimeAccount, administratorAccount } from './gcp-admin-worker.mjs';
const control='https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-engineering-control';
export const iapRepairAudience='sandy-gcp-iap-repair-zmqlyygzqoidkcwdysok';
const member=`serviceAccount:sandy-computer@${project}.iam.gserviceaccount.com`,role='roles/iap.tunnelResourceAccessor';
const targets=[['sandy-video','6831598645020395570',22],['sandy-windows','8120150462304566315',5986]];
const cap=Date.parse('2026-10-30T21:17:00Z');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const policyDigest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const samePolicy=(a,b)=>policyDigest(Object.fromEntries(Object.entries(a).filter(([k])=>k!=='etag')))===policyDigest(Object.fromEntries(Object.entries(b).filter(([k])=>k!=='etag')));
const iap=(id,action)=>`https://iap.googleapis.com/v1/projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/${id}:${action}`;
class Refused extends Error {constructor(code,status=424,endpoint=null,providerStatus=null){super(code);Object.assign(this,{status,endpoint,providerStatus});}}
function expiry(value,now){const n=Date.parse(value);if(!Number.isFinite(n)||n<=now||n>cap)throw new Refused('bounded_independent_repair_grant_required',403);return new Date(n).toISOString().replace('.000Z','Z');}
export function candidateIapPolicy(policy,name,expiresAt,now=Date.now()){
 const target=targets.find(t=>t[0]===name);if(!target||!policy||typeof policy.etag!=='string'||!policy.etag||Object.keys(policy).some(k=>!['version','etag','bindings','auditConfigs'].includes(k))||!Array.isArray(policy.bindings??[]))throw new Refused('reviewed_policy_preimage_required');
 const expiration=expiry(expiresAt,now),expression=`destination.port == ${target[2]} && request.time < timestamp("${expiration}")`;
 for(const b of policy.bindings??[]){
  if(!b||typeof b!=='object'||!Array.isArray(b.members)||typeof b.role!=='string')throw new Refused('reviewed_policy_preimage_required');
  if(b.role===role&&b.members.includes(member)){
   if(b.condition?.expression===expression)return {policy:structuredClone(policy),changed:false};
   throw new Refused('existing_principal_binding_requires_administrator_review');
  }
 }
 return {policy:{...structuredClone(policy),version:3,bindings:[...structuredClone(policy.bindings??[]),{role,members:[member],condition:{title:`sandy-fixed-${name}-port-${target[2]}`,description:'Authorized Sandy access to this immutable VM and port only',expression}}]},changed:true};
}
export function createProtectedIapRepairWorker({connect,request=fetch,now=Date.now}={}){
 return async(req,res)=>{
  const bearer=req.get('authorization'),body=req.body;
  if(!/^Bearer [A-Za-z0-9._~-]+$/.test(bearer??'')||!body||Object.keys(body).some(k=>!['admission_id','grant_id','request_id'].includes(k))||![body.admission_id,body.grant_id,body.request_id].every(uuid))return res.status(403).json({ok:false,error:'protected_API_admission_required',executed:false});
  let claimed=false,writeDispatched=false;const receipts=[];let connection,workerIdentity;
  const callback=async(action,extra={})=>{
   const response=await request(control,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:bearer,'content-type':'application/json'},body:JSON.stringify({action,...body,...extra,worker_identity:workerIdentity})});
   const result=await response.json();if(!response.ok||result.ok!==true||result.admission_id!==body.admission_id)throw new Refused('protected_repair_admission_refused',403);return result;
  };
  try{
   if(typeof connect!=='function')throw new Refused('protected_administrator_connection_not_configured',503);
   connection=await connect();if(connection.principal!==runtimeAccount)throw new Refused('expected_runtime_identity_required',403);
   workerIdentity=await connection.identityToken(iapRepairAudience);
   const grant=await callback('gcp_iap_repair_claim');
   if(!['plan','apply','rollback'].includes(grant.mode)||!Number.isSafeInteger(grant.revision)||grant.revision<1||!/^[a-f0-9]{64}$/.test(grant.scope_sha256??''))throw new Refused('independent_repair_scope_required',403);
   const expiresAt=expiry(grant.expires_at,now());claimed=true;
   const admin=connection.administrator();
   try{await admin.getAccessToken();}catch(e){throw new Refused('administrator_short_lived_token_issuance_failed',424,`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${administratorAccount}:generateAccessToken`,Number.isInteger(e?.response?.status)?e.response.status:null);}
   const remaining=Number(admin.credentials?.expiry_date)-now();if(!Number.isFinite(remaining)||remaining<60000||remaining>1810000)throw new Refused('short_lived_administrator_token_required',403);
   const call=async(url,data)=>{
    try{const r=await admin.request({url,method:data?'POST':'GET',...(data?{data}:{}),timeout:15000,retry:false,maxRedirects:0,maxContentLength:262144,responseType:'json'});receipts.push({endpoint:url,http_status:r.status});if(r.status!==200||!r.data||typeof r.data!=='object')throw new Refused('provider_response_unverified');return r.data;}
    catch(e){if(e instanceof Refused)throw e;throw new Refused('IAP_provider_request_failed',424,url,Number.isInteger(e?.response?.status)?e.response.status:null);}
   };
   const plans=[],verified=[];
   if(grant.mode!=='plan'&&(!Array.isArray(grant.plans)||grant.plans.length!==2))throw new Refused('protected_plan_custody_required',403);
   for(const [index,[name,id,port]] of targets.entries()){
    const vm=await call(`https://compute.googleapis.com/compute/v1/projects/${project}/zones/europe-west1-b/instances/${name}`);
    if(String(vm.id)!==id||vm.name!==name)throw new Refused('immutable_VM_identity_required');
    const before=await call(iap(id,'getIamPolicy'),{options:{requestedPolicyVersion:3}});
    let desired,changed;
    if(grant.mode==='rollback'){
     const saved=grant.plans[index];
     if(saved.vm_name!==name||saved.instance_id!==id||!saved.before||!saved.observed_after||!samePolicy(before,saved.observed_after)||!samePolicy(candidateIapPolicy(saved.before,name,saved.expires_at,Math.min(now(),Date.parse(saved.expires_at)-1)).policy,saved.observed_after))throw new Refused('rollback_preimage_changed_requires_review');
     // Restore only when the full current policy matches the previously observed
     // effect. An unrelated administrator change cannot be overwritten.
     desired={...structuredClone(saved.before),etag:before.etag};changed=!samePolicy(before,desired);
    }else{
     const candidate=candidateIapPolicy(before,name,expiresAt,now());desired=candidate.policy;changed=candidate.changed;
     if(grant.mode==='apply'){
      const saved=grant.plans[index];
      if(saved.vm_name!==name||saved.instance_id!==id||saved.before_sha256!==policyDigest(before)||saved.candidate_sha256!==policyDigest(desired))throw new Refused('plan_or_policy_preimage_changed');
     }
    }
    const proof={vm_name:name,instance_id:id,port,expires_at:expiresAt,before_sha256:policyDigest(before),candidate_sha256:policyDigest(desired),change_required:changed};
    if(grant.mode==='plan'){plans.push({...proof,before,candidate:desired});continue;}
    if(changed){
     // Durable one-use write-start and fresh revocation/revision check precede
     // each individual provider mutation. Caller JSON supplies none of these.
     await callback('gcp_iap_repair_write_started',{vm_name:name,instance_id:id,revision:grant.revision,scope_sha256:grant.scope_sha256,before_sha256:proof.before_sha256,candidate_sha256:proof.candidate_sha256});
     writeDispatched=true;await call(iap(id,'setIamPolicy'),{policy:desired});
    }
    const observed=await call(iap(id,'getIamPolicy'),{options:{requestedPolicyVersion:3}});
    if(!samePolicy(observed,desired))throw new Refused('policy_readback_requires_reconciliation');
    // Full preimages go only to the protected control custody callback. Public
    // results contain hashes/statuses, never other principals or tokens.
    await callback('gcp_iap_repair_finish',{phase:'target_verified',mode:grant.mode,revision:grant.revision,vm_name:name,instance_id:id,before,observed_after:observed,proof});
    verified.push({...proof,observed_sha256:policyDigest(observed),policy_readback_verified:true});
   }
   await callback('gcp_iap_repair_finish',{phase:grant.mode==='plan'?'plan_preserved':'completed',mode:grant.mode,revision:grant.revision,...(grant.mode==='plan'?{plans}:{targets:verified}),provider_receipts:receipts});
   return res.status(200).json({ok:true,admission_id:body.admission_id,mode:grant.mode,administrator_identity:administratorAccount,policy_changes:grant.mode==='plan'?0:verified.filter(t=>t.change_required).length,targets:grant.mode==='plan'?plans.map(({before,candidate,...p})=>p):verified,provider_receipts:receipts,token_recorded:false,tunnel_execution_verified:false,OS_commands:0});
  }catch(e){
   if(claimed){try{await callback('gcp_iap_repair_finish',{phase:'failed_or_unknown',reconciliation_required:writeDispatched,provider_receipts:receipts});}catch{/* Unknown durable state is surfaced; never retry a provider write. */}}
   return res.status(e instanceof Refused?e.status:503).json({ok:false,error:e instanceof Refused?e.message:'protected_repair_connection_unavailable',executed:writeDispatched?null:false,reconciliation_required:writeDispatched,provider_http_status:e instanceof Refused?e.providerStatus:null,provider_endpoint:e instanceof Refused?e.endpoint:null,admission_id:body.admission_id,provider_receipts:receipts,token_recorded:false,OS_commands:0});
  }
 };
}
