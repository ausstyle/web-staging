import assert from "node:assert/strict";
import test from "node:test";
import {OPERATIONS,FLEET_POLICY_VERSION,FleetAccessDenied,authorizeStandingFleetOperation} from "./standing-fleet-authority.mjs";
const NOW=Date.parse("2026-10-24T13:00:00Z");
const sa="sandy-vm-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com";
const TARGET={projectId:"elaborate-haven-511518-a5",zone:"europe-west1-b",name:"sandy-deploy",instanceId:"1940793259055617677"};
function fixture(operation=OPERATIONS.ENSURE_SSH_IAP){
 const target={...TARGET};
 const delegation={schema:FLEET_POLICY_VERSION,enabled:true,revokedAt:null,
   expiryMode:"until_revoked",boundActor:"sandy-computer-authenticated",
   ownerAuthorityVerified:true,revision:1,lastPolicyVerifiedAt:NOW-500,
   allowedProjects:[TARGET.projectId],allowedOperations:Object.values(OPERATIONS),
   approvedCommandDigests:["b".repeat(64)]};
 const registry={...target,platform:"linux",enabled:true,revokedAt:null,
   managedBy:"sandy",enrolmentAttested:true,enrolmentProofSha256:"a".repeat(64),
   ownerProjectDelegated:true,attachedServiceAccount:sa,
   sshHostVerified:true,sshHostKeySha256:"SHA256:"+("A".repeat(43))};
 const compute={name:target.name,id:target.instanceId,status:"RUNNING",
   zone:"https://compute.googleapis.com/compute/v1/projects/"+target.projectId+"/zones/"+target.zone,
   serviceAccounts:[{email:sa}],observedAt:NOW-300};
 const request={operation,idempotencyKey:"test-request-abc123",port:22};
 if(operation===OPERATIONS.SSH_EXEC) Object.assign(request,{
   commandSha256:"b".repeat(64),timeoutSeconds:30});
 const trustedContext={source:"verified_sandy_api",authenticated:true,
   sessionActive:true,subject:"sandy-computer-authenticated"};
 return {trustedContext,delegation,target,registry,compute,request,now:NOW};
}
const denied=(base,alter,pattern)=>{
 const a=fixture();alter(a);assert.throws(()=>authorizeStandingFleetOperation(a),pattern);
};
test("standing authorization permits bounded owner enrolled VM without per-call human prompt",()=>{
 const ok=authorizeStandingFleetOperation(fixture());
 assert.equal(ok.allowed,true);assert.equal(ok.requiresSeparatePerTaskOwnerApproval,false);
 assert.equal(ok.requiresProviderPermission,true);assert.equal(ok.permitsUnscopedIamGrantCreation,false);
});
test("approved SSH execution retains independent host pin and command digest",()=>{
 const ok=authorizeStandingFleetOperation(fixture(OPERATIONS.SSH_EXEC));
 assert.equal(ok.requiresFreshExecutionReceipt,true);assert.equal(ok.port,22);
});
test("revocation immediately invalidates standing policy",()=>{
 denied(null,a=>a.delegation.revokedAt="2026-10-24T12:59:00Z",/active_owner_standing_delegation_required/);
});
test("standing policy must be freshly checked, not cached forever",()=>{
 denied(null,a=>a.delegation.lastPolicyVerifiedAt=NOW-120000,/current_standing_policy_verification_required/);
});
test("cannot impersonate another subject",()=>{
 denied(null,a=>a.trustedContext.subject="attacker-service-id",/active_owner_standing_delegation_required/);
});
test("unknown service actors are denied",()=>{
 denied(null,a=>a.trustedContext.source="caller_json",/verified_workload_identity_required/);
});
test("cannot act on a VM in another Google Cloud project",()=>{
 denied(null,a=>{a.target.projectId="unauthorized-project-987";a.registry.projectId=a.target.projectId;},/fixed_approved_fleet_target_required/);
});
test("VM must be enrolled through Sandy's verified provisioning",()=>{
 denied(null,a=>a.registry.enrolmentAttested=false,/server_not_proven_enrolled_in_fleet/);
});
test("VM matching name but different instance ID is refused",()=>{
 denied(null,a=>a.compute.id="8120150462304566315",/google_compute_fresh_identity_mismatch/);
});
test("VM attached identity mismatch is refused",()=>{
 denied(null,a=>a.compute.serviceAccounts[0].email="other@example.com",/google_compute_fresh_identity_mismatch/);
});
test("stale provider observation is refused",()=>{
 denied(null,a=>a.compute.observedAt=NOW-200000,/fresh_google_provider_readback_required/);
});
test("cannot request arbitrary TCP port",()=>{
 denied(null,a=>a.request.port=5986,/ssh_tcp_22_only/);
});
test("unapproved command is refused independently of standing VM access",()=>{
 let a=fixture(OPERATIONS.SSH_EXEC);a.request.commandSha256="c".repeat(64);
 assert.throws(()=>authorizeStandingFleetOperation(a),/approved_bounded_command_required/);
});
test("SSH command cannot run without confirmed host pin",()=>{
 let a=fixture(OPERATIONS.SSH_EXEC);a.registry.sshHostVerified=false;
 assert.throws(()=>authorizeStandingFleetOperation(a),/verified_ssh_host_pin_required/);
});
test("status/ensure operations cannot smuggle a command",()=>{
 denied(null,a=>a.request.commandSha256="b".repeat(64),/no_command_in_policy_or_status_operation/);
});
test("new registered server automatically becomes eligible inside approved project",()=>{
 const a=fixture();
 a.target.name="sandy-deploy-new";
 a.target.instanceId="1940793259055617688";
 a.registry.name=a.target.name;a.registry.instanceId=a.target.instanceId;
 a.compute.name=a.target.name;a.compute.id=a.target.instanceId;
 assert.equal(authorizeStandingFleetOperation(a).allowed,true);
});
test("unknown operation outside the standing grant is refused",()=>{
 denied(null,a=>a.request.operation="gcp.iam.admin.set",/standing_fleet_operation_not_delegated/);
});
