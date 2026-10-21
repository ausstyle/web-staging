import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.57.0";
import {authenticateExaminer} from "../_shared/sandy-agent-operations/worker_examiner_identity.ts";
import {examinerSources,examinerInbound,compareExaminerSourceId} from "../_shared/sandy-agent-operations/worker_examiner_context.ts";
import {executeExaminerReview} from "../_shared/sandy-agent-operations/worker_examiner.ts";
const json=(status:number,obj:unknown)=>new Response(JSON.stringify(obj),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export function createExaminerHandler(deps:{env:(name:string)=>string|undefined;db?:any;fetch?:typeof fetch;now?:()=>Date;randomUUID?:()=>string}){
 return async(request:Request)=>{
  if(request.method!=="POST")return json(405,{error:"method_not_allowed"});
  const secret=deps.env("SUPABASE_SERVICE_ROLE_KEY")||"",proof=authenticateExaminer(request,secret);
  if(!proof)return json(403,{error:"unauthorized"});
  const url=deps.env("SUPABASE_URL")||"";if(!url)return json(503,{error:"worker_not_configured"});
  const db=deps.db??createClient(url,secret,{auth:{persistSession:false}});
  const run_key="live:"+(deps.randomUUID??(()=>crypto.randomUUID()))(),cutoff=(deps.now??(()=>new Date()))().toISOString();
  const {error:runError}=await db.from("sandy_examiner_live_runs").insert({run_key,details:{cutoff}});
  if(runError)return json(503,{error:"audit_run_unavailable",code:runError.code});
  const result:any={run_key,scanned:0,reviewed:0,flagged:0,channels:{}};
  try{
   for(const cfg of examinerSources){
    const cursor=await db.from("sandy_examiner_live_cursors").select("last_created_at,last_source_id").eq("channel",cfg.channel).maybeSingle();
    if(cursor.error||!cursor.data)throw Error(cfg.channel+":cursor_unavailable");
    const since=String(cursor.data.last_created_at),previousId=String(cursor.data.last_source_id||"");
    const rows=await db.from(cfg.table).select(cfg.fields).gte("created_at",since).lte("created_at",cutoff).order("created_at",{ascending:true}).order("id",{ascending:true}).limit(120);
    if(rows.error)throw Error(cfg.channel+":source_unavailable");
    let scanned=0,reviewed=0,flagged=0;
    for(const x of rows.data||[]){
     const when=String(x.created_at),id=String(x.id);if(when===since&&compareExaminerSourceId(id,previousId)<=0)continue;if(scanned>=40)break;
     if(examinerInbound(cfg.channel,x)){
      const question=String(cfg.channel==="email"?[x.subject,x.body_text].filter(Boolean).join("\n"):x[cfg.user]||"").slice(0,3000);
      if(question.trim()){
       const review=await executeExaminerReview(proof,{runKey:run_key,channel:cfg.channel,sourceId:id},{},{db,openaiKey:deps.env("OPENAI_API_KEY")||"",fetch:deps.fetch});
       if(review.status!==200||!review.legacy)throw Error(cfg.channel+":"+review.body.error);
       reviewed++;if(review.legacy.verdict==="potential_issue")flagged++;
      }
     }
     scanned++;
     const saved=await db.from("sandy_examiner_live_cursors").update({last_created_at:when,last_source_id:id,updated_at:(deps.now??(()=>new Date()))().toISOString()}).eq("channel",cfg.channel);
     if(saved.error)throw Error(cfg.channel+":cursor_save_failed");
    }
    result.scanned+=scanned;result.reviewed+=reviewed;result.flagged+=flagged;result.channels[cfg.channel]={scanned,reviewed,flagged};
   }
   const finish=await db.from("sandy_examiner_live_runs").update({status:"complete",completed_at:(deps.now??(()=>new Date()))().toISOString(),scanned:result.scanned,reviewed:result.reviewed,flagged:result.flagged,details:{channels:result.channels,cutoff}}).eq("run_key",run_key);
   if(finish.error)throw Error("run_finalize_failed");return json(200,{ok:true,...result});
  }catch(error){
   const reason=String(error).replace(/[^a-zA-Z0-9:_ -]/g,"").slice(0,120);
   await db.from("sandy_examiner_live_runs").update({status:"partial",completed_at:(deps.now??(()=>new Date()))().toISOString(),scanned:result.scanned,reviewed:result.reviewed,flagged:result.flagged,details:{reason,channels:result.channels}}).eq("run_key",run_key);
   return json(503,{ok:false,reason,...result});
  }
 };
}
if(import.meta.main)Deno.serve(createExaminerHandler({env:name=>Deno.env.get(name)}));
