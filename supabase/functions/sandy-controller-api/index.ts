import { uuid } from "./uuid.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const auth=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{auth:{persistSession:false}});
const H={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"https://ausstyle.github.io","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"authorization,content-type,apikey","vary":"Origin","x-content-type-options":"nosniff"};
const json=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:H});
async function rows(table:string,columns:string,limit=250){const {data,error}=await db.from(table).select(columns).limit(limit);if(error)throw Error(table+":"+error.code);return data||[]}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
 if(req.method!=="POST")return json(405,{error:"method_not_allowed"});
 try{
 const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!jwt)return json(401,{error:"sign_in_required"});
 const {data:{user},error}=await auth.auth.getUser(jwt);if(error||!user?.email_confirmed_at)return json(401,{error:"authentication_required"});
 const {data:admin}=await db.from("sandy_controller_admins").select("role,enabled").eq("auth_user_id",user.id).maybeSingle();
 if(!admin?.enabled)return json(403,{error:"operator_access_required"});
 const body=await req.json().catch(()=>({}));const op=String(body.op||"overview");
 if(op==="context_audit"){
  const [requests,retrievals,policies,grants]=await Promise.all([
    db.from("sandy_openai_request_audit").select("id,created_at,source_channel,source_reference,capability,model,decision,violations,context_manifest,rejected_manifest,request_chars,request_id,provider_response_id,execution_status,verified_success").order("created_at",{ascending:false}).limit(150),
    db.from("sandy_context_retrieval_audit").select("id,created_at,operation,decision,reason,result_count,bytes_returned,returned_refs").order("created_at",{ascending:false}).limit(100),
    db.from("sandy_openai_context_policies").select("capability,max_context_chars,enabled,updated_at").order("capability"),
    db.from("sandy_context_api_grants").select("id",{count:"exact",head:true}).eq("active",true)
  ]);
  if(requests.error||retrievals.error||policies.error||grants.error)return json(503,{error:"context_audit_unavailable"});
  const items=requests.data||[],retrievalItems=retrievals.data||[];
  return json(200,{ok:true,requests:items,retrievals:retrievalItems,policies:policies.data||[],active_grants:grants.count||0,summary:{sample_requests:items.length,blocked:items.filter((x:any)=>x.decision==="blocked").length,allowed:items.filter((x:any)=>x.decision==="allowed").length,context_violations:items.filter((x:any)=>(x.violations||[]).length).length,retrieval_calls:retrievalItems.length},limitations:["Only instrumented calls appear here.","No raw prompts or full customer biography are exposed.","Missing requests must not be interpreted as policy compliance."]});
 }
 if(op==="deployment_approvals"){
  const {data:jobs,error:e}=await db.from("sandy_deployment_jobs").select("id,provider,operation,target,status,created_at,approved_at,engineering_change_id,payload,error").order("created_at",{ascending:false}).limit(100);
  if(e)return json(503,{error:"deployment_jobs_unavailable"});
  return json(200,{ok:true,jobs:jobs||[],write_execution_enabled:false});
 }
 if(op==="deployment_approve"){
  if(admin.role!=="owner")return json(403,{error:"owner_approval_required"});
  const id=String(body.job_id||"");
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))return json(400,{error:"invalid_job_id"});
  const {data:job,error:je}=await db.from("sandy_deployment_jobs").select("id,provider,operation,status,engineering_change_id").eq("id",id).maybeSingle();
  if(je||!job)return json(404,{error:"deployment_not_found"});
  if(job.status!=="pending_approval")return json(409,{error:"job_not_pending"});
  if(!job.engineering_change_id)return json(409,{error:"engineering_change_required"});
  const {data:change}=await db.from("sandy_engineering_changes").select("status").eq("id",job.engineering_change_id).maybeSingle();
  if(change?.status!=="approved")return json(409,{error:"engineering_change_not_approved"});
  const {data:approved,error:ae}=await db.from("sandy_deployment_jobs").update({status:"approved",approved_by:user.id,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id).eq("status","pending_approval").select("id,status").maybeSingle();
  if(ae)return json(503,{error:"deployment_approval_failed",code:ae.code});
  if(!approved)return json(409,{error:"approval_state_changed"});
  await db.from("sandy_deployment_events").insert({job_id:id,event_type:"approved",actor:user.id,details:{source:"controller",execution_started:false}});
  return json(200,{ok:true,job:approved,execution_started:false,notice:"Approved. Supabase deployment executor is not enabled."});
 }
 if(op==="overview"){
 const datasets=await Promise.all([
 rows("email_customers","id,display_name,created_at",500),
 rows("email_messages","id,customer_id,created_at",2500),
 rows("sandy_whatsapp_messages","id,direction,created_at,processing_status",2500),
 rows("sandy_voice_call_sessions","id,owner_customer_id,created_at,state,error_code",1000),
 rows("sandy_qa_cases","id,test_key,subject,status,findings,fix_description,next_action,updated_at",1000),
 rows("sandy_feature_roadmap","feature_key,feature_title,progress,phase,priority_order,acceptance_criteria,updated_at",1000),
 rows("sandy_improvement_proposals","id,scope,category,failure_description,status,created_at",300),
 rows("sandy_ai_integration_inventory_v2","integration_key,provider,product,capability,deployment_status,enabled,last_verified_at,last_error,updated_at,rollout_status,verification_evidence,next_action,operational_state",300),
 rows("sandy_memory_portal_errors","id,source,operation,error_code,created_at",300),
 rows("sandy_capability_catalog","feature_key,description,channels,last_verified_at,verification_note",300),
 rows("sandy_knowledge_health_snapshots","checked_at,documents,searchable_documents,failed_documents,failed_jobs",1),
 rows("sandy_qa_message_reviews","message_id,weighted_score,verdict,reviewed_at",1500),
 rows("sandy_qa_provider_evals","eval_id,name,latest_run_id,latest_run_status,latest_run_at,last_synced_at,sync_error,evidence",50),
 rows("sandy_operational_tool_registry","tool_key,name,capability,enabled,deployment_status,last_verified_at,readiness,policy",100),
 rows("sandy_module_status","module_key,module_name,module_group,deployed_version,deployment_state,operational_status,remaining_steps,evidence,last_tested_at,observed_at,updated_at",300),
 rows("sandy_master_modules","module_key,module_name,description,component_patterns,sort_order,acceptance_requirements",50)
 ]);
 const [customers,email,whatsapp,voice,qa,roadmap,proposals,integrations,errors,capabilities,health,quality,providerEvals,toolRegistry,moduleStatuses,masterModules]=datasets;
 const metrics={customers:customers.length,email_sample:email.length,whatsapp_sample:whatsapp.length,voice_sample:voice.length,qa_cases:qa.length,roadmap_items:roadmap.length,memory_error_sample:errors.length,qa_review_sample:quality.length};
 const latest=await Promise.all([
  db.from("email_messages").select("*",{count:"exact",head:true}),
  db.from("sandy_qa_cases").select("*",{count:"exact",head:true}),
  db.from("sandy_feature_roadmap").select("*",{count:"exact",head:true})
 ]);
 const verifiedTotals={email_messages:latest[0].error?null:latest[0].count,qa_cases:latest[1].error?null:latest[1].count,roadmap:latest[2].error?null:latest[2].count};
 const qaSummary={passed:qa.filter((x:any)=>x.status==="passed").length,failed:qa.filter((x:any)=>x.status==="failed").length,retest_pending:qa.filter((x:any)=>x.status==="retest_pending").length,other:qa.filter((x:any)=>!["passed","failed","retest_pending"].includes(x.status)).length};
 const activity=customers.map((c:any)=>({id:c.id,name:c.display_name||"Unnamed client",email:email.filter((m:any)=>m.customer_id===c.id).length,voice:voice.filter((v:any)=>v.owner_customer_id===c.id).length,joined:c.created_at})).sort((a:any,b:any)=>(b.email+b.voice)-(a.email+a.voice));
 return json(200,{ok:true,role:admin.role,generated_at:new Date().toISOString(),metrics,verifiedTotals,qaSummary,activity,qa,providerEvals,toolRegistry,roadmap,proposals,integrations,errors,capabilities,moduleStatuses,masterModules,health:health[0]||null,channel_activity:whatsapp.map((m:any)=>({created_at:m.created_at,direction:m.direction,processing_status:m.processing_status})),architecture:[["Clients","Email / WhatsApp / Voice / Web"],["Channels","Graph / Meta / OpenAI Realtime"],["Runtime","Supabase Edge Functions"],["Knowledge","PostgreSQL + knowledge chunks"],["Operations","QA / Roadmap / Tasks"],["Storage","Drive / local desktop"],["AI","OpenAI routing / models"]]});
 }

 if(op==="examiner_v31_efficiency"){
 const [triage,queue]=await Promise.all([
 db.from("sandy_examiner_v31_triage").select("decision,fingerprint,duplicate_count"),
 db.from("sandy_examiner_v31_escalation_queue").select("decision,fingerprint,duplicate_count").limit(500)
 ]);
 if(triage.error||queue.error)return json(503,{error:"examiner_efficiency_unavailable"});
 const counts:any={};for(const x of triage.data||[])counts[x.decision]=(counts[x.decision]||0)+1;
 const queued:any={};for(const x of queue.data||[])queued[x.decision]=(queued[x.decision]||0)+1;
 return json(200,{ok:true,mode:"evidence_first",model_calls_for_triage:0,records_triaged:(triage.data||[]).length,decisions:counts,deduplicated_cases:queued,distinct_fault_signatures:(queue.data||[]).length,queue_is_advisory:true});
 }
 if(op==="examiner_v3_acceptance"){
  const {data,error}=await db.from("sandy_examiner_v3_acceptance_results").select("test_key,investigation_run_key,passed,checks,checked_at").order("checked_at",{ascending:false}).limit(20);
  if(error)return json(503,{error:"v3_acceptance_unavailable"});
  return json(200,{ok:true,items:data||[]});
 }
 if(op==="examiner_v3_results"){
  const {data,error}=await db.from("sandy_examiner_v3_investigations").select("run_key,channel,source_id,status,created_at,completed_at,error,assessment,challenge,tool_calls,evidence").order("created_at",{ascending:false}).limit(40);
  if(error)return json(503,{error:"examiner_v3_results_unavailable",code:error.code});
  return json(200,{ok:true,version:3,active:true,investigations:data||[],fallback:"V2 stays available",production_ready:(data||[]).some((x:any)=>x.status==="complete")});
 }
 if(op==="examiner_v3_run"){
  if(admin.role==="viewer")return json(403,{error:"read_only"});
  const channel=String(body.channel||""),source_id=String(body.source_id||"");
  if(!["email","whatsapp"].includes(channel)||!/^[-a-zA-Z0-9]{1,90}$/.test(source_id))return json(400,{error:"invalid_target"});
  const {data:lab,error:le}=await db.from("sandy_examiner_lab_accounts").select("customer_id").eq("id",1).maybeSingle();
  if(le||!lab?.customer_id)return json(409,{error:"test_account_unavailable"});
  if(channel==="email"){
   const {data:msg,error:me}=await db.from("email_messages").select("customer_id").eq("id",source_id).maybeSingle();
   if(me||msg?.customer_id!==lab.customer_id)return json(403,{error:"target_not_in_test_account"});
  }
  const token=Deno.env.get("SANDY_META_CRON_TOKEN");
  // Invoke privately with the service-role credential; never expose secrets to the UI.
  const rsp=await fetch(Deno.env.get("SUPABASE_URL")+"/functions/v1/sandy-examiner-v3-investigator",{method:"POST",headers:{"authorization":"Bearer "+Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),"content-type":"application/json"},body:JSON.stringify({channel,source_id,customer_id:channel==="email"?lab.customer_id:null}),signal:AbortSignal.timeout(125000)});
  const data=await rsp.json().catch(()=>({}));
  return json(rsp.status,{...data,http_status:rsp.status});
 }
 if(op==="examiner_production_run"){
 if(admin.role==="viewer")return json(403,{error:"read_only"});
 if(Object.keys(body).some(k=>k!=="op"))return json(400,{error:"unexpected_parameters"});
 const {data:lab,error:le}=await db.from("sandy_examiner_lab_accounts").select("customer_id,expected_email").eq("id",1).maybeSingle();
 if(le||lab?.expected_email!=="sandyemail.ai@gmail.com")return json(409,{error:"production_identity_not_verified"});
 const {data:identity,error:ie}=await db.from("email_customer_addresses").select("customer_id").eq("normalized_email",lab.expected_email).eq("customer_id",lab.customer_id).limit(1);
 if(ie||!identity?.length)return json(409,{error:"production_identity_mismatch"});
 const {data:running,error:busy}=await db.from("sandy_v2_qa_runs").select("run_key,started_at").like("run_key","production:%").eq("status","running").order("started_at",{ascending:false}).limit(1);
 if(busy)return json(503,{error:"examiner_run_status_unavailable"});
 if(running?.length&&Date.now()-Date.parse(running[0].started_at)<45*60*1000)return json(409,{error:"full_examiner_already_running",run_key:running[0].run_key});
 const runKey="production:"+crypto.randomUUID();
 const {error:reserved}=await db.from("sandy_v2_qa_runs").insert({run_key:runKey,status:"running",selection_audit:{mode:"mandatory_full_cycle_v2",account:"sandyemail.ai@gmail.com",minimum_tests:10}});
 if(reserved)return json(503,{error:"full_examiner_reservation_failed"});
 try{
 const rsp=await fetch(Deno.env.get("SUPABASE_URL")+"/functions/v1/sandy-examiner-full-cycle",{method:"POST",headers:{"authorization":"Bearer "+Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),"content-type":"application/json"},body:JSON.stringify({run_key:runKey,customer_id:lab.customer_id}),signal:AbortSignal.timeout(15000)});
 const ack=await rsp.json().catch(()=>({}));
 if(rsp.status!==202){await db.from("sandy_v2_qa_runs").update({status:"failed",completed_at:new Date().toISOString(),selection_audit:{mode:"mandatory_full_cycle_v2",reason:"worker_rejected",worker_status:rsp.status}}).eq("run_key",runKey);return json(503,{error:"full_examiner_worker_rejected",run_key:runKey})}
 return json(202,{ok:true,run_key:runKey,status:"running",mode:"mandatory_full_cycle_v2",minimum_tests:10,review_channels:["web","whatsapp","email","voice"]});
 }catch(e){await db.from("sandy_v2_qa_runs").update({status:"failed",completed_at:new Date().toISOString(),selection_audit:{mode:"mandatory_full_cycle_v2",reason:"worker_unreachable"}}).eq("run_key",runKey);return json(503,{error:"full_examiner_worker_unreachable",run_key:runKey})}
 }
 if(op==="examiner_production_account"){
  const [lab,identity,receipts,connections]=await Promise.all([
    db.from("sandy_examiner_lab_accounts").select("customer_id,expected_email,connection_status,verified_at").eq("id",1).maybeSingle(),
    db.from("email_customer_addresses").select("customer_id").eq("normalized_email","sandyemail.ai@gmail.com").limit(1),
    db.from("sandy_examiner_lab_run_receipts").select("run_key,created_at,overall_status,provider_verified,gmail_read_ok,drive_read_ok,calendar_read_ok,runtime_checks").order("created_at",{ascending:false}).limit(30),
    db.from("sandy_composio_connections").select("customer_id,toolkit_slug,status").in("status",["ACTIVE","EXPIRED","INITIATED"]).limit(100)
  ]);
  if([lab,identity,receipts,connections].some(x=>x.error))return json(503,{error:"production_account_assurance_unavailable"});
  if(lab.data?.expected_email!=="sandyemail.ai@gmail.com"||!identity.data?.some((x:any)=>x.customer_id===lab.data.customer_id))return json(409,{error:"production_account_identity_mismatch"});
  const own=(connections.data||[]).filter((x:any)=>x.customer_id===lab.data.customer_id);
  return json(200,{ok:true,account:"sandyemail.ai@gmail.com",connection_state:lab.data.connection_status,verified_at:lab.data.verified_at,services:own.reduce((a:any,x:any)=>{const label=x.toolkit_slug;a[label]??={active:0,expired:0,initiated:0};const k=String(x.status).toLowerCase();if(k in a[label])a[label][k]++;return a},{}),runs:receipts.data||[],generated_at:new Date().toISOString()});
 }

 if(op==="examiner_readable_report"){
  const runKey=String(body.run_key||"").slice(0,160);
  if(!runKey)return json(400,{error:"run_key_required"});
  const [tests,production,meta]=await Promise.all([
   db.from("sandy_examiner_audit_v2").select("case_key,question,reply,verdict,reason,ai_review,created_at,edge_status").eq("run_key",runKey).order("created_at",{ascending:true}).limit(500),
   db.from("sandy_examiner_live_reviews").select("id,channel,source_id,source_at,verdict,reason,judge_evidence").eq("run_key",runKey).order("source_at",{ascending:true}).limit(500),
   db.from("sandy_examiner_unified_runs").select("*").eq("run_key",runKey).maybeSingle()
  ]);
  if(tests.error||production.error||meta.error)return json(503,{error:"examiner_report_unavailable"});
  const cases=(tests.data||[]).map((x:any)=>({question:x.question,answer:x.reply,score:typeof x.ai_review?.score==="number"?x.ai_review.score:null,verdict:x.verdict,reason:x.reason,asked_at:x.created_at,case_key:x.case_key,http_status:x.edge_status}));
  const history:any[]=[];
  for(const x of production.data||[]){
   let question:null|string=null,answer:null|string=null;
   if(x.channel==="web"){
    const {data}=await db.from("sandy_web_turns").select("question,response").eq("id",x.source_id).maybeSingle();
    question=data?.question||null;answer=data?.response||null;
   }else if(x.channel==="voice"){
    const {data}=await db.from("sandy_voice_transcript_turns").select("session_id,role,text,created_at").eq("id",x.source_id).maybeSingle();
    question=data?.text||null;
    if(data?.session_id){
     const {data:replies}=await db.from("sandy_voice_transcript_turns").select("text,role").eq("session_id",data.session_id).gt("created_at",data.created_at).order("created_at",{ascending:true}).limit(15);
     answer=(replies||[]).find((v:any)=>["assistant","sandy"].includes(v.role))?.text||null;
    }
   }else if(x.channel==="email"){
    const {data}=await db.from("email_messages").select("conversation_id,subject,body_text,created_at").eq("id",x.source_id).maybeSingle();
    question=[data?.subject,data?.body_text].filter(Boolean).join("\n")||null;
    if(data?.conversation_id){
     const {data:replies}=await db.from("email_messages").select("body_text,direction").eq("conversation_id",data.conversation_id).gt("created_at",data.created_at).order("created_at",{ascending:true}).limit(15);
     answer=(replies||[]).find((v:any)=>["outbound","outgoing","out"].includes(v.direction))?.body_text||null;
    }
   }else if(x.channel==="whatsapp"){
    const {data}=await db.from("sandy_whatsapp_messages").select("body,sender_wa_id,created_at").eq("id",x.source_id).maybeSingle();
    question=data?.body||null;
    if(data?.sender_wa_id){
     const {data:replies}=await db.from("sandy_whatsapp_messages").select("body,direction,created_at").eq("sender_wa_id",data.sender_wa_id).gt("created_at",data.created_at).order("created_at",{ascending:true}).limit(12);
     const stop=(replies||[]).findIndex((v:any)=>v.direction==="inbound");
     answer=(stop<0?(replies||[]):(replies||[]).slice(0,stop)).find((v:any)=>v.direction==="outbound"&&Date.parse(v.created_at)-Date.parse(data.created_at)<180000)?.body||null;
    }
   }
   history.push({channel:x.channel,source_at:x.source_at,question,answer,quality_score:typeof x.judge_evidence?.quality_score==="number"?x.judge_evidence.quality_score:null,verdict:x.verdict,reason:x.judge_evidence?.reason_summary||x.reason,evidence_status:x.judge_evidence?.status||"unavailable"});
  }
  const threadQuery=await db.from("sandy_examiner_thread_reviews").select("channel,thread_key,customer_id,message_count,messages,assessment,verdict,quality_score,first_message_at,last_message_at").eq("run_key",runKey).order("last_message_at",{ascending:true}).limit(500);
  if(threadQuery.error)return json(503,{error:"thread_results_unavailable"});
  const threads=(threadQuery.data||[]).map((t:any)=>({channel:t.channel,thread_key:t.thread_key,message_count:t.message_count,first_message_at:t.first_message_at,last_message_at:t.last_message_at,customer_objective:t.assessment?.customer_objective||null,outcome:t.assessment?.outcome||"unverifiable",quality_score:t.quality_score,verdict:t.verdict,explanation:t.assessment?.explanation||"Evidence insufficient",dimensions:t.assessment?.dimensions||{},findings:t.assessment?.findings||[],messages:t.messages||[]}));
  const allScores=[...cases.map((c:any)=>c.score),...history.map((h:any)=>h.quality_score)].filter((n:any)=>typeof n==="number");
  return json(200,{ok:true,run_key:runKey,run:meta.data||null,generated_tests:cases,production_threads:threads,production_history:history,summary:{tests:cases.length,production:threads.length,thread_reviews:threads.length,channels:{web:history.filter(x=>x.channel==="web").length,whatsapp:history.filter(x=>x.channel==="whatsapp").length,voice:history.filter(x=>x.channel==="voice").length,email:history.filter(x=>x.channel==="email").length},average_score:allScores.length?Math.round(allScores.reduce((a:number,b:number)=>a+b,0)/allScores.length*10)/10:null},limits:{per_category:500},generated_at:new Date().toISOString()});
 }
 if(op==="examiner_runs"){
  const limit=Math.min(100,Math.max(10,Number(body.limit)||50));
  const {data:items,error:e}=await db.from("sandy_examiner_unified_runs").select("*").order("started_at",{ascending:false}).limit(limit);
  if(e)return json(503,{error:"examiner_runs_unavailable"});
  const [audits,live,executions]=await Promise.all([
   db.from("sandy_examiner_audit_v2").select("run_key", {count:"exact",head:true}),
   db.from("sandy_examiner_live_reviews").select("id",{count:"exact",head:true}),
   db.from("sandy_v2_qa_executions").select("id",{count:"exact",head:true})
  ]);
  return json(200,{ok:true,items:items||[],totals:{audits:audits.count,production_reviews:live.count,executions:executions.count},generated_at:new Date().toISOString()});
 }
 if(op==="examiner_run_detail"){
  const run_key=String(body.run_key||"").slice(0,160);
  if(!run_key)return json(400,{error:"run_key_required"});
  const [audits,executions,reviews,live,design,assurance,threads]=await Promise.all([
   db.from("sandy_examiner_audit_v2").select("*").eq("run_key",run_key).order("created_at",{ascending:true}).limit(500),
   db.from("sandy_v2_qa_executions").select("id,run_key,case_key,request_id,question,reply,tool_trace,verdict,reason,edge_status,duration_ms,evidence,created_at").eq("run_key",run_key).order("created_at",{ascending:true}).limit(500),
   db.from("sandy_examiner_audit_reviews").select("*").order("reviewed_at",{ascending:false}).limit(500),
   db.from("sandy_examiner_live_reviews").select("*").eq("run_key",run_key).order("reviewed_at",{ascending:true}).limit(500),
   db.from("sandy_examiner_design_runs").select("*").eq("run_key",run_key).maybeSingle(),
   db.from("sandy_examiner_assurance_runs").select("*").eq("run_key",run_key).maybeSingle(),
   db.from("sandy_examiner_thread_reviews").select("channel,thread_key,message_count,messages,assessment,verdict,quality_score,first_message_at,last_message_at").eq("run_key",run_key).order("last_message_at",{ascending:true}).limit(500)
  ]);
  if([audits,executions,reviews,live,design,assurance,threads].some(x=>x.error))return json(503,{error:"examiner_detail_unavailable"});
  const ids=new Set((executions.data||[]).map((x:any)=>x.id));
  return json(200,{ok:true,run_key,audits:audits.data||[],executions:executions.data||[],independent_reviews:(reviews.data||[]).filter((x:any)=>ids.has(x.execution_id)),production_reviews:live.data||[],thread_reviews:threads.data||[],design:design.data||null,assurance:assurance.data||null,limits:{per_stream:500},generated_at:new Date().toISOString()});
 }
 if(op==="examiner_production"){
  const channel=String(body.channel||"all");
  const page=Math.min(1000,Math.max(0,Math.floor(Number(body.page)||0)));
  const limit=50;
  let q=db.from("sandy_examiner_live_reviews").select("id,channel,source_id,source_at,run_key,verdict,reason,judge_evidence,reviewed_at",{count:"exact"}).order("reviewed_at",{ascending:false}).range(page*limit,page*limit+limit-1);
  if(channel!=="all") {if(!["email","web","whatsapp","voice"].includes(channel))return json(400,{error:"invalid_channel"});q=q.eq("channel",channel);}
  const res=await q;
  if(res.error)return json(503,{error:"production_reviews_unavailable"});

  const items=(res.data||[]).map((x:any)=>({...x,original_question:null,actual_response:null,transcript_status:"not_recovered"}));
  await Promise.all(items.map(async (x:any)=>{
   try{
    if(x.channel==="web"){
      const r=await db.from("sandy_web_turns").select("question,response").eq("id",x.source_id).maybeSingle();
      if(r.data){x.original_question=r.data.question;x.actual_response=r.data.response;x.transcript_status="source_record";}
    }else if(x.channel==="whatsapp"&&/^\\d+$/.test(x.source_id)){
      const id=Number(x.source_id);
      const a=await db.from("sandy_whatsapp_messages").select("id,body,direction,sender_wa_id,created_at").eq("id",id).maybeSingle();
      if(a.data?.direction==="inbound"){
       x.original_question=a.data.body;
       const b=await db.from("sandy_whatsapp_messages").select("body,created_at").eq("direction","outbound").eq("sender_wa_id",a.data.sender_wa_id).gt("created_at",a.data.created_at).order("created_at",{ascending:true}).limit(1);
       const next=b.data?.[0];if(next&&Date.parse(next.created_at)-Date.parse(a.data.created_at)<300000)x.actual_response=next.body;
       x.transcript_status=x.actual_response?"chronological_match_unverified":"question_only";
      }
    }else if(x.channel==="email"&&/^[a-f0-9-]{36}$/i.test(x.source_id)){
      const a=await db.from("email_messages").select("id,body_text,subject,conversation_id,direction,created_at").eq("id",x.source_id).maybeSingle();
      if(a.data){x.original_question=a.data.body_text||a.data.subject;const b=await db.from("email_messages").select("body_text,created_at").eq("conversation_id",a.data.conversation_id).eq("direction","outbound").gt("created_at",a.data.created_at).order("created_at",{ascending:true}).limit(1);x.actual_response=b.data?.[0]?.body_text||null;x.transcript_status=x.actual_response?"same_thread_chronological_match_unverified":"question_only";}
    }else if(x.channel==="voice"&&/^[a-f0-9-]{36}$/i.test(x.source_id)){
      const a=await db.from("sandy_voice_transcript_turns").select("session_id,role,text,created_at").eq("id",x.source_id).maybeSingle();
      if(a.data){x.original_question=a.data.text;const b=await db.from("sandy_voice_transcript_turns").select("text,role").eq("session_id",a.data.session_id).gt("created_at",a.data.created_at).order("created_at",{ascending:true}).limit(2);x.actual_response=(b.data||[]).find((v:any)=>v.role!=="user")?.text||null;x.transcript_status=x.actual_response?"session_chronological_match_unverified":"question_only";}
    }
   }catch(_){}
  }));
  return json(200,{ok:true,items,count:res.count,limit,page,generated_at:new Date().toISOString()});
 }

 if(op==="supervisor_work"){
 const [jobs,outcomes]=await Promise.all([
 db.from("sandy_supervisor_improvement_jobs").select("id,finding_id,capability,phase,status,hypothesis,proposed_change,approval_required,updated_at").order("updated_at",{ascending:false}).limit(200),
 db.from("sandy_supervisor_outcomes").select("mission_task_id,requested_outcome,observed_outcome,verdict,updated_at").order("updated_at",{ascending:false}).limit(200)]);
 if(jobs.error||outcomes.error)return json(503,{error:"supervisor_work_unavailable"});
 return json(200,{ok:true,jobs:jobs.data||[],outcomes:outcomes.data||[]});
 }
 if(op==="supervisor_investigate"){
 if(admin.role==="viewer")return json(403,{error:"read_only"});
 const id=String(body.finding_id||"");if(!/^[a-f0-9-]{36}$/i.test(id))return json(400,{error:"invalid_finding"});
 const {data:f}=await db.from("sandy_supervisor_findings").select("id,category,subject,explanation,recommendation,evidence").eq("id",id).maybeSingle();
 if(!f)return json(404,{error:"finding_not_found"});
 const {data:job,error:je}=await db.from("sandy_supervisor_improvement_jobs").upsert({finding_id:id,capability:f.category,phase:"investigate",status:"proposed",hypothesis:f.explanation,proposed_change:f.recommendation,approval_required:true},{onConflict:"finding_id,capability",ignoreDuplicates:true}).select("id,status").maybeSingle();
 if(je)return json(503,{error:"investigation_queue_failed"});
 await db.from("sandy_controller_audit").insert({actor_user_id:user.id,action:"supervisor_investigation_created",target:id,detail:{job_id:job?.id||null}});
 return json(200,{ok:true,job});
 }
 if(op==="supervisor_job_update"){
  if(admin.role==="viewer")return json(403,{error:"read_only"});
  const id=String(body.id||""),status=String(body.status||"");
  const allowed=["investigating","proposal_ready","testing","verified","rejected","blocked"];
  if(!/^[a-f0-9-]{36}$/i.test(id)||!allowed.includes(status))return json(400,{error:"invalid_job_update"});
  const {data:current}=await db.from("sandy_supervisor_improvement_jobs").select("id,status,verification,proposed_change").eq("id",id).maybeSingle();
  if(!current)return json(404,{error:"job_not_found"});
  const verification=body.verification&&typeof body.verification==="object"?body.verification:{};
  if(status==="verified"&&(!verification.test_reference||!verification.observed_result||!verification.deployment_reference))return json(409,{error:"verification_evidence_required"});
  const patch:any={status,phase:status==="verified"?"complete":status==="testing"?"verify":status==="proposal_ready"?"propose":"investigate",updated_at:new Date().toISOString()};
  if(status==="verified")patch.verification={...verification,operator_verified_by:user.id,operator_verified_at:new Date().toISOString()};
  const {data:updated,error:ue}=await db.from("sandy_supervisor_improvement_jobs").update(patch).eq("id",id).select("id,status,phase").single();
  if(ue)return json(503,{error:"job_update_failed"});
  await db.from("sandy_controller_audit").insert({actor_user_id:user.id,action:"supervisor_job_update",target:id,detail:{previous_status:current.status,status,verification:status==="verified"?verification:null}});
  return json(200,{ok:true,job:updated});
 }
 if(op==="supervisor"){
  const [runs,missions,qa,findings,assessments,evaluations]=await Promise.all([
   db.from("sandy_mission_runs").select("id,mission_task_id,stage,state,error,created_at,updated_at").order("created_at",{ascending:false}).limit(250),
   db.from("sandy_tasks").select("id,title,status,updated_at,metadata").eq("metadata->>sandy_mission","true").order("updated_at",{ascending:false}).limit(150),
   db.from("sandy_qa_cases").select("id,subject,status,findings,next_action,updated_at").order("updated_at",{ascending:false}).limit(200),
   db.from("sandy_supervisor_findings").select("id,category,severity,state,subject,explanation,recommendation,detected_at,evidence").order("detected_at",{ascending:false}).limit(150),
   db.from("sandy_capability_assessments").select("capability_key,maturity,basis,evidence,assessed_at").limit(150),
   db.from("sandy_supervisor_evaluations").select("id,scenario,verdict,created_at").order("created_at",{ascending:false}).limit(60)
  ]);
  if([runs,missions,qa,findings,assessments,evaluations].some(x=>x.error))return json(503,{error:"supervisor_read_failed"});
  const failed=(runs.data||[]).filter((x:any)=>x.state==="failed");
  const stale=(missions.data||[]).filter((x:any)=>!["completed","cancelled"].includes(x.status)&&Date.now()-Date.parse(x.updated_at)>86400000);
  const poor=(qa.data||[]).filter((x:any)=>["failed","retest_pending"].includes(x.status));
  const derived=[...failed.map((x:any)=>({category:"Execution failure",subject:"Mission run "+x.id,detail:x.error||"No recorded error",source_id:x.mission_task_id})),...stale.map((x:any)=>({category:"Potentially stalled",subject:x.title,detail:"No updates within 24 hours",source_id:x.id})),...poor.map((x:any)=>({category:"QA needs verification",subject:x.subject,detail:x.findings||x.next_action||"Investigation needed",source_id:x.id}))];
  return json(200,{ok:true,generated_at:new Date().toISOString(),observations:derived.slice(0,120),findings:findings.data||[],assessments:assessments.data||[],evaluations:evaluations.data||[],metrics:{failed_runs:failed.length,stale_missions:stale.length,unresolved_qa:poor.length},limits:{runs:250,missions:150,qa:200},note:"Evidence-derived observations, not AI assessments of internal reasoning; sample limits apply."});
 }
 if(op==="mission_control"){
  const [m,run,questions,proposals]=await Promise.all([
   db.from("sandy_tasks").select("id,customer_id,title,status,priority,due_at,created_at,updated_at,metadata").eq("metadata->>sandy_mission","true").is("archived_at",null).order("created_at",{ascending:false}).limit(150),
   db.from("sandy_mission_runs").select("id,mission_task_id,stage,state,error,created_at,updated_at,result").order("created_at",{ascending:false}).limit(400),
   db.from("sandy_mission_questions").select("id,mission_task_id,status,created_at,reminder_sent_at").eq("status","open").limit(300),
   db.from("sandy_improvement_proposals").select("id,failure_description,status,category,created_at").order("created_at",{ascending:false}).limit(150)
  ]);
  if(m.error||run.error||questions.error||proposals.error)return json(503,{error:"mission_control_read_failed"});
  const missions=(m.data||[]).map((x:any)=>({...x,runs:(run.data||[]).filter((r:any)=>r.mission_task_id===x.id).slice(0,5),open_questions:(questions.data||[]).filter((q:any)=>q.mission_task_id===x.id).length}));
  const counts={missions:missions.length,blocked:missions.filter((x:any)=>["blocked","waiting"].includes(x.status)).length,needs_input:missions.filter((x:any)=>x.open_questions>0).length,failed_runs:(run.data||[]).filter((x:any)=>x.state==="failed").length,pending_improvements:(proposals.data||[]).filter((x:any)=>x.status!=="completed").length};
  return json(200,{ok:true,generated_at:new Date().toISOString(),counts,missions,runs:run.data||[],improvements:proposals.data||[],limits:{missions:150,runs:400,improvements:150},note:"Counts are from bounded recent records; not global exact totals."});
 }
 if(op==="mission_inspect"){
  const id=String(body.id||"");
  if(!/^[a-f0-9-]{36}$/i.test(id))return json(400,{error:"invalid_mission"});
  const [m,steps,runs,questions,decisions,events,products]=await Promise.all([
    db.from("sandy_tasks").select("id,customer_id,title,details,status,priority,due_at,metadata,created_at").eq("id",id).eq("metadata->>sandy_mission","true").maybeSingle(),
    db.from("sandy_tasks").select("id,title,status,metadata,created_at").eq("parent_task_id",id).order("created_at",{ascending:true}).limit(150),
    db.from("sandy_mission_runs").select("id,stage,state,error,created_at,updated_at,result").eq("mission_task_id",id).order("created_at",{ascending:false}).limit(100),
    db.from("sandy_mission_questions").select("id,question,status,created_at,answered_at").eq("mission_task_id",id).limit(100),
    db.from("sandy_mission_decisions").select("sequence,condition,on_yes,on_no,created_at").eq("mission_task_id",id).order("created_at",{ascending:false}).limit(100),
    db.from("sandy_task_events").select("event_type,actor,created_at,snapshot").eq("task_id",id).order("created_at",{ascending:false}).limit(150),
    db.from("sandy_mission_work_products").select("id,title,state,content_type,created_at").eq("mission_task_id",id).limit(100)
  ]);
  if(m.error||!m.data)return json(404,{error:"mission_not_found"});
  if([steps,runs,questions,decisions,events,products].some(x=>x.error))return json(503,{error:"mission_inspection_failed"});
  return json(200,{ok:true,mission:m.data,steps:steps.data||[],runs:runs.data||[],questions:questions.data||[],decisions:decisions.data||[],events:events.data||[],products:products.data||[]});
 }
 if(op==="activity"){
  const after=String(body.after||"").slice(0,50);
  const count=Math.min(100,Math.max(10,Number(body.limit)||50));
  let query=db.from("email_messages").select("id,customer_id,subject,direction,received_at,sent_at,delivery_status,created_at").order("created_at",{ascending:false}).limit(count);
  if(after&&Number.isFinite(Date.parse(after)))query=query.lt("created_at",new Date(after).toISOString());
  const result=await query;if(result.error)throw result.error;
  const ids=(result.data||[]).map((x:any)=>x.id);
  const [actions,generations]=await Promise.all([
   db.from("sandy_calendar_email_actions").select("source_message_id,status,details").in("source_message_id",ids.length?ids:["00000000-0000-0000-0000-000000000000"]),
   db.from("email_ai_generations").select("source_message_id,status,draft_message_id").in("source_message_id",ids.length?ids:["00000000-0000-0000-0000-000000000000"])
  ]);
  if(actions.error||generations.error)throw Error("activity_join_failed");
  const byAction=new Map((actions.data||[]).map((x:any)=>[x.source_message_id,x]));
  const byGeneration=new Map((generations.data||[]).map((x:any)=>[x.source_message_id,x]));
  return json(200,{ok:true,items:(result.data||[]).map((x:any)=>({...x,calendar_action:byAction.get(x.id)||null,generation:byGeneration.get(x.id)||null})),next_cursor:(result.data||[]).length===count?result.data[count-1].created_at:null});
 }
 if(op==="qa_update"){
 if(admin.role==="viewer")return json(403,{error:"read_only"});
 const id=String(body.id||""),status=String(body.status||"");
 if(!/^[a-f\d-]{36}$/i.test(id)||!["pending","needs_review","retest_pending","passed","failed","investigating"].includes(status))return json(400,{error:"invalid_update"});
 if(status==="passed"){const {data:prior}=await db.from("sandy_qa_cases").select("fix_description,deployed_version").eq("id",id).maybeSingle();if(!prior?.fix_description?.trim())return json(409,{error:"Record verified fix evidence before marking QA passed"});}
 const {data,error}=await db.from("sandy_qa_cases").update({status,updated_at:new Date().toISOString()}).eq("id",id).select("id,status").single();
 if(error)return json(400,{error:"qa_update_failed"});
 await db.from("sandy_controller_audit").insert({actor_user_id:user.id,action:"qa_update",target:id,detail:{status}});
 return json(200,{ok:true,item:data});
 }
 if(op==="self_tasks_list"){
  const {data:tasks,error}=await db.from("sandy_self_improvement_tasks").select("id,feature_key,title,description,notes,parent_task_id,priority,due_at,origin,status,decision_reason,created_at,updated_at").order("created_at").limit(1500);
  if(error)return json(503,{error:"self_tasks_read_failed"});
  return json(200,{tasks:tasks||[],read_only:admin.role==="viewer"});
 }
 if(op==="self_tasks_update"){
  if(admin.role==="viewer")return json(403,{error:"read_only"});
  const id=String(body.id||"");
  if(!uuid(id))return json(400,{error:"invalid_id"});
  const {data:before}=await db.from("sandy_self_improvement_tasks").select("status").eq("id",id).maybeSingle();
  if(!before)return json(404,{error:"task_not_found"});
  const changes:any={updated_at:new Date().toISOString()};
  if(body.notes!==undefined)changes.notes=String(body.notes||"").slice(0,12000);
  if(body.status!==undefined){
    if(!["intake","evaluating","approved","rejected","planned","in_progress","testing","deployed","blocked"].includes(body.status))return json(400,{error:"invalid_status"});
    changes.status=body.status;
    if(body.status==="rejected"){
      changes.decision_reason=String(body.decision_reason||"").trim();
      if(!changes.decision_reason)return json(400,{error:"rejection_reason_required"});
    }
  }
  const {error}=await db.from("sandy_self_improvement_tasks").update(changes).eq("id",id);
  if(error)return json(409,{error:error.message});
  await db.from("sandy_self_improvement_events").insert({task_id:id,actor:String(user.id),event_type:"updated",snapshot:{previous_status:before.status,changes}});
  return json(200,{ok:true});
 }
 if(op==="roadmap_update"){
 if(admin.role==="viewer")return json(403,{error:"read_only"});
 const key=String(body.key||""),progress=String(body.progress||"");
 if(key.length>160||!key||!["planned","partial","validated","in_progress","blocked","testing","completed","proposed","pending"].includes(progress))return json(400,{error:"invalid_update"});
 const {data,error}=await db.from("sandy_feature_roadmap").update({progress,updated_at:new Date().toISOString()}).eq("feature_key",key).select("feature_key,progress").single();
 if(error)return json(400,{error:"roadmap_update_failed"});
 await db.from("sandy_controller_audit").insert({actor_user_id:user.id,action:"roadmap_update",target:key,detail:{progress}});
 return json(200,{ok:true,item:data});
 }
 return json(400,{error:"unknown_operation"});
 }catch(e){console.error("sandy_controller_error",e instanceof Error?e.message:"unexpected");return json(500,{error:"controller_request_failed"})}
});