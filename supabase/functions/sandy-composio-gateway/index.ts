import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
const headers={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"https://ausstyle.github.io","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"authorization,apikey,content-type"};
const reply=(code:number,data:unknown)=>new Response(JSON.stringify(data),{status:code,headers});
const valid=(s:string)=>/^[a-zA-Z0-9_-]{1,100}$/.test(s);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return reply(405,{error:"post_required"});
 const url=Deno.env.get("SUPABASE_URL")||"",role=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
 if(!url||!role||!anon)return reply(503,{error:"supabase_configuration_missing"});
 const db=createClient(url,role,{auth:{persistSession:false}}),auth=createClient(url,anon,{auth:{persistSession:false}});
 const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 const {data:identity,error:identityError}=await auth.auth.getUser(jwt);
 if(identityError||!identity.user?.email_confirmed_at)return reply(401,{error:"sign_in_required"});
 const {data:account,error:accountError}=await db.from("sandy_memory_portal_accounts").select("customer_id").eq("auth_user_id",identity.user.id).is("revoked_at",null).maybeSingle();
 if(accountError||!account)return reply(403,{error:"customer_access_denied"});
 const customerId=account.customer_id;
 let data:any;try{data=await req.json()}catch{return reply(400,{error:"invalid_json"})}
 const operation=String(data.operation||"status");
 const apiKey=Deno.env.get("COMPOSIO_API_KEY")||"";
 const {data:integration}=await db.from("sandy_ai_integrations").select("enabled").eq("integration_key","composio_connector").maybeSingle();
 if(operation==="v2_awareness"){
  // The authenticated portal account is the only source of customer identity.
  const [conn,companies,caps,flags,policy]=await Promise.all([
   db.from("sandy_composio_connections").select("connected_account_id,toolkit_slug,status,company_id,updated_at").eq("customer_id",customerId).limit(100),
   db.from("sandy_agenda_companies").select("id,name").eq("customer_id",customerId).limit(100),
   db.from("sandy_capability_catalog").select("feature_key,channels,last_verified_at").limit(100),
   db.from("sandy_ai_integrations").select("integration_key,enabled,deployment_status,last_verified_at").limit(100),
   db.from("sandy_v2_runtime_policy").select("policy_key,mode")
  ]);
  if(conn.error||companies.error||caps.error||flags.error||policy.error)return reply(503,{error:"v2_awareness_source_unavailable",
    sources:[conn.error&&"connections",companies.error&&"workspaces",caps.error&&"capabilities",flags.error&&"integrations",policy.error&&"policies"].filter(Boolean)});
  const workspace=data.company_id===null?null:typeof data.company_id==="string"?data.company_id:undefined;
  if(workspace!==undefined&&workspace!==null&&!(companies.data||[]).some((v:any)=>v.id===workspace))return reply(403,{error:"workspace_not_authorized"});
  const activeRecords=(conn.data||[]).filter((c:any)=>String(c.status).toUpperCase()==="ACTIVE");
  let provider_check:"not_requested"|"verified"|"unavailable"="not_requested";
  const upstreamState=new Map<string,string>();
  if(data.verify_provider===true){
   if(apiKey){
    try{
      const result=await fetch("https://backend.composio.dev/api/v3.1/connected_accounts?limit=100&user_ids="+encodeURIComponent("sandy_customer_"+customerId),
       {headers:{"x-api-key":apiKey},signal:AbortSignal.timeout(12000)});
      if(result.ok){
       const body=await result.json().catch(()=>({}));
       const entries=Array.isArray(body.items)?body.items:Array.isArray(body.data)?body.data:[];
       for(const entry of entries){
        if(entry.user_id==="sandy_customer_"+customerId&&typeof entry.id==="string")upstreamState.set(entry.id,String(entry.status||"UNKNOWN").toUpperCase());
       }
       provider_check=body.next_cursor?"unavailable":"verified";
      }else provider_check="unavailable";
    }catch{provider_check="unavailable"}
   }else provider_check="unavailable";
  }
  const connectionStates=activeRecords.filter((c:any)=>workspace===undefined||c.company_id===workspace).map((c:any)=>{
   const remote=provider_check==="verified"?(upstreamState.get(c.connected_account_id)||"NOT_FOUND"):null;
   const effective=provider_check==="verified"?(remote==="ACTIVE"?"provider_confirmed_active":"provider_not_confirmed"):"recorded_active_provider_unverified";
   return {app:c.toolkit_slug,workspace:c.company_id?(companies.data||[]).find((x:any)=>x.id===c.company_id)?.name||"Company":"Personal",
    company_id:c.company_id,status:effective,provider_status:remote,updated_at:c.updated_at,
    chat_execution:c.toolkit_slug==="gmail"?"read_and_confirmed_send_available_in_agent_runtime":"not_verified_available_in_agent_runtime"};
  });
  const {data:administrator}=await db.from("sandy_controller_admins").select("enabled").eq("auth_user_id",identity.user.id).eq("enabled",true).maybeSingle();
  let components:any[]|undefined=undefined;
  if(administrator){
    if(data.refresh_architecture===true){const refreshed=await db.rpc("sandy_v2_refresh_database_inventory");if(refreshed.error)return reply(503,{error:"database_inventory_refresh_failed"});}
    const {data:inventory}=await db.from("sandy_v2_component_inventory").select("component_key,component_type,deployment_state,last_verified_at").limit(400);
    components=inventory||[];
  }
  const policyMap=Object.fromEntries((policy.data||[]).map((p:any)=>[p.policy_key,p.mode]));
  const summary={
   ok:true,v2:true,generated_at:new Date().toISOString(),source:"live_authenticated_sandy_backend",
   customer_scope:"authenticated_customer_only",workspace_scope:workspace===undefined?"all":workspace,
   policy:policyMap,provider_check,
   connections:connectionStates,
   capabilities:(caps.data||[]).map((c:any)=>({feature:c.feature_key,channels:c.channels,last_verified_at:c.last_verified_at})),
   integrations:(flags.data||[]).map((f:any)=>({key:f.integration_key,enabled:f.enabled,configuration_state:f.deployment_status,last_verified_at:f.last_verified_at})),
   system_components:components,
   execution:{composio_generic_tool_execution:false,connection_does_not_imply_execution:true,model_claims_not_evidence:true,production_mutation_not_enabled_by_v2:true}
  };
  const mismatch=connectionStates.filter((x:any)=>x.status==="provider_not_confirmed");
  const awarenessOutcome=mismatch.length?"contradiction":(provider_check==="verified"?"verified":"unverified");
  // Deduplicated finding, not an unapproved self-directed production modification.
  for(const x of mismatch){
    const fingerprint="v2:connection:"+customerId+":"+x.app+":"+(x.company_id||"personal");
    const finding={
      fingerprint,category:"integration_state_discrepancy",severity:"medium",state:"open",
      subject:"Recorded app connection not confirmed by provider",
      explanation:"Sandy records a connection as active but Composio did not report it active. Inspect provider status, sync and permissions before attempting actions.",
      evidence:{app:x.app,provider_status:x.provider_status,provider_check,workspace:x.company_id?"company":"personal"},
      recommendation:"Recheck the connection using a provider-authorised read-only verification, then review the customer-scoped connection sync; do not infer a successful repair.",
      source_type:"sandy_v2_awareness",source_id:fingerprint,updated_at:new Date().toISOString()
    };
    const {error:foundError}=await db.from("sandy_supervisor_findings").upsert(finding,{onConflict:"fingerprint"});
    if(foundError)console.error("v2_findings_write",foundError.code);
  }
  const {error:audit}=await db.from("sandy_v2_awareness_audit").insert({
   customer_id:customerId,channel:"web",request_id:typeof data.request_id==="string"?data.request_id.slice(0,110):null,
   subject:"connected_services",outcome:awarenessOutcome,
   evidence:{provider_check,connections:connectionStates.length,workspaces:companies.data?.length||0,mismatches:mismatch.length}
  });
  if(audit)console.error("v2_awareness_audit",audit.code);
  return reply(200,summary);
 }
 if(operation==="status"){
  const {data:administrator}=await db.from("sandy_controller_admins").select("enabled").eq("auth_user_id",identity.user.id).eq("enabled",true).maybeSingle();
  return reply(200,{ok:true,configured:!!apiKey,enabled:integration?.enabled===true,can_provision:!!administrator,customer_connection_required:true,tool_execution_enabled:false});
 }
 if(operation==="list_companies"){
  const {data:companies,error:e}=await db.from("sandy_agenda_companies").select("id,name").eq("customer_id",customerId).order("name").limit(200);
  if(e)return reply(503,{error:"company_list_unavailable"});
  return reply(200,{ok:true,companies:companies||[]});
 }
 if(operation==="assign_connection"){
  const id=String(data.connected_account_id||"");
  if(!id||id.length>180)return reply(400,{error:"invalid_connection_id"});
  const companyId=data.company_id===null?null:String(data.company_id||"");
  if(companyId!==null){
   if(!/^[0-9a-f-]{36}$/i.test(companyId))return reply(400,{error:"invalid_company_id"});
   const {data:company}=await db.from("sandy_agenda_companies").select("id").eq("customer_id",customerId).eq("id",companyId).maybeSingle();
   if(!company)return reply(403,{error:"company_access_denied"});
  }
  const {data:changed,error:e}=await db.from("sandy_composio_connections").update({company_id:companyId}).eq("customer_id",customerId).eq("connected_account_id",id).select("connected_account_id,company_id").maybeSingle();
  if(e)return reply(503,{error:"assignment_failed"});
  if(!changed)return reply(404,{error:"connection_not_found"});
  return reply(200,{ok:true,connection:changed});
 }
 if(!apiKey)return reply(503,{error:"composio_api_key_not_configured"});
 if(operation==="verify_api_key"){
  const upstream=await fetch("https://backend.composio.dev/api/v3.1/toolkits?limit=1",{headers:{"x-api-key":apiKey},signal:AbortSignal.timeout(15000)}).catch(()=>null);
  if(!upstream)return reply(502,{ok:false,error:"composio_unreachable"});
  return reply(upstream.ok?200:502,{ok:upstream.ok,configured:true,provider_status:upstream.status,read_only:true});
 }
 if(operation==="provision_managed_apps"){
  const {data:admin,error:adminError}=await db.from("sandy_controller_admins").select("role,enabled").eq("auth_user_id",identity.user.id).eq("enabled",true).maybeSingle();
  if(adminError||!admin)return reply(403,{error:"administrator_only"});
  if(!apiKey)return reply(503,{error:"composio_api_key_not_configured"});
  const allowed=["gmail","googledrive","googlecalendar","googlecontacts","googledocs","googlesheets","slack","hubspot","notion","xero","shopify","github","outlook","microsoft_teams","dropbox"];
  const slugs=Array.isArray(data.toolkit_slugs)?[...new Set(data.toolkit_slugs.map(String))]:[];
  if(!slugs.length||slugs.length>3||slugs.some((slug:string)=>!allowed.includes(slug)))return reply(400,{error:"invalid_setup_batch"});
  const upstream=await fetch("https://backend.composio.dev/api/v3.1/auth_configs?limit=200",{headers:{"x-api-key":apiKey},signal:AbortSignal.timeout(20000)}).catch(()=>null);
  if(!upstream?.ok)return reply(502,{error:"auth_configs_list_failed",provider_status:upstream?.status||null});
  const existing=await upstream.json().catch(()=>({}));
  const existingItems=Array.isArray(existing.items)?existing.items:Array.isArray(existing.data)?existing.data:[];
  const results:any[]=[];
  for(const slug of slugs){
   if(existingItems.some((c:any)=>String(c.toolkit?.slug||c.toolkit_slug||"").toLowerCase()===slug)){
    results.push({toolkit:slug,status:"existing"});continue;
   }
   const detail=await fetch("https://backend.composio.dev/api/v3.1/toolkits/"+encodeURIComponent(slug),{headers:{"x-api-key":apiKey},signal:AbortSignal.timeout(12000)}).catch(()=>null);
   if(!detail?.ok){results.push({toolkit:slug,status:"unavailable",provider_status:detail?.status||null});continue;}
   const info=await detail.json().catch(()=>({}));
   const toolkit=info.toolkit||info;
   const managed=toolkit.composio_managed_auth_schemes;
   const create=await fetch("https://backend.composio.dev/api/v3.1/auth_configs",{method:"POST",headers:{"x-api-key":apiKey,"content-type":"application/json"},body:JSON.stringify({toolkit:{slug},auth_config:{type:"use_composio_managed_auth",credentials:{},restrict_to_following_tools:[]}}),signal:AbortSignal.timeout(15000)}).catch(()=>null);
   if(!create?.ok){results.push({toolkit:slug,status:"failed",provider_status:create?.status||null});continue;}
   const item=await create.json().catch(()=>({}));
   results.push({toolkit:slug,status:"created",id:item.auth_config?.id||item.id||null});
  }
  return reply(200,{ok:true,results,created:results.filter((x:any)=>x.status==="created").length,existing:results.filter((x:any)=>x.status==="existing").length,needs_attention:results.filter((x:any)=>!["created","existing"].includes(x.status)).length});
 }
 if(operation==="initialize_shared_auth"){
  const {data:admin}=await db.from("sandy_controller_admins").select("enabled").eq("auth_user_id",identity.user.id).eq("enabled",true).maybeSingle();
  if(!admin)return reply(403,{error:"administrator_only"});
  const result=await fetch("https://backend.composio.dev/api/v3.1/auth_configs",{method:"POST",headers:{"x-api-key":apiKey,"content-type":"application/json"},body:JSON.stringify({toolkit:{slug:"gmail"},auth_config:{type:"use_composio_managed_auth",credentials:{},restrict_to_following_tools:[]}}),signal:AbortSignal.timeout(15000)}).catch(()=>null);
  return reply(result?.ok?200:502,{ok:!!result?.ok,provider_status:result?.status||null});
 }
 if(operation==="list_auth_configs"){
  const upstream=await fetch("https://backend.composio.dev/api/v3.1/auth_configs?limit=100",{headers:{"x-api-key":apiKey},signal:AbortSignal.timeout(18000)}).catch(()=>null);
  if(!upstream)return reply(502,{error:"composio_unreachable"});
  if(!upstream.ok)return reply(502,{error:"auth_configs_failed",provider_status:upstream.status});
  const result=await upstream.json().catch(()=>({}));
  let items=Array.isArray(result.items)?result.items:Array.isArray(result.data)?result.data:[];

  return reply(200,{ok:true,configs:items.map((c:any)=>({id:c.auth_config?.id||c.id||c.nanoid,toolkit_slug:c.toolkit?.slug||c.toolkit_slug||"",name:c.name||c.toolkit?.name||"",status:c.status||""})).filter((c:any)=>typeof c.id==="string").slice(0,100)});
 }
 if(operation==="create_connect_link"){
  if(!integration?.enabled)return reply(409,{error:"connector_not_enabled"});
  let configId=String(data.auth_config_id||"");
  const companyId=data.company_id===null||data.company_id===undefined?null:String(data.company_id);
  const toolkit=String(data.toolkit_slug||"").toLowerCase();
  if(!/^[a-z0-9_-]{2,80}$/.test(toolkit))return reply(400,{error:"invalid_toolkit"});
  if(companyId!==null){
   const {data:company}=await db.from("sandy_agenda_companies").select("id").eq("customer_id",customerId).eq("id",companyId).maybeSingle();
   if(!company)return reply(403,{error:"company_access_denied"});
  }
  const {data:existingPending}=await db.from("sandy_composio_pending_assignments").select("expires_at").eq("customer_id",customerId).eq("toolkit_slug",toolkit).maybeSingle();
  if(existingPending&&new Date(existingPending.expires_at).getTime()>Date.now()){ /* retry is permitted: pending workspace assignment is replaced after a new valid link */ }
  const configList=await fetch("https://backend.composio.dev/api/v3.1/auth_configs?limit=100",{headers:{"x-api-key":apiKey},signal:AbortSignal.timeout(15000)}).catch(()=>null);
  if(!configList?.ok)return reply(502,{error:"auth_config_validation_failed"});
  const configBody=await configList.json().catch(()=>({}));
  const candidates=Array.isArray(configBody.items)?configBody.items:Array.isArray(configBody.data)?configBody.data:[];
  if(!configId){
   const existing=candidates.find((c:any)=>String(c.toolkit?.slug||c.toolkit_slug||"").toLowerCase()===toolkit&&String(c.status||"ENABLED").toUpperCase()!=="DISABLED");
   if(existing)configId=String(existing.id||existing.nanoid||existing.auth_config?.id||"");
   else{
    const created=await fetch("https://backend.composio.dev/api/v3.1/auth_configs",{method:"POST",headers:{"x-api-key":apiKey,"content-type":"application/json"},body:JSON.stringify({toolkit:{slug:toolkit},auth_config:{type:"use_composio_managed_auth",credentials:{},restrict_to_following_tools:[]}}),signal:AbortSignal.timeout(16000)}).catch(()=>null);
    if(!created?.ok)return reply(409,{error:"app_authorization_not_available",provider_status:created?.status||null});
    const createdJson=await created.json().catch(()=>({}));
    configId=String(createdJson.auth_config?.id||createdJson.id||"");
   }
  }else if(!candidates.some((c:any)=>(c.auth_config?.id||c.id||c.nanoid)===configId&&String(c.toolkit?.slug||c.toolkit_slug||"").toLowerCase()===toolkit))return reply(400,{error:"auth_config_toolkit_mismatch"});
  if(data.google_services!==undefined)return reply(409,{error:"google_scopes_must_be_defined_in_auth_config",detail:"Service selections cannot override OAuth permissions. Use a verified matching Google auth config."});
  if(!/^ac_[a-zA-Z0-9_-]{5,100}$/.test(configId))return reply(400,{error:"invalid_auth_config_id"});
  const upstream=await fetch("https://backend.composio.dev/api/v3.1/connected_accounts/link",{method:"POST",headers:{"x-api-key":apiKey,"content-type":"application/json"},body:JSON.stringify({auth_config_id:configId,user_id:"sandy_customer_"+customerId,callback_url:"https://ausstyle.github.io/web-staging/sandy/apps/?connection_return=1"}),signal:AbortSignal.timeout(20000)}).catch(()=>null);
  if(!upstream)return reply(502,{error:"composio_unreachable"});
  if(!upstream.ok)return reply(502,{error:"connect_link_failed",provider_status:upstream.status});
  const result=await upstream.json().catch(()=>({}));
  const redirect=String(result.redirect_url||result.redirect_uri||result.url||"");
  if(!redirect.startsWith("https://"))return reply(502,{error:"connect_url_missing"});
  const {error:pendingError}=await db.from("sandy_composio_pending_assignments").upsert({customer_id:customerId,toolkit_slug:toolkit,company_id:companyId,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*60*1000).toISOString()},{onConflict:"customer_id,toolkit_slug"});
  if(pendingError)return reply(503,{error:"assignment_intent_save_failed"});
  return reply(200,{ok:true,connect_url:redirect,expires_at:result.expires_at||null,external_authorization_required:true});
 }
 if(operation==="sync_connections"){
  if(!integration?.enabled)return reply(409,{error:"connector_not_enabled"});
  const endpoint="https://backend.composio.dev/api/v3.1/connected_accounts?limit=100&user_ids="+encodeURIComponent("sandy_customer_"+customerId);
  const upstream=await fetch(endpoint,{headers:{"x-api-key":apiKey},signal:AbortSignal.timeout(20000)}).catch(()=>null);
  if(!upstream)return reply(502,{error:"composio_unreachable"});
  if(!upstream.ok)return reply(502,{error:"connections_sync_failed",provider_status:upstream.status});
  const result=await upstream.json().catch(()=>({}));
  const items=Array.isArray(result.items)?result.items:Array.isArray(result.data)?result.data:[];
  const rows=items.filter((item:any)=>item.user_id==="sandy_customer_"+customerId&&typeof item.id==="string"&&typeof (item.toolkit?.slug||item.toolkit_slug)==="string").map((item:any)=>({customer_id:customerId,connected_account_id:item.id,toolkit_slug:item.toolkit?.slug||item.toolkit_slug,status:String(item.status||"UNKNOWN").slice(0,60),updated_at:new Date().toISOString()}));
  if(rows.length){
   const {data:old,error:oldError}=await db.from("sandy_composio_connections").select("connected_account_id,company_id").eq("customer_id",customerId);
   if(oldError)return reply(503,{error:"existing_connections_lookup_failed"});
   const known=new Set((old||[]).map((x:any)=>x.connected_account_id));
   const companyByAccount=new Map((old||[]).map((x:any)=>[x.connected_account_id,x.company_id]));
   for(const row of rows)row.company_id=companyByAccount.get(row.connected_account_id)??null;
   const {data:pending}=await db.from("sandy_composio_pending_assignments").select("toolkit_slug,company_id,expires_at").eq("customer_id",customerId);
   const fresh=rows.filter((r:any)=>!known.has(r.connected_account_id));
   for(const p of pending||[]){
    const candidates=fresh.filter((r:any)=>r.toolkit_slug===p.toolkit_slug&&r.status.toUpperCase()==="ACTIVE");
    if(candidates.length===1&&new Date(p.expires_at).getTime()>Date.now())candidates[0].company_id=p.company_id;
   }
   const {error:writeError}=await db.from("sandy_composio_connections").upsert(rows,{onConflict:"customer_id,connected_account_id",ignoreDuplicates:false});
   if(writeError)return reply(503,{error:"connections_save_failed"});
   const {error:cleanupError}=await db.from("sandy_composio_pending_assignments").delete().eq("customer_id",customerId).in("toolkit_slug",fresh.map((x:any)=>x.toolkit_slug).concat(["__unused__"]));
   if(cleanupError)return reply(503,{error:"pending_cleanup_failed"});
  }
  return reply(200,{ok:true,connections:rows.map((r:any)=>({connected_account_id:r.connected_account_id,toolkit_slug:r.toolkit_slug,status:r.status})),count:rows.length,tool_execution_enabled:false,has_more:!!result.next_cursor});
 }
 if(operation==="resolve_connection"){
  if(!integration?.enabled)return reply(409,{error:"connector_not_enabled"});
  const toolkit=String(data.toolkit_slug||"").toLowerCase();
  if(!/^[a-z0-9_-]{2,80}$/.test(toolkit))return reply(400,{error:"invalid_toolkit"});
  // Caller-supplied connected-account identifiers must never select another customer's account.
  if(data.connected_account_id!==undefined)return reply(400,{error:"connection_id_not_accepted"});
  const {data:matches,error:lookupError}=await db.from("sandy_composio_connections").select("connected_account_id,toolkit_slug,status,company_id").eq("customer_id",customerId).eq("toolkit_slug",toolkit).in("status",["ACTIVE","active"]).limit(3);
  if(lookupError)return reply(503,{error:"connection_lookup_failed"});
  if(!matches?.length)return reply(404,{error:"customer_toolkit_not_connected"});
  if(data.company_id!==undefined){
   const companyId=data.company_id===null?null:String(data.company_id);
   const scoped=matches.filter((c:any)=>c.company_id===companyId);
   if(scoped.length!==1)return reply(409,{error:"workspace_connection_not_unique"});
   return reply(200,{ok:true,toolkit_slug:toolkit,connected:true,connection_selection:"server_owned_workspace",execution_enabled:false});
  }
  if(matches.length!==1)return reply(409,{error:"multiple_accounts_select_in_client"});
  return reply(200,{ok:true,toolkit_slug:toolkit,connected:true,connection_selection:"server_owned",execution_enabled:false});
 }
 if(operation==="disconnect"){
  const id=String(data.connected_account_id||"");
  if(!/^ca_[a-zA-Z0-9_-]{5,150}$/.test(id))return reply(400,{error:"invalid_account"});
  const {data:owned,error:readError}=await db.from("sandy_composio_connections").select("connected_account_id,toolkit_slug").eq("customer_id",customerId).eq("connected_account_id",id).maybeSingle();
  if(readError)return reply(503,{error:"connection_lookup_failed"});
  if(!owned)return reply(404,{error:"connection_not_found"});
  const endpoint="https://backend.composio.dev/api/v3/connected_accounts/"+encodeURIComponent(id);
  const upstream=await fetch(endpoint,{method:"DELETE",headers:{"x-api-key":apiKey},signal:AbortSignal.timeout(20000)}).catch(()=>null);
  if(!upstream)return reply(502,{error:"provider_unreachable"});
  if(!upstream.ok&&upstream.status!==404)return reply(502,{error:"provider_disconnect_failed",provider_status:upstream.status});
  const {error:deleteError}=await db.from("sandy_composio_connections").delete().eq("customer_id",customerId).eq("connected_account_id",id);
  if(deleteError)return reply(503,{error:"provider_disconnected_local_cleanup_failed"});
  return reply(200,{ok:true,disconnected:true,toolkit_slug:owned.toolkit_slug});
 }
 if(operation==="execute_tool"||operation==="call_tool")return reply(403,{error:"operation_not_enabled"});
 if(operation==="list_connections"){
  const {data:known,error:e}=await db.from("sandy_composio_connections").select("connected_account_id,toolkit_slug,status,updated_at,company_id").eq("customer_id",customerId).limit(100);
  if(e)return reply(503,{error:"connections_unavailable"});
  return reply(200,{ok:true,connections:known||[]});
 }
 if(operation==="list_toolkits"){
  const upstream=await fetch("https://backend.composio.dev/api/v3.1/toolkits?limit=20",{headers:{"x-api-key":apiKey},signal:AbortSignal.timeout(15000)}).catch(()=>null);
  if(!upstream)return reply(502,{error:"composio_unreachable"});
  if(!upstream.ok)return reply(502,{error:"composio_provider_error",provider_status:upstream.status});
  const raw=await upstream.json().catch(()=>({}));
  const entries=Array.isArray(raw.items)?raw.items:Array.isArray(raw.data)?raw.data:[];
  return reply(200,{ok:true,toolkits:entries.slice(0,20).map((v:any)=>({slug:v.slug,name:v.name||v.slug}))});
 }
 return reply(400,{error:"unsupported_operation"});
});