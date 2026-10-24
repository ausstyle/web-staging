import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./fixtures/hosting-owner-approval-v54.js',import.meta.url),'utf8').replace('allowed:Record<string,string[]>','allowed').replace('(t:any)','(t)');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function invoke(role,status='proposed') {
 const writes=[];let update;
 const db={from(table){const query={update(v){update=v;return query},eq(){return query},select(){return query},async maybeSingle(){writes.push({table,update});return {data:{id:'fixture-change',...update}}},async insert(v){writes.push({table,event:v});return {error:null}}};return query}};
 const f=new AsyncFunction('action','b','admin','change','db','id','user','respond','string',source);
 const result=await f('status',{status:'approved',reason:'Exact source and manifest fixture'},{role},{status,risk:'high'},db,'fixture-change',{id:'fixture-owner'},(body,status=200)=>({body,status}),(v,n)=>typeof v==='string'?v.trim().slice(0,n):'');return {result,writes};
}
test('deployed v54 handler permits real Owner high-risk proposal and records actor',async()=>{const {result,writes}=await invoke('owner');assert.equal(result.status,200);assert.equal(result.body.change.status,'approved');assert.equal(writes[1].event.actor,'fixture-owner');assert.equal(writes[1].event.event_type,'status_changed');});
test('engineering workload cannot approve',async()=>{const {result,writes}=await invoke('engineering');assert.equal(result.status,403);assert.equal(writes.length,0);});
test('invalid prior status cannot be approved',async()=>{const {result,writes}=await invoke('owner','cancelled');assert.equal(result.status,409);assert.equal(writes.length,0);});
