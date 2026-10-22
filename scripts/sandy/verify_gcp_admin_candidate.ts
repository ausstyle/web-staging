/** Independent protected administrator acceptance. A legitimate existing Owner
 * session is mandatory; no service key or generated JWT substitutes for it. */
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
      t.instance_id === ["6831598645020395570", "8120150462304566315"][i] && t.policy_read_verified === true) ||
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
  try {
    const token = Deno.env.get("SANDY_CONTROLLER_ACCESS_TOKEN");
    if (!token) throw Error("legitimate_owner_session_unavailable");
    const management = Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN");
    if (!management) throw Error("management_binding_unavailable");
    const keysReply = await request("https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/api-keys",{headers:{authorization:"Bearer "+management}});
    if (!keysReply.ok) throw Error("management_key_lookup_failed");
    const keys = await keysReply.json(), anon = keys.find((r: any) => r.name === "anon")?.api_key;
    if (typeof anon !== "string") throw Error("project_anon_configuration_unavailable");
    const auth = await request(base+"/auth/v1/user",{headers:{authorization:"Bearer "+token,apikey:anon}});
    report.normal_Auth_http_status=auth.status;
    if (!auth.ok) { await auth.body?.cancel(); throw Error("legitimate_owner_session_invalid_or_expired"); }
    await auth.body?.cancel();
    const rpc = async(method: string, params: any) => {
      const response = await request(target,{method:"POST",headers:{authorization:"Bearer "+token,apikey:anon,
        "content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-03-26"},
        body:JSON.stringify({jsonrpc:"2.0",id:crypto.randomUUID(),method,params})});
      report.MCP_http_status=response.status;return await response.json();
    };
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
      const code=e?.error;
      report.API_error=typeof code==="string"&&/^[A-Za-z_]{1,100}$/.test(code)?code:"administrator_execution_failed";
      throw Error("administrator_execution_not_verified");
    }
    assertProof(proof);
    Object.assign(report,{passed:true,runtime_identity:proof.runtime_identity,runtime_revision:proof.runtime_revision,
      administrator_identity:proof.administrator_identity,token_issuance_verified:true,token_expires_at:proof.token_expires_at,
      provider_receipts:proof.provider_receipts,targets:proof.targets.map((t: any)=>({vm_name:t.vm_name,instance_id:t.instance_id,policy_read_verified:true})),admission_id:proof.admission_id});
  }catch(e){const code=e instanceof Error?e.message:"";
    const known=new Set(["legitimate_owner_session_unavailable","management_binding_unavailable","management_key_lookup_failed",
      "project_anon_configuration_unavailable","legitimate_owner_session_invalid_or_expired","owner_MCP_initialization_failed",
      "owner_MCP_discovery_failed","administrator_contract_not_discoverable","administrator_execution_not_verified",
      "independent_administrator_proof_invalid","independent_administrator_token_expiry_invalid"]);
    report.error=known.has(code)?code:"administrator_acceptance_failed";}
  finally{client?.close();await Deno.writeTextFile(output,JSON.stringify(report,null,2)+"\n");console.log("::notice title=Independent administrator acceptance::"+JSON.stringify(report));}
  if(!report.passed)Deno.exitCode=1;
}
