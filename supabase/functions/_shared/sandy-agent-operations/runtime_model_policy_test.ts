import assert from "node:assert/strict";
import { reviewedRuntimeRoute } from "./runtime_model_policy.ts";
const now=Date.parse("2026-10-24T10:00:00Z");
const route={enabled:true,primary_model:"gpt-5.4-mini"};
const registry={provider:"openai",eligibility:"approved",verified_at:"2026-10-24T09:00:00Z"};
Deno.test("reviewed model uses compatible approved past verification only in enabled mode",()=>{
 assert.equal(reviewedRuntimeRoute(route,registry,"enabled",now).model,route.primary_model);
 for(const mode of ["shadow","disabled","untrusted"])
  assert.equal(reviewedRuntimeRoute(route,registry,mode,now).model,null);
});
Deno.test("future, expired, missing and invalid model verification cannot enable a route",()=>{
 for(const verified_at of ["2026-10-24T10:00:00.001Z","2026-10-10T10:00:00Z","invalid",null])
  assert.equal(reviewedRuntimeRoute(route,{...registry,verified_at},"enabled",now).model,null);
 assert.equal(reviewedRuntimeRoute(route,registry,"enabled",NaN).model,null);
});
Deno.test("route cannot select another provider or unapproved model through OpenAI transport",()=>{
 for(const provider of ["anthropic","",undefined])
  assert.equal(reviewedRuntimeRoute(route,{...registry,provider},"enabled",now).model,null);
 for(const eligibility of ["candidate","revoked",null])
  assert.equal(reviewedRuntimeRoute(route,{...registry,eligibility},"enabled",now).model,null);
 for(const primary_model of ["https://example.invalid/model","gpt-test\nheader",{},null])
  assert.equal(reviewedRuntimeRoute({...route,primary_model},registry,"enabled",now).model,null);
 assert.equal(reviewedRuntimeRoute({...route,enabled:false},registry,"enabled",now).model,null);
 assert.equal(reviewedRuntimeRoute(null,registry,"enabled",now).model,null);
});
