import assert from "node:assert/strict";
import {assertProof} from "./verify_gcp_admin_candidate.ts";
Deno.test("independent administrator proof binds current candidate, identity, expiry and both provider reads",()=>{
  const identity="sandy-mcp-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com";
  const p={ok:true,executed:true,runtime_identity:identity,deployed_runtime_identity:identity,
    runtime_revision:"sandy-engineering-mcp-api-39849886412-4",administrator_identity:"sandy-cloud-administrator@elaborate-haven-511518-a5.iam.gserviceaccount.com",
    token_issuance_verified:true,token_recorded:false,IAM_changes:0,agents_enrolled:0,token_expires_at:new Date(Date.now()+1700000).toISOString(),
    provider_receipts:["https://run.googleapis.com/v2/projects/elaborate-haven-511518-a5/locations/europe-west1/services/sandy-engineering-mcp",
      ...[["sandy-video","6831598645020395570"],["sandy-windows","8120150462304566315"]].flatMap(([name,id])=>[
        `https://compute.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/${name}`,
        `https://iap.googleapis.com/v1/projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/${id}:getIamPolicy`])].map(endpoint=>({endpoint,http_status:200})),targets:[{vm_name:"sandy-video",instance_id:"6831598645020395570",policy_read_verified:true},{vm_name:"sandy-windows",instance_id:"8120150462304566315",policy_read_verified:true}]};
  assertProof(p);
  for(const bad of [{...p,runtime_revision:"another"},{...p,IAM_changes:1},{...p,token_expires_at:new Date(0).toISOString()},{...p,token_issuance_verified:false},{...p,targets:[]}])assert.throws(()=>assertProof(bad));
});
