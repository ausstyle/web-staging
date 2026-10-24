import assert from "node:assert/strict";
import {receiptModelMetrics,collectReceiptModelMetrics} from "./runtime_model_metrics.ts";
const start=Date.parse("2026-10-24T12:00:00Z"),end=start+1234;
const response={model:"fixture-dated-model",usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:200},total_tokens:1100},output:[{text:"private-user-content"}],id:"private-provider-id"};
const rate={model_name:response.model,input_usd_per_million:"2",cached_input_usd_per_million:"0.5",output_usd_per_million:"10",verified_at:"2026-10-23T00:00:00Z"};
Deno.test("model metrics use actual usage and cached exact verified rate, never billed cost or outcome proof",()=>{
 const m=receiptModelMetrics(response,start,end,rate);
 assert.equal(m.estimated_cost_usd,0.0027);assert.equal(m.request_duration_ms,1234);assert.equal(m.provider_effect_verified,false);
 assert.equal(m.cost_basis,"estimated_exact_model_verified_rate");
 assert.equal(JSON.stringify(m).includes("private"),false);
});
Deno.test("unknown model aliases and missing, future or stale rates retain unknown cost",()=>{
 for(const r of [null,{...rate,model_name:"fixture-alias"},{...rate,verified_at:"2026-10-24T12:00:00.001Z"},{...rate,verified_at:"2026-09-23T12:00:00Z"},{...rate,input_usd_per_million:"invalid"}]){
  const m=receiptModelMetrics(response,start,end,r);assert.equal(m.estimated_cost_usd,null);assert.equal(m.rate_verified_at,null);
 }
});
Deno.test("malformed usage and clock reversal cannot fabricate zero cost or duration",()=>{
 for(const usage of [null,{input_tokens:-1,output_tokens:10},{input_tokens:"100",output_tokens:1},{input_tokens:Infinity,output_tokens:1}]){
  const m=receiptModelMetrics({...response,usage},start,end,rate);assert.equal(m.usage,null);assert.equal(m.estimated_cost_usd,null);
 }
 assert.equal(receiptModelMetrics(response,end,start,rate).request_duration_ms,null);
 assert.equal(receiptModelMetrics({...response,usage:{...response.usage,input_tokens_details:{cached_tokens:2000}}},start,end,rate).estimated_cost_usd,null);
 assert.equal(receiptModelMetrics({...response,usage:{...response.usage,total_tokens:3}},start,end,rate).usage?.total_tokens,null);
});
Deno.test("rate lookup uses provider-returned model only, and unavailable lookup preserves usable receipt",async()=>{
 let calls=0;const db={from:(table:string)=>{assert.equal(table,"email_ai_model_rates");const q={select:()=>q,eq:(key:string,value:unknown)=>{assert.equal(key,"model_name");assert.equal(value,response.model);return q;},maybeSingle:async()=>{calls++;return {data:rate,error:{code:"unavailable"}};}};return q;}};
 const m=await collectReceiptModelMetrics(db,response,start,end);assert.equal(m.estimated_cost_usd,null);assert.equal(m.usage?.input_tokens,1000);assert.equal(calls,1);
 await collectReceiptModelMetrics(db,{model:"fixture",usage:null},start,end);assert.equal(calls,1);
});
