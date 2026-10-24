import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.0";
const allowedOrigins = new Set(["https://ausstyle.github.io","https://sandy.chat","https://www.sandy.chat"]);
const cors = (req: Request) => {
 const origin = req.headers.get("origin") || "";
 return { "access-control-allow-origin": allowedOrigins.has(origin) ? origin : "null", "access-control-allow-methods":"POST,OPTIONS", "access-control-allow-headers":"authorization,apikey,content-type", "vary":"Origin", "cache-control":"no-store" };
};
const json = (req: Request, body: unknown, status=200) => new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8",...cors(req)}});
const validUuid=(s:unknown)=>typeof s==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s);
const acceptable=new Set(["audio/webm","audio/wav","audio/x-wav","audio/mp4","audio/ogg"]);
const apiBase="https://api.openai.com/v1/audio";
const apiRequest=async(path:string,key:string,init:RequestInit)=> {
 const r=await fetch(apiBase+path,{...init,headers:{Authorization:"Bearer "+key,...(init.headers||{})},signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw new Error("provider_http_"+r.status);
 return r;
};
const decodeAudio=(value:unknown,mime:unknown)=>{
 if(typeof value!=="string"||!acceptable.has(String(mime))||value.length<100||value.length>5_000_000||!/^[A-Za-z0-9+/=]+$/.test(value))throw new Error("invalid_audio");
 let bytes:Uint8Array;
 try {const binary=atob(value);bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));}catch{throw new Error("invalid_audio");}
 if(bytes.length<2048||bytes.length>3_750_000)throw new Error("invalid_audio_size");
 return new File([bytes],"recording."+ (mime==="audio/webm"?"webm":mime==="audio/ogg"?"ogg":"wav"),{type:String(mime)});
};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
 if(req.method!=="POST")return json(req,{error:"method_not_allowed"},405);
 const origin=req.headers.get("origin");if(origin&&!allowedOrigins.has(origin))return json(req,{error:"origin_not_allowed"},403);
 const auth=req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!auth)return json(req,{error:"unauthorized"},401);
 const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json(req,{error:"service_unconfigured"},503);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:authError}=await db.auth.getUser(auth);
 if(authError||!user?.id||user.is_anonymous)return json(req,{error:"unauthorized"},401);
 const {data:member,error:membershipError}=await db.from("sandy_memory_portal_accounts").select("customer_id").eq("auth_user_id",user.id).is("revoked_at",null).maybeSingle();
 if(membershipError||!member?.customer_id)return json(req,{error:"customer_not_linked"},403);
 const cid=member.customer_id;
 let body:any;try{if(Number(req.headers.get("content-length")||0)>8_000_000)return json(req,{error:"payload_too_large"},413);body=await req.json();}catch{return json(req,{error:"invalid_json"},400);}
 if(!body||typeof body.action!=="string")return json(req,{error:"invalid_action"},400);
 const now=()=>new Date().toISOString();
 const audit=async(profileId:string,type:string,outcome:string)=>{
  await db.from("sandy_voice_profile_events").insert({profile_id:profileId,customer_id:cid,actor_auth_user_id:user.id,event_type:type,outcome});
 };
 const profile=async(id:unknown)=>{
  if(!validUuid(id))return null;
  const {data}=await db.from("sandy_voice_profiles").select("*").eq("id",id).eq("customer_id",cid).maybeSingle();
  return data;
 };
 const display=(p:any)=>({id:p.id,name:p.name,status:p.status,selected:p.selected,created_at:p.created_at,provider_verified_at:p.provider_verified_at,revoked_at:p.revoked_at,error_code:p.error_code});
 const openai=Deno.env.get("OPENAI_API_KEY");
 if(body.action==="list"){
  const {data,error}=await db.from("sandy_voice_profiles").select("id,name,status,selected,created_at,provider_verified_at,revoked_at,error_code").eq("customer_id",cid).order("created_at",{ascending:false}).limit(30);
  if(error)return json(req,{error:"unavailable"},503);
  return json(req,{voices:data||[],default_voice:"coral",enrollment_available:!!openai});
 }
 if(body.action==="resolve"){
  const {data,error}=await db.from("sandy_voice_profiles").select("id,provider_voice_id,provider_verified_at,status,revoked_at").eq("customer_id",cid).eq("selected",true).eq("status","ready").is("revoked_at",null).maybeSingle();
  if(error)return json(req,{error:"voice_resolution_unavailable"},503);
  const voice=data?.provider_verified_at && typeof data.provider_voice_id==="string" && /^voice_[\\w-]+$/.test(data.provider_voice_id) ? {id:data.provider_voice_id} : "coral";
  return json(req,{voice,source:typeof voice==="string"?"standard":"custom",verified_source:typeof voice!=="string"});
 }
 if(body.action==="create"){
  if(body.own_voice!==true||body.consent_version!=="v1-2026-10")return json(req,{error:"explicit_self_consent_required"},400);
  if(!openai)return json(req,{error:"provider_not_configured"},503);
  if(!validUuid(body.request_id)||typeof body.name!=="string"||body.name.trim().length<1||body.name.trim().length>80)return json(req,{error:"invalid_parameters"},400);
  const {data:existing}=await db.from("sandy_voice_profiles").select("*").eq("customer_id",cid).eq("request_id",body.request_id).maybeSingle();
  if(existing)return json(req,{voice:display(existing),replayed:true},existing.status==="ready"?200:409);
  const {data:all}=await db.from("sandy_voice_profiles").select("id,status,error_code").eq("customer_id",cid).in("status",["ready","creating","error"]);
  if((all||[]).some(p=>p.status==="error"&&(!p.error_code||/Timeout|timed.out|provider_http_5|provider_voice_missing|provider_consent_missing|Failed to fetch|local_commit_failed/i.test(p.error_code))))return json(req,{error:"provider_reconciliation_required"},409);
  if((all||[]).filter(p=>p.status==="ready"||p.status==="creating").length>=3)return json(req,{error:"voice_limit_reached"},409);
  let consent:File,sample:File;
  try{consent=decodeAudio(body.consent_audio,body.consent_mime);sample=decodeAudio(body.sample_audio,body.sample_mime);}catch(e){return json(req,{error:String((e as Error).message)},400);}
  const {data:created,error:insertError}=await db.from("sandy_voice_profiles").insert({
    customer_id:cid,owner_auth_user_id:user.id,request_id:body.request_id,name:body.name.trim(),
    consent_language:"en",consent_version:"v1-2026-10",consent_attested_at:now(),status:"creating"
  }).select("*").single();
  if(insertError||!created)return json(req,{error:"creation_conflict_or_unavailable"},409);
  await audit(created.id,"requested","accepted");
  let consentId:string|null=null,voiceId:string|null=null;
  try{
   const cForm=new FormData();cForm.append("name","sandy-"+created.id);cForm.append("language","en");cForm.append("recording",consent);
   const cResp=await apiRequest("/voice_consents",openai,{method:"POST",body:cForm});
   const c=await cResp.json();if(!c?.id||!/^cons_[\w-]+$/.test(c.id))throw new Error("provider_consent_missing");
   consentId=c.id;
   await db.from("sandy_voice_profiles").update({provider_consent_id:consentId,updated_at:now()}).eq("id",created.id).eq("customer_id",cid);
   const vForm=new FormData();vForm.append("name",body.name.trim());vForm.append("audio_sample",sample);vForm.append("consent",consentId);vForm.append("type","audio_sample");
   const vResp=await apiRequest("/voices",openai,{method:"POST",body:vForm});
   const v=await vResp.json();if(!v?.id||!/^voice_[\w-]+$/.test(v.id))throw new Error("provider_voice_missing");
   voiceId=v.id;
   const {data:saved,error:saveError}=await db.from("sandy_voice_profiles").update({provider_voice_id:voiceId,status:"ready",provider_verified_at:now(),updated_at:now()}).eq("id",created.id).eq("customer_id",cid).eq("status","creating").select("*").single();
   if(saveError||!saved)throw new Error("local_commit_failed");
   await audit(created.id,"ready","provider_accepted");
   return json(req,{voice:display(saved)},201);
  }catch(e){
   // An uncertain provider outcome is never reported as successful; preserve ids for reconciliation.
   const code=String((e as Error).message||"provider_error").slice(0,75);
   await db.from("sandy_voice_profiles").update({status:"error",selected:false,provider_voice_id:voiceId,provider_consent_id:consentId,error_code:code,updated_at:now()}).eq("id",created.id).eq("customer_id",cid);
   await audit(created.id,"provider_error",code);
   return json(req,{error:"voice_creation_not_verified",detail:code,profile_id:created.id,manual_reconciliation_required:code.includes("timeout")||code==="local_commit_failed"},502);
  }
 }
 if(body.action==="select"||body.action==="deselect"){
  if(body.action==="select"){
   const p=await profile(body.id);if(!p||p.status!=="ready"||p.revoked_at||!p.provider_voice_id||!p.provider_verified_at)return json(req,{error:"voice_not_ready"},409);
  }
  const {error:clearError}=await db.from("sandy_voice_profiles").update({selected:false,updated_at:now()}).eq("customer_id",cid).eq("selected",true);
  if(clearError)return json(req,{error:"selection_unavailable"},503);
  if(body.action==="select"){
   const {data:sel,error}=await db.from("sandy_voice_profiles").update({selected:true,updated_at:now()}).eq("customer_id",cid).eq("id",body.id).eq("status","ready").is("revoked_at",null).select("id").maybeSingle();
   if(error||!sel)return json(req,{error:"selection_conflict"},409);
   await audit(body.id,"selected","saved");
  }
  return json(req,{selected_voice_id:body.action==="select"?body.id:null,live_call_connected:false});
 }
 if(body.action==="preview"){
  const p=await profile(body.id);if(!p||p.status!=="ready"||!p.provider_voice_id||p.revoked_at)return json(req,{error:"voice_not_ready"},409);
  if(!openai)return json(req,{error:"provider_not_configured"},503);
  try{
   const r=await apiRequest("/speech",openai,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:"gpt-4o-mini-tts",voice:{id:p.provider_voice_id},response_format:"mp3",input:"Hello. I'm Sandy, speaking with your selected voice."})});
   const buf=await r.arrayBuffer();if(buf.byteLength>2_000_000)throw new Error("preview_oversize");
   return new Response(buf,{status:200,headers:{"content-type":"audio/mpeg",...cors(req)}});
  }catch(e){return json(req,{error:"preview_unavailable",detail:String((e as Error).message).slice(0,60)},502);}
 }
 if(body.action==="revoke"){
  const p=await profile(body.id);if(!p)return json(req,{error:"not_found"},404);
  if(p.status==="deleted")return json(req,{status:"deleted"});
  if(p.status!=="delete_pending"){
   const {error}=await db.from("sandy_voice_profiles").update({selected:false,status:"delete_pending",revoked_at:now(),updated_at:now()}).eq("id",p.id).eq("customer_id",cid);
   if(error)return json(req,{error:"revocation_failed"},503);
   await audit(p.id,"revoked","disabled");
  }
  if(!openai)return json(req,{status:"delete_pending",error:"provider_not_configured"},503);
  try{
   for(const [kind,id] of [["voices",p.provider_voice_id],["voice_consents",p.provider_consent_id]]){
    if(!id)continue;
    const r=await fetch(apiBase+"/"+kind+"/"+encodeURIComponent(id),{method:"DELETE",headers:{Authorization:"Bearer "+openai},signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error("provider_delete_unverified_http_"+r.status);
   }
   await db.from("sandy_voice_profiles").update({status:"deleted",provider_deleted_at:now(),selected:false,updated_at:now()}).eq("id",p.id).eq("customer_id",cid);
   await audit(p.id,"delete_verified","provider_delete_acknowledged");
   return json(req,{status:"deleted"});
  }catch(e){
   await audit(p.id,"delete_failed",String((e as Error).message).slice(0,70));
   return json(req,{status:"delete_pending",error:"provider_deletion_unverified"},502);
  }
 }
 return json(req,{error:"unknown_action"},400);
});
