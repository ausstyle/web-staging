import { strict as assert } from "node:assert";
import { engineeringRequest, engineeringFixtureArguments, engineeringPolicy, engineeringProofFor, type EngineeringDependencies } from "./engineering_identity.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
const MACHINE="10000000-0000-4000-8000-000000000001",OWNER="10000000-0000-4000-8000-000000000002",SESSION="10000000-0000-4000-8000-000000000003",APPROVAL="10000000-0000-4000-8000-000000000004";
const user={id:MACHINE,app_metadata:{sandy_engineering_test:true,sandy_engineering_epoch:1}};
const token=(patch:Record<string,unknown>={})=>"verified-by-caller."+btoa(JSON.stringify({sub:MACHINE,aud:"authenticated",role:"authenticated",session_id:SESSION,exp:Date.now()/1000+3600,app_metadata:user.app_metadata,...patch}))+".signature";
const fileArgs={path:{path:engineeringPolicy.github_path},body:{branch:engineeringPolicy.github_branch,sha:"a".repeat(40),content:btoa("Sandy engineering fixture machine verified\n"),message:"Sandy machine fixture"}};
const msg=(operation="github.files.update",args:unknown=fileArgs)=>({action:"execute",channel:"mcp",operation,arguments:args});
const req=(body:unknown=msg(),headers:Record<string,string>={})=>new Request("https://project.invalid/functions/v1/sandy-operation-api",{method:"POST",headers:{authorization:"Bearer actual.verified.workload",...headers},body:JSON.stringify(body)});
async function harness(patch:Partial<EngineeringDependencies>={}){
 const state={rpc:[] as {name:string,args:Record<string,unknown>}[],delegated:0,proof:undefined as unknown,headers:new Headers(),resolved:{ok:true,identity_user_id:MACHINE,owner_authority_id:OWNER,session_id:SESSION,credential_epoch:1,policy_sha256:await argumentDigest(engineeringPolicy),operations:engineeringPolicy.operations}};
 const deps:EngineeringDependencies={db:{rpc:async(name,args)=>{state.rpc.push({name,args});return {data:name==="sandy_engineering_resolve_identity"?state.resolved:{ok:true,approval_id:APPROVAL},error:null}}},entry:async operation=>({operation,api_exposed:true,ai_exposed:true,verified:true,error_contract:{contract_sha256:"b".repeat(64)},input_schema:{type:"object"}}),contractMatches:()=>true,argumentsValid:()=>true,delegate:async(request,credential)=>{state.delegated++;state.proof=engineeringProofFor(credential);state.headers=request.headers;return Response.json({ok:true,result:{ok:true}})},...patch};
 return {state,call:(request=req(),claims=token())=>engineeringRequest(deps,request,user,claims)};
}
Deno.test("verified workload gets only an explicit scoped delegation with immutable exact approval headers",async()=>{
 const h=await harness(),r=await h.call();assert.equal(r.status,200);assert.equal(h.state.delegated,1);assert.deepEqual(h.state.proof,{machineUserId:MACHINE,ownerId:OWNER,sessionId:SESSION,epoch:1,policySha256:await argumentDigest(engineeringPolicy)});assert.equal(h.state.headers.get("authorization"),"Bearer actual.verified.workload");assert.equal(h.state.headers.get("x-sandy-approval-id"),APPROVAL);assert.equal(h.state.rpc[1].args.p_input_sha256,await argumentDigest(fileArgs));
});
Deno.test("serialized or caller-invented delegated credentials cannot carry trusted proof",()=>{assert.equal(engineeringProofFor({kind:"job_lease",principalId:OWNER,allowedOperations:engineeringPolicy.operations}),undefined)});
Deno.test("wrong-subject, expired, stale-epoch and invalid-role claims fail before policy or provider execution",async()=>{
 for(const claims of [{sub:OWNER},{exp:0},{role:"service_role"},{aud:"service_role"},{session_id:"bad"},{app_metadata:{sandy_engineering_test:true,sandy_engineering_epoch:2}}]){const h=await harness();assert.equal((await h.call(req(),token(claims))).status,401);assert.equal(h.state.rpc.length,0);assert.equal(h.state.delegated,0)}
});
Deno.test("revoked, different-policy and unauthorized owner authorities cannot be used",async()=>{
 for(const patch of [{ok:false},{owner_authority_id:null},{policy_sha256:"wrong"},{identity_user_id:OWNER},{session_id:OWNER},{operations:["supabase.projects.delete"]}]){const h=await harness();Object.assign(h.state.resolved,patch);assert.equal((await h.call()).status,403);assert.equal(h.state.delegated,0)}
});
Deno.test("credential administration, Controller approval and unrelated provider operations are outside the workload grant",async()=>{
 for(const operation of ["engineering.job.approve","system.credentials.issue","supabase.projects.delete","gcp.compute.instances.delete"]){const h=await harness();assert.equal((await h.call(req(msg(operation,{})))).status,403);assert.equal(h.state.rpc.length,1);assert.equal(h.state.delegated,0)}
});
Deno.test("production branch, other files, arbitrary SQL, other secrets and unreviewed function source are denied",()=>{
 const checks:[string,unknown][]=[
 ["github.files.update",{...fileArgs,body:{...fileArgs.body,branch:"main"}}],
 ["github.files.update",{...fileArgs,path:{path:"supabase/functions/sandy-operation-api/index.ts"}}],
 ["supabase.db.migrations.apply",{body:{query:"DROP TABLE public.email_customers;"}}],
 ["supabase.functions.secrets.set",{body:[{name:"SANDY_SUPABASE_MANAGEMENT_TOKEN",value:"isolated-noncredential-test"}]}],
 ["supabase.deploy_edge_function",{project_id:engineeringPolicy.project_ref,slug:engineeringPolicy.function_slug,name:engineeringPolicy.function_slug,verify_jwt:true,entrypoint_path:"index.ts",files:[{path:"index.ts",sha256:"f".repeat(64)}]}],
 ["supabase.logs.query",{source:"auth_logs",start:"2026-10-21T00:00:00Z",end:"2026-10-21T00:01:00Z"}],
 ];for(const [operation,args] of checks)assert.equal(engineeringFixtureArguments(operation,args),false,operation);
});
Deno.test("fixed reversible migration, reviewed deploy sources and noncredential test secret are permitted",()=>{
 for(const query of engineeringPolicy.migration_queries)assert.equal(engineeringFixtureArguments("supabase.db.migrations.apply",{body:{query}}),true);
 assert.equal(engineeringFixtureArguments("supabase.functions.secrets.set",{body:[{name:engineeringPolicy.secret_name,value:"isolated-noncredential-machine-test"}]}),true);
 for(const sha256 of engineeringPolicy.function_source_sha256)assert.equal(engineeringFixtureArguments("supabase.deploy_edge_function",{project_id:engineeringPolicy.project_ref,slug:engineeringPolicy.function_slug,name:engineeringPolicy.function_slug,verify_jwt:true,entrypoint_path:"index.ts",files:[{path:"index.ts",sha256}]}),true);
});
Deno.test("invalid schema, paid declarations and API-key substitution do not prepare or execute a mutation",async()=>{
 const h=await harness({argumentsValid:()=>false});assert.equal((await h.call()).status,403);assert.equal(h.state.rpc.length,1);
 for(const headers of [{"x-sandy-declared-units":"1"},{"x-sandy-api-key":"opaque"}] as Record<string,string>[]){const h=await harness();assert.equal((await h.call(req(msg(),headers))).status,403);assert.equal(h.state.delegated,0)}
});
Deno.test("machine log result is restricted to exact pinned console markers",async()=>{
 const h=await harness({delegate:async()=>Response.json({ok:true,result:{ok:true,truncated:true,result:{entries:[{message:engineeringPolicy.function_console_markers[0]+"\n",timestamp:"2026-10-21T00:00:00Z"},{message:"other customer secret",timestamp:"2026-10-21T00:00:00Z"}],next_query_before:"private-project-activity"}}})});
 const r=await h.call(req(msg("supabase.logs.query",{source:"function_logs",start:"2026-10-21T00:00:00Z",end:"2026-10-21T00:01:00Z"}))),v=await r.json();assert.equal(v.result.result.entries.length,1);assert.equal(v.result.result.next_query_before,null);assert.equal(v.result.truncated,false);assert.equal(JSON.stringify(v).includes("other customer secret"),false);
});
Deno.test("discovery delegates only the bounded catalogue and never prepares a provider write",async()=>{
 const h=await harness();assert.equal((await h.call(req({action:"list",channel:"mcp"}))).status,200);assert.equal(h.state.rpc.length,1);assert.equal(h.state.delegated,1);
});
