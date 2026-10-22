import {examinerSourceWitness,examinerUtf16Prefix} from "./worker_examiner_text.ts";
import {isExaminerProof,type ExaminerProof} from "./worker_examiner_identity.ts";
import {readExaminerContext,type ExaminerChannel} from "./worker_examiner_context.ts";
import {examinerReviewRequest,examinerSource} from "./worker_examiner_profile.ts";
import {examinerReviewOperation,examinerReviewVersion,validExaminerReviewInput,validExaminerReviewOutput} from "./worker_examiner_contract.ts";
import {fixedRuntimeResponses} from "./runtime_responses_transport.ts";
type Obj=Record<string,any>;
export type ExaminerDependencies={db:any;openaiKey:string;fetch?:typeof fetch};
const first=(x:any)=>Array.isArray(x)?x[0]:x;
const digest=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,"0")).join("");
const object=(v:unknown):v is Obj=>!!v&&typeof v==="object"&&!Array.isArray(v);
async function providerPayload(response:Response):Promise<Obj|null>{
 const reader=response.body?.getReader();if(!reader)return null;const parts:Uint8Array[]=[];let size=0;
 try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>2*1024*1024){await reader.cancel();return null}parts.push(item.value)}const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}const data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));return object(data)?data:null}catch{return null}
}
/** Actual service automation, stored running audit run and source record only.
 * Caller input cannot provide customer identity, arbitrary question/answer,
 * privileged profile/model or provider/tool executor. */
export async function executeExaminerReview(proof:ExaminerProof,target:{runKey:string;channel:ExaminerChannel;sourceId:string},args:Obj,deps:ExaminerDependencies):Promise<{status:number;body:Obj;legacy:Obj|null}>{
 const refuse=(status:number,error:string,unknown=false)=>({status,body:{ok:false,operation:examinerReviewOperation,error,executed:unknown?null:false,reconciliation_required:unknown},legacy:null});
 if(!isExaminerProof(proof))return refuse(403,"examiner_automation_capability_required");
 if(!validExaminerReviewInput(args)||!target||typeof target.runKey!=="string"||!target.runKey.startsWith("live:")||target.runKey.length>200||typeof target.sourceId!=="string"||!target.sourceId||target.sourceId.length>128)return refuse(400,"invalid_examiner_arguments");
 let recorded:Awaited<ReturnType<typeof readExaminerContext>>;try{recorded=await readExaminerContext(deps.db,target.channel,target.sourceId)}catch{return refuse(503,"examiner_actual_context_unavailable")}
 const planned=!!recorded.context.answer&&!!deps.openaiKey;
 const reserved=await deps.db.rpc("sandy_prepare_examiner_review",{p_run_key:target.runKey,p_channel:target.channel,p_source_id:target.sourceId,p_source_sha256:examinerSource.sourceSha256,p_source_canonical:JSON.stringify(await examinerSourceWitness(recorded.source)),p_context_canonical:JSON.stringify(recorded.context),p_model_request_planned:planned});
 const claim=first(reserved.data);if(reserved.error||!claim?.id&&!claim?.existing_review)return refuse(reserved.error?.message==="examiner_source_outcome_requires_reconciliation"?409:503,"examiner_review_admission_unavailable",reserved.error?.message==="examiner_source_outcome_requires_reconciliation");
 const canonical=(row:Obj,reused:boolean)=>({...row,ok:true,operation:examinerReviewOperation,contract_version:examinerReviewVersion,principal_kind:"trusted_internal_worker",auth_user_id:null,external_actions_performed:0,execution_verified:false,reused_record:reused});
 if(claim.existing_review){const body=canonical(claim.existing_review,true);if(!validExaminerReviewOutput(body))return refuse(503,"examiner_existing_review_invalid");return{status:200,body,legacy:claim.existing_review}}
 let verdict=recorded.context.answer?"needs_review":"unverifiable",reason=recorded.context.answer?"actual_outcome_not_independently_verified":"no_verified_outcome",judge:Obj={status:"not_run",receipt:recorded.context.receipt},payload:Obj|null=null;
 try{
  if(planned)judge={status:"judge_unavailable",receipt:recorded.context.receipt};
  if(planned)try{
   const response=await fixedRuntimeResponses(examinerReviewRequest(recorded.context as any),deps.openaiKey,16000,deps.fetch??fetch,false);payload=await providerPayload(response);
   if(payload?.status==="incomplete"||payload?.status==="failed"||payload?.error!=null){judge={status:"judge_unavailable",receipt:recorded.context.receipt};}
   else{const raw=(Array.isArray(payload?.output)?payload.output:[]).flatMap((o:any)=>Array.isArray(o?.content)?o.content:[]).filter((o:any)=>o?.type==="output_text"&&typeof o.text==="string").map((o:any)=>o.text).join("");const parsed=JSON.parse(raw||"{}");
    if(response.ok&&["pass","needs_review","potential_issue"].includes(parsed.verdict)){verdict=parsed.verdict;reason=examinerUtf16Prefix(String(parsed.reason_code||"semantic_review"),90);judge={status:"evaluated",model:"gpt-6-astra",receipt:recorded.context.receipt,quality_score:Number.isInteger(parsed.quality_score)&&parsed.quality_score>=1&&parsed.quality_score<=5?parsed.quality_score:null,reason_summary:examinerUtf16Prefix(String(parsed.explanation||""),350)}}
   }
  }catch{judge={status:"judge_unavailable",receipt:recorded.context.receipt}}
  const responseId=typeof payload?.id==="string"&&payload.id.length>0&&payload.id.length<=512?payload.id:null;
  const finished=await deps.db.rpc("sandy_finish_examiner_review",{p_audit_id:claim.id,p_unknown:false,p_verdict:verdict,p_reason:reason,p_judge_canonical:JSON.stringify(judge),p_provider_response_id:responseId,p_response_sha256:payload?await digest(JSON.stringify(payload)):null});
  const row=first(finished.data);if(finished.error||!row?.review)throw Error("examiner_final_receipt_unavailable");const body=canonical(row.review,false);if(!validExaminerReviewOutput(body))throw Error("examiner_result_invalid");return{status:200,body,legacy:row.review};
 }catch{
  await deps.db.rpc("sandy_finish_examiner_review",{p_audit_id:claim.id,p_unknown:true,p_verdict:null,p_reason:null,p_judge_canonical:null,p_provider_response_id:null,p_response_sha256:null});return refuse(502,"examiner_source_outcome_requires_reconciliation",true);
 }
}
