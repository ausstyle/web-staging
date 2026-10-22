export async function handleCollab(db:any,message:any):Promise<boolean>{
 const buttonAction=message.message_type==="interactive"?String(message.payload?.interactive?.button_reply?.id||""):"";
 let original=buttonAction||String(message.body||"").trim();
 if(/^the image$/i.test(original)){
  const {data:previous}=await db.from("sandy_whatsapp_messages").select("body,direction").eq("sender_wa_id",String(message.sender_wa_id)).in("direction",["inbound","outbound"]).neq("meta_message_id",String(message.meta_message_id)).order("created_at",{ascending:false}).limit(4);
  const earlier=(previous||[]).find((x:any)=>x.direction==="inbound");
  const name=String(earlier?.body||"").match(/to\s+([a-z]+)(?:['’]s\s+whatsapp)?[!? .]*$/i)?.[1];
  if(name)original="share the image with "+name;
 }
 original=original.replace(/^(?:can you\s+)?forward this to ([a-z]+)['’]s whatsapp[?!.]*$/i,"share the image with $1");
 const matches=/^(?:please\s+)?(?:share|send|forward)\s+(?:with|to)\s+[a-z][a-z ]{1,55}[.!?]*$/i.test(original)||original==="SANDY_CANCEL_SHARE"||/^SHARE\s+\d{6}$/i.test(original)||/\b(?:share|send|forward)\b.{0,180}\b(?:image|photo|picture)\b|\b(?:share|send|forward)\b\s+(?:this|that|it)\s+(?:to|with)\s+.{2,90}$|^\s*(?:please\s+)?(?:create|start|make|set up)\s+(?:(?:a|new)\s+)?(?:whatsapp\s+)?group\b|^\s*(?:SHARE|GROUP)\s+\d{6}\b/i.test(original);
 const selfImageRequest=/\b(?:send|show|give|share)\s+(?:me|us)\b.{0,110}\b(?:image|photo|picture)\b|\b(?:image|photo|picture)\b.{0,110}\b(?:to|with)\s+(?:me|us|you)\b/i.test(original);
 if(!matches||selfImageRequest||!["text","interactive"].includes(message.message_type)||!message.meta_message_id)return false;
 const token=Deno.env.get("WHATSAPP_ACCESS_TOKEN")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",url=Deno.env.get("SUPABASE_URL")||"";
 if(!service||!url)return false;
 const id=String(message.meta_message_id),wa=String(message.sender_wa_id),phone=String(message.phone_number_id);
 const {data:claim,error:ce}=await db.from("sandy_whatsapp_messages").update({processing_status:"processing"}).eq("meta_message_id",id).eq("processing_status","received").select("id");
 if(ce)throw Error("collab_claim_"+ce.code);
 if(!claim?.length)return true;
 let text="";let confirmationButton="";let imageHeader:any=null;
 try{
  const {data:identity,error:ie}=await db.from("sandy_whatsapp_identities").select("customer_id,verification_status,allowed_scopes,verified_at").eq("wa_id",wa).maybeSingle();
  const verified=!ie&&identity?.customer_id&&identity.verification_status==="verified"&&Date.now()-Date.parse(identity.verified_at)<90*86400000&&(identity.allowed_scopes||[]).includes("people_share");
  if(!verified){await db.from("sandy_whatsapp_messages").update({processing_status:"received"}).eq("meta_message_id",id).eq("processing_status","processing");return false;}
  const r=await fetch(url+"/functions/v1/sandy-share-collaboration",{method:"POST",headers:{authorization:"Bearer "+service,apikey:service,"content-type":"application/json"},body:JSON.stringify({customer_id:identity.customer_id,wa_id:wa,text:original,inbound_id:id,phone_id:phone}),signal:AbortSignal.timeout(23000)});
  if(!r.ok){console.error("collab_route_http",r.status);text="I couldn't open the sharing feature just now. Nothing was sent."}
  else{const result=await r.json();if(result.handled===true){text=String(result.reply||"I couldn't finish the sharing request.");confirmationButton=/^SHARE \d{6}$/.test(String(result.button_id||""))?String(result.button_id):"";imageHeader=result.image_header&&(/^\d{5,30}$/.test(String(result.image_header.id||""))||/^https:\/\//.test(String(result.image_header.link||"")))?result.image_header:null;}else{text="I can help share that on WhatsApp, but I couldn't identify the item and recipient. Please specify what to share and with whom. Nothing has been sent.";}}
 }catch(e){console.error("collab_route_error",String(e).slice(0,170));text="Sharing isn't available just now. Nothing has been sent.";}
 if(!token){await db.from("sandy_whatsapp_messages").update({processing_status:"configuration_error"}).eq("meta_message_id",id);return true;}
 const {data:claimedSend,error:se}=await db.from("sandy_whatsapp_messages").update({processing_status:"sending"}).eq("meta_message_id",id).eq("processing_status","processing").select("id");
 if(se||!claimedSend?.length)return true;
 try{
  const r=await fetch("https://graph.facebook.com/v25.0/"+phone+"/messages",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(confirmationButton?{messaging_product:"whatsapp",to:wa,type:"interactive",interactive:{type:"button",...(imageHeader?{header:{type:"image",image:imageHeader}}:{}),body:{text:text.slice(0,1024)},action:{buttons:[{type:"reply",reply:{id:confirmationButton,title:"Share"}},{type:"reply",reply:{id:"SANDY_CANCEL_SHARE",title:"Cancel"}}]}}}:{messaging_product:"whatsapp",to:wa,type:"text",text:{preview_url:false,body:text.slice(0,3500)}}),signal:AbortSignal.timeout(15000)});
  const data=await r.json().catch(()=>({}));const outId=String(data.messages?.[0]?.id||"");
  if(!r.ok||!outId){await db.from("sandy_whatsapp_messages").update({processing_status:"send_failed"}).eq("meta_message_id",id);console.error("collab_reply_send_failed",r.status);return true;}
  const {error:logError}=await db.from("sandy_whatsapp_messages").upsert({meta_message_id:outId,phone_number_id:phone,sender_wa_id:wa,direction:"outbound",message_type:confirmationButton?"interactive":"text",body:text,payload:{reply_to:id,source:"collaboration",confirmation_button:Boolean(confirmationButton)},processing_status:"submitted"},{onConflict:"meta_message_id",ignoreDuplicates:true});
  if(logError)console.error("collab_reply_log",logError.code);
  await db.from("sandy_whatsapp_messages").update({processing_status:"replied"}).eq("meta_message_id",id).eq("processing_status","sending");
 }catch(e){console.error("collab_reply_uncertain",String(e).slice(0,120));await db.from("sandy_whatsapp_messages").update({processing_status:"send_uncertain"}).eq("meta_message_id",id);}
 return true;
}

export async function handleSharedImageReply(db:any,message:any):Promise<boolean>{
 const quoted=String(message.payload?.context?.id||"");
 const sender=String(message.sender_wa_id||"");
 const text=String(message.body||"").trim();
 if(!quoted||!sender||message.message_type!=="text"||!text||text.length>1200||!message.meta_message_id)return false;
 const {data:shared,error:sharedError}=await db.from("sandy_whatsapp_messages").select("id,payload,phone_number_id,sender_wa_id").eq("meta_message_id",quoted).eq("direction","outbound").eq("message_type","image").maybeSingle();
 if(sharedError||!shared?.payload?.share_request_id||shared.sender_wa_id!==sender||shared.phone_number_id!==message.phone_number_id)return false;
 const {data:request,error:re}=await db.from("sandy_share_requests").select("id,owner_customer_id,origin_wa_id,person_id,contact_method_id,status").eq("id",shared.payload.share_request_id).maybeSingle();
 if(re||!request||!["submitted","delivered"].includes(request.status)||request.origin_wa_id===sender)return false;
 const {data:method}=await db.from("sandy_person_contact_methods").select("normalized_address").eq("id",request.contact_method_id).eq("person_id",request.person_id).eq("owner_customer_id",request.owner_customer_id).maybeSingle();
 if(!method||method.normalized_address!==sender)return false;
 const {data:claimed}=await db.from("sandy_whatsapp_messages").update({processing_status:"processing"}).eq("meta_message_id",message.meta_message_id).eq("processing_status","received").select("id");
 if(!claimed?.length)return true;
 const token=Deno.env.get("WHATSAPP_ACCESS_TOKEN")||"";
 const phone=String(message.phone_number_id||"");
 const reply=async(recipient:string,body:string)=>{
  const response=await fetch("https://graph.facebook.com/v25.0/"+phone+"/messages",{method:"POST",headers:{"authorization":"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:recipient,type:"text",text:{preview_url:false,body}}),signal:AbortSignal.timeout(12000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.messages?.[0]?.id)throw Error("relay_send_rejected_"+response.status);
  const id=String(data.messages[0].id);
  await db.from("sandy_whatsapp_messages").upsert({meta_message_id:id,phone_number_id:phone,sender_wa_id:recipient,direction:"outbound",message_type:"text",body,payload:{source:"image_share_reply",share_request_id:request.id,reply_to:message.meta_message_id},processing_status:"submitted"},{onConflict:"meta_message_id",ignoreDuplicates:true});
 };
 try{
  const {data:open,error:oe}=await db.from("sandy_whatsapp_messages").select("id").eq("sender_wa_id",request.origin_wa_id).eq("phone_number_id",phone).eq("direction","inbound").gte("created_at",new Date(Date.now()-24*3600000).toISOString()).limit(1);
  if(oe)throw Error("window_lookup");
  if(!open?.length){
   await reply(sender,"I have your reply, but I can't forward it until the sender's WhatsApp messaging window reopens. Please contact them directly for now.");
   await db.from("sandy_whatsapp_messages").update({processing_status:"replied"}).eq("meta_message_id",message.meta_message_id).eq("processing_status","processing");
   return true;
  }
  const {data:person}=await db.from("sandy_people").select("display_name").eq("id",request.person_id).eq("owner_customer_id",request.owner_customer_id).maybeSingle();
  const name=String(person?.display_name||"Your contact").slice(0,80);
  await reply(request.origin_wa_id,name+" replied to your shared image:\n\n"+text);
  await db.from("sandy_whatsapp_messages").update({processing_status:"replied"}).eq("meta_message_id",message.meta_message_id).eq("processing_status","processing");
  return true;
 }catch(e){
  console.error("image_share_reply_relay",String(e).slice(0,100));
  await db.from("sandy_whatsapp_messages").update({processing_status:"send_uncertain"}).eq("meta_message_id",message.meta_message_id).eq("processing_status","processing");
  return true;
 }
}

