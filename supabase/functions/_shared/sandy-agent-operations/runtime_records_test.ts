import assert from "node:assert/strict";
import { authenticateRuntime, bindRuntimeTask } from "./identity.ts";
import { runtimeRecordOperation } from "./runtime_records.ts";
const customerId="10000000-0000-4000-8000-000000000001",taskId="20000000-0000-4000-8000-000000000001";
async function list(rows: unknown, count: unknown) {
 const reads: {table:string;filters:Record<string,unknown>}[]=[];
 const db={from(table:string){
  const filters:Record<string,unknown>={};let head=false;
  const result=()=>{
   reads.push({table,filters});
   if(table==='sandy_agent_tasks')return {data:{id:taskId,customer_id:customerId,channel:'web',request_id:'fixture-read',status:'running',user_request:'List tasks'},error:null};
   if(table==='sandy_tasks')return {data:head?null:rows,count:head?count:null,error:null};
   return {data:[],error:null};
  };
  const q={select(_columns:string,options?:{head?:boolean}){head=options?.head===true;return q;},eq(key:string,value:unknown){filters[key]=value;return q;},is(key:string,value:unknown){filters[key]=value;return q;},not(){return q;},order(){return q;},limit(){return q;},in(){return q;},maybeSingle:async()=>result(),then(resolve:(r:unknown)=>unknown){return Promise.resolve(result()).then(resolve);}};
  return q;
 }};
 const proof=await authenticateRuntime(new Request('https://fixture.invalid',{headers:{authorization:'Bearer local-test-only'}}),db,'local-test-only');assert.ok(proof);
 const principal=await bindRuntimeTask(proof,db,{taskId,customerId,channel:'web',requestId:'fixture-read'});assert.ok(principal);
 const result=await runtimeRecordOperation(principal,'agent.runtime.tasks.list',{},db);
 for(const read of reads.filter(x=>x.table==='sandy_tasks'))assert.equal(read.filters.customer_id,customerId);
 return result;
}
const row=(id:number)=>({id:String(id),title:'Same title',status:'todo',priority:'normal',due_at:null});
Deno.test('missing exact task count never becomes zero',async()=>{
 for(const count of [null,undefined,-1,1.5,NaN,Infinity]){
  assert.deepEqual(await list([],count),{error:'runtime_task_count_unavailable'});
 }
 assert.deepEqual(await list(null,0),{error:'runtime_task_count_unavailable'});
});
Deno.test('detectable change between task list and count refuses conflicting totals',async()=>{
 for(const [rows,count] of [[[],1],[[row(1)],0],[[row(1)],2]] as const)
  assert.deepEqual(await list(rows,count),{error:'runtime_task_snapshot_changed'});
});
Deno.test('verified empty and consistent tasks preserve existing output contract',async()=>{
 const empty=await list([],0);assert.equal(empty.outstanding_count,0);assert.deepEqual(empty.tasks,[]);
 const two=await list([row(1),row(2)],2);assert.equal(two.outstanding_count,2);assert.equal(two.shown_count,2);assert.equal(two.status_breakdown.todo,2);
 assert.deepEqual(two.tasks.map((t:any)=>t.id),['1','2']);
});
Deno.test('full capped page can retain a larger verified total',async()=>{
 const result=await list(Array.from({length:150},(_,i)=>row(i)),201);
 assert.equal(result.outstanding_count,201);assert.equal(result.shown_count,150);
});
