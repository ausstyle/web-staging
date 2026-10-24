/** Synthetic normal-Auth transport fixtures, not real Auth/provider evidence. */
import assert from "node:assert/strict";
import {Buffer} from "node:buffer";
import {handleVoiceContextSession} from "./context_session.ts";
const user="21000000-0000-4000-8000-000000000001",requestId="22000000-0000-4000-8000-000000000001",sid="23000000-0000-4000-8000-000000000001",receipt="24000000-0000-4000-8000-000000000001";
const jwt="fixture-normal-auth-"+"x".repeat(200);
function fixture(){
 const calls:any[]=[],now=Date.now(),state:any={user:{id:user,role:"authenticated",email:"isolated@example.invalid",email_confirmed_at:"2026-10-20T00:00:00Z"},error:null,authError:null};
 const db={auth:{getUser:async(token:string)=>{calls.push({kind:"verify",token});return{data:{user:state.user},error:state.authError};}},rpc:async(name:string,args:unknown)=>{calls.push({kind:"rpc",name,args});return{data:{ok:true,session_id:sid,receipt_id:receipt,purpose:"context_only",state:name.endsWith("issue")?"starting":"ended",media_connected:false,provider_operations:0,reused:false,...(name.endsWith("issue")?{token:"a".repeat(64),expires_at:new Date(now+300000).toISOString()}:{})},error:state.error};}};
 const deps={base:"https://fixture.invalid",anonKey:"fixture-public-anon",now:()=>now,createClient:(_base:string,key:string,options:any)=>{assert.equal(key,"fixture-public-anon");assert.equal(options.global.headers.Authorization,"Bearer "+jwt);assert.equal(options.auth.persistSession,false);return db;}};
 const invoke=(path:string,body:any,headers:Record<string,string>={authorization:"Bearer "+jwt})=>handleVoiceContextSession(new Request("https://fixture.invalid"+path,{method:"POST",headers,body:JSON.stringify(body)}),deps);
 return{calls,state,deps,db,invoke};
}
Deno.test("normal voice context issuance and retirement use the actual customer bearer and expose no media authority",async()=>{
 const f=fixture(),issued=await f.invoke("/context/session",{request_id:requestId}),body=await issued.json();
 assert.equal(issued.status,200);assert.equal(body.purpose,"context_only");assert.equal(body.media_connected,false);assert.equal(body.provider_operations,0);assert.equal(issued.headers.get("cache-control"),"no-store, private");
 assert.deepEqual(f.calls.at(-1),{kind:"rpc",name:"sandy_voice_context_session_issue",args:{p_request_id:requestId}});
 const retired=await f.invoke("/context/retire",{session_id:sid}),ended=await retired.json();assert.equal(retired.status,200);assert.equal(ended.state,"ended");assert(!("token"in ended));
 assert.deepEqual(f.calls.at(-1),{kind:"rpc",name:"sandy_voice_context_session_retire",args:{p_session_id:sid}});
});
Deno.test("unverified, expired and administrative identities cannot issue context credentials",async()=>{
 for(const change of [{user:null},{user:{id:user,role:"service_role",email:"private",email_confirmed_at:"now"}},{user:{id:user,role:"authenticated",email:"private",email_confirmed_at:null}},{authError:{message:"private expired bearer"}}]){
  const f=fixture();Object.assign(f.state,change);const response=await f.invoke("/context/session",{request_id:requestId});assert([401,403].includes(response.status));assert.equal(f.calls.filter(c=>c.kind==="rpc").length,0);assert(!JSON.stringify(await response.json()).includes("private"));
 }
});
Deno.test("caller customer selectors, foreign origins and unavailable authorization fail closed with sanitized errors",async()=>{
 const f=fixture();assert.equal((await f.invoke("/context/session",{request_id:requestId,customer_id:user})).status,400);
 const count=f.calls.length;assert.equal((await f.invoke("/context/session",{request_id:requestId},{authorization:"Bearer "+jwt,origin:"https://foreign.invalid"})).status,403);assert.equal(f.calls.length,count);
 for(const [code,status]of [["42501",403],["23505",409],["54000",429],["P0001",503]]as const){f.state.error={code,message:"private secret details"};const response=await f.invoke("/context/session",{request_id:requestId});assert.equal(response.status,status);assert(!JSON.stringify(await response.json()).includes("secret"));}
});
Deno.test("approved browser SDK preflight accepts transport headers while foreign origins remain denied",async()=>{
 const f=fixture(),headers={origin:"https://ausstyle.github.io","access-control-request-method":"POST","access-control-request-headers":"authorization,apikey,x-client-info,content-type"};
 const allowed=await handleVoiceContextSession(new Request("https://fixture.invalid/context/session",{method:"OPTIONS",headers}),f.deps);
 assert.equal(allowed.status,204);assert.equal(allowed.headers.get("access-control-allow-origin"),headers.origin);
 const permitted=allowed.headers.get("access-control-allow-headers")!.split(",");for(const key of ["authorization","apikey","x-client-info","content-type"])assert(permitted.includes(key));
 const denied=await handleVoiceContextSession(new Request("https://fixture.invalid/context/session",{method:"OPTIONS",headers:{...headers,origin:"https://foreign.invalid"}}),f.deps);
 assert.equal(denied.status,403);assert.equal(denied.headers.get("access-control-allow-origin"),null);assert.deepEqual(f.calls,[]);
 // A public apikey is transport configuration, never customer authentication.
 const noBearer=await f.invoke("/context/session",{request_id:requestId},{apikey:"fixture-public-anon",origin:headers.origin});assert.equal(noBearer.status,401);assert.deepEqual(f.calls,[]);
});
Deno.test("actual voice-call adapter fences context-only capabilities from every legacy provider, media and tool route",async()=>{
 const source=await Deno.readTextFile(new URL("./index.ts",import.meta.url));const f=fixture();let providerRequests=0,handler:any;
 const query:any={select:()=>query,eq:()=>query,gt:()=>query,is:()=>query,maybeSingle:async()=>({data:{id:requestId,owner_customer_id:user,purpose:"context_only"},error:null})};
 const context:any={handle:handleVoiceContextSession,env:{get:(name:string)=>({SUPABASE_URL:"https://fixture.invalid",SUPABASE_SERVICE_ROLE_KEY:"fixture-private-runtime",SUPABASE_ANON_KEY:"fixture-public-anon",OPENAI_API_KEY:"fixture-private-provider"}as any)[name]},serve:(fn:any)=>handler=fn,createClient:(_base:string,key:string,options:any)=>key==="fixture-public-anon"?f.deps.createClient(_base,key,options):{from:()=>query},fetch:()=>{providerRequests++;throw Error("unexpected provider request");}};
 (globalThis as any).__voiceIssueFixture=context;
 try{
  const candidate=source.replace('import {handleVoiceContextSession} from "./context_session.ts";','const context=(globalThis as any).__voiceIssueFixture;const handleVoiceContextSession=context.handle;const Deno=context;const fetch=context.fetch;').replace('import "jsr:@supabase/functions-js/edge-runtime.d.ts";','').replace('import {createClient} from "npm:@supabase/supabase-js@2";','const createClient=context.createClient;');
  await import("data:application/typescript;base64,"+Buffer.from(candidate).toString("base64")+"#"+crypto.randomUUID());
  for(const path of ["/session","/tool","/event","/validate","/diagnostics","/transcript","/auth/request","/auth/verify","/task/approve","/task/reject","/task/status"]){
   const response=await handler(new Request("https://fixture.invalid"+path,{method:"POST",body:JSON.stringify({token:"a".repeat(64)})}));assert.equal(response.status,403);assert.equal((await response.json()).error,"context_only_session_cannot_access_voice_or_provider_operations");
  }
  assert.equal(providerRequests,0);
  const response=await handler(new Request("https://fixture.invalid/context/session",{method:"POST",headers:{authorization:"Bearer "+jwt},body:JSON.stringify({request_id:requestId})}));assert.equal(response.status,200);assert.equal((await response.json()).purpose,"context_only");
  assert.equal(providerRequests,0);
 }finally{delete(globalThis as any).__voiceIssueFixture;}
});
