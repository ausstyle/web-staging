import {completedWorkerModelPayload} from "./worker_model_result.ts";
import {collectReceiptModelMetrics} from "./runtime_model_metrics.ts";
import {literalTaskTitle,taskAnalysisRequest,taskAnalysisValue} from "./task_analysis_profile.ts";
type Obj=Record<string,any>;
export const taskAnalysisSourceSha256="567cba5f8959f0e154e0a7c0a63c6d995816a50c927db4fe3843c3e7c4570a28";
const object=(v:unknown):v is Obj=>!!v&&typeof v==="object"&&!Array.isArray(v);
const first=(v:any)=>Array.isArray(v)?v[0]:v;
const sha=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),n=>n.toString(16).padStart(2,"0")).join("");
async function boundedEnvelope(response:Response){
 const reader=response.body?.getReader();if(!reader)return null;
 let count=0;const parts:Uint8Array[]=[];
 try{for(;;){const v=await reader.read();if(v.done)break;count+=v.value.length;if(count>256*1024){await reader.cancel();return null;}parts.push(v.value);}
 const bytes=new Uint8Array(count);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return object(body)?body:null;
 }catch{return null;}
}
/** Existing Model Gateway only; no provider key, URL, model or tool selection is
 * accepted from HTTP callers. The private admission binds a real claimed queue
 * item/customer/title and reserves its hard token/request limits before fetch.
 * Any lost provider/final receipt is unknown and never triggers another paid call.
 */
export async function extractTaskConfiguration(db:any,job:{taskId:string;customerId:string;title:string},broker:{base:string;serviceCredential:string},request:typeof fetch=fetch):Promise<Obj|null>{
 if(literalTaskTitle(job.title))return null;
 if(broker.base!=="https://zmqlyygzqoidkcwdysok.supabase.co"||!broker.serviceCredential)throw Error("task_analysis_gateway_binding_invalid");
 const body=taskAnalysisRequest(job.title),canonical=JSON.stringify(body);
 const admitted=await db.rpc("sandy_task_model_admit",{p_task_id:job.taskId,p_customer_id:job.customerId,p_source_sha256:taskAnalysisSourceSha256,p_request_canonical:canonical});
 const claim=first(admitted.data);
 if(admitted.error||!object(claim)||claim.ok!==true)throw Error("task_analysis_model_admission_unavailable");
 if(claim.state==="succeeded"){
  const value=taskAnalysisValue(claim.result,job.title);if(!value)throw Error("task_analysis_saved_result_unavailable");return value;
 }
 if(claim.state!=="started"||typeof claim.audit_id!=="string"||claim.reused===true)throw Error("task_analysis_model_outcome_requires_reconciliation");
 let envelope:Obj|null=null,responseId:string|null=null,responseHash:string|null=null,metrics:Obj|null=null,gatewayStatus:number|null=null;
 const started=Date.now();
 try{
  const response=await request(broker.base+"/functions/v1/sandy-openai-gateway-v4",{method:"POST",headers:{authorization:"Bearer "+broker.serviceCredential,"x-sandy-purpose":"internal","x-sandy-task":"Extract only the requested task's configuration","content-type":"application/json"},body:canonical,signal:AbortSignal.timeout(12000)});
  gatewayStatus=response.status;envelope=await boundedEnvelope(response);
  metrics=await collectReceiptModelMetrics(db,envelope,started,Date.now());
  if(!response.ok||!completedWorkerModelPayload(envelope))throw Error("task_analysis_provider_outcome_unverified");
  responseId=envelope.id;responseHash=await sha(JSON.stringify(envelope));
  const text=envelope.output.flatMap((x:Obj)=>Array.isArray(x.content)?x.content:[]).filter((x:Obj)=>x?.type==="output_text"&&typeof x.text==="string").map((x:Obj)=>x.text).join("");
  const value=taskAnalysisValue(JSON.parse(text),job.title);if(!value)throw Error("task_analysis_configuration_unverified");
  const finished=await db.rpc("sandy_task_model_finish",{p_audit_id:claim.audit_id,p_state:"succeeded",p_provider_response_id:responseId,p_response_sha256:responseHash,p_result:value,p_metrics:metrics,p_gateway_http_status:gatewayStatus});
  if(finished.error||first(finished.data)?.ok!==true)throw Error("task_analysis_final_receipt_unavailable");
  return value;
 }catch{
  try{await db.rpc("sandy_task_model_finish",{p_audit_id:claim.audit_id,p_state:"unknown",p_provider_response_id:responseId,p_response_sha256:responseHash,p_result:null,p_metrics:metrics,p_gateway_http_status:gatewayStatus});}catch{/* The started reservation remains non-replayable if custody is unavailable. */}
  throw Error("task_analysis_model_outcome_requires_reconciliation");
 }
}
