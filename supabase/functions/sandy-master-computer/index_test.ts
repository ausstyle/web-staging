/** Synthetic internal lifecycle tests; no graphical provider acceptance. */
import assert from "node:assert/strict";
import {createMasterComputerHandler} from "./index.ts";
const now=Date.parse("2026-10-23T23:00:00Z"),id="51519d66-3f77-401a-b463-b53d84b43a97";
function fixture(){
 const session:any={id,provider_session_id:"d3000000-0000-4000-8000-000000000001",state:"running",control_mode:"agent",expires_at:new Date(now+60000).toISOString()};
 const writes:string[]=[],tasks:{existing:any}={existing:null};
 const db={from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==="sandy_computer_sessions"?session:tasks.existing,error:null}),insert:()=>{writes.push(table);return q;},update:()=>{writes.push(table);return q;},single:async()=>({data:{id:"fixture-task",status:"queued"},error:null})};return q;}};
 const handler=createMasterComputerHandler({secret:"fixture-worker",endpoint:"https://internal.invalid",db,now:()=>now});
 const call=(body:unknown,token="fixture-worker")=>handler(new Request("https://internal.invalid",{method:"POST",headers:{authorization:"Bearer "+token},body:JSON.stringify(body)}));
 return{session,writes,tasks,call};
}
Deno.test("graphical admission rejects expired, unbounded and terminal sessions before AI handover or task queue writes",async()=>{
 for(const action of ["submit","handover"]){
  for(const change of [{expires_at:null},{expires_at:"invalid"},{expires_at:new Date(now).toISOString()},{state:"terminated"},{state:"stopped"}]){
   const f=fixture();Object.assign(f.session,change);
   const result=await f.call({action,mode:"ai",instruction:"Inspect the approved fixture",read_only:true,idempotency_key:"fixture-123456"});
   assert.equal(result.status,409);assert.equal((await result.json()).error,"live_bounded_computer_session_required");assert.deepEqual(f.writes,[]);
  }
 }
});
Deno.test("graphical idempotency cannot reuse another session or changed intent and read-only consent must be a boolean",async()=>{
 const body={action:"submit",instruction:"Inspect approved fixture",read_only:true,idempotency_key:"fixture-123456"};
 for(const change of [{session_id:"foreign"},{instruction:"Different objective"},{task_payload:{origin:"other",read_only:true}},{task_payload:{origin:"sandy_master_internal",read_only:false}}]){
  const f=fixture();f.tasks.existing={id:"prior",status:"queued",session_id:id,instruction:body.instruction,task_payload:{origin:"sandy_master_internal",read_only:true},...change};
  const result=await f.call(body);assert.equal(result.status,409);assert.equal((await result.json()).error,"idempotency_scope_conflict");assert.deepEqual(f.writes,[]);
 }
 for(const invalid of ["false",1,{},null]){const f=fixture();assert.equal((await f.call({...body,read_only:invalid})).status,400);assert.deepEqual(f.writes,[]);}
 const f=fixture();f.tasks.existing={id:"prior",status:"queued",session_id:id,instruction:body.instruction,task_payload:{origin:"sandy_master_internal",read_only:true}};const result=await f.call(body);assert.equal(result.status,200);assert.equal((await result.json()).reused,true);assert.deepEqual(f.writes,[]);
});
Deno.test("eligible task remains queued rather than completed and lifecycle guard does not invent execution authority",async()=>{
 const f=fixture(),body={action:"submit",instruction:"Inspect approved fixture",read_only:true,idempotency_key:"fixture-123456"};
 const rejected=await f.call(body,"foreign");assert.equal(rejected.status,403);assert.deepEqual(f.writes,[]);
 const admitted=await f.call(body);assert.equal(admitted.status,202);const result=await admitted.json();assert.equal(result.status,"queued");assert.equal(result.notice,"Queued, not completed.");assert.deepEqual(f.writes,["sandy_computer_tasks","sandy_computer_events"]);
});
Deno.test("expired session permits historical status and human takeover without reviving AI control",async()=>{
 const f=fixture();f.session.expires_at=new Date(now-1).toISOString();
 const status=await f.call({action:"status"});assert.equal(status.status,200);assert.deepEqual(f.writes,[]);
 const takeover=await f.call({action:"handover",mode:"human"});assert.equal(takeover.status,200);assert.equal((await takeover.json()).control_mode,"human");assert.deepEqual(f.writes,["sandy_computer_sessions","sandy_computer_events"]);
});
