export const enc=new TextEncoder();
export const reply=(body:string,status=200)=>new Response(body,{status,headers:{"content-type":"text/plain"}});
export function eq(a:string,b:string){const x=enc.encode(a),y=enc.encode(b);let diff=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]??0)^(y[i]??0);return diff===0}
export const required=(key:string)=>Deno.env.get(key)||"";

export async function sha256(value:string){const d=await crypto.subtle.digest("SHA-256",enc.encode(value));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("")}
export async function sendPairingCode(email:string,code:string):Promise<boolean>{
 const tenant=required("MS_GRAPH_TENANT_ID"),client=required("MS_GRAPH_CLIENT_ID"),secret=required("MS_GRAPH_CLIENT_SECRET");
 if(!tenant||!client||!secret)throw Error("graph_configuration_missing");
 const oauth=await fetch("https://login.microsoftonline.com/"+encodeURIComponent(tenant)+"/oauth2/v2.0/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:client,client_secret:secret,grant_type:"client_credentials",scope:"https://graph.microsoft.com/.default"}),signal:AbortSignal.timeout(12000)});
 if(!oauth.ok)throw Error("graph_token_http_"+oauth.status);
 const access=String((await oauth.json()).access_token||"");
 if(!access)throw Error("graph_token_empty");
 const mail=await fetch("https://graph.microsoft.com/v1.0/users/ai%40email.com.au/sendMail",{method:"POST",headers:{authorization:"Bearer "+access,"content-type":"application/json"},body:JSON.stringify({message:{subject:"Sandy AI WhatsApp verification code",body:{contentType:"Text",content:"Your Sandy AI WhatsApp verification code is "+code+". It expires in 10 minutes. If you did not request it, ignore this message."},toRecipients:[{emailAddress:{address:email}}]},saveToSentItems:true}),signal:AbortSignal.timeout(15000)});
 if(!mail.ok){console.error("whatsapp_verification_email_http",mail.status);return false}
 return true;
}
export async function linkingCommand(db:any,waId:string,text:string,priorMessages:string[]=[]):Promise<string|null>{
 if(/^\s*(unlink|disconnect account|revoke access)\s*$/i.test(text)){
  const {error}=await db.from("sandy_whatsapp_identities").update({verification_status:"revoked",allowed_scopes:[],updated_at:new Date().toISOString()}).eq("wa_id",waId);
  if(error)throw Error("unlink_failed:"+error.code);
  return "Your WhatsApp account has been disconnected from Sandy's private client records. General WhatsApp assistance remains available.";
 }

 const emailPattern=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
 const exactEmail=text.trim().match(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i);
 const linkIntent=/\b(link|connect|associate|sync|pair|verify)\b[\s\S]{0,110}\b(account|email|history|profile|records|number|whatsapp)\b|\b(account|email|history|profile|records|number|whatsapp)\b[\s\S]{0,110}\b(link|connect|associate|sync|pair|verify)\b/i;
 const recentIntent=priorMessages.slice(-5).some(s=>linkIntent.test(s)||/^\s*(?:link|connect)\s+email\b/i.test(s));
 const linkEmailMatch=text.match(emailPattern);
 const startsLink=/^\s*(?:link|connect)\s+(?:email\s+)?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s*$/i.test(text);
 const start=(linkEmailMatch&&(startsLink||linkIntent.test(text)||(exactEmail&&recentIntent)))?linkEmailMatch:null;
 const finish=text.match(/^\s*(?:(?:verify|confirm)\s+)?(\d{6})\s*$/i);
 if(!start&&!finish){
  if(linkIntent.test(text))return "Yes. I can securely connect this WhatsApp number to your existing Sandy AI email history. Reply with your email address (or send LINK EMAIL your@email.com). I will email a six-digit verification code. Your records will remain private until you verify it.";
  if(false&&recentIntent&&/\b(my|existing|previous|prior|history|email|account|profile|records|yes|sure|ok)\b/i.test(text))return "Yes, your existing Sandy AI customer history. Reply with the email address on that account and I will send a six-digit verification code. I cannot access your private records until verification succeeds.";

  if(exactEmail)return "To connect this email address to your Sandy AI history, reply LINK EMAIL "+exactEmail[0]+". I will send a verification code to that address.";
  return null;
 }
 if(start){
  const email=start[0].toLowerCase();
  const {data:existing,error:priorError}=await db.from("sandy_whatsapp_link_challenges").select("created_at").eq("wa_id",waId).gte("created_at",new Date(Date.now()-3600000).toISOString()).limit(4);
  if(priorError)throw Error("link_rate_lookup:"+priorError.code);
  if((existing||[]).length>=4)return "Too many verification requests. Please try again in an hour.";
  const {data:owner,error:ownerError}=await db.from("email_customer_addresses").select("customer_id,email_address").eq("normalized_email",email).limit(1).maybeSingle();
  if(ownerError)throw Error("link_email_lookup:"+ownerError.code);
  // Do not reveal whether the address is in the client database.
  const neutral="If that email address is on Sandy's client records, a six-digit code will arrive shortly. Reply with the six-digit code. The code expires in 10 minutes.";
  if(!owner)return neutral;
  const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);
  const otp=String(100000+(bytes[0]%900000));
  const hash=await sha256(waId+":"+email+":"+otp);
  const {error:createError}=await db.from("sandy_whatsapp_link_challenges").insert({wa_id:waId,customer_id:owner.customer_id,email,code_hash:hash,expires_at:new Date(Date.now()+600000).toISOString()});
  if(createError)throw Error("link_challenge_insert:"+createError.code);
  const sent=await sendPairingCode(String(owner.email_address),otp);
  return sent?neutral:"I couldn't send the verification email. Please try again later.";
 }
 const {data:challenge,error:challengeError}=await db.from("sandy_whatsapp_link_challenges").select("id,customer_id,email,code_hash,attempts,expires_at,used_at").eq("wa_id",waId).is("used_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(challengeError)throw Error("link_verify_lookup:"+challengeError.code);
 if(!challenge||Date.parse(challenge.expires_at)<Date.now())return "There is no active verification code. Start with LINK EMAIL your@email.com.";
 if(challenge.attempts>=5)return "Verification attempts exceeded. Request a new code.";
 const candidate=await sha256(waId+":"+challenge.email+":"+finish![1]);
 if(!eq(candidate,challenge.code_hash)){
  await db.from("sandy_whatsapp_link_challenges").update({attempts:challenge.attempts+1}).eq("id",challenge.id);
  return "That verification code is incorrect. Check your email and try again.";
 }
 const {data:used,error:useError}=await db.from("sandy_whatsapp_link_challenges").update({used_at:new Date().toISOString()}).eq("id",challenge.id).is("used_at",null).select("id");
 if(useError||!used?.length)throw Error("link_code_already_used");
 const {error:bindError}=await db.from("sandy_whatsapp_identities").upsert({wa_id:waId,customer_id:challenge.customer_id,verification_status:"verified",verified_at:new Date().toISOString(),allowed_scopes:["memory_read","email_read"],updated_at:new Date().toISOString()},{onConflict:"wa_id"});
 if(bindError)throw Error("link_binding:"+bindError.code);
 return "Your WhatsApp number is verified and linked to your Sandy AI client profile. I can now use your customer memory and recent email context. Sending emails, changing files and other external actions still require dedicated authorization.";
}

export async function whatsappNumberPreferences(db:any,waId:string,text:string,identity:any):Promise<string|null>{
 const list=/^\s*(?:my whatsapp numbers|list (?:my )?whatsapp numbers|which (?:whatsapp )?number is primary|my primary whatsapp|whatsapp settings|is this (?:number|phone) linked (?:to (?:any|my) account)?|is (?:my|this) (?:number|phone|whatsapp) (?:linked|verified)(?: to (?:any|my) account)?)[?.!\s]*$/i.test(text);
 const choose=/\b(?:make|set|use)\b.{0,80}\b(?:this|current)\b.{0,40}\bprimary\b|\b(?:make|set)\b.{0,60}\bprimary\b.{0,40}\b(?:this|current)\b|\b(?:make|set)\s+(?:this\s+)?(?:my\s+)?(?:current\s+)?(?:whatsapp\s+)?(?:number\s+)?(?:as\s+)?(?:my\s+)?primary\b/i.test(text);
 if(!list&&!choose)return null;
 const valid=identity?.verification_status==="verified"&&identity?.customer_id&&identity?.verified_at&&Date.now()-Date.parse(identity.verified_at)<90*86400000;
 if(!valid)return "Let's verify this number first. Send LINK EMAIL your@email.com.";
 if(choose){
  const {data,error}=await db.rpc("sandy_whatsapp_set_primary",{p_customer_id:identity.customer_id,p_wa_id:waId});
  if(error)throw Error("whatsapp_primary_update:"+error.code);
  if(!data)return "I couldn't designate this number as primary. Verify this number again and retry.";
 }
 const {data,error}=await db.from("sandy_whatsapp_identities").select("wa_id,is_primary,verification_status,verified_at").eq("customer_id",identity.customer_id).eq("verification_status","verified").order("is_primary",{ascending:false});
 if(error)throw Error("whatsapp_numbers_lookup:"+error.code);
 const active=(data||[]).filter((x:any)=>x.verified_at&&Date.now()-Date.parse(x.verified_at)<90*86400000);
 const entries=active.map((x:any)=>"+"+String(x.wa_id)+(x.is_primary?" (PRIMARY)":"")).join("\n");
 return (choose?"Done — this is now your primary WhatsApp number.\n":"")+"Verified WhatsApp numbers:\n"+entries+"\nI'll use your primary number unless you tell me otherwise.";
}

export async function whatsappReadCommands(db:any,text:string,identity:any):Promise<string|null>{
 const match=text.match(/^\s*(?:(?:FIND|SEARCH|LOCATE)(?:\s+(?:MY|THE))?\s+(?:EMAILS?|MESSAGES?|CORRESPONDENCE)(?:\s+(?:ABOUT|REGARDING|FOR|FROM|WITH|ON))?\s+|(?:FIND|SEARCH|LOCATE)\s+(.{2,160}?)\s+(?:EMAILS?|MESSAGES?|CORRESPONDENCE)\s*$|EMAIL SEARCH\s+)([\s\S]{2,200})?$/i);
 const files=/^\s*(?:MY DRIVE|MY FILES|CLIENT FOLDER)\s*$/i.test(text);
 if(!match&&!files)return null;
 const verified=identity?.verification_status==="verified"&&identity?.customer_id&&identity?.verified_at&&Date.now()-Date.parse(identity.verified_at)<90*86400000;
 if(!verified)return "To access private records, first link your email with LINK EMAIL your@email.com.";
 const scopes=new Set(identity.allowed_scopes||[]);
 if(files){
  if(!scopes.has("memory_read"))return "Client folder access is not enabled.";
  const {data,error}=await db.from("email_customers").select("display_name,google_drive_folder_url,google_drive_folder_status").eq("id",identity.customer_id).maybeSingle();
  if(error)throw Error("drive_folder_lookup:"+error.code);
  if(!data?.google_drive_folder_url)return "I couldn't find a verified Google Drive folder link for your client profile. I haven't searched your Drive files.";
  return "Your registered client folder: "+data.google_drive_folder_url+"\nFolder status: "+String(data.google_drive_folder_status||"unconfirmed")+". This is a stored link, not a live listing of the files.";
 }
 if(!scopes.has("email_read"))return "Email search is not enabled for this account.";
 const query=String(match![1]||match![2]||"").trim().replace(/[%_,()*]/g,"").slice(0,120);
 if(query.length<2)return "Please provide at least two letters for your email search.";
 const {data:found,error:e}=await db.from("email_messages").select("id,conversation_id,provider_thread_id,subject,body_text,sender_address,received_at,created_at,direction").eq("customer_id",identity.customer_id).or("subject.ilike.%"+query+"%,body_text.ilike.%"+query+"%").order("created_at",{ascending:false}).limit(80);
 if(e)throw Error("email_search:"+e.code);
 if(!found?.length)return "I found no matching messages in your linked customer email history for: "+query+". This is not a live search of every Outlook mailbox.";
 const compact=(s:string)=>String(s||"").split(/\n\s*(?:On .{10,160}wrote:|From:|-----Original Message-----|_{8,})/i)[0].replace(/(?:Regards|Bests|Kind regards),?[\s\S]{0,180}$/i,"").replace(/\s+/g," ").trim();
 const q=query.toLowerCase(),groups=new Map<string,{m:any;score:number;count:number}>();
 for(const m of found){
  const subject=String(m.subject||"").replace(/^(?:(?:re|fw|fwd):\s*)+/gi,"").trim();
  const preview=compact(m.body_text);
  const score=(subject.toLowerCase().includes(q)?8:0)+(preview.toLowerCase().includes(q)?5:0)+(m.direction==="incoming"?2:0)+(String(m.sender_address||"").toLowerCase().includes(q)?3:0);
  const thread=String(m.conversation_id||m.provider_thread_id||subject.toLowerCase());
  const previous=groups.get(thread);
  if(previous){previous.count++;if(score>previous.score)groups.set(thread,{m,score,count:previous.count});}
  else groups.set(thread,{m,score,count:1});
 }
 const ranked=[...groups.values()].sort((a,b)=>b.score-a.score||Date.parse(b.m.received_at||b.m.created_at)-Date.parse(a.m.received_at||a.m.created_at)).slice(0,6);
 const list=ranked.map((item,i)=>{
  const m=item.m;
  return String(i+1)+". *"+String(m.subject||"(no subject)").slice(0,95)+"* ("+String(m.received_at||m.created_at).slice(0,10)+")\nFrom: "+String(m.sender_address||"unknown")+"\n"+compact(m.body_text).slice(0,210)+(item.count>1?"\n"+item.count+" matching messages in this thread":"");
 }).join("\n\n");
 return "Found "+found.length+" stored messages across "+groups.size+" conversation(s) matching '"+query+"'. Most relevant threads:\n\n"+list+"\n\nResults are from linked customer records, not a live Outlook mailbox search.";
}

export async function generatedWhatsappImage(prompt:string,openai:string,token:string,phone:string,onBytes?:(bytes:Uint8Array)=>Promise<void>):Promise<string>{
 const req=await fetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{authorization:"Bearer "+openai,"content-type":"application/json"},body:JSON.stringify({model:"gpt-image-1-mini",prompt:prompt.slice(0,1200),size:"1024x1024",quality:"low",output_format:"jpeg",n:1}),signal:AbortSignal.timeout(75000)});
 if(!req.ok)throw Error("image_generation_http_"+req.status);
 const j=await req.json(),encoded=String(j.data?.[0]?.b64_json||"");
 if(!encoded||encoded.length>14000000)throw Error("generated_image_missing_or_large");
 const binary=atob(encoded),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw Error("generated_image_invalid");
 if(onBytes)await onBytes(bytes);
 const form=new FormData();form.append("messaging_product","whatsapp");form.append("type","image/jpeg");
 form.append("file",new File([bytes],"sandy-generated.jpg",{type:"image/jpeg"}));
 const uploaded=await fetch("https://graph.facebook.com/v25.0/"+encodeURIComponent(phone)+"/media",{method:"POST",headers:{authorization:"Bearer "+token},body:form,signal:AbortSignal.timeout(25000)});
 const response=await uploaded.json().catch(()=>({}));
 if(!uploaded.ok||!response.id)throw Error("image_meta_upload_http_"+uploaded.status);
 return String(response.id);
}

