/** Dedicated protected callback boundary. This module establishes no authority.
 * Normal workload Auth and the independently recorded Owner grant are distinct
 * from Google's signed, source-pinned runtime identity. Never accept a caller's
 * desired policy, provider URL or substitute Owner/service-role bearer.
 */
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.10.0';
import { argumentDigest, canonicalJson } from '../_shared/sandy_api_protocol.ts';
type Obj=Record<string,any>;
export const repairAudience='sandy-gcp-iap-repair-zmqlyygzqoidkcwdysok';
const runtime='sandy-mcp-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com';
const member='serviceAccount:sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com';
const role='roles/iap.tunnelResourceAccessor';
const targets=[['sandy-video','6831598645020395570',22],['sandy-windows','8120150462304566315',5986]] as const;
const cap=Date.parse('2026-10-30T21:17:00Z');
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const object=(x:unknown):x is Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(o:Obj,allowed:string[])=>Object.keys(o).every(k=>allowed.includes(k));
const fail=(error:string,status=403)=>Response.json({ok:false,error,executed:false},{status});
const withoutEtag=(p:Obj)=>Object.fromEntries(Object.entries(p).filter(([k])=>k!=='etag'));
export async function verifyIapRepairRuntime(token:string,keySet:any=keys){
 const {payload}=await jwtVerify(token,keySet,{issuer:['https://accounts.google.com','accounts.google.com'],audience:repairAudience,algorithms:['RS256']});
 return payload.email===runtime&&payload.email_verified===true;
}
function policy(p:unknown):p is Obj{
 return object(p)&&exact(p,['version','etag','bindings','auditConfigs'])&&typeof p.etag==='string'&&p.etag.length>0&&p.etag.length<4000&&
  (p.bindings===undefined||Array.isArray(p.bindings)&&p.bindings.every((b:any)=>object(b)&&typeof b.role==='string'&&Array.isArray(b.members)&&b.members.every((m:any)=>typeof m==='string')))&&
  (p.auditConfigs===undefined||Array.isArray(p.auditConfigs))&&canonicalJson(p).length<=50000;
}
function candidate(before:Obj,index:number,expiresAt:string){
 const [name,,port]=targets[index],date=Date.parse(expiresAt);
 if(!Number.isFinite(date)||date>cap)throw Error('bounded_expiry_required');
 const expiration=new Date(date).toISOString().replace('.000Z','Z');
 const expression=`destination.port == ${port} && request.time < timestamp("${expiration}")`;
 const existing=(before.bindings??[]).filter((b:Obj)=>b.role===role&&b.members.includes(member));
 if(existing.length){if(existing.length!==1||existing[0].condition?.expression!==expression)throw Error('conflicting_binding');return before;}
 return {...before,version:3,bindings:[...(before.bindings??[]),{role,members:[member],condition:{title:`sandy-fixed-${name}-port-${port}`,description:'Authorized Sandy access to this immutable VM and port only',expression}}]};
}
async function plan(p:any,index:number){
 if(!object(p)||!exact(p,['vm_name','instance_id','port','expires_at','before_sha256','candidate_sha256','change_required','before','candidate'])||
  p.vm_name!==targets[index][0]||p.instance_id!==targets[index][1]||p.port!==targets[index][2]||typeof p.change_required!=='boolean'||
  typeof p.expires_at!=='string'||!hash(p.before_sha256)||!hash(p.candidate_sha256)||!policy(p.before)||!policy(p.candidate))return false;
 try{return await argumentDigest(p.before)===p.before_sha256&&await argumentDigest(p.candidate)===p.candidate_sha256&&
  canonicalJson(candidate(p.before,index,p.expires_at))===canonicalJson(p.candidate)&&
  p.change_required===(canonicalJson(p.before)!==canonicalJson(p.candidate));}catch{return false;}
}
function providerReceipts(v:unknown){
 const allowed=new Set(targets.flatMap(([name,id])=>[
  `https://compute.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/${name}`,
  ...['getIamPolicy','setIamPolicy'].map(action=>`https://iap.googleapis.com/v1/projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/${id}:${action}`),
 ]));
 return Array.isArray(v)&&v.length<=10&&v.every(r=>object(r)&&exact(r,['endpoint','http_status'])&&allowed.has(r.endpoint)&&r.http_status===200);
}
export function iapRepairWorkloadBinding(user:Obj,token:string):Obj|undefined{

 try{
  const c=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  if(user.app_metadata?.sandy_engineering_test!==true||c.sub!==user.id||c.role!=='authenticated'||c.aud!=='authenticated'||
   !uuid(c.session_id)||c.app_metadata?.sandy_engineering_test!==true||!Number.isSafeInteger(c.app_metadata.sandy_engineering_epoch)||
   c.app_metadata.sandy_engineering_epoch!==user.app_metadata.sandy_engineering_epoch||c.is_anonymous===true||typeof c.exp!=='number'||!Number.isFinite(c.exp)||c.exp*1000<=Date.now())throw Error();
  return {p_actor:user.id,p_session:c.session_id,p_epoch:c.app_metadata.sandy_engineering_epoch};
 }catch{return undefined;}
}
/** Dependencies are injected solely by the protected Control entrypoint. The
 * release installer binds these to independently read-back source/revision. */
