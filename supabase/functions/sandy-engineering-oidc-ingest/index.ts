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
const WORKFLOW_REF = REPO + "/.github/workflows/sandy-engineering-outcome-observer.yml@refs/heads/main";
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
  if(claims.repository!==REPO || String(claims.repository_id)!==REPO_ID ||
     claims.workflow_ref!==WORKFLOW_REF || claims.event_name!=="workflow_run" ||
     claims.ref!=="refs/heads/main") return fail("unauthorized_workflow",403);

  let body:Record<string,unknown>;
  try {body=await req.json();} catch {return fail("invalid_json");}
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
  if(run.name!=="Sandy Architect and Engineer" || run.event!=="workflow_dispatch" ||
     run.status!=="completed" || run.head_repository?.full_name!==REPO ||
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
  if(!handoffs||handoffs.length!==1) return fail("handoff_not_unique",409);
  const issueKey=handoffs[0].issue_key;
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
