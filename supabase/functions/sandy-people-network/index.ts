import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.55.0";
const response=(obj:any,status=200)=>Response.json(obj,{status,headers:{"cache-control":"no-store"}});
const nameClean=(v:string)=>String(v||"").trim().replace(/[.!?\s]+$/g,"").replace(/^["'“”]+|["'“”]+$/g,"").replace(/\s+/g," ");
const nameKey=(v:string)=>nameClean(v).toLocaleLowerCase("en");
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return response({error:"method_not_allowed"},405);
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!key||req.headers.get("authorization")!=="Bearer "+key)return response({error:"unauthorized"},403);
 const url=Deno.env.get("SUPABASE_URL")||"";
 const token=Deno.env.get("WHATSAPP_ACCESS_TOKEN")||"";
 if(!url)return response({error:"backend_not_configured"},503);
 let input:any;try{input=await req.json()}catch{return response({error:"bad_json"},400)}
 const owner=String(input.customer_id||""),wa=String(input.wa_id||""),text=String(input.text||"").trim().slice(0,4000);
 const mid=String(input.inbound_id||""),phone=String(input.phone_id||"");
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(owner)||!/^\d{8,15}$/.test(wa)||!mid||!phone||!text)return response({error:"bad_arguments"},400);
 const db=createClient(url,key,{auth:{persistSession:false}});
 const {data:identity,error:identityError}=await db.from("sandy_whatsapp_identities").select("customer_id,verification_status,verified_at,allowed_scopes").eq("wa_id",wa).maybeSingle();
 if(identityError)return response({error:"identity_lookup_failed"},500);
 const verified=identity?.customer_id===owner&&identity?.verification_status==="verified"&&identity?.verified_at&&(Date.now()-Date.parse(identity.verified_at))<90*86400000;
 if(!verified)return response({handled:false});
 const scopes=new Set<string>(identity.allowed_scopes||[]);
 const canManage=scopes.has("people_manage"),canShare=scopes.has("people_share");
 const handled=(reply:string)=>response({handled:true,reply});
 const audit=async(event_type:string,person_id:string|null=null,details:any={})=>{
  const {error}=await db.from("sandy_people_audit_events").insert({owner_customer_id:owner,person_id,actor_channel:"whatsapp",actor_id:wa,event_type,details});
  if(error)console.error("sandy_people_audit",error.code);
 };
 const list=async()=>{const {data,error}=await db.from("sandy_people").select("id,display_name,nickname,relationship_type").eq("owner_customer_id",owner).eq("status","active").order("display_name").limit(250);if(error)throw new Error("people_list_"+error.code);return data||[]};
 const find=async(s:string)=>{const ps=await list(),n=nameKey(s),matches=ps.filter((p:any)=>nameKey(p.display_name)===n||(p.nickname&&nameKey(p.nickname)===n));return {person:matches.length===1?matches[0]:null,ambiguous:matches.length>1}};
 const recentWindow=async(recipient:string)=>{
  const {data,error}=await db.from("sandy_whatsapp_messages").select("id").eq("phone_number_id",phone).eq("sender_wa_id",recipient).eq("direction","inbound").gte("created_at",new Date(Date.now()-86400000).toISOString()).limit(1);
  if(error)throw new Error("share_window_"+error.code);return Boolean(data?.length);
 };
 try{
  if(canManage&&/^(?:show|list)(?: me)? (?:my )?(?:people|contacts|network)\??$/i.test(text)){
   const ps=await list();return handled(ps.length?"Your contacts:\n"+ps.slice(0,30).map((p:any)=>"- "+p.display_name+" ("+p.relationship_type+")").join("\n")+(ps.length>30?"\nShowing 30.":""):"You haven't added anyone yet. Try 'Chris is my friend'.");
  }

  // In one message, capture the relationship and WhatsApp number; the DB trigger
  // privately resolves any verified Sandy user account matching this number.
  const combined=canManage?text.match(/^(.{2,100}?)\s+is\s+(?:(?:my|a|an)\s+)?(good friend|close friend|friend|family|relative|colleague|client|lawyer|accountant|professional contact|contact)\s*(?:,|;|\band\b)\s+(?:his|her|their)\s+(?:(?:whatsapp|phone)\s+)?number\s*(?:is|:)\s*(\+?[\d\s().-]{7,30})\s*$/i):null;
  if(combined){
   const nm=nameClean(combined[1]);
   const term=combined[2].toLowerCase();
   const kind=/friend/.test(term)?"friend":/family|relative/.test(term)?"family":/colleague/.test(term)?"colleague":/client/.test(term)?"client":/lawyer|accountant|professional/.test(term)?"professional":"contact";
   const number=combined[3].trim(),digits=number.replace(/\D/g,"");
   if(nm.length<2||nm.length>180)return handled("Please give me a valid contact name.");
   if(!/^[1-9]\d{7,14}$/.test(digits))return handled("I need the full international WhatsApp number including country code.");
   const found=await find(nm);
   if(found.ambiguous)return handled("I have multiple contacts matching that name. Please use their full name.");
   const {data:ownedNumber,error:ne}=await db.from("sandy_person_contact_methods").select("id,person_id").eq("owner_customer_id",owner).eq("channel","whatsapp").eq("normalized_address",digits).maybeSingle();
   if(ne)throw new Error("combined_number_lookup_"+ne.code);
   if(ownedNumber&&(!found.person||ownedNumber.person_id!==found.person.id))return handled("That WhatsApp number is already assigned to a different contact. I haven't changed either record.");
   let person=found.person;
   if(!person){
    const {data,error}=await db.from("sandy_people").insert({owner_customer_id:owner,display_name:nm,relationship_type:kind,source:"explicit_user"}).select("id,display_name").single();
    if(error)throw new Error("combined_person_create_"+error.code);person=data;
    await audit("person_created",person.id,{relationship_type:kind});
   }else{
    const {error}=await db.from("sandy_people").update({relationship_type:kind,updated_at:new Date().toISOString()}).eq("id",person.id).eq("owner_customer_id",owner);
    if(error)throw new Error("combined_relationship_update_"+error.code);
    await audit("relationship_updated",person.id,{relationship_type:kind});
   }
   if(!ownedNumber){
    const {data:current,error:ce}=await db.from("sandy_person_contact_methods").select("id").eq("owner_customer_id",owner).eq("person_id",person.id).eq("channel","whatsapp").limit(1);
    if(ce)throw new Error("combined_existing_contact_"+ce.code);
    const {error:ie}=await db.from("sandy_person_contact_methods").insert({owner_customer_id:owner,person_id:person.id,channel:"whatsapp",address:number,normalized_address:digits,identity_status:"user_provided",wa_opt_in_status:"unknown",is_primary:!current?.length});
    if(ie)throw new Error("combined_contact_create_"+ie.code);
    await audit("contact_method_added",person.id,{channel:"whatsapp",suffix:digits.slice(-4)});
   }
   return handled("Saved "+person.display_name+" as your "+kind+" with WhatsApp ending "+digits.slice(-4)+". I'll privately recognise a matching verified Sandy account, but this doesn't share data or establish a mutual friendship.");
  }
  const rel=canManage?(text.match(/^(?:remember (?:that )?|add )?(.{2,100}?)\s+(?:is|as)\s+(?:(?:my|a|an)\s+)?(good friend|close friend|friend|family|relative|colleague|client|lawyer|accountant|professional contact|contact)\.?$/i)||text.match(/^(?:i'm|i’m|i am)\s+friends with\s+(.{2,100}?)\.?$/i)):null;
  if(rel){
   const nm=nameClean(rel[1]),word=rel[2]||"friend";
   const type=/friend/i.test(word)?"friend":/family|relative/i.test(word)?"family":/colleague/i.test(word)?"colleague":/client/i.test(word)?"client":/lawyer|accountant|professional/i.test(word)?"professional":"contact";
   if(nm.length<2)return handled("Please tell me their name.");
   const f=await find(nm);
   if(f.ambiguous)return handled("More than one contact matches that name. Please use their full name.");
   if(f.person){
    const {error}=await db.from("sandy_people").update({relationship_type:type,updated_at:new Date().toISOString()}).eq("id",f.person.id).eq("owner_customer_id",owner);
    if(error)throw new Error("people_update_"+error.code);
    await audit("relationship_updated",f.person.id,{relationship_type:type});return handled("Got it — "+f.person.display_name+" is saved as your "+type+". They don't get access to anything.");
   }
   const {data,error}=await db.from("sandy_people").insert({owner_customer_id:owner,display_name:nm,relationship_type:type,source:"explicit_user"}).select("id").single();
   if(error)throw new Error("people_create_"+error.code);
   await audit("person_created",data.id,{relationship_type:type});return handled("Got it — "+nm+" is saved as your "+type+". Nothing's been shared.");
  }
  const introducedQuery=canManage?text.match(/^who introduced me to (.{2,100}?)\??$/i):null;
  if(introducedQuery){
   const f=await find(nameClean(introducedQuery[1]));
   if(f.ambiguous)return handled("Which person do you mean? There are duplicate names.");
   if(!f.person)return handled("I haven't saved that person yet.");
   const {data:edges,error}=await db.from("sandy_person_links").select("from_person_id").eq("owner_customer_id",owner).eq("to_person_id",f.person.id).eq("link_type","introduced_me_to");
   if(error)throw new Error("people_intro_read_"+error.code);
   const ids=new Set((edges||[]).map((v:any)=>v.from_person_id));
   const people=await list(),names=people.filter((p:any)=>ids.has(p.id)).map((p:any)=>p.display_name);
   return handled(names.length?names.join(", ")+" introduced you to "+f.person.display_name+".":"I haven't recorded who introduced you to "+f.person.display_name+".");
  }
  const intro=canManage?text.match(/^(.{2,100}?)\s+introduced me to\s+(.{2,100}?)\.?$/i):null;
  const association=canManage&&!intro?(text.match(/^(.{2,100}?)\s+(knows|works with|is friends with)\s+(.{2,100}?)\.?$/i)||text.match(/^(.{2,100}?)\s+and\s+(.{2,100}?)\s+are friends\.?$/i)):null;
  if(intro||association){
   const first=nameClean((intro||association)![1]);
   const second=nameClean(intro?intro[2]:association![3]||association![2]);
   if(nameKey(first)===nameKey(second))return handled("I'll need two different people to record that connection.");
   const relationship=intro?"introduced_me_to":/works with/i.test(text)?"works_with":/friends/i.test(text)?"friends_with":"knows";
   const ensure=async(nm:string)=>{
    const f=await find(nm);
    if(f.ambiguous)throw new Error("ambiguous_person_name");
    if(f.person)return f.person;
    const {data,error}=await db.from("sandy_people").insert({owner_customer_id:owner,display_name:nm,relationship_type:"contact",source:"explicit_user"}).select("id,display_name").single();
    if(error)throw new Error("people_link_create_"+error.code);
    await audit("person_created",data.id,{relationship_type:"contact"});
    return data;
   };
   const a=await ensure(first),b=await ensure(second);
   const {error}=await db.from("sandy_person_links").upsert({owner_customer_id:owner,from_person_id:a.id,to_person_id:b.id,link_type:relationship,source:"explicit_user",updated_at:new Date().toISOString()},{onConflict:"owner_customer_id,from_person_id,to_person_id,link_type"});
   if(error)throw new Error("people_link_save_"+error.code);
   await audit("relationship_link_saved",a.id,{to_person_id:b.id,link_type:relationship});
   return handled(intro?"Saved — "+a.display_name+" introduced you to "+b.display_name+".":"Saved the connection between "+a.display_name+" and "+b.display_name+". No access or sharing permissions were given.");
  }
  const ph=canManage?text.match(/^(.{2,100}?)['’]s\s+(?:(?:whatsapp|phone)\s+(?:number\s+)?|number\s+)(?:is|:)\s*(\+?[\d\s().-]{7,30})\s*$/i):null;
  if(ph){
   const nm=nameClean(ph[1]),digits=ph[2].replace(/\D/g,"");
   if(!/^[1-9]\d{7,14}$/.test(digits))return handled("Please include the full international WhatsApp number, starting with the country code.");
   const f=await find(nm);if(f.ambiguous)return handled("More than one person matches that name. Please use their full name.");
   let p=f.person;
   if(!p){const {data,error}=await db.from("sandy_people").insert({owner_customer_id:owner,display_name:nm,relationship_type:"contact",source:"explicit_user"}).select("id,display_name").single();if(error)throw new Error("people_create_"+error.code);p=data;await audit("person_created",p.id,{relationship_type:"contact"});}
   const {data:existing,error:e}=await db.from("sandy_person_contact_methods").select("id,person_id").eq("owner_customer_id",owner).eq("channel","whatsapp").eq("normalized_address",digits).maybeSingle();
   if(e)throw new Error("channel_lookup_"+e.code);
   if(existing&&existing.person_id!==p.id)return handled("That number is already saved to a different contact. I haven't changed anything.");
   if(!existing){
    const {data:current,error:curError}=await db.from("sandy_person_contact_methods").select("id").eq("owner_customer_id",owner).eq("person_id",p.id).eq("channel","whatsapp").limit(1);
    if(curError)throw new Error("channel_existing_"+curError.code);
    const {error:ins}=await db.from("sandy_person_contact_methods").insert({owner_customer_id:owner,person_id:p.id,channel:"whatsapp",address:ph[2].trim(),normalized_address:digits,identity_status:"user_provided",wa_opt_in_status:"unknown",is_primary:!current?.length});
    if(ins)throw new Error("channel_create_"+ins.code);
   }
   await audit("contact_method_added",p.id,{channel:"whatsapp",suffix:digits.slice(-4)});
   return handled("Saved "+p.display_name+"'s WhatsApp ending "+digits.slice(-4)+". It hasn't been independently verified. Nothing has been sent.");
  }
  if(canShare&&/^SEND\s+\d{6}$/i.test(text)){
   const code=text.match(/^SEND\s+(\d{6})$/i)![1];
   const {data:ps,error:e}=await db.from("sandy_share_requests").select("*").eq("owner_customer_id",owner).eq("origin_wa_id",wa).eq("status","pending_confirmation").eq("confirmation_code",code).gte("expires_at",new Date().toISOString()).limit(2);
   if(e)throw new Error("share_lookup_"+e.code);
   if(ps?.length!==1)return handled("That confirmation doesn't match a current request. Please prepare the message again.");
   const draft=ps[0];
   const {data:method,error:me}=await db.from("sandy_person_contact_methods").select("normalized_address,wa_opt_in_status,channel").eq("id",draft.contact_method_id).eq("person_id",draft.person_id).eq("owner_customer_id",owner).maybeSingle();
   if(me||!method||method.channel!=="whatsapp"||method.wa_opt_in_status==="opted_out")return handled("I couldn't confirm a permitted WhatsApp destination. Nothing sent.");
   if(!await recentWindow(method.normalized_address)){
    await db.from("sandy_share_requests").update({status:"blocked",error_code:"24h_window_closed",updated_at:new Date().toISOString()}).eq("id",draft.id).eq("status","pending_confirmation");
    await audit("share_blocked",draft.person_id,{request_id:draft.id,reason:"window_closed"});
    return handled("The WhatsApp 24-hour messaging window has closed. Nothing sent. You can message them directly: https://wa.me/"+method.normalized_address);
   }
   const {data:claim,error:ce}=await db.from("sandy_share_requests").update({status:"sending",approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",draft.id).eq("owner_customer_id",owner).eq("status","pending_confirmation").gte("expires_at",new Date().toISOString()).select("id");
   if(ce)throw new Error("share_claim_"+ce.code);
   if(!claim?.length)return handled("That request was already handled. I won't send it again.");
   await audit("share_confirmed",draft.person_id,{request_id:draft.id});
   if(!token)return handled("WhatsApp isn't configured. I've recorded the request, but haven't sent anything.");
   try{
    const r=await fetch("https://graph.facebook.com/v25.0/"+phone+"/messages",{method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:method.normalized_address,type:"text",text:{preview_url:false,body:draft.content_text}}),signal:AbortSignal.timeout(15000)});
    const m=await r.json().catch(()=>({}));
    if(!r.ok){await db.from("sandy_share_requests").update({status:"failed",error_code:"meta_"+String(m?.error?.code||r.status),updated_at:new Date().toISOString()}).eq("id",draft.id);await audit("share_failed",draft.person_id,{request_id:draft.id,status:r.status});return handled("WhatsApp rejected that message. I haven't confirmed any delivery.");}
    const msgid=String(m?.messages?.[0]?.id||"");
    if(!msgid){await db.from("sandy_share_requests").update({error_code:"send_outcome_uncertain"}).eq("id",draft.id);return handled("WhatsApp's response was inconclusive. I won't retry automatically.");}
    const {error:recordError}=await db.from("sandy_whatsapp_messages").upsert({meta_message_id:msgid,phone_number_id:phone,sender_wa_id:method.normalized_address,direction:"outbound",message_type:"text",body:draft.content_text,payload:{source:"network_share",share_request_id:draft.id},processing_status:"submitted"},{onConflict:"meta_message_id",ignoreDuplicates:true});
    if(recordError)console.error("people_share_receipt",recordError.code);
    await db.from("sandy_share_requests").update({status:"submitted",provider_message_id:msgid,updated_at:new Date().toISOString()}).eq("id",draft.id);
    await audit("share_submitted",draft.person_id,{request_id:draft.id,meta_message_id:msgid});return handled("Submitted to WhatsApp. I'll only call it delivered once Meta confirms delivery.");
   }catch(e){await db.from("sandy_share_requests").update({error_code:"send_outcome_uncertain",updated_at:new Date().toISOString()}).eq("id",draft.id);await audit("share_outcome_uncertain",draft.person_id,{request_id:draft.id});console.error("people_share_uncertain",String(e).slice(0,100));return handled("I couldn't confirm the send outcome, so I won't risk a duplicate.");}
  }
  const send=canShare?(text.match(/^send (?:a message )?to (.{2,100}?) on whatsapp:\s*([\s\S]{1,3200})$/i)||text.match(/^send (.{2,100}?) on whatsapp:\s*([\s\S]{1,3200})$/i)||text.match(/^whatsapp (.{2,100}?):\s*([\s\S]{1,3200})$/i)):null;
  if(send){
   const nm=nameClean(send[1]),body=send[2].trim(),f=await find(nm);
   if(f.ambiguous)return handled("More than one contact has that name. Please use their full name.");
   if(!f.person)return handled("I haven't saved "+nm+" yet. Add them and their WhatsApp number first.");
   const {data:methods,error:e}=await db.from("sandy_person_contact_methods").select("id,normalized_address,wa_opt_in_status,is_primary").eq("owner_customer_id",owner).eq("person_id",f.person.id).eq("channel","whatsapp").order("is_primary",{ascending:false});
   if(e)throw new Error("share_methods_"+e.code);
   if(!methods?.length)return handled("I have "+f.person.display_name+" saved, but not their WhatsApp number.");
   if(methods.length>1&&!methods[0].is_primary)return handled("They have multiple WhatsApp numbers. Please choose which one before sharing.");
   const method=methods[0];
   if(method.wa_opt_in_status==="opted_out")return handled("That person has opted out of messages from Sandy. Nothing sent.");
   if(!await recentWindow(method.normalized_address)){
    await audit("direct_chat_offered",f.person.id,{reason:"window_closed"});
    return handled("I've found "+f.person.display_name+"'s WhatsApp, but Sandy can't send a free-form message outside Meta's 24-hour window. Nothing sent.\nOpen chat: https://wa.me/"+method.normalized_address+"\nCopy this message:\n"+body);
   }
   const rand=new Uint32Array(1);crypto.getRandomValues(rand);const confirm=String(rand[0]%1000000).padStart(6,"0");
   const {data:created,error:ie}=await db.from("sandy_share_requests").insert({owner_customer_id:owner,person_id:f.person.id,contact_method_id:method.id,origin_wa_id:wa,origin_meta_message_id:mid,channel:"whatsapp",content_type:"text",content_text:body,confirmation_code:confirm}).select("id").single();
   if(ie)throw new Error("share_prepare_"+ie.code);
   await audit("share_prepared",f.person.id,{request_id:created.id});
   return handled("Ready for "+f.person.display_name+" (WhatsApp ending "+method.normalized_address.slice(-4)+"):\n\n“"+body+"”\n\nNothing sent yet. Reply SEND "+confirm+" within 15 minutes to confirm. The contact number is user-provided.");
  }
  if(canShare&&/^(?:forward|send|share)\b/i.test(text)&&/\b(?:whatsapp|to (?:my )?friend|to (?:him|her|them))\b/i.test(text)){
   return handled("I can share a specific message with a saved contact. For example: Send to Chris on WhatsApp: I'll arrive at 7. For documents or 'this', please identify the exact item first.");
  }
  return response({handled:false});
 }catch(e){console.error("sandy_people_error",String(e).slice(0,180));return response({handled:true,reply:"I couldn't update your people network just now. Nothing has been sent, and I haven't confirmed a save."});}
});