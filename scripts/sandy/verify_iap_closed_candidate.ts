/** New IAP candidate: authenticated denied acceptance only. Never mint an Owner
 * session, establish a grant, admit a repair job or call an IAP provider API. */
import {createEngineeringSessionClient} from '../../supabase/functions/_shared/sandy_engineering_session_client.ts';
import type {IssuedSession} from '../../supabase/functions/_shared/sandy_engineering_session.ts';
import {engineeringIdentityQuery,managementRequest} from './verify_mcp_candidate.ts';
import {iapRepairProposal,iapRepairTarget} from '../../supabase/functions/_shared/sandy_iap_repair_contract.ts';
type Obj=Record<string,any>;
const base='https://zmqlyygzqoidkcwdysok.supabase.co';
function need(v:unknown,code:string):asserts v{if(!v)throw Error(code);}
const body=(r:Response)=>r.json();
const stateQuery=`SELECT g.iap_repair_revision,g.iap_repair_policy IS NULL no_iap_grant,
 (SELECT count(*)::int FROM public.sandy_api_execution_admissions WHERE contract_sha256=encode(extensions.digest('sandy-protected-iap-repair-v1','sha256'),'hex')) repair_admissions,
 (SELECT count(*)::int FROM public.sandy_deployment_jobs WHERE payload->>'boundary'='gcp_iap_repair') repair_jobs,
 (SELECT count(*)::int FROM public.sandy_engineering_identity_events WHERE detail->>'boundary'='gcp_iap_repair_delegation' AND actor_kind='controller_owner') owner_iap_events
 FROM public.sandy_engineering_control_grants g JOIN auth.users u ON u.id=g.identity_user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal'`;
