import { strict as assert } from "node:assert";
import { createEngineeringSessionProvider, type EngineeringAuth, type SessionDependencies } from "./sandy_engineering_session.ts";
const USER="10000000-0000-4000-8000-000000000001";
function fixture(overrides: Partial<SessionDependencies> = {}) {
 const state={now:Date.parse("2026-10-21T12:00:00Z"),epoch:1,issued:0,registered:0,retired:0,signedOut:0,serverError:false,userPatch:{} as Record<string,unknown>,claimPatch:{} as Record<string,unknown>,register:true,retire:true};
 const auth: EngineeringAuth={admin:{generateLink:async()=>{state.issued++;return {data:{properties:{hashed_token:"synthetic-otp"}},error:null}},signOut:async()=>{state.signedOut++;return {error:null}}},verifyOtp:async()=>{
  const claims={sub:USER,aud:"authenticated",role:"authenticated",session_id:`10000000-0000-4000-8000-${String(state.issued).padStart(12,"0")}`,exp:state.now/1000+3600,app_metadata:{sandy_engineering_test:true,sandy_engineering_epoch:state.epoch},...state.claimPatch};
  return {data:{session:{access_token:"synthetic."+btoa(JSON.stringify(claims))+".signature"}},error:null};
 },getUser:async()=>({data:{user:{id:USER,email:"sandy-engineering-test@sandy-ai.internal",role:"authenticated",is_anonymous:false,app_metadata:{sandy_engineering_test:true,sandy_engineering_epoch:state.epoch},...state.userPatch}},error:state.serverError?{}:null})};
 const provider=createEngineeringSessionProvider({auth:()=>auth,now:()=>state.now,register:async()=>{state.registered++;return state.register},retire:async()=>{state.retired++;return state.retire},...overrides});
 return {state,provider,workload:()=>({userId:USER,epoch:state.epoch,bootstrapGeneration:1})};
}
Deno.test("normal Auth session is verified before registration and cached only before expiry",async()=>{
 const h=fixture(),a=await h.provider.get(h.workload()),b=await h.provider.get(h.workload());assert.equal(a,b);assert.equal(h.state.issued,1);assert.equal(h.state.registered,1);assert.equal(a.expiresAt,h.state.now+3600000);
});
Deno.test("expiry automatically issues and verifies a fresh Auth session and retires the previous proof",async()=>{
 const h=fixture(),a=await h.provider.get(h.workload());h.state.now=a.expiresAt-30000;const b=await h.provider.get(h.workload());assert.notEqual(a.sessionId,b.sessionId);assert.equal(h.state.issued,2);assert.equal(h.state.retired,1);assert.equal(h.state.signedOut,1);assert.ok(b.expiresAt>h.state.now);
});
Deno.test("concurrent renewal is single flight within a runtime isolate",async()=>{
 const h=fixture(),results=await Promise.all(Array.from({length:12},()=>h.provider.get(h.workload())));assert.equal(h.state.issued,1);assert.equal(new Set(results.map(x=>x.sessionId)).size,1);
});
Deno.test("credential epoch and bootstrap generation rotation invalidate the cached session",async()=>{
 const h=fixture(),a=await h.provider.get(h.workload());h.state.epoch=2;const b=await h.provider.get(h.workload());assert.notEqual(a.sessionId,b.sessionId);const c=await h.provider.get({...h.workload(),bootstrapGeneration:2});assert.notEqual(b.sessionId,c.sessionId);assert.equal(h.state.retired,2);
});
Deno.test("Auth server denial cannot become a workload identity",async()=>{
 const h=fixture();h.state.serverError=true;await assert.rejects(()=>h.provider.get(h.workload()),/engineering_auth_identity_invalid/);assert.equal(h.state.registered,0);
});
Deno.test("human, foreign, anonymous and untagged users cannot be substituted for the dedicated workload",async()=>{
 for(const patch of [{id:"20000000-0000-4000-8000-000000000001"},{email:"human@example.invalid"},{role:"service_role"},{is_anonymous:true},{app_metadata:{}},{app_metadata:{sandy_engineering_test:true,sandy_engineering_epoch:2}}]){
  const h=fixture();h.state.userPatch=patch;await assert.rejects(()=>h.provider.get(h.workload()),/engineering_auth_identity_invalid/);assert.equal(h.state.registered,0);
 }
});
Deno.test("expired, overlong, wrong-subject and wrong-audience claims are rejected after server verification",async()=>{
 for(const patch of [{exp:0},{exp:Date.parse("2030-01-01")/1000},{sub:"foreign"},{aud:"service_role"},{session_id:"bad"},{role:"service_role"},{app_metadata:{sandy_engineering_test:true,sandy_engineering_epoch:2}}]){
  const h=fixture();h.state.claimPatch=patch;await assert.rejects(()=>h.provider.get(h.workload()),/engineering_auth_claims_invalid/);assert.equal(h.state.registered,0);
 }
});
Deno.test("revoked or unauthorized registration fails closed without returning a usable token",async()=>{
 const h=fixture();h.state.register=false;await assert.rejects(()=>h.provider.get(h.workload()),/engineering_auth_registration_denied/);
});
Deno.test("retirement uncertainty prevents a successful renewal claim",async()=>{
 const h=fixture();await h.provider.get(h.workload());h.provider.invalidate();h.state.retire=false;await assert.rejects(()=>h.provider.get(h.workload()),/engineering_auth_retirement_failed/);
});
Deno.test("invalid workload scope never calls Auth administration",async()=>{
 const h=fixture();for(const scope of [{...h.workload(),epoch:0},{...h.workload(),userId:"foreign"},{...h.workload(),bootstrapGeneration:0}])await assert.rejects(()=>h.provider.get(scope),/engineering_workload_invalid/);assert.equal(h.state.issued,0);
});

Deno.test("distributed issuer lease is acquired before Auth and always released",async()=>{
 let attempts=0,pauses=0,releases=0;
 const h=fixture({acquire:async()=>++attempts<3?null:"lease-proof",pause:async()=>{pauses++},release:async()=>{releases++}});
 await h.provider.get(h.workload());assert.equal(attempts,3);assert.equal(pauses,2);assert.equal(releases,1);assert.equal(h.state.issued,1);
});
Deno.test("busy distributed issuer never mints or registers an overlapping OTP",async()=>{
 const h=fixture({acquire:async()=>null,pause:async()=>{}});await assert.rejects(()=>h.provider.get(h.workload()),/engineering_auth_issue_busy/);assert.equal(h.state.issued,0);assert.equal(h.state.registered,0);
});
