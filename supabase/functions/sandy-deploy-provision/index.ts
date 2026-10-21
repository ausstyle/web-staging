import {createClient} from "npm:@supabase/supabase-js@2.57.0";
const P="elaborate-haven-511518-a5",Z="europe-west1-b",SA="sandy-computer@"+P+".iam.gserviceaccount.com",VM_SA="sandy-vm-runtime@"+P+".iam.gserviceaccount.com";
const AUD="//iam.googleapis.com/projects/1030223524306/locations/global/workloadIdentityPools/sandy-supabase/providers/sandy-supabase-auth";
const MACHINE="sandy-gcp-machine@sandy-ai.internal";
const reply=(v:Record<string,unknown>,s=200)=>Response.json(v,{status:s,headers:{"cache-control":"no-store"}});
Deno.serve(async(req)=>{
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 const root=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!root||!key)return reply({error:"config_missing"},503);
 const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,""),worker=req.headers.get("x-sandy-worker-token")||"";
 const db=createClient(root,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{"Authorization":"Bearer "+key}}});
 let ok=bearer===key;
 if(!ok&&worker){const v=await db.rpc("sandy_computer_worker_auth",{p_token:worker});ok=!v.error&&v.data===true}
 if(!ok)return reply({error:"unauthorized"},403);
 let input:any;try{input=await req.json()}catch{return reply({error:"bad_json"},400)}
 const action=String(input.action??"status");
 if(!["status","video_status","create_video","verify_video","create_linux","linux_status","vm_metadata_status","stage_bootstrap","cloud_run_status","video_network_preflight","cloud_run_permissions","mcp_build_preflight","mcp_build_permissions","mcp_build_bootstrap","mcp_container_build","mcp_build_status","mcp_cloud_run_deploy","mcp_endpoint_probe","mcp_public_ingress","mcp_release_temp_iam","mcp_registry_writer_grant","mcp_builder_project_grant","iam_project_policy_read","iam_deployment_grant","runtime_service_account_prepare","runtime_service_account_create","video_install_preflight","video_execution_preflight","video_ssh_preflight","video_ssh_iam_grant","video_enable_osconfig","video_osconfig_permissions","video_vm_osconfig_prepare","video_osconfig_agent_status","video_osconfig_policy_preflight","video_osconfig_access","vm_service_status","vm_bootstrap_probe","enable_guest_reporting","reboot_bootstrap","bootstrap_serial_status"].includes(action))return reply({error:"action_not_allowed",windows_requires_paid_billing:true},403);
 try{
  const users=await db.auth.admin.listUsers({page:1,perPage:1000});
  if(users.error)throw Error("machine_lookup_failed");
  const machine=users.data.users.find(u=>u.email===MACHINE&&u.app_metadata?.sandy_gcp_machine===true);
  if(!machine)throw Error("machine_identity_missing");
  const link=await db.auth.admin.generateLink({type:"magiclink",email:MACHINE});
  if(link.error||!link.data.properties?.hashed_token)throw Error("machine_link_failed");
  const session=await db.auth.verifyOtp({type:"magiclink",token_hash:link.data.properties.hashed_token});
  const jwt=session.data?.session?.access_token;
  if(session.error||!jwt)throw Error("machine_token_failed");
  const claims=JSON.parse(atob(jwt.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
  if(claims.sub!==machine.id||claims.app_metadata?.sandy_gcp_machine!==true||claims.aud!=="authenticated")throw Error("machine_claims_invalid");
  const params=new URLSearchParams({audience:AUD,grant_type:"urn:ietf:params:oauth:grant-type:token-exchange",requested_token_type:"urn:ietf:params:oauth:token-type:access_token",subject_token_type:"urn:ietf:params:oauth:token-type:jwt",subject_token:jwt,scope:"https://www.googleapis.com/auth/cloud-platform"});
  const sts=await fetch("https://sts.googleapis.com/v1/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:params,signal:AbortSignal.timeout(22000)});
  const st=await sts.json();if(!sts.ok||!st.access_token)throw Error("google_sts_"+sts.status+":"+String(st.error_description??st.error??"").slice(0,100));
  const impersonate=await fetch("https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/"+SA+":generateAccessToken",{method:"POST",headers:{"authorization":"Bearer "+st.access_token,"content-type":"application/json"},body:JSON.stringify({scope:["https://www.googleapis.com/auth/cloud-platform"],lifetime:"1800s"}),signal:AbortSignal.timeout(22000)});
  const i=await impersonate.json();if(!impersonate.ok||!i.accessToken)throw Error("impersonation_"+impersonate.status+":"+String(i.error?.message??"").slice(0,160));
  const auth={"authorization":"Bearer "+i.accessToken,"content-type":"application/json"};
  if(action==="video_ssh_preflight"||action==="video_ssh_iam_grant"){
    const vmUrl="https://compute.googleapis.com/compute/v1/projects/"+P+"/zones/"+Z+"/instances/sandy-video";
    const vmResp=await fetch(vmUrl,{headers:auth,signal:AbortSignal.timeout(16000)});
    if(!vmResp.ok)return reply({ok:false,error:"video_vm_lookup_failed",google_http:vmResp.status},502);
    const vm=await vmResp.json();
    const metadata=Object.fromEntries((vm.metadata?.items||[]).map((x:any)=>[x.key,x.value]));
    const identity="serviceAccount:"+SA;
    const roleNames=["roles/compute.osAdminLogin","roles/iap.tunnelResourceAccessor"];
    const policyUrl="https://cloudresourcemanager.googleapis.com/v1/projects/"+P;
    const polResp=await fetch(policyUrl+":getIamPolicy",{method:"POST",headers:auth,body:"{}",signal:AbortSignal.timeout(16000)});
    const policy=await polResp.json().catch(()=>({}));
    if(!polResp.ok)return reply({ok:false,error:"iam_read_failed",google_http:polResp.status},502);
    const granted=roleNames.filter((role:string)=>(policy.bindings||[]).some((b:any)=>b.role===role&&b.members?.includes(identity)));
    if(action==="video_ssh_preflight")return reply({ok:true,target:"sandy-video",vm_status:vm.status,identity,oslogin_enabled:metadata["enable-oslogin"]==="TRUE",block_project_ssh_keys:metadata["block-project-ssh-keys"]==="TRUE",external_ip_present:(vm.networkInterfaces||[]).some((n:any)=>Boolean(n.accessConfigs?.length)),granted_roles:granted,missing_roles:roleNames.filter((x:string)=>!granted.includes(x)),ssh_connectivity_verified:false,remote_execution_available:false});
    const changeId=String(input.change_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(changeId))return reply({error:"approved_change_required"},400);
    const ch=await db.from("sandy_engineering_changes").select("status,scope,requested_by").eq("id",changeId).maybeSingle();
    if(ch.error||ch.data?.status!=="approved"||ch.data?.requested_by!=="ffba8e24-f452-44c8-ba9d-228b8657e3cc"||!ch.data?.scope?.includes("sandy-video:ssh"))return reply({error:"owner_approved_ssh_scope_required"},403);
    if(vm.status!=="RUNNING"||metadata["enable-oslogin"]!=="TRUE"||!policy.etag)return reply({error:"ssh_preflight_not_satisfied"},409);
    const missing=roleNames.filter((x:string)=>!granted.includes(x));
    if(!missing.length)return reply({ok:true,already_granted:true,identity,roles:roleNames,ssh_connectivity_verified:false});
    const next=structuredClone(policy);
    for(const role of missing){const b=next.bindings.find((x:any)=>x.role===role&&!x.condition);if(b)b.members=[...new Set([...(b.members||[]),identity])];else next.bindings.push({role,members:[identity]});}
    const applied=await fetch(policyUrl+":setIamPolicy",{method:"POST",headers:auth,body:JSON.stringify({policy:next,updateMask:"bindings,etag"}),signal:AbortSignal.timeout(16000)});
    if(!applied.ok)return reply({ok:false,error:"ssh_iam_grant_failed",google_http:applied.status},502);
    return reply({ok:true,granted_roles:missing,identity,change_id:changeId,ssh_connectivity_verified:false,remote_execution_available:false});
  }
  if(action==="video_enable_osconfig"){
    const changeId=String(input.change_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(changeId))return reply({error:"approved_change_required"},400);
    const check=await db.from("sandy_engineering_changes").select("status,scope,requested_by").eq("id",changeId).maybeSingle();
    if(check.error||!check.data||check.data.status!=="approved"||!check.data.scope?.includes("sandy-video")||!check.data.scope?.includes("osconfig.googleapis.com"))return reply({error:"approved_video_scope_required"},403);
    const response=await fetch("https://serviceusage.googleapis.com/v1/projects/1030223524306/services/osconfig.googleapis.com:enable",{method:"POST",headers:{"authorization":"Bearer "+i.accessToken,"content-type":"application/json"},body:"{}",signal:AbortSignal.timeout(25000)});
    const data=await response.json().catch(()=>({}));
    return reply({ok:response.ok,google_http:response.status,operation:data.name||null,google_error_code:data.error?.code||null,google_error_status:String(data.error?.status||"").slice(0,100),google_error_message:String(data.error?.message||"").slice(0,450),accepted:response.ok,verified:false},response.ok?202:502);
  }
  if(action==="video_osconfig_permissions"){
    const permissions=["serviceusage.services.enable","serviceusage.services.get","osconfig.osPolicyAssignments.create","osconfig.osPolicyAssignments.get","compute.instances.setMetadata"];
    const resp=await fetch("https://cloudresourcemanager.googleapis.com/v1/projects/"+P+":testIamPermissions",{method:"POST",headers:{"authorization":"Bearer "+i.accessToken,"content-type":"application/json"},body:JSON.stringify({permissions}),signal:AbortSignal.timeout(16000)});
    const data=await resp.json().catch(()=>({}));
    return reply({ok:resp.ok,http_status:resp.status,granted:data.permissions||[],missing:permissions.filter((p:string)=>!(data.permissions||[]).includes(p))},resp.ok?200:502);
  }
  if(action==="video_vm_osconfig_prepare"){
    const changeId=String(input.change_id||"");
    const ch=await db.from("sandy_engineering_changes").select("status,scope").eq("id",changeId).maybeSingle();
    if(ch.error||ch.data?.status!=="approved"||!ch.data.scope?.includes("sandy-video")||!ch.data.scope?.includes("osconfig.googleapis.com"))return reply({error:"approved_video_change_required"},403);
    const endpoint="https://compute.googleapis.com/compute/v1/projects/"+P+"/zones/"+Z+"/instances/sandy-video";
    const read=await fetch(endpoint,{headers:auth,signal:AbortSignal.timeout(15000)});
    const vm=await read.json().catch(()=>({}));
    if(!read.ok||vm.status!=="RUNNING")return reply({error:"video_vm_not_running",http_status:read.status},409);
    const items=(vm.metadata?.items||[]).filter((v:any)=>v.key!=="enable-osconfig");
    items.push({key:"enable-osconfig",value:"TRUE"});
    const changed=await fetch(endpoint+"/setMetadata",{method:"POST",headers:auth,body:JSON.stringify({fingerprint:vm.metadata?.fingerprint,items}),signal:AbortSignal.timeout(18000)});
    const result=await changed.json().catch(()=>({}));
    return reply({ok:changed.ok,accepted:changed.ok,google_http:changed.status,operation:result.name||null,verified:false},changed.ok?202:502);
  }
  if(action==="video_osconfig_agent_status"){
    const headers={authorization:"Bearer "+i.accessToken};
    const endpoint="https://osconfig.googleapis.com/v1/projects/"+P+"/locations/"+Z+"/instances/6831598645020395570/inventory";
    const response=await fetch(endpoint,{headers,signal:AbortSignal.timeout(16000)});
    const data=await response.json().catch(()=>({}));
    return reply({ok:response.ok,http_status:response.status,inventory_available:response.ok,os_info:response.ok?data.osInfo||null:null,error_status:data.error?.status||null,error_message:String(data.error?.message||"").slice(0,220)},response.ok?200:response.status===404?404:502);
  }
  if(action==="video_osconfig_policy_preflight"){
    const headers={authorization:"Bearer "+i.accessToken};
    const endpoint="https://osconfig.googleapis.com/v2/projects/"+P+"/locations/europe-west1/osPolicyAssignments";
    const response=await fetch(endpoint,{headers,signal:AbortSignal.timeout(16000)});
    const data=await response.json().catch(()=>({}));
    return reply({ok:response.ok,http_status:response.status,assignments:response.ok?(data.osPolicyAssignments||[]).map((x:any)=>x.name):[],error_status:data.error?.status||null,error_message:String(data.error?.message||"").slice(0,250)},response.ok?200:502);
  }
  if(action==="video_osconfig_access"){
    const permissions=["osconfig.inventories.get","osconfig.osPolicyAssignments.create","osconfig.osPolicyAssignments.get","osconfig.osPolicyAssignments.list","compute.instances.setMetadata"];
    const response=await fetch("https://cloudresourcemanager.googleapis.com/v1/projects/"+P+":testIamPermissions",{method:"POST",headers:auth,body:JSON.stringify({permissions}),signal:AbortSignal.timeout(16000)});
    const data=await response.json().catch(()=>({}));
    return reply({ok:response.ok,granted:data.permissions||[],missing:permissions.filter((p:string)=>!(data.permissions||[]).includes(p))},response.ok?200:502);
  }
  if(action==="video_execution_preflight"){
    const response=await fetch("https://serviceusage.googleapis.com/v1/projects/1030223524306/services/osconfig.googleapis.com",{headers:{authorization:"Bearer "+i.accessToken},signal:AbortSignal.timeout(15000)});
    const data=await response.json().catch(()=>({}));
    return reply({ok:response.ok,osconfig_http:response.status,osconfig_enabled:data.state==="ENABLED",installation_executed:false},response.ok?200:502);
  }
  if(action==="video_install_preflight"){
    const baseVm="https://compute.googleapis.com/compute/v1/projects/"+P+"/zones/"+Z+"/instances/sandy-video";
    const resp=await fetch(baseVm,{headers:{authorization:"Bearer "+i.accessToken},signal:AbortSignal.timeout(16000)});
    if(!resp.ok)return reply({ok:false,error:"video_vm_lookup_failed",google_http:resp.status},502);
    const vm=await resp.json();
    const attrs=await fetch(baseVm+"/getGuestAttributes?queryPath=sandy-video%2F",{headers:{authorization:"Bearer "+i.accessToken},signal:AbortSignal.timeout(16000)});
    const attrData=await attrs.json().catch(()=>({}));
    const routersResp=await fetch("https://compute.googleapis.com/compute/v1/projects/"+P+"/regions/europe-west1/routers",{headers:{authorization:"Bearer "+i.accessToken},signal:AbortSignal.timeout(12000)});
    const routersData=await routersResp.json().catch(()=>({}));
    const cloudNatRouters=(routersData.items||[]).filter((r:any)=>(r.nats||[]).length).map((r:any)=>r.name);
    const keys=(vm.metadata?.items||[]).map((v:any)=>v.key);
    return reply({ok:true,vm:vm.name,vm_status:vm.status,instance_id:vm.id,machine_type:vm.machineType,metadata_keys:keys,external_ip_present:(vm.networkInterfaces||[]).some((n:any)=>Boolean(n.accessConfigs?.[0]?.natIP)),cloud_nat_http:routersResp.status,cloud_nat_routers:cloudNatRouters,guest_reporting_http:attrs.status,guest_reporting:attrs.ok?attrData.queryValue||attrData:null,livekit_verified:false,installation_authorized:false,reason:"No approved video.install executor; preflight is read-only"});
  }
  if(action==="runtime_service_account_create"){
    const changeId=String(input.change_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(changeId))return reply({error:"approved_change_required"},400);
    const change=await db.from("sandy_engineering_changes").select("status,requested_by").eq("id",changeId).maybeSingle();
    if(change.error||change.data?.status!=="approved"||change.data.requested_by!=="ffba8e24-f452-44c8-ba9d-228b8657e3cc")return reply({error:"owner_approved_change_required"},403);
    const email="sandy-mcp-runtime@"+P+".iam.gserviceaccount.com";
    const baseIAM="https://iam.googleapis.com/v1/projects/"+P+"/serviceAccounts";
    const headers={authorization:"Bearer "+i.accessToken,"content-type":"application/json"};
    const check=await fetch(baseIAM+"/"+email,{headers,signal:AbortSignal.timeout(12000)});
    if(check.ok)return reply({ok:true,already_exists:true,email});
    if(check.status!==404)return reply({ok:false,error:"service_account_check_failed",http_status:check.status},check.status);
    const created=await fetch(baseIAM,{method:"POST",headers,body:JSON.stringify({accountId:"sandy-mcp-runtime",serviceAccount:{displayName:"Sandy MCP Runtime",description:"Dedicated minimal runtime identity for Sandy Engineering MCP"}}),signal:AbortSignal.timeout(16000)});
    const value=await created.json().catch(()=>({}));
    if(!created.ok)return reply({ok:false,error:"service_account_create_failed",http_status:created.status,google_status:String(value?.error?.status||"").slice(0,90),google_message:String(value?.error?.message||"").slice(0,260)},created.status);
    return reply({ok:true,created:true,email:String(value.email||email),change_id:changeId,verification_required:true});
  }
  if(action==="runtime_service_account_prepare"){
    const email="sandy-mcp-runtime@"+P+".iam.gserviceaccount.com";
    const principal="serviceAccount:"+SA;
    const endpoint="https://iam.googleapis.com/v1/projects/"+P+"/serviceAccounts/"+email;
    const headers={authorization:"Bearer "+i.accessToken,"content-type":"application/json"};
    const get=await fetch(endpoint,{headers,signal:AbortSignal.timeout(12000)});
    if(get.status===404)return reply({ok:false,error:"runtime_service_account_missing",email},404);
    if(!get.ok)return reply({ok:false,error:"runtime_account_lookup_failed",http_status:get.status},get.status);
    const changeId=String(input.change_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(changeId))return reply({error:"approved_change_required"},400);
    const change=await db.from("sandy_engineering_changes").select("status,requested_by").eq("id",changeId).maybeSingle();
    if(change.error||change.data?.status!=="approved"||change.data.requested_by!=="ffba8e24-f452-44c8-ba9d-228b8657e3cc")return reply({error:"owner_approved_change_required"},403);
    const policyResp=await fetch(endpoint+":getIamPolicy",{method:"POST",headers,body:"{}",signal:AbortSignal.timeout(12000)});
    const policy=await policyResp.json().catch(()=>({}));
    if(!policyResp.ok)return reply({ok:false,error:"runtime_iam_read_failed",http_status:policyResp.status},policyResp.status);
    const role="roles/iam.serviceAccountUser";
    const present=(policy.bindings||[]).some((b:any)=>b.role===role&&b.members?.includes(principal));
    if(present)return reply({ok:true,existing:true,email,permission:role});
    if(!policy.etag)return reply({error:"runtime_iam_policy_etag_missing"},409);
    const updated=structuredClone(policy);
    const binding=updated.bindings?.find((b:any)=>b.role===role&&!b.condition);
    if(binding)binding.members=[...new Set([...(binding.members||[]),principal])];else updated.bindings=[...(updated.bindings||[]),{role,members:[principal]}];
    const applied=await fetch(endpoint+":setIamPolicy",{method:"POST",headers,body:JSON.stringify({policy:updated}),signal:AbortSignal.timeout(16000)});
    if(!applied.ok)return reply({ok:false,error:"runtime_iam_write_failed",http_status:applied.status},applied.status);
    return reply({ok:true,granted:true,email,permission:role,verification_required:true});
  }
  if(action==="iam_project_policy_read"||action==="iam_deployment_grant"){
    const policyURL="https://cloudresourcemanager.googleapis.com/v1/projects/"+P+":getIamPolicy";
    const policyResp=await fetch(policyURL,{method:"POST",headers:{authorization:"Bearer "+i.accessToken,"content-type":"application/json"},body:"{}",signal:AbortSignal.timeout(14000)});
    const policy=await policyResp.json().catch(()=>({}));
    if(!policyResp.ok)return reply({ok:false,error:"iam_policy_read_denied",http_status:policyResp.status,google_status:String(policy?.error?.status||"").slice(0,90)},policyResp.status);
    const principal="serviceAccount:"+SA;
    const allowedRoles=["roles/run.sourceDeveloper","roles/serviceusage.serviceUsageConsumer"];
    const existing=allowedRoles.filter(role=>(policy.bindings||[]).some((b:any)=>b.role===role&&b.members?.includes(principal)));
    if(action==="iam_project_policy_read")return reply({ok:true,project:P,subject:principal,required_roles:allowedRoles,granted_roles:existing,missing_roles:allowedRoles.filter(x=>!existing.includes(x)),policy_etag_present:!!policy.etag});
    const changeId=String(input.change_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(changeId))return reply({error:"approved_change_required"},400);
    const change=await db.from("sandy_engineering_changes").select("id,status,risk,requested_by").eq("id",changeId).maybeSingle();
    if(change.error||change.data?.status!=="approved"||change.data?.requested_by!=="ffba8e24-f452-44c8-ba9d-228b8657e3cc")return reply({error:"owner_approved_engineering_change_required"},403);
    if(!policy.etag||!Array.isArray(policy.bindings))return reply({error:"versioned_iam_policy_required"},409);
    const missing=allowedRoles.filter(x=>!existing.includes(x));
    if(missing.length===0)return reply({ok:true,already_granted:true,roles:existing});
    const updated=structuredClone(policy);
    for(const role of missing){const b=updated.bindings.find((x:any)=>x.role===role&&!x.condition);if(b)b.members=[...new Set([...(b.members||[]),principal])];else updated.bindings.push({role,members:[principal]});}
    const setResp=await fetch("https://cloudresourcemanager.googleapis.com/v1/projects/"+P+":setIamPolicy",{method:"POST",headers:{authorization:"Bearer "+i.accessToken,"content-type":"application/json"},body:JSON.stringify({policy:updated,updateMask:"bindings,etag"}),signal:AbortSignal.timeout(16000)});
    const result=await setResp.json().catch(()=>({}));
    if(!setResp.ok)return reply({ok:false,error:"iam_policy_write_denied",http_status:setResp.status,google_status:String(result?.error?.status||"").slice(0,90)},setResp.status);
    return reply({ok:true,granted_roles:missing,principal,change_id:changeId,verification_required:true});
  }
  if(action==="mcp_builder_project_grant"){
    const changeId=String(input.change_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(changeId))return reply({error:"approved_change_required"},400);
    const ch=await db.from("sandy_engineering_changes").select("status,requested_by").eq("id",changeId).maybeSingle();
    if(ch.error||ch.data?.status!=="approved"||ch.data.requested_by!=="ffba8e24-f452-44c8-ba9d-228b8657e3cc")return reply({error:"owner_approved_change_required"},403);
    const target="serviceAccount:1030223524306-compute@developer.gserviceaccount.com";
    const role="roles/artifactregistry.writer";
    const url="https://cloudresourcemanager.googleapis.com/v1/projects/"+P;
    const headers={authorization:"Bearer "+i.accessToken,"content-type":"application/json"};
    const rr=await fetch(url+":getIamPolicy",{method:"POST",headers,body:"{}",signal:AbortSignal.timeout(14000)});
    const policy=await rr.json().catch(()=>({}));
    if(!rr.ok||!policy.etag||!Array.isArray(policy.bindings))return reply({error:"versioned_policy_unavailable",http_status:rr.status},rr.ok?409:rr.status);
    if(policy.bindings.some((b:any)=>b.role===role&&b.members?.includes(target)))return reply({ok:true,already_granted:true,target,role});
    const updated=structuredClone(policy);
    const b=updated.bindings.find((x:any)=>x.role===role&&!x.condition);
    if(b)b.members=[...new Set([...(b.members||[]),target])];else updated.bindings.push({role,members:[target]});
    const apply=await fetch(url+":setIamPolicy",{method:"POST",headers,body:JSON.stringify({policy:updated,updateMask:"bindings,etag"}),signal:AbortSignal.timeout(16000)});
    const value=await apply.json().catch(()=>({}));
    if(!apply.ok)return reply({ok:false,error:"project_iam_write_failed",http_status:apply.status,reason:String(value?.error?.status||"").slice(0,100)},apply.status);
    return reply({ok:true,granted:true,target,role,scope:"project",verification_required:true});
  }
  if(action==="mcp_registry_writer_grant"){
    const changeId=String(input.change_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(changeId))return reply({error:"approved_change_required"},400);
    const ch=await db.from("sandy_engineering_changes").select("status,requested_by").eq("id",changeId).maybeSingle();
    if(ch.error||ch.data?.status!=="approved"||ch.data.requested_by!=="ffba8e24-f452-44c8-ba9d-228b8657e3cc")return reply({error:"owner_approved_change_required"},403);
    const resource="projects/"+P+"/locations/europe-west1/repositories/sandy-mcp";
    const target="serviceAccount:1030223524306-compute@developer.gserviceaccount.com";
    const url="https://artifactregistry.googleapis.com/v1/"+resource;
    const headers={authorization:"Bearer "+i.accessToken,"content-type":"application/json"};
    const g=await fetch(url+":getIamPolicy",{headers,signal:AbortSignal.timeout(16000)});
    const policy=await g.json().catch(()=>({}));
    if(!g.ok)return reply({ok:false,error:"registry_iam_read_failed",status:g.status,reason:String(policy?.error?.message||"").slice(0,200)},g.status);
    if(!policy.etag)return reply({error:"registry_policy_etag_missing"},409);
    const role="roles/artifactregistry.writer";
    if((policy.bindings||[]).some((b:any)=>b.role===role&&b.members?.includes(target)))return reply({ok:true,already_granted:true,resource,target});
    const next=structuredClone(policy);
    const b=next.bindings?.find((x:any)=>x.role===role&&!x.condition);
    if(b)b.members=[...new Set([...(b.members||[]),target])];else next.bindings=[...(next.bindings||[]),{role,members:[target]}];
    const x=await fetch(url+":setIamPolicy",{method:"POST",headers,body:JSON.stringify({policy:next}),signal:AbortSignal.timeout(16000)});
    const v=await x.json().catch(()=>({}));
    if(!x.ok)return reply({ok:false,error:"registry_iam_write_failed",status:x.status,reason:String(v?.error?.message||"").slice(0,200)},x.status);
    return reply({ok:true,granted:true,resource,target,role,verification_required:true});
  }
  if(action==="mcp_release_temp_iam"){
    const changeId=String(input.change_id||"");
    if(changeId!=="b06252bd-f143-428b-8282-f5e8534c9ef3")return reply({error:"approved_sprint_change_required"},403);
    const c=await db.from("sandy_engineering_changes").select("status,requested_by").eq("id",changeId).maybeSingle();
    if(c.error||!["approved","implementing","committed","deployed","verified"].includes(String(c.data?.status||""))||c.data?.requested_by!=="ffba8e24-f452-44c8-ba9d-228b8657e3cc")return reply({error:"owner_approved_change_required"},403);
    const principal="serviceAccount:"+SA;
    const removeRoles=["roles/resourcemanager.projectIamAdmin","roles/iam.serviceAccountCreator"];
    const uri="https://cloudresourcemanager.googleapis.com/v1/projects/"+P;
    const headers={authorization:"Bearer "+i.accessToken,"content-type":"application/json"};
    const resp=await fetch(uri+":getIamPolicy",{method:"POST",headers,body:JSON.stringify({options:{requestedPolicyVersion:3}}),signal:AbortSignal.timeout(14000)});
    const policy=await resp.json().catch(()=>({}));
    if(!resp.ok||!policy.etag||!Array.isArray(policy.bindings))return reply({ok:false,error:"iam_cleanup_policy_unavailable",http_status:resp.status},resp.ok?409:resp.status);
    const originally=removeRoles.filter(x=>policy.bindings.some((b:any)=>b.role===x&&b.members?.includes(principal)));
    if(originally.length===0)return reply({ok:true,already_clean:true,removed_roles:[],permanent_deployment_roles_preserved:true});
    const update=structuredClone(policy);
    update.bindings=update.bindings.map((b:any)=>{
      if(!removeRoles.includes(b.role)||!Array.isArray(b.members))return b;
      return {...b,members:b.members.filter((m:string)=>m!==principal)};
    }).filter((b:any)=>Array.isArray(b.members)&&b.members.length>0);
    const sent=await fetch(uri+":setIamPolicy",{method:"POST",headers,body:JSON.stringify({policy:update,updateMask:"bindings,etag,version"}),signal:AbortSignal.timeout(16000)});
    const updated=await sent.json().catch(()=>({}));
    if(!sent.ok||!Array.isArray(updated.bindings))return reply({ok:false,error:"iam_cleanup_write_failed",http_status:sent.status,reason:String(updated?.error?.status||"").slice(0,80)},sent.ok?502:sent.status);
    const still=removeRoles.filter(x=>updated.bindings.some((b:any)=>b.role===x&&b.members?.includes(principal)));
    return reply({ok:still.length===0,removed_roles:originally,still_present:still,project:P,principal,permanent_deployment_roles_preserved:true,verified_from_google_policy_response:true},still.length===0?200:409);
  }
  if(action==="mcp_public_ingress"){
    const changeId=String(input.change_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(changeId))return reply({error:"approved_change_required"},400);
    const c=await db.from("sandy_engineering_changes").select("status,requested_by").eq("id",changeId).maybeSingle();
    if(c.error||c.data?.status!=="approved"||c.data.requested_by!=="ffba8e24-f452-44c8-ba9d-228b8657e3cc")return reply({error:"owner_approved_change_required"},403);
    const headers={authorization:"Bearer "+i.accessToken,"content-type":"application/json"};
    const projectUrl="https://cloudresourcemanager.googleapis.com/v1/projects/"+P;
    const serviceUrl="https://run.googleapis.com/v2/projects/"+P+"/locations/europe-west1/services/sandy-engineering-mcp";
    const principal="serviceAccount:"+SA, tempRole="roles/run.admin";
    const temporaryUntil=new Date(Date.now()+12*60*1000).toISOString();
    const condition={title:"sandy_mcp_ingress_temporary",description:"Twelve-minute bound for MCP ingress setup",expression:'request.time < timestamp("'+temporaryUntil+'")'};
    const getProject=async()=>{const q=await fetch(projectUrl+":getIamPolicy",{method:"POST",headers,body:JSON.stringify({options:{requestedPolicyVersion:3}}),signal:AbortSignal.timeout(13000)});return {status:q.status,data:await q.json().catch(()=>({}))}};
    const setProject=async(policy:any)=>{const q=await fetch(projectUrl+":setIamPolicy",{method:"POST",headers,body:JSON.stringify({policy,updateMask:"bindings,etag,version"}),signal:AbortSignal.timeout(16000)});return {status:q.status,data:await q.json().catch(()=>({}))}};
    const before=await getProject();
    if(before.status!==200||!before.data.etag||!Array.isArray(before.data.bindings))return reply({ok:false,error:"iam_project_versioned_policy_required",status:before.status},before.status===200?409:before.status);
    const priorRole=before.data.bindings.some((b:any)=>b.role===tempRole&&b.members?.includes(principal)&&!b.condition);
    let temporaryGrantAdded=false;
    if(!priorRole){
      const next=structuredClone(before.data);next.version=3;
      next.bindings.push({role:tempRole,members:[principal],condition});
      const applied=await setProject(next);
      if(applied.status!==200)return reply({ok:false,error:"temporary_cloud_run_admin_grant_failed",http_status:applied.status,reason:String(applied.data?.error?.message||"").slice(0,240)},applied.status);
      temporaryGrantAdded=true;
    }
    let ingressResult:any={ok:false,error:"ingress_not_attempted"};
    try{
      const q=await fetch(serviceUrl+":getIamPolicy",{method:"GET",headers,signal:AbortSignal.timeout(14000)});
      const policy=await q.json().catch(()=>({}));
      if(!q.ok){ingressResult={ok:false,error:"service_policy_read_failed",http_status:q.status,reason:String(policy?.error?.message||"").slice(0,240)};}
      else{
        const already=(policy.bindings||[]).some((b:any)=>b.role==="roles/run.invoker"&&b.members?.includes("allUsers"));
        if(already)ingressResult={ok:true,already_public:true};
        else{
          const updated=structuredClone(policy);updated.bindings=updated.bindings||[];
          const entry=updated.bindings.find((b:any)=>b.role==="roles/run.invoker"&&!b.condition);
          if(entry)entry.members=[...new Set([...(entry.members||[]),"allUsers"])];
          else updated.bindings.push({role:"roles/run.invoker",members:["allUsers"]});
          const set=await fetch(serviceUrl+":setIamPolicy",{method:"POST",headers,body:JSON.stringify({policy:updated}),signal:AbortSignal.timeout(16000)});
          const result=await set.json().catch(()=>({}));
          ingressResult=set.ok?{ok:true,public_invoker_granted:true}:{ok:false,error:"cloud_run_invoker_grant_failed",http_status:set.status,reason:String(result?.error?.message||"").slice(0,240)};
        }
      }
    }catch(e){ingressResult={ok:false,error:"ingress_operation_unavailable"};}
    let temporaryGrantRemoved=!temporaryGrantAdded;
    if(temporaryGrantAdded){
      const current=await getProject();
      if(current.status===200&&Array.isArray(current.data.bindings)&&current.data.etag){
        const adjusted=structuredClone(current.data);
        adjusted.bindings=adjusted.bindings.filter((b:any)=>!(b.role===tempRole&&b.condition?.title===condition.title&&b.condition?.expression===condition.expression&&b.members?.includes(principal)));
        const removed=await setProject(adjusted);
        temporaryGrantRemoved=removed.status===200;
      }
    }
    return reply({ok:ingressResult.ok&&temporaryGrantRemoved,ingress:ingressResult,temporary_role_removed:temporaryGrantRemoved,temporary_expiry:temporaryGrantRemoved?null:temporaryUntil,verification_required:true},ingressResult.ok&&temporaryGrantRemoved?200:409);
  }
  if(action==="mcp_endpoint_probe"){
    const url="https://sandy-engineering-mcp-4pqn6jsfxq-ew.a.run.app";
    const checks=await Promise.all([
      fetch(url+"/healthz",{signal:AbortSignal.timeout(14000)}).then(async x=>({name:"healthz",status:x.status,body:(await x.text()).slice(0,250)})).catch(()=>({name:"healthz",status:0,body:"network_unavailable"})),
      fetch(url+"/mcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"}),signal:AbortSignal.timeout(14000)}).then(async x=>({name:"unauthenticated_tools",status:x.status,body:(await x.text()).slice(0,200)})).catch(()=>({name:"unauthenticated_tools",status:0,body:"network_unavailable"}))
    ]);
    const probe=await fetch("https://cloudresourcemanager.googleapis.com/v1/projects/"+P+":testIamPermissions",{method:"POST",headers:{authorization:"Bearer "+i.accessToken,"content-type":"application/json"},body:JSON.stringify({permissions:["run.services.setIamPolicy","run.services.getIamPolicy"]}),signal:AbortSignal.timeout(14000)});
    const grants=await probe.json().catch(()=>({}));
    return reply({ok:true,checks,cloud_run_iam_permissions:grants.permissions||[],iam_probe_http:probe.status});
  }
  if(action==="mcp_cloud_run_deploy"){
    const changeId=String(input.change_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(changeId))return reply({error:"approved_change_required"},400);
    const ch=await db.from("sandy_engineering_changes").select("status,requested_by").eq("id",changeId).maybeSingle();
    if(ch.error||ch.data?.status!=="approved"||ch.data.requested_by!=="ffba8e24-f452-44c8-ba9d-228b8657e3cc")return reply({error:"approved_owner_change_required"},403);
    const image="europe-west1-docker.pkg.dev/"+P+"/sandy-mcp/sandy-engineering-mcp:fc3a8554ac7a-fix2";
    const build=await fetch("https://cloudbuild.googleapis.com/v1/projects/"+P+"/builds/d48f396c-70c9-4c39-befe-df4fa43e28e0",{headers:{authorization:"Bearer "+i.accessToken},signal:AbortSignal.timeout(12000)});
    const b=await build.json().catch(()=>({}));
    if(!build.ok||b.status!=="SUCCESS"||!Array.isArray(b.images)||!b.images.includes(image))return reply({ok:false,error:"verified_successful_build_required",build_status:String(b.status||"unknown")},409);
    const api="https://run.googleapis.com/v2/projects/"+P+"/locations/europe-west1/services";
    const headers={authorization:"Bearer "+i.accessToken,"content-type":"application/json"};
    const current=await fetch(api+"/sandy-engineering-mcp",{headers,signal:AbortSignal.timeout(12000)});
    if(current.ok)return reply({ok:true,service_exists:true,deploy_not_repeated:true,verification_required:true});
    if(current.status!==404)return reply({ok:false,error:"cloud_run_current_lookup_failed",status:current.status},current.status);
    const service={template:{serviceAccount:"sandy-mcp-runtime@"+P+".iam.gserviceaccount.com",containers:[{image,ports:[{containerPort:8787}],resources:{limits:{cpu:"1",memory:"512Mi"}}}],scaling:{minInstanceCount:0,maxInstanceCount:2}},ingress:"INGRESS_TRAFFIC_ALL",labels:{"sandy-component":"engineering-mcp"}};
    const resp=await fetch(api+"?serviceId=sandy-engineering-mcp",{method:"POST",headers,body:JSON.stringify(service),signal:AbortSignal.timeout(22000)});
    const value=await resp.json().catch(()=>({}));
    if(!resp.ok)return reply({ok:false,error:"cloud_run_create_failed",http_status:resp.status,reason:String(value?.error?.message||"").slice(0,280)},resp.status);
    return reply({ok:true,operation_name:String(value.name||"").slice(0,300),accepted:true,service:"sandy-engineering-mcp",verified_build_id:"d48f396c-70c9-4c39-befe-df4fa43e28e0",verification_required:true});
  }
  if(action==="mcp_container_build"||action==="mcp_build_status"){
    const changeId=String(input.change_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(changeId))return reply({error:"approved_change_required"},400);
    const ch=await db.from("sandy_engineering_changes").select("status,requested_by").eq("id",changeId).maybeSingle();
    if(ch.error||ch.data?.status!=="approved"||ch.data.requested_by!=="ffba8e24-f452-44c8-ba9d-228b8657e3cc")return reply({error:"approved_owner_change_required"},403);
    const headers={authorization:"Bearer "+i.accessToken,"content-type":"application/json"};
    const buildBase="https://cloudbuild.googleapis.com/v1/projects/"+P+"/builds";
    if(action==="mcp_build_status"){
      const id=String(input.build_id||"");
      if(!/^[a-z0-9-]{12,80}$/i.test(id))return reply({error:"invalid_build_id"},400);
      const rr=await fetch(buildBase+"/"+id,{headers,signal:AbortSignal.timeout(16000)});
      const data=await rr.json().catch(()=>({}));
      return reply({ok:rr.ok,http_status:rr.status,id:data.id||id,status:data.status||null,images:data.images||[],log_url:data.logUrl||null,reason:String(data?.error?.message||"").slice(0,260),failure_info:data.failureInfo||null,service_account:data.serviceAccount||null,steps:(data.steps||[]).map((x:any)=>({name:x.name,status:x.status,exitCode:x.exitCode})).slice(0,6)},rr.ok?200:rr.status);
    }
    const sha="fc3a8554ac7ab72b590b0cb9a4a85bad3f9ff879";
    const image="europe-west1-docker.pkg.dev/"+P+"/sandy-mcp/sandy-engineering-mcp:"+sha.slice(0,12)+"-fix2";
    const archive="https://github.com/ausstyle/web-staging/archive/"+sha+".tar.gz";
    const script="set -eu; wget -q -O /workspace/source.tar.gz "+archive+"; mkdir -p /workspace/source; tar -xzf /workspace/source.tar.gz -C /workspace/source --strip-components=1; test -f /workspace/source/services/sandy-engineering-mcp/Dockerfile; cp -r /workspace/source/services/sandy-engineering-mcp /workspace/mcp";
    const config={steps:[
      {name:"alpine:3.21",entrypoint:"sh",args:["-c",script]},
      {name:"gcr.io/cloud-builders/docker",args:["build","-t",image,"/workspace/mcp"]},
      {name:"gcr.io/cloud-builders/docker",args:["push",image]}
    ],images:[image],timeout:"1200s",options:{logging:"CLOUD_LOGGING_ONLY"},tags:["sandy-mcp","engineering-control"]};
    const rr=await fetch(buildBase,{method:"POST",headers,body:JSON.stringify(config),signal:AbortSignal.timeout(23000)});
    const data=await rr.json().catch(()=>({}));
    if(!rr.ok)return reply({ok:false,error:"cloud_build_submit_failed",http_status:rr.status,reason:String(data?.error?.message||"").slice(0,350)},rr.status);
    return reply({ok:true,accepted:true,build_id:data.metadata?.build?.id||data.id||null,operation_name:data.name||null,image,source_sha:sha,verification_required:true});
  }
  if(action==="mcp_build_bootstrap"){
    const changeId=String(input.change_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(changeId))return reply({error:"approved_change_required"},400);
    const ch=await db.from("sandy_engineering_changes").select("status,requested_by").eq("id",changeId).maybeSingle();
    if(ch.error||ch.data?.status!=="approved"||ch.data.requested_by!=="ffba8e24-f452-44c8-ba9d-228b8657e3cc")return reply({error:"approved_owner_change_required"},403);
    const headers={authorization:"Bearer "+i.accessToken,"content-type":"application/json"};
    const api="https://serviceusage.googleapis.com/v1/projects/1030223524306/services/cloudbuild.googleapis.com:enable";
    const enabled=await fetch(api,{method:"POST",headers,body:"{}",signal:AbortSignal.timeout(16000)});
    const enabledBody=await enabled.json().catch(()=>({}));
    if(!enabled.ok)return reply({ok:false,phase:"enable_cloudbuild",status:enabled.status,reason:String(enabledBody?.error?.status||"").slice(0,100)},enabled.status);
    const repoBase="https://artifactregistry.googleapis.com/v1/projects/"+P+"/locations/europe-west1/repositories";
    const check=await fetch(repoBase+"/sandy-mcp",{headers,signal:AbortSignal.timeout(12000)});
    if(check.status!==404&&!check.ok)return reply({ok:false,phase:"read_registry",status:check.status},check.status);
    if(check.status===404){
      const created=await fetch(repoBase+"?repositoryId=sandy-mcp",{method:"POST",headers,body:JSON.stringify({format:"DOCKER",description:"Private images for Sandy Engineering MCP"}),signal:AbortSignal.timeout(18000)});
      const data=await created.json().catch(()=>({}));
      if(!created.ok)return reply({ok:false,phase:"create_registry",status:created.status,reason:String(data?.error?.status||"").slice(0,100),cloudbuild_enable_accepted:true},created.status);
      return reply({ok:true,cloudbuild_enable_accepted:true,registry_create_accepted:true,registry_operation:String(data.name||"").slice(0,250),verification_required:true});
    }
    return reply({ok:true,cloudbuild_enable_accepted:true,registry_exists:true,verification_required:true});
  }
  if(action==="mcp_build_permissions"){
    const required=["serviceusage.services.enable","artifactregistry.repositories.create","artifactregistry.repositories.uploadArtifacts","cloudbuild.builds.create","run.services.create"];
    const rr=await fetch("https://cloudresourcemanager.googleapis.com/v1/projects/"+P+":testIamPermissions",{method:"POST",headers:{"authorization":"Bearer "+i.accessToken,"content-type":"application/json"},body:JSON.stringify({permissions:required}),signal:AbortSignal.timeout(14000)});
    const data=await rr.json().catch(()=>({}));
    if(!rr.ok)return reply({ok:false,error:"permissions_probe_failed",status:rr.status},rr.status);
    return reply({ok:true,granted:data.permissions||[],missing:required.filter(x=>!(data.permissions||[]).includes(x))});
  }
  if(action==="mcp_build_preflight"){
    const headers={authorization:"Bearer "+i.accessToken};
    const urls=[
      ["cloud_build","https://cloudbuild.googleapis.com/v1/projects/"+P+"/locations/europe-west1/builds?pageSize=1"],
      ["artifact_registry","https://artifactregistry.googleapis.com/v1/projects/"+P+"/locations/europe-west1/repositories/sandy-mcp"],
      ["runtime_account","https://iam.googleapis.com/v1/projects/"+P+"/serviceAccounts/sandy-mcp-runtime@"+P+".iam.gserviceaccount.com"]
    ];
    const checks=await Promise.all(urls.map(async ([name,url])=>{
      try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(14000)});const b=r.ok?{}:await r.json().catch(()=>({}));return {name,status:r.status,reason:String(b?.error?.status||"").slice(0,90),message:String(b?.error?.message||"").slice(0,200)};}
      catch{return{name,status:0,reason:"request_unavailable"}}
    }));
    return reply({ok:true,project:P,region:"europe-west1",checks});
  }
  if(action==="cloud_run_permissions"){
    const resource="projects/"+P;
    const permissions=["run.services.create","run.services.get","run.services.update","run.operations.get","cloudbuild.builds.create","serviceusage.services.use","iam.serviceAccounts.actAs"];
    const check=await fetch("https://cloudresourcemanager.googleapis.com/v1/projects/"+P+":testIamPermissions",{method:"POST",headers:{"authorization":"Bearer "+i.accessToken,"content-type":"application/json"},body:JSON.stringify({permissions}),signal:AbortSignal.timeout(15000)});
    const data=await check.json().catch(()=>({}));
    if(!check.ok)return reply({ok:false,check_http:check.status,google_reason:String(data?.error?.status||"").slice(0,80),google_message:String(data?.error?.message||"").slice(0,220)},check.status);
    return reply({ok:true,project:P,granted:data.permissions||[],missing:permissions.filter(x=>!(data.permissions||[]).includes(x))});
  }
  if(action==="video_network_preflight"){
    const headers={authorization:"Bearer "+i.accessToken};
    const vmUrl="https://compute.googleapis.com/compute/v1/projects/"+P+"/zones/"+Z+"/instances/sandy-video";
    const vmResponse=await fetch(vmUrl,{headers,signal:AbortSignal.timeout(16000)});
    if(!vmResponse.ok)return reply({ok:false,stage:"vm",google_http:vmResponse.status},502);
    const vm=await vmResponse.json();
    const region="europe-west1";
    const [addresses,routers,firewalls]=await Promise.all([
      fetch("https://compute.googleapis.com/compute/v1/projects/"+P+"/regions/"+region+"/addresses",{headers,signal:AbortSignal.timeout(16000)}),
      fetch("https://compute.googleapis.com/compute/v1/projects/"+P+"/regions/"+region+"/routers",{headers,signal:AbortSignal.timeout(16000)}),
      fetch("https://compute.googleapis.com/compute/v1/projects/"+P+"/global/firewalls",{headers,signal:AbortSignal.timeout(16000)})
    ]);
    const [a,r,f]=await Promise.all([addresses.json().catch(()=>({})),routers.json().catch(()=>({})),firewalls.json().catch(()=>({}))]);
    return reply({ok:true,vm:"sandy-video",vm_status:vm.status,external_ip:vm.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP||null,network_tags:vm.tags?.items||[],regional_addresses_http:addresses.status,reserved_addresses:(a.items||[]).filter((v:any)=>v.name.startsWith("sandy-video")).map((v:any)=>({name:v.name,address:v.address,status:v.status})),routers_http:routers.status,nat_routers:(r.items||[]).filter((v:any)=>(v.nats||[]).length).map((v:any)=>v.name),firewalls_http:firewalls.status,video_firewall_rules:(f.items||[]).filter((v:any)=>v.name.startsWith("sandy-video")).map((v:any)=>({name:v.name,direction:v.direction,disabled:v.disabled,allowed:v.allowed,targetTags:v.targetTags})),changes_applied:false});
  }
  if(action==="cloud_run_status"){
    const endpoint="https://run.googleapis.com/v2/projects/"+P+"/locations/europe-west1/services/sandy-engineering-mcp";
    const status=await fetch(endpoint,{method:"GET",headers:{authorization:"Bearer "+i.accessToken},signal:AbortSignal.timeout(15000)});
    if(status.status===404)return reply({ok:true,service_exists:false,project:P,region:"europe-west1",service:"sandy-engineering-mcp"});
    if(status.status===403){const e=await status.json().catch(()=>({}));const d=e?.error||{};return reply({ok:false,error:"cloud_run_permission_denied",project:P,region:"europe-west1",google_code:d.code||403,google_status:String(d.status||"").slice(0,80),google_reason:Array.isArray(d.details)?d.details.map((x:any)=>String(x.reason||"").slice(0,120)).filter(Boolean):[],google_message:String(d.message||"").slice(0,350)},403);}
    if(!status.ok)return reply({ok:false,error:"cloud_run_status_http_"+status.status},502);
    const service=await status.json();
    return reply({ok:true,service_exists:true,name:service.name,uri:service.uri||null,conditions:service.conditions||[],latest_ready_revision:service.latestReadyRevision||null});
  }

  const base="https://compute.googleapis.com/compute/v1/projects/"+P+"/zones/"+Z+"/instances";
  const windows=false;
  const vmName=action==="video_status"?"sandy-video":"sandy-deploy";
  if(action==="verify_video"){
   const jobId=String(input.job_id||"");
   if(!/^[0-9a-f-]{36}$/i.test(jobId))return reply({error:"invalid_job_id"},400);
   const {data:job}=await db.from("sandy_deployment_jobs").select("id,status,target,operation,provider,result").eq("id",jobId).maybeSingle();
   if(!job||job.provider!=="google_cloud"||job.operation!=="create_vm"||job.target!=="sandy-video"||job.status!=="running"||job.result?.accepted!==true)return reply({error:"no_accepted_video_provision_to_verify"},409);
   const result=await fetch(base+"/sandy-video",{headers:auth,signal:AbortSignal.timeout(22000)});
   const vm=await result.json().catch(()=>({}));
   if(!result.ok||vm.status!=="RUNNING")return reply({ok:false,verified:false,http_status:result.status,vm_status:vm.status||null},409);
   const record={...job.result,verified:true,instance_id:vm.id,vm_status:vm.status,verified_at:new Date().toISOString()};
   const saved=await db.from("sandy_deployment_jobs").update({status:"succeeded",result:record,finished_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",jobId).eq("status","running").select("id").maybeSingle();
   if(saved.error||!saved.data)return reply({error:"verification_persistence_failed"},503);
   await db.from("sandy_deployment_events").insert({job_id:jobId,event_type:"vm_verified_running",actor:"sandy_video_provisioner",details:{instance_id:vm.id,vm_status:vm.status}});
   return reply({ok:true,verified:true,job_id:jobId,instance_id:vm.id,status:vm.status});
  }
  if(action==="create_video"){
   const jobId=String(input.job_id||"");
   if(!/^[0-9a-f-]{36}$/i.test(jobId))return reply({error:"invalid_job_id"},400);
   const {data:job,error:je}=await db.from("sandy_deployment_jobs").select("id,status,provider,operation,target,payload,engineering_change_id,approved_by,approved_at").eq("id",jobId).maybeSingle();
   if(je||!job||job.provider!=="google_cloud"||job.operation!=="create_vm"||job.target!=="sandy-video"||job.payload?.profile!=="livekit-dedicated-v1")return reply({error:"invalid_video_job"},403);
   if(job.status!=="approved"||!job.approved_by||!job.approved_at||!job.engineering_change_id)return reply({error:"engineering_and_job_approval_required"},409);
   const {data:change}=await db.from("sandy_engineering_changes").select("status").eq("id",job.engineering_change_id).maybeSingle();
   if(!change||!["approved","implementing"].includes(change.status))return reply({error:"engineering_change_not_approved"},409);
   const {data:target}=await db.from("sandy_cloud_targets").select("project_id,zone,protected").eq("name","sandy-video").maybeSingle();
   if(target?.project_id!==P||target.zone!==Z||target.protected!==true)return reply({error:"video_target_policy_failed"},409);
   const existing=await fetch(base+"/sandy-video",{headers:auth,signal:AbortSignal.timeout(20000)});
   if(existing.ok)return reply({error:"video_vm_already_exists"},409);
   if(existing.status!==404)return reply({error:"google_preflight_failed",http_status:existing.status},502);
   const claim=await db.from("sandy_deployment_jobs").update({status:"running",started_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",jobId).eq("status","approved").select("id").maybeSingle();
   if(claim.error||!claim.data)return reply({error:"job_claim_failed"},409);
   const body={name:"sandy-video",machineType:"zones/"+Z+"/machineTypes/e2-standard-2",labels:{owner:"sandy-ai",purpose:"livekit-video"},disks:[{boot:true,autoDelete:true,initializeParams:{sourceImage:"projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64",diskSizeGb:"40",diskType:"zones/"+Z+"/diskTypes/pd-balanced"}}],networkInterfaces:[{network:"global/networks/default"}],serviceAccounts:[{email:VM_SA,scopes:["https://www.googleapis.com/auth/cloud-platform"]}],shieldedInstanceConfig:{enableSecureBoot:true,enableVtpm:true,enableIntegrityMonitoring:true},metadata:{items:[{key:"block-project-ssh-keys",value:"TRUE"},{key:"enable-oslogin",value:"TRUE"}]}};
   const create=await fetch(base,{method:"POST",headers:auth,body:JSON.stringify(body),signal:AbortSignal.timeout(28000)});
   const result=await create.json().catch(()=>({}));
   const receipt={vm:"sandy-video",google_operation:result.name||null,accepted:create.ok,verified:false};
   const save=await db.from("sandy_deployment_jobs").update({result:receipt,...(!create.ok?{status:"failed",error:"google_compute_http_"+create.status,finished_at:new Date().toISOString()}:{})}).eq("id",jobId).eq("status","running");
   if(save.error)return reply({error:"provision_result_persistence_failed",google_http:create.status},503);
   await db.from("sandy_deployment_events").insert({job_id:jobId,event_type:create.ok?"provision_accepted":"provision_failed",actor:"sandy_video_provisioner",details:receipt});
   return reply({ok:create.ok,job_id:jobId,google_http:create.status,...receipt},create.ok?202:502);
  }
  if(action==="stop_windows"||action==="start_windows"){
    const vm=await fetch(base+"/sandy-windows",{headers:auth,signal:AbortSignal.timeout(22000)});
    const d=await vm.json().catch(()=>({}));
    if(!vm.ok)return reply({ok:false,stage:"get_windows",http:vm.status,error:String(d.error?.message??"").slice(0,350)},502);
    const marker=String((d.metadata?.items??[]).find((v:any)=>v.key==="windows-startup-script-ps1")?.value??"");
    if(!marker.includes("SANDY_SETUP_FAILED")&&!marker.includes("SANDY_DESKTOP_AGENT_SETUP_FAILED"))return reply({ok:false,error:"setup_not_staged"},409);
    const shouldStop=action==="stop_windows";
    if((shouldStop&&d.status==="TERMINATED")||(!shouldStop&&d.status==="RUNNING"))return reply({ok:true,stage:"already_target_state",vm_status:d.status});
    if((shouldStop&&d.status!=="RUNNING")||(!shouldStop&&d.status!=="TERMINATED"))return reply({ok:false,stage:"transition_in_progress",vm_status:d.status},409);
    const op=await fetch(base+"/sandy-windows/"+(shouldStop?"stop":"start"),{method:"POST",headers:auth,body:"{}",signal:AbortSignal.timeout(30000)});
    const v=await op.json().catch(()=>({}));
    if(!op.ok)return reply({ok:false,stage:action,http:op.status,error:String(v.error?.message??"").slice(0,450)},502);
    return reply({ok:true,stage:action,operation:v.name,status:v.status},202);
  }
  if(action==="setup_windows"||action==="setup_windows_agent"||action==="windows_setup_status"){
   const vm=await fetch(base+"/sandy-windows",{headers:auth,signal:AbortSignal.timeout(25000)});
   const detail=await vm.json().catch(()=>({}));
   if(!vm.ok)return reply({ok:false,stage:"windows_lookup",http:vm.status,error:String(detail.error?.message??"").slice(0,300)},502);
   if(action==="windows_setup_status"){
    const g=await fetch(base+"/sandy-windows/getGuestAttributes?queryPath=sandy%2F",{headers:auth,signal:AbortSignal.timeout(18000)});
    const v=await g.json().catch(()=>({}));
    return reply({ok:g.ok,vm_status:detail.status,guest_http:g.status,guest_attributes:g.ok?v.queryValue??v:null,error:g.ok?null:String(v.error?.message??"").slice(0,250)},g.ok?200:502);
   }
   const previous=Array.isArray(detail.metadata?.items)?detail.metadata.items:[];
   if(previous.find((v:any)=>v.key==="windows-startup-script-ps1")&&action!=="setup_windows_agent"&&!input.replace_existing)return reply({ok:false,error:"existing_windows_startup_script_would_be_overwritten"},409);
   const changed=previous.filter((v:any)=>!["windows-startup-script-ps1","enable-guest-attributes"].includes(v.key));
   changed.push({key:"windows-startup-script-ps1",value:action==="setup_windows_agent"?"$ErrorActionPreference='Stop'\n$root='C:\\Sandy\\automation'\nNew-Item -Path $root -ItemType Directory -Force | Out-Null\n$log=Join-Path $root 'agent-setup.log'\nStart-Transcript -Path $log -Append | Out-Null\nfunction Publish([string]$s,[string]$d) {\n try {\n  $v=@{status=$s;details=$d;time=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress\n  Invoke-RestMethod -Method PUT -Headers @{'Metadata-Flavor'='Google'} -Uri 'http://metadata.google.internal/computeMetadata/v1/instance/guest-attributes/sandy/agent_setup' -ContentType 'text/plain' -Body $v -TimeoutSec 8 | Out-Null\n }catch{Write-Output \"Agent setup status unavailable\"}\n}\ntry {\n $agent=Join-Path $root 'sandy_agent.py'\n $source=@'\nimport base64, ctypes, io, json, os, sys, time, traceback, urllib.parse, webbrowser\nimport requests, pyautogui\nVM='sandy-windows'\nENDPOINT='https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-windows-control'\nMETADATA='http://metadata.google.internal/computeMetadata/v1/instance/'\nHEAD={'Metadata-Flavor':'Google'}\nROOT=r'C:\\Sandy\\automation'\nLOG=os.path.join(ROOT,'agent.log')\nos.makedirs(ROOT,exist_ok=True)\npyautogui.FAILSAFE=True\ndef log(s):\n try:\n  with open(LOG,'a',encoding='utf-8') as f:f.write(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())+' '+str(s)[:700]+'\\n')\n except:pass\nh=ctypes.windll.kernel32.CreateMutexW(None,False,'Local\\\\SandyWindowsAgent')\nif ctypes.windll.kernel32.GetLastError()==183:sys.exit(0)\ndef report(state):\n try:\n  data=json.dumps({'status':state,'time':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})\n  requests.put(METADATA+'guest-attributes/sandy/agent',headers=HEAD,data=data,timeout=5)\n except Exception as e:log('report '+repr(e))\ndef token():\n url=METADATA+'service-accounts/default/identity?audience='+urllib.parse.quote(ENDPOINT,safe='')+'&format=full'\n r=requests.get(url,headers=HEAD,timeout=12);r.raise_for_status();return r.text\nJWT='';REFRESH=0\ndef request(action,**kwargs):\n global JWT,REFRESH\n now=time.time()\n if now>REFRESH:\n  JWT=token();REFRESH=now+1800\n r=requests.post(ENDPOINT,headers={'authorization':'Bearer '+JWT},json={'action':action,**kwargs},timeout=35)\n if r.status_code==403:\n  JWT=token();REFRESH=time.time()+1800\n  r=requests.post(ENDPOINT,headers={'authorization':'Bearer '+JWT},json={'action':action,**kwargs},timeout=35)\n r.raise_for_status()\n return r.json()\ndef execute(command):\n act=command['operation'];p=command.get('payload') or {}\n if act=='screenshot':\n  image=pyautogui.screenshot().convert('RGB')\n  image.thumbnail((1280,900))\n  out=io.BytesIO();image.save(out,format='JPEG',quality=64,optimize=True)\n  return {'screenshot_base64':base64.b64encode(out.getvalue()).decode('ascii'),'width':image.width,'height':image.height}\n if act=='open_url':\n  u=urllib.parse.urlparse(p['url'])\n  if u.scheme!='https' or not u.netloc:raise ValueError('non_https_url')\n  webbrowser.open(p['url'],new=2)\n  return {'operation':'open_url','hostname':u.hostname}\n if act=='click':\n  pyautogui.click(x=int(p['x']),y=int(p['y']),clicks=1)\n  return {'operation':'click'}\n if act=='type':\n  t=p['text'];pyautogui.write(t,interval=0.006)\n  return {'operation':'type','characters':len(t)}\n if act=='key':\n  key=p['key']\n  if key=='ctrl+l':pyautogui.hotkey('ctrl','l')\n  elif key=='escape':pyautogui.press('esc')\n  else:pyautogui.press(key)\n  return {'operation':'key'}\n if act=='scroll':\n  pyautogui.scroll(int(p['amount']))\n  return {'operation':'scroll'}\n raise ValueError('unsupported_action')\ndef main():\n report('started')\n lastbeat=0;consecutive=0\n while True:\n  try:\n   if time.time()-lastbeat>100:\n    w,h=pyautogui.size()\n    request('heartbeat',screen_width=w,screen_height=h,session=os.environ.get('SESSIONNAME',''))\n    lastbeat=time.time()\n    if consecutive:log('Reconnected')\n    consecutive=0;report('connected')\n   work=request('poll')\n   command=work.get('command')\n   if command:\n    try:\n     result=execute(command)\n     request('finish',id=command['id'],ok=True,result=result)\n     log('completed '+command['operation']+' '+command['id'])\n    except Exception as e:\n     log('action_failed '+str(e)[:200])\n     request('finish',id=command['id'],ok=False,error=str(e)[:350],result={})\n    time.sleep(2)\n   else:time.sleep(18)\n  except Exception as e:\n   consecutive+=1;log('connection_error '+repr(e)[:230])\n   if consecutive in (1,4,12):report('connection_error')\n   time.sleep(min(30,5*consecutive))\nif __name__=='__main__':\n try:main()\n except Exception:\n  log(traceback.format_exc())\n  report('crashed')\n  raise\n\n'@\n Set-Content -LiteralPath $agent -Value $source -Encoding UTF8 -Force\n $pythonw='C:\\Program Files\\Python313\\pythonw.exe'\n if(-not (Test-Path $pythonw)){throw 'pythonw.exe not found'}\n $startup='\"'+$pythonw+'\" \"'+$agent+'\"'\n $reg='HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'\n New-ItemProperty -Path $reg -Name SandyDesktopAgent -Value $startup -PropertyType String -Force | Out-Null\n Publish 'installed' 'Agent registered for interactive RDP login; awaiting user sign-in'\n Write-Output 'Sandy desktop agent registered for user logon'\n}catch{\n Publish 'failed' $_.Exception.Message\n Write-Output \"SANDY_DESKTOP_AGENT_SETUP_FAILED: $($_.Exception.Message)\"\n exit 1\n}finally{Stop-Transcript | Out-Null}\n":"$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n$root='C:\\Sandy\\automation'\nNew-Item -ItemType Directory -Path $root -Force | Out-Null\n$log=Join-Path $root 'setup.log'\nStart-Transcript -Path $log -Append | Out-Null\nfunction Publish([string]$status,[string]$details) {\n try {\n  $data=@{status=$status;details=$details;time=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress\n  Invoke-RestMethod -Method PUT -Headers @{'Metadata-Flavor'='Google'} -Uri 'http://metadata.google.internal/computeMetadata/v1/instance/guest-attributes/sandy/setup' -ContentType 'text/plain' -Body $data -TimeoutSec 8 | Out-Null\n }catch{Write-Output \"Guest attribute report failed: $($_.Exception.Message)\"}\n}\ntry {\n if(Test-Path (Join-Path $root 'installed.ok')) {\n  Publish 'completed' 'Existing installation verified on startup'\n  exit 0\n }\n Publish 'running' 'Installing Windows browser automation prerequisites'\n [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12\n $nodeIndex=Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 30\n $lts=$nodeIndex | Where-Object {$_.lts -and $_.lts -ne $false} | Select-Object -First 1\n if(-not $lts){throw 'Could not resolve Node LTS from official index'}\n $nodeVersion=$lts.version\n $nodeMsi=Join-Path $root 'node.msi'\n Invoke-WebRequest -Uri \"https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-x64.msi\" -OutFile $nodeMsi -UseBasicParsing -TimeoutSec 180\n $nodeInstall=Start-Process msiexec.exe -ArgumentList @('/i',\"$nodeMsi\",'/qn','/norestart') -Wait -PassThru\n if($nodeInstall.ExitCode -notin @(0,3010)){throw \"Node MSI failed: $($nodeInstall.ExitCode)\"}\n $env:Path=\"C:\\Program Files\\nodejs;$env:Path\"\n $node= & 'C:\\Program Files\\nodejs\\node.exe' --version\n Publish 'running' \"Node $node installed; installing Python\"\n $pyVersion='3.13.9'\n $pyInstaller=Join-Path $root 'python.exe'\n Invoke-WebRequest -Uri \"https://www.python.org/ftp/python/$pyVersion/python-$pyVersion-amd64.exe\" -OutFile $pyInstaller -UseBasicParsing -TimeoutSec 180\n $py=Start-Process $pyInstaller -ArgumentList @('/quiet','InstallAllUsers=1','PrependPath=1','Include_pip=1','Include_test=0') -Wait -PassThru\n if($py.ExitCode -notin @(0,3010)){throw \"Python setup failed: $($py.ExitCode)\"}\n $python='C:\\Program Files\\Python313\\python.exe'\n if(-not (Test-Path $python)){throw 'Python executable absent after install'}\n & $python -m pip install --disable-pip-version-check --no-input pyautogui pillow pywin32 mss psutil requests playwright | Out-Null\n if($LASTEXITCODE -ne 0){throw \"Python packages failed with $LASTEXITCODE\"}\n Publish 'running' 'Python installed; installing Playwright browser'\n & 'C:\\Program Files\\nodejs\\npm.cmd' install --prefix $root playwright --no-audit --no-fund\n if($LASTEXITCODE -ne 0){throw \"npm install failed with $LASTEXITCODE\"}\n & 'C:\\Program Files\\nodejs\\npx.cmd' --prefix $root playwright install chromium\n if($LASTEXITCODE -ne 0){throw \"Playwright browser installation failed with $LASTEXITCODE\"}\n $pythonVersion=(& $python --version | Out-String).Trim()\n $summary=\"Node=$node; Python=$pythonVersion; Playwright Chromium installed; RDP desktop agent authentication pending\"\n Set-Content -Path (Join-Path $root 'installed.ok') -Value $summary\n Publish 'completed' $summary\n}catch {\n $message=$_.Exception.Message\n Write-Output \"SANDY_SETUP_FAILED: $message\"\n Publish 'failed' $message\n exit 1\n}finally{Stop-Transcript | Out-Null}\n"},{key:"enable-guest-attributes",value:"TRUE"});
   const response=await fetch(base+"/sandy-windows/setMetadata",{method:"POST",headers:auth,body:JSON.stringify({fingerprint:detail.metadata.fingerprint,items:changed}),signal:AbortSignal.timeout(25000)});
   const op=await response.json().catch(()=>({}));
   if(!response.ok)return reply({ok:false,stage:"set_metadata",http:response.status,error:String(op.error?.message??"").slice(0,400)},502);
   return reply({ok:true,stage:"metadata_staged",operation:op.name,vm_status:detail.status,next:"restart after operation DONE"},202);
  }
  if(action==="stage_bootstrap"){
    const res=await fetch(base+"/sandy-deploy",{headers:auth});
    const vm=await res.json().catch(()=>({}));
    if(!res.ok||vm.status!=="RUNNING")return reply({error:"vm_unavailable"},409);
    const items=vm.metadata?.items||[];
    if(items.some((x:any)=>x.key==="startup-script"))return reply({error:"startup_script_exists"},409);
    const script="#!/bin/bash\\nset -e\\nmkdir -p /opt/sandy-deploy\\necho ready > /opt/sandy-deploy/bootstrap-status\\n";
    const change=await fetch(base+"/sandy-deploy/setMetadata",{method:"POST",headers:auth,body:JSON.stringify({fingerprint:vm.metadata.fingerprint,items:[...items,{key:"startup-script",value:script}]})});
    const result=await change.json().catch(()=>({}));
    return reply({ok:change.ok,operation:result.name??null,http:change.status},change.ok?202:502);
  }
  if(action==="bootstrap_serial_status"){
    const res=await fetch(base+"/sandy-deploy/getSerialPortOutput?port=1",{headers:auth,signal:AbortSignal.timeout(20000)});
    const data=await res.json().catch(()=>({}));
    const output=String(data.contents||"");
    return reply({ok:res.ok,google_http:res.status,output_tail:output.slice(-3500),has_bootstrap_marker:output.includes("bootstrap-status")},res.ok?200:502);
  }
  if(action==="reboot_bootstrap"){
    const v=await fetch(base+"/sandy-deploy",{headers:auth,signal:AbortSignal.timeout(20000)});
    const vm=await v.json().catch(()=>({}));
    if(!v.ok||vm.status!=="RUNNING")return reply({error:"vm_not_running"},409);
    const items=vm.metadata?.items||[];
    if(!items.some((x:any)=>x.key==="startup-script"))return reply({error:"bootstrap_not_staged"},409);
    const response=await fetch(base+"/sandy-deploy/reset",{method:"POST",headers:auth,signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>({}));
    return reply({ok:response.ok,operation:data.name??null,http:response.status},response.ok?202:502);
  }
  if(action==="enable_guest_reporting"){
    const v=await fetch(base+"/sandy-deploy",{headers:auth,signal:AbortSignal.timeout(20000)});
    const vm=await v.json().catch(()=>({}));
    if(!v.ok)return reply({error:"vm_lookup_failed",http:v.status},502);
    const items=vm.metadata?.items||[];
    if(items.some((x:any)=>x.key==="enable-guest-attributes"&&x.value==="TRUE"))return reply({ok:true,already_enabled:true});
    const updated=[...items.filter((x:any)=>x.key!=="enable-guest-attributes"),{key:"enable-guest-attributes",value:"TRUE"}];
    const response=await fetch(base+"/sandy-deploy/setMetadata",{method:"POST",headers:auth,body:JSON.stringify({fingerprint:vm.metadata?.fingerprint,items:updated}),signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>({}));
    return reply({ok:response.ok,operation:data.name??null,http:response.status},response.ok?202:502);
  }
  if(action==="vm_bootstrap_probe"){
    const v=await fetch(base+"/sandy-deploy",{headers:auth,signal:AbortSignal.timeout(20000)});
    const vm=await v.json().catch(()=>({}));
    if(!v.ok)return reply({ok:false,google_http:v.status},502);
    const keys=(vm.metadata?.items||[]).map((x:any)=>x.key);
    return reply({ok:true,vm_status:vm.status,startup_script_staged:keys.includes("startup-script"),guest_attributes_enabled:keys.includes("enable-guest-attributes"),worker_installed:false});
  }
  if(action==="vm_service_status"){
    const res=await fetch(base+"/sandy-deploy/getGuestAttributes?queryPath=sandy-deploy%2F",{headers:auth,signal:AbortSignal.timeout(20000)});
    const data=await res.json().catch(()=>({}));
    return reply({ok:res.ok,google_http:res.status,guest_attributes:res.ok?data.queryValue??data:null,verified_running:false},res.ok?200:502);
  }
  if(action==="vm_metadata_status"){
    const res=await fetch(base+"/sandy-deploy",{headers:auth,signal:AbortSignal.timeout(20000)});
    const data=await res.json().catch(()=>({}));
    return reply({ok:res.ok,status:data.status,metadata_keys:(data.metadata?.items||[]).map((x:any)=>x.key),http:res.status},res.ok?200:502);
  }
  const get=await fetch(base+"/"+vmName,{headers:auth,signal:AbortSignal.timeout(25000)});
  const detail=await get.json().catch(()=>({}));
  if(get.ok)return reply({ok:true,exists:true,name:vmName,zone:Z,status:detail.status,machine_type:detail.machineType,instance_id:detail.id,network:detail.networkInterfaces?.map((n:any)=>({name:n.network,external_ip_present:Boolean(n.accessConfigs?.[0]?.natIP)}))});
  if(get.status!==404)return reply({ok:false,stage:"lookup",google_http:get.status,error:String(detail.error?.message??"").slice(0,300)},502);
  if(!["create_linux","create_windows"].includes(action))return reply({ok:true,exists:false,name:vmName,zone:Z,windows_supported_on_trial:false});
  const body={
    name:vmName,
    machineType:"zones/"+Z+"/machineTypes/e2-standard-2",
    labels:{owner:"sandy-ai",purpose:"deployment-worker"},
    disks:[{boot:true,autoDelete:true,initializeParams:{sourceImage:windows?"projects/windows-cloud/global/images/family/windows-2022":"projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64",diskSizeGb:windows?"60":"30",diskType:"zones/"+Z+"/diskTypes/pd-balanced"}}],
    networkInterfaces:[{network:"global/networks/default"}],
    serviceAccounts:[{email:VM_SA,scopes:["https://www.googleapis.com/auth/cloud-platform"]}],
    shieldedInstanceConfig:{enableSecureBoot:true,enableVtpm:true,enableIntegrityMonitoring:true},
    scheduling:{automaticRestart:true,onHostMaintenance:"MIGRATE"},
    metadata:{items:windows?[{key:"enable-windows-ssh",value:"FALSE"}]:[{key:"block-project-ssh-keys",value:"TRUE"},{key:"enable-oslogin",value:"TRUE"}]}
  };
  const created=await fetch(base,{method:"POST",headers:auth,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const result=await created.json().catch(()=>({}));
  if(!created.ok)return reply({ok:false,stage:windows?"create_windows":"create_linux",google_http:created.status,error:String(result.error?.message??"").slice(0,550)},502);
  return reply({ok:true,stage:"create_accepted",name:vmName,zone:Z,operation:result.name,status:result.status,notice:"Operation accepted, boot and network verification still required"},202);
 }catch(e){return reply({ok:false,error:String(e instanceof Error?e.message:e).slice(0,500)},503)}
});