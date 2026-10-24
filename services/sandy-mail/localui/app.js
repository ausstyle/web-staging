'use strict';
const el = id => document.getElementById(id);
let token = '', query = '', next = null, items = [], listEpoch = 0, readEpoch = 0;
let listController, readController, retryAction;
function node(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
function status(text, retry) { el('status').textContent = text; retryAction = retry; el('retry').hidden = !retry; }
async function invoke(operation, args, signal) {
 const response = await fetch('/api/operations', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body:JSON.stringify({operation,version:1,request_id:crypto.randomUUID(),arguments:args}), signal, cache:'no-store', credentials:'omit'});
 if (!response.ok) { let code = 'Request failed ('+response.status+').'; try { const b=await response.json(); code=b.error || code; } catch {} throw new Error(code); }
 const body = await response.json();
 if (body.state !== 'LOCAL_READ_SUCCESS') throw new Error('No verified local result returned.');
 return body.result;
}
function renderList() {
 el('messages').replaceChildren();
 for (const item of items) {
  const b=node('button',undefined,'message'); b.dataset.messageId=item.message_id;
  b.append(node('strong',item.subject || '(No subject)'),node('span',new Date(item.received_at).toLocaleString()),node('span',item.security_state+' · '+((item.flags||[]).join(', ')||'unread'),'meta'));
  b.addEventListener('click',()=>openMessage(item.message_id)); el('messages').append(b);
 }
 el('list-status').textContent=items.length ? items.length+' messages loaded' : 'No matching messages.';
 el('more').hidden=!next; el('more').disabled=false;
}
async function loadList(append=false) {
 const epoch=++listEpoch; listController?.abort(); listController=new AbortController();
 const cursor=append?next:null;
 if (!append) { ++readEpoch;readController?.abort();items=[];next=null;el('messages').replaceChildren();el('reader').replaceChildren(node('p','Choose a message to read its stored content.','empty')); }
 el('more').disabled=true;el('list-status').textContent='Loading from local PostgreSQL…';status('Loading inbox…');
 try {
  const result=await invoke('mail.messages.list',{query,after:cursor,limit:20},listController.signal);
  if(epoch!==listEpoch)return;
  const seen=new Set(items.map(x=>x.message_id)); items.push(...result.items.filter(x=>!seen.has(x.message_id)));next=result.next;renderList();status('Local inbox loaded. No external mail connection.');
 } catch(e) { if(epoch!==listEpoch||e.name==='AbortError')return;el('list-status').textContent='Inbox could not be loaded. Existing rows may be stale.';el('more').disabled=false;status(e.message,()=>loadList(append)); }
}
async function openMessage(id) {
 const epoch=++readEpoch;readController?.abort();readController=new AbortController();
 el('reader').replaceChildren(node('p','Verifying stored original and attachments…','empty'));status('Opening message…');
 try {
  const m=await invoke('mail.messages.get',{message_id:id},readController.signal);
  if(epoch!==readEpoch)return;
  const article=el('reader');article.replaceChildren(node('h2',m.subject||'(No subject)'));
  article.append(node('p','From: '+(m.from||'(Header absent)')),node('p','To: '+(m.to.join(', ')||'(Header absent)')),node('p',new Date(m.received_at).toLocaleString(),'meta'));
  if(m.cc.length)article.append(node('p','Cc: '+m.cc.join(', '))); 
  article.append(node('p',m.security_state+' · Text-only view. Remote images and active content are disabled.','security'));
  if(m.html_source_only)article.append(node('p','This message has no plain-text alternative. Its HTML source is shown as text.','meta'));
  article.append(node('pre',m.text,'body'));
  if(m.attachments.length) {
   article.append(node('h3','Attachments'));
   for(const a of m.attachments)article.append(node('p',(a.name||'Unnamed attachment')+' · '+a.content_type+' · '+a.size+' bytes · '+a.scan_state+' — download unavailable','attachment'));
  }
  const detail=node('details');detail.append(node('summary','Storage verification'));
  detail.append(node('p','Transport envelope: '+m.envelope_from+' → '+m.envelope_to.join(', ')),node('p','Receipt: '+m.receipt_id),node('p','Original SHA-256: '+m.raw_sha256),node('p','Original: '+m.raw_bytes+' bytes. Original and attachment integrity verified locally.'));
  article.append(detail);status('Stored message verified locally. No cloud-delivery claim.');
 } catch(e) { if(epoch!==readEpoch||e.name==='AbortError')return;el('reader').replaceChildren(node('p','Message unavailable. No verified content was returned.','empty'));status(e.message,()=>openMessage(id)); }
}
el('connect').addEventListener('click',()=>{token=el('token').value.trim();if(!/^[0-9a-f]{64}$/.test(token)){status('Enter the temporary token from the local server.');return;}el('token').value='';el('connect-panel').hidden=true;el('workspace').hidden=false;loadList();});
el('search').addEventListener('submit',e=>{e.preventDefault();query=el('query').value.trim();loadList();});
el('refresh').addEventListener('click',()=>loadList());
el('more').addEventListener('click',()=>loadList(true));
el('retry').addEventListener('click',()=>retryAction?.());
function connectFragment() {
 const bootstrap=new URLSearchParams(location.hash.slice(1)).get('session');
 if(location.hash)history.replaceState(null,'',location.pathname);
 if(bootstrap){el('token').value=bootstrap;el('connect').click();}
}
window.addEventListener('hashchange',connectFragment);
connectFragment();
