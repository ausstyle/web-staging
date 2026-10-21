import {examinerUtf16Prefix} from "./worker_examiner_text.ts";
// Shared actual-record reader. No caller can supply arbitrary model context.
export const examinerSources = Object.freeze([
 {channel:"web",table:"sandy_web_turns",fields:"id,customer_id,created_at,question,response",user:"question",answer:"response"},
 {channel:"whatsapp",table:"sandy_whatsapp_messages",fields:"id,created_at,direction,body,processing_status,sender_wa_id",user:"body",answer:""},
 {channel:"email",table:"email_messages",fields:"id,customer_id,created_at,conversation_id,direction,subject,body_text,delivery_status",user:"body_text",answer:""},
 {channel:"voice",table:"sandy_voice_transcript_turns",fields:"id,owner_customer_id,session_id,created_at,role,text",user:"text",answer:""},
] as const);
export type ExaminerChannel = typeof examinerSources[number]["channel"];
type Obj=Record<string,any>;
export const examinerInbound=(channel:string,x:Obj)=>channel==="web"?Boolean(x.question):channel==="voice"?["user","human"].includes(String(x.role||"").toLowerCase()):["inbound","incoming","in"].includes(String(x.direction||"").toLowerCase());
export const compareExaminerSourceId=(a:string,b:string)=>/^\d+$/.test(a)&&/^\d+$/.test(b)?(BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0):a.localeCompare(b);
export async function readExaminerContext(db:any,channel:ExaminerChannel,sourceId:string){
 const cfg=examinerSources.find(x=>x.channel===channel);if(!cfg)throw Error("examiner_channel_unsupported");
 const source=await db.from(cfg.table).select(cfg.fields).eq("id",sourceId).maybeSingle();
 if(source.error||!source.data||!examinerInbound(channel,source.data))throw Error("examiner_actual_inbound_source_required");
 const x=source.data,when=String(x.created_at),question=examinerUtf16Prefix(String(channel==="email"?[x.subject,x.body_text].filter(Boolean).join("\n"):x[cfg.user]||""),3000);
 if(!question.trim())throw Error("examiner_actual_question_required");
 let answer=examinerUtf16Prefix(String(cfg.answer?x[cfg.answer]||"":""),3500),receipt=answer?"paired_web_turn":"unavailable";
 const customer=channel==="whatsapp"?null:(x.customer_id||x.owner_customer_id||null);
 if(channel==="email"&&x.conversation_id){
  const next=await db.from("email_messages").select("id,customer_id,direction,body_text,created_at,delivery_status").eq("conversation_id",x.conversation_id).gt("created_at",when).order("created_at",{ascending:true}).limit(15);if(next.error)throw Error("email:reply_lookup_failed");
  const y=(next.data||[]).find((v:Obj)=>["outbound","outgoing","out"].includes(String(v.direction).toLowerCase()));
  if(y){if((y.customer_id||null)!==customer)throw Error("email:reply_tenant_mismatch");answer=examinerUtf16Prefix(String(y.body_text||""),3500);receipt="same_conversation_outbound";}
 }
 if(channel==="voice"&&x.session_id){
  const next=await db.from("sandy_voice_transcript_turns").select("id,owner_customer_id,role,text,created_at").eq("session_id",x.session_id).gt("created_at",when).order("created_at",{ascending:true}).limit(15);if(next.error)throw Error("voice:reply_lookup_failed");
  const y=(next.data||[]).find((v:Obj)=>["assistant","sandy"].includes(String(v.role).toLowerCase()));
  if(y){if((y.owner_customer_id||null)!==customer)throw Error("voice:reply_tenant_mismatch");answer=examinerUtf16Prefix(String(y.text||""),3500);receipt="same_session_assistant";}
 }
 if(channel==="whatsapp"&&x.sender_wa_id){
  const next=await db.from("sandy_whatsapp_messages").select("id,body,direction,created_at,processing_status").eq("sender_wa_id",x.sender_wa_id).gt("created_at",when).order("created_at",{ascending:true}).limit(12);if(next.error)throw Error("whatsapp:reply_lookup_failed");
  const inbound=(next.data||[]).find((v:Obj)=>v.direction==="inbound"),candidate=(next.data||[]).find((v:Obj)=>v.direction==="outbound"&&(!inbound||new Date(v.created_at)<=new Date(inbound.created_at)));
  if(candidate&&new Date(candidate.created_at).getTime()-new Date(when).getTime()<180000){answer=examinerUtf16Prefix(String(candidate.body||""),3500);receipt="same_sender_outbound_before_next_inbound";}
 }
 let continuationText="",recentContext:Obj[]=[];
 if(channel==="whatsapp"&&x.sender_wa_id){
  const near=await db.from("sandy_whatsapp_messages").select("direction,body,created_at").eq("sender_wa_id",x.sender_wa_id).lt("created_at",when).order("created_at",{ascending:false}).limit(8);if(near.error)throw Error("whatsapp:continuation_lookup_failed");
  const preceding=(near.data||[]).filter((v:Obj)=>["inbound","outbound"].includes(v.direction));
  if(preceding[0]?.direction==="inbound"&&new Date(when).getTime()-new Date(preceding[0].created_at).getTime()<90000)continuationText=examinerUtf16Prefix(String(preceding[0].body||""),700);
  // Both archived lookups are the same fixed query. Reuse the actual result so
  // continuation and recent context cannot observe two different read snapshots.
  recentContext=[...(near.data||[])].reverse().filter((v:Obj)=>["inbound","outbound"].includes(v.direction)).map((v:Obj)=>({role:v.direction,text:examinerUtf16Prefix(String(v.body||""),600)}));
 }
 return{source:x,customerId:customer,context:{channel,question:continuationText?continuationText+" "+question:question,answer,receipt,recentContext,continuation_joined:Boolean(continuationText)}};
}
