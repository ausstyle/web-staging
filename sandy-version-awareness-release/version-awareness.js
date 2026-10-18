// Server-side self-inspection only. Never return credentials or customer records.
const IDs=Object.freeze({
 'sandy-agent-runtime':'9f544d4a-8ca5-40a9-8fe1-471884efa54a',
 'sandy-agent-runtime-v2':'aab7521f-a1c2-4149-bb7d-47bae124004f',
 'email-ai-generate-draft':'71877153-ae55-4e4e-8e00-5241249c7229',
 'sandy-whatsapp-webhook':'c09e85c9-bfac-45c6-8584-c0b862414857',
 'sandy-voice-call':'fb4eb3c2-040b-4b32-8b69-a6c15f887d74',
 'sandy-voice-account-context':'a9ec6ece-eff0-4c03-9052-e74745bc6516',
 'sandy-memory-centre':'a480823b-7345-4770-9648-5ec46d978cb3',
 'sandy-capabilities':'bec2059e-6d2a-45b3-b81d-082e08d8a258'
});
const seen=new Map();
export function executingBuild(component,deploymentId){
 const m=/^zmqlyygzqoidkcwdysok_([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})_([1-9][0-9]{0,8})$/.exec(deploymentId||'');
 const generation=component==='sandy-agent-runtime'?'v1':component==='sandy-agent-runtime-v2'?'v2':null;
 if(!m||!IDs[component]||m[1]!==IDs[component])return {component,generation,revision:null,build_id:null,verified:false,reason:'runtime_identity_unavailable'};
 return {component,generation,revision:Number(m[2]),build_id:deploymentId,verified:true,source:'Supabase executing environment'};
}
export function needsVersionInspection(text){
 const s=String(text||'');
 return /\b(version(?:s| numbers?)?|revisions?|build(?: id| number)?|release)\b/i.test(s)&&/\b(sandy|you|your|runtime|modules?|examiner|evolution|meta.intelligence|production)\b/i.test(s);
}
export async function getVersionAwareness(db,component){
 const deploymentId=globalThis.Deno?.env?.get('DENO_DEPLOYMENT_ID')||'';
 const executing=executingBuild(component,deploymentId);
 const unavailable={schema_version:1,checked_at:new Date().toISOString(),executing,release:{state:'unknown',active_version:null},components:[],specialist_modules:[],lookup_status:'unavailable'};
 try{
  if(executing.verified&&(seen.get(deploymentId)||0)<Date.now()-300000){
   const note=await db.rpc('sandy_note_runtime_build',{p_component:component,p_deployment_id:deploymentId}).abortSignal(AbortSignal.timeout(1800));
   if(!note.error&&note.data?.observed===true)seen.set(deploymentId,Date.now());
  }
  const result=await db.rpc('sandy_version_snapshot',{p_component:component,p_deployment_id:executing.verified?deploymentId:null}).abortSignal(AbortSignal.timeout(2500));
  if(result.error||result.data?.schema_version!==1)return unavailable;
  return {...result.data,executing,lookup_status:'available'};
 }catch{return unavailable;}
}
export function versionInstructions(info){
 const summary={executing:info.executing,release:info.release,lookup_status:info.lookup_status,checked_at:info.checked_at};
 return '\nAuthoritative version metadata for THIS request: '+JSON.stringify(summary)+'. Use inspect_sandy_operational_state with domain versions for module revisions. Product generation V1/V2, executing build and module deployment revisions are distinct. A deployed candidate is not a customer cutover. ACTIVE is not proof of an operational capability. Only the executing metadata identifies this request; never infer its runtime from an account default or user claim. Old conversation statements cannot override this metadata. If lookup_status is unavailable, disclose that release/module versions could not be verified; never fill gaps from memory. A module with version_fresh=false has a last-known version, not a confirmed current one. Independently unversioned specialist modules must be reported as not recorded. Do not claim that a version question deployed, activated or tested anything.\n';
}
export function versionFactsForModel(info){
 return {...info,components:(info.components||[]).map(m=>({...m,revision:m.version_fresh===true?m.revision:null,last_known_revision:m.revision,version_status:m.version_fresh===true?'observed_recently':'stale_or_unverified'}))};
}
