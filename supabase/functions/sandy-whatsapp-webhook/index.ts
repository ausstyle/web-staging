import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {enc,reply,eq,required,sha256} from "./helpers.ts";
import {deliver} from "./deliver.ts";
import {handleCollab,handleSharedImageReply} from "./collab-route.ts";
Deno.serve(async req=>{
 const verify=required("WHATSAPP_VERIFY_TOKEN");
 if(req.method==="GET"){const u=new URL(req.url);return verify&&u.searchParams.get("hub.mode")==="subscribe"&&eq(u.searchParams.get("hub.verify_token")||"",verify)?reply(u.searchParams.get("hub.challenge")||""):reply("Forbidden",403)}
 if(req.method!=="POST")return reply("Method not allowed",405);
 const secret=required("WHATSAPP_APP_SECRET");if(!secret)return reply("Not configured",503);
 const raw=await req.text(),sig=req.headers.get("x-hub-signature-256")||"";
 const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(raw)));
 const expected="sha256="+Array.from(digest).map(v=>v.toString(16).padStart(2,"0")).join("");
 if(!eq(sig,expected))return reply("Invalid signature",403);
 let data:any;try{data=JSON.parse(raw)}catch{return reply("Invalid JSON",400)}
 if(data.object!=="whatsapp_business_account")return reply("ignored");
 const url=required("SUPABASE_URL"),service=required("SUPABASE_SERVICE_ROLE_KEY");if(!url||!service)return reply("Storage not configured",503);
 const db=createClient(url,service);
 const records:any[]=[];
 const callRecords:any[]=[];
 for(const entry of data.entry||[])for(const change of entry.changes||[]){
  const v=change.value||{},phone=v.metadata?.phone_number_id||"";
  for(const m of v.messages||[])if(m.id&&!m.group_id)records.push({meta_message_id:m.id,phone_number_id:phone,sender_wa_id:m.from||null,direction:"inbound",message_type:m.type||"unknown",body:m.text?.body||m.interactive?.button_reply?.id||null,payload:m,processing_status:"received"});
  for(const s of v.statuses||[])if(s.id)records.push({meta_message_id:s.id+":"+s.status,phone_number_id:phone,sender_wa_id:s.recipient_id||null,direction:"status",message_type:s.status,body:null,payload:s,processing_status:"recorded"});
  for(const call of v.calls||[])if(call.id&&phone)callRecords.push({call_id:String(call.id),event_type:String(call.event||call.status||"unknown"),phone_number_id:String(phone),caller_wa_id:String(call.from||"")||null,metadata:{direction:String(call.direction||""),status:String(call.status||""),has_sdp:Boolean(call.session?.sdp),timestamp:String(call.timestamp||"")}});
 }
 if(callRecords.length){const {error:callError}=await db.from("sandy_whatsapp_call_events").upsert(callRecords,{onConflict:"call_id,event_type",ignoreDuplicates:true});if(callError){console.error("whatsapp_call_persist",callError.code);return reply("Retry later",503)}}
 if(records.length){const {error}=await db.from("sandy_whatsapp_messages").upsert(records,{onConflict:"meta_message_id",ignoreDuplicates:true});if(error){console.error("whatsapp_persist",error.code);return reply("Retry later",503)}
  for(const r of records.filter(x=>x.direction==="status")){const status=String(r.message_type);if(!["sent","delivered","read","failed"].includes(status))continue;
    const next=status==="failed"?"delivery_failed":status;
    // Atomic progression: concurrent sent/delivered/read webhooks must never downgrade status.
    const eligible:any={sent:["submitted"],delivered:["submitted","sent"],read:["submitted","sent","delivered"],delivery_failed:["submitted","sent","delivered"]};
    const {error:e}=await db.from("sandy_whatsapp_messages").update({processing_status:next}).eq("meta_message_id",String(r.payload.id)).eq("direction","outbound").in("processing_status",eligible[next]||[]);
    if(e)console.error("whatsapp_status_update",e.code);
    if(["delivered","read","failed"].includes(status)){
      const shareStatus=status==="failed"?"failed":"delivered";
      const {data:shared,error:shareError}=await db.from("sandy_share_requests").update({status:shareStatus,updated_at:new Date().toISOString(),...(shareStatus==="failed"?{error_code:"whatsapp_delivery_failed"}:{})}).eq("provider_message_id",String(r.payload.id)).eq("status","submitted").select("id,owner_customer_id,person_id");
      if(shareError)console.error("whatsapp_share_delivery",shareError.code);
      else for(const sh of shared||[]){
        const {error:auditError}=await db.from("sandy_people_audit_events").insert({owner_customer_id:sh.owner_customer_id,person_id:sh.person_id,share_request_id:sh.id,actor_channel:"system",event_type:shareStatus==="failed"?"share_delivery_failed":"share_delivered",details:{meta_message_id:String(r.payload.id)}});
        if(auditError)console.error("whatsapp_share_delivery_audit",auditError.code);
      }
    }
  }
 }
 const incoming=records.filter(x=>x.direction==="inbound");
 if(incoming.length)await Promise.all(incoming.map(async x=>{const {data:stored,error}=await db.from("sandy_whatsapp_messages").select("*").eq("meta_message_id",x.meta_message_id).maybeSingle();if(!error&&stored){const sharedReply=await handleSharedImageReply(db,stored);if(!sharedReply){const routed=await handleCollab(db,stored);if(!routed)await deliver(db,stored)}}}));
 if(incoming.length)try{
  const work=async()=>{for(const m of incoming.slice(0,8)){
   const {data:owner}=await db.from("sandy_whatsapp_identities").select("customer_id,verification_status,allowed_scopes").eq("wa_id",m.sender_wa_id).maybeSingle();
   if(owner?.verification_status!=="verified"||!owner.allowed_scopes?.includes("memory_read"))continue;
   const response=await fetch(url+"/functions/v1/sandy-temporal-ingest",{method:"POST",headers:{"Authorization":"Bearer "+service,"Content-Type":"application/json"},body:JSON.stringify({source_channel:"whatsapp",source_ref:m.meta_message_id,customer_id:owner.customer_id,limit:3}),signal:AbortSignal.timeout(25000)});
   if(!response.ok)console.error("whatsapp_temporal_ingest_http",response.status);
  }};
  EdgeRuntime.waitUntil(work().catch(e=>console.error("whatsapp_temporal_ingest",String(e).slice(0,180))));
 }catch(e){console.error("whatsapp_temporal_enqueue_failed",String(e).slice(0,150));}
 return reply("ok");
});
