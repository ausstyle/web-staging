/** Narrow addition to the existing engineering identity policy. These job
 * classes are authorized solely by the independent protected IAP grant. */
import {iapRepairJobInput,iapRepairOperations,iapRepairProposal,isIapRepairOperationRequest} from '../_shared/sandy_iap_repair_contract.ts';
import {argumentDigest} from '../_shared/sandy_api_protocol.ts';
type Obj=Record<string,any>;
const object=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const rpc=async(db:any,name:string,args:Obj)=>{try{const r=await db.rpc(name,args);return !r.error&&object(r.data)?r.data:null;}catch{return null;}};
export async function resolveIapRepairScope(deps:Obj,user:Obj,jwt:Obj,resolved:Obj,body:Obj){
 if(!deps.executionScope||!(body.action==='list'||body.action==='describe'&&iapRepairOperations.includes(body.operation)||isIapRepairOperationRequest(body.operation,body.arguments)))return false;
 const repair=await rpc(deps.db,'sandy_engineering_resolve_iap_repair',{p_actor:user.id,p_session:jwt.session_id,p_epoch:jwt.app_metadata.sandy_engineering_epoch});
 return repair?.ok===true&&repair.identity_user_id===user.id&&repair.session_id===jwt.session_id&&
  repair.owner_authority_id===resolved.owner_authority_id&&Number.isSafeInteger(repair.revision)&&repair.revision>0&&
  object(repair.policy)&&repair.policy.change_id===iapRepairProposal&&typeof repair.policy.expires_at==='string'&&Date.parse(repair.policy.expires_at)>Date.now();
}
export async function authorizeIapRepairExecution(deps:Obj,user:Obj,jwt:Obj,operation:string,args:unknown,entry:unknown,headers:Headers,channel:unknown){
 const deny=(status:number,error:string)=>({ok:false as const,status,error});
 if(!object(entry)||!deps.contractMatches(entry)||entry.api_exposed!==true||entry.ai_exposed!==true||entry.handler!=='sandy-engineering-control'||entry.is_mutation!==(operation!=='engineering.job.status')||
  !object(args)||args.change_id!==iapRepairProposal||!deps.argumentsValid(entry.input_schema,args))return deny(400,'fixed_iap_repair_job_contract_required');
 if(operation==='engineering.implementation.request'){
  if(!iapRepairJobInput(args))return deny(400,'fixed_iap_repair_job_contract_required');
 }else if(operation==='engineering.job.execute'||operation==='engineering.job.status'){
  if(Object.keys(args).length!==2||!uuid(args.job_id))return deny(400,'fixed_iap_repair_job_contract_required');
  const scoped=await rpc(deps.db,'sandy_iap_repair_job_context',{p_actor:user.id,p_session:jwt.session_id,p_epoch:jwt.app_metadata.sandy_engineering_epoch,p_job:args.job_id});
  if(scoped?.ok!==true||!object(scoped.job)||scoped.job.id!==args.job_id||scoped.job.engineering_change_id!==iapRepairProposal)return deny(403,'scoped_iap_repair_job_required');
 }else return deny(403,'scoped_iap_repair_job_required');
 if(headers.has('x-sandy-declared-units')&&headers.get('x-sandy-declared-units')!=='0')return deny(403,'engineering_cost_scope_denied');
 const dispatchId=headers.get('x-sandy-request-id')??crypto.randomUUID();if(!uuid(dispatchId))return deny(400,'invalid_execution_request_id');
 headers.delete('x-sandy-approval-id');
 return {ok:true as const,boundExecution:{operation,arguments:args,inputDigest:await argumentDigest(args),channel:channel==='mcp'?'mcp':'api',registryContract:entry,dispatchId}};
}
