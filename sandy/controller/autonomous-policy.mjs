// Administrative provisioning only. Routine workers never depend on this page.
export function showAutonomousPolicyControls(host, transport) {
 const panel=document.createElement('section');panel.className='panel';
 const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 const status=el('p','Loading standing engineering delegation…');status.setAttribute('role','status');
 const identity=document.createElement('select');identity.setAttribute('aria-label','Existing engineering identity');
 const config=document.createElement('textarea');config.rows=12;config.setAttribute('aria-label','Bounded engineering policy JSON');config.style.width='100%';
 const save=el('button','Save standing delegation'),revoke=el('button','Revoke delegation'),refresh=el('button','Refresh policy');
 save.className=revoke.className=refresh.className='btn';
 panel.append(el('h2','Standing engineering delegation'),el('p','A delegated engineering identity can authorize routine releases without an owner browser or a per-release click. Policy changes require your authenticated administrator session. External provider protections remain in force.'),status,identity,config,save,revoke,refresh);host.append(panel);
 let grants=[];
 const selected=()=>grants.find(g=>g.identity_user_id===identity.value);
 const draw=()=>{const g=selected();config.value=JSON.stringify(g?.autonomous_config||{},null,2);status.textContent=g?`Grant revision ${g.autonomous_revision}; ${g.enabled&&!g.revoked_at&&g.autonomous_config?'configured — expiry and per-action admission still apply':'inactive for autonomous releases'}. Targets already granted: ${g.scope_prefixes.join(', ')}.`:'No eligible engineering identities.';save.disabled=revoke.disabled=!g;};
 const load=async()=>{const result=await transport.engineering({action:'get_autonomous_policy'});grants=result.grants||[];identity.replaceChildren();for(const g of grants){const o=el('option',g.identity_user_id);o.value=g.identity_user_id;identity.append(o);}draw();};
 const run=async(fn)=>{save.disabled=revoke.disabled=refresh.disabled=true;try{await fn();}catch(e){status.textContent=e.message;}finally{save.disabled=revoke.disabled=!selected();refresh.disabled=false;}};
 identity.onchange=draw;refresh.onclick=()=>run(load);
 save.onclick=()=>run(async()=>{const parsed=JSON.parse(config.value);await transport.engineering({action:'set_autonomous_policy',identity_user_id:identity.value,enabled:true,config:parsed});await load();});
 revoke.onclick=()=>run(async()=>{await transport.engineering({action:'set_autonomous_policy',identity_user_id:identity.value,enabled:false});await load();});
 run(load);
}
