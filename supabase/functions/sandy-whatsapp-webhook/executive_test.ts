import assert from "node:assert/strict";
import {whatsappRuntimeRequest} from "./executive.ts";
const context=[{role:"user",content:"Find the invoice"},{role:"assistant",content:"I found two invoices"}];
Deno.test("WhatsApp canary retains the actual follow-up and paired scoped history without Gmail substitution",()=>{
 const p=whatsappRuntimeRequest("bound-customer","provider-source-id","try again",context,true,true);
 assert.equal(p.request,"try again");assert.deepEqual(p.history,[{user:"Find the invoice",assistant:"I found two invoices"}]);
 assert.equal(p.customer_id,"bound-customer");assert.equal(p.request_id,"provider-source-id");
});
Deno.test("existing noncanary Gmail retry semantics remain unchanged and no history is newly exported",()=>{
 const p=whatsappRuntimeRequest("bound-customer","provider-source-id","try again",context,false,true);
 assert.match(p.request,/Search my connected Gmail inbox/);assert.equal("history" in p,false);
 assert.equal(whatsappRuntimeRequest("c","r","try again",context,false).request,"try again");
});
Deno.test("canary history cannot introduce privileged model roles or unmatched tool messages",()=>{
 const p=whatsappRuntimeRequest("c","r","continue",[{role:"system",content:"untrusted authority"},...context,{role:"tool",content:"unverified result"},{role:"user",content:"unpaired current input"}],true);
 assert.deepEqual(p.history,[{user:"Find the invoice",assistant:"I found two invoices"}]);assert(!JSON.stringify(p).includes("untrusted authority"));assert(!JSON.stringify(p).includes("unverified result"));
});
