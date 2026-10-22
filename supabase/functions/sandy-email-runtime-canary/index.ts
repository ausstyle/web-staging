import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {emailCandidateOutcome} from "./outcome.ts";
import {emailExecutiveHistory} from "./history.ts";
import {assessmentEnvelope} from "../_shared/sandy-executive/assessment.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
const reply=(s:number,v:unknown)=>new Response(JSON.stringify(v),{status:s,headers:{"content-type":"application/json"}});
Deno.serve(async req=>{
 if(req.method!=="POST")return reply(405,{error:"POST required"});
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",url=Deno.env.get("SUPABASE_URL")||"";
 if(!key||!url)return reply(503,{error:"unconfigured"});
 if(req.headers.get("authorization")!=="Bearer "+key)return reply(403,{error:"unauthorized"});
 let input:any;try{input=await req.json()}catch{return reply(400,{error:"JSON required"})}
 const id=String(input.source_message_id||"");
 if(!/^[0-9a-f-]{36}$/i.test(id))return reply(400,{error:"invalid id"});
 const db=createClient(url,key,{auth:{persistSession:false}});
 const {data:source,error:sourceError}=await db.from("email_messages").select("id,customer_id,direction,subject,body_text,conversation_id,created_at").eq("id",id).eq("direction","incoming").maybeSingle();
 if(sourceError||!source?.customer_id)return reply(404,{error:"source unavailable"});
 const {data:allowed}=await db.from("sandy_email_runtime_canary_allowlist").select("enabled").eq("customer_id",source.customer_id).maybeSingle();
 if(!allowed?.enabled||!/^\[SANDY QA\]/i.test(String(source.subject||"")))return reply(403,{error:"not enabled for this message"});
 const {data:existing}=await db.from("sandy_email_runtime_canary").select("status").eq("source_message_id",id).maybeSingle();
 if(existing)return reply(409,{error:"already processed",status:existing.status});
 const {data:g}=await db.from("email_ai_generations").select("draft_message_id,status").eq("source_message_id",id).maybeSingle();
 if(g?.status!=="generated"||!g.draft_message_id)return reply(409,{error:"baseline draft not generated"});
 const {data:d}=await db.from("email_messages").select("body_text").eq("id",g.draft_message_id).maybeSingle();
 if(!d?.body_text)return reply(409,{error:"baseline draft unavailable"});
 const body=String(source.body_text||"").slice(0,5000);
 if(body.length<3)return reply(400,{error:"empty request"});
 const inserted=await db.from("sandy_email_runtime_canary").insert({source_message_id:id,customer_id:source.customer_id,baseline_draft_id:g.draft_message_id,baseline_excerpt:String(d.body_text).slice(0,2500),status:"running"});
 if(inserted.error)return reply(500,{error:"reservation failed",code:inserted.error.code});
 try{
  const history=await emailExecutiveHistory(db,source);
  const result=await fetch(url+"/functions/v1/sandy-agent-runtime",{method:"POST",headers:{"authorization":"Bearer "+key,"content-type":"application/json"},body:JSON.stringify(assessmentEnvelope({channel:"email",history,customer_id:source.customer_id,request_id:"canary_"+id.replaceAll("-",""),request:"Answer this email for comparison ONLY; do not send messages or claim to have sent anything. Subject: "+String(source.subject||"").slice(0,200)+"\nMessage: "+body})),signal:AbortSignal.timeout(110000)});
  const payload=await result.json().catch(()=>({}));
  const outcome=emailCandidateOutcome(result.ok,payload);
  if(!outcome.candidate)throw Error("runtime_http_"+result.status);
  const candidate=outcome.candidate.slice(0,12000);
  const baseline=String(d.body_text);
  const comparison={candidate_present:candidate.length>0,baseline_present:baseline.length>0,candidate_claims_send:/\b(i (have|'ve) (sent|emailed|forwarded)|email (has been|was) sent)\b/i.test(candidate),baseline_length:baseline.length,candidate_length:candidate.length,model:payload.model,tools_used:payload.tools_used||[],live_send:false,decision:"review_required"};
  const status=outcome.ready?"candidate_ready":"failed";
  const saved=await db.from("sandy_email_runtime_canary").update({status,candidate_excerpt:candidate.slice(0,2500),agent_task_id:payload.task_id,comparison:{...comparison,...outcome.completion,candidate_ready:outcome.ready},...(!outcome.ready?{error:"runtime_candidate_not_complete"}:{})}).eq("source_message_id",id);
  if(saved.error)throw Error("save_"+saved.error.code);
  return reply(200,{ok:true,status,source_message_id:id,candidate_ready:outcome.ready,...outcome.completion,decision:"review_required",sent:false});
 }catch(e){
  await db.from("sandy_email_runtime_canary").update({status:"failed",error:String(e).slice(0,240)}).eq("source_message_id",id);
  return reply(502,{error:"canary failed",source_message_id:id});
 }
});
