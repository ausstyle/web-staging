import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateIapPolicy,createProtectedIapRepairWorker,policyDigest,iapRepairAudience} from '../src/iap-repair.mjs';
import {runtimeAccount} from '../src/gcp-admin-worker.mjs';
const now=Date.parse('2026-10-24T00:00:00Z'),expiry='2026-10-30T21:17:00Z';
const ids=['6831598645020395570','8120150462304566315'],names=['sandy-video','sandy-windows'];
const body={admission_id:'10000000-0000-4000-8000-000000000001',grant_id:'10000000-0000-4000-8000-000000000002',request_id:'10000000-0000-4000-8000-000000000003'};
const base={version:3,etag:'before',bindings:[{role:'roles/iap.httpsResourceAccessor',members:['group:fixture@example.invalid'],condition:{title:'existing',expression:'request.time < timestamp("2026-12-01T00:00:00Z")'}}],auditConfigs:[{service:'allServices'}]};
function fixture(mode='plan'){
 const calls=[],callbacks=[],policies=ids.map(()=>structuredClone(base));
 const grant={ok:true,admission_id:body.admission_id,mode,revision:1,scope_sha256:'a'.repeat(64),expires_at:expiry};
 let denyClaim=false,denyWrite=false,failWrite=false;
 const admin={credentials:{expiry_date:now+1800000},getAccessToken:async()=>({token:'PRIVATE_FIXTURE_TOKEN'}),request:async options=>{
  calls.push(options);const url=options.url;
  if(url.includes('compute.googleapis.com')){const name=names.find(n=>url.endsWith('/'+n));return{status:200,data:{name,id:ids[names.indexOf(name)]}};}
  const index=ids.findIndex(id=>url.includes('/'+id+':'));assert.ok(index>=0);
  if(url.endsWith(':setIamPolicy')){if(failWrite)throw Error('PRIVATE_FIXTURE_TOKEN');policies[index]={...structuredClone(options.data.policy),etag:'after'};}
  return {status:200,data:structuredClone(policies[index])};
 }};
 const request=async(_url,init)=>{const p=JSON.parse(init.body);callbacks.push(p);
  if(p.action==='gcp_iap_repair_claim')return Response.json(denyClaim?{ok:false}:grant,{status:denyClaim?403:200});
  if(p.action==='gcp_iap_repair_write_started'&&denyWrite)return Response.json({ok:false},{status:403});
  return Response.json({ok:true,admission_id:body.admission_id});
 };
 const connect=async()=>({principal:runtimeAccount,identityToken:async audience=>{assert.equal(audience,iapRepairAudience);return 'fixture-identity';},administrator:()=>admin});
 const run=async()=>{const res={status(n){this.code=n;return this;},json(v){this.value=v;return this;}};await createProtectedIapRepairWorker({connect,request,now:()=>now})({get:()=> 'Bearer fixture',body},res);return res;};
 const plans=()=>policies.map((before,i)=>{const candidate=candidateIapPolicy(before,names[i],expiry,now).policy;return {vm_name:names[i],instance_id:ids[i],expires_at:expiry,before:structuredClone(before),observed_after:{...structuredClone(candidate),etag:'after'},before_sha256:policyDigest(before),candidate_sha256:policyDigest(candidate)};});
 return {calls,callbacks,policies,grant,run,plans,denyClaim:()=>denyClaim=true,denyWrite:()=>denyWrite=true,failWrite:()=>failWrite=true};
}
test('fixed candidate preserves unrelated policy and audit, restricts port and time, and refuses existing different authority',()=>{
 const prior=structuredClone(base),out=candidateIapPolicy(base,names[0],expiry,now);assert.deepEqual(base,prior);assert.deepEqual(out.policy.bindings[0],prior.bindings[0]);assert.deepEqual(out.policy.auditConfigs,prior.auditConfigs);assert.equal(out.policy.bindings[1].condition.expression,`destination.port == 22 && request.time < timestamp("${expiry}")`);
 assert.equal(candidateIapPolicy(out.policy,names[0],expiry,now).changed,false);
 for(const b of [{...base,bindings:[{role:'roles/iap.tunnelResourceAccessor',members:['serviceAccount:sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com']}]},{...base,unexpected:true}])assert.throws(()=>candidateIapPolicy(b,names[0],expiry,now));
 assert.throws(()=>candidateIapPolicy(base,names[0],'2026-10-31T00:00:00Z',now));assert.throws(()=>candidateIapPolicy(base,names[0],'2020-01-01T00:00:00Z',now));
});
test('no independent protected claim means no Google provider request',async()=>{const f=fixture();f.denyClaim();const r=await f.run();assert.equal(r.code,403);assert.equal(f.calls.length,0);assert.equal(r.value.executed,false);});
test('plan is read-only and full custody is sent only to protected control',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.code,200);assert.equal(r.value.policy_changes,0);assert.equal(f.calls.length,4);assert.ok(f.calls.every(c=>!c.url.endsWith(':setIamPolicy')));assert.ok(!JSON.stringify(r.value).includes('group:fixture'));assert.ok(f.callbacks.find(c=>c.phase==='plan_preserved').plans[0].before);assert.ok(!JSON.stringify(r.value).includes('PRIVATE_FIXTURE_TOKEN'));
});
test('fresh revocation check precedes each mutation and prevents any set call',async()=>{
 const f=fixture('apply');f.grant.plans=f.plans();f.denyWrite();const r=await f.run();assert.equal(r.code,403);assert.ok(!f.calls.some(c=>c.url.endsWith(':setIamPolicy')));
});
test('changed preimage prevents apply; successful apply requires both independent readbacks',async()=>{
 const f=fixture('apply');f.grant.plans=f.plans();f.policies[0].etag='concurrent-change';const refused=await f.run();assert.equal(refused.value.error,'plan_or_policy_preimage_changed');assert.ok(!f.calls.some(c=>c.url.endsWith(':setIamPolicy')));
 const g=fixture('apply');g.grant.plans=g.plans();const r=await g.run();assert.equal(r.code,200);assert.equal(r.value.policy_changes,2);assert.ok(r.value.targets.every(t=>t.policy_readback_verified));assert.equal(g.calls.filter(c=>c.url.endsWith(':setIamPolicy')).length,2);assert.equal(g.callbacks.filter(c=>c.action==='gcp_iap_repair_write_started').length,2);
});
test('uncertain write is never retried or silently rolled back',async()=>{
 const f=fixture('apply');f.grant.plans=f.plans();f.failWrite();const r=await f.run();assert.equal(r.value.reconciliation_required,true);assert.equal(r.value.executed,null);assert.equal(f.calls.filter(c=>c.url.endsWith(':setIamPolicy')).length,1);assert.ok(!JSON.stringify(r.value).includes('PRIVATE_FIXTURE_TOKEN'));
});
test('rollback restores a preserved exact effect and refuses unrelated policy changes',async()=>{
 const f=fixture('rollback');f.grant.plans=f.plans();f.grant.plans.forEach((p,i)=>f.policies[i]=structuredClone(p.observed_after));const r=await f.run();assert.equal(r.code,200);assert.equal(r.value.policy_changes,2);assert.deepEqual(f.policies[0].bindings,base.bindings);
 const g=fixture('rollback');g.grant.plans=g.plans();g.grant.plans.forEach((p,i)=>g.policies[i]=structuredClone(p.observed_after));g.policies[0].bindings.push({role:'roles/viewer',members:['group:another@example.invalid']});const denied=await g.run();assert.equal(denied.value.error,'rollback_preimage_changed_requires_review');assert.ok(!g.calls.some(c=>c.url.endsWith(':setIamPolicy')));
});
