// One owner action for one pinned security change. No token export, synthetic
// owner session, approval SQL, browser-console instruction or sub-step prompts.
const HASH=/^[a-f0-9]{64}$/,SHA=/^[a-f0-9]{40}$/;
export async function sha256(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function loadAmendmentRelease(fetcher=fetch){
 const response=await fetcher('./amendment-b-release.json',{cache:'no-store',redirect:'error'});
 if(!response.ok)throw Error('Amendment B release metadata is unavailable.');
 const d=await response.json(),r=d.request;
 if(!SHA.test(d.source_commit||'')||!HASH.test(d.manifest_sha256||'')||!HASH.test(d.declaration_sha256||'')||
  !/^https:\/\/raw\.githubusercontent\.com\/ausstyle\/web-staging\/[a-f0-9]{40}\/docs\/sandy-engineering\/evaluations\/p0-amendment-b-source-manifest\.json$/.test(d.manifest_url||'')||
  !r||r.action!=='register'||r.risk!=='high'||r.title!=='Install Amendment B standing engineering policy authorization'||
  r.idempotency_key!=='sandy-amendment-b-'+d.source_commit.slice(0,12)||
  !r.expected_behavior?.includes(d.source_commit)||!r.expected_behavior?.includes(d.manifest_sha256)||
  !r.scope?.includes('security:standing-engineering-delegation')||
  !r.regression_rules?.includes('Standing-policy declaration: '+d.standing_declaration)||
  await sha256(d.standing_declaration)!==d.declaration_sha256)throw Error('Amendment B release pins are invalid.');
 const file=await fetcher(d.manifest_url,{cache:'no-store',redirect:'error'});
 if(!file.ok)throw Error('Pinned Amendment B manifest is unavailable.');
 const text=await file.text();if(await sha256(text)!==d.manifest_sha256||JSON.parse(text).source_commit!==d.source_commit)throw Error('Pinned Amendment B manifest does not match.');
 return d;
}
export async function registerAmendment(transport,d){
 const s=await transport.session();if(!s.user?.id)throw Error('Use your normal signed-in Controller owner session.');
 const out=await transport.engineering(d.request),id=out.change?.id;
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id||''))throw Error('Engineering Control did not return a registered change.');
 return {id,owner:s.user.id};
}
function recordedOwnerApproval(current,owner,d){
 return current.change?.status==='approved'&&current.events?.some(e=>e.actor===owner&&
  ['status_changed','owner_release_attested'].includes(e.event_type)&&e.detail?.to==='approved'&&
  e.detail.reason?.includes(d.source_commit)&&e.detail.reason?.includes(d.manifest_sha256)&&
  e.detail.reason?.includes('standing-policy declaration '+d.declaration_sha256));
}
export async function approveAmendment(transport,d,registration){
 const who=(await transport.session()).user?.id;if(who!==registration.owner)throw Error('Controller account changed; reload the recorded state.');
 let current=await transport.engineering({action:'get',change_id:registration.id});
 if(recordedOwnerApproval(current,who,d))return {change_id:registration.id,status:'approved',matching_owner_audit_verified:true,tokens_exported:false,deployment_started:false,reused:true};
 if(current.change?.status!=='proposed')throw Error('This change is not eligible for a new owner approval. Read its audit history.');
 if(current.change.expected_behavior!==d.request.expected_behavior||JSON.stringify(current.change.scope)!==JSON.stringify(d.request.scope)||
  !current.change.regression_rules?.includes('Standing-policy declaration: '+d.standing_declaration))throw Error('Registered change no longer matches the pinned release and standing declaration.');
 await transport.engineering({action:'status',change_id:registration.id,status:'approved',reason:`Release ${d.source_commit}; manifest ${d.manifest_sha256}; standing-policy declaration ${d.declaration_sha256}. Owner authorizes this exact security change and its bounded standing delegation through the authenticated Controller. Mandatory provider protections, CI, audit and rollback remain in force.`});
 current=await transport.engineering({action:'get',change_id:registration.id});
 if(!recordedOwnerApproval(current,who,d))throw Error('The owner approval audit is not verified. Refresh state; do not repeat approval.');
 return {change_id:registration.id,status:'approved',matching_owner_audit_verified:true,tokens_exported:false,deployment_started:false,reused:false};
}
const registrations=new Map();
export function showAmendmentBApproval(host,transport){
 const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 const box=el('section','');box.className='panel';const status=el('p','Registering the separately scoped Amendment B change…');status.setAttribute('role','status');
 const pins=el('pre',''),button=el('button','Approve Amendment B');button.className='btn';button.disabled=true;
 box.append(el('h2','Amendment B · standing engineering authority'),el('p','One owner approval covers the exact release and a durable, revocable canary grant for the existing engineering identity: V4/workspace, low or normal risk, at most ten releases per day and no new resource spending. Future eligible work uses standing policy; customer grants and mandatory provider protections remain effective.'),pins,status,button);host.append(box);
 let descriptor,registration;
 const load=async()=>{descriptor=await loadAmendmentRelease();pins.textContent=`Source: ${descriptor.source_commit}\nManifest: ${descriptor.manifest_sha256}\nStanding declaration: ${descriptor.declaration_sha256}`;
  const owner=(await transport.session()).user.id,key=owner+descriptor.source_commit+descriptor.manifest_sha256;
  if(!registrations.has(key))registrations.set(key,registerAmendment(transport,descriptor).catch(e=>{registrations.delete(key);throw e;}));
  registration=await registrations.get(key);status.textContent=`Registered change: ${registration.id}. Select Approve Amendment B to record owner authorization.`;button.disabled=false;};
 button.onclick=async()=>{button.disabled=true;try{const result=await approveAmendment(transport,descriptor,registration);status.textContent=`Approved change: ${result.change_id}. Matching owner audit verified. No token exported. The protected release and standing-policy installation can now proceed; no further Controller approval sub-steps are required.`;}catch(e){status.textContent=e.message;button.disabled=false;}};
 load().catch(e=>{status.textContent=e.message;});
}
