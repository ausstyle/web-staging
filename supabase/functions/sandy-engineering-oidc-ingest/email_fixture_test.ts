import assert from "node:assert/strict";
import {invokeEmailShadowFixture} from "./email_fixture.ts";
const fixture={source_message_id:"10000000-0000-4000-8000-000000000001",customer_id:"20000000-0000-4000-8000-000000000001"};
const resolve=async()=>fixture;
Deno.test("trusted email bridge uses only fixed internal route/runtime secret and sanitizes result",async()=>{
 const result=await invokeEmailShadowFixture({},"fixture-private-key",async(url,init)=>{
  assert.equal(url,"https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-email-runtime-canary");
  assert.deepEqual(JSON.parse(String(init?.body)),{source_message_id:fixture.source_message_id});
  assert.equal(new Headers(init?.headers).get("authorization"),"Bearer fixture-private-key");
  assert.equal(init?.redirect,"error");
  return Response.json({ok:true,source_message_id:fixture.source_message_id,sent:false,status:"candidate_ready",candidate_ready:true,private_content:"secret"});
 },resolve);
 assert.equal(result.body.ok,true);assert.equal(result.body.sent,false);
 assert.equal(JSON.stringify(result).includes("secret"),false);assert.equal(JSON.stringify(result).includes("fixture-private-key"),false);
});
Deno.test("private email transport unknown outcome is not retried or called completed",async()=>{
 let calls=0;const result=await invokeEmailShadowFixture({},"fixture-private-key",()=>{calls++;throw Error("secret-network-detail");},resolve);
 assert.equal(calls,1);assert.equal(result.body.ok,false);assert.equal(result.body.reconciliation_required,true);
 assert.equal(JSON.stringify(result).includes("secret-network-detail"),false);
});
Deno.test("email sent claims or incorrect source cannot pass fixed no-send acceptance",async()=>{
 for(const patch of [{sent:true},{source_message_id:fixture.customer_id},{ok:false}]){
  const result=await invokeEmailShadowFixture({},"fixture-private-key",async()=>Response.json({ok:true,source_message_id:fixture.source_message_id,sent:false,status:"candidate_ready",candidate_ready:true,...patch}),resolve);
  assert.equal(result.body.ok,false);
 }
});
