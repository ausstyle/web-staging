import { strict as assert } from "node:assert";
import { prepareCanonicalEngineeringRequest, sameCanonicalRequest } from "./canonical_request.ts";
const operation="supabase.functions.secrets.set", target="zmqlyygzqoidkcwdysok:"+operation;
const row={operation,handler:"sandy-provider-operation-api",is_mutation:true,error_contract:{contract_sha256:"a".repeat(64)},input_schema:{type:"object",required:["body"],properties:{body:{type:"array",items:{type:"object",required:["name","value"],properties:{name:{type:"string"},value:{type:"string"}},additionalProperties:false}}},additionalProperties:false}};
const payload={arguments:{body:[{name:"SANDY_FIXTURE",value:"never-persist-this-credential-value"}]},before_ref:"fixture-baseline",rollback_plan:"Remove the isolated fixture secret and verify its absence."};
Deno.test("owner review binds exact arguments, contract and scope without storing secret values or requiring readiness",async()=>{
 const p=await prepareCanonicalEngineeringRequest("supabase",operation,target,payload,{...row,verified:false,api_exposed:false},["supabase:"+target]);
 assert.equal(JSON.stringify(p).includes("never-persist-this-credential-value"),false);
 assert.match(p.payload.sandy_api_execution.input_sha256,/^[a-f0-9]{64}$/);
 const q=await prepareCanonicalEngineeringRequest("supabase",operation,target,{...payload,arguments:{body:[{name:"SANDY_FIXTURE",value:"changed"}]}},row,["supabase:"+target]);
 assert.notEqual(p.payload.sandy_api_execution.input_sha256,q.payload.sandy_api_execution.input_sha256);
});
Deno.test("approval preparation rejects provider, target, scope, handler, schema and rollback mismatches",async()=>{
 for(const args of [
 ["github",operation,target,payload,row,["supabase:"+target]],
 ["supabase",operation,"other-project",payload,row,["supabase:other-project"]],
 ["supabase",operation,target,payload,row,[]],
 ["supabase",operation,target,payload,{...row,handler:"unassigned"},["supabase:"+target]],
 ["supabase",operation,target,{...payload,arguments:{evil:true}},row,["supabase:"+target]],
 ["supabase",operation,target,{...payload,rollback_plan:"none"},row,["supabase:"+target]],
 ] as const) await assert.rejects(()=>prepareCanonicalEngineeringRequest(args[0],args[1],args[2],args[3],args[4],args[5]));
});
Deno.test("idempotency cannot reuse another actor, change, operation, target or execution material",()=>{
 const prior={requested_by:"owner",engineering_change_id:"change",provider:"supabase",operation,target,payload:{hash:"a"}};
 assert.equal(sameCanonicalRequest(prior,"owner","change","supabase",operation,target,{hash:"a"}),true);
 for(const changed of [{requested_by:"other"},{engineering_change_id:"other"},{provider:"github"},{operation:"other"},{target:"other"},{payload:{hash:"b"}}])assert.equal(sameCanonicalRequest({...prior,...changed},"owner","change","supabase",operation,target,{hash:"a"}),false);
});
