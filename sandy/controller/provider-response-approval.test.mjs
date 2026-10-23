import assert from 'node:assert/strict';
import {RELEASE,verifyReleaseChange,createReleaseApproval,releaseApprovalFor} from './provider-response-approval.mjs';
const request={"title":"One-off protected provider-executor release for PR222","problem":"The completed deployment-status response fix is not covered by the existing standing workload grant or runtime-only release target list. A genuine Owner-scoped exception is needed for this single existing function.","expected_behavior":"Release sandy-provider-operation-api from version 30, prior bundle 896a964ff35577f62e6d49c590ce1d2262bddda3eb24d39f3bc59aaf13941480, using source 53556941f600c7ec625067a74d37bbcffa8bd400 and exact release manifest b72099a290d0e69ec09aba33fc1f8ab2159de6985e9ae292c6626a1c9e42dc40. Execute only through the reviewed protected provider-response workflow with independent CI, exact source guards, lease, durable dispatch intent, private rollback artifact and post-deployment source verification. Permit bounded rollback to the captured original source; no standing grant change.","change_purpose":"Deploy the tested response correction needed to complete the failed SANDY-ENG-0001 GitHub deployment-status acceptance case.","feature_improvement":"Accept an empty optional environment URL while preserving all other deployed modules, credential and authentication behavior.","scope":["github:ausstyle/web-staging:engineering/api-log-acceptance-20261023","sandy-provider-operation-api"],"risk":"normal","idempotency_key":"owner-provider-response-b72099a290d0e69ec09aba33","acceptance_criteria":["Genuine current Controller Owner approval and matching Owner audit reason include source and release manifest pins.","Protected runner changes only the reviewed entrypoint and preserves all other modules and JWT configuration.","Rerun only the previously failed GitHub deployment-status case, with independent provider readback and negative verification."],"regression_rules":["No workload authority expansion, Owner impersonation, direct approval-status writes, IAM changes or production traffic changes.","No new candidate, customer record changes, credentials or changes to communications/memory.","Unknown upload outcomes require read-only source reconciliation; rollback material stays private."]};
const owner='10000000-0000-4000-8000-000000000001';
function fixture() {
 let account=owner;const calls=[],current={change:{...structuredClone(request),id:RELEASE.change,status:'proposed'},events:[]};
 const transport={session:async()=>({user:{id:account}}),engineering:async body=>{
  calls.push(body);if(body.action==='get')return structuredClone(current);
  if(body.action==='status'){
   current.change.status='approved';current.events.push({change_id:RELEASE.change,event_type:'status_changed',actor:owner,detail:{to:'approved',reason:body.reason}});
   return {change:{id:RELEASE.change,status:'approved'}};
  }throw Error('unexpected action');
 }};
 return {calls,current,transport,switchAccount:()=>{account='different-account';}};
}
Deno.test('exact registered request approves only through the normal session and verifies its Owner audit',async()=>{
 const f=fixture(),action=createReleaseApproval(f.transport);await action.inspect();const out=await action.approve();
 assert.equal(out.matching_owner_audit_verified,true);assert.equal(out.deployment_started,false);
 assert.equal(f.calls.filter(x=>x.action==='status').length,1);assert.ok(f.calls.every(x=>['get','status'].includes(x.action)));
 const mutation=f.calls.find(x=>x.action==='status');assert.equal(mutation.change_id,RELEASE.change);assert.ok(mutation.reason.includes(RELEASE.source)&&mutation.reason.includes(RELEASE.manifest));
});
Deno.test('all pinned request fields reject drift before approval dispatch',async()=>{
 for(const k of Object.keys(request)){const f=fixture();f.current.change[k]=Array.isArray(request[k])?['changed']:'changed';await assert.rejects(createReleaseApproval(f.transport).approve());assert.equal(f.calls.filter(x=>x.action==='status').length,0);}
});
Deno.test('the source-only change cannot be used as release authorisation',async()=>{
 const f=fixture();f.current.change.id='78e9b7a1-1726-47cd-986d-b2944e08da1a';await assert.rejects(createReleaseApproval(f.transport).approve());assert.equal(f.calls.filter(x=>x.action==='status').length,0);
});
Deno.test('an account change after review prevents Owner mutation',async()=>{
 const f=fixture(),a=createReleaseApproval(f.transport);await a.inspect();f.switchAccount();await assert.rejects(a.approve(),/account changed/);assert.equal(f.calls.filter(x=>x.action==='status').length,0);
});
Deno.test('an approved status without the matching real Owner audit is not accepted or replayed',async()=>{
 const f=fixture(),a=createReleaseApproval(f.transport);f.current.change.status='approved';f.current.events=[{change_id:RELEASE.change,event_type:'status_changed',actor:'workload',detail:{to:'approved',reason:RELEASE.source+RELEASE.manifest}}];
 assert.equal((await a.inspect()).matching_owner_audit_verified,false);await assert.rejects(a.approve());assert.equal(f.calls.filter(x=>x.action==='status').length,0);
});
Deno.test('a previously verified Owner approval is read without a second mutation',async()=>{
 const f=fixture(),a=createReleaseApproval(f.transport);await a.approve();const out=await a.approve();assert.equal(out.reused,true);assert.equal(f.calls.filter(x=>x.action==='status').length,1);
});
Deno.test('uncertain mutation reply never causes an automatic or duplicate approval dispatch',async()=>{
 const f=fixture(),send=f.transport.engineering;let count=0;f.transport.engineering=async body=>{if(body.action==='status'){count++;throw Error('uncertain transport outcome');}return send(body);};
 const a=createReleaseApproval(f.transport);await assert.rejects(a.approve());await a.inspect();assert.equal(a.canDispatch(),false);await assert.rejects(a.approve(),/uncertain/);assert.equal(count,1);
});
Deno.test('concurrent approval clicks dispatch at most once',async()=>{
 const f=fixture(),a=createReleaseApproval(f.transport);const outcomes=await Promise.allSettled([a.approve(),a.approve()]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.calls.filter(x=>x.action==='status').length,1);
});

Deno.test('Controller rerenders retain the same no-replay state after an uncertain mutation',async()=>{
 const f=fixture(),send=f.transport.engineering;let count=0;f.transport.engineering=async body=>{if(body.action==='status'){count++;throw Error('uncertain');}return send(body);};
 await assert.rejects(releaseApprovalFor(f.transport).approve());await assert.rejects(releaseApprovalFor(f.transport).approve(),/uncertain/);assert.equal(count,1);
});
