const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n};
/** Verified logical accounts only; unknown usage/recovery is never shown as healthy. */
export function mountHosting(host,client){
 let generation=0,disposed=false;
 host.replaceChildren();
 const title=el('h1','Website hosting'),lead=el('p','Manage your hosting account, usage and recovery.','lead');
 const notice=el('p','Hosting setup is in progress. Site deployment and domain changes are not available here yet.','notice');
 const setup=el('section',undefined,'card');setup.setAttribute('aria-label','Create logical hosting account');const create=el('button','Create or resume logical account');create.type='button';const createMessage=el('p','','status');createMessage.setAttribute('role','status');createMessage.setAttribute('aria-live','polite');setup.append(el('h2','Start with a logical account'),el('p','Starter plan. No charges, paid entitlement, servers, website deployment or domain/DNS changes. Your signed-in Sandy account determines ownership.'),el('p','Retry or reload in this same browser to resume safely. Keep site storage until setup is confirmed.'),create,createMessage,el('a','Sign in to Sandy'));setup.lastChild.href='../app/';
 const form=el('form'),label=el('label','Hosting account ID'),input=el('input');input.id='hosting-account-id';input.name='account';input.autocomplete='off';input.required=true;input.maxLength=36;label.htmlFor=input.id;
 const button=el('button','Load account');button.type='submit';const message=el('p','','status');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
 form.append(label,input,button,message);
 const nav=el('nav',undefined,'tabs');nav.setAttribute('aria-label','Hosting views');const body=el('section');let account=null,tab='Overview';
 function render(){body.replaceChildren();for(const b of nav.children)b.setAttribute('aria-current',b.textContent===tab?'page':'false');
  if(tab==='Overview'){
   const grid=el('div',undefined,'grid');
   for(const [name,value,detail] of [
    ['Account',account?'Registered':'Not loaded',account?'Your logical hosting account is registered.':'Enter your existing hosting account ID.'],
    ['Website','Not verified','No live site or deployment has been verified here.'],
    ['Domain & HTTPS','Not verified','Domain ownership, DNS and public HTTPS still need verification.'],
    ['Billing','Not verified','No verified usage or billing data is available here. A logical account alone does not start paid infrastructure.']]){const card=el('article',undefined,'card');card.append(el('h2',name),el('strong',value),el('p',detail));grid.append(card)}body.append(grid);
   if(account){const panel=el('article',undefined,'card');panel.append(el('h2','Account details'),el('p','Requested plan: '+account.requested_plan+' — no paid entitlement activated.'),el('p','Account ID: '+account.account_id,'mono'),el('p','Response request ID: '+account.request_id,'mono'));body.append(panel)}
  }else if(tab==='Usage & costs'){
   const panel=el('article',undefined,'card');panel.append(el('h2','Usage and costs'),el('strong','Not available'),el('p','Verified usage and charges have not been loaded. No amount is assumed to be zero.'),el('p','A cost estimate, an approved spending limit and an actual charge are different. Review each before enabling paid resources.'));body.append(panel);
  }else{const panel=el('article',undefined,'card');panel.append(el('h2','Backup and recovery'),el('strong','Not verified'),el('p','No backup or successful restore has been verified here.'),el('p','Before a restore, review the source backup, destination, expected data changes, cost and recovery evidence.'));body.append(panel)}
 }
 for(const name of ['Overview','Usage & costs','Recovery']){const b=el('button',name);b.type='button';b.onclick=()=>{tab=name;render()};nav.append(b)}
 form.onsubmit=async e=>{e.preventDefault();const current=++generation;account=null;render();button.disabled=true;create.disabled=true;message.textContent='Loading account…';try{const loaded=await client.getAccount(input.value.trim());if(disposed||current!==generation)return;account=loaded;message.textContent='Account loaded. Website and domain status remain unverified.';render()}catch(error){if(!disposed&&current===generation)message.textContent=error.message||'Unable to load account.'}finally{if(!disposed&&current===generation){button.disabled=false;create.disabled=false}}};
 create.onclick=async()=>{const current=++generation;account=null;render();create.disabled=true;button.disabled=true;createMessage.textContent='Creating or recovering your logical account…';try{const loaded=await client.createAccount();if(disposed||current!==generation)return;account=loaded;input.value=loaded.account_id;tab='Overview';createMessage.textContent='Logical account created and read back. No paid resources or domain changes.';render()}catch(error){if(!disposed&&current===generation)createMessage.textContent=error.message||'Setup is not confirmed. Retry with the saved request.'}finally{if(!disposed&&current===generation){create.disabled=false;button.disabled=false}}};
 host.append(title,lead,notice,setup,form,nav,body);render();
 return {clear(){generation++;account=null;input.value='';message.textContent='Your session changed. Load the account again.';button.disabled=false;create.disabled=false;createMessage.textContent='';render()},dispose(){disposed=true;generation++;host.replaceChildren()}};
}
