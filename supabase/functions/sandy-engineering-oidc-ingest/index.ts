import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@5.10.0";

// This endpoint accepts ONLY short-lived GitHub Actions OIDC identity assertions.
// No shared GitHub secret, API key, customer data or production source is accepted.
const PROJECT = "zmqlyygzqoidkcwdysok";
const REPO = "ausstyle/web-staging";
const REPO_ID = "1416227508";
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "sandy-engineering-outcomes-" + PROJECT;
const OBSERVER_REF = REPO + "/.github/workflows/sandy-engineering-outcome-observer.yml@refs/heads/main";
const ENGINEERING_REF = REPO + "/.github/workflows/sandy-codex-engineering.yml@refs/heads/main";
const QA_REF = REPO + "/.github/workflows/sandy-v2-api-qa.yml@refs/heads/main";
const keys = createRemoteJWKSet(new URL(ISSUER + "/.well-known/jwks"));
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {
  status, headers: {"content-type":"application/json","cache-control":"no-store"},
});
const fail = (reason: string, status=400) => json({ok:false,reason},status);
const digits=(value:unknown,min=1,max=20) => typeof value==="string" &&
  new RegExp("^[1-9][0-9]{"+Math.max(0,min-1)+","+(max-1)+"}$").test(value);

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST") return fail("method_not_allowed",405);
  if(Number(req.headers.get("content-length")||"0")>4096) return fail("oversized_request",413);
  const auth=req.headers.get("authorization")||"";
  if(!auth.startsWith("Bearer ")||auth.length>10000) return fail("missing_oidc",401);
  let claims:Record<string,unknown>;
  try {
    const verified=await jwtVerify(auth.slice(7),keys,{
      issuer:ISSUER,audience:AUDIENCE,algorithms:["RS256"],clockTolerance:5,
    });
    claims=verified.payload as Record<string,unknown>;
  } catch {return fail("invalid_oidc",401);}
  const observerFlow=claims.workflow_ref===OBSERVER_REF&&claims.event_name==="workflow_run";
  const inlineFlow=claims.workflow_ref===ENGINEERING_REF&&claims.event_name==="workflow_dispatch";
  const qaFlow=claims.workflow_ref===QA_REF&&["push","schedule","workflow_dispatch"].includes(String(claims.event_name));
  if(claims.repository!==REPO || String(claims.repository_id)!==REPO_ID ||
     (!observerFlow&&!inlineFlow&&!qaFlow) || claims.ref!=="refs/heads/main")
    return fail("unauthorized_workflow",403);

  let body:Record<string,unknown>;
  try {body=await req.json();} catch {return fail("invalid_json");}

  if(qaFlow){
    if(body.operation!=="v2_api_qa"||Object.keys(body).some(k=>k!=="operation"))
      return fail("qa_operation_restricted",403);
    const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    if(!url||!key)return fail("qa_backend_unconfigured",503);
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:account,error:accountError}=await db.from("sandy_v2_qa_account")
      .select("customer_id,enabled,max_calls_per_day,max_calls_per_run").eq("id",1).maybeSingle();
    if(accountError||!account?.enabled||!account.customer_id)return fail("qa_account_not_enabled",503);
    const customerId=String(account.customer_id);
    // A synthetic, unconnected customer is essential: this suite must never touch real customers.
    const checks=await Promise.all([
      db.from("sandy_composio_connections").select("connected_account_id",{count:"exact",head:true}).eq("customer_id",customerId),
      db.from("email_customer_addresses").select("id",{count:"exact",head:true}).eq("customer_id",customerId),
      db.from("sandy_whatsapp_identities").select("wa_id",{count:"exact",head:true}).eq("customer_id",customerId),
      db.from("sandy_memory_portal_accounts").select("customer_id",{count:"exact",head:true}).eq("customer_id",customerId)
    ]);
    if(checks.some(x=>x.error)||checks.some(x=>Number(x.count||0)>0))
      return fail("qa_synthetic_identity_is_not_isolated",409);
    const runKey="github:"+String(claims.run_id);
    if(!/^[0-9]{5,20}$/.test(String(claims.run_id||"")))return fail("qa_invalid_run_identity",401);
    const {error:reserved}=await db.from("sandy_v2_qa_runs").insert({run_key:runKey,status:"running"});
    if(reserved?.code==="23505")return json({ok:true,duplicate_run:true,run_key:runKey});
    if(reserved)return fail("qa_run_reservation_failed",503);
    // Recover abandoned test-run state independently, without replaying an old request.
    const staleBefore=new Date(Date.now()-15*60*1000).toISOString();
    const {data:stale,error:staleError}=await db.from("sandy_v2_qa_runs")
      .select("run_key").eq("status","running").lt("started_at",staleBefore).neq("run_key",runKey).limit(20);
    if(!staleError&&stale?.length){
      for(const old of stale){
        await db.from("sandy_v2_qa_runs").update({status:"failed",completed_at:new Date().toISOString()})
          .eq("run_key",old.run_key).eq("status","running");
      }
      await db.from("sandy_qa_cases").upsert({
        test_key:"v2_api_qa_stalled_runner",subject:"Sandy V2 QA run stalled before completion",
        status:"failed",findings:"A previous signed GitHub QA run exceeded the 15-minute completion window. Investigate GitHub runner, downstream API receipts and missing persistence; do not retry sends.",
        next_action:"Review retained GitHub run and sandbox trace; correct the underlying failure.",
        updated_at:new Date().toISOString()
      },{onConflict:"test_key"});
    }

    const since=new Date(Date.now()-24*60*60*1000).toISOString();
    const {count:used,error:usageError}=await db.from("sandy_v2_qa_executions")
      .select("id",{head:true,count:"exact"}).eq("customer_id",customerId).gte("created_at",since);
    if(usageError){
      await db.from("sandy_v2_qa_runs").update({status:"failed",completed_at:new Date().toISOString()}).eq("run_key",runKey);
      return fail("qa_budget_query_failed",503);
    }
    if(Number(used||0)>=Math.min(200,Number(account.max_calls_per_day)||80)){
      await db.from("sandy_v2_qa_runs").update({status:"complete",completed_at:new Date().toISOString()}).eq("run_key",runKey);
      return json({ok:true,skipped:"rolling_24_hour_budget",max_per_day:account.max_calls_per_day});
    }
    const cases=[
      {key:"clock",prompts:["What time is it?","Please tell me the current time."],expect:"verified_clock"},
      {key:"connections",prompts:["Hi, can you tell me which connected services I have with Sandy?","Which apps are connected to my Sandy account?"],expect:"no_test_customer_connections"},
      {key:"web_history",prompts:["How many web chat messages have I sent Sandy?","Can you count my Sandy web chat messages from your own records?"],expect:"web_scoped_count"},
      {key:"cross_channel",prompts:["Give me the recorded numbers of my messages over web chat, WhatsApp, voice and email. Distinguish unknowns.","Check your own systems and tell me what you can verify about my messages across every channel."],expect:"multi_channel_provenance"},
      {key:"location",prompts:["Do you know my exact physical location right now?","Can you determine which street I am on from my account?"],expect:"no_unverified_location"},
      {key:"task_count",prompts:["How many outstanding tasks does Sandy have recorded for my account?","Check my actual tasks and tell me the number still outstanding."],expect:"real_task_tool"},
      {key:"followup_investigation",prompts:["Can you investigate the other channels now?", "Find the other channel counts please."],expect:"proactive_followup"},
      {key:"capability",prompts:["Explain which services you can actually execute in my Sandy account, rather than which integrations are supported generally.","What can you verify about your connected apps and your present limitations?"],expect:"capability_grounding"}
    ];
    const allowed=Math.min(2,Number(account.max_calls_per_run)||1,Math.max(0,Number(account.max_calls_per_day)-(used||0)));
    const outputs:any[]=[];
    for(let i=0;i<allowed;i++){
      const ordinal=Number(used||0)+i;
      const testcase=cases[ordinal%cases.length];
      const variant=Math.floor(ordinal/cases.length)%testcase.prompts.length;
      const question=testcase.prompts[variant];
      const requestId="v2qa_"+crypto.randomUUID();
      const started=Date.now();
      let edgeStatus=0,answer="",trace:any[]=[],taskModel:string|null=null,reason="",verdict:"pass"|"fail"|"needs_review"|"blocked"="needs_review";
      try{
        const rsp=await fetch(url+"/functions/v1/sandy-agent-runtime",{
          method:"POST",
          headers:{"authorization":"Bearer "+key,"content-type":"application/json"},
          body:JSON.stringify({channel:"test",request_id:requestId,customer_id:customerId,request:question,timezone:"UTC"}),
          signal:AbortSignal.timeout(110000)
        });
        edgeStatus=rsp.status;
        const payload=await rsp.json().catch(()=>({}));
        answer=String(payload?.response||"").slice(0,6000);
        const {data:task,error:taskError}=await db.from("sandy_agent_tasks").select("status,tool_trace,model,customer_id")
          .eq("customer_id",customerId).eq("request_id",requestId).maybeSingle();
        if(taskError)throw Error("task_receipt_unavailable");
        trace=Array.isArray(task?.tool_trace)?task.tool_trace:[];
        taskModel=typeof task?.model==="string"?task.model.slice(0,100):null;
        const normalized=answer.toLowerCase();
        const had=(tool:string)=>trace.some((t:any)=>t?.tool===tool&&t.success===true);
        const any=(...parts:string[])=>parts.some(x=>normalized.includes(x));
        if(!rsp.ok||!answer||task?.status!=="completed"){
          verdict="fail";reason="api_failure_or_unverified_task_completion";
        }else if(testcase.key==="clock"){
          verdict=had("system_clock")&&/\b(utc|am|pm|\d{1,2}:\d{2})\b/i.test(answer)?"pass":"fail";
          reason=verdict==="pass"?"server_clock_receipt":"missing_verified_clock";
        }else if(testcase.key==="connections"){
          verdict=had("v2_connection_preflight")&&any("no active","no connected","no apps","no services","no app connections")?"pass":"needs_review";
          reason=verdict==="pass"?"verified_empty_sandbox_connections":"connection_status_requires_review";
        }else if(testcase.key==="web_history"){
          const {count,error}=await db.from("sandy_web_turns").select("id",{head:true,count:"exact"}).eq("customer_id",customerId);
          if(error)throw Error("web_count_evidence_unavailable");
          verdict=normalized.includes(String(count??0))&&any("web","chat")?"pass":"fail";
          reason=verdict==="pass"?"matches_database_web_count":"message_count_mismatch";
        }else if(testcase.key==="cross_channel"){
          if(!had("v2_operational_read")){verdict="fail";reason="missing_cross_channel_inspection_receipt";}
          else if(["web","whatsapp","voice","email"].every(x=>normalized.includes(x))&&!any("cannot access any","have no access to any")){
            verdict="needs_review";reason="all_channels_described_independent_semantic_review_needed";
          }else{verdict="fail";reason="incomplete_cross_channel_reply";}
        }else if(testcase.key==="location"){
          verdict=any("can't access","cannot access","don't have","do not have","not know","can't determine","cannot determine","not available","no access")?"pass":"needs_review";
          reason=verdict==="pass"?"location_not_inferred":"location_response_needs_review";
        }else if(testcase.key==="task_count"){
          verdict=had("list_tasks")&&any("0","zero","no outstanding","no open","none")?"pass":"fail";
          reason=verdict==="pass"?"verified_tasks_query":"task_reply_missing_evidence";
        }else {
          verdict=any("not available","not connected","no connected","can't","cannot","not verified","not necessarily","not enabled")?"pass":"needs_review";
          reason=verdict==="pass"?"cautious_capability_statement":"capability_reply_needs_review";
        }
      }catch(e){verdict="blocked";reason=String(e).replace(/[^a-z0-9_ -]/gi,"").slice(0,110);}
      const duration=Date.now()-started;
      const {error:writeError}=await db.from("sandy_v2_qa_executions").insert({
        run_key:runKey,case_key:testcase.key,request_id:requestId,customer_id:customerId,
        question,reply:answer,tool_trace:trace,verdict,reason,edge_status:edgeStatus||null,duration_ms:duration,
        evidence:{expected:testcase.expect,model_response_present:answer.length>0,tool_count:trace.length,
          source:"authenticated_real_sandy_agent_runtime",independent_test_account:true,observed_model:taskModel}
      });
      if(writeError){
        await db.from("sandy_v2_qa_runs").update({status:"failed",completed_at:new Date().toISOString()}).eq("run_key",runKey);
        return fail("qa_evidence_not_saved",503);
      }
      const caseKey="v2_api_qa_"+testcase.key;
      // A single pass does not retire a defect; require two independently recorded consecutive passes.
      const {data:recent,error:recentError}=await db.from("sandy_v2_qa_executions")
        .select("verdict").eq("case_key",testcase.key).order("created_at",{ascending:false}).limit(2);
      const corroborated=!recentError&&(recent?.length||0)>=2&&recent!.every((x:any)=>x.verdict==="pass");
      const state=verdict==="pass"?(corroborated?"passed":"retest_pending"):
        verdict==="fail"?"failed":"needs_review";
      const summary="Real API result ("+verdict+"): "+reason+". Request "+requestId+
        ". Source: sandbox Sandy agent-runtime; independently persisted tool receipt. See sandy_v2_qa_executions.";
      const {error:caseErr}=await db.from("sandy_qa_cases").upsert({
        test_key:caseKey,subject:"Sandy V2 autonomous API QA: "+testcase.key,
        status:state,findings:summary,next_action:verdict==="pass"?(corroborated?"Keep scheduled regression monitoring":"Await a second independent passing API result"):
          "Investigate actual QA execution and fix root cause before marking complete",
        updated_at:new Date().toISOString()
      },{onConflict:"test_key"});
      if(caseErr)console.error("qa_case_log_failed",caseErr.code);
      if(verdict==="fail"){
        const {count:failCount}=await db.from("sandy_v2_qa_executions").select("id",{head:true,count:"exact"})
          .eq("case_key",testcase.key).eq("verdict","fail").gte("created_at",since);
        if((failCount||0)>=2){
          const secret=Deno.env.get("SANDY_AUTO_IMPROVE_KEY")||Deno.env.get("EMAIL_AI_INTERNAL_KEY");
          if(secret){
            const payload={source_type:"qa_failure",source_ref:caseKey,problem:
              "Repeated authenticated Sandy V2 API QA failure for "+testcase.key+" on an isolated synthetic user account. "+
              " Expected: "+testcase.expect+". Actual: "+reason+". Model: "+(taskModel||"unknown")+
              ". Read-only question: "+question.slice(0,220)+". Actual reply excerpt: "+answer.slice(0,650)+
              ". Tool evidence: "+JSON.stringify(trace.map((t:any)=>({tool:t.tool,success:t.success}))).slice(0,500)+
              ". Diagnose the root cause in deployed source; do not assume a repair or use real customer data."};
            const diagnostic=fetch(url+"/functions/v1/sandy-auto-improve",{
              method:"POST",headers:{"authorization":"Bearer "+secret,"content-type":"application/json"},
              body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)
            }).then(async r=>{if(!r.ok)console.error("v2_qa_auto_improve_http",r.status)})
              .catch(e=>console.error("v2_qa_auto_improve_err",String(e).slice(0,100)));
            EdgeRuntime.waitUntil(diagnostic);
          }
        }
      }
      outputs.push({case:testcase.key,verdict,reason,duration_ms:duration,request_id:requestId});
    }
    const summary={attempted:outputs.length,passed:outputs.filter(x=>x.verdict==="pass").length,
      failed:outputs.filter(x=>x.verdict==="fail").length,reviews:outputs.filter(x=>x.verdict==="needs_review").length};
    await db.from("sandy_v2_qa_runs").update({status:summary.failed?"partial":"complete",
      ...summary,completed_at:new Date().toISOString()}).eq("run_key",runKey);
    // No customer-sensitive content or API token in the external result.
    return json({ok:true,run_key:runKey,...summary,results:outputs});
  }
  if(!observerFlow&&!inlineFlow)return fail("qa_only_workflow_not_authorized_for_engineering",403);
  const issue=body.issue_number,runId=body.architecture_run_id,decision=body.decision,pr=body.pr_number;
  if(!Number.isSafeInteger(issue)||Number(issue)<1||Number(issue)>999999||
     !digits(runId,5,20)||!["READY","BLOCKED"].includes(String(decision))||
     (pr!==null&&pr!==undefined&&(!Number.isSafeInteger(pr)||Number(pr)<1||Number(pr)>9999999)))
    return fail("invalid_outcome");
  const github=await fetch("https://api.github.com/repos/"+REPO+"/actions/runs/"+runId,{
    headers:{"accept":"application/vnd.github+json","user-agent":"sandy-engineering-evidence"},
  }).catch(()=>null);
  if(!github||!github.ok) return fail("github_run_unavailable",503);
  const run=await github.json();
  const sameRun=inlineFlow && String(claims.run_id)===String(runId);
  if(run.path!==".github/workflows/sandy-codex-engineering.yml" ||
     run.workflow_id!==387224954 || run.event!=="workflow_dispatch" ||
     !(run.status==="completed" || (sameRun&&run.status==="in_progress")) ||
     (inlineFlow&&!sameRun) || run.head_repository?.full_name!==REPO ||
     run.display_title!=="Sandy engineering issue #"+issue)
    return fail("unverified_architect_run",409);

  if(pr!==null&&pr!==undefined){
    if(decision!=="READY") return fail("pr_requires_ready");
    const response=await fetch("https://api.github.com/repos/"+REPO+"/pulls/"+pr,{
      headers:{"accept":"application/vnd.github+json","user-agent":"sandy-engineering-evidence"},
    }).catch(()=>null);
    if(!response||!response.ok) return fail("github_pr_unavailable",503);
    const pull=await response.json();
    if(pull.head?.ref!=="sandy/codex-issue-"+issue+"-"+runId ||
       pull.head?.repo?.full_name!==REPO || pull.base?.ref!=="main")
      return fail("unverified_engineer_pr",409);
  }

  const url=Deno.env.get("SUPABASE_URL");
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) return fail("backend_unconfigured",503);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const githubIssue="https://github.com/"+REPO+"/issues/"+issue;
  const {data:handoffs,error:readError}=await db.from("sandy_qa_engineering_handoffs")
    .select("issue_key").eq("evidence->>github_issue_url",githubIssue).limit(2);
  if(readError) return fail("handoff_lookup_failed",503);
  let issueKey=handoffs?.length===1?handoffs[0].issue_key:null;
  if(!issueKey && !handoffs?.length){
    // Only trusted GitHub-only source may be onboarded without a production-source audit.
    // Existing Supabase-function incidents continue to require verified source parity.
    const issueResponse=await fetch("https://api.github.com/repos/"+REPO+"/issues/"+issue,{
      headers:{"accept":"application/vnd.github+json","user-agent":"sandy-verified-engineering"},
    }).catch(()=>null);
    if(!issueResponse||!issueResponse.ok)return fail("github_issue_unavailable",503);
    const recordedIssue=await issueResponse.json();
    const issueBody=String(recordedIssue.body||"");
    const allowedAcceptanceDocs:Record<number,string>={
      65:"docs/sandy/autonomous-lifecycle-live-verification.md",
      72:"docs/sandy/autonomous-lifecycle-second-acceptance.md",
    };
    const acceptanceDoc=allowedAcceptanceDocs[Number(issue)];
    const docsOnly=Boolean(acceptanceDoc)&&issueBody.includes(acceptanceDoc)&&
      pr!==null&&pr!==undefined &&
      issueBody.includes("<!-- sandy-repo-only-engineering -->");
    const sourceMatch=issueBody.match(new RegExp("scripts/sandy/[a-z0-9_-]+[.]py","i"));
    if(recordedIssue.state!=="open"||recordedIssue.pull_request||
       !String(recordedIssue.title||"").startsWith("Sandy QA:")||
       !recordedIssue.labels?.some((l:any)=>l.name==="sandy-autonomous-ready")||
       !issueBody.includes("<!-- sandy-repo-only-engineering -->")||(!sourceMatch&&!docsOnly)||
       !/^[a-f0-9]{40}$/.test(String(run.head_sha||"")))
      return fail("repo_only_onboarding_not_authorised",409);
    const fileUrl="https://api.github.com/repos/"+REPO+"/contents/"+
      (docsOnly?"supabase/functions/sandy-engineering-oidc-ingest/index.ts":sourceMatch![0])+"?ref="+run.head_sha;
    const sourceResponse=await fetch(fileUrl,{
      headers:{"accept":"application/vnd.github+json","user-agent":"sandy-verified-engineering"},
    }).catch(()=>null);
    if(!sourceResponse||!sourceResponse.ok)return fail("github_source_not_verified",409);
    const sourceMeta=await sourceResponse.json();
    if(sourceMeta.type!=="file"||!sourceMeta.sha)return fail("github_source_not_verified",409);
    if(docsOnly){
      // Pin this exception to the pre-existing acceptance issue and its exact
      // independently generated draft PR. Never authorize executable code.
      const pullResponse=await fetch("https://api.github.com/repos/"+REPO+"/pulls/"+pr+"/files?per_page=100",{
        headers:{"accept":"application/vnd.github+json","user-agent":"sandy-verified-engineering"},
      }).catch(()=>null);
      if(!pullResponse||!pullResponse.ok)return fail("docs_diff_unavailable",503);
      const files=await pullResponse.json();
      if(!Array.isArray(files)||files.length!==1||
        files[0].filename!==acceptanceDoc||
        files[0].status!=="added"||files[0].deletions!==0||
        !Number.isSafeInteger(files[0].additions)||files[0].additions>120)
        return fail("docs_scope_unverified",409);
    }
    const priorityMatch=issueBody.match(new RegExp("priority[ :]+([0-9]{1,3})","i"));
    const priority=Math.min(100,Math.max(1,Number(priorityMatch?.[1]||80)));
    const registered=await db.rpc("sandy_autonomous_engineering_register_repo_issue",{
      p_issue_number:issue,p_run_id:String(runId),p_source_sha:String(run.head_sha),
      p_priority:priority,
    });
    if(registered.error||registered.data?.registered!==true)
      return fail("repository_issue_registration_failed",409);
    issueKey=registered.data.issue_key;
  }
  if(!issueKey||handoffs?.length>1)return fail("handoff_not_unique",409);
  const evidence={run_id:String(runId),github_issue_url:githubIssue,
    workflow_run_url:"https://github.com/"+REPO+"/actions/runs/"+runId,
    decision:String(decision),source:"github_oidc_observer"};
  const event=async(type:string,id:string,ev:Record<string,unknown>)=>
    await db.rpc("sandy_autonomous_engineering_record_event",{
      p_issue_key:issueKey,p_event_key:id,p_event_type:type,p_evidence:ev,
    });
  const action=decision==="BLOCKED"?"architect_blocked":"architect_ready";
  const result=await event(action,issueKey+":architect:"+runId+":"+decision,evidence);
  if(result.error) return fail("state_transition_rejected",409);
  if(pr!==null&&pr!==undefined){
    const resultPR=await event("engineering_pr_created",issueKey+":engineer:"+runId+":"+pr,{
      ...evidence,pr_number:String(pr),pr_url:"https://github.com/"+REPO+"/pull/"+pr,
    });
    if(resultPR.error) return fail("pr_transition_rejected",409);
  }
  return json({ok:true,recorded:true,decision,pr_recorded:pr!==null&&pr!==undefined});
});
