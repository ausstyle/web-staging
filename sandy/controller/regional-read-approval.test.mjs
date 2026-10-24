import assert from 'node:assert/strict';
import descriptor from '../../docs/sandy-api/hosting-read-owner-request.json' with {type:'json'};
import {createRegionalApproval,verifyDescriptor,regionalApprovalFor} from './regional-read-approval.mjs';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
function fixture(){
 let who=owner;const calls=[],current={change:null,events:[]};
 const transport={session:async()=>({user:{id:who}}),engineering:async body=>{
 calls.push(body);
 if(body.action==='list')return {changes:current.change?[structuredClone(current.change)]:[]};
 if(body.action==='get')return structuredClone(current);
 if(body.action==='register'){const {action,...fields}=body;current.change={...structuredClone(fields),id,status:'proposed',requested_by:owner};return {change:structuredClone(current.change)};}
 if(body.action==='status'){current.change.status='approved';current.events.push({change_id:id,actor:owner,event_type:'status_changed',occurred_at:new Date().toISOString(),detail:{to:'approved',reason:body.reason}});return {change:structuredClone(current.change)};}
 throw Error('unexpected action');}};
 return {transport,calls,current,switchAccount(){who='different';}};
}
Deno.test('inspection is read-only and explicit Owner click records the exact package and audit',async()=>{
 const f=fixture(),a=createRegionalApproval(f.transport,descriptor);await a.inspect();assert.ok(f.calls.every(c=>c.action==='list'));
 const out=await a.approve();assert.equal(out.verified,true);assert.equal(out.deployment_started,false);
 assert.deepEqual(f.calls.find(c=>c.action==='register'),descriptor.owner_route.register);
 assert.deepEqual(f.calls.find(c=>c.action==='status'),{...descriptor.owner_route.approve,change_id:id});
 assert.equal((await a.approve()).reused,true);assert.equal(f.calls.filter(c=>c.action==='status').length,1);
});
Deno.test('package drift cannot register or approve',async()=>{
 const d=structuredClone(descriptor);d.executor_sha256='f'.repeat(64);await assert.rejects(verifyDescriptor(d));
 const f=fixture();await assert.rejects(createRegionalApproval(f.transport,d).approve());assert.equal(f.calls.length,0);
});
Deno.test('existing exact proposal is reused; drift in any registered field blocks approval',async()=>{
 for(const k of Object.keys(descriptor.owner_route.register).filter(k=>k!=='action')){
  const f=fixture();await f.transport.engineering(descriptor.owner_route.register);const a=createRegionalApproval(f.transport,descriptor);await a.inspect();f.current.change[k]=['drift'];
  await assert.rejects(a.approve());assert.equal(f.calls.filter(c=>c.action==='status').length,0);
 }
 const f=fixture();await f.transport.engineering(descriptor.owner_route.register);await createRegionalApproval(f.transport,descriptor).approve();assert.equal(f.calls.filter(c=>c.action==='register').length,1);
});
Deno.test('owner account switch blocks both registration and approval',async()=>{
 const f=fixture(),a=createRegionalApproval(f.transport,descriptor);await a.inspect();f.switchAccount();await assert.rejects(a.approve(),/account changed/);assert.equal(f.calls.filter(c=>c.action==='register').length,0);
});
Deno.test('missing wrong-actor stale or incomplete audit cannot prove approval or cause replay',async()=>{
 for(const patch of [null,{actor:'workload'},{occurred_at:'2020-01-01T00:00:00Z'},{detail:{to:'approved',reason:descriptor.source_commit+descriptor.manifest_sha256}},{event_type:'owner_release_attested'}]){
  const f=fixture(),a=createRegionalApproval(f.transport,descriptor);await a.approve();
  if(patch===null)f.current.events=[];else Object.assign(f.current.events[0],patch);
  assert.equal((await a.inspect()).matching_owner_audit_verified,false);await assert.rejects(a.approve());assert.equal(f.calls.filter(c=>c.action==='status').length,1);
 }
});
Deno.test('uncertain registration or approval never retries; rerenders preserve state',async()=>{
 for(const action of ['register','status']){
  const f=fixture(),send=f.transport.engineering;let attempted=0;
  f.transport.engineering=async body=>{if(body.action===action){attempted++;throw Error('uncertain response');}return send(body);};
  await assert.rejects(regionalApprovalFor(f.transport,descriptor).approve());await assert.rejects(regionalApprovalFor(f.transport,descriptor).approve());assert.equal(attempted,1);
 }
});
Deno.test('concurrent clicks dispatch at most once and descriptor mutation is snapshotted',async()=>{
 const f=fixture(),d=structuredClone(descriptor),a=createRegionalApproval(f.transport,d);d.owner_route.approve.reason='changed';
 const results=await Promise.allSettled([a.approve(),a.approve()]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(f.calls.find(c=>c.action==='status').reason,descriptor.owner_route.approve.reason);
});
