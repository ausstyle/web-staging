import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
Deno.serve(async(req)=>{
 const json=(status:number,o:unknown)=>new Response(JSON.stringify(o),{status,headers:{"content-type":"application/json"}});
 if(req.method!=="POST")return json(405,{error:"method"});
 const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!secret||req.headers.get("authorization")!=="Bearer "+secret)return json(403,{error:"auth"});
 const db=createClient(Deno.env.get("SUPABASE_URL")!,secret);
 const {meta_message_id}=await req.json();
 const {data:m,error:e}=await db.from("sandy_whatsapp_messages").select("meta_message_id,sender_wa_id,body,direction,message_type").eq("meta_message_id",meta_message_id).maybeSingle();
 if(e||!m||m.direction!=="inbound"||m.message_type!=="text")return json(404,{error:"message"});
 const {data:i}=await db.from("sandy_whatsapp_identities").select("customer_id,verification_status,verified_at,allowed_scopes").eq("wa_id",m.sender_wa_id).maybeSingle();
 if(!i?.customer_id||i.verification_status!=="verified"||!i.verified_at||Date.now()-Date.parse(i.verified_at)>90*86400000||!(i.allowed_scopes||[]).includes("memory_read"))return json(200,{skipped:"unverified"});
 const message=String(m.body||"").slice(0,3500);
 if(message.length<10||/^(hi|hello|hey|ok|okay|yes|no|thanks|thank you|yep|yeah|call me|try again)[.! ]*$/i.test(message))return json(200,{skipped:"no durable statement"});
 const {data:existing}=await db.from("email_ai_profile_facts").select("fact_key,fact_value").eq("customer_id",i.customer_id).eq("status","active").limit(150);
 const prompt="Extract durable, useful customer facts explicitly stated in this WhatsApp message: identity, school, past activities, favourite restaurants, cuisine preferences, dislikes, hobbies, relationships, named contact details, professional/project decisions, and recurring preferences. Save only statements about the customer or their explicitly identified contacts. Ignore ordinary tasks, questions, assistant instructions, hypothetical statements, jokes, quotations, one-off plans and third-party facts not linked to the customer. Never infer or fabricate. Do not store passwords, codes, bank details, government IDs or sensitive medical/protected attributes. Existing facts supplied must not be duplicated. Return a JSON object with facts array, each {key:string,value:string}. Use short stable snake_case keys and explicit third-party prefixes e.g. contact_jemma_phone; max 8 facts. If none return {facts:[]}.";
 const ai=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"authorization":"Bearer "+Deno.env.get("OPENAI_API_KEY"),"content-type":"application/json"},body:JSON.stringify({model:"gpt-5.2",instructions:prompt,input:"Return a JSON object. "+JSON.stringify({message,existing_facts:existing||[]}),text:{format:{type:"json_object"}},max_output_tokens:600}),signal:AbortSignal.timeout(18000)});
 if(!ai.ok){console.error("whatsapp_model_http",ai.status,(await ai.text()).slice(0,350));return json(502,{error:"model",status:ai.status});}
 const out=await ai.json();const raw=(out.output||[]).flatMap((x:any)=>(x.content||[]).filter((c:any)=>c.type==="output_text").map((c:any)=>c.text)).join("");
 const facts=JSON.parse(raw).facts||[];let saved=0;
 for(const f of facts.slice(0,8)){
  if(!/^[a-z][a-z0-9_]{2,80}$/.test(f.key)||typeof f.value!=="string"||f.value.length<3||f.value.length>500)continue;
  if((existing||[]).some((x:any)=>x.fact_key===f.key&&x.fact_value===f.value))continue;
  const {error:we}=await db.rpc("sandy_voice_save_explicit_memory",{p_customer_id:i.customer_id,p_fact_key:f.key,p_fact_value:f.value});
  if(we)return json(500,{error:"write",code:we.code,saved});
  saved++;
 }
 return json(200,{ok:true,saved});
});