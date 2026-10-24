import {handleVoiceContextSession} from "./context_session.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
const HTML="<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"theme-color\" content=\"#f7f7f4\">\n<title>Call Sandy · Sandy AI</title>\n<style nonce=\"SANDY_NONCE\">\n:root{color-scheme:light;font-family:Inter,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:#202525;background:#f7f7f4}\n*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:25px 15px}.frame{width:min(100%,440px);text-align:center}\n.brand{display:flex;align-items:center;justify-content:center;gap:10px;font-size:13px;letter-spacing:.22em;font-weight:750}\n.brand-icon{border:1.5px solid #222;width:29px;height:29px;border-radius:50%;display:grid;place-items:center;font-size:15px;letter-spacing:0}\n.panel{background:#fff;border:1px solid #e5e7e4;border-radius:25px;padding:39px 26px 29px;box-shadow:0 9px 40px rgba(23,40,33,.045);margin-top:30px}\n.avatar{margin:0 auto 25px;width:114px;height:114px;border-radius:50%;display:grid;place-items:center;background:#f0f3ef;border:1px solid #dfe8de;position:relative}\n.avatar i{font-style:normal;font-size:52px;font-weight:430;letter-spacing:-.08em;color:#415d4b}.avatar.live:after{content:\"\";position:absolute;inset:-9px;border:2px solid #7ab18e;border-radius:50%;animation:pulse 2s infinite}\n@keyframes pulse{50%{transform:scale(1.045);opacity:.45}}\nh1{font-size:32px;line-height:1.1;letter-spacing:-.065em;font-weight:640;margin:0 0 12px}p{color:#64716c;font-size:14px;line-height:1.65;margin:0 auto 23px;max-width:300px}\n.status{font-size:12px;color:#62766a;background:#f5f7f4;border-radius:20px;padding:9px 15px;display:inline-flex;align-items:center;gap:7px;min-height:32px;margin-bottom:22px}\n.dot{height:7px;width:7px;border-radius:50%;background:#8cae8e}.dot.on{background:#22a264}\nbutton{font:inherit;cursor:pointer;border:0;transition:opacity .2s,transform .2s}button:disabled{cursor:not-allowed;opacity:.55}\n.primary{display:block;width:100%;padding:16px 20px;border-radius:15px;background:#242d29;color:white;font-size:15px;font-weight:640;letter-spacing:-.015em}.primary:active{transform:scale(.99)}\n.buttons{display:flex;gap:12px;margin-top:12px}.secondary{flex:1;background:#f0f3ef;border-radius:13px;color:#2b3b32;padding:13px;font-size:13px;font-weight:600}\n.end{background:#a34141;color:#fff}\n.hidden{display:none!important}.message{margin-top:18px;font-size:13px;line-height:1.45;min-height:19px;color:#55645d;white-space:pre-wrap}\n.transcript{border-top:1px solid #edf0ed;text-align:left;margin-top:24px;padding-top:14px;max-height:160px;overflow-y:auto;font-size:13px;color:#47554e;line-height:1.6;white-space:pre-wrap}\n.smallprint{font-size:11px;color:#9ba59f;line-height:1.55;max-width:320px;margin:21px auto 0}.smallprint a{color:#596d62;text-decoration:underline}\n@media(max-width:360px){h1{font-size:29px}.panel{padding:29px 20px}}\n</style>\n</head>\n<body>\n<div class=\"frame\">\n  <div class=\"brand\"><div class=\"brand-icon\">S</div> SANDY AI</div>\n  <main class=\"panel\">\n    <div class=\"avatar\" id=\"avatar\" aria-hidden=\"true\"><i>S.</i></div>\n    <h1>Talk to Sandy</h1>\n    <p>A quick voice conversation, whenever you need an extra pair of hands.</p>\n    <div class=\"status\"><span class=\"dot\" id=\"statusdot\"></span><span id=\"status\">Checking private link…</span></div>\n    <button class=\"primary\" id=\"start\" disabled>Start voice call</button>\n    <div class=\"buttons hidden\" id=\"controls\">\n      <button class=\"secondary\" id=\"mute\">Mute microphone</button>\n      <button class=\"secondary end\" id=\"hangup\">End call</button>\n    </div>\n    <div class=\"message\" id=\"message\" role=\"status\" aria-live=\"polite\"></div>\n    <div class=\"transcript hidden\" id=\"transcript\" aria-label=\"Live transcript\"></div>\n    <audio autoplay playsinline id=\"remote\" aria-label=\"Sandy's voice\"></audio>\n  </main>\n  <p class=\"smallprint\">Private invitation · Microphone access is requested only when you start. Voice is processed by OpenAI. Never share a private call link with someone you do not trust.</p>\n</div>\n<script nonce=\"SANDY_NONCE\">\n(function(){\n 'use strict';\n const el=id=>document.getElementById(id);\n const status=el('status'),msg=el('message'),btn=el('start'),controls=el('controls'),audio=el('remote'),avatar=el('avatar'),dot=el('statusdot'),transcript=el('transcript');\n let token=(new URLSearchParams(location.hash.replace(/^#/,''))).get('key')||'';\n let pc=null,dc=null,mic=null,active=false,muted=false,endTimer=null,connectedSession=null,callStarting=false;\n const api=location.origin+location.pathname.replace(/\\/+$/,'');\n function setStatus(t){status.textContent=t}\n function note(t){msg.textContent=t}\n function showTranscript(t){if(!t)return;transcript.classList.remove('hidden');transcript.textContent=(transcript.textContent+t).slice(-3500);transcript.scrollTop=transcript.scrollHeight}\n async function req(path,payload){const r=await fetch(api+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});const data=await r.json().catch(()=>({error:'Unexpected server response'}));if(!r.ok)throw Error(data.error||'Request failed');return data}\n async function valid(){if(!/^[a-f0-9]{64}$/.test(token)){setStatus('Invalid call link');note('Ask Sandy for a new private call link.');return}\n   try{const r=await req('/validate',{token});if(!r.ok)throw Error('Link unavailable');setStatus('Ready to call');btn.disabled=false;note('')}\n   catch(e){setStatus('Link unavailable');note('This link has expired or been revoked. Ask Sandy for a fresh one.')}\n }\n async function report(state,extra){if(!connectedSession)return;try{await req('/event',{token,session_id:connectedSession,state,error_code:extra||null})}catch(e){}}\n function cleanup(){if(endTimer)clearTimeout(endTimer);endTimer=null;active=false;callStarting=false;if(dc){try{dc.close()}catch(e){}dc=null}if(pc){try{pc.close()}catch(e){}pc=null}if(mic){mic.getTracks().forEach(t=>t.stop());mic=null}audio.srcObject=null;controls.classList.add('hidden');btn.classList.remove('hidden');btn.disabled=false;btn.textContent='Call again';avatar.classList.remove('live');dot.classList.remove('on')}\n async function hangup(){if(!active&&!callStarting)return;if(dc&&dc.readyState==='open'){try{dc.send(JSON.stringify({type:'response.cancel'}))}catch(e){}}await report('ended');cleanup();setStatus('Call ended');note('Tap Call again whenever you like.')}\n btn.addEventListener('click',async()=>{\n  if(active||callStarting)return;\n  callStarting=true;btn.disabled=true;btn.textContent='Connecting…';note('');\n  let success=false;\n  try{\n   if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.RTCPeerConnection)throw Error('Open this link in Chrome or Safari to use voice calling.');\n   mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});\n   pc=new RTCPeerConnection();\n   mic.getTracks().forEach(t=>pc.addTrack(t,mic));\n   pc.ontrack=e=>{audio.srcObject=e.streams[0];audio.play().catch(()=>note('If you cannot hear Sandy, tap your phone’s audio/play control.'))};\n   pc.onconnectionstatechange=()=>{if(!pc)return;if(pc.connectionState==='connected'){active=true;setStatus('Connected · Talk naturally');dot.classList.add('on');avatar.classList.add('live');note('');report('connected')}else if(['failed','disconnected'].includes(pc.connectionState)){if(active){setStatus('Disconnected');note('Connection lost. Tap Call again.');report('ended');cleanup()}}};\n   dc=pc.createDataChannel('oai-events');\n   dc.onmessage=e=>{try{const event=JSON.parse(e.data);if(event.type==='error')note(event.error?.message||'Voice session error');else if(event.type==='response.audio_transcript.delta')showTranscript(event.delta||'');else if(event.type==='response.audio_transcript.done')showTranscript('\\n');else if(event.type==='conversation.item.input_audio_transcription.completed')showTranscript('\\nYou: '+event.transcript+'\\n');else if(event.type==='response.created')setStatus('Sandy is speaking…');else if(event.type==='response.done'&&active)setStatus('Connected · Talk naturally')}catch(_e){}};\n   dc.onopen=()=>{setStatus('Connected · Talk naturally');active=true;avatar.classList.add('live');dot.classList.add('on');note('Say hello to Sandy.')};\n   const offer=await pc.createOffer();await pc.setLocalDescription(offer);\n   if(pc.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Microphone network setup timed out.')),12000);pc.addEventListener('icegatheringstatechange',function on(){if(pc.iceGatheringState==='complete'){clearTimeout(timeout);pc.removeEventListener('icegatheringstatechange',on);resolve()}},{})});\n   const sdp=pc.localDescription?.sdp;if(!sdp)throw Error('Could not create a browser audio session.');\n   const session=await req('/session',{token,sdp});connectedSession=session.session_id;\n   await pc.setRemoteDescription({type:'answer',sdp:session.sdp});\n   btn.classList.add('hidden');controls.classList.remove('hidden');active=true;callStarting=false;endTimer=setTimeout(()=>{hangup()},25*60*1000);\n   setStatus('Connecting audio…');\n  }catch(e){setStatus('Could not connect');note(e?.message||'Please try again.');await report('failed','browser_connection');cleanup()}\n });\n el('mute').addEventListener('click',()=>{if(!mic)return;muted=!muted;mic.getAudioTracks().forEach(t=>t.enabled=!muted);el('mute').textContent=muted?'Unmute microphone':'Mute microphone'});\n el('hangup').addEventListener('click',hangup);\n window.addEventListener('pagehide',()=>{if(mic)mic.getTracks().forEach(t=>t.stop());if(pc)pc.close()});\n valid();\n})();\n</script>\n</body>\n</html>";
const enc=new TextEncoder();
const ROOT="https://api.openai.com/v1";
const VOICE_WEB_ORIGIN="https://35-241-239-80.sslip.io";
const cors={"access-control-allow-origin":VOICE_WEB_ORIGIN,"access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type","vary":"origin"};
const headers={...cors,"cache-control":"no-store, private","referrer-policy":"no-referrer","x-content-type-options":"nosniff","x-frame-options":"DENY","permissions-policy":"microphone=(self), camera=()"};
const json=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:{...headers,"content-type":"application/json; charset=utf-8"}});
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(value)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const uuid=(x:any)=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
Deno.serve(async(request:Request)=>{
 const url=new URL(request.url);
 if(url.pathname.endsWith("/context/session")||url.pathname.endsWith("/context/retire"))return handleVoiceContextSession(request,{base:Deno.env.get("SUPABASE_URL")||"",anonKey:Deno.env.get("SUPABASE_ANON_KEY")||"",createClient});
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{...headers}});
 if(url.pathname.endsWith("/health"))return json({ok:true,service:"sandy-voice-call",version:1,voice_api:"webrtc"});
 if(request.method==="GET"||request.method==="HEAD"){
  if(url.pathname.endsWith("/session")||url.pathname.endsWith("/event")||url.pathname.endsWith("/validate"))return json({error:"method_not_allowed"},405);
  const nonce=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const html=HTML.replaceAll("SANDY_NONCE",nonce);
  const htmlHeaders={...headers,"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none';"};
  return new Response(request.method==="HEAD"?null:html,{headers:htmlHeaders,status:200});
 }
 if(request.method!=="POST")return json({error:"method_not_allowed"},405);
 if(!["/session","/event","/validate","/diagnostics","/transcript","/tool","/auth/request","/auth/verify","/task/approve","/task/reject","/task/status"].some(p=>url.pathname.endsWith(p)))return json({error:"not_found"},404);
 const origin=request.headers.get("origin");
 if(origin&&origin!==url.origin&&origin!==VOICE_WEB_ORIGIN)return json({error:"invalid_origin"},403);
 if(Number(request.headers.get("content-length")||"0")>40000)return json({error:"request_too_large"},413);
 let body:any;try{body=await request.json()}catch{return json({error:"invalid_json"},400)}
 const token=String(body?.token||"");
 if(!/^[0-9a-f]{64}$/.test(token))return json({error:"Invalid or expired call link"},403);
 const urlDb=Deno.env.get("SUPABASE_URL")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",apiKey=Deno.env.get("OPENAI_API_KEY")||"";
 if(!urlDb||!service||!apiKey)return json({error:"Voice service temporarily unavailable"},503);
 const db=createClient(urlDb,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const hash=await digest(token);
 const {data:link,error:linkErr}=await db.from("sandy_voice_call_links").select("id,owner_customer_id,starts,max_starts,expires_at,revoked_at,trusted_memory,purpose").eq("token_sha256",hash).gt("expires_at",new Date().toISOString()).is("revoked_at",null).maybeSingle();
 if(linkErr)return json({error:"Voice link verification temporarily unavailable"},503);
 if(!link)return json({error:"Invalid or expired call link"},403);
 if(link.purpose==="context_only")return json({error:"context_only_session_cannot_access_voice_or_provider_operations"},403);
 if(url.pathname.endsWith("/validate"))return json({ok:true,remaining:Math.max(0,link.max_starts-link.starts),expires_at:link.expires_at,private_access:link.trusted_memory===true?"verified":"verification_required"});
 if(url.pathname.endsWith("/diagnostics")){
  try{
   const r=await fetch(ROOT+"/models/gpt-realtime-2.1",{headers:{authorization:"Bearer "+apiKey},signal:AbortSignal.timeout(12000)});
   return json({ok:r.ok,model_available:r.ok,http:r.status},r.ok?200:502)
  }catch{return json({error:"provider_unreachable"},503)}
 }
 if(url.pathname.endsWith("/auth/request")||url.pathname.endsWith("/auth/verify")){
  const sid=String(body.session_id||"");
  if(!uuid(sid))return json({error:"invalid_session"},400);
  const {data:session,error:sessionError}=await db.from("sandy_voice_call_sessions").select("id,created_at,owner_customer_id").eq("id",sid).eq("owner_customer_id",link.owner_customer_id).eq("link_id",link.id).maybeSingle();
  if(sessionError||!session||Date.now()-Date.parse(session.created_at)>35*60000)return json({error:"invalid_session"},403);
  const {data:challenge,error:challengeError}=await db.from("sandy_voice_private_auth").select("*").eq("session_id",sid).maybeSingle();
  if(challengeError)return json({error:"authentication_unavailable"},503);
  if(url.pathname.endsWith("/auth/request")){
   if(challenge?.verified_at)return json({ok:true,verified:true});
   if(challenge?.sent_count>=3)return json({error:"too_many_codes"},429);
   if(challenge?.last_sent_at&&Date.now()-Date.parse(challenge.last_sent_at)<60000)return json({error:"please_wait_before_requesting_another_code"},429);
   const {data:emails,error:emailErr}=await db.from("email_customer_addresses").select("email_address,verified_at,is_primary").eq("customer_id",link.owner_customer_id).not("verified_at","is",null).order("is_primary",{ascending:false}).limit(1);
   if(emailErr||!emails?.[0]?.email_address)return json({error:"no_verified_email_for_private_access"},403);
   const address=String(emails[0].email_address);
   const tenant=Deno.env.get("MS_GRAPH_TENANT_ID")||"",client=Deno.env.get("MS_GRAPH_CLIENT_ID")||"",clientSecret=Deno.env.get("MS_GRAPH_CLIENT_SECRET")||"";
   if(!tenant||!client||!clientSecret)return json({error:"email_verification_unavailable"},503);
   const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);
   const code=String(100000+bytes[0]%900000),hashCode=await digest(sid+":"+code+":"+token);
   try{
    const params=new URLSearchParams({client_id:client,client_secret:clientSecret,scope:"https://graph.microsoft.com/.default",grant_type:"client_credentials"});
    const authResp=await fetch("https://login.microsoftonline.com/"+encodeURIComponent(tenant)+"/oauth2/v2.0/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:params,signal:AbortSignal.timeout(11000)});
    if(!authResp.ok)return json({error:"email_verification_unavailable"},503);
    const access=String((await authResp.json()).access_token||"");
    const sendMail=await fetch("https://graph.microsoft.com/v1.0/users/ai%40email.com.au/sendMail",{method:"POST",headers:{"authorization":"Bearer "+access,"content-type":"application/json"},body:JSON.stringify({message:{subject:"Your Sandy voice verification code",body:{contentType:"Text",content:"Your Sandy AI private voice access code is "+code+". It expires in 10 minutes. Do not share it with anyone."},toRecipients:[{emailAddress:{address}}]},saveToSentItems:true}),signal:AbortSignal.timeout(13000)});
    if(!sendMail.ok){console.error("voice_auth_mail_failed",sendMail.status);return json({error:"email_verification_unavailable"},503)}
    const update={session_id:sid,owner_customer_id:link.owner_customer_id,code_hash:hashCode,attempts:0,sent_count:(challenge?.sent_count||0)+1,last_sent_at:new Date().toISOString(),expires_at:new Date(Date.now()+10*60000).toISOString(),verified_at:null};
    const {error:saveError}=await db.from("sandy_voice_private_auth").upsert(update,{onConflict:"session_id"});
    if(saveError){console.error("voice_auth_storage_failed",saveError.code);return json({error:"verification_code_cannot_be_used"},503)}
    return json({ok:true,delivery:"verified_email",expires_in_seconds:600});
   }catch{return json({error:"email_verification_unavailable"},503)}
  }
  if(!challenge||challenge.verified_at)return json({ok:!!challenge?.verified_at,verified:!!challenge?.verified_at},challenge?.verified_at?200:403);
  if(challenge.attempts>=6||Date.parse(challenge.expires_at)<Date.now())return json({error:"code_expired_or_locked"},403);
  const supplied=String(body.code||"").trim();
  if(!/^[0-9]{6}$/.test(supplied))return json({error:"invalid_code"},400);
  const actual=await digest(sid+":"+supplied+":"+token);
  if(actual!==challenge.code_hash){
    await db.from("sandy_voice_private_auth").update({attempts:challenge.attempts+1}).eq("session_id",sid);
    return json({error:"incorrect_code"},403);
  }
  const {error:verifiedErr}=await db.from("sandy_voice_private_auth").update({verified_at:new Date().toISOString()}).eq("session_id",sid).is("verified_at",null);
  return verifiedErr?json({error:"verification_failed"},503):json({ok:true,verified:true});
 }
 if(url.pathname.endsWith("/transcript")){
  const sid=String(body.session_id||"");
  if(!uuid(sid)||!Array.isArray(body.turns)||body.turns.length>20)return json({error:"invalid_transcript_batch"},400);
  const {data:session,error:e}=await db.from("sandy_voice_call_sessions").select("id,owner_customer_id,created_at,state").eq("id",sid).eq("link_id",link.id).eq("owner_customer_id",link.owner_customer_id).maybeSingle();
  if(e||!session)return json({error:"invalid_call_session"},403);
  if(Date.now()-Date.parse(session.created_at)>40*60000)return json({error:"call_session_too_old"},403);
  const turns:any[]=[];
  for(const raw of body.turns){
   const key=String(raw?.event_key||"");
   const text=String(raw?.text||"").trim();
   const role=String(raw?.role||"");
   if(!/^[A-Za-z0-9_.:-]{3,140}$/.test(key)||!["user","assistant"].includes(role)||!text||text.length>10000)return json({error:"invalid_transcript_turn"},400);
   turns.push({session_id:sid,owner_customer_id:link.owner_customer_id,event_key:key,role,text});
  }
  if(!turns.length)return json({ok:true,inserted:0});
  const {error:saveError}=await db.from("sandy_voice_transcript_turns").upsert(turns,{onConflict:"session_id,event_key",ignoreDuplicates:true});
  return saveError?json({error:"transcript_storage_failed"},503):json({ok:true,accepted:turns.length});
 }
 if(url.pathname.endsWith("/task/status")){
  const sid=String(body.session_id||""),taskId=String(body.task_id||"");
  if(!uuid(sid)||!uuid(taskId))return json({error:"invalid_task"},400);
  const {data:session}=await db.from("sandy_voice_call_sessions").select("id,created_at").eq("id",sid).eq("link_id",link.id).eq("owner_customer_id",link.owner_customer_id).maybeSingle();
  if(!session||Date.now()-Date.parse(session.created_at)>35*60000)return json({error:"invalid_session"},403);
  const {data:authorization}=await db.from("sandy_voice_private_auth").select("verified_at").eq("session_id",sid).eq("owner_customer_id",link.owner_customer_id).maybeSingle();
  if(!authorization?.verified_at)return json({error:"private_verification_required"},403);
  const {data:task,error:te}=await db.from("sandy_shared_task_requests").select("id,status,result,error_code,dispatched_task_id").eq("id",taskId).eq("source_session_id",sid).eq("customer_id",link.owner_customer_id).maybeSingle();
  if(te||!task)return json({error:"task_not_found"},404);
  if(task.dispatched_task_id){
    const {data:worker}=await db.from("sandy_windows_ai_tasks").select("status,outcome,error_text").eq("id",task.dispatched_task_id).maybeSingle();
    if(worker?.status==="completed"||worker?.status==="failed"){
      const summary=String(worker.outcome?.summary||"");
      const actualStatus=worker.status==="completed"&&/unable to complete|could not complete|no authorized file-creation/i.test(summary)?"failed":worker.status;
      await db.from("sandy_shared_task_requests").update({status:actualStatus,result:worker.outcome||null,error_code:actualStatus==="failed"?(worker.error_text||"execution_not_verified").slice(0,120):null,updated_at:new Date().toISOString()}).eq("id",taskId).eq("status","queued");
      return json({ok:true,status:actualStatus,note:summary.slice(0,600)});
    }
    return json({ok:true,status:worker?.status||task.status});
  }
  const file=task.result?.file;
  if(task.status==="completed"&&file?.verified===true&&file?.bucket==="sandy-task-artifacts"&&typeof file.path==="string"&&file.path.startsWith(link.owner_customer_id+"/"+taskId+"/")){
    const {data:download,error:de}=await db.storage.from("sandy-task-artifacts").createSignedUrl(file.path,180);
    if(de||!download?.signedUrl)return json({error:"download_unavailable"},503);
    return json({ok:true,status:"completed",filename:String(file.filename||"Sandy-file"),download_url:download.signedUrl,expires_in_seconds:180});
  }
  return json({ok:true,status:task.status,error:task.error_code||null});
 }
 if(url.pathname.endsWith("/task/approve")||url.pathname.endsWith("/task/reject")){
  const sid=String(body.session_id||""),taskId=String(body.task_id||"");
  if(!uuid(sid)||!uuid(taskId))return json({error:"invalid_task"},400);
  const {data:session}=await db.from("sandy_voice_call_sessions").select("id,created_at").eq("id",sid).eq("link_id",link.id).eq("owner_customer_id",link.owner_customer_id).maybeSingle();
  if(!session||Date.now()-Date.parse(session.created_at)>35*60000)return json({error:"invalid_session"},403);
  const {data:privateAuth}=await db.from("sandy_voice_private_auth").select("verified_at").eq("session_id",sid).eq("owner_customer_id",link.owner_customer_id).maybeSingle();
  if(!privateAuth?.verified_at)return json({error:"unlock_private_access_first"},403);
  const {data:task,error:taskErr}=await db.from("sandy_shared_task_requests").select("*").eq("id",taskId).eq("source_session_id",sid).eq("customer_id",link.owner_customer_id).maybeSingle();
  if(taskErr||!task)return json({error:"task_not_found"},404);
  if(task.status!=="awaiting_approval")return json({ok:true,status:task.status,duplicate:true});
  if(url.pathname.endsWith("/task/reject")){
    const {error:e}=await db.from("sandy_shared_task_requests").update({status:"rejected",updated_at:new Date().toISOString()}).eq("id",taskId).eq("status","awaiting_approval");
    return e?json({error:"rejection_failed"},503):json({ok:true,status:"rejected"});
  }
  // Approval is explicit browser interaction, never a Realtime model tool call.
  const {data:approved,error:approveErr}=await db.from("sandy_shared_task_requests").update({status:"approved",approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",taskId).eq("status","awaiting_approval").select("*").maybeSingle();
  if(approveErr||!approved)return json({error:"task_approval_failed"},503);
  // The existing Windows worker can run a subset of supervised, non-account-changing work.
  // Sensitive account mutations and outbound communications remain approved-only until a scoped executor exists.
  if(["spreadsheet","document"].includes(task.task_category)){
    const execution=fetch(urlDb+"/functions/v1/sandy-shared-artifact-worker",{
      method:"POST",headers:{"authorization":"Bearer "+service,"content-type":"application/json"},
      body:JSON.stringify({task_id:taskId}),signal:AbortSignal.timeout(70000)
    }).then(async r=>{if(!r.ok)console.error("voice_artifact_execution",r.status)}).catch(e=>console.error("voice_artifact_execution_failed",String(e).slice(0,140)));
    EdgeRuntime.waitUntil(execution);
    return json({ok:true,status:"approved",task_id:taskId,executor:"sandy_shared_artifact_worker",note:"Approved. Sandy is generating the file. Check task status to confirm it was actually saved."});
  }
  const canQueue=["spreadsheet","document","research","finance","file_analysis","programming","calculation","legal","business","property","translation","brainstorm","writing","project_management"].includes(task.task_category);
  if(!canQueue)return json({ok:true,status:"approved",note:"Request approved. This category needs a connected executor; no action has been performed."});
  const idem="voice-shared:"+task.id;
  const instruction="Sandy voice task from a verified customer. Category: "+task.task_category+". Customer request: "+task.instruction+". Use available connected APIs first rather than GUI. Never send external messages, purchase, delete, publish, change account/security settings or perform destructive actions. Work only within authorized files or public research. If access or permissions are missing, stop and report the limitation. Verify any output before reporting completion.";
  const {data:queued,error:queueError}=await db.from("sandy_windows_ai_tasks").upsert({idempotency_key:idem,instruction:instruction.slice(0,2000),max_steps:8,cleanup_policy:"automatic",allow_download:false,allow_file_organize:false},{onConflict:"idempotency_key",ignoreDuplicates:true}).select("id").maybeSingle();
  if(queueError){await db.from("sandy_shared_task_requests").update({error_code:"windows_task_queue_failed"}).eq("id",taskId);return json({ok:true,status:"approved",note:"Approval saved, but execution could not be queued.",error:"execution_queue_failed"})}
  const {data:found}=queued?.id?{data:queued}:await db.from("sandy_windows_ai_tasks").select("id").eq("idempotency_key",idem).maybeSingle();
  if(!found?.id)return json({ok:true,status:"approved",note:"Task status could not be verified. No completion claimed."});
  await db.from("sandy_shared_task_requests").update({status:"queued",dispatched_task_id:found.id,updated_at:new Date().toISOString()}).eq("id",taskId);
  return json({ok:true,status:"queued",task_id:taskId,executor:"sandy_windows_ai",note:"Queued for computer execution. This does not mean the task is completed."});
 }
 if(url.pathname.endsWith("/tool")){
  const sid=String(body.session_id||"");
  const {data:session,error:se}=await db.from("sandy_voice_call_sessions").select("id,created_at").eq("id",sid).eq("link_id",link.id).eq("owner_customer_id",link.owner_customer_id).maybeSingle();
  if(se||!session||Date.now()-Date.parse(session.created_at)>35*60000)return json({error:"invalid_call_session"},403);
  const name=String(body.name||""),query=String(body.arguments?.query||"").trim().slice(0,300);
  if(["search_sandy_memory","search_sandy_email"].includes(name)){
   const {data:auth,error:authError}=await db.from("sandy_voice_private_auth").select("verified_at").eq("session_id",sid).eq("owner_customer_id",link.owner_customer_id).maybeSingle();
   if(authError||!auth?.verified_at)return json({ok:true,result:"Private records are locked for this call link. Please open a fresh voice link requested from your verified WhatsApp account, or complete email verification."});
   if(query.length<3)return json({error:"query_too_short"},400);
   const normalized=query.toLowerCase().replace(/[%_,()*]/g," ").replace(/\s+/g," ").trim().slice(0,80);
   if(name==="search_sandy_memory"){
    const [facts,memories,matters]=await Promise.all([
      db.from("email_ai_profile_facts").select("category,fact_key,fact_value").eq("customer_id",link.owner_customer_id).eq("status","active").limit(300),
      db.from("email_ai_operational_memories").select("memory_key,category,instruction").eq("customer_id",link.owner_customer_id).eq("status","active").limit(100),
      db.from("email_ai_active_matters").select("title,summary,status").eq("customer_id",link.owner_customer_id).order("updated_at",{ascending:false}).limit(40)
    ]);
    if(facts.error||memories.error||matters.error)return json({error:"memory_lookup_unavailable"},503);
    const overview=/^(?:what do you know|about me|my profile|everything|overview|summary|my memory|my memories|who am i|general|all)$/i.test(normalized)||/what do you know about me|tell me about myself|summari[sz]e my (?:profile|memory)/i.test(normalized); const terms=normalized.replace(/\b(do|does|did|i|you|my|me|the|a|an|like|likes|know|remember|that|whether|am|is|are|have|any|about)\b/g," ").trim().split(/\s+/).filter(x=>x.length>2); const matches=(items:any[])=>items.filter((x:any)=>overview||JSON.stringify(x).toLowerCase().includes(normalized)||terms.some(term=>JSON.stringify(x).toLowerCase().includes(term))).slice(0,overview?14:8);
    let archiveEvidence:any[]=[];
     try{
      const searchTerm=overview?"":terms.find((w:string)=>w.length>=4)||"";
      const {data:archiveHits,error:archiveError}=await db.rpc("sandy_memory_search",{p_customer_id:link.owner_customer_id,p_query:searchTerm,p_limit:8});
      if(archiveError)console.warn("voice_unified_memory_error",archiveError.code);
      else archiveEvidence=(archiveHits||[]).slice(0,8).map((x:any)=>({channel:x.channel,role:x.source_role,at:x.occurred_at,source_id:x.id,excerpt:String(x.content||"").slice(0,430)}));
     }catch(e){console.warn("voice_memory_archive_unavailable",String(e).slice(0,100))}
     return json({ok:true,result:JSON.stringify({facts:matches(facts.data||[]),standing_instructions:matches(memories.data||[]),active_matters:matches(matters.data||[]),cross_channel_history:archiveEvidence}).slice(0,6200)});
   }
   const {data:mail,error:mailError}=await db.from("email_messages").select("subject,sender_address,received_at,body_text").eq("customer_id",link.owner_customer_id).or("subject.ilike.%"+normalized+"%,body_text.ilike.%"+normalized+"%").order("created_at",{ascending:false}).limit(5);
   if(mailError)return json({error:"email_history_lookup_unavailable"},503);
   return json({ok:true,result:JSON.stringify((mail||[]).map((m:any)=>({subject:m.subject,from:m.sender_address,received:m.received_at,excerpt:String(m.body_text||"").slice(0,600)}))).slice(0,3500)});
  }

  if(name==="remember_fact"){
    const {data:auth,error:authError}=await db.from("sandy_voice_private_auth").select("verified_at").eq("session_id",sid).eq("owner_customer_id",link.owner_customer_id).maybeSingle();
    if(authError||!auth?.verified_at)return json({ok:true,result:"Memory not saved: private access has not been verified."});
    const key=String(body.arguments?.fact_key||"").trim().toLowerCase();
    const value=String(body.arguments?.fact_value||"").trim();
    const evidence=String(body.arguments?.user_statement||"").trim();
    if(!/^[a-z][a-z0-9_]{3,79}$/.test(key)||value.length<3||value.length>400||evidence.length<3||evidence.length>600)
      return json({ok:true,result:"Memory not saved: please say the fact clearly."});
    if(/\b(?:password|passcode|one.time.code|credit.card|passport.number|bank.account|secret.key|access.token|medical|diagnos|sexual|criminal)\b/i.test(key+" "+value))
      return json({ok:true,result:"Memory not saved automatically because this may be sensitive information."});
    const {data:result,error:saveErr}=await db.rpc("sandy_voice_save_explicit_memory",{p_customer_id:link.owner_customer_id,p_fact_key:key,p_fact_value:value});
    if(saveErr){console.error("voice_memory_save_failed",saveErr.code);return json({ok:true,result:"I could not save that memory right now. Please try again."});}
    return json({ok:true,result:result==="already_saved"?"Confirmed: I already have that saved in your memory.":"Confirmed: I have "+(result==="updated"?"updated":"saved")+" that in your memory."});
  }
  if(name==="calculate"){
   const expr=String(body.arguments?.expression||"").trim().slice(0,200);
   if(!/^[0-9+\-*/^().,%\s]+$/.test(expr)||!expr)return json({error:"invalid_expression"},400);
   let i=0;const v=expr.replace(/\s/g,"");
   const atom=():number=>{if(v[i]==="-"){i++;return -atom()}if(v[i]==="+"){i++;return atom()}if(v[i]==="("){i++;const n=sum();if(v[i++]!==")")throw Error("parenthesis");return n}
     const m=v.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);if(!m)throw Error("number");i+=m[0].length;let n=Number(m[0]);if(v[i]==="%"){i++;n/=100}return n};
   const power=():number=>{let n=atom();if(v[i]==="^"){i++;n=Math.pow(n,power())}return n};
   const product=():number=>{let n=power();while(v[i]==="*"||v[i]==="/"){const op=v[i++],b=power();n=op==="*"?n*b:n/b}return n};
   const sum=():number=>{let n=product();while(v[i]==="+"||v[i]==="-"){const op=v[i++],b=product();n=op==="+"?n+b:n-b}return n};
   try{const value=sum();if(i!==v.length||!Number.isFinite(value)||Math.abs(value)>1e100)throw Error("invalid");return json({ok:true,result:String(value),expression:expr})}
   catch{return json({error:"invalid_expression"},400)}
  }
  if(name==="request_task"){
    const sid=String(body.session_id||"");
    const {data:privateAuth}=await db.from("sandy_voice_private_auth").select("verified_at").eq("session_id",sid).eq("owner_customer_id",link.owner_customer_id).maybeSingle();
    if(!privateAuth?.verified_at)return json({ok:true,result:"Please open a fresh trusted voice link from your verified WhatsApp or complete email verification before registering a task."});
    const category=String(body.arguments?.category||"");
    const instruction=String(body.arguments?.instruction||"").trim().slice(0,1800);
    const eventKey="call_"+(await digest(sid+":"+category+":"+instruction)).slice(0,48);
    if(!["spreadsheet","document","research","finance","email","calendar","reminder","file_analysis","programming","database","calculation","legal","business","property","image","translation","brainstorm","connected_services","writing","project_management"].includes(category)||instruction.length<3||!/^call_[A-Za-z0-9_-]{4,120}$/.test(eventKey))return json({error:"invalid_task_request"},400);
    const {data:existing}=await db.from("sandy_shared_task_requests").select("id,status").eq("source_session_id",sid).eq("source_event_key",eventKey).maybeSingle();
    if(existing)return json({ok:true,result:"Task already registered. Status: "+existing.status+". Task ID: "+existing.id,task_id:existing.id,approval_required:existing.status==="awaiting_approval"});
    const {data:task,error:te}=await db.from("sandy_shared_task_requests").insert({customer_id:link.owner_customer_id,source_channel:"voice",source_session_id:sid,source_event_key:eventKey,task_category:category,instruction,status:"awaiting_approval",approval_required:true}).select("id").single();
    if(te||!task)return json({error:"task_registration_failed"},503);
    return json({ok:true,result:"Task proposed, but not yet executed. Please ask the caller to press Approve task on their call screen. Task ID: "+task.id,task_id:task.id,approval_required:true,category,instruction});
  }
  if(name==="task_status"){
    const taskId=String(body.arguments?.task_id||"");
    if(!uuid(taskId))return json({error:"invalid_task"},400);
    const {data:auth}=await db.from("sandy_voice_private_auth").select("verified_at").eq("session_id",sid).eq("owner_customer_id",link.owner_customer_id).maybeSingle();
    if(!auth?.verified_at)return json({error:"private_verification_required"},403);
    const {data:task}=await db.from("sandy_shared_task_requests").select("id,status,task_category,dispatched_task_id,result,error_code").eq("id",taskId).eq("customer_id",link.owner_customer_id).maybeSingle();
    if(!task)return json({error:"task_not_found"},404);
    if(task.dispatched_task_id){
      const {data:worker}=await db.from("sandy_windows_ai_tasks").select("status,outcome,error_text").eq("id",task.dispatched_task_id).maybeSingle();
      if(worker?.status==="completed"||worker?.status==="failed"){
        await db.from("sandy_shared_task_requests").update({status:worker.status,result:worker.outcome||null,error_code:worker.error_text?String(worker.error_text).slice(0,160):null,updated_at:new Date().toISOString()}).eq("id",taskId).eq("status","queued");
      }
      return json({ok:true,result:JSON.stringify({task_id:taskId,status:worker?.status||task.status,outcome:worker?.outcome||null,error:worker?.error_text||null}).slice(0,3000)});
    }
    return json({ok:true,result:JSON.stringify({task_id:taskId,status:task.status,file:task.result?.file||null,error:task.error_code||null}).slice(0,3000)});
  }
  if(name==="search_web"&&query.length>=3){
    try{
     const r=await fetch(ROOT+"/responses",{method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5.4-mini",store:false,tools:[{type:"web_search"}],input:"Look up and briefly answer this public web query, citing original links if possible: "+query,max_output_tokens:700}),signal:AbortSignal.timeout(35000)});
     const val=await r.json().catch(()=>({}));
     if(!r.ok)return json({error:"research_temporarily_unavailable"},502);
     const output=(val.output||[]).flatMap((x:any)=>x.content||[]).filter((x:any)=>x.type==="output_text").map((x:any)=>String(x.text||"")).join("\n").slice(0,3800);
     return json({ok:true,result:output||"No verified web results found."});
    }catch{return json({error:"research_timeout"},503);}
  }
  return json({error:"tool_not_authorized"},403);
 }
 if(url.pathname.endsWith("/event")){
  const sessionId=body?.session_id,state=body?.state;
  if(!uuid(sessionId)||!["connected","ended","failed"].includes(state))return json({error:"invalid_event"},400);
  const fields:any={};
  if(state==="connected"){fields.state="connected";fields.connected_at=new Date().toISOString()}
  else {fields.state=state;fields.ended_at=new Date().toISOString();if(state==="failed")fields.error_code=String(body.error_code||"client_failure").slice(0,80)}
  const {error}=await db.from("sandy_voice_call_sessions").update(fields).eq("id",sessionId).eq("link_id",link.id).eq("owner_customer_id",link.owner_customer_id);
  if(error)return json({error:"event_failed"},503);
  if(state==="ended"){
    const endpoint=urlDb+"/functions/v1/sandy-voice-memory-review";
    const promise=fetch(endpoint,{method:"POST",headers:{"Authorization":"Bearer "+service,"Content-Type":"application/json"},body:JSON.stringify({session_id:sessionId}),signal:AbortSignal.timeout(55000)}).then(async response=>{if(!response.ok)console.error("voice_memory_review_http",response.status)}).catch(e=>console.error("voice_memory_review_trigger",String(e).slice(0,130)));
    EdgeRuntime.waitUntil(promise);
  }
  return json({ok:true});
 }
 const sdp=typeof body?.sdp==="string"?body.sdp:"";
 if(sdp.length<60||sdp.length>30000||!sdp.startsWith("v=0")||!sdp.includes("m=audio"))return json({error:"Invalid browser audio offer"},400);
 const {data:claims,error:claimErr}=await db.rpc("sandy_voice_claim_call",{p_token_hash:hash});
 if(claimErr)return json({error:"Could not authorize this call"},503);
 if(!claims?.length)return json({error:"Call link rate limit reached, expired or already used. Please try again shortly."},429);
 const sessionId=claims[0].session_id;
 // Account-scoped, 15-minute, single-start WhatsApp links carry private memory authority.
 // Other call links continue to require verification.
 if(link.trusted_memory===true){
  const {error:grantError}=await db.from("sandy_voice_private_auth").upsert({
    session_id:sessionId,owner_customer_id:link.owner_customer_id,
    code_hash:"trusted_link:"+link.id,attempts:0,sent_count:0,
    last_sent_at:new Date().toISOString(),
    expires_at:new Date(Date.now()+35*60000).toISOString(),
    verified_at:new Date().toISOString()
  },{onConflict:"session_id"});
  if(grantError){
   await db.from("sandy_voice_call_sessions").update({state:"failed",error_code:"trusted_memory_grant_failed",ended_at:new Date().toISOString()}).eq("id",sessionId);
   return json({error:"Private call authorization unavailable. Request a fresh link."},503);
  }
 }

 const {data:customerProfile}=await db.from("email_customers").select("display_name").eq("id",link.owner_customer_id).maybeSingle();
 const firstName=String(customerProfile?.display_name||"").trim().split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu,"").slice(0,40);
 const customerContext=link.trusted_memory===true?"The account holder has a verified customer profile.":"";
 const sessionConfig={type:"realtime",model:"gpt-realtime-2.1",
   tools:[
    {type:"function",name:"calculate",description:"Calculate arithmetic using a verified deterministic calculator. Supports + - * / ^ parentheses and percentages.",parameters:{type:"object",properties:{expression:{type:"string"}},required:["expression"]}},
    {type:"function",name:"request_task",description:"Register an approved-by-user task proposal for spreadsheets, documents, email, calendar, reminders, files, programming, images and other work. Only use for an explicit user request to carry out work. Task execution still needs separate browser approval. Never claim execution at proposal time.",parameters:{type:"object",properties:{category:{type:"string",enum:["spreadsheet","document","research","finance","email","calendar","reminder","file_analysis","programming","database","calculation","legal","business","property","image","translation","brainstorm","connected_services","writing","project_management"]},instruction:{type:"string"}},required:["category","instruction"]}},
    {type:"function",name:"task_status",description:"Check status of a previously registered task by ID.",parameters:{type:"object",properties:{task_id:{type:"string"}},required:["task_id"]}},
    {type:"function",name:"search_web",description:"Research current public information on the web.",parameters:{type:"object",properties:{query:{type:"string"}},required:["query"]}},{type:"function",name:"remember_fact",description:"Save an explicitly user-requested, non-sensitive lasting fact to this customer's memory immediately. Only invoke after the caller directly asks you to remember or update a fact. Confirm success only from this tool's returned result. Never claim failure without calling. Use consistent lowercase snake_case keys; for example likes_chess. Provide their verbatim user statement.",parameters:{type:"object",properties:{fact_key:{type:"string"},fact_value:{type:"string"},user_statement:{type:"string"}},required:["fact_key","fact_value","user_statement"]}},{type:"function",name:"search_sandy_memory",description:"Search customer memories and active matters. Trusted calls already have authorization; for questions such as what do you know about me, use query overview.",parameters:{type:"object",properties:{query:{type:"string"}},required:["query"]}},{type:"function",name:"search_sandy_email",description:"Search stored customer email history after browser email code verification. Results are stored history, not a live mailbox.",parameters:{type:"object",properties:{query:{type:"string"}},required:["query"]}}],tool_choice:"auto",
   instructions:"You are Sandy AI, a warm, sharp, discreet personal voice assistant. Speak naturally, casually, and concisely in Australian English. Ask short follow-up questions when useful. This is a browser voice call. You can search the public web using search_web. Account-scoped WhatsApp voice links already authorize access to that customer’s memories and stored email history without further verification. Other links need email verification before private access. Never ask for codes during an authorized trusted call. You can propose tasks across categories through request_task, but must get separate approval through the call screen, and only some task types have a working executor. Never claim that queued work is completed. Direct email sending, calendar changes and destructive actions remain unavailable in this voice channel, so never claim that you have read them, sent anything, or performed an action. Always use search_sandy_memory when the caller asks about their recorded preferences, interests or facts. Search with brief keywords such as chess instead of their entire spoken question. Never state that no saved memory exists without searching. When the caller explicitly asks you to remember a non-sensitive fact, call remember_fact immediately; only tell them it was saved after that tool confirms. Do not say you cannot write memories without trying. Use the available search_sandy_memory tool to answer requests about the caller's known facts, history, preferences and projects. Use search_sandy_email for stored emails and search_web for public research. Do not tell a verified caller that memory is unavailable without attempting the lookup. Only actions that lack a working executor need another channel. The server explicitly marks trusted account-scoped calls as authorized for saved memory and stored email access. A trusted link grants that access without further confirmation. Other links remain locked until verified. Do not ask for passwords or codes. Greet the caller warmly and briefly by the customer profile first name, then ask how you can help." + (link.trusted_memory===true ? " PRIVATE MEMORY STATUS: ALREADY VERIFIED by the server. Additional customer context is available through account-specific memory search. Respond using the saved memory tools when asked about the customer; do not request additional verification." : " PRIVATE MEMORY STATUS: NOT VERIFIED. Require verification for private information.") + (firstName ? " Customer profile first name: "+firstName+". Begin by saying Hi "+firstName+", it is Sandy. How can I help?" : " No verified first name available; begin by saying Hi, it is Sandy. How can I help?"),
   audio:{input:{transcription:{model:"gpt-4o-mini-transcribe",language:"en",prompt:"English speech, usually Australian English. Preserve exact spoken words; common brief acknowledgements include yeah, yep, mm-hmm, uh-huh and okay. People may also intentionally speak another language."}},output:{voice:"marin"}}};
 const form=new FormData();form.set("sdp",sdp);form.set("session",JSON.stringify(sessionConfig));
 try{
  const response=await fetch(ROOT+"/realtime/calls",{method:"POST",headers:{authorization:"Bearer "+apiKey,"OpenAI-Safety-Identifier":hash.slice(0,48)},body:form,signal:AbortSignal.timeout(40000)});
  const result=await response.text();
  if(!response.ok){
   console.error("sandy_voice_call_provider",response.status,result.slice(0,350));
   await db.from("sandy_voice_call_sessions").update({state:"failed",error_code:"openai_http_"+response.status,ended_at:new Date().toISOString()}).eq("id",sessionId);
   return json({error:"Voice provider could not start this call (HTTP "+response.status+"). Try again in a moment."},502);
  }
  if(!result.startsWith("v=0")){
   await db.from("sandy_voice_call_sessions").update({state:"failed",error_code:"invalid_provider_sdp",ended_at:new Date().toISOString()}).eq("id",sessionId);
   return json({error:"Voice provider returned an invalid audio response"},502);
  }
  return json({ok:true,sdp:result,session_id:sessionId,private_access:link.trusted_memory===true?"verified":"verification_required"});
 }catch(e){
  console.error("sandy_voice_call_fetch",String(e).slice(0,160));
  await db.from("sandy_voice_call_sessions").update({state:"failed",error_code:"provider_timeout_or_network",ended_at:new Date().toISOString()}).eq("id",sessionId);
  return json({error:"Voice connection timed out. Please retry."},503);
 }
});