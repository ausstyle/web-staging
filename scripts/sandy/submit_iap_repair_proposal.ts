/** Protected proposal submission only. No Owner session or provider credential
 * substitution. The service key is private issuer transport, never RPC bearer. */
import {createEngineeringSessionClient} from '../../supabase/functions/_shared/sandy_engineering_session_client.ts';
import {engineeringIdentityQuery} from './verify_mcp_candidate.ts';
const base='https://zmqlyygzqoidkcwdysok.supabase.co';
if(import.meta.main){
 const idx=Deno.args.indexOf('--output'),output=Deno.args[idx+1];if(idx<0||!output)throw Error('output_required');
 const proxy=Deno.env.get('HTTPS_PROXY'),client=proxy?Deno.createHttpClient({proxy:{url:proxy},http2:false}):undefined;
 const request:typeof fetch=(url,init={})=>fetch(url,{...init,...(client?{client}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});
 const management=Deno.env.get('SANDY_SUPABASE_MANAGEMENT_TOKEN');let sessions:any,issued:any;
 const out:any={passed:false,grant_established:false,IAM_changes:0,provider_operations:0,credentials_recorded:false};
 try{
  const keysReply=await request('https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/api-keys',{headers:{authorization:'Bearer '+management}});if(!keysReply.ok)throw Error('management_configuration_unavailable');const keys=await keysReply.json();
  const anon=keys.find((x:any)=>x.name==='anon')?.api_key,service=keys.find((x:any)=>x.name==='service_role')?.api_key;if(!anon||!service)throw Error('issuer_configuration_unavailable');
  const read=await request('https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/database/query',{method:'POST',headers:{authorization:'Bearer '+management,'content-type':'application/json'},body:JSON.stringify({query:engineeringIdentityQuery,read_only:true})});if(!read.ok)throw Error('workload_readback_unavailable');const identities=await read.json();if(identities.length!==1||identities[0].controller_memberships!==0)throw Error('distinct_workload_required');
  const i=identities[0];sessions=createEngineeringSessionClient(base,service,request);issued=await sessions.get({userId:i.user_id,epoch:i.credential_epoch,bootstrapGeneration:i.bootstrap_generation});
  const rpc=async(name:string,body:any={})=>{const r=await request(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{authorization:'Bearer '+issued.token,apikey:anon,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  const first=await rpc('sandy_engineering_submit_iap_repair_proposal');out.submission_http_status=first.status;
  if(first.status!==200||first.data?.ok!==true||first.data.state!=='proposed'||first.data.risk!=='high'||first.data.grant_established!==false||first.data.IAM_changes!==0)throw Error('proposal_submission_unverified');
  const again=await rpc('sandy_engineering_submit_iap_repair_proposal');if(again.status!==200||again.data.change_id!==first.data.change_id||again.data.reused!==true)throw Error('proposal_idempotency_unverified');
  out.change_id=first.data.change_id;out.proposal_sha256=first.data.proposal_sha256;out.proposal_state='proposed';out.risk='high';out.idempotency_verified=true;
  const denied=await rpc('sandy_engineering_set_iap_repair_delegation',{p_enabled:true,p_expires_at:'2026-10-30T21:17:00Z',p_expected_revision:0,p_change_id:out.change_id});out.workload_self_authorization_http_status=denied.status;if(denied.status!==403)throw Error('workload_authority_denial_unverified');
  const review=await rpc('sandy_engineering_get_iap_repair_proposal');out.workload_owner_review_http_status=review.status;if(review.status!==403)throw Error('owner_review_isolation_unverified');
  out.passed=true;
 }catch(e){const code=e instanceof Error?e.message:'';out.error=/^(management_configuration_unavailable|issuer_configuration_unavailable|workload_readback_unavailable|distinct_workload_required|proposal_submission_unverified|proposal_idempotency_unverified|workload_authority_denial_unverified|owner_review_isolation_unverified)$/.test(code)?code:'proposal_submission_failed';}
 finally{if(sessions&&issued){try{await sessions.retireIssued(issued);out.workload_session_retired=true;}catch{out.passed=false;out.cleanup_error='workload_session_retirement_failed';}}client?.close();await Deno.writeTextFile(output,JSON.stringify(out,null,2));console.log('::notice title=Protected IAP proposal submission::'+JSON.stringify(out));}
 if(!out.passed)Deno.exitCode=1;
}
