// Exact one-off request through the existing Owner session. No release dispatch.
const PIN='8ee45969c6077622ea70abe583d25aad29b9da87613deae1cec72703b0375d67';
const canonical=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
export async function verifyDescriptor(d){
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(d))))].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==PIN)throw Error('The release package changed. Approval is disabled.');
 return d;
}
export function createRegionalApproval(transport,descriptor,now=Date.now){
 descriptor=structuredClone(descriptor);
 let owner,id,busy=false,attempted=false;
 const request=descriptor.owner_route.register;
 function exact(change){
  if(!change||Object.entries(request).some(([k,v])=>k!=='action'&&canonical(change[k])!==canonical(v)))throw Error('Recorded request differs from the exact release package.');
 }
 function audit(current){
  const t=now();
  return current?.change.status==='approved'&&Number.isFinite(t)&&current.events?.some(e=>
   e.change_id===id&&e.actor===owner&&e.event_type==='status_changed'&&e.detail?.to==='approved'&&
   e.detail.reason===descriptor.owner_route.approve.reason&&Number.isFinite(Date.parse(e.occurred_at))&&
   Date.parse(e.occurred_at)<=t&&t-Date.parse(e.occurred_at)<86400000);
 }
 async function account(){
  const who=(await transport.session()).user?.id;
  if(!who)throw Error('Sign in with your existing Controller Owner account.');
  owner??=who;if(who!==owner)throw Error('Controller account changed. Reload and review the release.');
 }
 async function inspect(){
  await verifyDescriptor(descriptor);await account();
  if(!id){
   const result=await transport.engineering({action:'list'});
   const matches=(result.changes||[]).filter(c=>c.requested_by===owner&&c.idempotency_key===request.idempotency_key);
   if(matches.length>1)throw Error('Ambiguous release records. Reconcile before approving.');
   id=matches[0]?.id;
  }
  if(!id)return {change:null,matching_owner_audit_verified:false};
  const current=await transport.engineering({action:'get',change_id:id});exact(current.change);
  return {...current,matching_owner_audit_verified:!!audit(current)};
 }
 async function approve(){
  if(busy)throw Error('The Owner action is already running.');busy=true;
  try{
   let current=await inspect();
   if(current.matching_owner_audit_verified)return {change_id:id,verified:true,reused:true,deployment_started:false};
   if(attempted)throw Error('Previous outcome uncertain. Refresh recorded state; do not repeat submission.');
   if(current.change&&current.change.status!=='proposed')throw Error('Matching unexpired Owner audit is missing. Reconcile recorded state.');
   await account();attempted=true;
   if(!current.change){
    const registered=await transport.engineering(structuredClone(request));
    if(!/^[a-f0-9-]{36}$/i.test(registered.change?.id||''))throw Error('Registration outcome uncertain. Refresh recorded state.');
    id=registered.change.id;exact(registered.change);
    current=await inspect();
    if(current.change.status!=='proposed')throw Error('Expected a proposed release; reconcile recorded state.');
   }
   await account();
   await transport.engineering({...descriptor.owner_route.approve,change_id:id});
   current=await inspect();
   if(!current.matching_owner_audit_verified)throw Error('Owner audit not verified. Refresh recorded state; do not repeat submission.');
   return {change_id:id,verified:true,reused:false,deployment_started:false};
  }finally{busy=false;}
 }
 return {inspect,approve,canSubmit:()=>!busy&&!attempted};
}
const actions=new WeakMap();
export function regionalApprovalFor(transport,descriptor){
 if(!actions.has(transport))actions.set(transport,createRegionalApproval(transport,descriptor));
 return actions.get(transport);
}
export function showRegionalReadApproval(host,transport){
 const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 const box=el('section','');box.className='panel';
 const details=el('pre','');details.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';
 const status=el('p','Loading the exact regional-read request…');status.setAttribute('role','status');
 const approve=el('button','Authorize this regional-read release');approve.className='btn primary';approve.disabled=true;
 const refresh=el('button','Refresh recorded state');refresh.className='btn';refresh.disabled=true;
 box.append(el('h2','Regional Cloud Run reads · exact release'),el('p','This records your Owner authorization for two function updates and two contract records, including bounded rollback, for at most 24 hours. It does not deploy, activate west8 bindings, expand access or change standing permissions.'),details,status,approve,refresh);host.append(box);
 let action;
 const read=async()=>{approve.disabled=true;try{const current=await action.inspect();status.textContent=current.matching_owner_audit_verified?`Owner audit verified for ${current.change.id}. The protected release may now be preflighted; this page has not deployed it.`:current.change?`Change ${current.change.id}: ${current.change.status}. Review the exact request before authorizing.`:'No release record yet. The button registers this exact request and records your authenticated Owner approval.';approve.disabled=!action.canSubmit()||(current.change&&current.change.status!=='proposed');}catch(e){status.textContent=e.message;}};
 refresh.onclick=read;
 approve.onclick=async()=>{approve.disabled=refresh.disabled=true;try{await action.approve();await read();}catch(e){status.textContent=e.message;}finally{refresh.disabled=false;}};
 (async()=>{const response=await fetch(new URL('../../docs/sandy-api/hosting-read-owner-request.json',import.meta.url),{cache:'no-store'});if(!response.ok)throw Error('Exact release package unavailable.');const d=await verifyDescriptor(await response.json());details.textContent=d.owner_route.register.expected_behavior+'\n\nApproval reason:\n'+d.owner_route.approve.reason+'\n\nAcceptance:\n'+d.owner_route.register.acceptance_criteria.join('\n');action=regionalApprovalFor(transport,d);refresh.disabled=false;await read();})().catch(e=>{status.textContent=e.message;});
}
