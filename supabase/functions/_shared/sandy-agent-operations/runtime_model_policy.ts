import {isAgentPrincipal,isRuntimeConversationTask,type AgentPrincipal,type RuntimeConversationTask} from "./identity.ts";

/** The original shared server policy for conversation model selection. This
 * dependency never calls a model and never accepts a customer/model from JSON.
 * Its shadow decision row retains the actual task request/customer association.
 */
export async function selectRuntimeModel(identity:AgentPrincipal|RuntimeConversationTask,db:any,expected:{mode:string;prompt:string;requestId:string}){
 const customerBound=isAgentPrincipal(identity)&&identity.kind==="trusted_runtime"&&!!identity.taskId;
 const anonymous=isRuntimeConversationTask(identity)&&identity.customerId===null;
 if(!customerBound&&!anonymous)throw Error("runtime_model_policy_task_required");
 const customerId=customerBound?identity.customerId:null;
 const {data:task,error}=await db.from("sandy_agent_tasks").select("id,customer_id,request_id,user_request,status").eq("id",identity.taskId).maybeSingle();
 if(error||!task||task.id!==identity.taskId||task.customer_id!==customerId||task.request_id!==expected.requestId||
   task.user_request!==identity.requestText||expected.prompt!==identity.requestText||!["queued","running"].includes(task.status))throw Error("runtime_model_policy_scope_mismatch");
 const prompt=identity.requestText,requestId=expected.requestId,v2ModelMode=expected.mode;
 const complex=/\b(analy[sz]e|investigate|research|compare|develop|debug|code|legal|financial|forecast|strategy|audit|calculate)\b/i.test(prompt)||prompt.length>1000;
 // Task identity is not the same as model cost tier. Preserve existing live model behaviour
 // while gathering properly labelled outcomes for future verified adaptive selection.
 const emailAction=/\b(send|draft|write|reply|forward|search|read|show|list)\b[\s\S]{0,55}\b(email|emails|gmail|inbox|mail)\b/i.test(prompt);
 const selfInspection=/\b(messages?|conversation|connected services?|connected apps?|integrations?|capabilities?|web chat|whatsapp|voice|outstanding tasks?|system state|my location|what time)\b/i.test(prompt);
 const v2TaskType=emailAction?"routine_email":selfInspection?"operational_introspection":complex?"complex_reasoning":"general_assistance";
 const defaultModel=complex?"gpt-5.2":"gpt-4.1-mini";
 let model=defaultModel;
 let routingReason="v1_fallback";
 try{
  const {data:route}=await db.from("ai_task_routes").select("primary_model,enabled").eq("task_type",v2TaskType).maybeSingle();
  if(route?.enabled&&route.primary_model){
    const {data:registry}=await db.from("ai_model_registry").select("eligibility,verified_at").eq("model_id",route.primary_model).maybeSingle();
    const age=registry?.verified_at?Date.now()-new Date(registry.verified_at).getTime():Infinity;
    if(v2ModelMode==="enabled"&&registry?.eligibility==="approved"&&age<14*86400000){model=route.primary_model;routingReason="v2_approved_recently_verified";}
    else routingReason="v2_shadow_or_not_recently_verified";
  }
  await db.from("sandy_v2_model_decisions").insert({customer_id:customerId,request_id:requestId,task_type:v2TaskType,selected_model:model,candidate_models:[{model_id:route?.primary_model||null}],policy_reason:routingReason});
 }catch(e){console.error("v2_model_routing_shadow_failed",String(e).slice(0,100));}


 return {complex,model};
}
