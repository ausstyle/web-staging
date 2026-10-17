import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
import {createRemoteJWKSet,jwtVerify} from "npm:jose@5.10.0";

const audience="sandy-feature-discovery-zmqlyygzqoidkcwdysok";
const issuer="https://token.actions.githubusercontent.com";
const jwks=createRemoteJWKSet(new URL(issuer+"/.well-known/jwks"));
const expectedWorkflow="ausstyle/web-staging/.github/workflows/sandy-feature-discovery.yml@refs/heads/main";
const authorizeGithub=async(req:Request):Promise<boolean>=>{
 const header=req.headers.get("authorization")||"";
 if(!header.startsWith("Bearer ")||header.length>10000)return false;
 try{
  const {payload}=await jwtVerify(header.slice(7),jwks,{
   issuer,audience,algorithms:["RS256"],clockTolerance:5});
  return payload.repository==="ausstyle/web-staging" &&
   String(payload.repository_id)==="1416227508" &&
   payload.workflow_ref===expectedWorkflow &&
   payload.ref==="refs/heads/main" &&
   (payload.event_name==="schedule"||payload.event_name==="workflow_dispatch"||payload.event_name==="push");
 }catch{return false}
};
const respond=(status:number,data:unknown)=>new Response(JSON.stringify(data),{
 status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const redact=(value:unknown)=>String(value??"").slice(0,500)
 .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[email]")
 .replace(/https?:\/\/\S+/gi,"[url]")
 .replace(/\b(?:\+?\d[\d ().-]{9,}\d)\b/g,"[number]")
 .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,"[identifier]");

Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return respond(405,{error:"post_only"});
 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 const url=Deno.env.get("SUPABASE_URL");
 const ai=Deno.env.get("OPENAI_API_KEY");
 if(!service||!url||!ai)return respond(503,{error:"worker_unconfigured"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const githubAuthorized=await authorizeGithub(req);
 if(!githubAuthorized){
  const token=req.headers.get("x-sandy-qa-scheduler")||"";
  if(token.length<40)return respond(403,{error:"unauthorised"});
  const verified=await db.rpc("sandy_qualitative_authorize",{p_token:token});
  if(verified.error||verified.data!==true)return respond(403,{error:"unauthorised"});
 }
 let params:any={};
 try{params=await req.json()}catch{return respond(400,{error:"invalid_json"})}

 const listPending=async()=>{
  const {data,error}=await db.from("sandy_improvement_proposals")
   .select("id,ideal_behavior,failure_description,proposed_change,evidence")
   .eq("category","self_originated_feature").order("created_at",{ascending:false}).limit(100);
  if(error)throw Error("pending_query_failed");
  return (data||[])
   .filter((x:any)=>!x.evidence?.github_issue_url &&
    typeof x.evidence?.dedup_key==="string" &&
    /^[a-z][a-z0-9_]{5,79}$/.test(x.evidence.dedup_key))
   .slice(0,5).map((x:any)=>({
    key:x.evidence.dedup_key,
    // Customer QA records and identifiers must NEVER be published to a public GitHub issue.
    problem:redact(x.failure_description).slice(0,500),
    ideal:redact(x.ideal_behavior).slice(0,500),
    priority:Math.max(1,Math.min(100,Number(x.proposed_change?.priority_score)||50)),
    risk:["low","medium","high"].includes(x.proposed_change?.risk)?x.proposed_change.risk:"high",
    tests:Array.isArray(x.proposed_change?.acceptance_tests)?
      x.proposed_change.acceptance_tests.slice(0,5).map(redact):[],
  }));
 };
 if(params.op==="acknowledge"){
  const key=String(params.key||""),issue=Number(params.issue_number);
  if(!/^[a-z][a-z0-9_]{5,79}$/.test(key)||!Number.isInteger(issue)||
    issue<1||issue>9999999)return respond(400,{error:"invalid_acknowledgement"});
  const response=await fetch("https://api.github.com/repos/ausstyle/web-staging/issues/"+issue,{
   headers:{"accept":"application/vnd.github+json","user-agent":"sandy-feature-discovery"},
  }).catch(()=>null);
  if(!response||!response.ok)return respond(503,{error:"github_issue_unavailable"});
  const git=await response.json();
  if(git.pull_request||git.repository_url!=="https://api.github.com/repos/ausstyle/web-staging"||
     git.title!=="Sandy feature: "+key.replace(/_/g," ")||
     !String(git.body||"").includes("<!-- sandy-feature-key:"+key+" -->"))
   return respond(409,{error:"issue_evidence_invalid"});
  const {data,error}=await db.from("sandy_improvement_proposals").select("id,evidence")
    .eq("category","self_originated_feature")
    .eq("evidence->>dedup_key",key).limit(1).maybeSingle();
  if(error||!data)return respond(409,{error:"proposal_not_found"});
  const bound="https://github.com/ausstyle/web-staging/issues/"+issue;
  if(data.evidence?.github_issue_url&&data.evidence.github_issue_url!==bound)
   return respond(409,{error:"issue_conflict"});
  const {error:updateError}=await db.from("sandy_improvement_proposals")
   .update({evidence:{...data.evidence,github_issue_url:bound,
    github_issue_number:issue,engineering_handoff_at:new Date().toISOString()}})
   .eq("id",data.id);
  if(updateError)return respond(503,{error:"acknowledgement_storage_failed"});
  return respond(200,{ok:true,issue_number:issue});
 }
 if(params.op!=="discover")return respond(400,{error:"invalid_op"});
 const [{data:cases,error:casesError},{data:proposals,error:proposalsError}]=await Promise.all([
  db.from("sandy_qa_cases").select("test_key,subject,findings,status")
    .in("status",["failed","needs_review","retest_pending"])
    .order("updated_at",{ascending:false}).limit(40),
  db.from("sandy_improvement_proposals").select("category,failure_description,ideal_behavior,evidence")
    .order("created_at",{ascending:false}).limit(50),
 ]);
 if(casesError||proposalsError)return respond(503,{error:"evidence_lookup_failed"});
 const observed=(cases||[]).filter((x:any)=>typeof x.test_key==="string").map((x:any)=>({
  key:x.test_key,status:x.status,subject:redact(x.subject),finding:redact(x.findings).slice(0,280),
 }));
 const backlog=(proposals||[]).map((x:any)=>({
   summary:redact(x.failure_description).slice(0,160),
   ideal:redact(x.ideal_behavior).slice(0,160),
   category:x.category,key:x.evidence?.dedup_key??null,
 }));
 if(!observed.length)return respond(200,{ok:true,status:"no_observed_evidence",created:0,pending:await listPending()});
 const prompt=[
  {role:"system",content:
   "You are Sandy AI's evidence-bound independent product improvement strategist. "+
   "Identify up to TWO genuinely novel, useful customer-facing or engineering productivity FEATURES that Sandy can build. "+
   "Do not propose routine bug fixes, generic AI aspirations, capabilities already in the backlog, security bypasses, or made-up customer demand. "+
   "Every idea must be justified by two or more distinct REAL QA test keys supplied. "+
   "When the evidence is insufficient or the idea duplicates an existing proposal, return an empty ideas array. "+
   "Never interpret unverified as impossible. "+
   "Return ONLY valid JSON: {\"ideas\":[{\"key\":\"unique_snake_case\",\"opportunity\":\"specific evidence-bound user problem (minimum 30 chars)\",\"ideal\":\"measurable feature behavior (minimum 30 chars)\",\"evidence_keys\":[\"existing key\",\"existing key\"],\"priority\":75,\"risk\":\"low\",\"acceptance_tests\":[\"observable test\"]}]}"},
  {role:"user",content:JSON.stringify({recent_qa:observed,existing_backlog:backlog}).slice(0,18500)},
 ];
 const resp=await fetch("https://api.openai.com/v1/responses",{method:"POST",
  headers:{"authorization":"Bearer "+ai,"content-type":"application/json"},
  body:JSON.stringify({model:"gpt-4.1-mini",input:prompt,max_output_tokens:1100})}).catch(()=>null);
 if(!resp||!resp.ok)return respond(503,{error:"feature_assessment_unavailable"});
 const result=await resp.json();
 const raw=(result.output||[]).flatMap((x:any)=>(x.content||[]).filter((v:any)=>v.type==="output_text").map((v:any)=>v.text)).join("");
 let parsed:any;
 try{parsed=JSON.parse(raw)}catch{return respond(502,{error:"invalid_assessment_response"})}
 if(!parsed||!Array.isArray(parsed.ideas))return respond(502,{error:"invalid_assessment_schema"});
 const allowed=new Set(observed.map((x:any)=>x.key));
 const results:any[]=[];
 for(const item of parsed.ideas.slice(0,2)){
  if(!item||typeof item.key!=="string"||! /^[a-z][a-z0-9_]{5,79}$/.test(item.key)||
     typeof item.opportunity!=="string"||item.opportunity.length<30||
     typeof item.ideal!=="string"||item.ideal.length<30||
     !Array.isArray(item.evidence_keys)||
     new Set(item.evidence_keys.filter((x:any)=>typeof x==="string"&&allowed.has(x))).size<2||
     !Array.isArray(item.acceptance_tests)||item.acceptance_tests.length<1||
     !["low","medium","high"].includes(item.risk))continue;
  const refs=[...new Set(item.evidence_keys)].filter(x=>allowed.has(x)).slice(0,8);
  const priority=Math.max(1,Math.min(100,Math.round(Number(item.priority)||50)));
  const {data,error}=await db.rpc("sandy_store_self_discovered_feature",{
   p_key:item.key,p_problem:item.opportunity.slice(0,1200),
   p_ideal:item.ideal.slice(0,1600),
   p_proposed_change:{feature_key:item.key,priority_score:priority,risk:item.risk,
     acceptance_tests:item.acceptance_tests.slice(0,8),type:"feature",phase:"proposed_not_implemented"},
   p_evidence:{source:"sandy_autonomous_feature_discovery",qa_case_keys:refs,
     verified_delivery:false,assessor_model:"gpt-4.1-mini",review_required:true},
  });
  if(error){results.push({key:item.key,status:"rejected"});continue}
  results.push({key:item.key,status:data?.created?"proposed":"already_exists"});
 }
 return respond(200,{ok:true,assessed:observed.length,
  created:results.filter(x=>x.status==="proposed").length,results,pending:await listPending()});
});
