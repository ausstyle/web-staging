import {createClient} from "npm:@supabase/supabase-js@2.58.0";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
function response(status:number,result:unknown){return new Response(JSON.stringify(result),{status,headers:{"content-type":"application/json"}})}
async function extract(title:string){
 const key=Deno.env.get("OPENAI_API_KEY");if(!key)return null;
 if((title.startsWith('"')&&title.endsWith('"'))||(title.startsWith("“")&&title.endsWith("”")))return null;
 const res=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"authorization":"Bearer "+key,"content-type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",temperature:0,response_format:{type:"json_object"},messages:[{role:"system",content:"Extract configuration facts only; NEVER rewrite titles, descriptions or create tasks. JSON: {contact_name:string|null,priority:'high'|'normal'|'low'|null, time_text:string|null, hour:number|null,minute:number|null,timezone:'AEST'|'AEDT'|null,date_text:string|null,date_ymd:string|null,due_date_ymd:string|null}. time_text must be exact substring in original title and must include clock time. hour 0-23, minute 0-59. date_text must be exact source substring ('today','tomorrow', or explicit date). date_ymd only with explicit date. due_date_ymd only for explicit due dates. Additionally return relative_text (exact substring e.g. 'in 15 minutes') and relative_minutes (positive integer duration in minutes), or both null. Interpret natural relative durations including written numbers. If unspecified set null. Never assume a date yourself. No invented people or contacts."},{role:"user",content:title}]}),signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw Error("AI "+res.status);
 return JSON.parse((await res.json()).choices?.[0]?.message?.content||"{}");
}
function scheduled(x:any,title:string){
 const text=typeof x.time_text==="string"?x.time_text:null;
 if(!text||!title.toLowerCase().includes(text.toLowerCase()))return {start:null,pending:null,assumed:false};
 const zone=String(x.timezone||"").toUpperCase();
 const h=x.hour,m=x.minute;
 if(!["AEST","AEDT"].includes(zone)||!Number.isInteger(h)||h<0||h>23||!Number.isInteger(m)||m<0||m>59)return {start:null,pending:text,assumed:false};
 // Verify clock hour independently, never trust extracted hour blindly.
 const found=text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
 if(!found)return {start:null,pending:text,assumed:false};
 const observed=Number(found[1])%12+(found[3].toLowerCase()==="pm"?12:0);
 if(observed!==h||Number(found[2]||0)!==m||!text.toUpperCase().includes(zone))return {start:null,pending:text,assumed:false};
 const offset=zone==="AEST"?10:11,now=new Date(),local=new Date(now.getTime()+offset*3600000);
 let y=local.getUTCFullYear(),month=local.getUTCMonth()+1,day=local.getUTCDate();
 const dateText=typeof x.date_text==="string"&&title.toLowerCase().includes(x.date_text.toLowerCase())?x.date_text.toLowerCase():null;
 if(dateText==="tomorrow"){const d=new Date(Date.UTC(y,month-1,day+1));y=d.getUTCFullYear();month=d.getUTCMonth()+1;day=d.getUTCDate();}
 else if(dateText&&dateText!=="today"){
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(String(x.date_ymd||"")))return {start:null,pending:text,assumed:false};
  [y,month,day]=x.date_ymd.split("-").map(Number);
 }
 const instant=new Date(Date.UTC(y,month-1,day,h-offset,m));
 if(Number.isNaN(instant.getTime()))return {start:null,pending:text,assumed:false};
 if(!dateText&&instant<=now)return {start:null,pending:text,assumed:false};
 return {start:instant.toISOString(),pending:null,assumed:!dateText};
}
Deno.serve(async req=>{
 if(req.method!=="POST")return response(405,{error:"Method"});
 const token=req.headers.get("x-sandy-worker-token")||"";
 if(!token)return response(401,{error:"Unauthorized"});
 const {data:authorized,error:ae}=await db.rpc("sandy_task_worker_authorized",{p_token:token});
 if(ae||authorized!==true)return response(403,{error:"Forbidden"});
 const {data:jobs,error:je}=await db.rpc("sandy_task_claim_analysis",{p_limit:10});
 if(je)return response(500,{error:je.message});
 const results:any[]=[];
 for(const job of jobs||[]){
  try{
   const {data:task,error:te}=await db.from("sandy_tasks").select("id,title,metadata,contact_name,start_at,due_at,priority,created_at").eq("id",job.task_id).eq("customer_id",job.customer_id).maybeSingle();
   if(te)throw te;
   if(!task||task.title!==job.source_title){
    await db.from("sandy_task_analysis_queue").update({state:"skipped",processed_at:new Date().toISOString(),last_error:"Task edited or removed"}).eq("task_id",job.task_id).eq("source_title",job.source_title);
    results.push({id:job.task_id,status:"skipped"});continue;
   }
   const x=await extract(task.title);
   let timing=x?scheduled(x,task.title):{start:null,pending:null,assumed:false};
   const phrase=typeof x?.relative_text==="string"?x.relative_text.trim():"";
   const mins=x?.relative_minutes;
   if(!timing.start&&phrase&&task.title.toLowerCase().includes(phrase.toLowerCase())&&Number.isInteger(mins)&&mins>0&&mins<=525600){
     const n=phrase.match(/\b(?:in|within|after)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/i);
     const words:Record<string,number>={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,fifteen:15,thirty:30,half:0.5};
     const w=phrase.match(/\b(?:in|within|after)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|thirty|half)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/i);
     const observed=n?Number(n[1]):w?words[w[1].toLowerCase()]:null;
     const unit=n?.[2]||w?.[2]||"";
     const factor=/^weeks?/i.test(unit)?10080:/^days?/i.test(unit)?1440:/^(hours?|hrs?)/i.test(unit)?60:1;
     if(observed!==null&&observed*factor===mins){
       const base=Date.parse(task.created_at);
       if(Number.isFinite(base))timing={start:new Date(base+mins*60000).toISOString(),pending:null,assumed:false};
     }else timing={start:null,pending:phrase,assumed:false};
   }
   const metadata={...(task.metadata||{}),task_ai_pending_time:timing.pending,task_ai_assumed_today:timing.assumed,task_ai_extraction_only:true,task_ai_applied_at:new Date().toISOString()};
   if(timing.start&&["AEST","AEDT"].includes(String(x?.timezone||"").toUpperCase())&&!metadata.schedule_timezone)metadata.schedule_timezone=String(x.timezone).toUpperCase()==="AEST"?"Australia/Brisbane":"Australia/Sydney";
   const update:any={metadata};
   if(timing.start){
    if(!task.start_at)update.start_at=timing.start;
    if(!task.due_at){update.due_at=timing.start;metadata.due_time_specified=true;metadata.schedule_interpretation=phrase?"relative":"absolute";}
    if(!metadata.scheduled_end_at){
     const isShortAction=/\b(call|contact|phone|ring|meeting|meet|video call|consultation)\b/i.test(task.title);
     if(isShortAction){
      metadata.scheduled_end_at=new Date(Date.parse(timing.start)+30*60000).toISOString();
      metadata.duration_estimated=true;metadata.duration_estimate_minutes=30;
     }else if(/\\b(flight|fly to|airline)\\b/i.test(task.title)){
      metadata.duration_needs_confirmation=true;
     }
    }
   }
   if(!task.contact_name&&typeof x?.contact_name==="string"&&task.title.toLowerCase().includes(x.contact_name.toLowerCase()))update.contact_name=x.contact_name.slice(0,240);
   if(!task.due_at&&typeof x?.due_date_ymd==="string"&&/^20\d{2}-\d{2}-\d{2}$/.test(x.due_date_ymd)&&/\b(due|deadline|by)\b/i.test(task.title))update.due_at=new Date(x.due_date_ymd+"T12:00:00Z").toISOString();
   const {data:changed,error:ue}=await db.from("sandy_tasks").update(update).eq("id",task.id).eq("customer_id",job.customer_id).eq("title",job.source_title).select("id");
   if(ue)throw ue;
   await db.from("sandy_task_analysis_queue").update({state:changed?.length?"complete":"skipped",processed_at:new Date().toISOString(),last_error:null}).eq("task_id",job.task_id).eq("source_title",job.source_title);
   results.push({id:job.task_id,status:changed?.length?"complete":"skipped"});
  }catch(e){
   await db.from("sandy_task_analysis_queue").update({state:"failed",last_error:String(e).slice(0,600),processed_at:new Date().toISOString()}).eq("task_id",job.task_id).eq("source_title",job.source_title);
   results.push({id:job.task_id,status:"failed"});
  }
 }
 return response(200,{processed:results.length,results});
});