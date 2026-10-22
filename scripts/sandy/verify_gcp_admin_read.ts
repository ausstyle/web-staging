/** Real normal-Auth engineering preflight. Provider credentials never leave the
 * existing Cloud Run worker. Full infrastructure receipts stay in protected DB
 * audit and the caller's private output; console output is bounded metadata. */
import { createEngineeringSessionClient } from '../../supabase/functions/_shared/sandy_engineering_session_client.ts';
import { argumentDigest } from '../../supabase/functions/_shared/sandy_api_protocol.ts';
import { engineeringIdentityQuery } from './verify_mcp_candidate.ts';
const base='https://zmqlyygzqoidkcwdysok.supabase.co',management='https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok';
const output=Deno.args[Deno.args.indexOf('--output')+1];
if(!Deno.args.includes('--output')||!output||output.startsWith('/workspace/web-staging/'))throw Error('private_output_required');
const proxy=Deno.env.get('HTTPS_PROXY'),client=proxy?Deno.createHttpClient({proxy:{url:proxy},http2:false}):undefined;
const request:typeof fetch=(input,init={})=>fetch(input,{...init,...(client?{client}:{}),signal:init.signal??AbortSignal.timeout(120000)});
const report:Record<string,any>={observed_at_utc:new Date().toISOString(),passed:false,credential_recorded:false,owner_impersonated:false,IAM_changes:0,agents_enrolled:0};
let sessions:ReturnType<typeof createEngineeringSessionClient>|undefined,issued:Awaited<ReturnType<ReturnType<typeof createEngineeringSessionClient>['get']>>|undefined;
async function admin(path:string,body?:unknown){
 const r=await request(management+path,{method:body?'POST':'GET',redirect:'error',headers:{authorization:'Bearer '+Deno.env.get('SANDY_SUPABASE_MANAGEMENT_TOKEN'),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok){await r.body?.cancel();throw Error('administrator_verification_management_unavailable');}return await r.json();
}
const query=async(sql:string)=>admin('/database/query',{query:sql,read_only:true});
try{
 const keys=await admin('/api-keys'),service=keys.find((r:any)=>r.name==='service_role')?.api_key,anon=keys.find((r:any)=>r.name==='anon')?.api_key;
 if(!service||!anon)throw Error('engineering_session_configuration_unavailable');
 const rows=await query(engineeringIdentityQuery);if(rows.length!==1||rows[0].controller_memberships!==0)throw Error('engineering_nonowner_identity_required');
 const i=rows[0];sessions=createEngineeringSessionClient(base,service,request);issued=await sessions.get({userId:i.user_id,epoch:i.credential_epoch,bootstrapGeneration:i.bootstrap_generation});
 report.normal_Auth_user_verified=true;
 const response=await request(base+'/functions/v1/sandy-engineering-control',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+issued.token,apikey:anon,'content-type':'application/json'},body:JSON.stringify({action:'preflight',connection:'sandy-gcp-admin'})});
 const proof=await response.json();report.controller_http_status=response.status;
 if(response.status!==200||proof.ok!==true){
  const allowed=['standing_administrator_metadata_read_denied','fixed_administrator_worker_configuration_required','administrator_read_admission_unavailable','administrator_read_outcome_unknown','administrator_read_receipt_state_unknown','expected_google_runtime_identity_required','protected_API_admission_required','protected_API_admission_refused','google_runtime_metadata_required','deployed_runtime_identity_mismatch','administrator_short_lived_token_issuance_failed','administrator_token_expiry_invalid','administrator_provider_read_failed','deployed_service_identity_mismatch','immutable_vm_identity_mismatch','IAP_policy_etag_required','administrator_connection_unavailable','administrator_read_failed'];
  report.error=allowed.includes(proof.error)?proof.error:'administrator_preflight_failed';
  if(Number.isInteger(proof.provider_http_status))report.provider_http_status=proof.provider_http_status;
 }else{
  const runtime='sandy-mcp-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com';
  if(proof.runtime_identity!==runtime||proof.deployed_runtime_identity!==runtime||proof.runtime_revision!=='sandy-engineering-mcp-api-39849886412-4'||proof.administrator_identity!=='sandy-cloud-administrator@elaborate-haven-511518-a5.iam.gserviceaccount.com'||proof.token_issuance_verified!==true||proof.token_recorded!==false||proof.IAM_changes!==0||proof.agents_enrolled!==0||!Array.isArray(proof.provider_receipts)||proof.provider_receipts.length!==5||proof.provider_receipts.some((r:any)=>r.http_status!==200)||!Array.isArray(proof.targets)||proof.targets.length!==2||proof.targets.some((t:any)=>t.policy_read_verified!==true||typeof t.etag!=='string'||!t.etag)||!(/^[a-f0-9-]{36}$/.test(proof.admission_id)))throw Error('administrator_provider_proof_invalid');
  const {executed,...result}=proof;const expectedDigest=await argumentDigest(result);
  const receipts=await query("SELECT actor_id,state,provider_http_status,result_sha256 FROM public.sandy_api_execution_admissions WHERE id='"+proof.admission_id+"'");
  if(receipts.length!==1||receipts[0].actor_id!==i.user_id||receipts[0].state!=='succeeded'||receipts[0].provider_http_status!==200||receipts[0].result_sha256!==expectedDigest)throw Error('administrator_execution_receipt_unverified');
  report.passed=true;report.provider_proof=proof;report.admission_id=proof.admission_id;report.receipt_sha256=expectedDigest;report.provider_reads_verified=5;
  // Administrative audit records the real, already verified outcome only. It
  // neither writes approval nor changes the standing policy or verification flags.
  await admin('/database/query',{query:"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('6a419c3c-1a04-4e1b-9c5f-6f1a9abd5719','gcp_admin_provider_verified',NULL,'"+JSON.stringify({provider_proof:proof,receipt_sha256:expectedDigest,normal_engineering_identity:i.user_id}).replaceAll("'","''")+"'::jsonb)",read_only:false});
 }
}catch(error){report.passed=false;const code=error instanceof Error?error.message:'';report.error=/^(administrator_(provider_proof_invalid|execution_receipt_unverified|verification_management_unavailable)|engineering_(session_configuration_unavailable|nonowner_identity_required))$/.test(code)?code:'administrator_verification_unknown';}
finally{
 if(sessions&&issued){try{await sessions.retireIssued(issued);report.normal_Auth_session_retired=true;}catch{report.passed=false;report.cleanup_error='engineering_auth_retirement_failed';}}
 await Deno.writeTextFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 const {provider_proof,...safe}=report;console.log(JSON.stringify(safe));client?.close();
}
if(!report.passed)Deno.exit(1);