export async function handleIapRepairCallback(db:any,user:Obj,token:string,b:Obj,
 activation:{source_sha256:string;worker_revision:string}|undefined,verify=verifyIapRepairRuntime):Promise<Response>{
 const binding=iapRepairWorkloadBinding(user,token);
 if(!binding)return fail('normal_engineering_workload_session_required');
 if(!activation||!hash(activation.source_sha256)||!/^sandy-engineering-mcp-[a-z0-9-]{1,90}$/.test(activation.worker_revision))return fail('protected_repair_activation_required',424);
 if(!object(b)||![b.admission_id,b.grant_id,b.request_id].every(uuid)||typeof b.worker_identity!=='string'||b.worker_identity.length>10000||
  b.source_sha256!==activation.source_sha256||b.worker_revision!==activation.worker_revision)return fail('protected_repair_source_binding_required');
 try{if(!await verify(b.worker_identity))return fail('expected_google_repair_runtime_required');}catch{return fail('expected_google_repair_runtime_required');}
 const common=['action','admission_id','grant_id','request_id','worker_identity','source_sha256','worker_revision'];
 const base={...binding,p_admission:b.admission_id,p_grant:b.grant_id,p_request:b.request_id};
 let rpc:string,args:Obj;
 if(b.action==='gcp_iap_repair_claim'){
  if(!exact(b,common))return fail('invalid_repair_claim',400);
  rpc='sandy_iap_repair_claim';args={...base,p_source_sha256:b.source_sha256,p_worker_revision:b.worker_revision};
 }else if(b.action==='gcp_iap_repair_write_started'){
  if(!exact(b,[...common,'vm_name','instance_id','revision','scope_sha256','before_sha256','candidate_sha256'])||
   !targets.some(([name,id])=>b.vm_name===name&&b.instance_id===id)||!Number.isSafeInteger(b.revision)||b.revision<1||
   ![b.scope_sha256,b.before_sha256,b.candidate_sha256].every(hash))return fail('invalid_fixed_target_write_reservation',400);
  rpc='sandy_iap_repair_write_started';args={...base,p_revision:b.revision,p_scope_sha256:b.scope_sha256,
   p_vm_name:b.vm_name,p_instance_id:b.instance_id,p_before_sha256:b.before_sha256,p_candidate_sha256:b.candidate_sha256};
 }else if(b.action==='gcp_iap_repair_finish'){
  const fields=['phase','mode','revision','vm_name','instance_id','before','observed_after','proof','plans','targets','provider_receipts','reconciliation_required'];
  if(!exact(b,[...common,...fields])||canonicalJson(b).length>190000)return fail('invalid_repair_custody_receipt',400);
  if(b.phase==='plan_preserved'){
   if(b.mode!=='plan'||!Number.isSafeInteger(b.revision)||b.revision<1||!Array.isArray(b.plans)||b.plans.length!==2||
    !await plan(b.plans[0],0)||!await plan(b.plans[1],1)||!providerReceipts(b.provider_receipts)||b.provider_receipts.some((r:Obj)=>r.endpoint.endsWith(':setIamPolicy')))
    return fail('invalid_fixed_plan_custody',400);
  }else if(b.phase==='target_verified'){
   const index=targets.findIndex(([name,id])=>b.vm_name===name&&b.instance_id===id);
   if(index<0||!['apply','rollback'].includes(b.mode)||!Number.isSafeInteger(b.revision)||b.revision<1||!policy(b.before)||!policy(b.observed_after)||!object(b.proof)||
    !exact(b.proof,['vm_name','instance_id','port','expires_at','before_sha256','candidate_sha256','change_required'])||b.proof.vm_name!==b.vm_name||b.proof.instance_id!==b.instance_id||
    b.proof.port!==targets[index][2]||!hash(b.proof.before_sha256)||!hash(b.proof.candidate_sha256)||typeof b.proof.change_required!=='boolean'||
    await argumentDigest(b.before)!==b.proof.before_sha256)return fail('invalid_independent_target_readback',400);
   try{
    if(b.mode==='apply'&&canonicalJson(withoutEtag(candidate(b.before,index,b.proof.expires_at)))!==canonicalJson(withoutEtag(b.observed_after)))return fail('unexpected_IAP_policy_effect',400);
   }catch{return fail('unexpected_IAP_policy_effect',400);}
  }else if(b.phase==='completed'){
   if(!['apply','rollback'].includes(b.mode)||!Number.isSafeInteger(b.revision)||b.revision<1||!Array.isArray(b.targets)||b.targets.length!==2||
    !b.targets.every((r:Obj,i:number)=>object(r)&&r.vm_name===targets[i][0]&&r.instance_id===targets[i][1]&&r.policy_readback_verified===true)||!providerReceipts(b.provider_receipts))return fail('invalid_completed_readback',400);
  }else if(b.phase==='failed_or_unknown'){
   if(typeof b.reconciliation_required!=='boolean'||!providerReceipts(b.provider_receipts))return fail('invalid_uncertain_outcome',400);
  }else return fail('invalid_repair_receipt_phase',400);
  // Never persist any bearer or signed identity token. Only reviewed fields can
  // enter private custody; public success contains admission/status/digest only.
  const payload=Object.fromEntries(Object.entries(b).filter(([k])=>fields.includes(k)));
  rpc='sandy_iap_repair_finish';args={...base,p_payload:payload};
 }else return fail('unsupported_protected_repair_callback',400);
 const {data,error}=await db.rpc(rpc,args);
 return error||data?.ok!==true||data.admission_id!==b.admission_id?fail('protected_repair_admission_refused'):Response.json(data);
}
