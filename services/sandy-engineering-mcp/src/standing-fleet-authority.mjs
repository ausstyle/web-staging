/**
 * Standing access decision for Sandy's managed Google Cloud Linux fleet.
 *
 * This is a policy component, not an entitlement issuer. Call it only with
 * server-derived, independently authenticated actor/context, current Owner
 * standing delegation and fresh Compute/registry observations. Never accept
 * client-supplied identity, project list, VM IDs, approval or observed state.
 *
 * A standing delegation removes repeated human prompts for bounded normal
 * operations. Short-lived Google credentials and per-operation authorization
 * are still required. This component makes no Google API call.
 */
export const OPERATIONS = Object.freeze({
  ENSURE_SSH_IAP: "gcp.iap.ssh.ensure",
  SSH_EXEC: "gcp.vm.ssh.exec",
  SSH_STATUS: "gcp.vm.ssh.status",
});
export const FLEET_POLICY_VERSION = "sandy-standing-linux-fleet-v1";
const OP_SET = new Set(Object.values(OPERATIONS));
const PROJECT = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const INSTANCE = /^[1-9][0-9]{5,19}$/;
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NAME = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const ZONE = /^[a-z][a-z0-9-]+-[a-z]$/;
function obj(x){return x!==null&&typeof x==="object"&&!Array.isArray(x);}
export class FleetAccessDenied extends Error {
  constructor(code){super(code);this.name="FleetAccessDenied";this.code=code;}
}
function requireThat(value,code){if(!value)throw new FleetAccessDenied(code);}

/**
 * Access is granted on the current trust snapshot, never based solely on a
 * stored approval flag. Google IAP IAM access remains a separate provider fact.
 *
 * trustedContext is constructed by a verified Sandy API entrypoint; callers
 * may not populate it from a request body.
 */
export function authorizeStandingFleetOperation({
  trustedContext, delegation, target, registry, compute, request,
  now = Date.now(),
}) {
  requireThat(obj(trustedContext)&&trustedContext.source==="verified_sandy_api"&&
    trustedContext.authenticated===true&&trustedContext.sessionActive===true&&
    typeof trustedContext.subject==="string"&&trustedContext.subject.length>8,
    "verified_workload_identity_required");
  requireThat(obj(delegation)&&delegation.schema===FLEET_POLICY_VERSION&&
    delegation.enabled===true&&delegation.revokedAt===null&&
    delegation.expiryMode==="until_revoked"&&
    delegation.boundActor===trustedContext.subject&&
    delegation.ownerAuthorityVerified===true&&
    Number.isSafeInteger(delegation.revision)&&delegation.revision>0,
    "active_owner_standing_delegation_required");
  // A standing permission lives until revoked; ephemeral sessions, credentials,
  // machine enrolment and revocation checks must still be renewed normally.
  requireThat(Number.isFinite(delegation.lastPolicyVerifiedAt)&&
    now-delegation.lastPolicyVerifiedAt>=0&&
    now-delegation.lastPolicyVerifiedAt<=60_000,
    "current_standing_policy_verification_required");
  requireThat(Array.isArray(delegation.allowedProjects)&&
    delegation.allowedProjects.length>0&&delegation.allowedProjects.length<=40&&
    delegation.allowedProjects.every(s=>typeof s==="string"&&PROJECT.test(s)),
    "approved_cloud_project_list_required");
  requireThat(Array.isArray(delegation.allowedOperations)&&
    delegation.allowedOperations.length>0&&
    delegation.allowedOperations.every(s=>OP_SET.has(s)),
    "approved_fleet_operation_classes_required");
  requireThat(obj(request)&&
    typeof request.operation==="string"&&OP_SET.has(request.operation)&&
    delegation.allowedOperations.includes(request.operation)&&
    typeof request.idempotencyKey==="string"&&
    request.idempotencyKey.length>=12&&request.idempotencyKey.length<=128&&
    /^[A-Za-z0-9:_-]+$/.test(request.idempotencyKey),
    "standing_fleet_operation_not_delegated");
  requireThat(obj(target)&&obj(registry)&&obj(compute)&&
    typeof target.projectId==="string"&&PROJECT.test(target.projectId)&&
    delegation.allowedProjects.includes(target.projectId)&&
    typeof target.zone==="string"&&ZONE.test(target.zone)&&
    typeof target.instanceId==="string"&&INSTANCE.test(target.instanceId)&&
    typeof target.name==="string"&&NAME.test(target.name),
    "fixed_approved_fleet_target_required");
  requireThat(registry.projectId===target.projectId&&registry.zone===target.zone&&
    registry.name===target.name&&registry.instanceId===target.instanceId&&
    registry.platform==="linux"&&registry.enabled===true&&
    registry.revokedAt===null&&registry.managedBy==="sandy"&&
    registry.enrolmentAttested===true&&
    typeof registry.enrolmentProofSha256==="string"&&SHA.test(registry.enrolmentProofSha256)&&
    registry.ownerProjectDelegated===true,
    "server_not_proven_enrolled_in_fleet");
  // Google IAM Conditions do not support using resource tags to scope IAP.
  // Server-owned enrollment is the application control, NOT a Google IAM grant.
  requireThat(String(compute.id)===target.instanceId&&
    compute.name===target.name&&
    compute.status==="RUNNING"&&
    String(compute.zone).endsWith("/"+target.zone)&&
    Array.isArray(compute.serviceAccounts)&&
    compute.serviceAccounts.length===1&&
    typeof registry.attachedServiceAccount==="string"&&
    compute.serviceAccounts[0].email===registry.attachedServiceAccount,
    "google_compute_fresh_identity_mismatch");
  requireThat(Number.isFinite(compute.observedAt)&&
    now-compute.observedAt>=0&&now-compute.observedAt<=120_000,
    "fresh_google_provider_readback_required");
  requireThat(request.port===22,"ssh_tcp_22_only");
  if(request.operation===OPERATIONS.SSH_EXEC){
    requireThat(typeof request.commandSha256==="string"&&
      SHA.test(request.commandSha256)&&
      Array.isArray(delegation.approvedCommandDigests)&&
      delegation.approvedCommandDigests.includes(request.commandSha256)&&
      Number.isSafeInteger(request.timeoutSeconds)&&
      request.timeoutSeconds>=1&&request.timeoutSeconds<=30,
      "approved_bounded_command_required");
    requireThat(registry.sshHostVerified===true&&
      typeof registry.sshHostKeySha256==="string"&&
      /^SHA256:[A-Za-z0-9+/]{43}$/.test(registry.sshHostKeySha256),
      "verified_ssh_host_pin_required");
  } else {
    requireThat(request.commandSha256===undefined,
      "no_command_in_policy_or_status_operation");
  }
  // Protected hosts are not excluded from access in a fleet grant, but
  // the grant cannot itself change or remove any existing protected release.
  return Object.freeze({
    allowed:true,policyVersion:FLEET_POLICY_VERSION,
    operation:request.operation,
    actor:trustedContext.subject,
    projectId:target.projectId,zone:target.zone,
    instanceId:target.instanceId,name:target.name,
    port:22,revision:delegation.revision,
    idempotencyKey:request.idempotencyKey,
    requiresSeparatePerTaskOwnerApproval:false,
    requiresProviderPermission:true,
    requiresFreshExecutionReceipt:true,
    permitsUnscopedIamGrantCreation:false,
    requiresExactIamPolicyPreimage:request.operation===OPERATIONS.ENSURE_SSH_IAP,
    permitsArbitraryServerEnrollment:false,
  });
}
