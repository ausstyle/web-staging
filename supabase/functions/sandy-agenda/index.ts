import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
const url=Deno.env.get("SUPABASE_URL")!;
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const publicAuth=createClient(url,"sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts",{auth:{persistSession:false,autoRefreshToken:false}});
const cookieName="sandy_agenda";
const allowedOrigin="https://ausstyle.github.io";
const secHeaders:Record<string,string>={
 "access-control-allow-origin":allowedOrigin,"access-control-allow-methods":"GET, POST, OPTIONS","access-control-allow-headers":"Authorization, Content-Type","vary":"Origin",
 "x-content-type-options":"nosniff","referrer-policy":"no-referrer",
 "x-frame-options":"DENY","cache-control":"no-store",
 "content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
};
function json(status:number,v:unknown,extra:Record<string,string>={}){return new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json; charset=utf-8",...secHeaders,...extra}})}
function failure(msg:string,code=400){return json(code,{error:msg})}
function esc(s:string){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!))}

async function sendTaskShareNotice(email:string,taskId:string,senderName:string,taskTitle:string){
 const tenant=Deno.env.get("MS_GRAPH_TENANT_ID"),client=Deno.env.get("MS_GRAPH_CLIENT_ID"),secret=Deno.env.get("MS_GRAPH_CLIENT_SECRET");
 if(!tenant||!client||!secret)throw Error("mail_not_configured");
 const tr=await fetch("https://login.microsoftonline.com/"+encodeURIComponent(tenant)+"/oauth2/v2.0/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:client,client_secret:secret,grant_type:"client_credentials",scope:"https://graph.microsoft.com/.default"})});
 if(!tr.ok)throw Error("mail_auth_failed");
 const token=(await tr.json()).access_token;
 const html='<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f8f8f8;padding:30px;color:#111"><div style="max-width:520px;margin:auto;background:white;border:1px solid #eee;padding:35px;border-radius:12px"><h1>sandy.</h1><h2>A task invitation is waiting</h2><p>'+esc(senderName)+' invited you to collaborate on the task <strong>'+esc(taskTitle)+'</strong>.</p><a href="'+esc("https://ausstyle.github.io/web-staging/sandy/agenda/?task="+encodeURIComponent(taskId)+"&accept=1")+'" style="display:inline-block;color:white;background:#111;text-decoration:none;padding:15px 24px;border-radius:7px">Accept and open task</a><p style="color:#888;font-size:12px">You have not accepted the task yet. If you were not expecting this, ignore the message.</p></div></body></html>';
 const response=await fetch("https://graph.microsoft.com/v1.0/users/ai%40email.com.au/sendMail",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({message:{subject:"Sandy task invitation",body:{contentType:"HTML",content:html},toRecipients:[{emailAddress:{address:email}}]},saveToSentItems:true})});
 if(response.status!==202)throw Error("mail_not_accepted");
}
async function delegationContext(ownerId:string,taskId:string){
 const [{data:person},{data:task}]=await Promise.all([db.from("email_customers").select("display_name").eq("id",ownerId).maybeSingle(),db.from("sandy_tasks").select("title").eq("id",taskId).eq("customer_id",ownerId).maybeSingle()]);
 if(!task)throw Error("Task no longer exists");
 return {senderName:String(person?.display_name||"Sandy user"),taskTitle:String(task.title||"Task")};
}
async function sendExternalIntroduction(email:string,activationLink:string,reference:string,senderName:string,taskTitle:string){
 const tenant=Deno.env.get("MS_GRAPH_TENANT_ID"),client=Deno.env.get("MS_GRAPH_CLIENT_ID"),secret=Deno.env.get("MS_GRAPH_CLIENT_SECRET");
 if(!tenant||!client||!secret)throw Error("mail_not_configured");
 const tr=await fetch("https://login.microsoftonline.com/"+encodeURIComponent(tenant)+"/oauth2/v2.0/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:client,client_secret:secret,grant_type:"client_credentials",scope:"https://graph.microsoft.com/.default"})});
 if(!tr.ok)throw Error("mail_auth_failed");
 const jwt=(await tr.json()).access_token;
 const html='<html><body style="font-family:Arial,sans-serif;background:#f8f8f8;color:#111;padding:28px"><div style="max-width:540px;margin:auto;background:white;padding:35px;border:1px solid #e5e5e5;border-radius:14px"><h2 style="font-size:28px">sandy.</h2><h1>You have been invited to collaborate</h1><p>Hello, I\'m Sandy, an AI assistant helping people organise projects and tasks. '+esc(senderName)+' invited you to collaborate on the task <strong>'+esc(taskTitle)+'</strong>.</p><p>No account has been created for you. If you would like to participate, use the secure invitation link or reply to this email with <b>ACCEPT '+esc(reference)+'</b>. Your reply records your interest; Sandy will still ask you to verify your email before account access.</p><a href="'+esc(activationLink)+'" style="display:inline-block;background:#111;color:#fff;padding:14px 22px;text-decoration:none;border-radius:8px">Accept invitation</a><p style="font-size:12px;color:#777">Invitation expires in 7 days. If you are not interested, ignore this message. No task information is accessible until you activate a secure account and accept the task.</p><p style="font-size:11px;color:#999;border-top:1px solid #eee;padding-top:15px">Sandy AI · ai@email.com.au · Reference '+esc(reference)+'</p></div></body></html>';
 const response=await fetch("https://graph.microsoft.com/v1.0/users/ai%40email.com.au/sendMail",{method:"POST",headers:{authorization:"Bearer "+jwt,"content-type":"application/json"},body:JSON.stringify({message:{subject:"Sandy invitation to collaborate ["+reference+"]",body:{contentType:"HTML",content:html},toRecipients:[{emailAddress:{address:email}}],replyTo:[{emailAddress:{address:"ai@email.com.au"}}]},saveToSentItems:true})});
 if(response.status!==202)throw Error("mail_not_accepted");
}

async function sendSandyActivation(email:string,link:string,senderName:string,taskTitle:string){
 const tenant=Deno.env.get("MS_GRAPH_TENANT_ID"),client=Deno.env.get("MS_GRAPH_CLIENT_ID"),secret=Deno.env.get("MS_GRAPH_CLIENT_SECRET");
 if(!tenant||!client||!secret)throw Error("mail_not_configured");
 const t=await fetch("https://login.microsoftonline.com/"+encodeURIComponent(tenant)+"/oauth2/v2.0/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:client,client_secret:secret,grant_type:"client_credentials",scope:"https://graph.microsoft.com/.default"})});
 if(!t.ok)throw Error("mail_provider_auth_failed");
 const token=(await t.json()).access_token;
 const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f6f6;font-family:Arial,sans-serif;color:#111"><div style="max-width:530px;margin:40px auto;background:white;border:1px solid #e6e6e6;border-radius:14px;padding:38px"><div style="font-size:28px;font-weight:700">sandy<span style="color:#888">.</span></div><h1 style="font-size:26px;margin:34px 0 12px">You\'re invited to Sandy</h1><p style="font-size:15px;line-height:1.7;color:#444">'+esc(senderName)+' invited you to collaborate on the task <strong>'+esc(taskTitle)+'</strong>. Activate your existing Sandy access with this secure link.</p><a href="'+esc(link)+'" style="display:inline-block;background:#111;color:#fff;padding:15px 25px;border-radius:8px;text-decoration:none;font-weight:600;margin:20px 0">Activate Sandy access</a><p style="font-size:12px;color:#777;line-height:1.6">The link is single-use and expires. Do not forward it. The task is private until you sign in and accept the invitation. If you did not expect this, ignore this email.</p><p style="border-top:1px solid #eee;padding-top:15px;color:#999;font-size:12px">Sandy AI · ai@email.com.au</p></div></body></html>';
 const response=await fetch("https://graph.microsoft.com/v1.0/users/ai%40email.com.au/sendMail",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({message:{subject:"You're invited to collaborate in Sandy",body:{contentType:"HTML",content:html},toRecipients:[{emailAddress:{address:email}}]},saveToSentItems:true})});
 if(response.status!==202)throw Error("mail_provider_not_accepted");
}

async function digest(s:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function randomBytes(n:number){const a=new Uint8Array(n);crypto.getRandomValues(a);return a}
function randomToken(){return btoa(String.fromCharCode(...randomBytes(32))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")}
function norm(s:unknown){return String(s||"").trim().toLowerCase()}
function isUUID(s:unknown){return typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)}
function validateEmail(s:string){return s.length<255&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)}
function incomingCookie(req:Request){const raw=req.headers.get("cookie")||"";const match=raw.match(/(?:^|;\s*)sandy_agenda=([^;]+)/);return match?.[1]||null}
function cookie(token:string,age=604800){return cookieName+"="+token+"; HttpOnly; Secure; SameSite=Strict; Path=/functions/v1/sandy-agenda; Max-Age="+age}
async function session(req:Request){
 const authHeader=req.headers.get("authorization")||"";
 const token=authHeader.startsWith("Bearer ")?authHeader.slice(7):incomingCookie(req);
 if(!token||token.length>4096)return null;
 // Sandy-wide Supabase Auth SSO: only explicitly enrolled, email-verified customers.
 if(token.length>128){
  const {data:verified,error:verifyError}=await publicAuth.auth.getUser(token);
  const user=verified?.user;
  if(verifyError||!user?.id||!user.email_confirmed_at||!user.email)return null;
  const email=norm(user.email);
  const {data:account,error:ae}=await db.from("sandy_memory_portal_accounts").select("customer_id").eq("auth_user_id",user.id).is("revoked_at",null).maybeSingle();
  if(ae||!account)return null;
  const [{data:primary,error:pe},{data:access,error:ac}]=await Promise.all([
   db.from("email_customer_addresses").select("normalized_email").eq("customer_id",account.customer_id).eq("is_primary",true).maybeSingle(),
   db.from("sandy_agenda_access").select("customer_id").eq("customer_id",account.customer_id).eq("email",email).eq("enabled",true).maybeSingle()
  ]);
  if(pe||ac||primary?.normalized_email!==email||!access)return null;
  return {customer_id:account.customer_id,email,hash:null};
 }
 // Existing agenda sessions continue to work for older clients.
 const hash=await digest(token);
 const {data,error}=await db.from("sandy_agenda_sessions").select("customer_id,email,expires_at,revoked_at").eq("token_hash",hash).maybeSingle();
 if(error||!data||data.revoked_at||new Date(data.expires_at).getTime()<Date.now())return null;
 return {...data,hash};
}
async function customerForEmail(email:string){
 const {data,error}=await db.from("sandy_agenda_access").select("customer_id").eq("email",email).eq("enabled",true).maybeSingle();
 if(error||!data)return null;
 return data.customer_id as string;
}
async function sendSignInCode(email:string,code:string){
 const tenant=Deno.env.get("MS_GRAPH_TENANT_ID");
 const id=Deno.env.get("MS_GRAPH_CLIENT_ID");
 const secret=Deno.env.get("MS_GRAPH_CLIENT_SECRET");
 if(!tenant||!id||!secret)throw new Error("Email delivery unavailable");
 const tokenResponse=await fetch("https://login.microsoftonline.com/"+encodeURIComponent(tenant)+"/oauth2/v2.0/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:id,client_secret:secret,grant_type:"client_credentials",scope:"https://graph.microsoft.com/.default"})});
 if(!tokenResponse.ok)throw new Error("Unable to authenticate mail provider");
 const tokenData=await tokenResponse.json();
 const response=await fetch("https://graph.microsoft.com/v1.0/users/ai@email.com.au/sendMail",{method:"POST",headers:{"authorization":"Bearer "+tokenData.access_token,"content-type":"application/json"},body:JSON.stringify({message:{subject:"Your Sandy Agenda sign-in code",body:{contentType:"HTML",content:"<div style='font-family:Arial,sans-serif;padding:24px;color:#25372b'><h2>Sign in to Sandy</h2><p>Your one-time sign-in code is:</p><div style='font-size:32px;font-weight:bold;letter-spacing:7px'>"+code+"</div><p>This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p><p>Sandy · ai@email.com.au</p></div>"},toRecipients:[{emailAddress:{address:email}}]},saveToSentItems:true})});
 if(response.status!==202)throw new Error("Mail provider did not confirm submission");
}
async function handler(req:Request):Promise<Response>{
 const u=new URL(req.url);const action=u.searchParams.get("action");
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:secHeaders});
 if(req.method==="GET"&&!action)return new Response(null,{status:302,headers:{location:"https://ausstyle.github.io/web-staging/sandy/agenda/",...secHeaders}});
 if(!action)return failure("Not found",404);

 if(action==="accept-external"&&req.method==="GET"){
  const token=u.searchParams.get("token")||"";
  if(!/^[a-zA-Z0-9_-]{32,64}$/.test(token))return failure("Invalid invitation",400);
  const hash=await digest(token);
  const {data:invite}=await db.from("sandy_external_task_invitations").select("id,email").eq("token_hash",hash).eq("status","sent").gt("expires_at",new Date().toISOString()).maybeSingle();
  if(!invite)return failure("This invitation is expired or no longer available",410);
  // No state changes on GET: mail-security link scanners may prefetch links.
  const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:Arial,sans-serif;max-width:520px;margin:70px auto;color:#111;padding:20px"><h1>sandy.</h1><h2>Accept your invitation?</h2><p>Continue to create your Sandy access and receive an email verification link.</p><button id="yes" style="background:#111;color:#fff;padding:14px 20px;border:0;border-radius:8px;cursor:pointer">Accept and continue</button><p id="state" role="status"></p><script>document.getElementById("yes").onclick=async function(){this.disabled=true;const el=document.getElementById("state");el.textContent="Preparing your invitation…";try{const r=await fetch(location.origin+"/functions/v1/sandy-agenda?action=confirm-external",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:new URL(location.href).searchParams.get("token")})});const d=await r.json();el.textContent=r.ok?d.note:(d.error||"Could not accept");}catch{el.textContent="Service unavailable. Try again later."}}</script></body></html>';
  return new Response(html,{status:200,headers:{"content-type":"text/html; charset=utf-8",...secHeaders}});
 }
 if(req.method!=="GET"&&req.method!=="POST")return failure("Method not allowed",405);
 if(req.method==="POST"){
  const origin=req.headers.get("origin");
  if(origin&&origin!==u.origin&&origin!==allowedOrigin)return failure("Invalid origin",403);
  if(!(req.headers.get("content-type")||"").startsWith("application/json"))return failure("Expected JSON",415);
 }
 let p:any={};
 if(req.method==="POST"){
  try{if(Number(req.headers.get("content-length")||"0")>65536)return failure("Request too large",413);p=await req.json()}catch{return failure("Malformed JSON")}
 }
 if(action==="confirm-external"&&req.method==="POST"){
  const token=String(p.token||"");
  if(!/^[a-zA-Z0-9_-]{32,64}$/.test(token))return failure("Invalid invitation",400);
  const hash=await digest(token);
  const {data:invite,error:ie}=await db.from("sandy_external_task_invitations").select("*").eq("token_hash",hash).eq("status","sent").gt("expires_at",new Date().toISOString()).maybeSingle();
  if(ie||!invite)return failure("Invitation expired or already used. Ask the sender to invite you again.",410);
  const {data:existing,error:existingError}=await db.from("email_customer_addresses").select("customer_id,is_primary").eq("normalized_email",invite.email).maybeSingle();
  if(existingError)return failure("Unable to check client identity",503);
  // Reuse a client record created by email ingestion between sending and accepting the invitation.
  let cidNew=existing?.customer_id||null;
  if(existing&&!existing.is_primary)return failure("This email is not the primary address of its Sandy client. Contact Sandy support.",409);
  if(!cidNew){
   const {data:newCustomer,error:ce}=await db.from("email_customers").insert({display_name:invite.email}).select("id").single();
   if(ce||!newCustomer)return failure("Could not prepare account",503);
   cidNew=newCustomer.id;
   const {error:addressError}=await db.from("email_customer_addresses").insert({customer_id:cidNew,email_address:invite.email,normalized_email:invite.email,is_primary:true});
   if(addressError){await db.from("email_customers").delete().eq("id",cidNew);return failure("Could not prepare account",503)}
  }
  try{
   const redirect="https://ausstyle.github.io/web-staging/sandy/app/?return="+encodeURIComponent("/web-staging/sandy/agenda/?task="+invite.task_id+"&accept=1");
   const {data:link,error:le}=await db.auth.admin.generateLink({type:"magiclink",email:invite.email,options:{redirectTo:redirect}});
   if(le||!link?.user?.id||!link?.properties?.action_link||norm(link.user.email)!==invite.email)throw Error("activation_unavailable");
   const {data:portal,error:portalReadError}=await db.from("sandy_memory_portal_accounts").select("auth_user_id,revoked_at").eq("customer_id",cidNew).maybeSingle();
   if(portalReadError||portal?.revoked_at||(portal&&portal.auth_user_id!==link.user.id))throw Error("portal_identity_conflict");
   if(!portal){const {error:pe}=await db.from("sandy_memory_portal_accounts").insert({customer_id:cidNew,auth_user_id:link.user.id});if(pe)throw Error("portal_link_failed")}
   const {data:access,error:accessReadError}=await db.from("sandy_agenda_access").select("customer_id,enabled").eq("email",invite.email).maybeSingle();
   if(accessReadError||(access&&access.customer_id!==cidNew))throw Error("agenda_identity_conflict");
   if(!access){const {error:ae}=await db.from("sandy_agenda_access").insert({customer_id:cidNew,email:invite.email,enabled:true,onboarding_source:"external_delegation"});if(ae)throw Error("agenda_access_failed")}
   else if(!access.enabled){const {error:ae}=await db.from("sandy_agenda_access").update({enabled:true}).eq("email",invite.email).eq("customer_id",cidNew);if(ae)throw Error("agenda_access_failed")}
   const {error:de}=await db.from("sandy_task_delegations").upsert({owner_customer_id:invite.owner_customer_id,task_id:invite.task_id,assignee_customer_id:cidNew,scope:invite.scope,status:"invited"},{onConflict:"task_id,assignee_customer_id"});
   if(de)throw Error("task_invite_failed");
   const inviteContext=await delegationContext(invite.owner_customer_id,invite.task_id);
   await sendSandyActivation(invite.email,link.properties.action_link,inviteContext.senderName,inviteContext.taskTitle);
   await db.from("sandy_external_task_invitations").update({status:"accepted",customer_id:cidNew,accepted_at:new Date().toISOString()}).eq("id",invite.id).eq("status","sent");
   const html='<html><body style="font:16px Arial,sans-serif;max-width:600px;margin:70px auto;color:#111"><h1>Check your email</h1><p>Sandy submitted a secure activation link to your email. Follow it to verify your account and review the task invitation.</p><p>You can close this page.</p></body></html>';
   return new Response(html,{status:200,headers:{"content-type":"text/html; charset=utf-8",...secHeaders}});
  }catch(err){
   console.error("sandy_external_invite_accept_failed",err instanceof Error?err.message:"unknown");
   return failure("Sandy could not finish your account activation. Please contact the sender; do not retry the invitation repeatedly.",503);
  }
 }

 if(action==="request-code"&&req.method==="POST"){
  const email=norm(p.email);if(!validateEmail(email))return failure("Enter a valid email");
  const customer=await customerForEmail(email);
  if(!customer)return json(200,{ok:true});
  const oneHour=new Date(Date.now()-3600000).toISOString();
  const {count,error:rateError}=await db.from("sandy_agenda_login_challenges").select("id",{count:"exact",head:true}).eq("email",email).gte("created_at",oneHour);
  if(rateError)return failure("Unable to check sign-in limits",503);
  if((count||0)>=5)return failure("Too many codes requested. Try again later.",429);
  const challengeId=crypto.randomUUID();
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0");
  const hash=await digest(challengeId+":"+code+":"+key);
  const {error}=await db.from("sandy_agenda_login_challenges").insert({id:challengeId,email,customer_id:customer,code_hash:hash,expires_at:new Date(Date.now()+600000).toISOString()});
  if(error)return failure("Could not start sign-in",503);
  try{await sendSignInCode(email,code)}catch(e){return failure("Unable to deliver sign-in code right now",503)}
  await db.from("sandy_agenda_login_challenges").update({sent_at:new Date().toISOString()}).eq("id",challengeId);
  return json(200,{ok:true});
 }
 if(action==="verify-code"&&req.method==="POST"){
  const email=norm(p.email);const code=String(p.code||"").trim();
  if(!validateEmail(email)||!/^\d{6}$/.test(code))return failure("Invalid email or code");
  const {data:challenge,error}=await db.from("sandy_agenda_login_challenges").select("*").eq("email",email).not("sent_at","is",null).is("used_at",null).gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error||!challenge||challenge.attempts>=5)return failure("Code expired or incorrect",401);
  const {data:claimed,error:countError}=await db.from("sandy_agenda_login_challenges").update({attempts:challenge.attempts+1}).eq("id",challenge.id).eq("attempts",challenge.attempts).is("used_at",null).select("id").maybeSingle();
  if(countError||!claimed)return failure("Please try again",409);
  const check=await digest(challenge.id+":"+code+":"+key);
  if(check!==challenge.code_hash)return failure("Code expired or incorrect",401);
  const {data:used,error:usedError}=await db.from("sandy_agenda_login_challenges").update({used_at:new Date().toISOString()}).eq("id",challenge.id).is("used_at",null).select("id").maybeSingle();
  if(usedError||!used)return failure("This code has already been used",409);
  const token=randomToken();const tokenHash=await digest(token);
  const {error:sessionError}=await db.from("sandy_agenda_sessions").insert({token_hash:tokenHash,customer_id:challenge.customer_id,email,expires_at:new Date(Date.now()+604800000).toISOString()});
  if(sessionError)return failure("Unable to create a session",503);
  return json(200,{ok:true,token},{"set-cookie":cookie(token)});
 }
 if(action==="accept-external-reply"&&req.method==="POST"){
  if(req.headers.get("authorization")!=="Bearer "+key)return failure("Unauthorized",403);
  if(!isUUID(p.source_message_id))return failure("Invalid email reference");
  const {data:m,error:me}=await db.from("email_messages").select("id,sender_address,direction,subject,body_text").eq("id",p.source_message_id).eq("direction","incoming").maybeSingle();
  if(me||!m)return failure("Incoming message unavailable",404);
  const sender=norm(m.sender_address),subject=String(m.subject||""),latest=String(m.body_text||"").split(/\n(?:From:|-----Original Message-----|On .{8,120}wrote:)/i)[0].trim();
  const code=(subject.match(/\[([0-9a-f]{8})\]/i)||[])[1]?.toUpperCase();
  if(!code||!new RegExp("^ACCEPT\\s+"+code+"(?:\\s|$)","i").test(latest))return json(200,{matched:false});
  const {data:rows,error:lookup}=await db.from("sandy_external_task_invitations").select("id,email,created_at,last_sent_at,reply_message_id").eq("email",sender).eq("status","sent").gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(20);
  if(lookup)return failure("Unable to check invitation",503);
  const invite=(rows||[]).find((x:any)=>String(x.id).slice(0,8).toUpperCase()===code);
  if(!invite)return json(200,{matched:false});
  if(invite.reply_message_id)return json(200,{matched:true,duplicate:true});
  const {data:claimed,error:ce}=await db.from("sandy_external_task_invitations").update({reply_message_id:m.id,reply_accepted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",invite.id).is("reply_message_id",null).select("id").maybeSingle();
  if(ce||!claimed)return json(200,{matched:true,duplicate:true});
  const token=randomToken(),hash=await digest(token);
  try{
   const {error:rotateErr}=await db.from("sandy_external_task_invitations").update({token_hash:hash,expires_at:new Date(Date.now()+604800000).toISOString()}).eq("id",invite.id).eq("reply_message_id",m.id);
   if(rotateErr)throw Error("invite_link_rotation_failed");
   const link=url+"/functions/v1/sandy-agenda?action=accept-external&token="+encodeURIComponent(token);
   const inviteContext=await delegationContext(invite.owner_customer_id,invite.task_id);
   await sendExternalIntroduction(sender,link,code,inviteContext.senderName,inviteContext.taskTitle);
   return json(200,{matched:true,verification_submitted:true,note:"Reply acceptance recorded; Sandy submitted a secure invitation link to the verified recipient address."});
  }catch(err){
   await db.from("sandy_external_task_invitations").update({reply_message_id:null,reply_accepted_at:null,last_error:"reply_verification_delivery_failed"}).eq("id",invite.id).eq("reply_message_id",m.id);
   return failure("Could not submit verification email; safe to retry",503);
  }
 }
 const s=await session(req);
 if(!s)return failure("Sign in to continue",401);
 const cid=s.customer_id;
 if(action==="logout"&&req.method==="POST"){
  if(s.hash)await db.from("sandy_agenda_sessions").update({revoked_at:new Date().toISOString()}).eq("token_hash",s.hash);
  return json(200,{ok:true},{"set-cookie":cookie("",0)});
 }
 if(action==="list"&&req.method==="GET"){
  const [tasks,sg,customer,attn,deps,companies,categories,delegatedByMe,assignedToMe]=await Promise.all([
   db.from("sandy_tasks").select("id,parent_task_id,company_id,category_id,title,details,status,priority,due_at,start_at,contact_name,next_review_at,waiting_on,position,source_kind,created_at,updated_at,completed_at,archived_at,version").eq("customer_id",cid).order("created_at",{ascending:false}).limit(2000),
   db.from("sandy_task_suggestions").select("id,title,details,confidence,status,created_at").eq("customer_id",cid).eq("status","suggested").order("created_at",{ascending:false}).limit(20),
   db.from("email_customers").select("display_name").eq("id",cid).single(),
   db.from("sandy_agenda_attention").select("task_id,reason,first_detected_at").eq("customer_id",cid).is("resolved_at",null).order("first_detected_at",{ascending:false}).limit(100),
   db.from("sandy_task_dependencies").select("task_id,depends_on_id").eq("customer_id",cid).limit(3000),
   db.from("sandy_agenda_companies").select("id,name").eq("customer_id",cid).order("name"),
   db.from("sandy_agenda_categories").select("id,company_id,parent_category_id,name").eq("customer_id",cid).order("name"),
   db.from("sandy_task_delegations").select("id,task_id,assignee_customer_id,status,scope").eq("owner_customer_id",cid).neq("status","revoked"),
   db.from("sandy_task_delegations").select("id,task_id,owner_customer_id,status,scope").eq("assignee_customer_id",cid).in("status",["invited","accepted"]) ]);
  if(tasks.error||sg.error||attn.error||deps.error||companies.error||categories.error||delegatedByMe.error||assignedToMe.error)return failure("Could not load agenda",503);
  const ownShares=delegatedByMe.data||[],inShares=assignedToMe.data||[];
  const [myParticipantRes,sharedParticipantRes,extInviteRes]=await Promise.all([
    db.from("sandy_task_participants").select("task_id,customer_id,role,scope,status").in("task_id",(tasks.data||[]).map((t:any)=>t.id).length?(tasks.data||[]).map((t:any)=>t.id):["00000000-0000-0000-0000-000000000000"]).neq("status","revoked"),
    db.from("sandy_task_participants").select("task_id,customer_id,role,scope,status").eq("customer_id",cid).eq("status","accepted"),
    db.from("sandy_external_task_invitations").select("id,task_id,email,status,scope").eq("owner_customer_id",cid).in("status",["sending","sent"])
  ]);
  if(myParticipantRes.error||sharedParticipantRes.error||extInviteRes.error)return failure("Could not load sharing information",503);
  const ownerParticipants=myParticipantRes.data||[],incomingParticipants=sharedParticipantRes.data||[];
  const participantRoots=incomingParticipants.map((v:any)=>v.task_id);
  const {data:partRootRows,error:partRootError}=participantRoots.length?await db.from("sandy_tasks").select("id,customer_id").in("id",participantRoots):{data:[],error:null};
  if(partRootError)return failure("Unable to validate shared tasks",503);
  const participantOwner=new Map((partRootRows||[]).map((v:any)=>[v.id,v.customer_id]));
  const shareIds=[...new Set([...ownShares.map((x:any)=>x.assignee_customer_id),...ownerParticipants.map((x:any)=>x.customer_id)])];
  const {data:knownMembers,error:memberError}=shareIds.length?await db.from("sandy_agenda_access").select("customer_id,email").eq("enabled",true).in("customer_id",shareIds):{data:[],error:null};
  if(memberError)return failure("Unable to load collaborator names",503);
  const emailById=new Map((knownMembers||[]).map((x:any)=>[x.customer_id,x.email]));
  const {data:people,error:peopleError}=shareIds.length?await db.from("email_customers").select("id,display_name").in("id",shareIds):{data:[],error:null};
  if(peopleError)return failure("Unable to load collaborator names",503);
  const namesById=new Map((people||[]).map((x:any)=>[x.id,String(x.display_name||"").trim()]));
  const outgoing=ownShares.map((d:any)=>({...d,assignee_email:emailById.get(d.assignee_customer_id)||"Sandy user",assignee_name:namesById.get(d.assignee_customer_id)||emailById.get(d.assignee_customer_id)||"Sandy user"}));
  const outgoingParticipants=ownerParticipants.map((d:any)=>({...d,assignee_email:emailById.get(d.customer_id)||"Sandy user",assignee_name:namesById.get(d.customer_id)||emailById.get(d.customer_id)||"Sandy user"}));
  const collaborators=[...new Map(outgoing.filter((d:any)=>d.status==="accepted").map((d:any)=>[d.assignee_customer_id,{customer_id:d.assignee_customer_id,name:d.assignee_name,email:d.assignee_email}])).values()].sort((a:any,b:any)=>a.name.localeCompare(b.name));
  const accepted=[...inShares.filter((d:any)=>d.status==="accepted"),...incomingParticipants.filter((d:any)=>participantOwner.has(d.task_id)).map((d:any)=>({task_id:d.task_id,owner_customer_id:participantOwner.get(d.task_id),scope:d.scope,id:null,participant_role:d.role}))];
  const invitationIds=inShares.filter((d:any)=>d.status==="invited").map((d:any)=>d.task_id);
  const {data:inviteTasks,error:inviteError}=invitationIds.length?await db.from("sandy_tasks").select("id,title").in("id",invitationIds):{data:[],error:null};
  if(inviteError)return failure("Unable to load invitation titles",503);
  const inviteTitle=new Map((inviteTasks||[]).map((t:any)=>[t.id,t.title]));
  const inbound=inShares.map((d:any)=>({...d,task_title:inviteTitle.get(d.task_id)||"Shared task"}));
  const topIds=accepted.map((d:any)=>d.task_id);
  const {data:roots,error:sharedError}=topIds.length?await db.from("sandy_tasks")
    .select("id,parent_task_id,company_id,category_id,title,details,status,priority,due_at,start_at,contact_name,next_review_at,waiting_on,position,created_at,updated_at,completed_at,archived_at,version,customer_id")
    .in("id",topIds):{data:[],error:null};
  if(sharedError)return failure("Unable to load assigned tasks",503);
  const shared:any[]=[];
  for(const d of accepted){
    const root=(roots||[]).find((t:any)=>t.id===d.task_id);
    if(!root||root.archived_at)continue;
    shared.push({...root,shared:true,shared_owner_id:d.owner_customer_id,share_id:d.id,share_scope:d.scope});
    {
      const queue=[root.id],visited=new Set(queue);
      while(queue.length&&visited.size<150){
        const {data:children,error:childError}=await db.from("sandy_tasks")
           .select("id,parent_task_id,company_id,category_id,title,details,status,priority,due_at,start_at,contact_name,next_review_at,waiting_on,position,created_at,updated_at,completed_at,archived_at,version,customer_id")
           .eq("customer_id",d.owner_customer_id).in("parent_task_id",queue).is("archived_at",null).limit(150);
        if(childError)return failure("Unable to load shared subtasks",503);
        queue.length=0;
        for(const child of children||[]){
          if(visited.has(child.id))continue;
          visited.add(child.id);queue.push(child.id);
          shared.push({...child,shared:true,shared_owner_id:d.owner_customer_id,share_id:d.id,share_scope:d.scope});
        }
      }
    }
  }
  const ownIds=new Set((tasks.data||[]).map((t:any)=>t.id));
  const uniqueShared=shared.filter((t:any,i:number)=>!ownIds.has(t.id)&&shared.findIndex((v:any)=>v.id===t.id)===i);
  return json(200,{tasks:[...(tasks.data||[]),...uniqueShared],suggestions:sg.data||[],attention:attn.data||[],dependencies:deps.data||[],companies:companies.data||[],categories:categories.data||[],delegations:outgoing,participants:outgoingParticipants,externalInvitations:extInviteRes.data||[],collaborators,receivedDelegations:inbound,email:s.email,customer_id:cid,display_name:customer.data?.display_name||""});
 }
 if(action==="revoke-access"&&req.method==="POST"){
  if(!isUUID(p.task_id))return failure("Invalid task",400);
  const {data:own}=await db.from("sandy_tasks").select("id").eq("id",p.task_id).eq("customer_id",cid).maybeSingle();
  if(!own)return failure("Only the owner can revoke access",403);
  if(isUUID(p.invitation_id)){
   const {data:cancelled,error}=await db.from("sandy_external_task_invitations").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("id",p.invitation_id).eq("task_id",p.task_id).eq("owner_customer_id",cid).in("status",["sending","sent"]).select("id").maybeSingle();
   if(error)return failure("Unable to cancel invitation",503);
   return cancelled?json(200,{ok:true}):failure("Invitation no longer pending",409);
  }
  if(!isUUID(p.customer_id))return failure("Select an invited person",400);
  const table=p.kind==="share"?"sandy_task_participants":"sandy_task_delegations";
  let q=db.from(table).update({status:"revoked",updated_at:new Date().toISOString()}).eq("task_id",p.task_id).in("status",["invited","accepted"]);
  q=p.kind==="share"?q.eq("customer_id",p.customer_id):q.eq("owner_customer_id",cid).eq("assignee_customer_id",p.customer_id);
  const {data,error}=await q.select("task_id").maybeSingle();
  if(error)return failure("Unable to revoke access",503);
  return data?json(200,{ok:true}):failure("No active access found",404);
 }
 if(action==="share-task"&&req.method==="POST"){
  if(!isUUID(p.task_id))return failure("Invalid task",400);
  const email=norm(p.email);if(!validateEmail(email))return failure("Enter a valid email",400);
  const {data:own}=await db.from("sandy_tasks").select("id").eq("id",p.task_id).eq("customer_id",cid).is("archived_at",null).maybeSingle();
  if(!own)return failure("Only the owner can share",403);
  const {data:recipient,error:re}=await db.from("sandy_agenda_access").select("customer_id").eq("email",email).eq("enabled",true).maybeSingle();
  if(re||!recipient)return failure("Sharing currently requires an active Sandy account",400);
  if(recipient.customer_id===cid)return failure("Cannot share with yourself",400);
  const role=p.role==="viewer"?"viewer":"collaborator",scope=p.scope==="task"?"task":"subtree";
  const {error}=await db.from("sandy_task_participants").upsert({task_id:p.task_id,customer_id:recipient.customer_id,role,scope,status:"accepted",updated_at:new Date().toISOString()},{onConflict:"task_id,customer_id"});
  if(error)return failure("Could not share task",503);
  return json(200,{ok:true,note:"Task shared. The collaborator can now see it in Sandy; no external email was sent."});
 }
 if((action==="delegate"||action==="invite-delegate")&&req.method==="POST"){
  if(!isUUID(p.task_id))return failure("Invalid task");
  const email=norm(p.email);if(!validateEmail(email))return failure("Enter a valid recipient email");
  const {data:task,error:te}=await db.from("sandy_tasks").select("id").eq("customer_id",cid).eq("id",p.task_id).is("archived_at",null).maybeSingle();
  if(te||!task)return failure("Only the owner can delegate this task",403);
  const invitationContext=await delegationContext(cid,p.task_id);
  const {data:address,error:ae}=await db.from("email_customer_addresses").select("customer_id").eq("normalized_email",email).eq("is_primary",true).maybeSingle();
  if(ae)return failure("Unable to verify Sandy client",503);
  if(!address){
   const token=randomToken(),hash=await digest(token),scope=p.scope==="subtree"?"subtree":"task";
   const {data:id,error:claimErr}=await db.rpc("sandy_claim_external_task_invitation",{p_owner:cid,p_task:p.task_id,p_email:email,p_scope:scope,p_hash:hash});
   if(claimErr)return failure("Unable to prepare invitation",503);
   if(!id)return json(200,{ok:true,already_requested:true,note:"An invitation to this email was recently submitted or is being processed."});
   try{
    const inviteLink=url+"/functions/v1/sandy-agenda?action=accept-external&token="+encodeURIComponent(token);
    await sendExternalIntroduction(email,inviteLink,String(id).slice(0,8).toUpperCase(),invitationContext.senderName,invitationContext.taskTitle);
    const {error:sentErr}=await db.from("sandy_external_task_invitations").update({status:"sent",last_sent_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id);
    if(sentErr)console.error("sandy_external_receipt_failed",sentErr.code);
    return json(200,{ok:true,submitted:true,recipient_type:"new",note:"Sandy submitted an introductory invitation email. No account was created. The recipient can accept the secure invitation."});
   }catch(e){
    const code=e instanceof Error?e.message:"unknown";
    await db.from("sandy_external_task_invitations").update({status:"failed",last_error:code,updated_at:new Date().toISOString()}).eq("id",id);
    return failure("Invitation email could not be confirmed as submitted. Please retry later.",503);
   }
  }
  const recipientId=address.customer_id;
  if(recipientId===cid)return failure("Choose another Sandy client");
  const {data:agenda,error:ace}=await db.from("sandy_agenda_access").select("customer_id,enabled").eq("email",email).maybeSingle();
  if(ace)return failure("Unable to verify Agenda enrollment",503);
  if(agenda&&agenda.customer_id!==recipientId)return failure("Account identity mismatch. Contact Sandy support.",409);
  const {data:portal,error:pe}=await db.from("sandy_memory_portal_accounts").select("auth_user_id,revoked_at").eq("customer_id",recipientId).maybeSingle();
  if(pe)return failure("Unable to verify account linkage",503);
  if(portal?.revoked_at)return failure("This Sandy account was revoked. Contact Sandy support.",409);
  let activated=false;
  if(agenda?.enabled&&portal?.auth_user_id){
   const {data:user,error:ue}=await db.auth.admin.getUserById(portal.auth_user_id);
   activated=!ue&&!!user.user?.email_confirmed_at&&norm(user.user?.email)===email;
  }
  const scope=p.scope==="subtree"?"subtree":"task";
  if(action==="delegate"&&activated){
   const {data:current,error:ce}=await db.from("sandy_task_delegations").select("id,status,scope").eq("task_id",p.task_id).eq("assignee_customer_id",recipientId).maybeSingle();
   if(ce)return failure("Unable to check existing delegation",503);
   if(current?.status==="accepted"&&current.scope===scope)return json(200,{ok:true,id:current.id,note:"This task is already delegated and accepted."});
   if(current?.status==="invited"&&current.scope===scope)return json(200,{ok:true,id:current.id,already_requested:true,note:"The task invitation is already pending in this person's Agenda."});
   const {data,error}=await db.from("sandy_task_delegations").upsert({owner_customer_id:cid,task_id:p.task_id,assignee_customer_id:recipientId,scope,status:current?.status==="accepted"?"accepted":"invited",updated_at:new Date().toISOString(),accepted_at:current?.status==="accepted"?new Date().toISOString():null},{onConflict:"task_id,assignee_customer_id"}).select("id").single();
   if(error)return failure("Could not create delegation",503);
   if(current?.status==="accepted")return json(200,{ok:true,id:data.id,note:"Delegation scope updated."});
   const {data:claim,error:claimError}=await db.rpc("sandy_agenda_claim_invite",{p_owner:cid,p_assignee:recipientId,p_task:p.task_id,p_email:email});
   if(claimError)return failure("Task saved, but invitation email was not queued. Please try again later.",503);
   if(!claim)return json(200,{ok:true,id:data.id,already_requested:true,note:"Task invitation is pending; a recent email has already been submitted or queued."});
   try{
    const [senderResult,taskResult]=await Promise.all([db.from("email_customers").select("display_name").eq("id",cid).maybeSingle(),db.from("sandy_tasks").select("title").eq("id",p.task_id).eq("customer_id",cid).maybeSingle()]);
    await sendTaskShareNotice(email,p.task_id,String(senderResult.data?.display_name||"Sandy user"),String(taskResult.data?.title||"Task"));
    await db.from("sandy_agenda_invite_deliveries").update({status:"submitted",submitted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",claim);
    return json(200,{ok:true,id:data.id,submitted:true,note:"Sandy submitted a task invitation email. The recipient can review and accept it in Agenda."});
   }catch(e){
    await db.from("sandy_agenda_invite_deliveries").update({status:"failed",last_error_code:"task_invitation_delivery_failed",updated_at:new Date().toISOString()}).eq("id",claim);
    return json(503,{error:"Task was saved, but Sandy could not confirm email submission. The invitation is visible in their Agenda.",code:"task_notice_delivery_failed"});
   }
  }
  if(activated)return json(409,{error:"This Sandy client already has an active account.",code:"recipient_already_active"});
  // Explicit invitation action only: no account, email or task mutation on the initial failed Delegate click.
  const {data:claimed,error:claimErr}=await db.rpc("sandy_agenda_claim_invite",{p_owner:cid,p_assignee:recipientId,p_task:p.task_id,p_email:email});
  if(claimErr)return failure("Unable to register the invitation request",503);
  if(!claimed){
   const {data:previous}=await db.from("sandy_agenda_invite_deliveries").select("status").eq("task_id",p.task_id).eq("assignee_customer_id",recipientId).maybeSingle();
   return json(200,{ok:true,already_requested:true,note:previous?.status==="submitted"?"An activation email was already submitted recently.":"An invitation is already being processed. Please try again later."});
  }
  async function inviteFailed(code:string){
   await db.from("sandy_agenda_invite_deliveries").update({status:"failed",last_error_code:code,updated_at:new Date().toISOString()}).eq("id",claimed);
  }
  try{
   const redirect="https://ausstyle.github.io/web-staging/sandy/app/?return="+encodeURIComponent("/web-staging/sandy/agenda/?task="+p.task_id+"&accept=1");
   const {data:link,error:le}=await db.auth.admin.generateLink({type:"magiclink",email,options:{redirectTo:redirect}});
   const authId=link?.user?.id,actionLink=link?.properties?.action_link;
   if(le||!authId||!actionLink||norm(link.user.email)!==email)throw Error("activation_link_unavailable");
   if(!actionLink.startsWith(url+"/auth/v1/verify?"))throw Error("invalid_activation_host");
   const actualRedirect=new URL(actionLink).searchParams.get("redirect_to")||link.properties?.redirect_to;
   if(actualRedirect!==redirect)throw Error("activation_redirect_not_allowlisted");
   if(portal&&portal.auth_user_id!==authId)throw Error("client_auth_identity_conflict");
   if(!portal){
    const {error:insErr}=await db.from("sandy_memory_portal_accounts").insert({customer_id:recipientId,auth_user_id:authId});
    if(insErr)throw Error("client_link_failed");
   }
   if(!agenda){
    const {error:enrollErr}=await db.from("sandy_agenda_access").insert({email,customer_id:recipientId,enabled:true,onboarding_source:"delegation_invite"});
    if(enrollErr)throw Error("agenda_enrollment_failed");
   }else if(!agenda.enabled){
    const {error:enableErr}=await db.from("sandy_agenda_access").update({enabled:true,updated_at:new Date().toISOString()}).eq("email",email).eq("customer_id",recipientId);
    if(enableErr)throw Error("agenda_enrollment_failed");
   }
   const {data:current,error:de}=await db.from("sandy_task_delegations").select("id,status").eq("task_id",p.task_id).eq("assignee_customer_id",recipientId).maybeSingle();
   if(de)throw Error("delegation_lookup_failed");
   if(!current||current.status!=="accepted"){
    const {error:upErr}=await db.from("sandy_task_delegations").upsert({owner_customer_id:cid,task_id:p.task_id,assignee_customer_id:recipientId,scope,status:"invited",updated_at:new Date().toISOString(),accepted_at:null},{onConflict:"task_id,assignee_customer_id"});
    if(upErr)throw Error("delegation_record_failed");
   }
   await sendSandyActivation(email,actionLink,invitationContext.senderName,invitationContext.taskTitle);
   const {error:receiptErr}=await db.from("sandy_agenda_invite_deliveries").update({status:"submitted",submitted_at:new Date().toISOString(),updated_at:new Date().toISOString(),last_error_code:null}).eq("id",claimed);
   if(receiptErr){console.error("sandy_agenda_invite_receipt_update_failed",receiptErr.code);return json(200,{ok:true,submitted:true,note:"Sandy submitted an activation email. Receipt logging needs review."})}
   return json(200,{ok:true,submitted:true,note:"Sandy submitted an activation email from ai@email.com.au. The client must verify the email and accept the task invitation."});
  }catch(err){
   const code=err instanceof Error?err.message:"unexpected_invitation_failure";
   await inviteFailed(code);
   console.error("sandy_agenda_invite_failed",code);
   return json(503,{error:"Sandy could not confirm the activation invitation was sent. No email delivery is claimed; you can retry.",code:"invitation_send_failed"});
  }
 }
 if(action==="accept-task-link"&&req.method==="POST"){
  if(!isUUID(p.task_id))return failure("Invalid task",400);
  const {data:inv,error}=await db.from("sandy_task_delegations").select("id,status").eq("task_id",p.task_id).eq("assignee_customer_id",cid).in("status",["invited","accepted"]).maybeSingle();
  if(error||!inv)return failure("No invitation exists for your account",403);
  if(inv.status==="invited"){
   const {data:done,error:ue}=await db.from("sandy_task_delegations").update({status:"accepted",accepted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",inv.id).eq("assignee_customer_id",cid).eq("status","invited").select("id").maybeSingle();
   if(ue)return failure("Unable to accept invitation",503);
  }
  return json(200,{ok:true,task_id:p.task_id,accepted:true});
 }
 if(action==="delegation-response"&&req.method==="POST"){
  if(!isUUID(p.id)||!["accepted","declined"].includes(p.decision))return failure("Invalid response");
  const fields:any={status:p.decision,updated_at:new Date().toISOString()};
  if(p.decision==="accepted")fields.accepted_at=new Date().toISOString();
  const {data,error}=await db.from("sandy_task_delegations").update(fields).eq("id",p.id).eq("assignee_customer_id",cid).eq("status","invited").select("id").maybeSingle();
  if(error||!data)return failure("Invitation was not found",404);
  return json(200,{ok:true});
 }
 if(action==="delegation-revoke"&&req.method==="POST"){
  if(!isUUID(p.id))return failure("Invalid invitation");
  const {data,error}=await db.from("sandy_task_delegations").update({status:"revoked",updated_at:new Date().toISOString()}).eq("id",p.id).eq("owner_customer_id",cid).select("id").maybeSingle();
  if(error||!data)return failure("Delegation was not found",404);
  return json(200,{ok:true});
 }
 async function sharedOwnerFor(targetId:string){
  if(!isUUID(targetId))return null;
  const {data:shares,error}=await db.from("sandy_task_delegations").select("task_id,owner_customer_id").eq("assignee_customer_id",cid).eq("status","accepted");
  const {data:parts,error:partsError}=await db.from("sandy_task_participants").select("task_id").eq("customer_id",cid).eq("status","accepted").eq("role","collaborator");
  if(partsError)throw Error("Unable to verify collaborator permissions");
  const {data:partOwners,error:partOwnersError}=(parts||[]).length?await db.from("sandy_tasks").select("id,customer_id").in("id",(parts||[]).map((p:any)=>p.task_id)):{data:[],error:null};
  if(partOwnersError)throw Error("Unable to verify collaborator permissions");
  const mergedShares=[...(shares||[]),...(partOwners||[]).map((v:any)=>({task_id:v.id,owner_customer_id:v.customer_id}))];
  if(error)throw Error("Unable to verify shared permissions");
  const {data:target,error:te}=await db.from("sandy_tasks").select("id,parent_task_id,customer_id").eq("id",targetId).is("archived_at",null).maybeSingle();
  if(te||!target)return null;
  for(const share of mergedShares){
   if(share.owner_customer_id!==target.customer_id)continue;
   if(share.task_id===target.id)return target.customer_id;
   let cursor=target.parent_task_id;
   for(let i=0;i<24&&cursor;i++){
    if(cursor===share.task_id)return target.customer_id;
    const {data:ancestor,error:ae}=await db.from("sandy_tasks").select("parent_task_id").eq("id",cursor).eq("customer_id",target.customer_id).maybeSingle();
    if(ae||!ancestor)break;cursor=ancestor.parent_task_id;
   }
  }
  return null;
 }
 if(action==="shared-create"&&req.method==="POST"){
  const parentId=p.parent_task_id,title=String(p.title||"").trim();
  if(!isUUID(parentId)||!title||title.length>240)return failure("Invalid shared subtask",400);
  const owner=await sharedOwnerFor(parentId);
  if(!owner)return failure("You have not accepted access to this task",403);
  const {data:parent}=await db.from("sandy_tasks").select("status,company_id,category_id").eq("id",parentId).eq("customer_id",owner).maybeSingle();
  if(!parent||["completed","cancelled"].includes(parent.status))return failure("Parent is not open",409);
  const {data:created,error}=await db.from("sandy_tasks").insert({customer_id:owner,company_id:parent.company_id,category_id:parent.category_id,parent_task_id:parentId,title,details:"",priority:"normal",updated_by:"delegate:"+s.email}).select("id").single();
  if(error||!created)return failure("Unable to add shared subtask",503);
  return json(200,{ok:true,id:created.id});
 }
 if((action==="task-history"||action==="task-comment")&&(req.method==="GET"||req.method==="POST")){
  const id=String(p.id||new URL(req.url).searchParams.get("id")||"");
  if(!isUUID(id))return failure("Invalid task",400);
  const {data:owned}=await db.from("sandy_tasks").select("id,title,customer_id").eq("id",id).eq("customer_id",cid).is("archived_at",null).maybeSingle();
  const owner=owned?cid:await sharedOwnerFor(id);
  if(!owner)return failure("Task access denied",403);
  if(action==="task-history"&&(req.method==="GET"||req.method==="POST")){
   const {data,error}=await db.from("sandy_task_events").select("id,event_type,actor,snapshot,created_at").eq("customer_id",owner).eq("task_id",id).in("event_type",["comment","task_note"]).order("created_at",{ascending:true}).limit(300);
   if(error)return failure("Unable to load task history",503);
   return json(200,{ok:true,entries:data||[]});
  }
  if(action==="task-comment"&&req.method==="POST"){
   const body=String(p.text||"").trim();
   if(!body||body.length>12000)return failure("Comment must contain 1–12000 characters",400);
   const {data,error}=await db.from("sandy_task_events").insert({customer_id:owner,task_id:id,event_type:"comment",actor:s.email,snapshot:{text:body}}).select("id,created_at").single();
   if(error)return failure("Unable to save comment",503);
   return json(200,{ok:true,entry:data});
  }
 }
 if(action==="shared-update"&&req.method==="POST"){
  if(!isUUID(p.id))return failure("Invalid task",400);
  const owner=await sharedOwnerFor(p.id);
  if(!owner)return failure("You have not accepted access to this task",403);
  const fields:Record<string,unknown>={updated_by:"delegate:"+s.email};
  if(p.title!==undefined){if(typeof p.title!=="string"||!p.title.trim()||p.title.length>240)return failure("Invalid title");fields.title=p.title.trim()}
  if(p.status!==undefined){if(!["todo","in_progress","waiting","blocked","completed"].includes(p.status))return failure("Invalid status");fields.status=p.status}
  if(p.details!==undefined){if(typeof p.details!=="string"||p.details.length>12000)return failure("Invalid details");fields.details=p.details}
  if(p.priority!==undefined){if(!["low","normal","high","urgent"].includes(p.priority))return failure("Invalid priority");fields.priority=p.priority}
  if(p.due_at!==undefined){if(p.due_at&&Number.isNaN(new Date(p.due_at).getTime()))return failure("Invalid due date");fields.due_at=p.due_at?new Date(p.due_at).toISOString():null}
  if(p.position!==undefined){if(!Number.isInteger(p.position)||p.position<0||p.position>10000000)return failure("Invalid position");fields.position=p.position}
  if(Object.keys(fields).length<2)return failure("Nothing to update");
  const {data:updated,error}=await db.from("sandy_tasks").update(fields).eq("id",p.id).eq("customer_id",owner).is("archived_at",null).select("id").maybeSingle();
  if(error||!updated)return failure("Unable to update shared task",503);
  return json(200,{ok:true});
 }

 async function categoryValid(companyId:string|null,categoryId:string|null){
  if(!categoryId)return true;
  if(!companyId||!isUUID(categoryId))return false;
  const {data,error}=await db.from("sandy_agenda_categories").select("id").eq("id",categoryId).eq("company_id",companyId).eq("customer_id",cid).maybeSingle();
  return !error&&!!data;
 }
 if(action==="category-create"&&req.method==="POST"){
  const name=String(p.name||"").trim(),companyId=p.company_id,parentId=p.parent_category_id||null;
  if(!isUUID(companyId)||!name||name.length>160||parentId&&!isUUID(parentId))return failure("Enter a valid company and category name (up to 160 characters)");
  const {data:company}=await db.from("sandy_agenda_companies").select("id").eq("id",companyId).eq("customer_id",cid).maybeSingle();
  if(!company)return failure("Company not found",404);
  if(parentId&&!await categoryValid(companyId,parentId))return failure("Parent category not found in this company",404);
  const {data,error}=await db.from("sandy_agenda_categories").insert({customer_id:cid,company_id:companyId,parent_category_id:parentId,name}).select("id,company_id,parent_category_id,name").single();
  if(error)return failure(error.code==="23505"?"That category already exists here":error.message,400);
  return json(200,{category:data});
 }
 if(action==="category-update"&&req.method==="POST"){
  if(!isUUID(p.id))return failure("Invalid category");
  const {data:current,error:readError}=await db.from("sandy_agenda_categories").select("id,company_id").eq("id",p.id).eq("customer_id",cid).maybeSingle();
  if(readError||!current)return failure("Category not found",404);
  const fields:Record<string,unknown>={updated_at:new Date().toISOString()};
  if(p.name!==undefined){const name=String(p.name||"").trim();if(!name||name.length>160)return failure("Enter a category name under 160 characters");fields.name=name}
  if(p.parent_category_id!==undefined){
   const parent=p.parent_category_id||null;
   if(parent&&!isUUID(parent))return failure("Invalid parent category");
   if(parent===p.id)return failure("A category cannot contain itself");
   if(parent&&!await categoryValid(current.company_id,parent))return failure("Parent category not found in this company",404);
   fields.parent_category_id=parent;
  }
  if(Object.keys(fields).length===1)return failure("Nothing to update");
  const {data,error}=await db.from("sandy_agenda_categories").update(fields).eq("id",p.id).eq("customer_id",cid).select("id,company_id,parent_category_id,name").maybeSingle();
  if(error)return failure(error.code==="23505"?"That category already exists here":error.message,400);
  if(!data)return failure("Category not found",404);
  return json(200,{category:data});
 }
 if(action==="category-delete"&&req.method==="POST"){
  if(!isUUID(p.id))return failure("Invalid category");
  const {data,error}=await db.from("sandy_agenda_categories").delete().eq("id",p.id).eq("customer_id",cid).select("id").maybeSingle();
  if(error)return failure(error.code==="23503"?"Move or remove tasks and nested categories before deleting":error.message,409);
  if(!data)return failure("Category not found",404);
  return json(200,{ok:true});
 }
 if(action==="company-create"&&req.method==="POST"){
  const name=String(p.name||"").trim();
  if(!name||name.length>160)return failure("Enter a company name under 160 characters");
  const {data,error}=await db.from("sandy_agenda_companies").insert({customer_id:cid,name}).select("id,name").single();
  if(error)return failure(error.code==="23505"?"That company already exists":error.message,400);
  return json(200,{company:data});
 }
 if(action==="create"&&req.method==="POST"){
  const title=String(p.title||"").trim();const details=String(p.details||"").trim();
  if(!title||title.length>240||details.length>12000)return failure("Provide a title under 240 characters");
  const priority=["low","normal","high","urgent"].includes(p.priority)?p.priority:"normal";
  let due:string|null=null;
  if(p.due_at){const d=new Date(p.due_at);if(!Number.isFinite(d.getTime()))return failure("Invalid due date");due=d.toISOString()}
  if(p.next_review_at&&!Number.isFinite(new Date(p.next_review_at).getTime()))return failure("Invalid follow-up date");
  let companyId=p.company_id||null;if(companyId&&!isUUID(companyId))return failure("Invalid company");
  let categoryId=p.category_id===undefined?null:p.category_id;if(categoryId!==null&&!isUUID(categoryId))return failure("Invalid category");
  if(companyId){const {data:company}=await db.from("sandy_agenda_companies").select("id").eq("customer_id",cid).eq("id",companyId).maybeSingle();if(!company)return failure("Company not found",404)}
  let createdId:string|null=null;
  if(p.parent_task_id){
   if(!isUUID(p.parent_task_id))return failure("Invalid parent task");
   const {data:parent}=await db.from("sandy_tasks").select("id,status,company_id,category_id").eq("id",p.parent_task_id).eq("customer_id",cid).is("archived_at",null).maybeSingle();
   if(!parent)return failure("Parent task was not found",404);
   if(["completed","cancelled"].includes(parent.status))return failure("Reopen parent before adding a subtask");
   // An explicitly supplied workspace wins; otherwise inherit the parent.
   if(p.company_id===undefined)companyId=parent.company_id;
   if(p.category_id===undefined)categoryId=companyId===parent.company_id?parent.category_id:null;
   if(!await categoryValid(companyId,categoryId))return failure("Category is not part of this company",400);
   const {data:created,error}=await db.from("sandy_tasks").insert({customer_id:cid,company_id:companyId,category_id:categoryId,parent_task_id:parent.id,title,details,priority,due_at:due,next_review_at:p.next_review_at?new Date(p.next_review_at).toISOString():null,waiting_on:p.waiting_on?String(p.waiting_on).slice(0,400):null,updated_by:"customer:"+s.email}).select("id").single();
   if(error)return failure(error.message,400);
   createdId=created.id;
  }else{
   if(!await categoryValid(companyId,categoryId))return failure("Category is not part of this company",400);
   const subtasks=Array.isArray(p.subtasks)?p.subtasks:[];
   if(subtasks.length>30||subtasks.some((a:unknown)=>typeof a!=="string"||!String(a).trim()||String(a).length>240))return failure("Up to 30 subtasks are allowed, each under 240 characters");
   const {data:newId,error}=await db.rpc("sandy_task_create_categorized_bundle",{p_customer_id:cid,p_company_id:companyId,p_category_id:categoryId,p_title:title,p_details:details,p_priority:priority,p_due_at:due,p_subtasks:subtasks,p_actor:"customer:"+s.email});
   if(!error&&newId&&(p.next_review_at||p.waiting_on))await db.from("sandy_tasks").update({next_review_at:p.next_review_at?new Date(p.next_review_at).toISOString():null,waiting_on:p.waiting_on?String(p.waiting_on).slice(0,400):null}).eq("id",newId).eq("customer_id",cid);
   if(error)return failure(error.message,400);
   createdId=newId;
  }
  return json(200,{ok:true,id:createdId});
 }
 if(action==="update"&&req.method==="POST"){
  if(!isUUID(p.id))return failure("Invalid task");
  const fields:Record<string,unknown>={updated_by:"customer:"+s.email};
  if(p.company_id!==undefined||p.category_id!==undefined){
   const {data:current,error:readError}=await db.from("sandy_tasks").select("company_id,category_id").eq("id",p.id).eq("customer_id",cid).maybeSingle();
   if(readError||!current)return failure("Task not found",404);
   const newCompany=p.company_id===undefined?current.company_id:p.company_id;
   const newCategory=p.category_id===undefined?(newCompany===current.company_id?current.category_id:null):p.category_id;
   if(newCategory!==null&&!isUUID(newCategory))return failure("Invalid category");
   if(!await categoryValid(newCompany,newCategory))return failure("Category is not part of this company",400);
   fields.category_id=newCategory;
  }
  if(p.company_id!==undefined){if(p.company_id!==null&&!isUUID(p.company_id))return failure("Invalid company");if(p.company_id!==null){const {data:company}=await db.from("sandy_agenda_companies").select("id").eq("customer_id",cid).eq("id",p.company_id).maybeSingle();if(!company)return failure("Company not found",404)}fields.company_id=p.company_id}
  if(p.title!==undefined){if(typeof p.title!=="string"||!p.title.trim()||p.title.length>240)return failure("Invalid title");fields.title=p.title.trim()}
  if(p.details!==undefined){if(typeof p.details!=="string"||p.details.length>12000)return failure("Details are too long");fields.details=p.details}
  if(p.status!==undefined){if(!["todo","in_progress","waiting","blocked","completed","cancelled"].includes(p.status))return failure("Invalid status");fields.status=p.status}
  if(p.priority!==undefined){if(!["low","normal","high","urgent"].includes(p.priority))return failure("Invalid priority");fields.priority=p.priority}
  if(p.due_at!==undefined){if(p.due_at){const d=new Date(p.due_at);if(!Number.isFinite(d.getTime()))return failure("Invalid date");fields.due_at=d.toISOString()}else fields.due_at=null}
  if(p.parent_task_id!==undefined){
    if(p.parent_task_id!==null&&!isUUID(p.parent_task_id))return failure("Invalid parent task");
    if(p.parent_task_id===p.id)return failure("A task cannot be its own parent");
    if(p.parent_task_id!==null){
      const {data:parent,error:pe}=await db.from("sandy_tasks").select("id,status").eq("id",p.parent_task_id).eq("customer_id",cid).is("archived_at",null).maybeSingle();
      if(pe||!parent)return failure("Parent not found",404);
      if(parent.status==="completed"||parent.status==="cancelled")return failure("Reopen parent before moving a task");
    }
    fields.parent_task_id=p.parent_task_id;
  }
  if(p.position!==undefined){if(!Number.isInteger(p.position)||p.position<0||p.position>10000000)return failure("Invalid position");fields.position=p.position}
  if(p.contact_name!==undefined)fields.contact_name=p.contact_name===null?null:String(p.contact_name).slice(0,240);
  if(p.start_at!==undefined){if(p.start_at!==null&&!Number.isFinite(new Date(p.start_at).getTime()))return failure("Invalid start date");fields.start_at=p.start_at?new Date(p.start_at).toISOString():null}
  if(p.waiting_on!==undefined){fields.waiting_on=p.waiting_on===null?null:String(p.waiting_on).slice(0,400)}
  if(p.next_review_at!==undefined){if(p.next_review_at!==null&&!Number.isFinite(new Date(p.next_review_at).getTime()))return failure("Invalid follow-up date");fields.next_review_at=p.next_review_at===null?null:new Date(p.next_review_at).toISOString()}
  if(p.archive===true)fields.archived_at=new Date().toISOString();
  const {data,error}=await db.from("sandy_tasks").update(fields).eq("customer_id",cid).eq("id",p.id).select("id").maybeSingle();
  if(error)return failure(error.message,400);
  if(!data)return failure("Task not found",404);
  return json(200,{ok:true});
 }
 if(action==="complete-tree"&&req.method==="POST"){
  if(!isUUID(p.id)||p.confirm_all!==true)return failure("Explicit confirmation required");
  const {data,error}=await db.rpc("sandy_task_complete_subtree",{p_customer_id:cid,p_task_id:p.id,p_actor:"customer:"+s.email});
  if(error)return failure(error.message,400);
  return json(200,{ok:true,updated:data});
 }
 if(action==="dependency"&&req.method==="POST"){
  if(!isUUID(p.task_id)||!isUUID(p.depends_on_id)||p.task_id===p.depends_on_id)return failure("Invalid dependency");
  const ids=[p.task_id,p.depends_on_id];
  const {data:items,error:lookupError}=await db.from("sandy_tasks").select("id,start_at,due_at").eq("customer_id",cid).in("id",ids).is("archived_at",null);
  if(lookupError||items?.length!==2)return failure("Task not found",404);
  if(p.remove===true){
   const {error}=await db.from("sandy_task_dependencies").delete().eq("customer_id",cid).eq("task_id",p.task_id).eq("depends_on_id",p.depends_on_id);
   if(error)return failure(error.message);
  }else{
   // Reject links whose endpoints cannot be scheduled, and shift an overlapping
   // successor before committing the dependency. Existing unrelated dates remain unchanged.
   const predecessor=items.find((t:any)=>t.id===p.depends_on_id);
   const successor=items.find((t:any)=>t.id===p.task_id);
   const finish=Date.parse(predecessor?.due_at||predecessor?.start_at||"");
   const begin=Date.parse(successor?.start_at||successor?.due_at||"");
   const oldEnd=Date.parse(successor?.due_at||successor?.start_at||"");
   if(!Number.isFinite(finish)||!Number.isFinite(begin)||!Number.isFinite(oldEnd))
    return failure("Both tasks must have valid schedule dates before linking",400);
   // A predecessor can never appear downstream of its own successor.
   const {data:existing,error:depReadError}=await db.from("sandy_task_dependencies").select("task_id,depends_on_id").eq("customer_id",cid);
   if(depReadError)return failure(depReadError.message);
   const queue=[p.depends_on_id],visited=new Set<string>();
   while(queue.length){
    const next=queue.shift()!;
    if(next===p.task_id)return failure("Circular dependencies are not allowed",400);
    if(visited.has(next))continue;
    visited.add(next);
    for(const d of existing||[])if(d.task_id===next)queue.push(d.depends_on_id);
   }
   let shifted=false;
   if(begin<finish){
    const {error:scheduleError}=await db.from("sandy_tasks").update({
     start_at:new Date(finish).toISOString(),
     due_at:new Date(finish+Math.max(0,oldEnd-begin)).toISOString(),
     updated_by:"customer:"+s.email
    }).eq("customer_id",cid).eq("id",p.task_id);
    if(scheduleError)return failure("Unable to align dependent task: "+scheduleError.message);
    shifted=true;
   }
   const {error}=await db.from("sandy_task_dependencies").upsert({customer_id:cid,task_id:p.task_id,depends_on_id:p.depends_on_id},{onConflict:"task_id,depends_on_id",ignoreDuplicates:true});
   if(error){
    if(shifted)await db.from("sandy_tasks").update({start_at:successor?.start_at||null,due_at:successor?.due_at||null}).eq("customer_id",cid).eq("id",p.task_id);
    return failure(error.message);
   }
  }
  return json(200,{ok:true});
 }
 if(action==="archive-tree"&&req.method==="POST"){
  if(!isUUID(p.id)||p.confirm_all!==true)return failure("Explicit confirmation required");
  const {data,error}=await db.rpc("sandy_task_archive_subtree",{p_customer_id:cid,p_task_id:p.id,p_actor:"customer:"+s.email});
  if(error)return failure(error.message,400);
  return json(200,{ok:true,updated:data});
 }
 if(action==="suggestion"&&req.method==="POST"){
  if(!isUUID(p.id)||!["accept","dismiss"].includes(p.decision))return failure("Invalid decision");
  if(p.decision==="accept"){
   const {error}=await db.rpc("sandy_task_suggestion_accept",{p_customer_id:cid,p_suggestion_id:p.id,p_actor:"customer:"+s.email});
   if(error)return failure(error.message,400);
  }else{
   const {data,error}=await db.from("sandy_task_suggestions").update({status:"dismissed",updated_at:new Date().toISOString()}).eq("id",p.id).eq("customer_id",cid).eq("status","suggested").select("id").maybeSingle();
   if(error||!data)return failure("Suggestion not found",404);
  }
  return json(200,{ok:true});
 }
 return failure("Unknown action",404);
}
const PAGE = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"color-scheme\" content=\"light\"><title>Sandy · Your agenda</title><style>\n:root{font:15px/1.5 Inter,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:#29342e;background:#fafaf7;--ink:#27372f;--muted:#7c8980;--line:#e7ebe5;--green:#326b53;--pale:#edf3ec;--white:#fff}\n*{box-sizing:border-box}body{margin:0}button,input,textarea,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}\n.shell{max-width:1140px;margin:auto;padding:0 30px 70px}\nheader{height:80px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}\n.logo{display:flex;align-items:center;gap:10px;font-weight:790;font-size:24px;letter-spacing:-1.1px}.mark{display:grid;place-items:center;border-radius:15px;background:#dcebe0;color:#326b53;width:37px;height:37px;font-size:23px}\n.headright{display:flex;align-items:center;gap:13px;color:var(--muted);font-size:13px}\nh1{font-size:35px;letter-spacing:-1.5px;margin:0 0 3px;line-height:1.2}h2{font-size:18px;letter-spacing:-.35px;margin:0}\n.top{margin:44px 0 27px;display:flex;align-items:center;justify-content:space-between;gap:14px}.intro{color:var(--muted);margin:5px 0 0}\n.btn{border:1px solid var(--line);background:#fff;color:var(--ink);padding:10px 15px;border-radius:11px;font-weight:600;transition:.12s}\n.btn:hover{background:#f4f8f3}.btn.primary{background:#356f55;border-color:#356f55;color:white}.btn.primary:hover{background:#275c44}.btn.plain{background:transparent;border:0;color:var(--green);padding:7px}.btn.small{padding:6px 10px;border-radius:8px;font-size:12px}\n.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}\n.metric{background:var(--white);border:1px solid var(--line);border-radius:16px;padding:19px 20px}.metric span{font-size:12px;color:var(--muted);display:block}.metric b{font-size:29px;letter-spacing:-1px;line-height:1.3}\n.panel{background:var(--white);border:1px solid var(--line);border-radius:18px;padding:23px}\n.quick{display:flex;gap:10px;align-items:center}.quick input{flex:1;border:0;outline:0;padding:9px;font-size:16px;min-width:0}\n.quickicon{color:var(--green);font-size:24px;font-weight:300}\n.helper{font-size:12px;color:var(--muted);padding:8px 0 0 35px}\n.toolbar{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin:28px 0 13px}\n.tabs{display:flex;gap:6px;align-items:center;flex-wrap:wrap}\n.tab{padding:9px 14px;border:0;background:transparent;border-radius:10px;color:var(--muted);font-weight:600;font-size:13px}.tab.active{background:#eaf2e9;color:#245e45}\n.search{padding:10px 13px;border:1px solid var(--line);border-radius:10px;width:230px;max-width:100%;outline:0}\n.tasklist{display:grid;gap:10px}.task{border:1px solid var(--line);border-radius:16px;background:#fff;overflow:hidden}\n.taskrow{display:flex;align-items:flex-start;gap:13px;padding:17px 18px}.taskrow:hover{background:#fcfdfb}\n.taskcheck{appearance:none;width:23px;height:23px;border:1.7px solid #c8d4ca;border-radius:50%;flex-shrink:0;cursor:pointer;margin:2px 0 0;display:grid;place-items:center;background:white}.taskcheck:checked{background:var(--green);border-color:var(--green)}.taskcheck:checked:after{content:\"✓\";color:white;font-size:14px}\n.taskmain{flex:1;min-width:0}.tasktitle{font-weight:660;font-size:15px;overflow-wrap:anywhere}.tasktitle.done{color:#89978b;text-decoration:line-through}.taskdesc{font-size:12px;color:#7b887f;margin:3px 0 0;max-width:760px}\n.meta{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}\n.tag{padding:3px 8px;background:#f3f6f2;border-radius:7px;color:#748275;font-size:11px}.tag.urgent{background:#f9e7df;color:#b4563a}.tag.high{background:#fff3dd;color:#a17429}.tag.overdue{background:#fff0e9;color:#ae563c}\n.progress{width:115px;height:5px;border-radius:8px;background:#e9eee7;overflow:hidden;margin-top:6px}.progress>span{display:block;height:100%;background:#6aab87}\n.right{display:flex;gap:4px;align-items:center;flex-shrink:0}\n.iconbtn{border:0;background:transparent;color:#849287;border-radius:8px;padding:6px 9px;font-size:19px}.iconbtn:hover{background:#edf3ec;color:var(--green)}\n.children{margin-left:51px;border-left:1px solid #e3eae3;padding-left:14px;margin-right:15px;margin-bottom:9px}\n.childrow{border-bottom:1px solid #f0f2ef}.childrow:last-of-type{border-bottom:0}\n.childrow .taskrow{padding:10px 5px}.childrow .taskcheck{width:20px;height:20px;margin-top:2px}.childrow .tasktitle{font-size:13px}\n.addchild{display:flex;gap:6px;align-items:center;padding:8px 0 10px}\n.addchild input{border:0;outline:0;padding:7px;flex:1;min-width:0;font-size:13px}.addchild button{border:0;background:#eaf2e9;color:#356f55;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:700}\n.empty{text-align:center;background:#fff;border:1px dashed #dce5da;border-radius:18px;padding:62px 18px;color:var(--muted)}\n.emptyicon{font-size:34px;background:#edf3ec;display:grid;place-items:center;color:var(--green);width:70px;height:70px;border-radius:50%;margin:0 auto 15px}\n.suggest{border:1px solid #dce9db;background:#f4f9f2;border-radius:15px;padding:16px 20px;margin:15px 0}.suggest h2{font-size:15px}.suggestitem{padding:12px 0;border-top:1px solid #dfebdf;display:flex;align-items:center;justify-content:space-between;gap:12px}.suggestitem:first-of-type{margin-top:9px}.suggestsmall{font-size:12px;color:#748474}\n.dialogoverlay{position:fixed;inset:0;background:#1d2b2380;display:none;align-items:center;justify-content:center;z-index:15;padding:15px}.dialogoverlay.show{display:flex}\n.dialog{background:white;border-radius:22px;padding:28px;width:min(600px,100%);max-height:94vh;overflow:auto;box-shadow:0 22px 70px #0002}\n.dialog h2{font-size:24px}.dialog p{font-size:13px;color:var(--muted);margin:5px 0 19px}\nlabel.field{display:block;margin-top:15px;font-size:12px;font-weight:700;color:#526557}\n.field input,.field textarea,.field select{display:block;width:100%;border:1px solid #dde4dc;border-radius:10px;margin-top:7px;padding:10px 12px;background:white;color:var(--ink);outline-color:#85b59b}\n.field textarea{resize:vertical;min-height:70px}.two{display:grid;grid-template-columns:1fr 1fr;gap:13px}\n.dialogfooter{display:flex;justify-content:flex-end;gap:9px;margin-top:22px}\n.loginscreen{min-height:100vh;display:grid;place-items:center;padding:20px}.loginbox{width:min(430px,100%);background:white;border:1px solid var(--line);border-radius:22px;padding:34px}.loginbox .logo{margin-bottom:28px}.loginbox h2{font-size:25px}.loginbox p{font-size:14px;color:var(--muted)}\n.loginbox input{border:1px solid var(--line);padding:13px;border-radius:11px;width:100%;margin:12px 0}.loginbox button{width:100%}\n.message{font-size:13px;color:var(--green);margin-top:12px}.error{color:#ad5148}\n.hidden{display:none!important}#toast{position:fixed;bottom:22px;right:22px;background:#28392e;color:white;padding:13px 20px;border-radius:11px;box-shadow:0 8px 30px #0003;display:none;z-index:30;font-size:13px}\n@media(max-width:680px){.shell{padding:0 14px 35px}header{height:67px}.top{margin:27px 0 20px;align-items:flex-start}h1{font-size:28px}.summary{grid-template-columns:repeat(2,1fr);gap:8px}.metric{padding:13px}.metric b{font-size:24px}.panel{padding:12px}.toolbar{margin-top:24px}.search{width:100%}.taskrow{padding:13px 11px;gap:10px}.children{margin-left:24px;padding-left:8px;margin-right:8px}.right{gap:0}.iconbtn{padding:5px}.top .btn{font-size:12px;padding:10px}.dialog{padding:18px}.two{grid-template-columns:1fr;gap:0}}\n.attention{background:#fff8f0;border:1px solid #f0e1d2;border-radius:16px;margin:18px 0;padding:17px 19px}.attentionhead{display:flex;gap:12px;align-items:center;margin-bottom:5px}.attentionhead h2{font-size:16px}.attentionicon{display:grid;place-items:center;background:#f5e5d4;color:#ab743d;width:33px;height:33px;border-radius:10px;font-weight:850}.attentionrow{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:11px 0;border-top:1px solid #f2e7db;font-size:13px}.attentionrow strong{font-weight:650}</style></head><body>\n<div id=\"loginScreen\" class=\"loginscreen\"><div class=\"loginbox\"><div class=\"logo\"><div class=\"mark\">✳</div>sandy.</div><h2>Everything on your mind.<br>In one place.</h2><p>Your private agenda. Sign in with the email address you use with Sandy.</p><form id=\"loginForm\"><input id=\"loginEmail\" type=\"email\" placeholder=\"you@example.com\" autocomplete=\"email\" required><button class=\"btn primary\" type=\"submit\">Email me a sign-in code</button></form><form id=\"codeForm\" class=\"hidden\"><input id=\"loginCode\" type=\"text\" inputmode=\"numeric\" maxlength=\"6\" pattern=\"[0-9]{6}\" placeholder=\"6-digit code\" autocomplete=\"one-time-code\" required><button class=\"btn primary\" type=\"submit\">Open my agenda</button><button type=\"button\" id=\"retryLogin\" class=\"btn plain\" style=\"margin-top:8px\">Use a different email</button></form><div id=\"loginMessage\" class=\"message\" aria-live=\"polite\"></div></div></div>\n<div id=\"app\" class=\"shell hidden\">\n<header><div class=\"logo\"><div class=\"mark\">✳</div>sandy.</div><div class=\"headright\"><span id=\"who\"></span><button id=\"logout\" class=\"btn small\">Sign out</button></div></header>\n<div class=\"top\"><div><h1>Your agenda</h1><p class=\"intro\">The important things, always moving forward.</p></div><button id=\"newTask\" class=\"btn primary\">＋ New task</button></div>\n<div class=\"summary\"><div class=\"metric\"><span>Open tasks</span><b id=\"countOpen\">0</b></div><div class=\"metric\"><span>In progress</span><b id=\"countDoing\">0</b></div><div class=\"metric\"><span>Waiting on someone</span><b id=\"countWaiting\">0</b></div><div class=\"metric\"><span>Completed</span><b id=\"countDone\">0</b></div></div>\n<div class=\"panel\"><form id=\"quickForm\" class=\"quick\"><span class=\"quickicon\">＋</span><input id=\"quickTitle\" placeholder=\"What needs to get done?\" maxlength=\"240\" aria-label=\"Quick add task\"><button class=\"btn primary small\" type=\"submit\">Add</button></form><div class=\"helper\">Start with a task, or choose New task to add subtasks, details and a deadline.</div></div>\n<div id=\"attention\" class=\"attention hidden\"></div><div id=\"suggestions\" class=\"suggest hidden\"></div>\n<div class=\"toolbar\"><div class=\"tabs\"><button class=\"tab active\" data-tab=\"open\">Active</button><button class=\"tab\" data-tab=\"today\">Due soon</button><button class=\"tab\" data-tab=\"waiting\">Waiting</button><button class=\"tab\" data-tab=\"done\">Completed</button><button class=\"tab\" data-tab=\"all\">All</button></div><input class=\"search\" id=\"search\" type=\"search\" placeholder=\"Search tasks…\" aria-label=\"Search tasks\"></div>\n<div id=\"tasks\" class=\"tasklist\"></div></div>\n<div id=\"dialogOverlay\" class=\"dialogoverlay\" role=\"presentation\"><div class=\"dialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"dialogHeading\"><h2 id=\"dialogHeading\">Create a task</h2><p>Give Sandy the outcome you want. Add smaller steps if it helps.</p><form id=\"taskForm\">\n<label class=\"field\">Task name<input id=\"taskTitle\" maxlength=\"240\" required placeholder=\"Get my tax return completed\"></label>\n<label class=\"field\">Details (optional)<textarea id=\"taskDetails\" placeholder=\"What does done look like?\"></textarea></label>\n<div class=\"two\"><label class=\"field\">Due date (optional)<input type=\"date\" id=\"taskDue\"></label><label class=\"field\">Priority<select id=\"taskPriority\"><option value=\"normal\">Normal</option><option value=\"high\">High</option><option value=\"urgent\">Urgent</option><option value=\"low\">Low</option></select></label></div>\n<div class=\"two\"><label class=\"field\">Next follow-up (optional)<input type=\"date\" id=\"taskReview\"></label><label class=\"field\">Waiting on (optional)<input type=\"text\" maxlength=\"400\" id=\"taskWaiting\" placeholder=\"Accountant, bank, solicitor…\"></label></div><label class=\"field\" id=\"subtaskField\">Subtasks — one per line (optional)<textarea id=\"taskSubtasks\" rows=\"4\" placeholder=\"Contact bank for records&#10;Review Xero&#10;Send information to accountant\"></textarea></label>\n<label class=\"field\" id=\"statusField\">Status<select id=\"taskStatus\"><option value=\"todo\">To do</option><option value=\"in_progress\">In progress</option><option value=\"waiting\">Waiting</option><option value=\"blocked\">Blocked</option><option value=\"completed\">Completed</option><option value=\"cancelled\">Cancelled</option></select></label>\n<div class=\"dialogfooter\"><button type=\"button\" class=\"btn hidden\" id=\"archiveTask\" style=\"margin-right:auto;color:#a5544a\">Archive task</button><button type=\"button\" class=\"btn\" id=\"cancelDialog\">Cancel</button><button type=\"submit\" class=\"btn primary\" id=\"saveTask\">Save task</button></div></form></div></div>\n<div id=\"toast\" role=\"status\" aria-live=\"polite\"></div>\n<script>\n\"use strict\";\nconst $ = id => document.getElementById(id);\nconst state={tasks:[],suggestions:[],attention:[],tab:\"open\",search:\"\",edit:null,parent:null,email:\"\"};\nconst base=location.pathname;\nfunction toast(t,error){const e=$(\"toast\");e.textContent=t;e.style.background=error?\"#a74f44\":\"#28392e\";e.style.display=\"block\";clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>e.style.display=\"none\",4500)}\nasync function api(action,payload){\n const options={credentials:\"same-origin\",headers:{\"Content-Type\":\"application/json\"}};\n if(payload!==undefined){options.method=\"POST\";options.body=JSON.stringify(payload)}\n const response=await fetch(base+\"?action=\"+encodeURIComponent(action),options);\n const data=await response.json().catch(()=>({error:\"Server returned an unexpected response\"}));\n if(!response.ok)throw new Error(data.error||\"Something went wrong\");\n return data;\n}\nfunction el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n}\nfunction btn(text,cls,fn){const e=el(\"button\",cls,text);e.type=\"button\";e.addEventListener(\"click\",fn);return e}\nfunction dateLabel(d){return d?new Date(d).toLocaleDateString(undefined,{month:\"short\",day:\"numeric\",year:\"numeric\"}):\"\"}\nfunction fromDate(s){return s?new Date(s+\"T12:00:00\").toISOString():null}\nfunction localDate(s){if(!s)return \"\";const d=new Date(s);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,\"0\"),String(d.getDate()).padStart(2,\"0\")].join(\"-\")}\nfunction openTasks(){return state.tasks.filter(t=>t.status!==\"completed\"&&t.status!==\"cancelled\"&&!t.archived_at)}\nfunction childOf(id){return state.tasks.filter(t=>t.parent_task_id===id&&!t.archived_at).sort((a,b)=>a.position-b.position||a.created_at.localeCompare(b.created_at))}\nfunction matched(t){\n if(t.archived_at)return false;\n const q=state.search.toLowerCase().trim();\n if(q&&!(t.title+\" \"+t.details).toLowerCase().includes(q))return false;\n if(state.tab===\"open\")return t.status!==\"completed\"&&t.status!==\"cancelled\";\n if(state.tab===\"done\")return t.status===\"completed\";\n if(state.tab===\"waiting\")return t.status===\"waiting\"||t.status===\"blocked\";\n if(state.tab===\"today\")return t.status!==\"completed\"&&t.status!==\"cancelled\"&&(t.priority===\"urgent\"||(t.due_at&&new Date(t.due_at).getTime() <= Date.now()+172800000));\n return t.status!==\"cancelled\";\n}\nfunction isVisible(t,seen){\n if(seen.has(t.id))return false;seen.add(t.id);\n return matched(t)||childOf(t.id).some(c=>isVisible(c,new Set(seen)));\n}\nfunction countDesc(t){\n const children=childOf(t.id);let done=0,total=0;\n for(const c of children){total++;if(c.status===\"completed\")done++;const nested=countDesc(c);done+=nested.done;total+=nested.total}\n return {done,total}\n}\nfunction renderTask(t,depth){\n const outer=el(\"div\",depth?\"childrow\":\"task\");outer.id=\"task-\"+t.id;\n const row=el(\"div\",\"taskrow\");const check=el(\"input\",\"taskcheck\");check.type=\"checkbox\";check.checked=t.status===\"completed\";\n check.setAttribute(\"aria-label\",\"Mark \"+t.title+\" complete\");check.addEventListener(\"change\",()=>markTask(t,check.checked,check));row.append(check);\n const main=el(\"div\",\"taskmain\");main.append(el(\"div\",\"tasktitle\"+(t.status===\"completed\"?\" done\":\"\"),t.title));\n if(t.details)main.append(el(\"p\",\"taskdesc\",t.details.slice(0,260)));\n const meta=el(\"div\",\"meta\");\n if(t.due_at){const overdue=new Date(t.due_at).getTime()<Date.now()&&t.status!==\"completed\";meta.append(el(\"span\",\"tag\"+(overdue?\" overdue\":\"\"),(overdue?\"Overdue · \":\"Due \")+dateLabel(t.due_at)))}\n if(t.status===\"waiting\"||t.status===\"blocked\"||t.status===\"in_progress\")meta.append(el(\"span\",\"tag\",t.status.replace(\"_\",\" \")));\n if([\"high\",\"urgent\"].includes(t.priority))meta.append(el(\"span\",\"tag \"+t.priority,t.priority));\n const progress=countDesc(t);if(progress.total){meta.append(el(\"span\",\"tag\",progress.done+\" of \"+progress.total+\" steps complete\"));const p=el(\"div\",\"progress\");const fill=el(\"span\");fill.style.width=Math.round(progress.done/progress.total*100)+\"%\";p.append(fill);meta.append(p)}\n main.append(meta);row.append(main);\n const right=el(\"div\",\"right\");right.append(btn(\"＋\",\"iconbtn\",()=>{state.parent=t.id;state.edit=null;openDialog()}));\n right.append(btn(\"⋯\",\"iconbtn\",()=>{state.parent=null;state.edit=t;openDialog()}));row.append(right);outer.append(row);\n const children=childOf(t.id).filter(c=>(state.tab===\"open\"||state.tab===\"all\")?true:isVisible(c,new Set()));\n if(children.length||((state.tab===\"open\"||state.tab===\"all\")&&t.status!==\"completed\"&&t.status!==\"cancelled\")){\n   const box=el(\"div\",\"children\");\n   children.forEach(c=>box.append(renderTask(c,depth+1)));\n   if(t.status!==\"completed\"&&t.status!==\"cancelled\"&&(state.tab===\"open\"||state.tab===\"all\")){\n     const form=el(\"form\",\"addchild\");const input=el(\"input\");input.placeholder=\"＋ Add a step…\";input.maxLength=240;input.setAttribute(\"aria-label\",\"Add subtask to \"+t.title);form.append(input);\n     const add=el(\"button\",\"\",\"Add step\");add.type=\"submit\";form.append(add);\n     form.addEventListener(\"submit\",async e=>{e.preventDefault();const title=input.value.trim();if(!title)return;add.disabled=true;try{await api(\"create\",{title,parent_task_id:t.id});input.value=\"\";await load()}catch(err){toast(err.message,true)}finally{add.disabled=false}});\n     box.append(form);\n   }\n   outer.append(box)\n }\n return outer\n}\nfunction render(){\n const open=openTasks();\n $(\"countOpen\").textContent=String(open.length);\n $(\"countDoing\").textContent=String(open.filter(t=>t.status===\"in_progress\").length);\n $(\"countWaiting\").textContent=String(open.filter(t=>[\"waiting\",\"blocked\"].includes(t.status)).length);\n $(\"countDone\").textContent=String(state.tasks.filter(t=>t.status===\"completed\"&&!t.archived_at).length);\n document.querySelectorAll(\"[data-tab]\").forEach(b=>{b.classList.toggle(\"active\",b.dataset.tab===state.tab)});\n const area=$(\"tasks\");area.replaceChildren();\n const roots=state.tasks.filter(t=>!t.parent_task_id&&!t.archived_at).filter(t=>isVisible(t,new Set())).sort((a,b)=>{\n   const ai=a.priority===\"urgent\"?0:a.priority===\"high\"?1:2;const bi=b.priority===\"urgent\"?0:b.priority===\"high\"?1:2;\n   return ai-bi||(a.due_at||\"9999\").localeCompare(b.due_at||\"9999\")||b.created_at.localeCompare(a.created_at);\n });\n if(!roots.length){const empty=el(\"div\",\"empty\");empty.append(el(\"div\",\"emptyicon\",\"✓\"));empty.append(el(\"h2\",\"\",state.tab===\"done\"?\"No completed tasks yet\":\"All clear here\"));empty.append(el(\"p\",\"\",state.tab===\"open\"?\"Add a task above, or let Sandy suggest the next useful step.\":\"Nothing matches this view.\"));area.append(empty)}\n roots.forEach(t=>area.append(renderTask(t,0)));\n renderSuggestions();renderAttention()\n}\n\nfunction renderAttention(){\n const area=$(\"attention\");area.replaceChildren();\n const seen=new Set();const items=[];\n for(const n of state.attention){if(!seen.has(n.task_id)){const t=state.tasks.find(x=>x.id===n.task_id);if(t){items.push({t,reason:n.reason});seen.add(n.task_id)}}}\n if(!items.length){area.classList.add(\"hidden\");return}\n area.classList.remove(\"hidden\");\n const head=el(\"div\",\"attentionhead\");head.append(el(\"div\",\"attentionicon\",\"!\"));\n const words=el(\"div\",\"\");words.append(el(\"h2\",\"\",\"Worth your attention\"));words.append(el(\"div\",\"suggestsmall\",items.length+\" matter\"+(items.length===1?\"\":\"s\")+\" may need a next step\"));head.append(words);area.append(head);\n for(const item of items.slice(0,5)){\n   const row=el(\"div\",\"attentionrow\");const text=el(\"div\",\"\");\n   text.append(el(\"strong\",\"\",item.t.title));\n   const subtitle={overdue:\"Past its deadline\",due_soon:\"Deadline approaching\",follow_up:\"Time to follow up\",stalled:\"Not progressing\"}[item.reason]||\"Needs review\";\n   text.append(el(\"div\",\"suggestsmall\",subtitle));row.append(text);\n   row.append(btn(\"Review →\",\"btn small\",()=>{state.tab=\"all\";state.search=\"\";$(\"search\").value=\"\";render();$(\"task-\"+item.t.id)?.scrollIntoView({behavior:\"smooth\",block:\"center\"})}));\n   area.append(row)\n }\n}\n\nfunction renderSuggestions(){\n const area=$(\"suggestions\");area.replaceChildren();const ss=state.suggestions.filter(s=>s.status===\"suggested\").slice(0,5);\n if(!ss.length){area.classList.add(\"hidden\");return}\n area.classList.remove(\"hidden\");area.append(el(\"h2\",\"\",\"✳  Sandy noticed something\"));\n area.append(el(\"div\",\"suggestsmall\",\"Potential tasks from your conversations. Review before adding them to your agenda.\"));\n for(const s of ss){const line=el(\"div\",\"suggestitem\");line.append(el(\"div\",\"\",s.title));const actions=el(\"div\",\"right\");\n actions.append(btn(\"Add\",\"btn small primary\",async()=>{try{await api(\"suggestion\",{id:s.id,decision:\"accept\"});toast(\"Added to your agenda\");await load()}catch(e){toast(e.message,true)}}));\n actions.append(btn(\"Dismiss\",\"btn small\",async()=>{try{await api(\"suggestion\",{id:s.id,decision:\"dismiss\"});await load()}catch(e){toast(e.message,true)}}));line.append(actions);area.append(line)}\n}\nasync function load(){\n const data=await api(\"list\");state.tasks=data.tasks||[];state.suggestions=data.suggestions||[];state.attention=data.attention||[];state.email=data.email||\"\";$(\"who\").textContent=data.display_name||state.email;\n $(\"loginScreen\").classList.add(\"hidden\");$(\"app\").classList.remove(\"hidden\");render()\n}\nasync function markTask(t,done,control){\n control.disabled=true;\n try{\n  if(done&&countDesc(t).total>countDesc(t).done){\n    if(!confirm(\"This task has unfinished subtasks. Mark the whole task and every remaining subtask complete?\")){control.checked=false;return}\n    await api(\"complete-tree\",{id:t.id,confirm_all:true})\n  }else{\n    await api(\"update\",{id:t.id,status:done?\"completed\":\"todo\"})\n  }\n  await load();toast(done?\"Marked complete\":\"Task reopened\")\n }catch(e){control.checked=!done;toast(e.message,true)}\n finally{control.disabled=false}\n}\nfunction openDialog(){\n const t=state.edit;$(\"dialogHeading\").textContent=t?\"Edit task\":state.parent?\"Add a subtask\":\"Create a task\";\n $(\"taskTitle\").value=t?t.title:\"\";$(\"taskDetails\").value=t?t.details:\"\";$(\"taskDue\").value=t?localDate(t.due_at):\"\";\n $(\"taskPriority\").value=t?t.priority:\"normal\";$(\"taskStatus\").value=t?t.status:\"todo\";$(\"taskSubtasks\").value=\"\";$(\"taskReview\").value=t?localDate(t.next_review_at):\"\";$(\"taskWaiting\").value=t?t.waiting_on||\"\":\"\";$(\"archiveTask\").classList.toggle(\"hidden\",!t);\n $(\"subtaskField\").classList.toggle(\"hidden\",!!t||!!state.parent);$(\"statusField\").classList.toggle(\"hidden\",!t);\n $(\"dialogOverlay\").classList.add(\"show\");$(\"taskTitle\").focus()\n}\nfunction closeDialog(){$(\"dialogOverlay\").classList.remove(\"show\");state.edit=null;state.parent=null}\n$(\"taskForm\").addEventListener(\"submit\",async e=>{\n e.preventDefault();const save=$(\"saveTask\");save.disabled=true;\n const payload={title:$(\"taskTitle\").value.trim(),details:$(\"taskDetails\").value.trim(),priority:$(\"taskPriority\").value,due_at:fromDate($(\"taskDue\").value),next_review_at:fromDate($(\"taskReview\").value),waiting_on:$(\"taskWaiting\").value.trim()||null};\n if(!payload.title){save.disabled=false;return}\n try{\n  if(state.edit){payload.id=state.edit.id;payload.status=$(\"taskStatus\").value;await api(\"update\",payload)}\n  else{payload.parent_task_id=state.parent;payload.subtasks=state.parent?[]:$(\"taskSubtasks\").value.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean);await api(\"create\",payload)}\n  closeDialog();await load();toast(\"Task saved\")\n }catch(e){toast(e.message,true)}finally{save.disabled=false}\n});\n$(\"archiveTask\").addEventListener(\"click\",async()=>{if(!state.edit)return;if(!confirm(\"Archive this task and all of its subtasks? You will no longer see them in your active agenda.\"))return;try{await api(\"archive-tree\",{id:state.edit.id,confirm_all:true});closeDialog();await load();toast(\"Task archived\")}catch(e){toast(e.message,true)}});\n$(\"cancelDialog\").addEventListener(\"click\",closeDialog);\n$(\"dialogOverlay\").addEventListener(\"click\",e=>{if(e.target===$(\"dialogOverlay\"))closeDialog()});\n$(\"newTask\").addEventListener(\"click\",()=>{state.parent=null;state.edit=null;openDialog()});\n$(\"quickForm\").addEventListener(\"submit\",async e=>{e.preventDefault();const title=$(\"quickTitle\").value.trim();if(!title)return;try{await api(\"create\",{title});$(\"quickTitle\").value=\"\";await load();toast(\"Task added\")}catch(err){toast(err.message,true)}});\n$(\"search\").addEventListener(\"input\",e=>{state.search=e.target.value;render()});\ndocument.querySelectorAll(\"[data-tab]\").forEach(b=>b.addEventListener(\"click\",()=>{state.tab=b.dataset.tab;render()}));\n$(\"loginForm\").addEventListener(\"submit\",async e=>{e.preventDefault();const button=e.currentTarget.querySelector(\"button\");button.disabled=true;const email=$(\"loginEmail\").value.trim();try{await api(\"request-code\",{email});$(\"loginMessage\").textContent=\"If this address is registered with Sandy, your six-digit code is on its way.\";$(\"loginMessage\").className=\"message\";$(\"codeForm\").classList.remove(\"hidden\");$(\"loginForm\").classList.add(\"hidden\");$(\"loginCode\").focus()}catch(err){$(\"loginMessage\").textContent=err.message;$(\"loginMessage\").className=\"message error\"}finally{button.disabled=false}});\n$(\"retryLogin\").addEventListener(\"click\",()=>{$(\"codeForm\").classList.add(\"hidden\");$(\"loginForm\").classList.remove(\"hidden\");$(\"loginMessage\").textContent=\"\"});\n$(\"codeForm\").addEventListener(\"submit\",async e=>{e.preventDefault();const button=e.currentTarget.querySelector(\"button\");button.disabled=true;try{await api(\"verify-code\",{email:$(\"loginEmail\").value.trim(),code:$(\"loginCode\").value.trim()});await load()}catch(err){$(\"loginMessage\").textContent=err.message;$(\"loginMessage\").className=\"message error\"}finally{button.disabled=false}});\n$(\"logout\").addEventListener(\"click\",async()=>{try{await api(\"logout\",{})}catch(e){}location.reload()});\nload().catch(()=>{$(\"app\").classList.add(\"hidden\");$(\"loginScreen\").classList.remove(\"hidden\")});\n</script></body></html>";
Deno.serve(req=>handler(req).catch(e=>{console.error("Sandy agenda request failed",e?.message||"error");return failure("Service temporarily unavailable",503)}));
