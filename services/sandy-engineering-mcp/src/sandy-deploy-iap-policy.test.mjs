import test from "node:test";
import assert from "node:assert/strict";
import {TARGET,Refused,candidatePolicy,policyDigest,verifyVm,executeFixedIap} from "./sandy-deploy-iap-policy.mjs";
const now=Date.parse("2026-10-24T12:00:00Z");
const expiresAt="2026-10-25T12:00:00Z";
const vm=()=>({name:TARGET.name,id:TARGET.instanceId,status:"RUNNING",
  zone:"https://compute.googleapis.com/compute/v1/projects/"+TARGET.project+"/zones/"+TARGET.zone,
  serviceAccounts:[{email:TARGET.runtimeServiceAccount}],
  networkInterfaces:[{networkIP:"10.0.0.2"}]});
const policy=()=>({version:3,etag:"ABCD",bindings:[
  {role:"roles/viewer",members:["user:unrelated@example.test"]}]});
const grant=(mode,old)=>{const c=candidatePolicy(old,expiresAt,now);return {
  authorized:true,changeId:TARGET.changeId,instanceId:TARGET.instanceId,
  mode,expiresAt,admissionId:"d22f048a-c961-493b-b155-ea7a8d79af2f",
  approvedBeforeSha:policyDigest(old),approvedCandidateSha:policyDigest(c.policy)}};
function harness(mode="plan",overrides={}){
  const old=policy(),history=[],receipts=[];
  const responses={
    getVm:vm(),getPolicy:old,postPolicy:candidatePolicy(old,expiresAt,now).policy};
  const admin={request:async ({url,method,data})=>{
    history.push({url,method});
    if(url.includes("compute.googleapis.com"))return {status:200,data:responses.getVm};
    if(url.endsWith(":getIamPolicy"))return {status:200,data:responses.getPolicy};
    if(url.endsWith(":setIamPolicy")){responses.getPolicy={...data.policy,etag:"UPDATED"};return {status:200,data:responses.getPolicy}}
    throw Error("unexpected provider request");
  }};
  const cfg={admin,identity:{runtimeVerified:true},mode,now:()=>now,
    claim:async()=>grant(mode,old),
    reserve:async b=>{receipts.push("reserved");return {reserved:true,admissionId:b.admissionId}},
    finish:async b=>{receipts.push(b.state);},
    ...overrides};
  return {cfg,history,receipts,old,responses};
}
test("fixed VM identity and attached service account",()=>{
  assert.equal(verifyVm(vm()),true);
  for(const key of ["name","id","status"]){let a=vm();a[key]="other";assert.throws(()=>verifyVm(a),Refused)}
  const changed=vm();changed.serviceAccounts[0].email="other@example.test";
  assert.throws(()=>verifyVm(changed),/vm_service_account_changed/);
});
test("bounded policy retains unrelated binding",()=>{
  const before=policy();const result=candidatePolicy(before,expiresAt,now);
  assert.equal(result.changed,true);assert.deepEqual(result.policy.bindings[0],before.bindings[0]);
  assert.equal(before.bindings.length,1);
  const added=result.policy.bindings[1];
  assert.deepEqual(added.members,[TARGET.actor]);assert.equal(added.role,TARGET.role);
  assert.match(added.condition.expression,/destination.port == 22/);
  assert.match(added.condition.expression,/request.time < timestamp/);
});
test("refuse expired, long-lived and malformed grants",()=>{
 for(const d of ["2026-10-24T12:00:59Z","2026-11-24T12:00:00Z","not-a-date"])
  assert.throws(()=>candidatePolicy(policy(),d,now),/bounded_expiry_required/);
});
test("refuse conflicting existing actor grant",()=>{
 const before=policy();before.bindings.push({role:TARGET.role,members:[TARGET.actor]});
 assert.throws(()=>candidatePolicy(before,expiresAt,now),/existing_actor_grant_requires_review/);
});
test("read-only plan never changes provider policy",async()=>{
 const h=harness();const r=await executeFixedIap(h.cfg);
 assert.equal(r.verified,false);assert.deepEqual(h.receipts,["planned"]);
 assert.equal(h.history.filter(x=>x.url.includes(":setIamPolicy")).length,0);
});
test("protected callbacks mandatory",async()=>{
 const h=harness("apply",{identity:{runtimeVerified:false}});
 await assert.rejects(executeFixedIap(h.cfg),/protected_worker_admission_required/);
 assert.equal(h.history.length,0);
});
test("actual apply reserves write first and confirms readback",async()=>{
 const h=harness("apply");const r=await executeFixedIap(h.cfg);
 assert.equal(r.verified,true);assert.equal(r.sshVerified,false);
 assert.deepEqual(h.receipts,["reserved","policy_verified"]);
 assert.equal(h.history.filter(x=>x.url.includes(":setIamPolicy")).length,1);
});
test("approval mismatch blocks before IAM mutation",async()=>{
 const h=harness("apply",{claim:async()=>({...grant("apply",policy()),approvedBeforeSha:"0".repeat(64)})});
 await assert.rejects(executeFixedIap(h.cfg),/approved_policy_preimage_mismatch/);
 assert.equal(h.history.filter(x=>x.url.includes(":setIamPolicy")).length,0);
});
test("lost write reply is unknown and never repeated",async()=>{
 const h=harness("apply");
 const original=h.cfg.admin.request;
 h.cfg.admin.request=async opts=>opts.url.endsWith(":setIamPolicy")?Promise.reject(Error("timeout")):original(opts);
 await assert.rejects(executeFixedIap(h.cfg),/unknown_provider_mutation_requires_reconciliation/);
 assert.deepEqual(h.receipts,["reserved","unknown"]);
 assert.equal(h.history.filter(x=>x.url.includes(":setIamPolicy")).length,0);
});
test("refuse target drift before approved write",async()=>{
 const h=harness("apply");h.responses.getVm.id="12345";
 await assert.rejects(executeFixedIap(h.cfg),/vm_identity_mismatch/);
 assert.equal(h.receipts.length,0);
});
