import {createClient} from "npm:@supabase/supabase-js@2.57.0";
import {executiveCanaryEnabled} from "../_shared/sandy-executive/rollout.ts";
import {voiceExecutiveTurn} from "./executive.ts";
const root=Deno.env.get("SUPABASE_URL")||"",secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(root,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"no-store"}});
Deno.serve(async req=>{
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 let body:any;try{body=await req.json()}catch{return reply({error:"invalid_json"},400)}
 const token=String(body.token||""),sid=String(body.session_id||""),query=String(body.query||"").slice(0,250);
 const executive=body.operation==="turn";
 if(!/^[a-f0-9]{64}$/.test(token)||!/^[a-f0-9-]{36}$/i.test(sid)||(!executive&&query.trim().length<2))return reply({error:"invalid_request"},400);
 const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const hash=Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,"0")).join("");
 const {data:session,error:se}=await db.from("sandy_voice_call_sessions").select("id,owner_customer_id,link_id,created_at,ended_at,state").eq("id",sid).maybeSingle();
 if(se||!session||Date.now()-Date.parse(session.created_at)>35*60000)return reply({error:"unauthorized"},403);
 const {data:link}=await db.from("sandy_voice_call_links").select("id,owner_customer_id,token_sha256,revoked_at").eq("id",session.link_id).maybeSingle();
 if(!link||link.token_sha256!==hash||link.owner_customer_id!==session.owner_customer_id||link.revoked_at)return reply({error:"unauthorized"},403);
 const {data:auth}=await db.from("sandy_voice_private_auth").select("verified_at").eq("session_id",sid).eq("owner_customer_id",session.owner_customer_id).maybeSingle();
 if(!auth?.verified_at)return reply({error:"private_access_locked"},403);
 if(executive){
  if(!executiveCanaryEnabled(session.owner_customer_id,Deno.env.get("SANDY_EXECUTIVE_CANARY_CUSTOMERS")))return reply({error:"voice_executive_not_enrolled"},403);
  return voiceExecutiveTurn(db,session,body.turn_id,{base:root,credential:secret,timezone:typeof body.timezone==="string"?body.timezone.slice(0,80):"UTC"});
 }
 const {data,error}=await db.rpc("sandy_voice_lookup_memory",{p_customer_id:session.owner_customer_id,p_query:query});
 if(error)return reply({error:"lookup_failed"},503);
 const [shared,capabilities,release]=await Promise.all([
  db.from("sandy_conversation_policy").select("policy_version,instructions").eq("id",1).maybeSingle(),
  db.from("sandy_channel_capabilities").select("capability,state,requires_consent,constraints").eq("channel","voice"),
  db.from("sandy_v2_release_control").select("public_version").eq("id",1).single()
 ]);
 const {data:temporalFacts}=await db.rpc("sandy_temporal_current",{p_customer_id:session.owner_customer_id,p_limit:20});
 const temporalContext=(temporalFacts||[]).filter((x:any)=>x.sensitivity!=="sensitive").map((x:any)=>({predicate:x.predicate,value:x.value,state:x.state,confidence:x.confidence,observed_at:x.observed_at,valid_until:x.valid_until})); 
 return reply({ok:true,result:data,temporal_context:temporalContext,central_context:{policy_version:shared.data?.policy_version||null,instructions:shared.data?.instructions||null,channel:"voice",capabilities:capabilities.data||[],public_version:release.data?.public_version||null}});

});
