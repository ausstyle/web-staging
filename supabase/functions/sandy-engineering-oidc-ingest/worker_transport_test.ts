import assert from "node:assert/strict";
import {bindPrivateWorkerTransport} from "./worker_transport.ts";
const state={ok:true,enabled:false,unactivated:true,active_jobs:0,credential_bound:false,tracking_verified:true,tracking_change_id:"740a56f8-a582-419f-a4d9-9440af5e57f9",configuration_contract:"private-durable-worker-transport-v2",authority_expanded:false};
const key="eyJmaXh0dXJlIjp0cnVlfQ."+"YQ".repeat(50)+".c2lnbmF0dXJl",identity={sourceCommit:"a".repeat(40),runId:"123"};
function database(patch={},bindError=false){let bound=false;const calls:any[]=[],events:any[]=[];return {calls,events,rpc:async(name:string,args?:any)=>{calls.push({name,args});if(name==="sandy_orch_worker_transport_state")return {data:{...state,...patch,credential_bound:bound},error:null};bound=true;return {data:{ok:true,bound:true,authority_expanded:false},error:bindError?{}:null};},from:(table:string)=>{assert.equal(table,"sandy_engineering_change_events");return {insert:async(event:any)=>{events.push(event);return {error:null};}};}};}
Deno.test("private timer transport only binds canonical credential and verifies fixed empty dispatcher",async()=>{
 const db=database();const result=await bindPrivateWorkerTransport(db,key,identity,async(url,init)=>{
  assert.equal(url,"https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-orchestration-api");
  assert.deepEqual(JSON.parse(String(init?.body)),{action:"worker_run",arguments:{limit:1,lease_seconds:90}});
  assert.equal(new Headers(init?.headers).get("authorization"),"Bearer "+key);assert.equal(new Headers(init?.headers).get("apikey"),key);return Response.json({ok:true,claimed:0,results:[]});
 });assert.equal(result.body.ok,true);assert.equal(db.events.length,1);assert.equal(db.events[0].actor,null);
 assert.equal(JSON.stringify(result).includes(key),false);assert.equal(JSON.stringify(db.events).includes(key),false);
});
Deno.test("active, untracked or queued timer is denied before secret custody/provider request",async()=>{
 for(const patch of [{enabled:true},{unactivated:false},{active_jobs:1},{tracking_verified:false},{tracking_change_id:"other"}]){
  const db=database(patch);const result=await bindPrivateWorkerTransport(db,key,identity,()=>{throw Error("must not dispatch");});
  assert.equal(result.body.ok,false);assert.equal(db.calls.length,1);assert.equal(db.events.length,0);
 }
});
Deno.test("uncertain private dispatcher response never generates a verified receipt or retries",async()=>{
 const db=database();let calls=0;const result=await bindPrivateWorkerTransport(db,key,identity,()=>{calls++;throw Error("private detail");});
 assert.equal(calls,1);assert.equal(result.body.ok,false);assert.equal(db.events.length,0);assert.equal(JSON.stringify(result).includes("private detail"),false);
});

Deno.test("invalid transport preconditions are classified separately without custody or secret disclosure",async()=>{
 for(const [credential,who,error] of [
  [key,{...identity,sourceCommit:"not-a-reviewed-commit"},"worker_transport_source_invalid"],
  [key,{...identity,runId:"not-a-github-run"},"worker_transport_run_invalid"],
  ["short-private-fixture",identity,"worker_transport_credential_format_unsupported"],
  ["x".repeat(8193),identity,"worker_transport_credential_format_unsupported"],
 ] as const){
  const db=database();let requests=0;
  const result=await bindPrivateWorkerTransport(db,credential,who,()=>{requests++;throw Error("must not dispatch");});
  assert.equal(result.status,403);assert.ok("error" in result.body);assert.equal(result.body.error,error);
  assert.equal(result.body.automatic_retry,false);assert.equal(db.calls.length,0);
  assert.equal(db.events.length,0);assert.equal(requests,0);
  assert.equal(JSON.stringify(result).includes(credential),false);
 }
});

Deno.test("supported modern secret format still requires service RPC and canonical worker proof",async()=>{
 const modern="sb_secret_"+"A_-1".repeat(8);
 const db=database();const result=await bindPrivateWorkerTransport(db,modern,identity,async(_url,init)=>{
  assert.equal(new Headers(init?.headers).get("apikey"),modern);
  return Response.json({ok:true,claimed:0,results:[]});
 });assert.equal(result.body.ok,true);assert.equal(db.calls.length,3);assert.equal(db.events.length,1);
 const denied=database({},true);
 const forbidden=await bindPrivateWorkerTransport(denied,modern,identity,()=>{throw Error("must not dispatch");});
 assert.equal(forbidden.body.ok,false);assert.equal(denied.calls.length,2);assert.equal(denied.events.length,0);
 for(const invalid of ["sb_secret_"+"a".repeat(19),"sb_secret_"+"a".repeat(129),"sb_secret_"+"!".repeat(32),"sb_publishable_"+"a".repeat(32),"random-opaque-private-key".repeat(8)]){
  const guarded=database();const failure=await bindPrivateWorkerTransport(guarded,invalid,identity,()=>{throw Error("must not dispatch");});
  assert.ok("error" in failure.body);assert.equal(failure.body.error,"worker_transport_credential_format_unsupported");
  assert.equal(guarded.calls.length,0);assert.equal(guarded.events.length,0);
 }
});
