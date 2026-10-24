/** Normal renewable workload sessions dispatch read jobs through MCP -> Sandy API.
 * Queue/claim credentials are internal only; they never replace Owner identity.
 */
import {argumentDigest} from '../_shared/sandy_api_protocol.ts';
type Obj=Record<string,any>;
type Deps={db:{rpc(name:string,args:Obj):PromiseLike<{data:any;error:any}>};base:string;anon?:string;fetch?:typeof fetch};
const object=(v:any):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:any):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
async function rpc(deps:Deps,name:string,args:Obj):Promise<Obj|null>{try{const r=await deps.db.rpc(name,args);return !r.error&&object(r.data)?r.data:null;}catch{return null;}}
async function responseJson(reply:Response):Promise<Obj|null>{
 const reader=reply.body?.getReader();if(!reader)return null;let length=0;const parts:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1100000){await reader.cancel();return null;}parts.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return object(value)?value:null;}catch{return null;}finally{reader.releaseLock();}
}
function executionEnvelope(value:Obj|null,dispatch:string):{status:number;body:Obj}|null{
 if(!value||value.jsonrpc!=='2.0'||value.id!==dispatch||!object(value.result)||!Array.isArray(value.result.content)||value.result.content.length!==1)return null;
 const part=value.result.content[0];if(!object(part)||part.type!=='text'||typeof part.text!=='string')return null;
 try{const envelope=JSON.parse(part.text);return object(envelope)&&Number.isInteger(envelope.status)&&object(envelope.result)?{status:envelope.status,body:envelope.result}:null;}catch{return null;}
}
export async function runWorkloadRead(deps:Deps,claim:Obj,worker:string):Promise<Obj>{
 const refused=(state:string)=>({job_id:claim.job_id,state,persisted:false,reconciliation_required:true});
 const dispatch=await rpc(deps,'sandy_orch_resolve_workload_dispatch',{p_job_id:claim.job_id,p_lease_token:claim.lease_token,p_worker_id:worker});
 if(!dispatch||dispatch.ok!==true||dispatch.job_id!==claim.job_id||!uuid(dispatch.identity_user_id)||!uuid(dispatch.dispatch_id)||!object(dispatch.arguments)||typeof dispatch.operation!=='string'||!/^(github|supabase)\.[a-z0-9_.]{1,100}$/.test(dispatch.operation) )return refused('workload_dispatch_not_confirmed');
 if(dispatch.input_sha256!==await argumentDigest(dispatch.arguments)){
  // A noncanonical admission is a known pre-dispatch failure, not an unknown
  // provider outcome. Persist it once rather than abandoning a running lease.
  const failed=await rpc(deps,'sandy_orch_finish',{p_job_id:claim.job_id,p_lease_token:claim.lease_token,p_worker_id:worker,p_dispatch_id:dispatch.dispatch_id,p_outcome:'failed',p_result:null,p_error_code:'canonical_argument_mismatch',p_provider_request_id:null,p_execution_admission_id:null});
  const persisted=failed?.ok===true&&failed.job_id===claim.job_id&&failed.receipt_outcome==='failed'&&failed.state==='failed';
  return {job_id:claim.job_id,state:persisted?'failed':'receipt_persistence_unknown',persisted,...(persisted?{}:{reconciliation_required:true})};
 }
 let observed:Obj|null=null,status:number|null=null;
 try{
  const bootstrap=await rpc(deps,'sandy_engineering_runtime_bootstrap',{p_user_id:dispatch.identity_user_id});
  if(!bootstrap||bootstrap.ok!==true||typeof bootstrap.credential!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(bootstrap.credential))throw Error('private_bootstrap_unavailable');
  const reply=await(deps.fetch??fetch)(new URL('/functions/v1/sandy-engineering-runtime',deps.base),{method:'POST',redirect:'error',headers:{authorization:'Bearer '+bootstrap.credential,apikey:deps.anon??'','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:dispatch.dispatch_id,method:'tools/call',params:{name:dispatch.operation,arguments:{__sandy_execution:{request_id:dispatch.dispatch_id},arguments:dispatch.arguments}}}),signal:AbortSignal.timeout(45000)});
  const parsed=await responseJson(reply),envelope=executionEnvelope(parsed,dispatch.dispatch_id);status=envelope?.status??reply.status;observed=envelope?.body??null;
  if(!envelope&&parsed&&['invalid_runtime_credential','engineering_session_unavailable','engineering_operation_scope_denied','runtime_authentication_required'].includes(parsed.error)&&reply.status>=400){observed={ok:false,error:parsed.error,executed:false,automatic_retry:false};}
 }catch{/* No redispatch. Existing read-only lease/retry policy handles uncertainty. */}
 let outcome='unknown',error='workload_read_transport_outcome_unknown';
 const success=status!==null&&status>=200&&status<300&&observed?.ok===true&&observed.executed===true&&observed.request_state==='observed'&&uuid(observed.admission_id)&&Number.isInteger(observed.provider_http_status)&&observed.provider_http_status>=200&&observed.provider_http_status<300;
 if(success){outcome='succeeded';error='';}
 else if(status!==null&&observed&&observed.executed!==null){outcome=observed.automatic_retry===false?'failed':status===429||status>=500?'retryable':'failed';error=observed.error==='engineering_session_unavailable'?'engineering_session_unavailable':outcome==='retryable'?'transient_provider_failure':'canonical_executor_refused';}
 const finished=await rpc(deps,'sandy_orch_finish',{p_job_id:claim.job_id,p_lease_token:claim.lease_token,p_worker_id:worker,p_dispatch_id:dispatch.dispatch_id,p_outcome:outcome,p_result:success?observed:null,p_error_code:error||null,p_provider_request_id:typeof observed?.provider_request_id==='string'?observed.provider_request_id:null,p_execution_admission_id:uuid(observed?.admission_id)?observed!.admission_id:null});
 const persisted=finished?.ok===true&&finished.job_id===claim.job_id&&finished.receipt_outcome===outcome&&typeof finished.reused==='boolean'&&['queued','succeeded','failed','needs_reconciliation','dead_letter'].includes(finished.state)&&(outcome!=='succeeded'||finished.state==='succeeded');
 return {job_id:claim.job_id,state:persisted?finished!.state:'receipt_persistence_unknown',persisted,...(persisted?{}:{reconciliation_required:true})};
}
