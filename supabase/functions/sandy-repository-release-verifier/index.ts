import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@5.10.0";

const REPO="ausstyle/web-staging", REPO_ID="1416227508";
const PROJECT="zmqlyygzqoidkcwdysok";
const ISSUER="https://token.actions.githubusercontent.com";
const AUDIENCE="sandy-repository-release-"+PROJECT;
const WORKFLOW_REF=REPO+"/.github/workflows/sandy-repository-release-verifier.yml@refs/heads/main";
const JWKS=createRemoteJWKSet(new URL(ISSUER+"/.well-known/jwks"));
const answer=(status:number,value:unknown)=>new Response(JSON.stringify(value),{
  status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const fail=(message:string,status=400)=>answer(status,{ok:false,error:message});
const num=(x:unknown,max=100000000000000)=>Number.isSafeInteger(x)&&Number(x)>0&&Number(x)<max;
const hex=(s:unknown)=>typeof s==="string"&&/^[a-f0-9]{40}$/.test(s);
const get=async(path:string):Promise<any|null>=>{
  const response=await fetch("https://api.github.com/repos/"+REPO+"/"+path,{
    headers:{"accept":"application/vnd.github+json","user-agent":"sandy-repository-verifier"},
  }).catch(()=>null);
  return response?.ok?response.json():null;
};
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return fail("method_not_allowed",405);
  if(Number(req.headers.get("content-length")||"0")>2048)return fail("oversized",413);
  const header=req.headers.get("authorization")||"";
  if(!header.startsWith("Bearer ")||header.length>10000)return fail("missing_oidc",401);
  let claims:any;
  try{
    const verified=await jwtVerify(header.slice(7),JWKS,{
      issuer:ISSUER,audience:AUDIENCE,algorithms:["RS256"],clockTolerance:5});
    claims=verified.payload;
  }catch{return fail("invalid_oidc",401);}
  if(claims.repository!==REPO||String(claims.repository_id)!==REPO_ID||
    claims.workflow_ref!==WORKFLOW_REF||!["workflow_run","push","schedule"].includes(String(claims.event_name))||
    claims.ref!=="refs/heads/main")return fail("unauthorised_workflow",403);
  let payload:any;
  try{payload=await req.json()}catch{return fail("invalid_body")}
  const {ci_run_id,pr_number,issue_number}=payload||{};
  if(!num(ci_run_id)||!num(pr_number,10000000)||!num(issue_number,1000000))return fail("invalid_identifiers");
  const [run,pr,issue]=await Promise.all([
    get("actions/runs/"+ci_run_id),get("pulls/"+pr_number),get("issues/"+issue_number)]);
  if(!run||!pr||!issue)return fail("missing_github_evidence",503);
  if(run.path!==".github/workflows/sandy-regression-checks.yml"||
    run.status!=="completed"||run.conclusion!=="success"||
    !(run.event==="push"||run.event==="workflow_dispatch")||run.head_branch!=="main"||run.head_repository?.full_name!==REPO||
    !hex(run.head_sha)||pr.merged!==true||pr.state!=="closed"||
    pr.base?.ref!=="main"||pr.base?.repo?.full_name!==REPO||
    pr.merge_commit_sha!==run.head_sha||
    pr.head?.repo?.full_name!==REPO)
    return fail("unverified_main_release",409);
  const expectedBranch=new RegExp("^sandy/codex-issue-"+issue_number+"-[0-9]{5,20}$");
  if(pr.user?.login!=="github-actions[bot]"||!expectedBranch.test(String(pr.head?.ref||"")))
    return fail("not_independently_engineered_bot_pr",409);
  if(issue.pull_request||!String(issue.body||"").includes("<!-- sandy-repo-only-engineering -->")||
     issue.repository_url!=="https://api.github.com/repos/"+REPO||
     !(new RegExp("(?:close[sd]?|fix(?:e[sd])?|references?)\\s+#"+issue_number+"\\b","i"))
       .test(String(pr.body||"")))return fail("unverified_repository_issue",409);
  const files=await get("pulls/"+pr_number+"/files?per_page=20");
  if(!Array.isArray(files)||files.length<1||files.length>5||
     files.some((f:any)=>typeof f.filename!=="string"||
       !(/^scripts\/sandy\/[a-zA-Z0-9_.\/-]+\.py$/.test(f.filename)||/^docs\/sandy\/[a-zA-Z0-9_.\/-]+\.md$/.test(f.filename))||
       String(f.status)==="removed"))return fail("unsafe_release_scope",409);

  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return fail("backend_unconfigured",503);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const issueKey="github:issue:"+issue_number;
  const {data:cycle,error:cycleError}=await db.from("sandy_autonomous_engineering_cycles")
    .select("id").eq("issue_key",issueKey).maybeSingle();
  if(cycleError||!cycle?.id)return fail("engineering_cycle_not_verified",409);
  const {data:engineeringEvent,error:eventError}=await db.from("sandy_autonomous_engineering_events")
    .select("id").eq("cycle_id",cycle.id).eq("event_type","engineering_pr_created")
    .eq("evidence->>pr_number",String(pr_number)).limit(1).maybeSingle();
  if(eventError||!engineeringEvent?.id)return fail("release_pr_not_signed_engineering",409);
  const autonomous=(
    typeof pr.head?.ref==="string" &&
    new RegExp("^sandy/codex-issue-"+issue_number+"-[0-9]{5,20}$").test(pr.head.ref) &&
    pr.head?.repo?.full_name===REPO);
  const {data,error}=await db.rpc("sandy_autonomous_repository_release_verified",{
    p_issue_key:issueKey,p_pr_number:pr_number,p_merge_sha:run.head_sha,
    p_ci_run_id:String(ci_run_id),p_autonomous_engineer:Boolean(autonomous),
  });
  if(error)return fail("repository_state_rejected",409);
  return answer(200,{ok:true,scope:"repository_only",production_verified:false,
    recorded:data?.recorded===true,duplicate:data?.duplicate===true});
});
