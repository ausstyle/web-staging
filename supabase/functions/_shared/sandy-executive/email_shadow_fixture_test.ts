import assert from "node:assert/strict";
import {emailShadowFixture as fixed,resolveEmailShadowFixture} from "./email_shadow_fixture.ts";
const NOW=Date.parse("2026-10-24T00:00:00Z"),CID="10000000-0000-4000-8000-000000000001",SID="20000000-0000-4000-8000-000000000002",DID="30000000-0000-4000-8000-000000000003",AID="40000000-0000-4000-8000-000000000004",CON="50000000-0000-4000-8000-000000000005";
function fixture(){
 const tables:Record<string,any[]>={
  email_messages:[{id:SID,customer_id:CID,conversation_id:CON,created_at:new Date(NOW-1000).toISOString(),direction:"incoming",subject:fixed.subject,body_text:fixed.body,sender_address:fixed.sender},
   {id:DID,customer_id:CID,direction:"outgoing",delivery_status:"draft",body_text:fixed.baseline,recipient_addresses:[]}],
  email_customers:[{id:CID,display_name:fixed.customer,google_drive_folder_status:"excluded"}],
  sandy_memory_portal_accounts:[{auth_user_id:AID,customer_id:CID,revoked_at:null}],
  sandy_memory_settings:[{customer_id:CID,enabled:false,learning_enabled:false,proactive_enabled:false}],
  sandy_email_runtime_canary_allowlist:[{customer_id:CID,enabled:true}],
  email_ai_generations:[{customer_id:CID,source_message_id:SID,draft_message_id:DID,status:"generated",model_name:fixed.model,provider_response_id:null}],
  sandy_temporal_ingestion_jobs:[],sandy_controller_admins:[],
 };
 const user:any={id:AID,role:"authenticated",email:"fixture@example.invalid",email_confirmed_at:"2026-10-23T00:00:00Z",user_metadata:{sandy_api_isolated_session_test:true},app_metadata:{}};
 const queries:any[]=[];
 const db={auth:{admin:{getUserById:async(id:string)=>{assert.equal(id,AID);return {data:{user},error:null};}}},from(table:string){
  const filters:((r:any)=>boolean)[]=[];let max=Infinity;const record={table,filters:[] as any[]};queries.push(record);
  const q:any={select:()=>q,eq:(k:string,v:any)=>{record.filters.push([k,v]);filters.push(r=>r[k]===v);return q;},is:(k:string,v:any)=>{filters.push(r=>(r[k]??null)===v);return q;},
   gte:(k:string,v:string)=>{filters.push(r=>Date.parse(r[k])>=Date.parse(v));return q;},lte:(k:string,v:string)=>{filters.push(r=>Date.parse(r[k])<=Date.parse(v));return q;},
   in:(k:string,v:any[])=>{filters.push(r=>v.includes(r[k]));return q;},limit:(n:number)=>{max=n;return q;}};
  const rows=()=>tables[table].filter(r=>filters.every(f=>f(r))).slice(0,max);
  q.maybeSingle=async()=>({data:rows()[0]??null,error:null});q.then=(resolve:any)=>Promise.resolve({data:rows(),error:null}).then(resolve);return q;
 }};
 return {db,tables,user,queries};
}
Deno.test("fixed OIDC email fixture resolves one isolated source and exposes no credential",async()=>{
 const f=fixture(),result=await resolveEmailShadowFixture(f.db,NOW);assert.deepEqual(result,{source_message_id:SID,customer_id:CID});assert(Object.isFrozen(result));
 const source=f.queries[0];assert(source.filters.some((x:any)=>x[0]==="body_text"&&x[1]===fixed.body));assert(source.filters.some((x:any)=>x[0]==="sender_address"&&x[1]===fixed.sender));
});
Deno.test("missing, stale, future and ambiguous sources cannot invoke a private endpoint",async()=>{
 for(const mode of ["missing","stale","future","ambiguous"]){const f=fixture();if(mode==="missing")f.tables.email_messages=[];if(mode==="stale")f.tables.email_messages[0].created_at=new Date(NOW-11*60000).toISOString();if(mode==="future")f.tables.email_messages[0].created_at=new Date(NOW+1).toISOString();if(mode==="ambiguous")f.tables.email_messages.push({...f.tables.email_messages[0],id:DID});await assert.rejects(resolveEmailShadowFixture(f.db,NOW),/email_fixture_missing_or_ambiguous/);}
});
Deno.test("existing customers, unverified synthetic identities and Controller accounts fail closed",async()=>{
 for(const mode of ["customer","identity","controller"]){const f=fixture();if(mode==="customer")f.tables.email_customers[0].display_name="Existing customer";if(mode==="identity")f.user.user_metadata={};if(mode==="controller")f.tables.sandy_controller_admins=[{auth_user_id:AID}];await assert.rejects(resolveEmailShadowFixture(f.db,NOW),/email_fixture_(customer|auth_identity)_invalid/);}
});
Deno.test("memory learning, missing QA allowlist and provider baseline claims are denied",async()=>{
 for(const mode of ["learning","allowlist","provider"]){const f=fixture();if(mode==="learning")f.tables.sandy_memory_settings[0].learning_enabled=true;if(mode==="allowlist")f.tables.sandy_email_runtime_canary_allowlist=[];if(mode==="provider")f.tables.email_ai_generations[0].provider_response_id="fabricated_provider_receipt";await assert.rejects(resolveEmailShadowFixture(f.db,NOW),/email_fixture_(policy|baseline)_invalid/);}
});
Deno.test("background jobs, queued/sent messages and deliverable recipient drafts are denied",async()=>{
 for(const mode of ["job","queued","sent","recipient"]){const f=fixture();if(mode==="job")f.tables.sandy_temporal_ingestion_jobs=[{id:DID,customer_id:CID}];if(mode==="queued"||mode==="sent")f.tables.email_messages[1].delivery_status=mode;if(mode==="recipient")f.tables.email_messages[1].recipient_addresses=["recipient@example.invalid"];await assert.rejects(resolveEmailShadowFixture(f.db,NOW),/email_fixture_(background_work_not_empty|draft_not_unsent)/);}
});
