// Sandy fixed-target IAP policy and dispatch adapter.
// Source-only component: never exposes a public command or IAM endpoint.
import {createHash} from "node:crypto";
export const TARGET=Object.freeze({
  project:"elaborate-haven-511518-a5",projectNumber:"1030223524306",zone:"europe-west1-b",
  name:"sandy-deploy",instanceId:"1940793259055617677",
  runtimeServiceAccount:"sandy-vm-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com",
  actor:"serviceAccount:sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com",
  role:"roles/iap.tunnelResourceAccessor",port:22,
  changeId:"d22f048a-c961-493b-b155-ea7a8d79af2f"
});
const VM_URL=`https://compute.googleapis.com/compute/v1/projects/${TARGET.project}/zones/${TARGET.zone}/instances/${TARGET.name}`;
const IAP_URL=`https://iap.googleapis.com/v1/projects/${TARGET.projectNumber}/iap_tunnel/zones/${TARGET.zone}/instances/${TARGET.instanceId}`;
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const sha=s=>createHash("sha256").update(s).digest("hex");
const canonical=x=>Array.isArray(x)?x.map(canonical):object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const digest=x=>sha(JSON.stringify(canonical(x)));
export const policyDigest=x=>{const {etag,...rest}=x;return digest(rest)};
export class Refused extends Error{constructor(code){super(code);this.code=code}}
function need(test,code){if(!test)throw new Refused(code)}
function exact(x,allowed){return Object.keys(x).every(k=>allowed.includes(k))}
export function verifyVm(vm){
  need(object(vm)&&vm.name===TARGET.name&&String(vm.id)===TARGET.instanceId&&
    String(vm.zone).endsWith("/"+TARGET.zone)&&vm.status==="RUNNING","vm_identity_mismatch");
  need(Array.isArray(vm.serviceAccounts)&&vm.serviceAccounts.length===1&&
    vm.serviceAccounts[0].email===TARGET.runtimeServiceAccount,"vm_service_account_changed");
  need(Array.isArray(vm.networkInterfaces)&&vm.networkInterfaces.length===1&&
    !vm.networkInterfaces[0].accessConfigs?.length,"vm_external_network_changed");
  return true;
}
export function candidatePolicy(before,expiresAt,now=Date.now()){
  need(object(before)&&typeof before.etag==="string"&&before.etag.length>0&&
    before.etag.length<4096&&exact(before,["etag","version","bindings","auditConfigs"])&&
    Array.isArray(before.bindings??[])&&JSON.stringify(before).length<65536,"policy_preimage_required");
  const expiration=Date.parse(expiresAt);
  need(typeof expiresAt==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(expiresAt)&&
    Number.isFinite(expiration)&&expiration>now+60000&&expiration<=now+7*86400000,"bounded_expiry_required");
  const expression=`destination.port == 22 && request.time < timestamp("${expiresAt}")`;
  let exists=0;
  for(const b of before.bindings??[]){
    need(object(b)&&exact(b,["role","members","condition"])&&
      typeof b.role==="string"&&Array.isArray(b.members)&&
      b.members.every(x=>typeof x==="string"),"binding_preimage_invalid");
    if(b.role===TARGET.role&&b.members.includes(TARGET.actor)){
      exists++;
      need(exists===1&&object(b.condition)&&b.condition.expression===expression,
        "existing_actor_grant_requires_review");
    }
  }
  if(exists)return {changed:false,policy:structuredClone(before)};
  return {changed:true,policy:{...structuredClone(before),version:3,bindings:[
    ...structuredClone(before.bindings??[]),{role:TARGET.role,members:[TARGET.actor],
      condition:{title:"sandy-deploy-iap-ssh-temporary",
        description:"One approved VM, TCP/22 and independent expiry",expression}}
  ]}};
}
export async function executeFixedIap({admin,claim,reserve,finish,identity,mode="plan",now=Date.now}={}){
  // These callbacks must be implemented by Sandy's existing signed-identity,
  // real-owner-session, one-use grant and shared admission-ledger boundary.
  need(["plan","apply"].includes(mode)&&typeof claim==="function"&&
    typeof reserve==="function"&&typeof finish==="function"&&
    typeof admin?.request==="function"&&identity?.runtimeVerified===true,
    "protected_worker_admission_required");
  const grant=await claim({target:TARGET.name,instanceId:TARGET.instanceId,
    changeId:TARGET.changeId,mode});
  need(grant?.authorized===true&&grant.changeId===TARGET.changeId&&
    grant.instanceId===TARGET.instanceId&&grant.mode===mode&&
    typeof grant.expiresAt==="string"&&typeof grant.admissionId==="string"&&
    /^[a-f0-9-]{36}$/.test(grant.admissionId),"approved_one_use_grant_required");
  const read=async(url,data)=>{
    const resp=await admin.request({url,method:data?"POST":"GET",...(data?{data}:{}),
      timeout:15000,retry:false,maxRedirects:0,maxContentLength:262144,responseType:"json"});
    need(resp?.status===200&&object(resp.data),"provider_read_unverified");return resp.data;
  };
  verifyVm(await read(VM_URL));
  const old=await read(IAP_URL+":getIamPolicy",{options:{requestedPolicyVersion:3}});
  const proposal=candidatePolicy(old,grant.expiresAt,now());
  const beforeSha=policyDigest(old),candidateSha=policyDigest(proposal.policy);
  const base={admissionId:grant.admissionId,changeId:TARGET.changeId,
    beforeSha,candidateSha,mode};
  if(mode==="plan"){
    await finish({...base,state:"planned",writeAttempted:false});
    return {...base,changed:proposal.changed,verified:false};
  }
  need(grant.approvedBeforeSha===beforeSha&&grant.approvedCandidateSha===candidateSha,
    "approved_policy_preimage_mismatch");
  if(proposal.changed){
    const reserved=await reserve(base);
    need(reserved?.admissionId===grant.admissionId&&reserved?.reserved===true,
      "durable_write_reservation_required");
    try{await read(IAP_URL+":setIamPolicy",{policy:proposal.policy})}
    catch{
      await finish({...base,state:"unknown",writeAttempted:true,
        reconciliationRequired:true}).catch(()=>{});
      throw new Refused("unknown_provider_mutation_requires_reconciliation");
    }
  }
  let observed;
  try{observed=await read(IAP_URL+":getIamPolicy",{options:{requestedPolicyVersion:3}})}
  catch{
    await finish({...base,state:"unknown",writeAttempted:proposal.changed,
      reconciliationRequired:true}).catch(()=>{});
    throw new Refused("iap_readback_requires_reconciliation");
  }
  if(policyDigest(observed)!==candidateSha){
    await finish({...base,state:"unknown",writeAttempted:proposal.changed,
      reconciliationRequired:true}).catch(()=>{});
    throw new Refused("iap_readback_mismatch");
  }
  await finish({...base,state:"policy_verified",writeAttempted:proposal.changed,
    reconciliationRequired:false});
  return {...base,changed:proposal.changed,verified:true,sshVerified:false};
}
