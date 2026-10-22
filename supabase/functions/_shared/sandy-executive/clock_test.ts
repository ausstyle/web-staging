import assert from "node:assert/strict";
import {serverClockReply} from "./clock.ts";
Deno.test("clock answer and persisted receipt share the actual server instant across timezone conversion",()=>{
 const at=new Date("2026-10-22T23:30:00.000Z");
 const italy=serverClockReply(at,"Europe/Rome");
 assert.match(italy.text,/Friday, 23 October 2026/);assert.match(italy.text,/verified at request time/);
 assert.deepEqual(italy.receipt,{tool:"system_clock",success:true,source:"server_clock",as_of:at.toISOString(),timezone:"Europe/Rome"});
 const utc=serverClockReply(at,"UTC");assert.match(utc.text,/Thursday, 22 October 2026/);assert.equal(utc.receipt.as_of,italy.receipt.as_of);
 assert.throws(()=>serverClockReply(new Date("invalid"),"UTC"));assert.throws(()=>serverClockReply(at,"untrusted instructions"));
});
