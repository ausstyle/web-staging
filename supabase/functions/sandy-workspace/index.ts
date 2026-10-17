
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
const url=Deno.env.get("SUPABASE_URL")||"";
const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const auth=createClient(url,"sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts",{auth:{persistSession:false,autoRefreshToken:false}});
const cors={"access-control-allow-origin":"https://ausstyle.github.io","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"authorization, content-type, apikey, x-client-info","vary":"Origin"};
function reply(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...cors}})}
const err=(msg:string,code=400)=>reply(code,{error:msg});
async function ownerFor(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token||token.length<30)return null;
 const {data,error}=await auth.auth.getUser(token);
 const user=data?.user;
 if(error||!user?.email||!user.email_confirmed_at)return null;
 const {data:a,error:ae}=await db.from("sandy_memory_portal_accounts").select("customer_id").eq("auth_user_id",user.id).is("revoked_at",null).maybeSingle();
 if(ae||!a)return null;
 const {data:m,error:me}=await db.from("email_customer_addresses").select("normalized_email").eq("customer_id",a.customer_id).eq("is_primary",true).maybeSingle();
 if(me||m?.normalized_email!==user.email.toLowerCase())return null;
 return {customer:a.customer_id as string,email:user.email as string};
}
async function counts(cid:string,waIds:string[]){
 const [email,voice,whatsapp,tasks]=await Promise.all([
  db.from("email_messages").select("id",{head:true,count:"exact"}).eq("customer_id",cid),
  db.from("sandy_voice_transcript_turns").select("id",{head:true,count:"exact"}).eq("owner_customer_id",cid),
  waIds.length?db.from("sandy_whatsapp_messages").select("id",{head:true,count:"exact"}).in("sender_wa_id",waIds).in("direction",["inbound","outbound"]):Promise.resolve({count:0,error:null}),
  db.from("sandy_tasks").select("id",{head:true,count:"exact"}).eq("customer_id",cid).is("archived_at",null).neq("status","completed")
 ]);
 if([email,voice,whatsapp,tasks].some(x=>x.error))throw Error("Unable to calculate activity counts");
 return {email:email.count||0,voice:voice.count||0,whatsapp:whatsapp.count||0,tasks:tasks.count||0};
}
async function waIdsFor(cid:string){
 const {data,error}=await db.from("sandy_whatsapp_identities").select("wa_id").eq("customer_id",cid).eq("verification_status","verified");
 if(error)throw Error("Unable to resolve linked WhatsApp identity");
 return (data||[]).map(x=>x.wa_id as string);
}
function txt(v:unknown,n=18000){return String(v??"").slice(0,n)}
const channels=["email","whatsapp","voice","web"];
async function history(cid:string,ids:string[],p:any){
 const channel=channels.includes(p.channel)?p.channel:"all";
 const q=String(p.query||"").trim().slice(0,180);
 const limit=Math.min(Math.max(Number(p.limit)||40,1),50);
 const cursor=(p.cursor&&typeof p.cursor==="object")?p.cursor:{};
 const offset=Number.isInteger(cursor.offset)&&cursor.offset>=0&&cursor.offset<=100000?cursor.offset:0;
 const cutoff=typeof cursor.cutoff==="string"&&!Number.isNaN(Date.parse(cursor.cutoff))?new Date(cursor.cutoff).toISOString():new Date().toISOString();
 const {data,error}=await db.rpc("sandy_workspace_conversation_history_v2",{
  p_customer_id:cid,p_wa_ids:ids,p_channel:channel,p_search:q,
  p_limit:limit,p_offset:offset,p_cutoff:cutoff,
  p_whatsapp_view:p.whatsapp_view==="timeline"?"timeline":"topics"
 });
 if(error||!data||!Array.isArray(data.items))throw Error("Conversation history unavailable");
 return {items:data.items,total:data.total,counts:data.counts,
  next_cursor:offset+data.items.length<Number(data.total||0)?{offset:offset+data.items.length,cutoff}:null};
}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return err("Method not allowed",405);
 try{
  const owner=await ownerFor(req);if(!owner)return err("Sign in with your verified Sandy account.",401);
  let input:any={};try{input=await req.json()}catch{return err("Invalid JSON")}
  const action=new URL(req.url).searchParams.get("action")||"overview";
  const ids=await waIdsFor(owner.customer);
  if(action==="overview"){
   const [c,customer,conversations]=await Promise.all([
    counts(owner.customer,ids),
    db.from("email_customers").select("display_name").eq("id",owner.customer).maybeSingle(),
    db.rpc("sandy_workspace_conversation_history_v2",{p_customer_id:owner.customer,p_wa_ids:ids,p_channel:"all",p_search:"",p_limit:1,p_offset:0})
   ]);
   if(conversations.error||!conversations.data?.counts)throw Error("Conversation counts unavailable");
   return reply(200,{ok:true,name:customer.data?.display_name||owner.email,email:owner.email,counts:c,conversation_counts:conversations.data.counts});
  }
  if(action==="command_centre"){
    const {data,error}=await db.from("sandy_tasks").select("id,title,status,priority,due_at,parent_task_id,metadata,updated_at").eq("customer_id",owner.customer).is("archived_at",null).neq("status","completed").order("due_at",{ascending:true,nullsFirst:false}).limit(300);
    if(error)return err("Command centre unavailable",503);
    const tasks=data||[];const now=Date.now(),seven=now+7*86400000;
    const approvals=tasks.filter((t:any)=>t.metadata?.approval_required===true||t.metadata?.assigned_to==="client"&&t.parent_task_id&&t.status!=="completed");
    const alerts=tasks.filter((t:any)=>t.due_at&&new Date(t.due_at).getTime()<seven);
    const working=tasks.filter((t:any)=>t.status==="in_progress"||t.metadata?.assigned_to==="sandy");
    return reply(200,{ok:true,counts:{open:tasks.length,approvals:approvals.length,alerts:alerts.length,working:working.length},approvals:approvals.slice(0,12),alerts:alerts.slice(0,12),working:working.slice(0,12),summary:"Information derived from current task records; no autonomous execution is implied."});
  }
  if(action==="global_search"){
    const query=txt(input.query,100).trim();if(query.length<2)return err("Enter at least two characters");
    const safe=query.replace(/[%,()]/g," ").trim();if(safe.length<2)return err("Search term too short");
    const [tasks,memory]=await Promise.all([
      db.from("sandy_tasks").select("id,title,status,details").eq("customer_id",owner.customer).is("archived_at",null).ilike("title","%"+safe+"%").limit(25),
      db.from("sandy_web_turns").select("question,response,created_at").eq("customer_id",owner.customer).ilike("question","%"+safe+"%").order("created_at",{ascending:false}).limit(15)
    ]);
    if(tasks.error||memory.error)return err("Search temporarily unavailable",503);
    return reply(200,{ok:true,results:[...(tasks.data||[]).map((t:any)=>({kind:"Task",title:t.title,detail:t.status,url:"../agenda/?tab=all"})),...(memory.data||[]).map((t:any)=>({kind:"Web chat",title:t.question,detail:txt(t.response,180),url:"../app/"}))],coverage:["Tasks","Web chat questions"],note:"Other sources are not yet indexed by this search."});
  }
  if(action==="mission_overview"){
   const {data,error}=await db.from("sandy_tasks").select("id,title,details,status,priority,due_at,created_at,updated_at,metadata").eq("customer_id",owner.customer).is("archived_at",null).is("parent_task_id",null).order("updated_at",{ascending:false}).limit(100);
   if(error)return err("Project overview unavailable",503);
   const missions=(data||[]).filter((t:any)=>t.metadata?.sandy_mission===true);
   const ids=missions.map((m:any)=>m.id);
   const children=ids.length?await db.from("sandy_tasks").select("id,parent_task_id,title,status,priority,metadata").eq("customer_id",owner.customer).in("parent_task_id",ids).is("archived_at",null):{data:[],error:null};
   if(children.error)return err("Mission milestones unavailable",503);
   const runs=ids.length?await db.from("sandy_mission_runs").select("id,mission_task_id,stage,state,error,created_at,updated_at,result").eq("customer_id",owner.customer).in("mission_task_id",ids).order("created_at",{ascending:false}).limit(150):{data:[],error:null};
   const events=ids.length?await db.from("sandy_task_events").select("task_id,event_type,actor,created_at,snapshot").eq("customer_id",owner.customer).in("task_id",ids).order("created_at",{ascending:false}).limit(150):{data:[],error:null};
   const products=ids.length?await db.from("sandy_mission_work_products").select("id,mission_task_id,milestone_task_id,title,content,content_type,state,created_at").eq("customer_id",owner.customer).in("mission_task_id",ids).order("created_at",{ascending:false}).limit(100):{data:[],error:null};
   if(runs.error||events.error||products.error)return err("Mission audit unavailable",503);
   return reply(200,{ok:true,missions:missions.map((m:any)=>({...m,milestones:(children.data||[]).filter((t:any)=>t.parent_task_id===m.id),runs:(runs.data||[]).filter((r:any)=>r.mission_task_id===m.id).slice(0,8),audit:(events.data||[]).filter((e:any)=>e.task_id===m.id).slice(0,12),work_products:(products.data||[]).filter((x:any)=>x.mission_task_id===m.id).slice(0,10)}))});
  }
  if(action==="mission_create"){
   const title=txt(input.title,240).trim(),objective=txt(input.objective,6000).trim();
   if(title.length<3||title.length>240||objective.length<10)return err("Provide a project title and an objective of at least 10 characters.");
   const {data:root,error}=await db.from("sandy_tasks").insert({customer_id:owner.customer,title,details:objective,status:"todo",priority:"normal",metadata:{sandy_mission:true,assigned_to:"sandy",mission_version:1,execution_state:"awaiting_plan",success_criteria:txt(input.success_criteria,2000),created_via:"client_workspace",autonomy:"approval_required_for_external_actions"}}).select("id").single();
   if(error||!root)return err("Could not create Sandy project",503);
   return reply(200,{ok:true,task_id:root.id,status:"awaiting_plan",message:"Project registered and assigned to Sandy for planning. External autonomous execution is not active; approval is required before external actions."});
  }
  if(action==="mission_file_prepare"){
    const id=txt(input.question_id,60),name=txt(input.filename,200).trim(),mime=txt(input.mime_type,100),size=Number(input.size_bytes);
    if(!/^[0-9a-f-]{36}$/i.test(id)||!name||!Number.isInteger(size)||size<1||size>20971520)return err("File must be 20 MB or smaller");
    const allowed=["application/pdf","image/png","image/jpeg","text/plain","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/msword","application/vnd.ms-excel"];
    if(!allowed.includes(mime))return err("Unsupported file type");
    const {data:q}=await db.from("sandy_mission_questions").select("id,mission_task_id,status").eq("id",id).eq("customer_id",owner.customer).maybeSingle();
    if(!q||q.status!=="open")return err("Question is no longer open",409);
    const fileId=crypto.randomUUID(),safeName=name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,100);
    const path=owner.customer+"/"+q.mission_task_id+"/"+id+"/"+fileId+"-"+safeName;
    const {data:signed,error:se}=await db.storage.from("sandy-task-artifacts").createSignedUploadUrl(path);
    if(se||!signed)return err("Could not prepare secure upload",503);
    const {error:ie}=await db.from("sandy_mission_question_files").insert({id:fileId,customer_id:owner.customer,question_id:id,mission_task_id:q.mission_task_id,storage_path:path,filename:name,mime_type:mime,size_bytes:size});
    if(ie)return err("Could not register attachment",503);
    return reply(200,{ok:true,file_id:fileId,path,token:signed.token});
  }
  if(action==="mission_file_confirm"){
    const id=txt(input.file_id,60);
    if(!/^[0-9a-f-]{36}$/i.test(id))return err("Invalid attachment");
    const {data:f}=await db.from("sandy_mission_question_files").select("*").eq("id",id).eq("customer_id",owner.customer).maybeSingle();
    if(!f)return err("Attachment unavailable",404);
    const {data:o,error:oe}=await db.from("storage.objects").select("id,metadata").eq("bucket_id","sandy-task-artifacts").eq("name",f.storage_path).maybeSingle();
    if(oe||!o)return err("Upload has not completed",409);
    const bytes=Number(o.metadata?.size||0);
    if(bytes!==f.size_bytes)return err("Uploaded size does not match",409);
    const {error:ue}=await db.from("sandy_mission_question_files").update({status:"ready"}).eq("id",id).eq("customer_id",owner.customer);
    if(ue)return err("Could not finalise attachment",503);
    return reply(200,{ok:true,file_id:id});
  }
  if(action==="mission_file_download"){
    const id=txt(input.file_id,60);
    const {data:f}=await db.from("sandy_mission_question_files").select("storage_path,filename").eq("id",id).eq("customer_id",owner.customer).eq("status","ready").maybeSingle();
    if(!f)return err("File unavailable",404);
    const {data:s,error:se}=await db.storage.from("sandy-task-artifacts").createSignedUrl(f.storage_path,120);
    if(se||!s)return err("File access temporarily unavailable",503);
    return reply(200,{ok:true,url:s.signedUrl,filename:f.filename});
  }
  if(action==="mission_questions"){
    const id=txt(input.task_id,60);
    if(!/^[0-9a-f-]{36}$/i.test(id))return err("Invalid project");
    const {data:mission}=await db.from("sandy_tasks").select("id,metadata").eq("id",id).eq("customer_id",owner.customer).maybeSingle();
    if(!mission||mission.metadata?.sandy_mission!==true)return err("Project unavailable",404);
    const [questions,decisions]=await Promise.all([
      db.from("sandy_mission_questions").select("id,question,answer,status,priority,created_at").eq("customer_id",owner.customer).eq("mission_task_id",id).order("created_at",{ascending:true}),
      db.from("sandy_mission_decisions").select("condition,on_yes,on_no,sequence").eq("customer_id",owner.customer).eq("mission_task_id",id).order("created_at",{ascending:false}).limit(30)
    ]);
    const files=await db.from("sandy_mission_question_files").select("id,question_id,filename,size_bytes,mime_type,status").eq("customer_id",owner.customer).eq("mission_task_id",id).eq("status","ready");
    if(questions.error||decisions.error||files.error)return err("Project questions unavailable",503);
    return reply(200,{ok:true,questions:questions.data||[],decisions:decisions.data||[],files:files.data||[]});
  }
  if(action==="mission_answer"){
    const id=txt(input.question_id,60),answer=txt(input.answer,6000).trim();
    if(!/^[0-9a-f-]{36}$/i.test(id)||answer.length<2)return err("Please enter an answer");
    const {data:q,error:qe}=await db.from("sandy_mission_questions").select("id,mission_task_id,status").eq("id",id).eq("customer_id",owner.customer).maybeSingle();
    if(qe||!q)return err("Question unavailable",404);
    if(q.status!=="open")return err("Question already resolved",409);
    const {error:ue}=await db.from("sandy_mission_questions").update({answer,status:"answered",answered_at:new Date().toISOString()}).eq("id",id).eq("customer_id",owner.customer).eq("status","open");
    if(ue)return err("Answer could not be saved",503);
    const {count:remainingCount,error:re}=await db.from("sandy_mission_questions").select("id",{count:"exact",head:true}).eq("customer_id",owner.customer).eq("mission_task_id",q.mission_task_id).eq("status","open");
    if(re)return err("Answer saved, but project status could not be checked",503);
    let replanning=false;
    if((remainingCount||0)===0){
      const {data:m}=await db.from("sandy_tasks").select("metadata").eq("id",q.mission_task_id).eq("customer_id",owner.customer).maybeSingle();
      if(m?.metadata?.execution_state==="awaiting_client_information"){
        const {error:me}=await db.from("sandy_tasks").update({metadata:{...m.metadata,execution_state:"awaiting_plan_revision"}}).eq("id",q.mission_task_id).eq("customer_id",owner.customer);
        if(!me){const {error:pe}=await db.from("sandy_mission_runs").insert({mission_task_id:q.mission_task_id,customer_id:owner.customer,stage:"plan",run_key:"answered:"+q.mission_task_id+":"+crypto.randomUUID()});replanning=!pe}
      }
    }
    await db.from("sandy_task_events").insert({customer_id:owner.customer,task_id:q.mission_task_id,event_type:"mission_question_answered",actor:"customer",snapshot:{question_id:id,replanning_queued:replanning}});
    return reply(200,{ok:true,remaining:remainingCount||0,replanning_queued:replanning});
  }
  if(action==="mission_review"){
   const id=txt(input.task_id,64),decision=txt(input.decision,30),feedback=txt(input.feedback,1500).trim();
   if(!/^[a-f0-9-]{36}$/i.test(id)||!["approve_plan","request_revision"].includes(decision))return err("Invalid mission review");
   if(decision==="request_revision"&&feedback.length<5)return err("Please explain the changes you want to the plan");
   const {data:m,error:me}=await db.from("sandy_tasks").select("id,metadata,status").eq("id",id).eq("customer_id",owner.customer).maybeSingle();
   if(me||!m||m.metadata?.sandy_mission!==true)return err("Mission not found",404);
   if(m.metadata?.execution_state!=="awaiting_client_plan_review")return err("No proposed plan awaiting review",409);
   const next=decision==="approve_plan"?"plan_approved_external_actions_still_gated":"awaiting_plan_revision";
   const {error}=await db.from("sandy_tasks").update({status:decision==="approve_plan"?"in_progress":"waiting",metadata:{...m.metadata,execution_state:next,plan_reviewed_at:new Date().toISOString(),plan_reviewed_by:owner.customer,revision_feedback:decision==="request_revision"?feedback:null}}).eq("id",id).eq("customer_id",owner.customer);
   if(error)return err("Could not save review",503);
   if(decision==="approve_plan"){const {error:qe}=await db.from("sandy_mission_runs").insert({mission_task_id:id,customer_id:owner.customer,stage:"execute",run_key:"execute:"+id+":initial"});if(qe&&qe.code!=="23505")return reply(503,{error:"Plan approved, but execution queue could not be started. Retry from Tasks.",task_id:id})}
   const {error:ee}=await db.from("sandy_task_events").insert({customer_id:owner.customer,task_id:id,event_type:decision==="approve_plan"?"mission_plan_approved":"mission_revision_requested",actor:"customer",snapshot:{decision,external_action_authorised:false}});
   if(ee)console.error("mission_review_audit_write",ee.code);
   if(decision==="request_revision"){const {error:qe}=await db.from("sandy_mission_runs").insert({mission_task_id:id,customer_id:owner.customer,stage:"plan",run_key:"revision:"+id+":"+crypto.randomUUID()});if(qe)return reply(503,{error:"Revision recorded but planner could not be queued. Use Retry in the mission.",code:qe.code})}
   return reply(200,{ok:true,status:next,external_actions_authorised:false,audit_recorded:!ee});
  }
  if(action==="mission_resume"){
   const id=txt(input.task_id,64);
   if(!/^[a-f0-9-]{36}$/i.test(id))return err("Invalid mission");
   const {data:m,error:me}=await db.from("sandy_tasks").select("id,metadata,status").eq("id",id).eq("customer_id",owner.customer).maybeSingle();
   if(me||!m||m.metadata?.sandy_mission!==true)return err("Mission not found",404);
   if(m.status==="completed"||m.status==="cancelled")return err("Mission is closed",409);
   const phase=String(m.metadata?.execution_state||"");
   const stage=["awaiting_plan","awaiting_plan_revision"].includes(phase)?"plan":phase==="plan_approved_external_actions_still_gated"?"execute":null;
   if(!stage)return err("Mission is awaiting a client review or requires manual support",409);
   const {data:recent,error:re}=await db.from("sandy_mission_runs").select("state,created_at").eq("customer_id",owner.customer).eq("mission_task_id",id).eq("stage",stage).in("state",["running","queued"]).order("created_at",{ascending:false}).limit(1);
   if(re)return err("Cannot check the execution queue",503);
   if(recent?.length)return reply(200,{ok:true,already_queued:true});
   const {error:qe}=await db.from("sandy_mission_runs").insert({mission_task_id:id,customer_id:owner.customer,stage,run_key:stage+":retry:"+id+":"+crypto.randomUUID()});
   if(qe)return err("Could not queue retry",503);
   return reply(200,{ok:true,stage,queued:true});
  }
  if(action==="mission_deliverable_review"){
    const id=txt(input.work_product_id,60),decision=txt(input.decision,30),feedback=txt(input.feedback,1500).trim();
    if(!/^[a-f0-9-]{36}$/i.test(id)||!["approve","revise"].includes(decision))return err("Invalid deliverable review");
    if(decision==="revise"&&feedback.length<5)return err("Explain what should change in this draft");
    const {data:p,error:pe}=await db.from("sandy_mission_work_products").select("id,mission_task_id,milestone_task_id,state").eq("id",id).eq("customer_id",owner.customer).maybeSingle();
    if(pe||!p)return err("Deliverable not found",404);
    if(p.state!=="pending_review")return err("Deliverable has already been reviewed",409);
    const state=decision==="approve"?"approved":"revision_requested";
    const {error:ue}=await db.from("sandy_mission_work_products").update({state,reviewed_at:new Date().toISOString()}).eq("id",id).eq("customer_id",owner.customer).eq("state","pending_review");
    if(ue)return err("Review could not be saved",503);
    const {data:milestone}=await db.from("sandy_tasks").select("metadata").eq("id",p.milestone_task_id).eq("customer_id",owner.customer).maybeSingle();
    const {error:te}=await db.from("sandy_tasks").update({status:decision==="approve"?"completed":"todo",metadata:{...(milestone?.metadata||{}),deliverable_review_state:state,revision_feedback:decision==="revise"?feedback:null}}).eq("id",p.milestone_task_id).eq("customer_id",owner.customer);
    if(te)return err("Review saved but milestone could not be updated; support required",503);
    await db.from("sandy_task_events").insert({customer_id:owner.customer,task_id:p.mission_task_id,event_type:"mission_deliverable_"+state,actor:"customer",snapshot:{work_product_id:id,milestone_task_id:p.milestone_task_id,revision_feedback:decision==="revise"?feedback:null,external_actions_performed:0}});
    const {data:requests}=await db.from("sandy_tasks").select("id").eq("customer_id",owner.customer).eq("parent_task_id",p.mission_task_id).eq("metadata->>work_product_id",id);
    if(requests?.length)await db.from("sandy_tasks").update({status:"completed"}).eq("customer_id",owner.customer).in("id",requests.map((x:any)=>x.id));
    const {error:qe}=await db.from("sandy_mission_runs").insert({mission_task_id:p.mission_task_id,customer_id:owner.customer,stage:"execute",run_key:"execute:"+p.mission_task_id+":"+crypto.randomUUID()});
    if(qe)return reply(503,{error:"Review saved; follow-up could not be queued",code:qe.code});
    return reply(200,{ok:true,state,follow_up_queued:true,external_actions_authorised:false});
  }
  if(action==="mission_request_client"){
   const parentId=txt(input.task_id,60),title=txt(input.title,240).trim();
   if(!/^[0-9a-f-]{36}$/i.test(parentId)||title.length<3)return err("Valid mission and request required");
   const {data:parent}=await db.from("sandy_tasks").select("id,metadata").eq("id",parentId).eq("customer_id",owner.customer).maybeSingle();
   if(!parent||parent.metadata?.sandy_mission!==true)return err("Mission unavailable",404);
   const {data,error}=await db.from("sandy_tasks").insert({customer_id:owner.customer,parent_task_id:parentId,title,status:"todo",priority:"high",details:txt(input.details,4000),metadata:{sandy_mission_step:true,assigned_to:"client",requested_by:"sandy",stage:"client_action"}}).select("id").single();
   if(error)return err("Could not create client action",503);
   return reply(200,{ok:true,task_id:data.id});
  }


  if(action==="topic_thread"){
   const id=typeof input.topic_id==="string"&&/^[0-9a-f-]{36}$/i.test(input.topic_id)?input.topic_id:null;
   if(!id)return err("Invalid topic",400);
   const {data:topic}=await db.from("sandy_cross_channel_topics").select("id,title").eq("customer_id",owner.customer).eq("id",id).maybeSingle();
   if(!topic)return err("Topic not found",404);
   const {data:links,error:le}=await db.from("sandy_cross_channel_topic_sources").select("source_key").eq("customer_id",owner.customer).eq("topic_id",id);
   if(le)return err("Topic messages unavailable",503);
   const keys=new Set((links||[]).map((x:any)=>x.source_key));
   const matches:any[]=[];
   for(let offset=0;offset<300;offset+=50){
    const {data,error}=await db.rpc("sandy_workspace_conversation_history_v2",{p_customer_id:owner.customer,p_wa_ids:ids,p_channel:"all",p_search:"",p_limit:50,p_offset:offset});
    if(error)return err("Topic history unavailable",503);
    for(const item of data?.items||[])if(keys.has(item.id))matches.push(item);
    if(!data?.items||data.items.length<50)break;
   }
   return reply(200,{ok:true,topic,conversations:matches.sort((a:any,b:any)=>String(a.at).localeCompare(String(b.at)))});
  }
  if(action==="topic_index"){
   const {data:existing,error:tex}=await db.from("sandy_cross_channel_topics").select("id,title,summary,updated_at").eq("customer_id",owner.customer).order("updated_at",{ascending:false}).limit(200);
   if(tex)return err("Topic index unavailable",503);
   const {data:links,error:lex}=await db.from("sandy_cross_channel_topic_sources").select("topic_id,source_key,channel").eq("customer_id",owner.customer).limit(1500);
   if(lex)return err("Topic links unavailable",503);
   const topics:any[]=existing||[],sources:any[]=links||[];
   if(input.refresh===true){
    const batches=await Promise.all([0,50,100].map(async offset=>{
     const x=await db.rpc("sandy_workspace_conversation_history_v2",{p_customer_id:owner.customer,p_wa_ids:ids,p_channel:"all",p_search:"",p_limit:50,p_offset:offset});
     return x.error?[]:(x.data?.items||[]);
    }));
    const candidates=batches.flat().slice(0,100);
    if(candidates.length){
     const key=Deno.env.get("OPENAI_API_KEY");
     if(!key)return reply(200,{ok:true,topics:topics.map((t:any)=>({...t,sources:sources.filter((z:any)=>z.topic_id===t.id)})),unclassified:candidates.length,classification:"unavailable"});
     const payload={model:"gpt-4o-mini",temperature:0,response_format:{type:"json_object"},messages:[
      {role:"system",content:"Group conversation threads by substantive underlying real-world topic or project across platforms. Reuse exactly matching existing topic titles for the same subject; otherwise provide precise, short neutral labels. Never merge unrelated matters solely due to common names or generic terms. Return JSON {assignments:[{id,topic}]} assigning every provided thread."},
      {role:"user",content:JSON.stringify({existing_topics:topics.map((t:any)=>t.title),threads:candidates.map((x:any)=>({id:x.id,title:String(x.title||"").slice(0,140),preview:String(x.preview||"").slice(0,350),channel:x.channel}))})}
     ]};
     const proposed=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(35000)});
     if(!proposed.ok)return err("Topic classification temporarily unavailable",503);
     let parsed:any={};try{const body=await proposed.json();parsed=JSON.parse(body.choices?.[0]?.message?.content||"{}")}catch{return err("Topic classification returned invalid data",503)}
     const assignment=Array.isArray(parsed.assignments)?parsed.assignments:[];
     const known=new Map(topics.map((t:any)=>[t.title.toLowerCase(),t.id]));
     for(const c of candidates){
      const a=assignment.find((v:any)=>v?.id===c.id),title=typeof a?.topic==="string"?a.topic.trim().slice(0,100):"";
      if(!title)continue;
      let id=known.get(title.toLowerCase());
      if(!id){const {data:made,error:me}=await db.from("sandy_cross_channel_topics").insert({customer_id:owner.customer,title}).select("id,title,summary,updated_at").single();if(me||!made)continue;id=made.id;topics.push(made);known.set(title.toLowerCase(),id)}
      const {error:linkError}=await db.from("sandy_cross_channel_topic_sources").upsert({customer_id:owner.customer,topic_id:id,source_key:c.id,channel:c.channel},{onConflict:"customer_id,source_key"});
      if(!linkError){const found=sources.find((z:any)=>z.source_key===c.id);if(found)found.topic_id=id;else sources.push({topic_id:id,source_key:c.id,channel:c.channel});}
     }
    }
   }
   return reply(200,{ok:true,topics:topics.map((t:any)=>({...t,sources:sources.filter((z:any)=>z.topic_id===t.id)})),classification:input.refresh===true?"requested":"cached"});
  }
  if(action==="web_conversations"){
   const {data,error}=await db.from("sandy_web_conversations").select("id,created_at,updated_at").eq("customer_id",owner.customer).order("updated_at",{ascending:false}).limit(150);
   if(error)return err("Web conversations unavailable",503);
   const records=await Promise.all((data||[]).map(async (c:any)=>{
    const {data:turn}=await db.from("sandy_web_turns").select("question,created_at").eq("customer_id",owner.customer).eq("conversation_id",c.id).order("created_at",{ascending:true}).limit(1);
    return {...c,title:turn?.[0]?.question?.slice(0,105)||"New conversation"};
   }));
   return reply(200,{ok:true,conversations:records});
  }
  if(action==="web_new_conversation"){
   const {data,error}=await db.from("sandy_web_conversations").insert({customer_id:owner.customer}).select("id").single();
   if(error||!data)return err("Could not start conversation",503);
   return reply(200,{ok:true,conversation_id:data.id});
  }
  if(action==="web_history"){
   const {data,error}=await db.from("sandy_web_conversations").select("id").eq("customer_id",owner.customer).order("updated_at",{ascending:false}).limit(1);
   if(error)return err("Chat history unavailable",503);
   const requested=typeof input.conversation_id==="string"&&/^[0-9a-f-]{36}$/i.test(input.conversation_id)?input.conversation_id:null;
   let conversationId=data?.[0]?.id||null;
   if(requested){
    const {data:owned,error:oe}=await db.from("sandy_web_conversations").select("id").eq("id",requested).eq("customer_id",owner.customer).maybeSingle();
    if(oe||!owned)return err("Conversation unavailable",404);
    conversationId=requested;
   }
   if(!conversationId)return reply(200,{ok:true,conversation_id:null,turns:[]});
   const {data:turns,error:te}=await db.from("sandy_web_turns").select("question,response,status,created_at").eq("customer_id",owner.customer).eq("conversation_id",conversationId).order("created_at",{ascending:true}).limit(100);
   if(te)return err("Chat history unavailable",503);
   return reply(200,{ok:true,conversation_id:conversationId,turns:turns||[]});
  }
  if(action==="ask"){
   const question=typeof input.question==="string"?input.question.trim():"";
   if(question.length<2||question.length>12000)return err("Question must be 2–12000 characters",400);
   const requestId=typeof input.request_id==="string"&&/^[a-zA-Z0-9_-]{12,110}$/.test(input.request_id)?input.request_id:null;
   if(!requestId)return err("A request ID is required",400);
   let conversationId=typeof input.conversation_id==="string"&&/^[0-9a-f-]{36}$/i.test(input.conversation_id)?input.conversation_id:null;
   if(conversationId){
    const {data:owned,error:oe}=await db.from("sandy_web_conversations").select("id").eq("id",conversationId).eq("customer_id",owner.customer).maybeSingle();
    if(oe||!owned)return err("Conversation unavailable",404);
   }else{
    const {data:existing,error:ee}=await db.from("sandy_web_conversations").select("id").eq("customer_id",owner.customer).order("updated_at",{ascending:false}).limit(1);
    if(ee)return err("Conversation unavailable",503);
    conversationId=existing?.[0]?.id||null;
    if(!conversationId){const {data:created,error:ce}=await db.from("sandy_web_conversations").insert({customer_id:owner.customer}).select("id").single();if(ce||!created)return err("Could not create conversation",503);conversationId=created.id;}
   }
   const {data:prior,error:pe}=await db.from("sandy_web_turns").select("question,response").eq("customer_id",owner.customer).eq("conversation_id",conversationId).eq("status","completed").order("created_at",{ascending:false}).limit(12);
   if(pe)return err("Conversation history unavailable",503);
   const {error:we}=await db.from("sandy_web_turns").insert({conversation_id:conversationId,customer_id:owner.customer,request_id:requestId,question,status:"pending"});
   if(we)return err(we.code==="23505"?"Question already submitted":"Could not save question",we.code==="23505"?409:503);
   if(/(?:feature request|improvement request)/i.test(question)&&/\\b(?:add|record|submit|log|create)\\b/i.test(question)){
    const recent=(prior||[]).slice(0,3).map((x:any)=>String(x.question||"")+" "+String(x.response||"")).join(" ");
    if(/\\b(?:website|browse|website images|external websites)\\b/i.test(recent)){
     const {data:match}=await db.from("sandy_incoming_task_requests").select("id,state").eq("recipient_kind","sandy").eq("title","Browse websites directly for image and design briefs").order("created_at",{ascending:false}).limit(1).maybeSingle();
     if(match){
      const answer=match.state==="approved"?"Already recorded and approved in Sandy's improvement system. Implementation is not yet verified.":"Already recorded in Sandy's improvement system; current request status: "+match.state+".";
      await db.from("sandy_web_turns").update({status:"completed",response:answer}).eq("request_id",requestId).eq("customer_id",owner.customer);
      return reply(200,{ok:true,response:answer,conversation_id:conversationId,channel:"web"});
     }
    }
   }
   const previous=(prior||[]).reverse().map((t:any)=>({user:t.question,assistant:t.response}));
   const result=await fetch(url+"/functions/v1/sandy-agent-runtime",{method:"POST",headers:{"authorization":"Bearer "+secret,"content-type":"application/json"},body:JSON.stringify({channel:"web",request_id:requestId,customer_id:owner.customer,request:question,conversation_id:conversationId,history:previous,timezone:typeof input.timezone==="string"?input.timezone:"UTC"}),signal:AbortSignal.timeout(120000)});
   const data=await result.json().catch(()=>({}));
   if(result.ok&&/\\b(?:feature request|improvement request|improvement list|your improvements)\\b/i.test(question)){
    const {data:turn}=await db.from("sandy_web_turns").select("id").eq("request_id",requestId).eq("customer_id",owner.customer).maybeSingle();
    if(turn){
     const {data:improve}=await db.from("sandy_improvement_requests").select("id").eq("request_source","web").eq("source_reference","web:"+turn.id).maybeSingle();
     if(improve){
      const {data:pending}=await db.from("sandy_incoming_task_requests").select("state,title").eq("source_kind","improvement_request").eq("source_key",improve.id).maybeSingle();
      if(pending)data.response="Recorded in Sandy’s improvement system: "+pending.title+". Status: "+pending.state.replaceAll("_"," ")+". No approved implementation is implied.";
     }else data.response="I could not verify that the improvement was saved. I will not claim it was added.";
    }
   }
   await db.from("sandy_web_turns").update({status:result.ok?"completed":"failed",response:result.ok?data.response:null}).eq("request_id",requestId).eq("customer_id",owner.customer);
   await db.from("sandy_web_conversations").update({updated_at:new Date().toISOString()}).eq("id",conversationId).eq("customer_id",owner.customer);
   if(!result.ok)return reply(result.status===409?409:502,{error:"Sandy could not complete your question",conversation_id:conversationId,task_id:data.task_id||null});
   return reply(200,{ok:true,response:data.response,task_id:data.task_id,model:data.model,channel:"web",conversation_id:conversationId});
  }
  if(action==="history"){
   const data=await history(owner.customer,ids,input);
   return reply(200,{ok:true,...data});
  }
  return err("Unknown action",404);
 }catch(e){console.error("sandy_workspace",String(e));return err("Unable to load Sandy workspace data",503)}
});
