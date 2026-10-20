import {createClient} from "https://esm.sh/@supabase/supabase-js@2.105.0";
const url=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const h={"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,content-type,apikey","Access-Control-Allow-Methods":"POST,OPTIONS"};
const respond=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:h});
const uuid=(s:unknown)=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const string=(v:unknown,max=2000)=>typeof v==="string"?v.trim().slice(0,max):"";
const arrays=(v:unknown)=>Array.isArray(v)?v.slice(0,50):[];
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:h});
 if(req.method!=="POST")return respond({error:"POST required"},405);
 try {
  const token=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)return respond({error:"Unauthorized"},401);
  const {data:{user},error:authErr}=await db.auth.getUser(token);
  if(authErr||!user)return respond({error:"Unauthorized"},401);
  const {data:admin,error:adminErr}=await db.from("sandy_controller_admins").select("role,enabled").eq("auth_user_id",user.id).eq("enabled",true).maybeSingle();
  if(adminErr||!admin)return respond({error:"Sandy Controller administrator required"},403);
  const b=await req.json();const action=string(b.action,48);
  if(action==="preflight"){
   const [changes,rollbackRequests,pendingJobs]=await Promise.all([
     db.from("sandy_engineering_changes").select("id",{count:"exact",head:true}),
     db.from("sandy_engineering_rollback_requests").select("id",{count:"exact",head:true}),
     db.from("sandy_deployment_jobs").select("id",{count:"exact",head:true}).eq("status","pending_approval").not("engineering_change_id","is",null)
   ]);
   if(changes.error||rollbackRequests.error||pendingJobs.error)return respond({error:"engineering_preflight_database_unavailable"},503);
   return respond({ok:true,engineering_control_version:10,change_registration_required:true,write_requires_engineering_change:true,
     github_smoke_executor_implemented:true,github_credential_present:Boolean(Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN")),
     supabase_write_executor_implemented:false,rollback_request_implemented:true,rollback_executor_implemented:false,
     registered_change_count:changes.count,rollback_request_count:rollbackRequests.count,pending_engineering_jobs:pendingJobs.count});
  }
  if(action==="register"){
   const title=string(b.title,240),problem=string(b.problem,4000),expected=string(b.expected_behavior,4000),purpose=string(b.change_purpose,4000),improvement=string(b.feature_improvement,4000);
   if(title.length<5||problem.length<10||expected.length<10||purpose.length<10||improvement.length<10)return respond({error:"title, problem, expected_behavior, change_purpose and feature_improvement are required with meaningful detail"},400);
   const keyValue=string(b.idempotency_key,160)||null;
   if(keyValue){const {data:existing}=await db.from("sandy_engineering_changes").select("*").eq("requested_by",user.id).eq("idempotency_key",keyValue).maybeSingle();if(existing)return respond({change:existing,reused:true})}
   const risk=["low","normal","high","critical"].includes(b.risk)?b.risk:"normal";
   const scope=arrays(b.scope),criteria=arrays(b.acceptance_criteria),regressions=arrays(b.regression_rules);
   const policyRead=await db.from("sandy_engineering_delegation_policy").select("enabled,allowed_risks,allowed_operations,require_authenticated_admin,require_change_record,require_test_evidence,require_rollback_plan").eq("id",1).maybeSingle();
   if(policyRead.error)return respond({error:"Delegation policy unavailable"},503);
   const routineScope=scope.length>0&&scope.every((x:unknown)=>typeof x==="string"&&(/^(github:ausstyle\/web-staging:)/.test(x)||/^(sandy-[a-z0-9-]+)$/.test(x)))&&!scope.some((x:unknown)=>/voice-sip|security|auth|billing|delete|secret|production-database/i.test(String(x)));
   const delegated=admin.role==="owner"&&policyRead.data?.enabled&&policyRead.data?.allowed_risks?.includes(risk)&&routineScope&&criteria.length>0&&regressions.length>0;
   const {data,error}=await db.from("sandy_engineering_changes").insert({title,problem,expected_behavior:expected,change_purpose:purpose,feature_improvement:improvement,scope,regression_rules:regressions,acceptance_criteria:criteria,risk,requested_by:user.id,idempotency_key:keyValue,status:delegated?"approved":"proposed"}).select("*").single();
   if(error)throw error;
   await db.from("sandy_engineering_change_events").insert({change_id:data.id,event_type:delegated?"delegated_auto_approved":"registered",actor:user.id,detail:{source:"engineering_api",approval_mode:delegated?"automatic_owner_delegation":"manual",test_required_before_execution:true}});
   return respond({change:data},201);
  }
  if(action==="list"){const {data,error}=await db.from("sandy_engineering_changes").select("id,title,status,risk,created_at,updated_at,verified_at").order("created_at",{ascending:false}).limit(100);if(error)throw error;return respond({changes:data})}
  if(!uuid(b.change_id))return respond({error:"Valid change_id required"},400);
  const id=b.change_id;
  const {data:change,error:changeErr}=await db.from("sandy_engineering_changes").select("*").eq("id",id).maybeSingle();
  if(changeErr)throw changeErr;if(!change)return respond({error:"Change not found"},404);
  if(action==="get"){
   const [events,artifacts,tests,rollbacks]=await Promise.all([
    db.from("sandy_engineering_change_events").select("*").eq("change_id",id).order("occurred_at",{ascending:false}).limit(200),
    db.from("sandy_engineering_artifacts").select("*").eq("change_id",id),
    db.from("sandy_engineering_tests").select("*").eq("change_id",id),
    db.from("sandy_engineering_rollback_requests").select("*").eq("change_id",id)]);
   if([events,artifacts,tests,rollbacks].some(x=>x.error))throw Error("Unable to read change history");
   return respond({change,events:events.data,artifacts:artifacts.data,tests:tests.data,rollbacks:rollbacks.data});
  }
  if(action==="auto_approve"){
   if(change.status!=="proposed")return respond({error:"Change is not awaiting approval",status:change.status},409);
   const requestedOperation=string(b.operation,80);
   const opKey=({update_file:"github_update_file",push_files:"github_push_files",deploy_function:"supabase_deploy_function",model_canary:"model_canary",readiness_check:"readiness_check"} as Record<string,string>)[requestedOperation]||requestedOperation;
   const {data:policy,error:pe}=await db.from("sandy_engineering_delegation_policy").select("enabled,allowed_risks,allowed_operations,require_authenticated_admin,require_change_record,require_test_evidence,require_rollback_plan").eq("id",1).single();
   if(pe||!policy?.enabled||!policy.allowed_risks?.includes(change.risk)||!policy.allowed_operations?.includes(opKey))return respond({error:"Operation is outside delegated approval policy",requires_owner_approval:true},403);
   if(policy.require_authenticated_admin&&!admin.enabled)return respond({error:"Authorized administrator required"},403);
   if(policy.require_change_record&&(!change.change_purpose||!change.feature_improvement||!change.expected_behavior))return respond({error:"Incomplete engineering change"},409);
   if(!Array.isArray(change.acceptance_criteria)||!change.acceptance_criteria.length||!Array.isArray(change.regression_rules)||!change.regression_rules.length)return respond({error:"Acceptance and regression requirements missing"},409);
   const {data:tests,error:te}=await db.from("sandy_engineering_tests").select("outcome,evidence,checked_at").eq("change_id",id);
   if(te)return respond({error:"Test evidence unavailable"},503);
   if(policy.require_test_evidence&&(!tests?.length||tests.some((t:any)=>t.outcome!=="passed"||!t.checked_at||!t.evidence||Object.keys(t.evidence).length===0)))return respond({error:"Passing recorded predeployment test evidence required"},409);
   const rollback=string(b.rollback_plan,2000);
   if(policy.require_rollback_plan&&(rollback.length<25||!/^[a-z0-9-]+(?:\/|:)/i.test(string(b.rollback_reference,500))))return respond({error:"Concrete rollback plan and prior-version reference required"},409);
   const {data:approved,error:ae}=await db.from("sandy_engineering_changes").update({status:"approved",updated_at:new Date().toISOString()}).eq("id",id).eq("status","proposed").select("id,status").maybeSingle();
   if(ae||!approved)return respond({error:"Concurrent approval or update error"},409);
   const ev=await db.from("sandy_engineering_change_events").insert({change_id:id,event_type:"delegated_auto_approved",actor:user.id,detail:{operation:opKey,rollback_plan:rollback,rollback_reference:string(b.rollback_reference,500),policy:"routine_delegation",test_count:tests?.length||0}});
   if(ev.error)return respond({error:"Approval recorded but audit insertion failed",change_id:id},503);
   return respond({ok:true,change:approved,approval_mode:"delegated",human_approval_required:false});
  }
  if(action==="status"){
   const next=string(b.status,40);
   const allowed:Record<string,string[]>={proposed:["approved","cancelled"],approved:["implementing","cancelled"],implementing:["committed","failed"],committed:["deployed","failed"],deployed:["verified","failed"],verified:["rolled_back"],failed:["implementing","rolled_back"],rolled_back:[],cancelled:[]};
   if(!allowed[change.status]?.includes(next))return respond({error:"Invalid status transition",from:change.status,to:next},409);
   if(next==="approved"&&admin.role!=="owner")return respond({error:"Owner approval required"},403);
   if(next==="verified"){
    const {data:tests,error}=await db.from("sandy_engineering_tests").select("outcome").eq("change_id",id);
    if(error)throw error;if(!tests?.length||tests.some(t=>t.outcome!=="passed"))return respond({error:"All acceptance tests require passing evidence"},409);
   }
   const {data,error}=await db.from("sandy_engineering_changes").update({status:next,updated_at:new Date().toISOString(),...(next==="verified"?{verified_at:new Date().toISOString()}:{})}).eq("id",id).eq("status",change.status).select("*").maybeSingle();
   if(error)throw error;if(!data)return respond({error:"Concurrent change; reload"},409);
   await db.from("sandy_engineering_change_events").insert({change_id:id,event_type:"status_changed",actor:user.id,detail:{from:change.status,to:next,reason:string(b.reason,1000)}});
   return respond({change:data});
  }
  if(action==="artifact"){
   if(!["approved","implementing","committed","deployed","verified","failed"].includes(change.status))return respond({error:"Change is not approved"},409);
   const type=string(b.artifact_type,50),target=string(b.target,500);
   if(!["github_commit","github_file","supabase_migration","edge_function","deployment_job","configuration","other"].includes(type)||!target)return respond({error:"Valid artifact_type and target required"},400);
   const strategies=["git_revert","redeploy_prior","forward_migration","manual_review"];
   const {data,error}=await db.from("sandy_engineering_artifacts").insert({change_id:id,artifact_type:type,target,before_ref:string(b.before_ref,500)||null,after_ref:string(b.after_ref,500)||null,rollback_strategy:strategies.includes(b.rollback_strategy)?b.rollback_strategy:"manual_review",rollback_notes:string(b.rollback_notes,2000)||null,metadata:typeof b.metadata==="object"&&b.metadata&&!Array.isArray(b.metadata)?b.metadata:{}}).select("*").single();
   if(error)throw error;await db.from("sandy_engineering_change_events").insert({change_id:id,event_type:"artifact_recorded",actor:user.id,detail:{artifact_id:data.id,target,type}});
   return respond({artifact:data},201);
  }
  if(action==="test"){
   const name=string(b.test_name,300),outcome=string(b.outcome,20);
   if(!name||!["pending","passed","failed","blocked"].includes(outcome))return respond({error:"test_name and valid outcome required"},400);
   const {data,error}=await db.from("sandy_engineering_tests").insert({change_id:id,test_name:name,outcome,evidence:b.evidence||{},checked_at:outcome==="pending"?null:new Date().toISOString()}).select("*").single();
   if(error)throw error;return respond({test:data},201);
  }
  if(action==="link_video_job"){
   if(admin.role!=="owner")return respond({error:"Owner access required"},403);
   if(change.status!=="approved")return respond({error:"Engineering change must be approved first"},409);
   if(!uuid(b.job_id))return respond({error:"Valid job ID required"},400);
   const {data:job,error:je}=await db.from("sandy_deployment_jobs").select("id,status,provider,operation,target,payload,engineering_change_id").eq("id",b.job_id).maybeSingle();
   if(je||!job||job.status!=="pending_approval"||job.provider!=="google_cloud"||job.operation!=="create_vm"||job.target!=="sandy-video"||job.payload?.profile!=="livekit-dedicated-v1"||job.engineering_change_id)return respond({error:"Job is not eligible for video engineering linkage"},409);
   const saved=await db.from("sandy_deployment_jobs").update({engineering_change_id:id,updated_at:new Date().toISOString()}).eq("id",job.id).eq("status","pending_approval").is("engineering_change_id",null).select("id,engineering_change_id,status").maybeSingle();
   if(saved.error||!saved.data)return respond({error:"Concurrent job change or linkage failure"},409);
   await db.from("sandy_engineering_change_events").insert({change_id:id,event_type:"video_job_linked",actor:user.id,detail:{job_id:job.id}});
   return respond({ok:true,job:saved.data,approval_required:true});
  }
  if(action==="implementation_request"){
   if(!["approved","implementing"].includes(change.status))return respond({error:"Approve change before requesting implementation"},409);
   const provider=string(b.provider,30),operation=string(b.operation,80),target=string(b.target,500),idempotency=string(b.idempotency_key,160);
   if(!["github","supabase"].includes(provider)||!operation||!target||!idempotency)return respond({error:"provider (github/supabase), operation, target and idempotency_key required"},400);
   if(provider==="github"&&["update_file","push_files"].includes(operation)){
     const approvedTargets=arrays(change.scope).filter((x:unknown)=>typeof x==="string"&&x.startsWith("github:")).map((x:string)=>x.slice(7));
     const exact=approvedTargets.includes(target);
     if(!exact)return respond({error:"GitHub target must match an explicitly approved engineering scope",requested_target:target,allowed_targets:approvedTargets,format:"owner/repo:path"},403);
   }
   // Fail closed before approval: only implemented, scoped executors may enter the deployment queue.
   const executable=provider==="github"&&operation==="create_file"&&target.startsWith("ausstyle/web-staging:engineering-smoke/")&&target.endsWith(".txt")&&!target.includes("..");
   if(!executable)return respond({error:"executor_not_registered",provider,operation,target,execution_available:false,remediation:"Implement and verify a scoped executor before requesting deployment approval"},422);
   const proposal=typeof b.payload==="object"&&b.payload&&!Array.isArray(b.payload)?b.payload:{};
   // This records a guarded deployment request; execution is deliberately external and requires approval.
   const {data:existing}=await db.from("sandy_deployment_jobs").select("*").eq("idempotency_key",idempotency).maybeSingle();
   if(existing){if(existing.engineering_change_id!==id)return respond({error:"Idempotency key belongs to another change"},409);return respond({job:existing,reused:true})}
   const policyResult=await db.from("sandy_engineering_delegation_policy").select("*").eq("id",1).maybeSingle();
   if(policyResult.error)return respond({error:"Delegation policy unavailable"},503);
   const policy=policyResult.data;
   const opKey=provider==="github"&&["update_file","push_files"].includes(operation)?"github_"+operation:provider==="supabase"&&operation==="deploy_function"?"supabase_deploy_function":null;
   const scoped=provider==="github"?arrays(change.scope).includes("github:"+target):provider==="supabase"?arrays(change.scope).includes(target):false;
   const tests=await db.from("sandy_engineering_tests").select("outcome,evidence,checked_at").eq("change_id",id);
   if(tests.error)return respond({error:"Test evidence unavailable"},503);
   const passed=Boolean(tests.data?.length)&&tests.data.every((t:any)=>t.outcome==="passed"&&t.checked_at&&t.evidence&&Object.keys(t.evidence).length);
   const plan=string(proposal.rollback_plan,2000),before=string(proposal.before_ref,500);
   const auto=admin.role==="owner"&&policy?.enabled&&opKey&&policy.allowed_operations?.includes(opKey)&&policy.allowed_risks?.includes(change.risk)&&scoped&&passed&&plan.length>=25&&before.length>=7;
   const {data,error}=await db.from("sandy_deployment_jobs").insert({requested_by:user.id,provider,operation,target,payload:{...proposal,engineering_change_id:id,expected_behavior:change.expected_behavior},idempotency_key:idempotency,status:auto?"approved":"pending_approval",engineering_change_id:id,...(auto?{approved_by:user.id,approved_at:new Date().toISOString()}:{})}).select("*").single();
   if(error)throw error;
   await db.from("sandy_engineering_change_events").insert({change_id:id,event_type:auto?"delegated_job_approved":"implementation_requested",actor:user.id,detail:{job_id:data.id,provider,operation,target,approval_mode:auto?"automatic_owner_delegation":"pending",test_count:tests.data?.length||0}});
   return respond({job:data,execution:"not_started",requires_approval:!auto,approval_mode:auto?"delegated":"pending"},201);
  }
  if(action==="job_status"||action==="approve_job"||action==="auto_approve_job"||action==="execute_job"){
   if(!uuid(b.job_id))return respond({error:"Valid job_id required"},400);
   const {data:job,error:jobErr}=await db.from("sandy_deployment_jobs").select("*").eq("id",b.job_id).eq("engineering_change_id",id).maybeSingle();
   if(jobErr)throw jobErr;if(!job)return respond({error:"Job not found for this change"},404);
   if(action==="job_status")return respond({job});
   if(action==="auto_approve_job"){
    if(job.status!=="pending_approval"||change.status!=="approved")return respond({error:"Approved engineering change and pending job required"},409);
    const opKey=job.provider==="github"&&["update_file","push_files"].includes(job.operation)?"github_"+job.operation:job.provider==="supabase"&&job.operation==="deploy_function"?"supabase_deploy_function":null;
    const {data:policy,error:pe}=await db.from("sandy_engineering_delegation_policy").select("*").eq("id",1).single();
    if(pe||!policy?.enabled||!opKey||!policy.allowed_operations?.includes(opKey)||!policy.allowed_risks?.includes(change.risk))return respond({error:"Job is outside delegated approval scope",human_approval_required:true},403);
    if(job.provider==="github"&&!change.scope?.includes("github:"+job.target))return respond({error:"Approved scope does not include GitHub target"},403);
    if(job.provider==="supabase"&&!change.scope?.includes(job.target))return respond({error:"Approved scope does not include Supabase target"},403);
    const {data:tests,error:te}=await db.from("sandy_engineering_tests").select("outcome,evidence,checked_at").eq("change_id",id);
    if(te||policy.require_test_evidence&&(!tests?.length||tests.some((t:any)=>t.outcome!=="passed"||!t.checked_at||!t.evidence||Object.keys(t.evidence).length===0)))return respond({error:"Recorded passing test evidence required"},409);
    const plan=string(job.payload?.rollback_plan||b.rollback_plan,2000),prior=string(job.payload?.before_ref||b.before_ref,500);
    if(policy.require_rollback_plan&&(plan.length<25||prior.length<7))return respond({error:"Concrete rollback plan and source version required"},409);
    const {data:approved,error:ae}=await db.from("sandy_deployment_jobs").update({status:"approved",approved_by:user.id,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",job.id).eq("status","pending_approval").select("id,status").maybeSingle();
    if(ae||!approved)return respond({error:"Job auto-approval conflict"},409);
    const ev=await db.from("sandy_engineering_change_events").insert({change_id:id,event_type:"delegated_job_approved",actor:user.id,detail:{job_id:job.id,operation:opKey,rollback_plan:plan,before_ref:prior,approval_mode:"delegated",test_count:tests?.length||0}});
    if(ev.error)return respond({error:"Job approved but audit insertion failed",job_id:job.id},503);
    return respond({ok:true,job:approved,approval_mode:"delegated",human_approval_required:false,execution:"not_started"});
   }
   if(action==="approve_job"){
    if(admin.role!=="owner")return respond({error:"Owner approval required"},403);
    if(job.status!=="pending_approval")return respond({error:"Not pending approval"},409);
    const {data,error}=await db.from("sandy_deployment_jobs").update({status:"approved",approved_by:user.id,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",job.id).eq("status","pending_approval").select("*").maybeSingle();
    if(error)throw error;if(!data)return respond({error:"Concurrent approval"},409);
    await db.from("sandy_engineering_change_events").insert({change_id:id,actor:user.id,event_type:"job_approved",detail:{job_id:job.id}});
    return respond({job:data,execution:"not_started"});
   }
   if(job.status!=="approved")return respond({error:"Job must first be explicitly approved"},409);
   if(admin.role!=="owner")return respond({error:"Owner execution required"},403);
   if(job.provider!=="github"||job.operation!=="create_file")return respond({error:"No authorised executor for this operation"},422);
   const target=String(job.target||"");
   const match=target.match(/^ausstyle\/web-staging:(engineering-smoke\/[a-zA-Z0-9_-]+\.txt)$/);
   if(!match)return respond({error:"Execution restricted to isolated engineering-smoke test files"},403);
   const content=typeof job.payload?.content==="string"?job.payload.content:"";
   if(!content||content.length>2048)return respond({error:"Invalid test file content"},400);
   const githubToken=Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN");
   if(!githubToken)return respond({error:"GitHub execution credential not configured; job remains approved",configuration_required:"SANDY_ENGINEERING_GITHUB_TOKEN"},503);
   // Atomically claim the approved job before any external write.
   const {data:claim,error:claimError}=await db.from("sandy_deployment_jobs").update({status:"running",started_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",job.id).eq("status","approved").select("id").maybeSingle();
   if(claimError)throw claimError;
   if(!claim)return respond({error:"Job already claimed or executed"},409);
   const gh=await fetch("https://api.github.com/repos/ausstyle/web-staging/contents/"+match[1],{method:"PUT",headers:{"Authorization":"Bearer "+githubToken,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"},body:JSON.stringify({message:"test(engineering): "+id,content:btoa(content),branch:"main"})});
   const result=await gh.json().catch(()=>({}));
   if(!gh.ok){await db.from("sandy_deployment_jobs").update({status:"failed",error:"GitHub HTTP "+gh.status,finished_at:new Date().toISOString()}).eq("id",job.id).eq("status","running");await db.from("sandy_engineering_change_events").insert({change_id:id,actor:user.id,event_type:"execution_failed",detail:{job_id:job.id,status:gh.status}});return respond({error:"GitHub execution failed",http_status:gh.status},502)}
   const commit=String(result.commit?.sha||"");
   const blobSha=String(result.content?.sha||"");
   if(!commit||!blobSha)return respond({error:"GitHub returned no verified commit or file reference",deployment_state:"needs_reconciliation",job_id:job.id},502);
   const receipt=await db.from("sandy_deployment_jobs").update({result:{commit,path:match[1],file_sha:blobSha,verified:false},updated_at:new Date().toISOString()}).eq("id",job.id).eq("status","running").select("id").maybeSingle();
   if(receipt.error||!receipt.data)return respond({error:"GitHub write accepted but receipt persistence failed",deployment_state:"needs_reconciliation",job_id:job.id},503);
   const verify=await fetch("https://api.github.com/repos/ausstyle/web-staging/contents/"+match[1]+"?ref=main",{headers:{"Authorization":"Bearer "+githubToken,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}});
   const observed=await verify.json().catch(()=>({}));
   if(!verify.ok||observed.sha!==blobSha)return respond({error:"GitHub content verification failed",deployment_state:"needs_reconciliation",job_id:job.id},502);
   const {error:finishError}=await db.from("sandy_deployment_jobs").update({status:"succeeded",finished_at:new Date().toISOString(),result:{commit,path:match[1]},updated_at:new Date().toISOString()}).eq("id",job.id).eq("status","running");if(finishError)throw finishError;
   await db.from("sandy_engineering_artifacts").insert({change_id:id,artifact_type:"github_file",target:"ausstyle/web-staging:"+match[1],before_ref:"absent",after_ref:commit,rollback_strategy:"git_revert",metadata:{job_id:job.id,file_sha:result.content?.sha}});
   await db.from("sandy_engineering_change_events").insert({change_id:id,actor:user.id,event_type:"execution_completed",detail:{job_id:job.id,commit,path:match[1]}});
   return respond({execution:"completed",job_id:job.id,commit,path:match[1]});
  }
  if(action==="rollback_validate_smoke"){
   if(admin.role!=="owner")return respond({error:"Owner access required"},403);
   const {data:artifacts,error}=await db.from("sandy_engineering_artifacts").select("id,target,before_ref,metadata").eq("change_id",id);
   if(error)return respond({error:"Artifact lookup failed"},503);
   const eligible=artifacts?.length===1&&String(artifacts[0].target).startsWith("ausstyle/web-staging:engineering-smoke/")&&artifacts[0].before_ref==="absent";
   return respond({ok:true,eligible,artifact_count:artifacts?.length||0,execution:"not_started"});
  }
  if(action==="rollback_prepare_revert"){
   if(admin.role!=="owner")return respond({error:"Owner access required"},403);
   const {data:artifacts,error}=await db.from("sandy_engineering_artifacts").select("target,before_ref,after_ref,rollback_strategy").eq("change_id",id);
   if(error)return respond({error:"Artifact lookup failed"},503);
   const eligible=artifacts?.length===1&&String(artifacts[0].target).startsWith("ausstyle/web-staging:engineering-smoke/")&&artifacts[0].before_ref==="absent"&&Boolean(artifacts[0].after_ref);
   if(!eligible)return respond({ok:false,eligible:false,reason:"Only isolated smoke commits supported"},409);
   return respond({ok:true,eligible:true,repository:"ausstyle/web-staging",commit_to_revert:artifacts[0].after_ref,execution:"not_started",approval_required:true});
  }
  if(action==="rollback_verify_revert_pr"){
   if(admin.role!=="owner")return respond({error:"Owner access required"},403);
   if(!uuid(b.rollback_request_id))return respond({error:"Valid rollback request ID required"},400);
   const {data:request}=await db.from("sandy_engineering_rollback_requests").select("id,status").eq("id",b.rollback_request_id).eq("change_id",id).maybeSingle();
   if(!request||request.status!=="executing")return respond({error:"No executing rollback request"},409);
   const {data:events}=await db.from("sandy_engineering_change_events").select("detail").eq("change_id",id).eq("event_type","rollback_pr_created").order("occurred_at",{ascending:false}).limit(20);
   const evidence=(events||[]).find((e:any)=>e.detail?.rollback_request_id===request.id)?.detail;
   if(!Number.isInteger(evidence?.pr_number)||!String(evidence.path||"").startsWith("engineering-smoke/"))return respond({error:"Verified rollback PR reference missing"},409);
   const token=Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN");
   if(!token)return respond({error:"GitHub credential unavailable"},503);
   const headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
   const prResponse=await fetch("https://api.github.com/repos/ausstyle/web-staging/pulls/"+evidence.pr_number,{headers});
   const pr=await prResponse.json().catch(()=>({}));
   if(!prResponse.ok)return respond({error:"Rollback PR lookup failed",http_status:prResponse.status},502);
   if(!pr.merged_at)return respond({ok:true,completed:false,reason:"rollback_pr_not_merged",pr_url:pr.html_url});
   const fileResponse=await fetch("https://api.github.com/repos/ausstyle/web-staging/contents/"+evidence.path+"?ref=main",{headers});
   if(fileResponse.status!==404)return respond({ok:false,completed:false,reason:"file_still_present_or_verification_failed",http_status:fileResponse.status},409);
   const saved=await db.from("sandy_engineering_rollback_requests").update({status:"completed",updated_at:new Date().toISOString()}).eq("id",request.id).eq("status","executing").select("id").maybeSingle();
   if(saved.error||!saved.data)return respond({error:"Rollback verified but status recording failed"},503);
   const audit=await db.from("sandy_engineering_change_events").insert({change_id:id,event_type:"rollback_verified",actor:user.id,detail:{rollback_request_id:request.id,pr_number:evidence.pr_number,merge_commit:pr.merge_commit_sha,path:evidence.path}});
   if(audit.error)return respond({error:"Rollback completed but audit insertion failed"},503);
   return respond({ok:true,completed:true,verified:true,rollback_request_id:request.id,merge_commit:pr.merge_commit_sha});
  }
  if(action==="rollback_create_revert_pr"){
   if(admin.role!=="owner")return respond({error:"Owner execution required"},403);
   if(!uuid(b.rollback_request_id))return respond({error:"Valid rollback request ID required"},400);
   const {data:request,error:re}=await db.from("sandy_engineering_rollback_requests").select("id,status").eq("id",b.rollback_request_id).eq("change_id",id).maybeSingle();
   if(re||!request)return respond({error:"Rollback request not found"},404);
   if(request.status!=="approved")return respond({error:"Approved rollback request required"},409);
   const {data:artifacts,error:ae}=await db.from("sandy_engineering_artifacts").select("target,before_ref,after_ref,metadata").eq("change_id",id);
   if(ae||artifacts?.length!==1)return respond({error:"One isolated smoke artifact required"},409);
   const artifact=artifacts[0],target=String(artifact.target||"");
   const prefix="ausstyle/web-staging:engineering-smoke/";
   if(!target.startsWith(prefix)||!target.endsWith(".txt")||artifact.before_ref!=="absent")return respond({error:"Target not eligible for controlled revert"},403);
   const filename=target.slice(prefix.length,-4);
   if(!/^[a-zA-Z0-9_-]+$/.test(filename))return respond({error:"Invalid rollback filename"},403);
   const token=Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN");
   if(!token)return respond({error:"GitHub executor credential unavailable"},503);
   const path="engineering-smoke/"+filename+".txt";
   const gh="https://api.github.com/repos/ausstyle/web-staging";
   const headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"};
   const current=await fetch(gh+"/contents/"+path+"?ref=main",{headers});
   const currentFile=await current.json().catch(()=>({}));
   if(!current.ok||currentFile.sha!==artifact.metadata?.file_sha)return respond({error:"Original file changed or missing; rollback refused"},409);
   const ref=await fetch(gh+"/git/ref/heads/main",{headers});
   const branch=await ref.json().catch(()=>({}));
   if(!ref.ok||!branch.object?.sha)return respond({error:"Unable to resolve main"},502);
   const parent=branch.object.sha;
   const baseline=await fetch(gh+"/git/commits/"+parent,{headers});
   const base=await baseline.json().catch(()=>({}));
   if(!baseline.ok||!base.tree?.sha)return respond({error:"Unable to resolve Git tree"},502);
   const treeResponse=await fetch(gh+"/git/trees",{method:"POST",headers,body:JSON.stringify({base_tree:base.tree.sha,tree:[{path,mode:"100644",type:"blob",sha:null}]})});
   const tree=await treeResponse.json().catch(()=>({}));
   if(!treeResponse.ok||!tree.sha)return respond({error:"GitHub revert tree creation failed",http_status:treeResponse.status},502);
   const commitResponse=await fetch(gh+"/git/commits",{method:"POST",headers,body:JSON.stringify({message:"revert(engineering): "+id,tree:tree.sha,parents:[parent]})});
   const commit=await commitResponse.json().catch(()=>({}));
   if(!commitResponse.ok||!commit.sha)return respond({error:"Revert commit creation failed",http_status:commitResponse.status},502);
   const branchName="sandy-rollback/"+id.replaceAll("-","").slice(0,20);
   const newRef=await fetch(gh+"/git/refs",{method:"POST",headers,body:JSON.stringify({ref:"refs/heads/"+branchName,sha:commit.sha})});
   if(!newRef.ok)return respond({error:"Rollback branch creation failed",http_status:newRef.status,commit:commit.sha},502);
   const prResponse=await fetch(gh+"/pulls",{method:"POST",headers,body:JSON.stringify({title:"Revert Sandy engineering smoke change "+id,head:branchName,base:"main",body:"Controlled rollback request "+request.id+" for "+path+". Review and merge to restore the previous state."})});
   const pr=await prResponse.json().catch(()=>({}));
   if(!prResponse.ok||!pr.number)return respond({error:"Rollback branch created but pull request failed",commit:commit.sha,http_status:prResponse.status},502);
   const saved=await db.from("sandy_engineering_rollback_requests").update({status:"executing",updated_at:new Date().toISOString()}).eq("id",request.id).eq("status","approved").select("id").maybeSingle();
   const audit=await db.from("sandy_engineering_change_events").insert({change_id:id,event_type:"rollback_pr_created",actor:user.id,detail:{rollback_request_id:request.id,pr_number:pr.number,pr_url:pr.html_url,commit:commit.sha,path}});
   if(saved.error||!saved.data||audit.error)return respond({error:"PR created but database reconciliation required",pr_url:pr.html_url},503);
   return respond({ok:true,execution:"awaiting_pr_merge",pr_url:pr.html_url,pr_number:pr.number,rollback_request_id:request.id,verified_rolled_back:false});
  }
  if(action==="rollback_approve"){
   if(admin.role!=="owner")return respond({error:"Owner approval required"},403);
   if(!uuid(b.rollback_request_id))return respond({error:"Valid rollback request ID required"},400);
   const {data:request,error:lookupError}=await db.from("sandy_engineering_rollback_requests").select("id,status,plan").eq("id",b.rollback_request_id).eq("change_id",id).maybeSingle();
   if(lookupError||!request)return respond({error:"Rollback request not found"},404);
   if(request.status!=="pending_approval")return respond({error:"Rollback request not pending approval",status:request.status},409);
   const {data:updated,error:updateError}=await db.from("sandy_engineering_rollback_requests").update({status:"approved",updated_at:new Date().toISOString()}).eq("id",request.id).eq("status","pending_approval").select("id,status").maybeSingle();
   if(updateError||!updated)return respond({error:"Rollback approval failed or concurrent update"},409);
   const event=await db.from("sandy_engineering_change_events").insert({change_id:id,event_type:"rollback_approved",actor:user.id,detail:{rollback_request_id:request.id}});
   if(event.error)return respond({error:"Approval updated but audit event failed",request_id:request.id},503);
   return respond({ok:true,rollback:updated,execution:"not_started"});
  }
  if(action==="rollback_request"){
   const reason=string(b.reason,3000);if(reason.length<4)return respond({error:"Rollback reason required"},400);
   const {data:artifacts,error:artifactError}=await db.from("sandy_engineering_artifacts").select("*").eq("change_id",id);
   if(artifactError)throw artifactError;
   const plan=(artifacts||[]).map(a=>({artifact_id:a.id,target:a.target,before_ref:a.before_ref,after_ref:a.after_ref,strategy:a.rollback_strategy,requires_approval:true,notes:a.rollback_notes}));
   const {data,error}=await db.from("sandy_engineering_rollback_requests").insert({change_id:id,requested_by:user.id,reason,plan}).select("*").single();
   if(error)throw error;
   await db.from("sandy_engineering_change_events").insert({change_id:id,event_type:"rollback_requested",actor:user.id,detail:{rollback_request_id:data.id,artifact_count:plan.length}});
   return respond({rollback:data,execution:"not_started",requires_approval:true},201);
  }
  return respond({error:"Unknown action"},400);
 }catch(err){console.error("engineering-control error",err);return respond({error:"Engineering control operation failed"},500)}
});
