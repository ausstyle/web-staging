'use strict';
const el=id=>document.getElementById(id);
let token='',query='',next=null,items=[],listEpoch=0,readEpoch=0,collectionEpoch=0;
let listController,readController,retryAction,collections=[],view='messages',folder='inbox',label='';
let draft=null,draftDirty=false,pendingEdit=null,selectedMessage=null;
function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function status(text,retry){el('status').textContent=text;retryAction=retry;el('retry').hidden=!retry;}
async function invoke(operation,args,signal,key){
 const body={operation,version:1,request_id:crypto.randomUUID(),arguments:args};if(key)body.idempotency_key=key;
 const response=await fetch('/api/operations',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal,cache:'no-store',credentials:'omit'});
 if(!response.ok){let code='Request failed ('+response.status+').';try{const b=await response.json();code=b.error||code;}catch{}const e=new Error(code);e.status=response.status;throw e;}
 const out=await response.json();const expected=key?'LOCAL_MUTATION_COMMITTED':'LOCAL_READ_SUCCESS';
 if(out.state!==expected)throw new Error('No confirmed local result returned.');return out.result;
}
function canNavigate(){
 if(pendingEdit){status('An edit is unresolved. Retry the same edit before navigating.',runEdit);return false;}
 if(draftDirty&&!confirm('This draft has unsaved changes. Leave without saving these changes?'))return false;
 draftDirty=false;draft=null;return true;
}
function lockEditFields(locked){document.querySelectorAll('#draft-fields, #organization-fields, #create-collection input, #create-collection select, #create-collection button').forEach(n=>n.disabled=locked);}
function beginEdit(operation,args,onSaved){
 if(pendingEdit){status('Resolve the pending edit first.',runEdit);return;}
 pendingEdit={operation,args:JSON.parse(JSON.stringify(args)),key:crypto.randomUUID(),onSaved,inFlight:false};runEdit();
}
async function runEdit(){
 const edit=pendingEdit;if(!edit||edit.inFlight)return;edit.inFlight=true;lockEditFields(true);status('Saving to local PostgreSQL…');
 try{
  const receipt=await invoke(edit.operation,edit.args,undefined,edit.key);
  if(pendingEdit!==edit)return;pendingEdit=null;lockEditFields(false);
  await edit.onSaved(receipt);
 }catch(e){
  edit.inFlight=false;
  if([400,404,409,422].includes(e.status)){pendingEdit=null;lockEditFields(false);status(e.message+'. Your current draft or selection is retained. Reload the saved version before resolving a version conflict.');}
  else{status('Save is unconfirmed: '+e.message+'. Retry uses the same edit key.',runEdit);}
 }
}
async function loadCollections(){
 const epoch=++collectionEpoch;
 try{const result=await invoke('mail.collections.list',{});if(epoch!==collectionEpoch)return;collections=result;
  for(const kind of ['folder','label']){const container=el(kind==='folder'?'folders':'labels');container.replaceChildren();for(const c of collections.filter(x=>x.kind===kind)){const b=node('button',c.name,'collection');b.dataset.collectionId=c.collection_id;b.addEventListener('click',()=>navigateMessages(kind==='folder'?c.collection_id:'all',kind==='label'?c.collection_id:''));container.append(b);}}
 }catch(e){if(epoch===collectionEpoch)status('Folders and labels unavailable: '+e.message,loadCollections);}
}
function viewTitle(){if(view==='drafts')return 'Drafts';if(label)return collections.find(c=>c.collection_id===label)?.name||'Label';if(folder==='inbox')return 'Inbox';return collections.find(c=>c.collection_id===folder)?.name||'All mail';}
function renderList(){
 el('messages').replaceChildren();
 for(const item of items){const b=node('button',undefined,'message');b.dataset.messageId=item.message_id||item.draft_id;
  b.append(node('strong',item.subject||(view==='drafts'?'(Untitled draft)':'(No subject)')),node('span',new Date(item.received_at||item.updated_at).toLocaleString()),node('span',view==='drafts'?'Draft · version '+item.version:item.security_state+' · '+((item.flags||[]).join(', ')||'unread'),'meta'));
  b.addEventListener('click',()=>{if(canNavigate())view==='drafts'?openDraft(item.draft_id):openMessage(item.message_id);});el('messages').append(b);
 }
 el('list-status').textContent=items.length?items.length+(view==='drafts'?' drafts loaded':' messages loaded'):(view==='drafts'?'No saved drafts.':'No matching messages.');el('more').hidden=!next;el('more').disabled=false;
}
async function loadList(append=false){
 const epoch=++listEpoch;listController?.abort();listController=new AbortController();const cursor=append?next:null;
 if(!append){++readEpoch;readController?.abort();items=[];next=null;selectedMessage=null;el('messages').replaceChildren();el('reader').replaceChildren(node('p','Choose a '+(view==='drafts'?'draft':'message')+' to open.','empty'));}
 el('search').hidden=view==='drafts';el('view-title').textContent=viewTitle();el('more').disabled=true;el('list-status').textContent='Loading from local PostgreSQL…';status('Loading…');
 try{const operation=view==='drafts'?'mail.drafts.list':'mail.messages.list';const args=view==='drafts'?{after:cursor,limit:20}:{query,after:cursor,limit:20,folder,label};
  const result=await invoke(operation,args,listController.signal);if(epoch!==listEpoch)return;
  const id=x=>x.message_id||x.draft_id;const seen=new Set(items.map(id));items.push(...result.items.filter(x=>!seen.has(id(x))));next=result.next;renderList();status('Local '+(view==='drafts'?'drafts':'inbox')+' loaded. No external mail connection.');
 }catch(e){if(epoch!==listEpoch||e.name==='AbortError')return;el('list-status').textContent='Inbox could not be loaded. Existing rows may be stale.';el('more').disabled=false;status(e.message,()=>loadList(append));}
}
function navigateMessages(newFolder='inbox',newLabel=''){if(!canNavigate())return;view='messages';folder=newFolder;label=newLabel;loadList();}
function organizationEditor(m){
 const fieldset=node('fieldset');fieldset.id='organization-fields';fieldset.append(node('legend','Folder and labels'));
 const folderLabel=node('label','Folder');folderLabel.htmlFor='folder-choice';const select=node('select');select.id='folder-choice';const inbox=node('option','Inbox');inbox.value='';select.append(inbox);
 for(const c of collections.filter(x=>x.kind==='folder')){const o=node('option',c.name);o.value=c.collection_id;select.append(o);}select.value=m.organization.folder_id||'';fieldset.append(folderLabel,select);
 const labels=node('div',undefined,'label-options');for(const c of collections.filter(x=>x.kind==='label')){const l=node('label');const input=node('input');input.type='checkbox';input.value=c.collection_id;input.checked=m.organization.label_ids.includes(c.collection_id);l.append(input,node('span',c.name));labels.append(l);}fieldset.append(labels);
 const save=node('button','Save organization');save.type='button';save.addEventListener('click',()=>beginEdit('mail.messages.organize',{message_id:m.message_id,expected_version:m.organization.version,folder_id:select.value||null,label_ids:[...labels.querySelectorAll('input:checked')].map(n=>n.value)},async r=>{await loadList();status('Organization saved locally. Receipt '+r.receipt_id+' · version '+r.version+'.');}));fieldset.append(save);return fieldset;
}
async function openMessage(id){
 const epoch=++readEpoch;readController?.abort();readController=new AbortController();selectedMessage=id;el('reader').replaceChildren(node('p','Verifying stored original and attachments…','empty'));status('Opening message…');
 try{const m=await invoke('mail.messages.get',{message_id:id},readController.signal);if(epoch!==readEpoch)return;const article=el('reader');article.replaceChildren(node('h2',m.subject||'(No subject)'));
  article.append(node('p','From: '+(m.from||'(Header absent)')),node('p','To: '+(m.to.join(', ')||'(Header absent)')),node('p',new Date(m.received_at).toLocaleString(),'meta'));if(m.cc.length)article.append(node('p','Cc: '+m.cc.join(', ')));
  article.append(node('p',m.security_state+' · Text-only view. Remote images and active content are disabled.','security'));if(m.html_source_only)article.append(node('p','This message has no plain-text alternative. Its HTML source is shown as text.','meta'));article.append(node('pre',m.text,'body'));
  if(m.attachments.length){article.append(node('h3','Attachments'));for(const a of m.attachments)article.append(node('p',(a.name||'Unnamed attachment')+' · '+a.content_type+' · '+a.size+' bytes · '+a.scan_state+' — download unavailable','attachment'));}
  article.append(organizationEditor(m));const detail=node('details');detail.append(node('summary','Storage verification'));detail.append(node('p','Transport envelope: '+m.envelope_from+' → '+m.envelope_to.join(', ')),node('p','Receipt: '+m.receipt_id),node('p','Original SHA-256: '+m.raw_sha256),node('p','Original: '+m.raw_bytes+' bytes. Original and attachment integrity verified locally.'));article.append(detail);status('Stored message verified locally. No cloud-delivery claim.');
 }catch(e){if(epoch!==readEpoch||e.name==='AbortError')return;el('reader').replaceChildren(node('p','Message unavailable. No verified content was returned.','empty'));status(e.message,()=>openMessage(id));}
}
function renderDraft(d){
 draft=d;draftDirty=false;selectedMessage=null;const article=el('reader');article.replaceChildren(node('h2',d.version?'Edit draft':'New draft'),node('p','Saved drafts stay in this local mailbox. There is no send operation.','security'));
 const fields=node('fieldset');fields.id='draft-fields';const form=node('form');form.id='draft-form';
 for(const [id,title,value,tag] of [['draft-to','To (one address per line)',d.to.join('\n'),'textarea'],['draft-subject','Subject',d.subject,'input'],['draft-body','Message',d.text||'','textarea']]){const l=node('label',title);l.htmlFor=id;const input=node(tag);input.id=id;input.value=value;if(id==='draft-body')input.rows=12;if(id==='draft-to')input.rows=2;input.addEventListener('input',()=>{draftDirty=true;el('draft-state').textContent='Unsaved changes';});fields.append(l,input);}
 const save=node('button','Save draft');save.type='submit';const reload=node('button','Reload saved draft');reload.type='button';reload.disabled=!d.version;reload.addEventListener('click',()=>{if(!canNavigate())return;openDraft(d.draft_id);});fields.append(save,reload);form.append(fields);article.append(form);article.append(node('p',d.version?'Saved version '+d.version:'Not saved yet','meta'));article.lastChild.id='draft-state';
 form.addEventListener('submit',e=>{e.preventDefault();const args={draft_id:d.draft_id,expected_version:d.version,subject:el('draft-subject').value,to:el('draft-to').value.split('\n').map(x=>x.trim()).filter(Boolean),text:el('draft-body').value};beginEdit('mail.drafts.save',args,r=>{d.version=r.version;d.subject=args.subject;d.to=args.to;d.text=args.text;draftDirty=false;reload.disabled=false;el('draft-state').textContent='Saved locally · version '+r.version+' · receipt '+r.receipt_id;status('Draft saved locally. Nothing was sent.');});});
}
async function openDraft(id){
 const epoch=++readEpoch;readController?.abort();readController=new AbortController();el('reader').replaceChildren(node('p','Loading saved draft…','empty'));
 try{const d=await invoke('mail.drafts.get',{draft_id:id},readController.signal);if(epoch!==readEpoch)return;renderDraft(d);status('Saved local draft loaded.');}catch(e){if(epoch!==readEpoch||e.name==='AbortError')return;status(e.message,()=>openDraft(id));}
}
el('connect').addEventListener('click',()=>{const value=el('token').value.trim();if(!/^[0-9a-f]{64}$/.test(value)){status('Enter the temporary token from the local server.');return;}token=value;el('token').value='';el('connect-panel').hidden=true;el('workspace').hidden=false;if(pendingEdit){status('Local session updated. Retry the pending edit with its original key.',runEdit);return;}if(draftDirty){status('Local session updated; unsaved draft retained.');return;}loadCollections();loadList();});
el('search').addEventListener('submit',e=>{e.preventDefault();if(!canNavigate())return;query=el('query').value.trim();loadList();});
el('refresh').addEventListener('click',()=>{if(canNavigate()){loadCollections();loadList();}});
el('inbox-nav').addEventListener('click',()=>navigateMessages());
el('drafts-nav').addEventListener('click',()=>{if(!canNavigate())return;view='drafts';loadList();});
el('new-draft').addEventListener('click',()=>{if(!canNavigate())return;++readEpoch;readController?.abort();++listEpoch;listController?.abort();renderDraft({draft_id:crypto.randomUUID(),version:0,subject:'',to:[],text:''});status('New local draft. Save to persist it.');});
el('more').addEventListener('click',()=>{if(pendingEdit||draftDirty){status('Save or resolve the current draft before loading another page.',pendingEdit?runEdit:undefined);return;}loadList(true);});el('retry').addEventListener('click',()=>retryAction?.());
el('create-collection').addEventListener('submit',e=>{e.preventDefault();beginEdit('mail.collections.create',{collection_id:crypto.randomUUID(),kind:el('collection-kind').value,name:el('collection-name').value},async r=>{el('collection-name').value='';await loadCollections();if(selectedMessage)await openMessage(selectedMessage);status('Folder or label created locally. Receipt '+r.receipt_id+'.');});});
function connectFragment(){const bootstrap=new URLSearchParams(location.hash.slice(1)).get('session');if(location.hash)history.replaceState(null,'',location.pathname);if(bootstrap){el('token').value=bootstrap;el('connect').click();}}
window.addEventListener('hashchange',connectFragment);window.addEventListener('beforeunload',e=>{if(draftDirty||pendingEdit){e.preventDefault();e.returnValue='';}});connectFragment();
