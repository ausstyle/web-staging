import {createClient} from "npm:@supabase/supabase-js@2.57.0";
import {liveComputerSession} from "../_shared/sandy-agent-operations/worker_computer_identity.ts";
type Dependencies={secret:string;endpoint:string;db:any;now?:()=>number};
const respond=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const isUuid=(x:unknown)=>typeof x==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
export function createMasterComputerHandler(deps:Dependencies){return async(req:Request)=>{
 if(req.method!=="POST")return respond(405,{error:"method_not_allowed"});
 const secret=deps.secret;
 const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!secret||bearer!==secret)return respond(403,{error:"master_authorization_required"});
 const endpoint=deps.endpoint;
 if(!endpoint)return respond(503,{error:"backend_unavailable"});
 const db=deps.db;
 let p:any;try{p=await req.json()}catch{return respond(400,{error:"invalid_json"})}
 const action=String(p.action||"status");
 const sessionId=isUuid(p.session_id)?p.session_id:"51519d66-3f77-401a-b463-b53d84b43a97";
 const {data:session,error:sessionError}=await db.from("sandy_computer_sessions").select("id,provider_session_id,state,control_mode,expires_at").eq("id",sessionId).eq("provider","daytona").maybeSingle();
 if(sessionError||!session||!session.provider_session_id)return respond(404,{error:"computer_session_not_found"});
 if(action==="status")return respond(200,{ok:true,session_id:session.id,state:session.state,control_mode:session.control_mode,computer_reserved_for:"sandy_internal",external_api_access:false});
 // Reuse the worker lifecycle predicate at admission; no queue entry or AI
 // handover may imply eligibility that the actual dispatch guard will refuse.
 const eligible=liveComputerSession(session,(deps.now??Date.now)())&&["running","paused"].includes(session.state);
 if((action==="submit"||(action==="handover"&&p.mode==="ai"))&&!eligible)return respond(409,{error:"live_bounded_computer_session_required",executed:false});
 if(action==="handover"){
   const mode=String(p.mode||"");
   if(!["ai","human"].includes(mode))return respond(400,{error:"invalid_mode"});
   if(mode==="ai"&&!["running","paused"].includes(session.state))return respond(409,{error:"computer_not_running"});
   const change=await db.from("sandy_computer_sessions").update({control_mode:mode==="ai"?"agent":mode,updated_at:new Date().toISOString()}).eq("id",session.id).eq("control_mode",session.control_mode).select("id").maybeSingle();
   if(change.error)return respond(503,{error:"handover_update_error",code:change.error.code,detail:change.error.message.slice(0,280)}); if(!change.data)return respond(409,{error:"concurrent_control_change",previous_mode:session.control_mode});
   await db.from("sandy_computer_events").insert({session_id:session.id,event_type:"master_handover",metadata:{mode}});
   return respond(200,{ok:true,session_id:session.id,control_mode:mode});
 }
 if(action==="submit"){
   const instruction=typeof p.instruction==="string"?p.instruction.trim():"";
   if(!instruction||instruction.length>3000)return respond(400,{error:"invalid_instruction"});
   if(p.read_only!==true)return respond(400,{error:"read_only_required"});
   if(session.control_mode!=="agent")return respond(409,{error:"human_control_active",message:"Master must explicitly hand over to Sandy before queuing a computer task."});
   const identity=typeof p.idempotency_key==="string"?p.idempotency_key.trim():"";
   if(!/^[a-zA-Z0-9:_-]{12,128}$/.test(identity))return respond(400,{error:"valid_idempotency_key_required"});
   const key="master:"+identity;
   const existing=await db.from("sandy_computer_tasks").select("id,status,session_id,instruction,task_payload").eq("idempotency_key",key).maybeSingle();
   if(existing.error)return respond(503,{error:"idempotency_check_failed"});
   if(existing.data&&(existing.data.session_id!==session.id||existing.data.instruction!==instruction||existing.data.task_payload?.origin!=="sandy_master_internal"||existing.data.task_payload?.read_only!==true))return respond(409,{error:"idempotency_scope_conflict"});
   if(existing.data)return respond(200,{ok:true,reused:true,task_id:existing.data.id,status:existing.data.status});
   const result=await db.from("sandy_computer_tasks").insert({session_id:session.id,task_type:"browser_agent",instruction,status:"queued",idempotency_key:key,requires_approval:false,task_payload:{origin:"sandy_master_internal",read_only:true}}).select("id,status").single();
   if(result.error){
     if(result.error.code==="23505")return respond(409,{error:"concurrent_duplicate_task"});
     return respond(503,{error:"task_queue_failed",code:result.error.code});
   }
   await db.from("sandy_computer_events").insert({session_id:session.id,task_id:result.data.id,event_type:"master_task_queued",metadata:{read_only:true}});
   return respond(202,{ok:true,task_id:result.data.id,status:result.data.status,notice:"Queued, not completed."});
 }
 if(action==="task_status"){
   if(!isUuid(p.task_id))return respond(400,{error:"invalid_task_id"});
   const r=await db.from("sandy_computer_tasks").select("id,status,result,error_text,created_at,completed_at,task_payload").eq("id",p.task_id).eq("session_id",session.id).maybeSingle();
   if(r.error||!r.data||r.data.task_payload?.origin!=="sandy_master_internal")return respond(404,{error:"task_not_found"});
   const {task_payload:_,...safe}=r.data;
   return respond(200,{ok:true,...safe});
 }
 return respond(400,{error:"invalid_action"});
};}
if(import.meta.main){
 const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",endpoint=Deno.env.get("SUPABASE_URL")||"";
 const db=endpoint&&secret?createClient(endpoint,secret,{auth:{persistSession:false}}):null;
 Deno.serve(createMasterComputerHandler({secret,endpoint,db}));
}
