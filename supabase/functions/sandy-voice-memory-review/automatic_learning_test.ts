/** Actual handler with isolated synthetic DB/provider transport. No customer
 * source, real model request, channel verification or provider effect occurs. */
import assert from "node:assert/strict";
import {Buffer} from "node:buffer";
import {voiceLearningSource,sameVoiceLearningSource,persistVoiceLearning} from "./automatic_learning.ts";
const customer="61000000-0000-4000-8000-000000000001",sid="62000000-0000-4000-8000-000000000001",link="63000000-0000-4000-8000-000000000001";
type Mode="allowed"|"denied"|"before_model"|"during_model"|"unknown"|"provider_failure";
async function fixture(mode:Mode){
 const now=Date.now(),time=(delta:number)=>new Date(now+delta).toISOString();
 const snapshot:any={ok:true,source_turns_sha256:"a".repeat(64),session_id:sid,customer_id:customer,link_id:link,session_created_at:time(-3600000),private_verified_at:time(-3500000),private_expires_at:time(3600000),link_expires_at:time(3600000),authorized_until:time(3600000),consent_at:time(-7200000),policy_updated_at:time(-7200000),source_not_before:time(-3500000),source_cutoff:time(0)};
 const review:any={},session:any={id:sid,owner_customer_id:customer,created_at:time(-3600000),state:"ended"};
 const counts={transcript_reads:0,model_requests:0,temporal_requests:0,persistence:0,derived_writes:0,source_checks:0};const pending:Promise<unknown>[]=[];
 let revoked=mode==="denied";
 const db={rpc:async(name:string,args:any)=>{
  if(name==="sandy_voice_automatic_learning_source"){
   counts.source_checks++;if(revoked)return{data:{ok:false,error:"automatic_learning_not_authorized"},error:null};
   return{data:{...snapshot,...(mode==="before_model"&&counts.source_checks>1?{policy_updated_at:time(-1000)}:{})},error:null};
  }
  assert.equal(name,"sandy_voice_automatic_learning_persist");counts.persistence++;
  assert.deepEqual(args.p_expected_source,snapshot);
  if(mode==="unknown")throw Error("private unavailable receipt");
  if(revoked)return{data:{ok:false,persisted:false,error:"automatic_learning_consent_or_source_changed"},error:null};
  counts.derived_writes++;Object.assign(review,{status:"complete",summary:args.p_result.summary,candidates:args.p_result.candidates});
  return{data:{ok:true,persisted:true,status:"complete",committed:1,review_required:0,rejected:0},error:null};
 },from:(table:string)=>{
  let selected="";const q:any={select:(s:string)=>{selected=s;return q;},eq:()=>q,gte:()=>q,lte:()=>q,order:()=>q,limit:()=>q,
   maybeSingle:async()=>({data:table==="sandy_voice_call_sessions"?session:Object.keys(review).length?review:null,error:null}),
   insert:(v:any)=>{assert.equal(table,"sandy_voice_memory_reviews");Object.assign(review,v);return q;},
   update:(v:any)=>{Object.assign(table==="sandy_voice_call_sessions"?session:review,v);return q;},
   then:(resolve:any)=>{if(table==="sandy_voice_transcript_turns"){counts.transcript_reads++;return Promise.resolve({data:selected==="id"?[]:[{id:1,role:"user",text:"I like synthetic ordinary coffee",created_at:time(-100000)}],error:null}).then(resolve);}return Promise.resolve({data:[],error:null}).then(resolve);}};
  return q;
 }};
 const context:any={voiceLearningSource,sameVoiceLearningSource,persistVoiceLearning,env:{get:(name:string)=>({SUPABASE_URL:"https://fixture.invalid",SUPABASE_SERVICE_ROLE_KEY:"fixture-private-transport",OPENAI_API_KEY:"fixture-private-provider"}as any)[name]},serve:(handler:any)=>context.handler=handler,createClient:()=>db,waitUntil:(p:Promise<unknown>)=>pending.push(p),fetch:async(input:any,init:any)=>{
  const url=String(input);if(url.endsWith("/sandy-temporal-ingest")){counts.temporal_requests++;return Response.json({});}
  assert.equal(url,"https://api.openai.com/v1/responses");counts.model_requests++;assert.equal(JSON.parse(init.body).store,false);
  if(mode==="during_model")revoked=true;
  if(mode==="provider_failure")return Response.json({error:{message:"synthetic private transcript must not be logged"}},{status:500});
  return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({summary:"Synthetic permitted summary",candidates:[{fact_key:"likes_coffee",fact_value:"Customer likes synthetic ordinary coffee",source_quote:"I like synthetic ordinary coffee",category:"preference",decision:"commit",rationale:"Synthetic exact source"}]})}]}]});
 }};
 const source=await Deno.readTextFile(new URL("./index.ts",import.meta.url));
 const candidate=source.replace('import {voiceLearningSource,sameVoiceLearningSource,persistVoiceLearning} from "./automatic_learning.ts";','const context=(globalThis as any).__voiceLearningFixture;const {voiceLearningSource,sameVoiceLearningSource,persistVoiceLearning}=context;const Deno=context;const EdgeRuntime=context;const fetch=context.fetch;').replace('import "jsr:@supabase/functions-js/edge-runtime.d.ts";','').replace('import {createClient} from "npm:@supabase/supabase-js@2";','const createClient=context.createClient;');
 (globalThis as any).__voiceLearningFixture=context;
 try{await import("data:application/typescript;base64,"+Buffer.from(candidate).toString("base64")+"#"+crypto.randomUUID());}
 finally{delete(globalThis as any).__voiceLearningFixture;}
 return{review,counts,invoke:async(token="fixture-private-transport")=>{const response=await context.handler(new Request("https://fixture.invalid",{method:"POST",headers:{authorization:"Bearer "+token},body:JSON.stringify({session_id:sid})}));await Promise.all(pending);return response;}};
}
Deno.test("learning opt-out stops actual handler before transcripts, temporal work, model or derived persistence",async()=>{
 const f=await fixture("denied"),response=await f.invoke();assert.equal(response.status,200);assert.equal((await response.json()).status,"automatic_learning_not_authorized");assert.equal(f.counts.transcript_reads,0);assert.equal(f.counts.model_requests,0);assert.equal(f.counts.temporal_requests,0);assert.equal(f.counts.persistence,0);assert.deepEqual(f.review,{});
});
Deno.test("actual handler checks policy immediately before model and atomically refuses persistence after model-time revocation",async()=>{
 for(const mode of ["before_model","during_model"]as const){const f=await fixture(mode),response=await f.invoke();assert.equal(response.status,200);assert.equal((await response.json()).status,"automatic_learning_not_authorized");assert.equal(f.counts.model_requests,mode==="before_model"?0:1);assert.equal(f.counts.derived_writes,0);assert.equal(f.review.summary,undefined);assert.equal(f.review.candidates,undefined);}
});
Deno.test("permitted actual handler uses one atomic derived persistence RPC and never the explicit customer writer transport",async()=>{
 const f=await fixture("allowed"),response=await f.invoke();assert.equal(response.status,200);assert.equal((await response.json()).committed,1);assert.equal(f.counts.model_requests,1);assert.equal(f.counts.persistence,1);assert.equal(f.counts.derived_writes,1);assert.equal(f.review.status,"complete");
});
Deno.test("lost persistence acknowledgement stays unknown without downgrading a potentially committed review or redispatching",async()=>{
 const f=await fixture("unknown"),response=await f.invoke(),body=await response.json();assert.equal(response.status,503);assert.equal(body.reconciliation_required,true);assert.equal(body.automatic_retry,false);assert.equal(f.counts.persistence,1);assert.equal(f.review.status,"processing");assert.equal(f.review.summary,undefined);
});
Deno.test("provider errors remain redacted and cannot persist model output",async()=>{
 const logged:string[]=[],original=console.error;console.error=(...values:unknown[])=>logged.push(values.join(" "));
 try{const f=await fixture("provider_failure"),response=await f.invoke();assert.equal(response.status,502);assert.equal(f.counts.persistence,0);assert.equal(f.review.error_code,"automatic_voice_model_unavailable");assert(!logged.join(" ").includes("private transcript"));}finally{console.error=original;}
});
