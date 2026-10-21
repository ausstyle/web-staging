import { strict as assert } from "node:assert";
import { createEngineeringRuntime, type RuntimeDependencies } from "./index.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import policy from "../sandy-operation-api/engineering_identity_policy.json" with { type:"json" };
const USER="10000000-0000-4000-8000-000000000001", KEY="synthetic_workload_bootstrap_"+"x".repeat(32), TOKEN="synthetic.private.user.token";
const message={jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"github.files.update",arguments:{}}};
function request(value:unknown=message,key=KEY){return new Request("https://runtime.invalid",{method:"POST",headers:{authorization:"Bearer "+key},body:JSON.stringify(value)})}
async function fixture(patch:Partial<RuntimeDependencies>={}){
 const state={sessions:0,mcp:0,receivedToken:"",resolvedHash:""};
 const deps:RuntimeDependencies={resolve:async hash=>{state.resolvedHash=hash;return {ok:true,identity_user_id:USER,credential_epoch:1,bootstrap_generation:1,policy_sha256:await argumentDigest(policy)}},session:async workload=>{state.sessions++;return {token:TOKEN,sessionId:USER,expiresAt:Date.now()+3600000,workload}},mcp:async(token)=>{state.mcp++;state.receivedToken=token;return {status:200,body:{jsonrpc:"2.0",id:1,result:{ok:true}}}},...patch};
 return {handler:createEngineeringRuntime(deps),state};
}
Deno.test("runtime uses a normal workload JWT only for Sandy MCP and returns no credentials",async()=>{
 const h=await fixture();const r=await h.handler(request());assert.equal(r.status,200);assert.equal(h.state.receivedToken,TOKEN);assert.match(h.state.resolvedHash,/^[a-f0-9]{64}$/);const text=await r.text();assert.equal(text.includes(TOKEN),false);assert.equal(text.includes(KEY),false);
});
Deno.test("customer, Controller and service JWTs cannot substitute for the private workload bootstrap",async()=>{
 for(const token of ["", "eyJhbGciOiJIUzI1NiJ9.payload.signature", "service.role.jwt"]){const h=await fixture();const r=await h.handler(request(message,token));assert.equal(r.status,401);assert.equal(h.state.sessions,0);assert.equal(h.state.mcp,0)}
});
Deno.test("revoked bootstrap and changed scope fail before session issuance or MCP dispatch",async()=>{
 for(const resolve of [async()=>({ok:false}),async()=>({ok:true,identity_user_id:USER,credential_epoch:1,bootstrap_generation:1,policy_sha256:"wrong"})]){
 const h=await fixture({resolve});assert.equal((await h.handler(request())).status,403);assert.equal(h.state.sessions,0);assert.equal(h.state.mcp,0)}
});
Deno.test("out-of-scope operations and malformed requests never reach MCP",async()=>{
 for(const value of [{...message,params:{name:"supabase.projects.delete",arguments:{}}},{...message,method:"unknown"},{...message,id:undefined},[]]){
 const h=await fixture();assert.ok([400,403].includes((await h.handler(request(value))).status));assert.equal(h.state.mcp,0)}
});
Deno.test("session failure is known to precede provider execution",async()=>{
 const h=await fixture({session:async()=>{throw Error("private credential must not leak")}}),r=await h.handler(request()),v=await r.json();assert.equal(r.status,503);assert.equal(v.executed,false);assert.equal(h.state.mcp,0);assert.equal(JSON.stringify(v).includes("private credential"),false);
});
Deno.test("uncertain MCP transport is never retried or reported as no effect",async()=>{
 let count=0;const h=await fixture({mcp:async()=>{count++;throw Error("private token")}}),r=await h.handler(request()),v=await r.json();assert.equal(count,1);assert.equal(v.executed,null);assert.equal(v.reconciliation_required,true);assert.equal(v.automatic_retry,false);
});
Deno.test("defensive result propagation redacts workload and access credentials",async()=>{
 const h=await fixture({mcp:async()=>({status:409,body:{error:TOKEN,detail:KEY}})}),r=await h.handler(request()),text=await r.text();assert.equal(r.status,409);assert.equal(text.includes(TOKEN),false);assert.equal(text.includes(KEY),false);assert.ok(text.includes("[REDACTED]"));
});

Deno.test("pre-dispatch expired session is renewed once with the same bound request before successful execution",async()=>{
 let calls=0,issued=0,invalidated=0;const messages:unknown[]=[];
 const h=await fixture({session:async workload=>({token:"private-session-"+(++issued),sessionId:USER,expiresAt:Date.now()+3600000,workload}),invalidate:()=>{invalidated++},mcp:async(_token,message)=>{messages.push(message);calls++;return calls===1?{status:200,body:{jsonrpc:"2.0",id:1,result:{isError:true,content:[{text:JSON.stringify({status:401,result:{error:"invalid_identity",executed:false}})}]}}}:{status:200,body:{jsonrpc:"2.0",id:1,result:{isError:false}}}}});
 const r=await h.handler(request());assert.equal(r.status,200);assert.equal(calls,2);assert.equal(issued,2);assert.equal(invalidated,1);assert.deepEqual(messages[0],messages[1]);
});
Deno.test("provider authorization failure and uncertain effects are never automatic session retries",async()=>{
 for(const detail of [{status:502,result:{error:"provider_authorization_refused",executed:true}},{status:401,result:{error:"invalid_identity",executed:null,reconciliation_required:true}},{status:403,result:{error:"engineering_fixture_scope_denied",executed:false}}]){
 let calls=0,invalidated=0;const h=await fixture({invalidate:()=>{invalidated++},mcp:async()=>{calls++;return {status:200,body:{result:{isError:true,content:[{text:JSON.stringify(detail)}]}}}}});await h.handler(request());assert.equal(calls,1);assert.equal(invalidated,0);
 }
});
Deno.test("revoked bootstrap discovered during renewal blocks issuance and the second MCP call",async()=>{
 let resolutions=0,calls=0,issued=0;const hash=await argumentDigest(policy);
 const h=await fixture({resolve:async()=>++resolutions===1?{ok:true,identity_user_id:USER,credential_epoch:1,bootstrap_generation:1,policy_sha256:hash}:{ok:false},session:async workload=>{issued++;return {token:TOKEN,sessionId:USER,expiresAt:Date.now()+3600000,workload}},invalidate:()=>{},mcp:async()=>{calls++;return {status:401,body:{error:"invalid_identity"}}}});
 const r=await h.handler(request());assert.equal(r.status,403);assert.equal(calls,1);assert.equal(issued,1);
});