export async function commonsPhoto(topic:string):Promise<{url:string;title:string;source:string}|null>{
 const q=topic.trim().replace(/[^a-zA-Z0-9 \-']/g,"").slice(0,90);
 if(q.length<3)return null;
 const params=new URLSearchParams({action:"query",generator:"search",gsrsearch:q+" photograph",gsrnamespace:"6",gsrlimit:"12",prop:"imageinfo",iiprop:"url|mime|size|extmetadata",iiurlwidth:"1000",format:"json"});
 const res=await fetch("https://commons.wikimedia.org/w/api.php?"+params.toString(),{headers:{"User-Agent":"SandyAI/1.0 (ai@email.com.au)"},signal:AbortSignal.timeout(16000)});
 if(!res.ok)throw Error("commons_http_"+res.status);
 const data=await res.json();
 const pages=Object.values(data.query?.pages||{}) as any[];
 for(const page of pages){
  const info=page.imageinfo?.[0];if(!info||!["image/jpeg","image/png"].includes(info.mime))continue;
  if(info.size>9000000)continue;
  const lic=String(info.extmetadata?.LicenseShortName?.value||"");
  if(!/^(CC0|public domain|CC BY(?:-SA)?(?: |$))/i.test(lic))continue;
  const url=String(info.thumburl||info.url||"");
  try{const u=new URL(url);if(u.protocol!=="https:"||u.hostname!=="upload.wikimedia.org")continue;}catch{continue}
  const title=String(page.title||"").replace(/^File:/i,"").replace(/\.(?:jpg|jpeg|png)$/i,"").replace(/[_-]/g," ").slice(0,80);
  return {url,title,source:String(info.descriptionurl||"https://commons.wikimedia.org/")};
 }
 return null;
}

export async function incomingImageData(mediaId:string,token:string):Promise<string>{
 if(!/^\d{5,30}$/.test(mediaId))throw Error("image_media_id_invalid");
 const meta=await fetch("https://graph.facebook.com/v25.0/"+mediaId,{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(12000)});
 if(!meta.ok)throw Error("image_meta_http_"+meta.status);
 const data=await meta.json(),target=new URL(String(data.url||""));
 if(target.protocol!=="https:"||!["lookaside.fbsbx.com","graph.facebook.com"].includes(target.hostname))throw Error("image_media_host_rejected");
 if(Number(data.file_size||0)>8500000)throw Error("image_too_large");
 const res=await fetch(target.href,{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw Error("image_download_http_"+res.status);
 const bytes=new Uint8Array(await res.arrayBuffer());
 if(!bytes.length||bytes.length>8500000)throw Error("image_bytes_invalid");
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
 if(!jpeg&&!png)throw Error("image_type_invalid");
 let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return "data:image/"+(jpeg?"jpeg":"png")+";base64,"+btoa(binary);
}

export async function transcribeWhatsappAudio(mediaId:string,token:string,openai:string):Promise<string>{
 if(!/^\d{5,30}$/.test(mediaId))throw Error("audio_media_id_invalid");
 const lookup=await fetch("https://graph.facebook.com/v25.0/"+mediaId,{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(10000)});
 if(!lookup.ok)throw Error("audio_media_lookup_http_"+lookup.status);
 const j=await lookup.json();const address=new URL(String(j.url||""));
 if(address.protocol!=="https:"||!["lookaside.fbsbx.com","graph.facebook.com"].includes(address.hostname))throw Error("audio_media_host_rejected");
 if(Number(j.file_size||0)>10500000)throw Error("audio_file_too_large");
 const audio=await fetch(address.href,{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(20000)});
 if(!audio.ok)throw Error("audio_download_http_"+audio.status);
 const data=await audio.arrayBuffer();if(!data.byteLength||data.byteLength>10500000)throw Error("audio_size_invalid");
 const form=new FormData();form.append("model","gpt-4o-mini-transcribe");
 form.append("file",new File([data],"voice.ogg",{type:"audio/ogg"}));
 const ai=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{authorization:"Bearer "+openai},body:form,signal:AbortSignal.timeout(35000)});
 if(!ai.ok)throw Error("audio_transcription_http_"+ai.status);
 const r=await ai.json();return String(r.text||"").trim().slice(0,7000);
}

export function cleanWhatsAppUrl(raw:string):string{
 try{
  const u=new URL(raw.replace(/&amp;/g,"&"));
  if(!["https:","http:"].includes(u.protocol)||u.username||u.password)return raw;
  for(const k of [...u.searchParams.keys()]){
   if(/^(utm_.+|fbclid|gclid|msclkid|mc_cid|mc_eid|igshid|ref_src)$/i.test(k))u.searchParams.delete(k);
  }
  return u.toString();
 }catch{return raw}
}
export function formatWhatsAppLinks(input:string):string{
 // WhatsApp text cannot use Markdown-labelled hyperlinks. Give each cited page a
 // short description and a clean, tappable URL. Preserve original destinations.
 const sources:{label:string;url:string}[]=[];
 const seen=new Set<string>();
 const add=(label:string,url:string)=>{
  const clean=cleanWhatsAppUrl(url);
  let domain="";try{const u=new URL(clean);if(!["https:","http:"].includes(u.protocol))return;domain=u.hostname.replace(/^www\./,"");}catch{return}
  if(seen.has(clean))return;
  seen.add(clean);
  let name=label.trim().replace(/^https?:\/\//,"").replace(/[*_]/g,"");
  if(!name||name.toLowerCase()===domain.toLowerCase())name=domain;
  sources.push({label:name.slice(0,85),url:clean});
 };
 let body=input.replace(/\s*\(\[([^\]\n]{1,110})\]\((https?:\/\/[^\s)]+)\)\)/gi,(_,label,url)=>{add(label,url);return ""});
 body=body.replace(/\[([^\]\n]{1,110})\]\((https?:\/\/[^\s)]+)\)/gi,(_,label,url)=>{add(label,url);return label});
 body=body.replace(/https?:\/\/[^\s<>"']+/gi,(raw)=>{
  const suffix=raw.match(/[.,;!?]+$/)?.[0]||"";
  return cleanWhatsAppUrl(raw.slice(0,raw.length-suffix.length))+suffix;
 });
 body=body.replace(/\*\*([^*\n]+)\*\*/g,"*$1*").replace(/^\s*#{1,5}\s+/gm,"");
 if(sources.length)body=body.replace(/\n*\s*(?:Sources?|References?):\s*$/i,"");
 body=body.replace(/\n{3,}/g,"\n\n").trim();
 if(sources.length){
  const list=sources.slice(0,3).map(s=>"*Source: "+s.label+"*\n"+s.url).join("\n\n");
  body+="\n\n"+list;
 }
 return body;
}


