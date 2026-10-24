import assert from "node:assert/strict";
import { completedWorkerModelPayload } from "./worker_model_result.ts";
const payload={id:"resp_bounded_fixture",status:"completed",error:null,incomplete_details:null,output:[{type:"message",content:[{type:"output_text",text:"A plausible draft is not independent effect evidence."}]}]};
Deno.test("worker envelope accepts an actual completed model response without declaring domain success",()=>{
 assert.equal(completedWorkerModelPayload(payload),true);
 assert.equal(completedWorkerModelPayload({...payload,output:[]}),true);
});
Deno.test("plausible text under every nonterminal, cancelled, missing or unknown status is refused",()=>{
 for(const status of ["queued","in_progress","cancelled","incomplete","failed","new_provider_state",null,undefined,8])assert.equal(completedWorkerModelPayload({...payload,status}),false,String(status));
});
Deno.test("contradictory error/incomplete details and malformed result identities cannot attest model completion",()=>{
 for(const invalid of [{...payload,error:{message:"provider diagnostic"}},{...payload,incomplete_details:{reason:"max_output_tokens"}},{...payload,id:" "},{...payload,id:"x".repeat(513)},{...payload,output:[null]},{...payload,output:["plausible text"]},{...payload,output:Array.from({length:201},()=>({}))},null,[]])assert.equal(completedWorkerModelPayload(invalid),false);
});
