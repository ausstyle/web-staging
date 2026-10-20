import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const url=Deno.env.get("SUPABASE_URL")||"";
const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"no-store"}});
Deno.serve(async(req)=>{
 if(req.method!=="POST")return respond({error:"method_not_allowed"},405);
 const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!secret||!url||bearer!==secret)return respond({error:"unauthorized"},403);
 const db=createClient(url,secret,{auth:{persistSession:false}});
 let input:any;try{input=await req.json()}catch{return respond({error:"invalid_json"},400)}
 const action=String(input.action||"");
 if(action==="video_provision_policy"){
  const t=await db.from("sandy_cloud_targets").select("name,project_id,zone,protected").eq("name","sandy-video").maybeSingle();
  if(t.error||!t.data)return respond({ok:false,error:"video_target_missing"},404);
  return respond({ok:true,target:t.data,operation:"create_vm",allowed_machine_types:["e2-standard-2"],approval_required:true,execution_enabled:false,existing_sip_protected:true,notes:"Provisioning must be enabled in an authorised executor and verified before activation"});
 }
 if(action==="video_target_status"){
  const t=await db.from("sandy_cloud_targets").select("name,project_id,zone,protected,purpose").eq("name","sandy-video").maybeSingle();
  if(t.error)return respond({error:"target_lookup_failed"},503);
  if(!t.data)return respond({ok:false,error:"video_target_missing"},404);
  const jobs=await db.from("sandy_deployment_jobs").select("id,status,operation,result,finished_at").eq("provider","google_cloud").eq("target","sandy-video").eq("operation","create_vm").order("created_at",{ascending:false}).limit(50);
  if(jobs.error)return respond({ok:false,error:"video_deployment_lookup_failed"},503);
  const completed=(jobs.data||[]).find((j:any)=>j.status==="succeeded"&&j.result?.verified===true&&j.result?.vm==="sandy-video"&&j.result?.vm_status==="RUNNING");
  if(completed)return respond({ok:true,target:t.data,provisioning:"completed",vm_status:"RUNNING",provisioning_job_id:completed.id,provisioning_verified_at:completed.result.verified_at||completed.finished_at,livekit_status:"not_verified",service_operational:false});
  const pending=(jobs.data||[]).find((j:any)=>["pending_approval","approved","running"].includes(j.status));
  return respond({ok:true,target:t.data,provisioning:pending?.status==="pending_approval"?"requires_approval":pending?.status||"not_provisioned",provisioning_job_id:pending?.id||null,livekit_status:"not_verified",service_operational:false});
 }
 if(action==="management_deploy_smoke"){
  const token=Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN")||"";
  if(!token)return respond({ok:false,error:"management_token_missing"},424);
  const slug="sandy-mcp-smoke-20261020";
  const api="https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/functions";
  const hdr={"authorization":"Bearer "+token};
  const notes:any[]=[];
  const deadline=AbortSignal.timeout(27000);
  let created=false;
  try{
   const prior=await fetch(api+"/"+slug,{headers:hdr,signal:deadline});
   notes.push({step:"absence_preflight",http:prior.status});
   if(prior.status!==404)return respond({ok:false,error:"smoke_slug_not_empty",notes},409);
   const src='Deno.serve(()=>Response.json({test:"sandy-mcp-smoke-20261020",ok:true}));';
   const form=new FormData();
   form.append("metadata",JSON.stringify({name:slug,entrypoint_path:"index.ts",verify_jwt:true}));
   form.append("file",new Blob([src],{type:"text/plain"}),"index.ts");
   const deployed=await fetch(api+"/deploy?slug="+slug,{method:"POST",headers:hdr,body:form,signal:deadline});
   const deployment=await deployed.json().catch(()=>({}));
   notes.push({step:"deploy",http:deployed.status,version:deployment.version||null});
   if(!deployed.ok)return respond({ok:false,error:"deploy_rejected",notes},502);
   created=true;
   const detail=await fetch(api+"/"+slug,{headers:hdr,signal:deadline});
   const info=await detail.json().catch(()=>({}));
   notes.push({step:"verify_deployment",http:detail.status,version:info.version||null});
   const live=await fetch(url+"/functions/v1/"+slug,{method:"POST",headers:{"authorization":"Bearer "+secret,"apikey":secret},signal:deadline}).catch(()=>null);
   const data=await live?.json().catch(()=>({}))||{};
   notes.push({step:"invoke",http:live?.status||null,expected_response:data.ok===true&&data.test===slug});
   const deleted=await fetch(api+"/"+slug,{method:"DELETE",headers:hdr,signal:deadline});
   notes.push({step:"rollback_delete",http:deleted.status});
   if(deleted.ok)created=false;
   const gone=await fetch(api+"/"+slug,{headers:hdr,signal:deadline});
   notes.push({step:"verify_rollback",http:gone.status});
   return respond({ok:detail.ok&&live?.ok===true&&data.ok===true&&data.test===slug&&deleted.ok&&gone.status===404,notes,cleanup_required:created},200);
  }catch(e){return respond({ok:false,error:"smoke_incomplete",reason:String(e).slice(0,130),notes,cleanup_required:created},502);}
 } 
 if(action==="engineering_release_preflight"){
  const gh=Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN")||Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN")||"";
  const sb=Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN")||"";
  const target=String(input.function_slug||"");
  if(!/^[a-z][a-z0-9-]{2,90}$/.test(target))return respond({ok:false,error:"invalid_function_slug"},400);
  if(!gh||!sb)return respond({ok:false,error:"management_credential_not_configured"},424);
  const ghResponse=await fetch("https://api.github.com/repos/ausstyle/web-staging/contents/supabase/functions/"+target+"/index.ts?ref=main",{headers:{"authorization":"Bearer "+gh,"accept":"application/vnd.github+json"},signal:AbortSignal.timeout(12000)});
  const gitInfo=ghResponse.ok?await ghResponse.json():{};
  const supaResponse=await fetch("https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/functions/"+target,{headers:{"authorization":"Bearer "+sb},signal:AbortSignal.timeout(12000)});
  const liveInfo=supaResponse.ok?await supaResponse.json():{};
  const ok=ghResponse.ok&&supaResponse.ok;
  return respond({ok,source:{exists:ghResponse.ok,http_status:ghResponse.status,blob_sha:gitInfo.sha||null},production:{exists:supaResponse.ok,http_status:supaResponse.status,version:liveInfo.version||null},execution:"read_only_preflight",release_ready:ok},ok?200:424);
 }
 if(action==="management_preflight"){
   const ghToken=Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN")||Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN")||"";
   const sbToken=Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN")||"";
   let githubHttp:number|null=null,githubWrite=false;
   if(ghToken){try{const v=await fetch("https://api.github.com/repos/ausstyle/web-staging",{headers:{"authorization":"Bearer "+ghToken,"accept":"application/vnd.github+json"},signal:AbortSignal.timeout(8000)});githubHttp=v.status;if(v.ok){const d=await v.json();githubWrite=d.permissions?.push===true;}}catch{}}
   let sbHttp:number|null=null,sbRead=false;
   if(sbToken){try{const v=await fetch("https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/functions",{headers:{"authorization":"Bearer "+sbToken},signal:AbortSignal.timeout(10000)});sbHttp=v.status;sbRead=v.ok;}catch{}}
   const proof=await db.from("sandy_engineering_tests").select("id,evidence,checked_at").eq("test_name","MCP Supabase management deploy invoke delete verification 20261020").eq("outcome","passed").order("checked_at",{ascending:false}).limit(1);
   const confirmed=Boolean(proof.data?.[0]?.evidence?.deploy_http===201&&proof.data?.[0]?.evidence?.invoke_http===200&&proof.data?.[0]?.evidence?.verify_rollback_http===404);
   const providers={github:{configured:!!ghToken,write_enabled:githubWrite,probe_http_status:githubHttp},supabase:{configured:!!sbToken,management_read_verified:sbRead,probe_http_status:sbHttp,write_enabled:sbRead&&confirmed,verified_scope:confirmed?"isolated_function_deploy_invoke_delete":null}};
   return respond({ok:true,providers,production_ready:false,smoke_deployment_and_cleanup_verified:confirmed,smoke_test_record:proof.data?.[0]?.id||null,full_supabase_executor_ready:false,general_rollback_executor_ready:false});
 }
 if(action==="executor_policy"){
   return respond({ok:true,production_writes_enabled:false,require_approval:true,require_idempotency:true,require_verification:true,rollback_required:true});
 }
 if(action==="executor_ready"){
   return respond({ok:true,configured:{github:!!Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN"),supabase:!!Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN")},execution_enabled:false});
 }
 if(action==="executor_preflight"){
   return respond({ok:true,github_credential_present:!!Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN"),supabase_credential_present:!!Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN"),github_write_ready:false,supabase_write_ready:false});
 }
 if(action==="github_write_preflight"){
   const token=Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN")||Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN")||"";
   if(!token)return respond({ok:false,error:"github_credential_unavailable"},424);
   const headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
   const response=await fetch("https://api.github.com/repos/ausstyle/web-staging",{headers,signal:AbortSignal.timeout(18000)});
   const repo=await response.json().catch(()=>({}));
   return respond({ok:response.ok,github_http:response.status,repository:"ausstyle/web-staging",permissions:repo.permissions||null,write_capable:response.ok&&Boolean(repo.permissions?.push),credential_present:true},response.ok?200:502);
 }
 if(action==="verify_github_management"){
   const configured=Boolean(Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN"));
   return respond({ok:true,configured,verification:"credential_presence_only"});
 }
 if(action==="verify_supabase_management"){
   const token=Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN")||"";
   if(!token)return respond({ok:false,configured:false,reason:"management_token_missing"},424);
   const res=await fetch("https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/functions",{headers:{"authorization":"Bearer "+token},signal:AbortSignal.timeout(16000)});
   const data=await res.json().catch(()=>null);
   return respond({ok:res.ok,configured:true,http_status:res.status,function_count:Array.isArray(data)?data.length:null},res.ok?200:502);
 }
 if(action==="executor_capabilities"){
   return respond({ok:true,google_cloud_read:true,supabase_write:false,github_update_file_implemented:true,github_update_file_credential_present:!!(Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN")||Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN")),github_push_files_implemented:false,github_write_live_tested:false,github_external_reconciliation_verified:true,executor_ready:false,management_credentials:{supabase:!!Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN"),github:!!(Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN")||Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN"))}});
 }
 if(action==="register_deployed_function"){
  const slug=String(input.function_slug||"");
  if(!/^[a-z][a-z0-9-]{1,100}$/.test(slug))return respond({error:"invalid_function_slug"},400);
  if(input.deployment_verified!==true)return respond({error:"deployment_verification_required"},409);
  const existing=await db.from("sandy_api_function_catalog").select("function_slug").eq("function_slug",slug).maybeSingle();
  if(existing.error)return respond({error:"catalog_lookup_failed",code:existing.error.code},503);
  const saved=existing.data
    ? await db.from("sandy_api_function_catalog").update({discovered_at:new Date().toISOString()}).eq("function_slug",slug).select("function_slug,verified,execution_enabled").single()
    : await db.from("sandy_api_function_catalog").insert({function_slug:slug,verified:false,execution_enabled:false}).select("function_slug,verified,execution_enabled").single();
  if(saved.error)return respond({error:"catalog_update_failed",code:saved.error.code},503);
  return respond({ok:true,entry:saved.data,registered:true});
 }
 if(action==="approve_read"){
 const id=String(input.job_id||"");
 if(!/^[0-9a-f-]{36}$/i.test(id))return respond({error:"invalid_job_id"},400);
 const r=await db.rpc("sandy_approve_cloud_diagnostic_job",{p_job_id:id});
 return r.error?respond({error:"approval_policy_failed",code:r.error.code},503):respond({ok:r.data===true,approved:r.data===true},r.data?200:409);
}
if(action==="execute"){
  const id=String(input.job_id||"");
  if(!/^[0-9a-f-]{36}$/i.test(id))return respond({error:"invalid_job_id"},400);
  const {data:job}=await db.from("sandy_deployment_jobs").select("provider,operation,status").eq("id",id).maybeSingle();
  if(!job)return respond({error:"not_found"},404);
  if(job.status!=="approved")return respond({error:"job_not_approved",status:job.status},409);
  if(job.provider==="github"&&job.operation==="update_file"&&input.reconcile_external===true){
    const rec=await db.from("sandy_deployment_jobs").select("id,status,target,engineering_change_id").eq("id",id).single();
    if(rec.error||rec.data.status!=="approved")return respond({error:"approved_job_required"},409);
    const art=await db.from("sandy_engineering_artifacts").select("after_ref,metadata,target").eq("change_id",rec.data.engineering_change_id).eq("artifact_type","github_file").eq("target",rec.data.target).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(art.error||!art.data||!/^[a-f0-9]{40}$/.test(art.data.after_ref||""))return respond({error:"external_commit_evidence_missing"},409);
    const match=String(rec.data.target).match(/^([\w.-]+\/[\w.-]+):([\w./-]+)$/);
    if(!match||match[1]!=="ausstyle/web-staging")return respond({error:"invalid_target"},403);
    const token=Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN")||Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN");
    if(!token)return respond({error:"github_credential_unavailable"},503);
    const headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
    const commit=await fetch("https://api.github.com/repos/"+match[1]+"/commits/"+art.data.after_ref,{headers,signal:AbortSignal.timeout(18000)});
    if(!commit.ok)return respond({error:"external_commit_unverified",http_status:commit.status},502);
    const file=await fetch("https://api.github.com/repos/"+match[1]+"/contents/"+match[2]+"?ref=main",{headers,signal:AbortSignal.timeout(18000)});
    const data=await file.json().catch(()=>({}));
    if(!file.ok||data.sha!==art.data.metadata?.new_blob_sha)return respond({error:"published_source_mismatch",http_status:file.status},409);
    const receipt={external_commit:art.data.after_ref,path:match[2],blob_sha:data.sha,verified:true,execution_via_sandy_worker:false,reconciled:true};
    const updated=await db.from("sandy_deployment_jobs").update({status:"succeeded",result:receipt,finished_at:new Date().toISOString()}).eq("id",id).eq("status","approved").select("id").maybeSingle();
    if(updated.error||!updated.data)return respond({error:"reconciliation_conflict"},409);
    await db.from("sandy_deployment_events").insert({job_id:id,event_type:"external_commit_reconciled",actor:"sandy_deployment_api",details:receipt});
    return respond({ok:true,job_id:id,...receipt});
  }
  if(job.provider==="github"&&job.operation==="update_file"){
    const fullRes=await db.from("sandy_deployment_jobs").select("target,payload,engineering_change_id,approved_by").eq("id",id).single();
    const j=fullRes.data;
    if(fullRes.error||!j?.engineering_change_id||!j.approved_by)return respond({error:"engineering_job_not_approved"},409);
    const change=await db.from("sandy_engineering_changes").select("status,scope").eq("id",j.engineering_change_id).single();
    if(change.error||!["approved","implementing","committed","deployed","verified"].includes(change.data.status)||!change.data.scope?.includes("github:"+j.target))return respond({error:"github_scope_not_approved"},403);
    const match=String(j.target).match(/^([\w.-]+\/[\w.-]+):([\w./-]+)$/);
    if(!match||match[1]!=="ausstyle/web-staging"||match[2].includes(".."))return respond({error:"invalid_github_target"},403);
    const content=j.payload?.content,expected=j.payload?.expected_content_sha256;
    if(typeof content!=="string"||content.length>350000||!/^[0-9a-f]{64}$/.test(String(expected||"")))return respond({error:"immutable_source_required",detail:"Approved job has no source bytes and SHA-256. Existing external commits must be reconciled, not replayed."},422);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(content)))).map(x=>x.toString(16).padStart(2,"0")).join("");
    if(digest!==expected)return respond({error:"source_digest_mismatch"},409);
    const token=Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN")||Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN");
    if(!token)return respond({error:"github_credential_unavailable"},503);
    const headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"};
    const endpoint="https://api.github.com/repos/"+match[1]+"/contents/"+match[2];
    const before=await fetch(endpoint+"?ref=main",{headers,signal:AbortSignal.timeout(18000)});
    const prior=await before.json().catch(()=>({}));
    if(!before.ok)return respond({error:"github_preflight_failed",http_status:before.status},502);
    if(j.payload?.before_sha&&j.payload.before_sha!==prior.sha)return respond({error:"github_source_conflict",observed_sha:prior.sha},409);
    const claim=await db.from("sandy_deployment_jobs").update({status:"running",started_at:new Date().toISOString()}).eq("id",id).eq("status","approved").select("id").maybeSingle();
    if(claim.error||!claim.data)return respond({error:"job_already_claimed"},409);
    const bytes=new TextEncoder().encode(content);let binary="";for(let p=0;p<bytes.length;p+=8192)binary+=String.fromCharCode(...bytes.slice(p,p+8192));
    const wr=await fetch(endpoint,{method:"PUT",headers,body:JSON.stringify({message:"chore(sandy): approved "+j.engineering_change_id,content:btoa(binary),sha:prior.sha,branch:"main"}),signal:AbortSignal.timeout(30000)});
    const output=await wr.json().catch(()=>({}));
    if(!wr.ok){await db.from("sandy_deployment_jobs").update({status:"failed",error:"github_http_"+wr.status,finished_at:new Date().toISOString()}).eq("id",id).eq("status","running");return respond({error:"github_write_failed",http_status:wr.status},502)}
    const commit=String(output.commit?.sha||""),blob=String(output.content?.sha||"");
    const receipt={commit,path:match[2],before_sha:prior.sha,after_sha:blob,verified:false};
    await db.from("sandy_deployment_jobs").update({result:receipt}).eq("id",id).eq("status","running");
    const check=await fetch(endpoint+"?ref=main",{headers,signal:AbortSignal.timeout(18000)});
    const observed=await check.json().catch(()=>({}));
    if(!check.ok||observed.sha!==blob)return respond({error:"github_commit_needs_reconciliation",job_id:id,commit},503);
    const final={...receipt,verified:true};
    const saved=await db.from("sandy_deployment_jobs").update({status:"succeeded",result:final,finished_at:new Date().toISOString()}).eq("id",id).eq("status","running").select("id").maybeSingle();
    if(saved.error||!saved.data)return respond({error:"receipt_persistence_failed",commit},503);
    await db.from("sandy_deployment_events").insert({job_id:id,event_type:"github_commit_verified",actor:"sandy_deployment_api",details:final});
    return respond({ok:true,job_id:id,...final});
  }
  if(job.provider==="supabase"&&job.operation==="deploy_function"){
    return respond({error:"supabase_deployment_executor_not_configured",required:["approved_engineering_change","immutable_source_artifact","management_api_credentials","post_deploy_verification"],executed:false},424);
  }
  if(job.provider==="google_cloud"&&job.operation==="create_vm"){
    const {data:full}=await db.from("sandy_deployment_jobs").select("target,payload,engineering_change_id").eq("id",id).maybeSingle();
    if(full?.target!=="sandy-video"||full.payload?.profile!=="livekit-dedicated-v1"||!full.engineering_change_id)return respond({error:"approved_video_engineering_change_required"},409);
    try{
      const response=await fetch(url+"/functions/v1/sandy-deploy-provision",{method:"POST",headers:{"authorization":"Bearer "+secret,"content-type":"application/json"},body:JSON.stringify({action:"create_video",job_id:id}),signal:AbortSignal.timeout(85000)});
      return respond(await response.json(),response.status);
    }catch{return respond({error:"video_executor_unreachable"},503)}
  }
  if(job.provider!=="google_cloud"||!["get_vm","list_vms","get_logs"].includes(job.operation))return respond({error:"worker_operation_unavailable"},422);
  try{const r=await fetch(url+"/functions/v1/sandy-gcp-read-worker",{method:"POST",headers:{"authorization":"Bearer "+secret,"content-type":"application/json"},body:JSON.stringify({action:"execute",job_id:id}),signal:AbortSignal.timeout(28000)});return respond(await r.json(),r.status)}catch{return respond({error:"worker_unreachable"},503)}
 }
 if(action==="status"){
  const id=String(input.job_id||"");
  if(!/^[0-9a-f-]{36}$/i.test(id))return respond({error:"invalid_job_id"},400);
  const {data,error}=await db.from("sandy_deployment_jobs").select("id,status,provider,operation,target,created_at,updated_at,result,error").eq("id",id).maybeSingle();
  return error?respond({error:"query_failed"},503):data?respond({ok:true,job:data}):respond({error:"not_found"},404);
 }
 if(action==="request"){
  const provider=String(input.provider||""),operation=String(input.operation||""),target=String(input.target||"");
  const idem=String(input.idempotency_key||"");
  if(!["supabase","github","google_cloud"].includes(provider)||!["read","deploy_function","apply_migration","commit","merge","list_vms","get_vm","create_vm","start_vm","stop_vm","restart_vm","resize_vm","snapshot_disk","delete_vm","get_logs"].includes(operation)||target.length<2||target.length>200||!/^[a-zA-Z0-9:_-]{12,128}$/.test(idem))
   return respond({error:"invalid_request"},400);
  if(provider==="google_cloud"){
 const allowed=["list_vms","get_vm","create_vm","start_vm","stop_vm","restart_vm","resize_vm","snapshot_disk","delete_vm","get_logs"];
 if(!allowed.includes(operation))return respond({error:"invalid_cloud_operation"},400);
 const t=await db.from("sandy_cloud_targets").select("name,protected").eq("name",target).maybeSingle();
 if(t.error||(!t.data&&operation!=="list_vms"))return respond({error:"unregistered_cloud_target"},403);
 if(t.data?.protected&&!["get_vm","get_logs","list_vms"].includes(operation)&&!(target==="sandy-video"&&operation==="create_vm"))return respond({error:"protected_cloud_target"},403);
}
const payload=input.payload;
  if(payload!==undefined&&(typeof payload!=="object"||payload===null||Array.isArray(payload)||JSON.stringify(payload).length>12000))return respond({error:"invalid_payload"},400);
  const {data,error}=await db.from("sandy_deployment_jobs").upsert({requested_by:"sandy_internal",provider,operation,target,payload:payload||{},idempotency_key:idem,status:"pending_approval"},{onConflict:"idempotency_key",ignoreDuplicates:true}).select("id,status").maybeSingle();
  if(error)return respond({error:"queue_failed",detail:error.code},503);
  if(!data){
   const prior=await db.from("sandy_deployment_jobs").select("id,status").eq("idempotency_key",idem).maybeSingle();
   return prior.data?respond({ok:true,reused:true,...prior.data}):respond({error:"queue_lookup_failed"},503);
  }
  await db.from("sandy_deployment_events").insert({job_id:data.id,event_type:"requested",actor:"sandy_internal",details:{provider,operation,target}});
  return respond({ok:true,job_id:data.id,status:data.status,executed:false},202);
 }
 return respond({error:"action_not_allowed"},400);
});