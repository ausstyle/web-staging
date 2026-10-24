/** Real standing workload -> durable queue -> scheduled worker -> renewable Auth
 * -> MCP -> Sandy API -> GitHub metadata read. No Owner session or provider write. */
import {createEngineeringSessionClient} from '../../supabase/functions/_shared/sandy_engineering_session_client.ts';
import {argumentDigest} from '../../supabase/functions/_shared/sandy_api_protocol.ts';
import {engineeringIdentityQuery} from './verify_mcp_candidate.ts';
const base='https://zmqlyygzqoidkcwdysok.supabase.co',managementBase='https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok';
if(import.meta.main){
 const index=Deno.args.indexOf('--output'),output=Deno.args[index+1];if(index<0||!output)throw Error('output_required');
 const proxy=Deno.env.get('HTTPS_PROXY'),client=proxy?Deno.createHttpClient({proxy:{url:proxy},http2:false}):undefined;
 const request:typeof fetch=(url,init={})=>fetch(url,{...init,...(client?{client}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});
 const management=Deno.env.get('SANDY_SUPABASE_MANAGEMENT_TOKEN');let sessions:any,issued:any,cancelJob:string|null=null,rpc:any,identityConfig:any;
 const out:any={passed:false,Owner_session_used:false,provider_writes:0,grant_changes:0,credentials_recorded:false,programme_code_execution_verified:false};
 const sql=async(query:string)=>{const r=await request(managementBase+'/database/query',{method:'POST',headers:{authorization:'Bearer '+management,'content-type':'application/json'},body:JSON.stringify({query,read_only:true})});if(!r.ok)throw Error('independent_database_readback_unavailable');return await r.json();};
 try{
  const keyReply=await request(managementBase+'/api-keys',{headers:{authorization:'Bearer '+management}});if(!keyReply.ok)throw Error('management_configuration_unavailable');const keys=await keyReply.json();
  const anon=keys.find((x:any)=>x.name==='anon')?.api_key,service=keys.find((x:any)=>x.name==='service_role')?.api_key;if(!anon||!service)throw Error('issuer_configuration_unavailable');
  const identities=await sql(engineeringIdentityQuery);if(identities.length!==1||identities[0].controller_memberships!==0)throw Error('distinct_workload_required');const identity=identities[0];
  identityConfig={userId:identity.user_id,epoch:identity.credential_epoch,bootstrapGeneration:identity.bootstrap_generation};sessions=createEngineeringSessionClient(base,service,request);issued=await sessions.get(identityConfig);
  rpc=async(name:string,body:any={})=>{const r=await request(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{authorization:'Bearer '+issued.token,apikey:anon,'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
  const run=crypto.randomUUID(),key='runtime-durable-read-'+run,notBefore=new Date(Date.now()+45000).toISOString();
  const admitted=await rpc('sandy_orch_admit_workload_read',{p_operation:'github.repos.get',p_canonical_arguments:'{}',p_idempotency_key:key,p_not_before:notBefore});
  out.admission_http_status=admitted.status;if(admitted.status!==200||admitted.data.ok!==true||admitted.data.executed!==false||admitted.data.principal_kind!=='engineering_workload')throw Error('normal_workload_admission_unverified');
  const job=admitted.data.job_id;if(!/^[a-f0-9-]{36}$/.test(job))throw Error('durable_job_identity_invalid');out.job_id=job;out.plan_id=admitted.data.plan_id;
  const again=await rpc('sandy_orch_admit_workload_read',{p_operation:'github.repos.get',p_canonical_arguments:'{}',p_idempotency_key:key,p_not_before:notBefore});if(again.data.job_id!==job||again.data.reused!==true)throw Error('durable_idempotency_unverified');out.idempotency_verified=true;
  const denied=await rpc('sandy_orch_admit_workload_read',{p_operation:'github.files.delete',p_canonical_arguments:'{}',p_idempotency_key:'runtime-durable-denied-'+run});if(denied.data.ok!==false||denied.data.error!=='operation_not_delegated_metadata_read')throw Error('write_admission_denial_unverified');out.write_admission_denied=true;
  const cancellable=await rpc('sandy_orch_admit_workload_read',{p_operation:'github.repos.get',p_canonical_arguments:'{}',p_idempotency_key:'runtime-durable-cancel-'+run,p_not_before:new Date(Date.now()+3600000).toISOString()});
  cancelJob=cancellable.data?.job_id;if(!cancelJob)throw Error('scheduled_read_admission_unverified');
  const cancelled=await rpc('sandy_orch_workload_job',{p_job_id:cancelJob,p_cancel:true});if(cancelled.data.state!=='cancelled'||cancelled.data.provider_cancellation!==false)throw Error('durable_cancellation_unverified');out.cancelled_job_id=cancelJob;out.scheduled_cancellation_verified=true;cancelJob=null;
  const retiredSession=issued.sessionId;if(!/^[a-f0-9-]{36}$/.test(retiredSession))throw Error('retirement_identity_invalid');await sessions.retireIssued(issued);issued=null;
  const retirement=await sql("SELECT NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id='"+retiredSession+"') retired,clock_timestamp() retired_at");if(retirement.length!==1||retirement[0].retired!==true)throw Error('admitting_session_retirement_unverified');const retiredAt=retirement[0].retired_at;out.admitting_session_retired_before_dispatch=true;
  // Wait for the actual existing timer. No direct privileged provider dispatch
  // or invented Owner actor is used to make this test complete.
  let observed:any;for(let attempt=0;attempt<50;attempt++){
   const rows=await sql("SELECT j.id,j.state,j.principal_kind,j.actor_id,j.operation,j.attempts,j.error_code,j.result->'result'->>'full_name' provider_resource,j.result->'result' provider_result,j.result->>'operation' result_operation,j.result->>'contract_version' result_contract,j.result->>'admission_id' result_admission_id,a.dispatch_id,a.outcome,a.execution_admission_id,e.identity_user_id,e.owner_authority_id,proof.state admission_state,proof.provider_http_status,proof.result_sha256,proof.created_at admitted_at,e.session_id<>'"+retiredSession+"' renewed_session FROM public.sandy_orch_jobs j LEFT JOIN public.sandy_orch_attempts a ON a.job_id=j.id AND a.attempt=j.attempts LEFT JOIN public.sandy_api_execution_admissions proof ON proof.id=a.execution_admission_id LEFT JOIN public.sandy_engineering_execution_authorizations e ON e.job_id=proof.approval_id WHERE j.id='"+job+"'");
   observed=rows[0];if(observed&&['succeeded','failed','blocked','dead_letter','needs_reconciliation','cancelled'].includes(observed.state))break;
   await new Promise(resolve=>setTimeout(resolve,3000));
  }
  out.observed_state=observed?.state;out.attempts=observed?.attempts;out.error_classification=observed?.error_code||null;
  if(!observed||observed.state!=='succeeded'||observed.outcome!=='succeeded'||observed.principal_kind!=='engineering_workload'||observed.actor_id!==identity.user_id||observed.identity_user_id!==identity.user_id||observed.owner_authority_id===identity.user_id||observed.admission_state!=='succeeded'||observed.provider_http_status!==200||observed.provider_resource!=='ausstyle/web-staging'||observed.renewed_session!==true||Date.parse(observed.admitted_at)<Date.parse(retiredAt)||!observed.execution_admission_id||!observed.result_sha256||observed.result_operation!=='github.repos.get'||observed.result_contract!=='1.0.0'||observed.result_admission_id!==observed.execution_admission_id||await argumentDigest(observed.provider_result)!==observed.result_sha256)throw Error('scheduled_real_provider_read_unverified');
  out.admitting_session_retired_before_dispatch=true;out.provider_result_hash_verified=true;out.independent_renewed_session_verified=true;out.provider_resource=observed.provider_resource;out.execution_admission_id=observed.execution_admission_id;out.dispatch_id=observed.dispatch_id;out.provider_http_status=observed.provider_http_status;out.result_sha256=observed.result_sha256;out.scheduled_provider_execution_verified=true;out.provider='github';out.operation='github.repos.get';
  const cancellationRead=await sql("SELECT state,(SELECT count(*) FROM public.sandy_orch_attempts a WHERE a.job_id=j.id) attempts FROM public.sandy_orch_jobs j WHERE id='"+out.cancelled_job_id+"'");if(cancellationRead.length!==1||cancellationRead[0].state!=='cancelled'||cancellationRead[0].attempts!==0)throw Error('cancelled_dispatch_absence_unverified');
  const count=await sql("SELECT count(*) count FROM public.sandy_orch_attempts WHERE job_id='"+job+"'");out.recorded_attempts=count[0].count;out.passed=true;
 }catch(error){const message=error instanceof Error?error.message:'';out.error=['independent_database_readback_unavailable','management_configuration_unavailable','issuer_configuration_unavailable','distinct_workload_required','normal_workload_admission_unverified','durable_job_identity_invalid','durable_idempotency_unverified','write_admission_denial_unverified','scheduled_read_admission_unverified','durable_cancellation_unverified','retirement_identity_invalid','admitting_session_retirement_unverified','scheduled_real_provider_read_unverified','cancelled_dispatch_absence_unverified'].includes(message)?message:'delegated_durable_acceptance_failed';}
 finally{
  // A failed assertion must not leave this test's own queued read running.
  // Renew the same legitimate workload identity only for owned-job cancellation;
  // never change the customer scheduler or replay a provider request.
  if(!out.passed&&out.job_id&&sessions&&identityConfig&&rpc){
   try{
    if(!issued)issued=await sessions.get(identityConfig);
    const cleanup=await rpc('sandy_orch_workload_job',{p_job_id:out.job_id,p_cancel:true});
    if(cleanup.data?.state==='cancelled')out.failed_fixture_cancelled=true;
    else out.cleanup_required_job_id=out.job_id;
   }catch{out.cleanup_required_job_id=out.job_id;}
  }
  if(cancelJob&&issued&&rpc){try{const cancelled=await rpc('sandy_orch_workload_job',{p_job_id:cancelJob,p_cancel:true});if(cancelled.data?.state==='cancelled')cancelJob=null;}catch{/* Report only the safe fixture ID below. */}}
  if(sessions&&issued){try{await sessions.retireIssued(issued);out.admitting_session_retired=true;}catch{out.passed=false;out.cleanup_error='workload_session_retirement_failed';}}
  if(cancelJob)out.cleanup_required_job_id=cancelJob;
  client?.close();await Deno.writeTextFile(output,JSON.stringify(out,null,2));console.log('::notice title=Delegated durable provider acceptance::'+JSON.stringify(out));
 }
 if(!out.passed)Deno.exitCode=1;
}
