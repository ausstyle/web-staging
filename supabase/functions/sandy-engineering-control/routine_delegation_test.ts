import assert from "node:assert/strict";
import { delegationConfig, routineCandidate, verifyRoutineReview, handleStandingDelegation, workflowJob, workflowPath } from "./routine_delegation.ts";
const OWNER="10000000-0000-4000-8000-000000000001", source="a".repeat(40), baseline="b".repeat(40), now=Date.parse("2026-10-22T00:00:00Z");
const hash=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,"0")).join("");
async function fixture() {
 const workflow="trusted readonly CI fixture", config={targets:["sandy-agent-runtime-v4"],reviewers:["reviewer"],baseline_commit:baseline,workflow_sha256:await hash(workflow),expires_at:new Date(now+86400000).toISOString()};
 const m={source_commit:source,function:"sandy-agent-runtime-v4",expected_prior_version:29,prior_bundle_sha256:"c".repeat(64),rollback:"Restore captured source under a fresh exact version guard.",files:{"sandy-agent-runtime-v4/index.ts":"d".repeat(64)}};
 const raw=JSON.stringify(m), pin=await hash(raw), change={status:"proposed",risk:"normal",scope:["sandy-agent-runtime-v4","github:ausstyle/web-staging:engineering/sandy-unified-intelligence-20261021"],expected_behavior:`Release ${source}; manifest ${pin}`};
 const tests=[{outcome:"passed",checked_at:"2026-10-21T23:00:00Z",evidence:{source_commit:source,manifest_sha256:pin,release_manifest:m,release_manifest_path:"docs/sandy-engineering/evaluations/fixture-source-manifest.json"}}];
 const policy={enabled:true,standing_authorized_by:OWNER,standing_expires_at:config.expires_at,standing_revoked_at:null,standing_config:config};
 const candidate=await routineCandidate(change,tests,policy,OWNER,now);
 const values:any={prs:[{number:158,state:"open",head:{sha:source,repo:{full_name:"ausstyle/web-staging"}},user:{login:"author"}}],reviews:[{id:1,state:"APPROVED",commit_id:source,user:{login:"reviewer"}}],checks:{total_count:1,check_runs:[{id:10,name:workflowJob,head_sha:source,app:{slug:"github-actions"},status:"completed",conclusion:"success",check_suite:{id:100}}]},runs:{total_count:1,workflow_runs:[{head_sha:source,check_suite_id:100,path:workflowPath,event:"pull_request",status:"completed",conclusion:"success"}]},workflow:{encoding:"base64",content:btoa(workflow)},manifest:{encoding:"base64",content:btoa(raw)},diff:{status:"ahead",files:[{filename:"supabase/functions/sandy-agent-runtime-v4/index.ts"}]}};
 const read=async(path:string)=>path.includes("/pulls?")?values.prs:path.includes("/reviews?")?values.reviews:path.includes("/check-runs?")?values.checks:path.includes("/actions/runs?")?values.runs:path.includes(workflowPath)?values.workflow:path.includes("/contents/")?values.manifest:values.diff;
 return {config,change,tests,policy,candidate,values,read};
}
Deno.test("eligible routine source requires actual review, trusted CI and exact committed manifest",async()=>{const f=await fixture();const p=await verifyRoutineReview(f.candidate,f.read);assert.equal(p.source_commit,source);assert.equal(p.manifest_sha256,f.candidate.manifest);assert.deepEqual(p.review_ids,[1]);});
Deno.test("non-executable release evidence can accompany later routine releases",async()=>{const f=await fixture();f.values.diff.files.push({filename:"docs/sandy-engineering/evaluations/next-source-manifest.json"});assert.equal((await verifyRoutineReview(f.candidate,f.read)).source_commit,source);f.values.diff.files[1].filename="docs/sandy-engineering/evaluations/owner-action.js";await assert.rejects(verifyRoutineReview(f.candidate,f.read));});
for(const risk of ["high","critical","unknown"])Deno.test(`${risk} cannot use standing routine approval`,async()=>{const f=await fixture();f.change.risk=risk;await assert.rejects(routineCandidate(f.change,f.tests,f.policy,OWNER,now));});
for(const patch of [{enabled:false},{standing_revoked_at:"2026-10-21T00:00:00Z"},{standing_expires_at:"2026-10-21T00:00:00Z"},{standing_expires_at:"invalid"},{standing_authorized_by:"different-owner"}])Deno.test(`inactive policy fails: ${JSON.stringify(patch)}`,async()=>{const f=await fixture();await assert.rejects(routineCandidate(f.change,f.tests,{...f.policy,...patch},OWNER,now));});
Deno.test("scope expansion, absent evidence and failed tests cannot be delegated",async()=>{const f=await fixture();for(const scope of [[...f.change.scope,"sandy-engineering-control"],["sandy-engineering-control",f.change.scope[1]],["sandy-agent-runtime-v4","github:other/repo:branch"]])await assert.rejects(routineCandidate({...f.change,scope},f.tests,f.policy,OWNER,now));await assert.rejects(routineCandidate(f.change,[],f.policy,OWNER,now));await assert.rejects(routineCandidate(f.change,[{...f.tests[0],outcome:"failed"}],f.policy,OWNER,now));});
Deno.test("invalid policy cannot add wildcards, protected targets or indefinite authority",async()=>{const f=await fixture();for(const patch of [{targets:["*"]},{targets:["sandy-engineering-control"]},{reviewers:[]},{baseline_commit:"main"},{workflow_sha256:"unknown"},{expires_at:new Date(now+31*86400000).toISOString()}])assert.throws(()=>delegationConfig({...f.config,...patch},now));});
for(const [name,modify] of [
 ["no independent review",(v:any)=>{v.reviews=[]}],
 ["author self-review",(v:any)=>{v.prs[0].user.login="reviewer"}],
 ["review on old source",(v:any)=>{v.reviews[0].commit_id=baseline}],
 ["dismissed review",(v:any)=>{v.reviews.push({...v.reviews[0],id:2,state:"DISMISSED"})}],
 ["changes requested",(v:any)=>{v.reviews.push({...v.reviews[0],id:2,state:"CHANGES_REQUESTED"})}],
 ["failed CI",(v:any)=>{v.checks.check_runs[0].conclusion="failure"}],
 ["spoofed check application",(v:any)=>{v.checks.check_runs[0].app.slug="another-app"}],
 ["spoofed workflow job",(v:any)=>{v.runs.workflow_runs[0].path="another-workflow.yml"}],
 ["replaced trusted workflow",(v:any)=>{v.workflow.content=btoa("untrusted CI")}],
 ["replaced manifest",(v:any)=>{v.manifest.content=btoa("{}")}],
 ["protected source change",(v:any)=>{v.diff.files[0].filename="supabase/functions/sandy-engineering-control/index.ts"}],
 ["renamed protected source",(v:any)=>{v.diff.files[0].previous_filename="supabase/functions/_shared/identity.ts"}],
 ["truncated compare",(v:any)=>{v.diff.files=Array(300).fill(v.diff.files[0])}],
] as const)Deno.test(`${name} cannot authorize a routine release`,async()=>{const f=await fixture();modify(f.values);await assert.rejects(verifyRoutineReview(f.candidate,f.read));});
Deno.test("workload cannot invoke owner policy actions even if caller serializes an owner role",async()=>{let calls=0;for(const action of ["delegation_policy","set_delegation_policy","auto_approve"])await assert.rejects(handleStandingDelegation({rpc:()=>{calls++}},{id:OWNER,app_metadata:{sandy_engineering_test:true}},{role:"owner"},{action},""));assert.equal(calls,0);});