/** Safe diagnostic metadata only; never retain headers, raw body or tokens. */
export async function candidateHealth(target:string,request=fetch){
 try{
  const response=await request(target+'/healthz',{redirect:'error',signal:AbortSignal.timeout(15000)});
  const type=(response.headers.get('content-type')||'').split(';')[0];
  const raw=await response.text();let value:unknown;try{value=JSON.parse(raw);}catch{/* platform error pages are not application JSON */}
  const healthy=response.status===200&&!!value&&typeof value==='object'&&(value as Obj).ok===true;
  const classification=healthy?'application_health_ok':response.status===401?'http_unauthenticated':response.status===403?'http_forbidden':response.status===404?'http_not_found':response.status>=500?'http_upstream_failure':response.status===200?'invalid_application_health':'unexpected_http_status';
  return {healthy,http_status:response.status,classification,content_type:['application/json','text/html','text/plain'].includes(type)?type:'other',body_format:value===undefined?'non_json':'json',response_body_recorded:false};
 }catch{return {healthy:false,http_status:null,classification:'health_transport_unavailable',response_body_recorded:false};}
}
export async function deniedChecks(target:string,source:string,revision:string,token:string,anon:string,request=fetch){
 need(/^https:\/\/sandy-iap-repair-review---sandy-engineering-mcp-[a-z0-9]+-ew\.a\.run\.app$/.test(target)&&/^[a-f0-9]{64}$/.test(source)&&/^sandy-engineering-mcp-iap-[0-9]+-[0-9]+$/.test(revision),'closed_candidate_source_binding_required');
 const headers={authorization:'Bearer '+token,apikey:anon,'content-type':'application/json'};
 const send=(url:string,b:Obj)=>request(url,{method:'POST',redirect:'error',headers,body:JSON.stringify(b),signal:AbortSignal.timeout(30000)});
 const health=await candidateHealth(target,request);need(health.healthy,'iap_candidate_health_failed');
 // The actual MCP tools/call uses the normal workload session. No high-risk
 // tool may be invoked through a read-only or canary grant.
 const args={change_id:iapRepairProposal,provider:'google_cloud',operation:'iap.repair.plan',target:iapRepairTarget,idempotency_key:'iap-closed-'+crypto.randomUUID(),payload:{}};
 const mcp=await send(target+'/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'engineering.implementation.request',arguments:args}});
 const denied=await body(mcp);need(mcp.status===403&&denied.error==='sandy_api_access_required','mcp_independent_IAP_grant_denial_required');
 const direct=await send(base+'/functions/v1/sandy-engineering-control',{action:'implementation_request',...args});
 const directBody=await body(direct);need(direct.status===403&&directBody.error==='independent_iap_repair_job_authorization_required'&&directBody.executed===false,'control_independent_IAP_grant_denial_required');
 const ticket={admission_id:crypto.randomUUID(),grant_id:crypto.randomUUID(),request_id:crypto.randomUUID()};
 // Deliberately invalid Google identity is a denied test, not a fabricated
 // credential. Reaching this exact error independently proves the installed
 // source/revision binding matched before signature verification.
 const wrongIdentity=await send(base+'/functions/v1/sandy-engineering-control',{action:'gcp_iap_repair_claim',...ticket,source_sha256:source,worker_revision:revision,worker_identity:'deliberately-invalid-denied-fixture'});
 need(wrongIdentity.status===403&&(await body(wrongIdentity)).error==='expected_google_repair_runtime_required','live_source_binding_or_google_verification_unconfirmed');
 const worker=await send(target+'/internal/gcp-admin/iap-repair',ticket);const result=await body(worker);
 need(worker.status===403&&result.ok===false&&result.error==='protected_repair_admission_refused'&&result.executed===false&&result.administrator_token_issued===false&&
  result.token_recorded===false&&result.OS_commands===0&&Array.isArray(result.provider_receipts)&&result.provider_receipts.length===0,'closed_worker_must_deny_before_administrator_issuance');
 return {normal_workload_MCP_denied:true,MCP_http_status:mcp.status,protected_job_prepare_denied:true,
  live_source_binding_verified:true,invalid_google_identity_denied:true,closed_worker_http_status:worker.status,
  administrator_token_issued:false,Google_provider_requests:0,IAM_changes:0,OS_commands:0,agents_enrolled:0};
}
if(import.meta.main){
 const [directory,output]=Deno.args;need(directory&&output,'closed_candidate_arguments_required');
 const report:Obj={passed:false,production_promoted:false,grant_established:false,credentials_recorded:false};
 let sessions:ReturnType<typeof createEngineeringSessionClient>|undefined,issued:IssuedSession|undefined;
 const privateValues:string[]=[];let retiredFingerprint:string|undefined;
 const credential=Deno.env.get('SANDY_SUPABASE_MANAGEMENT_TOKEN');need(credential,'configured_management_credential_required');privateValues.push(credential);
 const management=async(path:'/api-keys'|'/database/query',b?:Obj)=>managementRequest(path,credential,[],b);
 try{
  const proof=JSON.parse(await Deno.readTextFile(directory+'/iap-runtime-binding.json'));
  need(proof.passed===true&&proof.production_traffic_unchanged===true&&proof.original_candidate_tag_preserved===true&&proof.source_commit===(Deno.env.get('SANDY_IAP_ACCEPTANCE_SOURCE_COMMIT')||Deno.env.get('GITHUB_SHA')),'independent_runtime_binding_proof_required');
  report.health=await candidateHealth(proof.url);need(report.health.healthy,'iap_candidate_health_failed');
  const before=await management('/database/query',{read_only:true,query:stateQuery});
  need(Array.isArray(before)&&before.length===1&&before[0].iap_repair_revision===0&&before[0].no_iap_grant===true&&before[0].owner_iap_events===0,'closed_acceptance_requires_unapproved_proposal');
  const keys=await management('/api-keys'),service=keys.find((r:Obj)=>r.name==='service_role')?.api_key,anon=keys.find((r:Obj)=>r.name==='anon')?.api_key;
  need(typeof service==='string'&&typeof anon==='string','normal_workload_issuer_transport_unavailable');privateValues.push(service,anon);
  const rows=await management('/database/query',{read_only:true,query:engineeringIdentityQuery});need(rows.length===1&&rows[0].controller_memberships===0,'nonowner_workload_identity_required');
  sessions=createEngineeringSessionClient(base,service);issued=await sessions.get({userId:rows[0].user_id,epoch:rows[0].credential_epoch,bootstrapGeneration:rows[0].bootstrap_generation});privateValues.push(issued.token);
  retiredFingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(issued.sessionId))),b=>b.toString(16).padStart(2,'0')).join('');
  Object.assign(report,await deniedChecks(proof.url,proof.source_sha256,proof.revision,issued.token,anon),{revision:proof.revision,source_commit:proof.source_commit,runtime_identity:proof.runtime_identity,image_digest:proof.image_digest});
  const after=await management('/database/query',{read_only:true,query:stateQuery});need(JSON.stringify(after)===JSON.stringify(before),'denied_acceptance_must_not_create_admission_job_or_authority');
  report.no_new_admissions_jobs_or_grants=true;report.passed=true;
 }catch(e){report.error=e instanceof Error&&/^[a-zA-Z0-9_]{3,100}$/.test(e.message)?e.message:'closed_iap_candidate_verification_failed';}
 finally{
  if(issued&&sessions)try{await sessions.retireIssued(issued);report.normal_Auth_session_retired=true;}catch{report.passed=false;report.cleanup_error='engineering_auth_retirement_failed';}
  if(retiredFingerprint)try{
   const rows=await management('/database/query',{read_only:true,query:"SELECT NOT EXISTS(SELECT 1 FROM auth.sessions WHERE encode(extensions.digest(id::text,'sha256'),'hex')='"+retiredFingerprint+"') session_removed"});
   need(rows.length===1&&rows[0].session_removed===true,'normal_Auth_session_removal_unverified');report.normal_Auth_session_removal_independently_verified=true;
  }catch{report.passed=false;report.cleanup_error='normal_Auth_session_removal_unverified';}
  let text=JSON.stringify(report,null,2);for(const v of privateValues)text=text.split(v).join('[REDACTED]');await Deno.writeTextFile(output,text+'\n');console.log('::notice title=Closed IAP candidate acceptance::'+text.replaceAll('\n',' '));
 }
 if(!report.passed)Deno.exit(1);
}
