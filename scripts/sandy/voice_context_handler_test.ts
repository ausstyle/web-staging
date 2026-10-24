import assert from "node:assert/strict";
import {setRuntimeDatabase} from "./testing/fallback_client.ts";
const CID="10000000-0000-4000-8000-000000000001",SID="20000000-0000-4000-8000-000000000002",LID="30000000-0000-4000-8000-000000000003";
let sequence=0;
async function fixture(patch:{created_at?:string;end?:boolean;revokeOnRead?:boolean;disableOnRead?:boolean;contextOnly?:boolean;contextCurrent?:boolean}={}){
 const token="a".repeat(64),digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const hash=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join("");
 let revoked=false,disabled=false,memoryReads=0,temporalReads=0,contextChecks=0;
 const session={id:SID,owner_customer_id:CID,link_id:LID,created_at:patch.created_at??new Date().toISOString(),ended_at:patch.end?new Date().toISOString():null,state:patch.end?"ended":"connected"};
 const db={from(table:string){
  const q:any={};for(const method of ["select","eq"])q[method]=()=>q;
  const result=()=>({data:table==="sandy_voice_call_sessions"?session:table==="sandy_voice_call_links"?{id:LID,owner_customer_id:CID,token_sha256:hash,revoked_at:revoked?"now":null,purpose:patch.contextOnly?"context_only":"voice_call"}:table==="sandy_voice_private_auth"?{verified_at:"2026-10-20T00:00:00Z"}:table==="sandy_memory_settings"?{enabled:!disabled,consent_at:"2026-10-20T00:00:00Z",updated_at:disabled?"2026-10-23T01:00:00Z":"2026-10-20T00:00:00Z"}:table==="sandy_conversation_policy"?{policy_version:1,instructions:"Fixed policy"}:table==="sandy_v2_release_control"?{public_version:"2.7.3"}:[],error:null});
  q.maybeSingle=async()=>result();q.single=q.maybeSingle;q.then=(resolve:any)=>Promise.resolve(result()).then(resolve);return q;
 },async rpc(name:string){
  if(name==="sandy_voice_context_authority_current"){contextChecks++;return {data:patch.contextCurrent!==false&&!revoked&&!disabled,error:null};}
  if(name==="sandy_temporal_current"){temporalReads++;return {data:[],error:null};}
  assert.equal(name,"sandy_voice_lookup_memory");memoryReads++;
  if(patch.revokeOnRead)revoked=true;if(patch.disableOnRead)disabled=true;
  return {data:{enabled:true,facts:[{value:"private fixture response"}]},error:null};
 }};
 setRuntimeDatabase(db);const serve=Deno.serve;let handler:(req:Request)=>Promise<Response>;
 Deno.serve=((fn:any)=>{handler=fn;return {} as any;}) as typeof Deno.serve;
 try{await import(new URL(`../../supabase/functions/sandy-voice-account-context/index.ts?voice=${++sequence}`,import.meta.url).href);}
 finally{Deno.serve=serve;}
 return {invoke:(args:Record<string,unknown>={})=>handler(new Request("https://internal.invalid/voice",{method:"POST",body:JSON.stringify({token,session_id:SID,query:"fixture query",...args})})),reads:()=>({memoryReads,temporalReads}),contextChecks:()=>contextChecks};
}
Deno.test("actual private voice context returns the bound source without dispatching model or speech",async()=>{
 const f=await fixture(),response=await f.invoke(),body=await response.json();assert.equal(response.status,200);assert.equal(body.result.facts[0].value,"private fixture response");assert.equal(body.temporal_context_status,"available");assert.deepEqual(f.reads(),{memoryReads:1,temporalReads:1});
});
Deno.test("ended, invalid-age and future private voice sessions cannot read context",async()=>{
 for(const patch of [{end:true},{created_at:"invalid"},{created_at:"2000-01-01T00:00:00Z"},{created_at:"2099-01-01T00:00:00Z"}]){const f=await fixture(patch),response=await f.invoke();assert.equal(response.status,403);assert.equal(f.reads().memoryReads,0);}
});
Deno.test("private voice context suppresses results after authorization revocation during read",async()=>{
 const f=await fixture({revokeOnRead:true}),response=await f.invoke();assert.equal(response.status,403);assert.doesNotMatch(JSON.stringify(await response.json()),/private fixture response/);
});
Deno.test("private voice context suppresses results after memory consent changes during read",async()=>{
 const f=await fixture({disableOnRead:true}),response=await f.invoke();assert.equal(response.status,409);assert.doesNotMatch(JSON.stringify(await response.json()),/private fixture response/);assert.equal(f.reads().temporalReads,0);
});

Deno.test("context-only sessions require live underlying normal Auth authority before and after a private read",async()=>{
 const allowed=await fixture({contextOnly:true}),good=await allowed.invoke();assert.equal(good.status,200);assert.equal(allowed.contextChecks(),2);
 const revoked=await fixture({contextOnly:true,contextCurrent:false}),denied=await revoked.invoke();assert.equal(denied.status,403);assert.equal(revoked.reads().memoryReads,0);
 const interrupted=await fixture({contextOnly:true,revokeOnRead:true}),suppressed=await interrupted.invoke();assert.equal(suppressed.status,403);assert.doesNotMatch(JSON.stringify(await suppressed.json()),/private fixture response/);
});
Deno.test("context-only sessions cannot invoke Executive turns or model/tool execution",async()=>{
 const f=await fixture({contextOnly:true}),response=await f.invoke({operation:"turn",turn_id:SID});assert.equal(response.status,403);assert.equal((await response.json()).error,"context_only_session_cannot_execute_turns");assert.deepEqual(f.reads(),{memoryReads:0,temporalReads:0});
});