export async function persistSandyImage(db:any,owner:string,bytes:Uint8Array,mime:string,kind:string,messageId?:number):Promise<string>{
 if(!/^[0-9a-f-]{36}$/i.test(owner)||!["image/jpeg","image/png","image/webp"].includes(mime)||bytes.length<3||bytes.length>10485760)throw Error("media_storage_invalid");
 const hashBytes=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
 const digest=Array.from(hashBytes).map(b=>b.toString(16).padStart(2,"0")).join("");
 const ext=mime==="image/png"?"png":mime==="image/webp"?"webp":"jpg";
 const name=crypto.randomUUID();
 const path=owner+"/"+new Date().toISOString().slice(0,7)+"/"+name+"."+ext;
 const {error:up}=await db.storage.from("sandy-whatsapp-media").upload(path,bytes,{contentType:mime,upsert:false,cacheControl:"3600"});
 if(up)throw Error("media_store_upload_"+up.message.slice(0,80));
 const {data:asset,error:ins}=await db.from("sandy_media_assets").insert({owner_customer_id:owner,whatsapp_message_id:messageId||null,source_kind:kind,mime_type:mime,size_bytes:bytes.length,storage_bucket:"sandy-whatsapp-media",storage_path:path,sha256:digest}).select("id").single();
 if(ins){await db.storage.from("sandy-whatsapp-media").remove([path]);throw Error("media_asset_insert_"+ins.code)}
 return asset.id;
}
