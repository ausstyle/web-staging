import assert from "node:assert/strict";
import {authenticateComputerWorker,bindComputerTask,liveComputerSession,computerTaskScope} from "./worker_computer_identity.ts";
const now=Date.parse("2026-10-23T22:00:00Z");
const id="d1000000-0000-4000-8000-000000000001";
const sessionId="d2000000-0000-4000-8000-000000000001";
function fixture(){
 const session:any={id:sessionId,provider:"daytona",provider_session_id:"d3000000-0000-4000-8000-000000000001",state:"running",expires_at:new Date(now+60000).toISOString(),control_mode:"agent"};
 const task:any={id,session_id:sessionId,status:"claimed",attempts:1,lease_until:new Date(now+30000).toISOString(),requires_approval:false,task_type:"browser_agent",instruction:"Inspect the approved test page",task_payload:{origin:"sandy_internal"}};
 const db={rpc:async()=>({data:true,error:null}),from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==="sandy_computer_tasks"?task:session,error:null})};return q;}};
 return {db,session,task};
}
Deno.test("closed, revoked, expired or unbounded graphical sessions never bind a task",async()=>{
 const {db,session}=fixture(),proof=await authenticateComputerWorker(new Request("https://internal.invalid",{headers:{"x-sandy-worker-token":"fixture"}}),db);assert.ok(proof);
 assert.ok(await bindComputerTask(proof,db,id,now));
 for(const state of ["closed","terminated","deleted","failed","revoked","unknown"]){session.state=state;assert.equal(await bindComputerTask(proof,db,id,now),null);}
 session.state="running";
 for(const expiry of [null,undefined,"invalid",new Date(now).toISOString(),new Date(now-1).toISOString()]){session.expires_at=expiry;assert.equal(await bindComputerTask(proof,db,id,now),null);}
});
Deno.test("resume eligibility preserves identity checks and expires at the exact boundary",async()=>{
 const {db,session}=fixture(),proof=await authenticateComputerWorker(new Request("https://internal.invalid",{headers:{"x-sandy-worker-token":"fixture"}}),db);assert.ok(proof);
 for(const state of ["paused","stopped"]){session.state=state;const cap=await bindComputerTask(proof,db,id,now);assert.ok(cap);assert.equal(computerTaskScope(cap)?.session.state,state);assert.equal(await bindComputerTask(proof,db,id,now+60000),null);}
 session.provider_session_id="different-host";assert.equal(await bindComputerTask(proof,db,id,now),null);
});
Deno.test("human takeover and invalid lifecycle objects cannot manufacture computer authority",async()=>{
 for(const invalid of [null,[],{}, {state:"running",expires_at:null}])assert.equal(liveComputerSession(invalid,now),false);
 const {db,session}=fixture(),proof=await authenticateComputerWorker(new Request("https://internal.invalid",{headers:{"x-sandy-worker-token":"fixture"}}),db);assert.ok(proof);session.control_mode="human";assert.equal(await bindComputerTask(proof,db,id,now),null);
});
