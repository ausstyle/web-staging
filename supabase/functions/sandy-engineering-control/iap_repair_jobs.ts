/** Normal Engineering job API -> protected worker. No provider execution here. */
import { iapRepairJobInput, iapRepairProposal } from '../_shared/sandy_iap_repair_contract.ts';
export {isIapRepairControlRequest} from '../_shared/sandy_iap_repair_contract.ts';
import { iapRepairWorkloadBinding } from './iap_repair.ts';
type Obj=Record<string,any>;
type Activation={url:string;source_sha256:string;worker_revision:string};
const fail=(error:string,status=403,extra:Obj={})=>Response.json({ok:false,error,executed:false,...extra},{status});
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export async function handleIapRepairJob(db:any,user:Obj,token:string,b:Obj,activation:Activation,request=fetch):Promise<Response>{
 const binding=iapRepairWorkloadBinding(user,token);if(!binding)return fail('normal_engineering_workload_session_required');
 if(b.action==='job_status'){
  if(Object.keys(b).length!==3||b.change_id!==iapRepairProposal||!uuid(b.job_id))return fail('fixed_iap_repair_job_contract_required',400);
  try{
   const r=await db.rpc('sandy_iap_repair_job_context',{...binding,p_job:b.job_id});
   if(r.error||r.data?.ok!==true||r.data.job?.id!==b.job_id||r.data.job.engineering_change_id!==b.change_id)return fail('scoped_iap_repair_job_required');
   return Response.json({job:r.data.job});
  }catch{return fail('iap_repair_job_status_unavailable',503);}
 }
 if(!activation||!hash(activation.source_sha256)||!/^sandy-engineering-mcp-[a-z0-9-]{1,90}$/.test(activation.worker_revision)||
  !/^https:\/\/(?:(?:sandy-api-review|sandy-iap-repair-review)---)?sandy-engineering-mcp-(?:[a-z0-9]+-ew\.a|1030223524306\.europe-west1)\.run\.app$/.test(activation.url))return fail('protected_repair_activation_required',424);
 const rpc=async(name:string,args:Obj)=>{try{const r=await db.rpc(name,args);return !r.error&&r.data?.ok!==false?r.data:null;}catch{return null;}};
 if(b.action==='implementation_request'){
  const args=Object.fromEntries(Object.entries(b).filter(([k])=>k!=='action'));
  if(!iapRepairJobInput(args))return fail('fixed_iap_repair_job_contract_required',400);
  const saved=await rpc('sandy_iap_repair_prepare_job',{...binding,p_change:args.change_id,p_mode:args.operation.slice('iap.repair.'.length),
   p_parent:args.payload.parent_admission_id??null,p_key:args.idempotency_key,p_source_sha256:activation.source_sha256,p_worker_revision:activation.worker_revision});
  if(!saved||saved.ok!==true||!uuid(saved.job?.id)||saved.job.engineering_change_id!==iapRepairProposal||saved.job.requested_by!==user.id)return fail('independent_iap_repair_job_authorization_required');
  return Response.json(saved,{status:saved.reused?200:201});
 }
 if(b.action!=='execute_job'||Object.keys(b).length!==3||b.change_id!==iapRepairProposal||!uuid(b.job_id))return fail('fixed_iap_repair_job_contract_required',400);
 const scoped=await rpc('sandy_iap_repair_job_context',{...binding,p_job:b.job_id});
 if(!scoped||scoped.ok!==true||scoped.job?.id!==b.job_id||scoped.job.engineering_change_id!==b.change_id)return fail('scoped_iap_repair_job_required');
 const admitted=await rpc('sandy_iap_repair_job_admit',{...binding,p_job:b.job_id,p_source_sha256:activation.source_sha256,p_worker_revision:activation.worker_revision});
 if(!admitted||![admitted.admission_id,admitted.grant_id,admitted.request_id].every(uuid))return fail('one_use_source_pinned_iap_job_required');
 const base={...binding,p_admission:admitted.admission_id,p_grant:admitted.grant_id,p_request:admitted.request_id};
 let body:Obj|undefined;
 try{
  const response=await request(activation.url+'/internal/gcp-admin/iap-repair',{method:'POST',redirect:'error',
   headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(admitted),signal:AbortSignal.timeout(110000)});
  const text=await response.text();if(text.length>40000)throw Error();const value=JSON.parse(text);
  if(!response.ok||value?.ok!==true)throw Error();
  const allowed=['ok','admission_id','mode','administrator_identity','policy_changes','targets','provider_receipts','token_recorded','tunnel_execution_verified','OS_commands'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||value.admission_id!==admitted.admission_id||
   value.mode!==scoped.job.payload.mode||value.administrator_identity!=='sandy-cloud-administrator@elaborate-haven-511518-a5.iam.gserviceaccount.com'||
   value.token_recorded!==false||value.tunnel_execution_verified!==false||value.OS_commands!==0||!Number.isSafeInteger(value.policy_changes)||value.policy_changes<0||value.policy_changes>2||
   !Array.isArray(value.targets)||value.targets.length!==2||!Array.isArray(value.provider_receipts)||value.provider_receipts.length>10||
   !value.provider_receipts.every((r:Obj)=>r&&Object.keys(r).length===2&&r.http_status===200&&typeof r.endpoint==='string'&&
    /^https:\/\/(?:compute\.googleapis\.com\/compute\/v1\/projects\/elaborate-haven-511518-a5\/zones\/europe-west1-b\/instances\/(?:sandy-video|sandy-windows)|iap\.googleapis\.com\/v1\/projects\/1030223524306\/iap_tunnel\/zones\/europe-west1-b\/instances\/(?:6831598645020395570|8120150462304566315):(?:getIamPolicy|setIamPolicy))$/.test(r.endpoint)))throw Error();
  for(const [i,t] of value.targets.entries()){
   const fields=['vm_name','instance_id','port','expires_at','before_sha256','candidate_sha256','change_required',...(value.mode==='plan'?[]:['observed_sha256','policy_readback_verified'])];
   if(!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).some(k=>!fields.includes(k))||t.vm_name!==['sandy-video','sandy-windows'][i]||t.instance_id!==['6831598645020395570','8120150462304566315'][i]||t.port!==[22,5986][i]||
    !hash(t.before_sha256)||!hash(t.candidate_sha256)||typeof t.change_required!=='boolean'||!Number.isFinite(Date.parse(t.expires_at))||
    value.mode!=='plan'&&(!hash(t.observed_sha256)||t.policy_readback_verified!==true))throw Error();
  }
  const receipt=await rpc('sandy_iap_repair_status',base);
  if(!receipt||receipt.state!=='succeeded'||receipt.job_id!==b.job_id||receipt.mode!==value.mode||receipt.source_sha256!==activation.source_sha256||receipt.worker_revision!==activation.worker_revision||!hash(receipt.result_sha256))throw Error();
  body={job_id:b.job_id,execution:'completed',admission_id:admitted.admission_id,result:value,result_sha256:receipt.result_sha256,executed:true};
 }catch{
  // A lost HTTP reply is never an instruction to retry a mutation. The ledger
  // preserves any observed target receipts; a terminal success cannot be reset.
  await rpc('sandy_iap_repair_finish',{...base,p_payload:{phase:'failed_or_unknown',reconciliation_required:true,provider_receipts:[]}});
  return fail('iap_repair_execution_requires_reconciliation',424,{executed:null,reconciliation_required:true,job_id:b.job_id,admission_id:admitted.admission_id});
 }
 return Response.json(body);
}
