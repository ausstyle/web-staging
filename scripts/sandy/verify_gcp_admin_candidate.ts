/** Independent protected acceptance. Genuine Owner authorization evidence and
 * fresh non-Owner workload execution are verified separately. No human token. */
import { createEngineeringSessionClient } from "../../supabase/functions/_shared/sandy_engineering_session_client.ts";
import type { IssuedSession } from "../../supabase/functions/_shared/sandy_engineering_session.ts";
import { engineeringIdentityQuery } from "./verify_mcp_candidate.ts";
const base = "https://zmqlyygzqoidkcwdysok.supabase.co";
const target = "https://sandy-api-review---sandy-engineering-mcp-4pqn6jsfxq-ew.a.run.app/mcp";
const runtime = "sandy-mcp-runtime@elaborate-haven-511518-a5.iam.gserviceaccount.com";
const administrator = "sandy-cloud-administrator@elaborate-haven-511518-a5.iam.gserviceaccount.com";
const revision = "sandy-engineering-mcp-api-39849886412-4";
const expectedEndpoints = [
  "https://run.googleapis.com/v2/projects/elaborate-haven-511518-a5/locations/europe-west1/services/sandy-engineering-mcp",
  ...[["sandy-video","6831598645020395570"],["sandy-windows","8120150462304566315"]].flatMap(([name,id]) => [
    `https://compute.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/${name}`,
    `https://iap.googleapis.com/v1/projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/${id}:getIamPolicy`]),
];
export function assertProof(p: any) {
  if (p?.ok !== true || p.executed !== true || p.runtime_identity !== runtime || p.deployed_runtime_identity !== runtime ||
    p.runtime_revision !== revision || p.administrator_identity !== administrator || p.token_issuance_verified !== true ||
    p.token_recorded !== false || p.IAM_changes !== 0 || p.agents_enrolled !== 0 ||
    !Array.isArray(p.targets) || p.targets.length !== 2 || !p.targets.every((t: any, i: number) => t.vm_name === ["sandy-video", "sandy-windows"][i] &&
      t.instance_id === ["6831598645020395570", "8120150462304566315"][i] && t.port === [22,5986][i] && typeof t.etag === "string" && t.etag.length > 0 && t.policy_read_verified === true) ||
    !Array.isArray(p.provider_receipts) || p.provider_receipts.length !== 5 || p.provider_receipts.some((r: any, i: number) => r.http_status !== 200 || r.endpoint !== expectedEndpoints[i])) throw Error("independent_administrator_proof_invalid");
  const remaining = Date.parse(p.token_expires_at) - Date.now();
  if (!Number.isFinite(remaining) || remaining < 60000 || remaining > 1810000) throw Error("independent_administrator_token_expiry_invalid");
}
if (import.meta.main) {
  const index = Deno.args.indexOf("--output"), output = Deno.args[index + 1];
  if (index < 0 || !output) throw Error("output_required");
  const report: Record<string, any> = { passed: false, observed_at: new Date().toISOString(), credentials_recorded: false,
    Owner_session_fabricated: false, IAM_changes: 0, agents_enrolled: 0, production_traffic_changes: 0 };
  const proxy = Deno.env.get("HTTPS_PROXY"), client = proxy ? Deno.createHttpClient({proxy:{url:proxy},http2:false}) : undefined;
  const request: typeof fetch = (url, init = {}) => fetch(url, {...init,...(client ? {client}:{}),redirect:"error",signal:AbortSignal.timeout(110000)});
  let sessions: ReturnType<typeof createEngineeringSessionClient>|undefined, issued: IssuedSession|undefined;
  try {
    const management = Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN");
    if (!management) throw Error("management_binding_unavailable");
    const keysReply=await request("https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/api-keys",{headers:{authorization:"Bearer "+management}});
    if(!keysReply.ok)throw Error("management_key_lookup_failed");
    const keys=await keysReply.json(),anon=keys.find((r:any)=>r.name==="anon")?.api_key,service=keys.find((r:any)=>r.name==="service_role")?.api_key;
    if(typeof anon!=="string"||typeof service!=="string")throw Error("project_Auth_configuration_unavailable");
    const read=async(query:string)=>{
      const response=await request("https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/database/query",{method:"POST",headers:{authorization:"Bearer "+management,"content-type":"application/json"},body:JSON.stringify({query,read_only:true})});
      if(!response.ok)throw Error("delegation_authority_readback_unavailable");return await response.json();
    };
    const identities=await read(engineeringIdentityQuery);
    if(identities.length!==1||identities[0].controller_memberships!==0)throw Error("distinct_nonowner_workload_required");
    const identity=identities[0];
    const grant=await read(`SELECT g.admin_read_revision,g.admin_read_policy,g.enabled,g.revoked_at,g.expires_at>clock_timestamp() base_active,
      public.sandy_api_current_owner(g.authorized_by) current_owner, g.authorized_by<>g.identity_user_id distinct_identities,
      e.id owner_event_id,e.occurred_at owner_event_at,e.detail->>'Owner_session_fingerprint' owner_session_fingerprint
      FROM public.sandy_engineering_control_grants g LEFT JOIN LATERAL (
      SELECT * FROM public.sandy_engineering_identity_events e WHERE e.identity_user_id=g.identity_user_id AND e.owner_authority_id=g.authorized_by
      AND e.actor_kind='controller_owner' AND e.event_type='scope_authorized' AND e.detail->>'boundary'='gcp_admin_read_delegation'
      AND e.detail->>'revision'=g.admin_read_revision::text AND e.detail->'policy'=g.admin_read_policy
      AND e.detail->>'Owner_authentication_method'='normal_Supabase_Auth_authenticated_RPC' ORDER BY e.id DESC LIMIT 1) e ON true
      WHERE g.identity_user_id='${identity.user_id}'::uuid`);
    const g=grant[0];
    const approved=grant.length===1&&g.enabled===true&&!g.revoked_at&&g.base_active===true&&g.current_owner===true&&g.distinct_identities===true&&
      g.admin_read_policy?.connection==="sandy-gcp-admin"&&Date.parse(g.admin_read_policy.expires_at)>Date.now()&&Number.isInteger(g.owner_event_id)&&/^[a-f0-9]{64}$/.test(g.owner_session_fingerprint);
    report.Owner_authenticated_delegation_verified=approved;
    if(approved)Object.assign(report,{Owner_operation:"sandy_engineering_set_admin_read_delegation",Owner_audit_event_id:g.owner_event_id,Owner_operation_at:g.owner_event_at,delegation_revision:g.admin_read_revision});
    sessions=createEngineeringSessionClient(base,service,request);
    issued=await sessions.get({userId:identity.user_id,epoch:identity.credential_epoch,bootstrapGeneration:identity.bootstrap_generation});
    const token=issued.token;
    report.workload_normal_Auth_verified=true;report.workload_Controller_memberships=0;report.workload_access_expires_at=new Date(issued.expiresAt).toISOString();
    const rejectedGrant=await request(base+"/rest/v1/rpc/sandy_engineering_set_admin_read_delegation",{method:"POST",headers:{authorization:"Bearer "+token,apikey:anon,"content-type":"application/json"},body:JSON.stringify({p_enabled:true,p_expires_at:new Date(Date.now()+86400000).toISOString(),p_expected_revision:0})});
    report.workload_self_authorization_http_status=rejectedGrant.status;
    if(rejectedGrant.status!==403)throw Error("workload_self_authorization_denial_not_verified");
    await rejectedGrant.body?.cancel();
    const rpc = async(method: string, params: any) => {
      const response = await request(target,{method:"POST",headers:{authorization:"Bearer "+token,apikey:anon,
        "content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-03-26"},
        body:JSON.stringify({jsonrpc:"2.0",id:crypto.randomUUID(),method,params})});
      report.MCP_http_status=response.status;return await response.json();
    };
    if(!approved){
      const denied=await rpc("tools/call",{name:"engineering.preflight",arguments:{connection:"sandy-gcp-admin"}});
      const status=denied.result?._meta?.sandy_api?.status;
      report.ungranted_administrator_execution_denied=status===403;
      throw Error("administrator_read_delegation_not_established");
    }
    const initialized=await rpc("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"sandy-admin-read-acceptance",version:"1"}});
    if (!initialized.result?.serverInfo) throw Error("owner_MCP_initialization_failed");
    let cursor: string|undefined, discovered=false;
    for(let page=0;page<100;page++){
      const listed=await rpc("tools/list",cursor?{cursor}:{});
      if(!Array.isArray(listed.result?.tools))throw Error("owner_MCP_discovery_failed");
      if(listed.result.tools.some((t: any)=>t.name==="engineering.preflight"&&t.inputSchema?.properties?.connection?.enum?.includes("sandy-gcp-admin")))discovered=true;
      cursor=listed.result.nextCursor;if(!cursor)break;
    }
    if(cursor||!discovered)throw Error("administrator_contract_not_discoverable");
    const response=await rpc("tools/call",{name:"engineering.preflight",arguments:{connection:"sandy-gcp-admin"}});
    const envelope=response.result?._meta?.sandy_api, proof=response.result?.structuredContent;
    report.API_status=envelope?.status ?? null;
    if(envelope?.status!==200||response.result?.isError!==false){
      const e=envelope?.result;
      report.provider_http_status=e?.result?.provider_http_status??null;
      const endpoint=e?.result?.provider_endpoint;
      if(expectedEndpoints.includes(endpoint)||endpoint===`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${administrator}:generateAccessToken`)report.provider_endpoint=endpoint;
      const code=e?.error;
      report.API_error=typeof code==="string"&&/^[A-Za-z_]{1,100}$/.test(code)?code:"administrator_execution_failed";
      throw Error("administrator_execution_not_verified");
    }
    assertProof(proof);
    Object.assign(report,{passed:true,runtime_identity:proof.runtime_identity,runtime_revision:proof.runtime_revision,
      administrator_identity:proof.administrator_identity,token_issuance_verified:true,token_expires_at:proof.token_expires_at,
      provider_receipts:proof.provider_receipts,targets:proof.targets.map((t: any)=>({vm_name:t.vm_name,instance_id:t.instance_id,policy_read_verified:true})),admission_id:proof.admission_id});
  }catch(e){const code=e instanceof Error?e.message:"";
    const known=new Set(["administrator_read_delegation_not_established","delegation_authority_readback_unavailable","distinct_nonowner_workload_required","workload_self_authorization_denial_not_verified","management_binding_unavailable","management_key_lookup_failed",
      "project_Auth_configuration_unavailable","legitimate_owner_session_invalid_or_expired","owner_MCP_initialization_failed",
      "owner_MCP_discovery_failed","administrator_contract_not_discoverable","administrator_execution_not_verified",
      "independent_administrator_proof_invalid","independent_administrator_token_expiry_invalid"]);
    report.error=known.has(code)?code:"administrator_acceptance_failed";}
  finally{
    if(sessions&&issued){try{await sessions.retireIssued(issued);report.workload_session_retired=true;}catch{report.passed=false;report.cleanup_error="workload_session_retirement_failed";}}
    client?.close();await Deno.writeTextFile(output,JSON.stringify(report,null,2)+"\n");console.log("::notice title=Independent administrator acceptance::"+JSON.stringify(report));}
  if(!report.passed)Deno.exitCode=1;
}
