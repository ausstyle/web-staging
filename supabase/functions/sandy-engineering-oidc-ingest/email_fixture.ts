import {resolveEmailShadowFixture} from "../_shared/sandy-executive/email_shadow_fixture.ts";
/** Canonical runtime credential remains inside the already trusted worker.
 * A fixed, isolated, unsent fixture is the only admissible target. */
export async function invokeEmailShadowFixture(db:any,key:string,request:typeof fetch=fetch,resolve=resolveEmailShadowFixture){
 if(!key)throw Error("email_fixture_private_binding_unavailable");
 const fixture=await resolve(db);
 let response:Response;
 try{response=await request("https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-email-runtime-canary",{
  method:"POST",headers:{authorization:"Bearer "+key,"content-type":"application/json"},
  body:JSON.stringify({source_message_id:fixture.source_message_id}),signal:AbortSignal.timeout(120000),redirect:"error",
 });}catch{return {status:502,body:{ok:false,error:"email_fixture_transport_outcome_unknown",reconciliation_required:true,automatic_retry:false}};}
 let body:any={};try{const raw=await response.text();if(raw.length<=32768)body=JSON.parse(raw);}catch{/* Envelope remains unverified. */}
 if(response.status!==200||body.ok!==true||body.sent!==false||body.source_message_id!==fixture.source_message_id)
  return {status:response.status===409?409:502,body:{ok:false,error:response.status===409?"email_fixture_already_processed_reconcile":"email_fixture_execution_unverified",worker_http_status:response.status,automatic_retry:false}};
 return {status:200,body:{ok:true,operation:"runtime_email_shadow_fixture",worker_http_status:200,source_message_id:fixture.source_message_id,
  status:["candidate_ready","failed"].includes(body.status)?body.status:"unverified",candidate_ready:body.candidate_ready===true,sent:false,provider_effect_verified:false}};
}
