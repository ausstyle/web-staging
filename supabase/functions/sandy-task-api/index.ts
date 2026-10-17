import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";

const url=Deno.env.get("SUPABASE_URL")||"";
const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const uuid=(x:any)=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const response=(code:number,data:any)=>new Response(JSON.stringify(data),{status:code,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
const fail=(msg:string,status=400)=>response(status,{ok:false,error:msg});
const good=(data:any)=>response(200,{ok:true,...data});
const norm=(x:any)=>typeof x==="string"?x.trim():"";
const statuses=["todo","in_progress","waiting","blocked","completed","cancelled"];
const priorities=["low","normal","high","urgent"];
function safeError(e:any){return String(e?.message||e||"Task action failed").slice(0,300)}
function dbcheck(res:any){if(res.error)throw Error(res.error.message||res.error.code||"Database error");return res.data}
function dateVal(v:any){if(v===null||v==="")return null;if(typeof v!=="string"||v.length>80)throw Error("Invalid date");const d=new Date(v);if(!Number.isFinite(d.getTime()))throw Error("Invalid date");return d.toISOString()}
function textVal(v:any,max:number,empty=true){if(typeof v!=="string"||v.length>max||(!empty&&!v.trim()))throw Error("Invalid text field");return v.trim()}
function isObject(x:any){return x!==null&&typeof x==="object"&&!Array.isArray(x)}
async function digest(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("")}
function secretMatch(a:string,b:string){const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);let diff=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]??0)^(y[i]??0);return diff===0}
async function sourceOwner(source:any){
 if(!isObject(source)||!["email","whatsapp","voice"].includes(source.channel)||typeof source.id!=="string"||source.id.length>200)return null;
 if(source.channel==="email"){
  if(!uuid(source.id))return null;
  const msg=dbcheck(await db.from("email_messages").select("customer_id").eq("id",source.id).eq("direction","incoming").maybeSingle());
  return msg?.customer_id?{id:msg.customer_id,channel:"email",source_id:source.id}:null;
 }
 if(source.channel==="whatsapp"){
  const msg=dbcheck(await db.from("sandy_whatsapp_messages").select("sender_wa_id").eq("meta_message_id",source.id).eq("direction","inbound").maybeSingle());
  if(!msg?.sender_wa_id)return null;
  const who=dbcheck(await db.from("sandy_whatsapp_identities").select("customer_id,verification_status,verified_at,allowed_scopes").eq("wa_id",msg.sender_wa_id).maybeSingle());
  if(!who?.customer_id||who.verification_status!=="verified"||!who.verified_at||Date.now()-Date.parse(who.verified_at)>90*86400000||Date.parse(who.verified_at)>Date.now()+60000||!(who.allowed_scopes||[]).includes("memory_read"))return null;
  return {id:who.customer_id,channel:"whatsapp",source_id:source.id};
 }
 if(!uuid(source.id))return null;
 const call=dbcheck(await db.from("sandy_voice_call_sessions").select("owner_customer_id").eq("id",source.id).maybeSingle());
 if(!call?.owner_customer_id)return null;
 const approved=dbcheck(await db.from("sandy_voice_private_auth").select("verified_at,owner_customer_id").eq("session_id",source.id).eq("owner_customer_id",call.owner_customer_id).not("verified_at","is",null).maybeSingle());
 if(!approved?.verified_at)return null;
 return {id:call.owner_customer_id,channel:"voice",source_id:source.id};
}
async function getTask(cid:string,p:any){
 let query=db.from("sandy_tasks").select("*").eq("customer_id",cid).is("archived_at",null);
 if(uuid(p.task_id))query=query.eq("id",p.task_id);
 else if(norm(p.match_title))query=query.ilike("title",norm(p.match_title).replaceAll("%","\u005c%").replaceAll("_","\u005c_"));
 else throw Error("Provide task_id or exact match_title. Read the task list before editing.");
 const rows=dbcheck(await query.limit(3));
 if(rows.length!==1)throw Error(rows.length===0?"Task not found in your account":"Ambiguous task title; specify task_id");
 return rows[0];
}
async function getCompany(cid:string,p:any,allowCreate=false){
 if(p.company_id===null)return null;
 if(p.company_id!==undefined){if(!uuid(p.company_id))throw Error("Invalid company_id");const found=dbcheck(await db.from("sandy_agenda_companies").select("id").eq("customer_id",cid).eq("id",p.company_id).maybeSingle());if(!found)throw Error("Company not found");return found.id}
 if(!norm(p.company_name))return undefined;
 const name=textVal(p.company_name,160,false);
 const existing=dbcheck(await db.from("sandy_agenda_companies").select("id").eq("customer_id",cid).ilike("name",name).limit(1));
 if(existing.length)return existing[0].id;
 if(!allowCreate)throw Error("Company not found");
 const row=await db.from("sandy_agenda_companies").insert({customer_id:cid,name}).select("id").single();
 if(row.error?.code==="23505"){const again=dbcheck(await db.from("sandy_agenda_companies").select("id").eq("customer_id",cid).ilike("name",name).limit(1));if(again.length)return again[0].id}
 return dbcheck(row).id;
}
function editable(p:any){
 const changes:any={};
 if(p.title!==undefined)changes.title=textVal(p.title,240,false);
 if(p.details!==undefined)changes.details=textVal(p.details,12000);
 if(p.priority!==undefined){if(!priorities.includes(p.priority))throw Error("Invalid priority");changes.priority=p.priority}
 if(p.status!==undefined){if(!statuses.includes(p.status))throw Error("Invalid status");changes.status=p.status}
 for(const field of ["due_at","start_at","next_review_at"])if(p[field]!==undefined)changes[field]=dateVal(p[field]);
 if(p.contact_name!==undefined)changes.contact_name=p.contact_name===null?null:textVal(p.contact_name,240);
 if(p.waiting_on!==undefined)changes.waiting_on=p.waiting_on===null?null:textVal(p.waiting_on,400);
 if(p.position!==undefined){if(!Number.isInteger(p.position)||p.position<0||p.position>10000000)throw Error("Invalid position");changes.position=p.position}
 return changes;
}
async function operate(cid:string,source:any,action:string,p:any){
 const actor="sandy:"+source.channel;
 if(action==="list"){
  let q=db.from("sandy_tasks").select("id,parent_task_id,company_id,title,details,status,priority,due_at,start_at,contact_name,next_review_at,waiting_on,position,version,archived_at,updated_at").eq("customer_id",cid).is("archived_at",null).order("updated_at",{ascending:false}).limit(200);
  if(uuid(p.company_id))q=q.eq("company_id",p.company_id);
  if(p.scope==="personal")q=q.is("company_id",null);
  if(norm(p.query))q=q.ilike("title","%"+norm(p.query).replace(/[%_,()]/g," ").slice(0,80)+"%");
  const [tasks,companies,delegations,deps]=await Promise.all([
    q,db.from("sandy_agenda_companies").select("id,name").eq("customer_id",cid).order("name").limit(200),
    db.from("sandy_task_delegations").select("task_id,assignee_customer_id,status,scope").eq("owner_customer_id",cid).neq("status","revoked").limit(300),
    db.from("sandy_task_dependencies").select("task_id,depends_on_id").eq("customer_id",cid).limit(500)
  ]);
  return {tasks:dbcheck(tasks),companies:dbcheck(companies),delegations:dbcheck(delegations),dependencies:dbcheck(deps)};
 }
 if(action==="company_create"){
  const name=textVal(p.name,160,false);
  const company=await getCompany(cid,{company_name:name},true);
  return {company_id:company,name};
 }
 if(action==="create"){
  const title=textVal(p.title,240,false);
  const fields=editable(p);delete fields.status;
  let company=await getCompany(cid,p,true);
  let parentId:any=null;
  if(p.parent_task_id!==undefined&&p.parent_task_id!==null){
   if(!uuid(p.parent_task_id))throw Error("Invalid parent_task_id");
   const parent=dbcheck(await db.from("sandy_tasks").select("id,company_id,status").eq("id",p.parent_task_id).eq("customer_id",cid).is("archived_at",null).maybeSingle());
   if(!parent||["completed","cancelled"].includes(parent.status))throw Error("Parent task unavailable or closed");
   if(company!==undefined&&company!==parent.company_id)throw Error("Parent and subtask must belong to the same workspace");
   company=parent.company_id;parentId=parent.id;
  }
  const value:any={customer_id:cid,company_id:company===undefined?null:company,parent_task_id:parentId,
    title,details:fields.details||"",priority:fields.priority||"normal",due_at:fields.due_at||null,
    start_at:fields.start_at||null,next_review_at:fields.next_review_at||null,waiting_on:fields.waiting_on||null,
    contact_name:fields.contact_name||null,position:fields.position||0,status:"todo",
    source_kind:"assistant_"+source.channel,source_key:source.source_id+":"+String(p.request_key||"default"),updated_by:actor};
  const task=dbcheck(await db.from("sandy_tasks").insert(value).select("id,title,status,company_id,parent_task_id,version").single());
  return {task,created:true};
 }
 if(action==="update"||action==="complete"||action==="reopen"||action==="move"){
  const task=await getTask(cid,p);
  const fields=editable(p);
  if(action==="complete")fields.status="completed";
  if(action==="reopen")fields.status="todo";
  if(p.company_id!==undefined||p.company_name!==undefined)fields.company_id=await getCompany(cid,p,true);
  if(p.parent_task_id!==undefined){
    if(p.parent_task_id!==null&&!uuid(p.parent_task_id))throw Error("Invalid parent_task_id");
    if(p.parent_task_id===task.id)throw Error("Cannot parent task to itself");
    if(p.parent_task_id!==null){
      const parent=dbcheck(await db.from("sandy_tasks").select("id,company_id,status").eq("customer_id",cid).eq("id",p.parent_task_id).is("archived_at",null).maybeSingle());
      if(!parent||["completed","cancelled"].includes(parent.status))throw Error("Parent task unavailable or closed");
      if(fields.company_id!==undefined&&fields.company_id!==parent.company_id)throw Error("Parent and child must be in the same workspace");
      fields.company_id=parent.company_id;
    }
    fields.parent_task_id=p.parent_task_id;
  }
  if(Object.keys(fields).length===0)throw Error("No fields to update");
  fields.updated_by=actor;
  let q=db.from("sandy_tasks").update(fields).eq("id",task.id).eq("customer_id",cid).eq("version",task.version).select("id,title,status,version,company_id,parent_task_id");
  const updated=dbcheck(await q.maybeSingle());
  if(!updated)throw Error("Task changed concurrently; reload and retry");
  return {task:updated,updated:true};
 }
 if(action==="archive"){
  const task=await getTask(cid,p);
  const children=dbcheck(await db.from("sandy_tasks").select("id").eq("customer_id",cid).eq("parent_task_id",task.id).is("archived_at",null).limit(1));
  if(children.length&&p.include_subtasks!==true)throw Error("Task has subtasks. Explicitly request archiving the entire subtree.");
  const count=dbcheck(await db.rpc("sandy_task_archive_subtree",{p_customer_id:cid,p_task_id:task.id,p_actor:actor}));
  return {archived:true,task_id:task.id,updated:count};
 }
 if(action==="complete_tree"){
  if(p.include_subtasks!==true)throw Error("Explicit include_subtasks:true is required to complete an entire task tree");
  const task=await getTask(cid,p);
  const count=dbcheck(await db.rpc("sandy_task_complete_subtree",{p_customer_id:cid,p_task_id:task.id,p_actor:actor}));
  return {completed:true,task_id:task.id,updated:count};
 }
 if(action==="dependency_add"||action==="dependency_remove"){
  if(!uuid(p.task_id)||!uuid(p.depends_on_id)||p.task_id===p.depends_on_id)throw Error("Two distinct task IDs required");
  const rows=dbcheck(await db.from("sandy_tasks").select("id").eq("customer_id",cid).in("id",[p.task_id,p.depends_on_id]).is("archived_at",null));
  if(rows.length!==2)throw Error("Both tasks must belong to this account");
  if(action==="dependency_add")dbcheck(await db.from("sandy_task_dependencies").upsert({customer_id:cid,task_id:p.task_id,depends_on_id:p.depends_on_id},{onConflict:"task_id,depends_on_id",ignoreDuplicates:true}));
  else dbcheck(await db.from("sandy_task_dependencies").delete().eq("customer_id",cid).eq("task_id",p.task_id).eq("depends_on_id",p.depends_on_id));
  dbcheck(await db.from("sandy_task_events").insert({customer_id:cid,task_id:p.task_id,actor,event_type:action,snapshot:{depends_on_id:p.depends_on_id}}));
  return {task_id:p.task_id,depends_on_id:p.depends_on_id,action};
 }
 if(action==="delegate"){
  const task=await getTask(cid,p);
  const email=norm(p.assignee_email).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>250)throw Error("Valid Sandy-user assignee_email required");
  const access=dbcheck(await db.from("sandy_agenda_access").select("customer_id").eq("email",email).eq("enabled",true).maybeSingle());
  if(!access)throw Error("Assignee must have an active Sandy account");
  if(access.customer_id===cid)throw Error("Cannot delegate to yourself");
  const scope=p.scope==="subtree"?"subtree":"task";
  const grant=dbcheck(await db.from("sandy_task_delegations").upsert({owner_customer_id:cid,task_id:task.id,assignee_customer_id:access.customer_id,status:"invited",scope,accepted_at:null,updated_at:new Date().toISOString()},{onConflict:"task_id,assignee_customer_id"}).select("id,status,scope").single());
  return {delegation:grant,task_id:task.id,assignee_email:email,note:"Invitation appears in assignee's Sandy agenda. No external notification was sent."};
 }
 throw Error("Unsupported task operation");
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return fail("POST only",405);
 if(!secret||!url)return fail("Backend unavailable",503);
 const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!bearer||!secretMatch(bearer,secret))return fail("Backend authorization required",403);
 if(Number(req.headers.get("content-length")||"0")>32768)return fail("Request too large",413);
 let body:any;
 try{body=await req.json()}catch{return fail("Invalid JSON")}
 if(!isObject(body)||!isObject(body.payload))return fail("Expected action and payload");
 const action=norm(body.action),p=body.payload,requestKey=norm(body.request_key)||"default";
 if(!/^[a-z_]{3,32}$/.test(action)||requestKey.length>80)return fail("Invalid action or request key");
 let owner:any;
 try{owner=await sourceOwner(body.source)}catch(e){console.error("tasks_source_lookup_failed",safeError(e));return fail("Unable to verify the originating message",503)}
 if(!owner)return fail("Verified email, WhatsApp identity or voice session required",403);
 if(action==="list"){try{return good(await operate(owner.id,owner,action,p))}catch(e){return fail(safeError(e),400)}}
 const permitted=new Set(["company_create","create","update","move","complete","reopen","complete_tree","archive","dependency_add","dependency_remove","delegate"]);
 if(!permitted.has(action))return fail("Unsupported action");
 const hash=await digest(JSON.stringify({action,payload:p}));
 let receipt:any;
 try{
  const inserted=await db.from("sandy_task_api_receipts").insert({customer_id:owner.id,source_channel:owner.channel,source_id:owner.source_id,request_key:requestKey,action,payload_sha256:hash,status:"processing"}).select("id").maybeSingle();
  if(inserted.error?.code==="23505"){
   const prior=dbcheck(await db.from("sandy_task_api_receipts").select("action,payload_sha256,status,result,error").eq("customer_id",owner.id).eq("source_channel",owner.channel).eq("source_id",owner.source_id).eq("request_key",requestKey).single());
   if(prior.payload_sha256!==hash||prior.action!==action)return fail("Request key already used for a different operation",409);
   if(prior.status==="succeeded")return good({...prior.result,replayed:true});
   return fail(prior.status==="processing"?"Request already processing; no duplicate task action issued":"Prior action failed; use a new message after checking task state",409);
  }
  receipt=dbcheck(inserted);
 }catch(e){console.error("tasks_receipt_failed",safeError(e));return fail("Could not reserve task action; nothing changed",503)}
 try{
  const result=await operate(owner.id,{...owner,source_id:owner.source_id},action,{...p,request_key:requestKey});
  const saved=await db.from("sandy_task_api_receipts").update({status:"succeeded",result,finished_at:new Date().toISOString()}).eq("id",receipt.id).eq("status","processing").select("id").maybeSingle();
  if(saved.error||!saved.data){console.error("tasks_receipt_commit_failed",safeError(saved.error));return fail("Task action may have succeeded, but confirmation could not be recorded. Check the agenda before retrying.",503)}
  return good(result);
 }catch(e){
  const error=safeError(e);
  const rec=await db.from("sandy_task_api_receipts").update({status:"failed",error,finished_at:new Date().toISOString()}).eq("id",receipt.id).eq("status","processing");
  if(rec.error)console.error("tasks_failure_receipt",safeError(rec.error));
  console.error("tasks_operation_failed",action,error);
  return fail(error,400);
 }
});
