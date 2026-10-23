/** Fixed configuration within existing service-only timer authority. The
 * canonical runtime credential never leaves trusted runtime/Vault. */
const change="740a56f8-a582-419f-a4d9-9440af5e57f9";
const workerSource="fcfcf09aa2f5cd2b76e95efdc1dd70213170dcceda9db395e21ef0c81e10de54";
const validState=(v:any)=>v?.ok===true&&v.enabled===false&&v.unactivated===true&&v.active_jobs===0&&
 v.tracking_verified===true&&v.tracking_change_id===change&&v.configuration_contract==="private-durable-worker-transport-v2"&&v.authority_expanded===false;
export async function bindPrivateWorkerTransport(db:any,key:string,identity:{sourceCommit:string;runId:string},request:typeof fetch=fetch){
 const fail=(error:string,status=409)=>({status,body:{ok:false,error,automatic_retry:false}});
 if(key.length<100||key.length>8192||!/^[a-f0-9]{40}$/.test(identity.sourceCommit)||!/^\d{1,20}$/.test(identity.runId))return fail("worker_transport_identity_invalid",403);
 const before=await db.rpc("sandy_orch_worker_transport_state");
 if(before.error||!validState(before.data))return fail("worker_transport_guard_unavailable_or_ineligible");
 const bound=await db.rpc("sandy_orch_worker_bind_transport",{p_secret:key});
 if(bound.error||bound.data?.ok!==true||bound.data.bound!==true||bound.data.authority_expanded!==false)return fail("worker_transport_binding_not_verified");
 const after=await db.rpc("sandy_orch_worker_transport_state");
 if(after.error||!validState(after.data)||after.data.credential_bound!==true)return fail("worker_transport_custody_not_verified");
 let response:Response;
 try{response=await request("https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-orchestration-api",{
  method:"POST",headers:{authorization:"Bearer "+key,"content-type":"application/json"},
  body:JSON.stringify({action:"worker_run",arguments:{limit:1,lease_seconds:90}}),redirect:"error",signal:AbortSignal.timeout(30000),
 });}catch{return fail("worker_transport_http_outcome_unknown_reconcile",502);}
 let body:any={};try{const raw=await response.text();if(raw.length<=32768)body=JSON.parse(raw);}catch{/* No valid receipt. */}
 if(response.status!==200||body.ok!==true||body.claimed!==0||!Array.isArray(body.results)||body.results.length!==0)return fail("worker_transport_empty_dispatch_not_verified_http_"+response.status,502);
 const event=await db.from("sandy_engineering_change_events").insert({change_id:change,event_type:"durable_dispatch_private_transport_verified",actor:null,
  detail:{worker_http_status:200,jobs_claimed:0,worker_source_sha256:workerSource,worker_source_basis:"expected_pin_requires_independent_release_readback",
   source_commit:identity.sourceCommit,github_run_id:identity.runId,credential_exported:false,provider_execution:false,timer_enabled:false,authority_expanded:false}});
 if(event.error)return fail("worker_transport_verified_audit_not_persisted",503);
 return {status:200,body:{ok:true,operation:"runtime_worker_transport_bind",private_transport_bound:true,worker_http_status:200,jobs_claimed:0,
  tracking_change_id:change,receipt_recorded:true,timer_enabled:false,provider_execution:false,authority_expanded:false}};
}
