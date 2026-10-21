import {createClient} from "npm:@supabase/supabase-js@2.57.4";
const ROOT=Deno.env.get("SUPABASE_URL")||"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const LIVEKIT_URL="wss://207-175-104-71.sslip.io";
const ALLOWED=new Set(["https://ausstyle.github.io"]);
const enc=new TextEncoder();
const b64=(data:Uint8Array)=>btoa(String.fromCharCode(...data)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
const jsonB64=(o:unknown)=>b64(enc.encode(JSON.stringify(o)));
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const reply=(status:number,data:unknown,origin:string)=>Response.json(data,{status,headers:{"cache-control":"no-store","access-control-allow-origin":origin,"vary":"Origin","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"POST, OPTIONS"}});
async function token(identity:string,name:string,room:string) {
 const key=Deno.env.get("SANDY_LIVEKIT_API_KEY");
 const secret=Deno.env.get("SANDY_LIVEKIT_API_SECRET");
 if(!key||!secret||secret.length<24)throw Error("livekit_credentials_not_configured");
 const now=Math.floor(Date.now()/1000);
 const body=jsonB64({iss:key,sub:identity,name,iat:now,nbf:now,exp:now+1800,video:{roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:true}});
 const header=jsonB64({alg:"HS256",typ:"JWT"});
 const message=header+"."+body;
 const cryptoKey=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=new Uint8Array(await crypto.subtle.sign("HMAC",cryptoKey,enc.encode(message)));
 return message+"."+b64(signature);
}
Deno.serve(async(req)=>{
 const origin=req.headers.get("origin")||"";
 if(!ALLOWED.has(origin))return Response.json({error:"origin_not_allowed"},{status:403});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":origin,"access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"POST, OPTIONS","vary":"Origin"}});
 if(req.method!=="POST")return reply(405,{error:"post_required"},origin);
 if(Number(req.headers.get("content-length")||"0")>12000)return reply(413,{error:"request_too_large"},origin);
 if(!ROOT||!SERVICE)return reply(503,{error:"backend_unconfigured"},origin);
 const db=createClient(ROOT,SERVICE,{auth:{persistSession:false}});
 let body:any;
 try{body=await req.json();if(!body||typeof body!=="object"||Array.isArray(body))throw Error("invalid");}
 catch{return reply(400,{error:"invalid_json"},origin)}
 const action=String(body.action||"");
 const bearer=req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
 let userId:string|null=null;
 if(bearer){const {data,error}=await db.auth.getUser(bearer);if(!error&&data.user)userId=data.user.id;}
 if(!userId && action!=="join")return reply(401,{error:"sign_in_required"},origin);
 try{
 if(["transcript_append","transcript_list","transcript_summary"].includes(action)){
  const id=String(body.meeting_id||"");
  if(!/^[a-f0-9-]{36}$/i.test(id))return reply(400,{error:"invalid_meeting"},origin);
  const found=await db.from("sandy_video_meetings").select("owner_id").eq("id",id).maybeSingle();
  if(found.error)throw found.error;
  if(!found.data||found.data.owner_id!==userId)return reply(403,{error:"owner_required"},origin);
  if(action==="transcript_append"){
   if(body.consented!==true)return reply(403,{error:"transcription_consent_required"},origin);
   const content=String(body.text||"").trim();
   if(!content||content.length>1800)return reply(400,{error:"invalid_transcript_segment"},origin);
   const insert=await db.from("sandy_video_transcript_segments").insert({meeting_id:id,actor_id:userId,speaker:"Host",content});
   if(insert.error)throw insert.error;
   return reply(200,{ok:true},origin);
  }
  const records=await db.from("sandy_video_transcript_segments").select("speaker,content,created_at").eq("meeting_id",id).order("created_at",{ascending:true}).limit(500);
  if(records.error)throw records.error;
  if(action==="transcript_list")return reply(200,{ok:true,segments:records.data},origin);
  if(!records.data?.length)return reply(409,{error:"no_consented_transcript"},origin);
  const modelKey=Deno.env.get("OPENAI_API_KEY");
  if(!modelKey)return reply(503,{error:"ai_service_not_configured"},origin);
  const text=records.data.map((x:any)=>x.speaker+": "+x.content).join("\n").slice(0,28000);
  const ai=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"authorization":"Bearer "+modelKey,"content-type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",store:false,max_output_tokens:950,instructions:"Summarize only what is actually supported by this PARTIAL opt-in meeting transcript. Return concise sections: Discussion, Decisions, Action candidates, Open questions. Never invent details. Explicitly state transcript only includes consented host microphone segments.",input:text}),signal:AbortSignal.timeout(30000)});
  const data=await ai.json().catch(()=>({}));
  if(!ai.ok)return reply(502,{error:"ai_summary_unavailable"},origin);
  const summary=(data.output||[]).flatMap((x:any)=>x.content||[]).filter((x:any)=>x.type==="output_text").map((x:any)=>x.text).join("\n").trim();
  return reply(200,{ok:true,summary,partial:true},origin);
 }
 if(action==="list"){
  const {data,error}=await db.from("sandy_video_meetings").select("id,title,state,starts_at,created_at").eq("owner_id",userId!).order("created_at",{ascending:false}).limit(50);
  if(error)throw error;
  return reply(200,{ok:true,meetings:data},origin);
 }
 if(action==="create"){
  const title=String(body.title||"Video meeting").trim();
  if(title.length<1||title.length>140)return reply(400,{error:"invalid_title"},origin);
  const uuid=crypto.randomUUID(),room="sandy-"+uuid;
  const {data,error}=await db.from("sandy_video_meetings").insert({id:uuid,owner_id:userId,room_name:room,title}).select("id,title,state,starts_at,created_at").single();
  if(error)throw error;
  return reply(200,{ok:true,meeting:data},origin);
 }
 if(action==="end"||action==="invite"||action==="join"){
  const id=String(body.meeting_id||"");
  if(!/^[0-9a-f-]{36}$/i.test(id))return reply(400,{error:"invalid_meeting"},origin);
  const {data:meeting,error}=await db.from("sandy_video_meetings").select("id,title,room_name,owner_id,state").eq("id",id).maybeSingle();
  if(error)throw error;
  if(!meeting)return reply(404,{error:"meeting_not_found"},origin);
  const owner=!!userId&&meeting.owner_id===userId;
  if(action==="end"){
   if(!owner)return reply(403,{error:"owner_required"},origin);
   const {error}=await db.from("sandy_video_meetings").update({state:"ended",updated_at:new Date().toISOString()}).eq("id",id);
   if(error)throw error;
   return reply(200,{ok:true},origin);
  }
  if(meeting.state!=="scheduled")return reply(409,{error:"meeting_ended"},origin);
  if(action==="invite"){
    if(!owner)return reply(403,{error:"owner_required"},origin);
    const bytes=crypto.getRandomValues(new Uint8Array(32)),invite=b64(bytes);
    const {error}=await db.from("sandy_video_invites").insert({meeting_id:id,token_sha256:await sha(invite),expires_at:new Date(Date.now()+7*86400000).toISOString()});
    if(error)throw error;
    return reply(200,{ok:true,invite},origin);
  }
  if(!owner){
   const invite=String(body.invite||"");
   if(!/^[a-zA-Z0-9_-]{43}$/.test(invite))return reply(403,{error:"valid_invite_required"},origin);
   const {data,error}=await db.from("sandy_video_invites").select("id").eq("meeting_id",id).eq("token_sha256",await sha(invite)).is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
   if(error)throw error;
   if(!data)return reply(403,{error:"invite_invalid_or_expired"},origin);
  }
  const participant=owner?"host-"+userId:"guest-"+crypto.randomUUID();
  const display=owner?"Host":String(body.display_name||"Guest").slice(0,60).replace(/[<>]/g,"").trim()||"Guest";
  const jwt=await token(participant,display,meeting.room_name);
  return reply(200,{ok:true,server_url:LIVEKIT_URL,token:jwt,title:meeting.title},origin);
 }
 return reply(404,{error:"unknown_action"},origin);
 }catch(e){
  const msg=String(e instanceof Error?e.message:e);
  console.error("sandy_video_error",msg.slice(0,140));
  return reply(503,{error:msg==="livekit_credentials_not_configured"?msg:"video_service_unavailable"},origin);
 }
});
