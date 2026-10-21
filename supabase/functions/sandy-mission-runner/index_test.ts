import assert from "node:assert/strict";
import { createMissionPlannerHandler } from "./index.ts";
import { authenticateMissionPlanner, bindMissionPlanningJob } from "../_shared/sandy-agent-operations/worker_mission_planning_identity.ts";
import { executeMissionPlanning, executeMissionClarificationReview } from "../_shared/sandy-agent-operations/worker_mission_planning.ts";
import { missionPlanningSource } from "../_shared/sandy-agent-operations/worker_mission_planning_profiles.ts";
import { isAgentPrincipal, isRuntimeConversationTask } from "../_shared/sandy-agent-operations/identity.ts";
type Obj = Record<string, any>;
const CUSTOMER="a1000000-0000-4000-8000-000000000001",MISSION="a2000000-0000-4000-8000-000000000001",RUN="a3000000-0000-4000-8000-000000000001";
const req=(headers:Obj={"x-email-ai-renewal-key":"fixture-renewal"},body:Obj={})=>new Request("https://internal.invalid/planner",{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(body)});
const plan={summary:"Editable plan pending client review",success_criteria:["An editable draft"],milestones:[{title:"Draft",actor:"sandy",requires_approval:false},{title:"Client approval",actor:"client",requires_approval:true},{title:"Advisor gate",actor:"third_party",requires_approval:false}],questions_for_client:["What new safety approval is required?","What new safety approval is required?","Who has new mandatory approval authority?"],decision_tree:[],plan_changes:["Preserve existing work"]};
const envelope=(value:unknown)=>Response.json({id:"resp_fixture_not_provider_test",status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify(value)}]}]});
class Db{
 runs:Obj[]=[{id:RUN,customer_id:CUSTOMER,mission_task_id:MISSION,stage:"plan",state:"queued"}];audits:Obj[]=[];saved:Obj[]=[];claimLost=false;proposalLost=false;reviewReceiptLost=false;finalFailure=false;finalResponseLost=false;hasAnswers=true;
 from(table:string){assert.equal(table,"sandy_mission_runs");let max=Infinity, patch:Obj|null=null;const filters:((v:Obj)=>boolean)[]=[];const read=(single:boolean)=>{const selected=this.runs.filter(v=>filters.every(f=>f(v))).slice(0,max);if(patch)for(const row of selected)Object.assign(row,patch);return{data:single?selected[0]||null:selected,error:null}};const q:any={select:()=>q,update:(value:Obj)=>{patch=value;return q},eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q},order:()=>q,limit:(v:number)=>{max=v;return q},maybeSingle:()=>Promise.resolve(read(true)),then:(resolve:any)=>Promise.resolve(read(false)).then(resolve)};return q;}
 async rpc(name:string,args:Obj){
  if(name==="sandy_prepare_mission_plan"){
   const run=this.runs.find(r=>r.id===args.p_run_id);
   if(this.audits.some(a=>a.run_id===args.p_run_id))return{data:null,error:{code:"23505"}};
   if(this.audits.some(a=>a.customer_id===args.p_customer_id&&a.mission_task_id===args.p_mission_id&&["started","proposal_received","unknown"].includes(a.state)))return{data:null,error:{code:"P0001",message:"mission_plan_outcome_requires_reconciliation"}};
   if(!run||run.state!=="queued"||run.customer_id!==args.p_customer_id||run.mission_task_id!==args.p_mission_id||args.p_source_sha256!==missionPlanningSource.sourceSha256)return{data:null,error:{code:"P0001"}};
   const questions=this.hasAnswers?[{status:"answered",question:"Confirmed delivery date?",question_key:"date",answer:"30 November"}]:[];
   const id="audit-"+this.audits.length;this.audits.push({id,run_id:run.id,customer_id:run.customer_id,mission_task_id:run.mission_task_id,state:"started",questions});run.state="running";
   return this.claimLost?{data:null,error:{code:"fixture_lost_claim"}}:{data:{id,context:{mission:{title:"Actual project",details:"Actual objective",metadata:{}},steps:[],availableTools:[],documents:[{filename:"project.pdf",mime_type:"application/pdf"}],answered:questions.map(q=>({question:q.question,answer:q.answer}))},previous_questions:questions},error:null};
  }
  const a=this.audits.find(a=>a.id===args.p_audit_id);const run=this.runs.find(r=>r.id===a?.run_id);if(!a||!run)return{data:null,error:{code:"no_claim"}};
  if(name==="sandy_record_mission_plan_proposal"){
   if(a.state!=="started")return{data:null,error:{code:"one_use"}};
   a.plan=JSON.parse(args.p_plan_canonical);a.milestones=JSON.parse(args.p_milestones_canonical);a.candidates=JSON.parse(args.p_candidates_canonical);a.state="proposal_received";a.review_state=this.hasAnswers&&a.candidates.length?"started":"not_needed";a.review_reason="not_needed";
   return this.proposalLost?{data:null,error:{code:"lost_proposal"}}:{data:{ok:true,review_required:a.review_state==="started",review_context:{answered:a.questions,candidates:a.candidates}},error:null};
  }
  if(name==="sandy_record_mission_question_review"){
   assert.equal(a.state,"proposal_received");assert.equal(a.review_state,"started");a.review_state=args.p_reason==="reviewed"?"reviewed":"unavailable";a.review_reason=args.p_reason;a.keep=args.p_keep_indexes;
   return this.reviewReceiptLost?{data:null,error:{code:"lost_review_receipt"}}:{data:{ok:true},error:null};
  }
  assert.equal(name,"sandy_finish_mission_plan");
  if(!["started","proposal_received"].includes(a.state))return{data:null,error:{code:"already_finished"}};
  if(args.p_unknown){a.state="unknown";run.state="failed";return{data:{ok:true},error:null}};
  if(this.finalFailure||a.review_state==="started")return{data:null,error:{code:"changed_context"}};
  a.state="succeeded";run.state="completed";const questions=a.candidates.filter((_:any,i:number)=>a.review_state!=="reviewed"||a.keep.includes(i));this.saved.push({milestones:a.milestones,questions,run_id:run.id});
  return this.finalResponseLost?{data:null,error:{code:"lost_final_response"}}:{data:{ok:true,created_milestones:a.milestones.length,new_questions:questions.length,clarification_review:a.review_reason},error:null};
 }
}
const env=(name:string)=>({EMAIL_AI_RENEWAL_KEY:"fixture-renewal",SUPABASE_SERVICE_ROLE_KEY:"fixture-service",SUPABASE_URL:"https://fixture.invalid",OPENAI_API_KEY:"fixture-model"}as Obj)[name];
async function setup(){const db=new Db(),proof=authenticateMissionPlanner(req(),"fixture-renewal");assert.ok(proof);const job=await bindMissionPlanningJob(proof,db,{runId:RUN,customerId:CUSTOMER,missionId:MISSION});assert.ok(job);return{db,proof,job};}
Deno.test("planner keeps dedicated renewal authentication, three-job queue batch and original legacy result",async()=>{
 const db=new Db();db.hasAnswers=false;for(let i=2;i<=4;i++)db.runs.push({...db.runs[0],id:RUN.slice(0,-1)+i,mission_task_id:MISSION.slice(0,-1)+i});let calls=0;
 const handler=createMissionPlannerHandler({env,db,fetch:(async()=>{calls++;return envelope(plan)})as typeof fetch});
 for(const headers of[{authorization:"Bearer fixture-service"},{authorization:"Bearer customer-session"},{"x-sandy-qa-token":"a".repeat(64)},{"x-email-ai-renewal-key":"wrong"}])assert.equal((await handler(req(headers))).status,401);
 assert.equal(db.audits.length,0);const result=await(await handler(req({},{}))).json();assert.equal(result.error,"unauthorized");
 const response=await handler(req(undefined,{customer_id:"invented",model:"alternate"}));const body=await response.json();assert.equal(body.processed,3);assert.equal(body.outcomes[0].milestones,3);assert.equal(calls,3);assert.equal(db.runs[3].state,"queued");
});
Deno.test("planner proof is unforgeable and cannot authorize customer work or select a model/tool/reviewer",async()=>{
 const{db,proof,job}=await setup();let calls=0;const deps={db,openaiKey:"fixture-model",fetch:(async()=>{calls++;throw Error("unreachable")})as typeof fetch};
 assert.equal(isAgentPrincipal(proof)||isAgentPrincipal(job)||isRuntimeConversationTask(job),false);
 assert.equal(await bindMissionPlanningJob(JSON.parse(JSON.stringify(proof)),db,{runId:RUN,customerId:CUSTOMER,missionId:MISSION}),null);
 assert.equal((await executeMissionPlanning(JSON.parse(JSON.stringify(job)),{},deps)).status,403);
 for(const args of[{model:"alternate"},{customer_id:CUSTOMER},{executor:"arbitrary"}])assert.equal((await executeMissionPlanning(job,args,deps)).status,400);
 await assert.rejects(()=>executeMissionClarificationReview({operation:"agent.missions.questions.review"},{},deps),/recorded_review_capability/);assert.equal(calls,0);
});
Deno.test("fixed legacy planner/reviewer profiles preserve exact requests/timeouts and real stored proposal precedes review",async()=>{
 const{db,job}=await setup();const timeouts:number[]=[];const original=AbortSignal.timeout;AbortSignal.timeout=ms=>{timeouts.push(ms);return new AbortController().signal};let calls=0;
 try{const result=await executeMissionPlanning(job,{}, {db,openaiKey:"fixture-model",fetch:(async(url,init)=>{
  calls++;assert.equal(String(url),"https://api.openai.com/v1/responses");assert.equal(init?.redirect,undefined);assert.equal(new Headers(init?.headers).get("authorization"),"Bearer fixture-model");const body=JSON.parse(String(init?.body));assert.equal(body.model,"gpt-4.1-mini");
  if(calls===1){assert.equal(db.audits[0].state,"started");assert.equal(body.max_output_tokens,1600);assert.equal(Object.hasOwn(body,"store"),false);const input=JSON.parse(body.input);assert.equal(input.client_answers[0].answer,"30 November");assert.equal(input.uploaded_documents[0].content_inspected,false);return envelope(plan)}
  assert.equal(db.audits[0].state,"proposal_received");assert.equal(db.audits[0].review_state,"started");assert.equal(body.store,false);assert.equal(body.max_output_tokens,900);assert.equal(JSON.parse(body.input).candidates.length,2);return envelope({keep_indexes:[1,1]});
 })as typeof fetch});assert.equal(result.status,200);assert.deepEqual(timeouts,[75000,18000]);assert.equal(result.body.auth_user_id,null);assert.equal(result.body.execution_verified,false);assert.equal(result.body.requires_client_plan_review,true);assert.equal(result.body.new_questions,1);assert.equal(db.saved[0].milestones[1].metadata.assigned_to,"client");assert.equal(db.saved[0].milestones[2].metadata.approval_required,true);assert.equal(db.saved[0].questions[0].question_key,"who has new mandatory approval authority?");}finally{AbortSignal.timeout=original}
});
Deno.test("unavailable optional reviewer retains questions, records uncertainty and never retries its paid request",async()=>{
 for(const review of[async()=>{throw Error("lost response")},async()=>Response.json({error:"private diagnostic"},{status:503}),async()=>envelope({keep_indexes:[8]}),async()=>Response.json({id:"resp_partial",status:"incomplete",output:[]})]){
  const{db,job}=await setup();let calls=0;const deps={db,openaiKey:"fixture-model",fetch:(async()=>{calls++;return calls===1?envelope(plan):await review()})as typeof fetch};const result=await executeMissionPlanning(job,{},deps);assert.equal(result.status,200);assert.equal(result.body.new_questions,2);assert.equal(db.audits[0].review_state,"unavailable");assert.equal((await executeMissionPlanning(job,{},deps)).status,503);assert.equal(calls,2);
 }
});
Deno.test("no previous answers skips the reviewer without inventing a successful review",async()=>{const{db,job}=await setup();db.hasAnswers=false;let calls=0;const result=await executeMissionPlanning(job,{}, {db,openaiKey:"fixture-model",fetch:(async()=>{calls++;return envelope(plan)})as typeof fetch});assert.equal(result.status,200);assert.equal(calls,1);assert.equal(result.body.clarification_review,"not_needed");assert.equal(result.body.new_questions,2)});
Deno.test("unknown primary response or invalid plan prevents same-run and cross-run redispatch",async()=>{
 for(const outcome of[async()=>{throw Error("provider result lost")},async()=>envelope({milestones:[]}),async()=>Response.json({id:"partial",status:"failed",output:[]})]){const{db,proof,job}=await setup();let calls=0;const deps={db,openaiKey:"fixture-model",fetch:(async()=>{calls++;return await outcome()})as typeof fetch};assert.equal((await executeMissionPlanning(job,{},deps)).status,502);assert.equal(db.audits[0].state,"unknown");assert.equal((await executeMissionPlanning(job,{},deps)).status,503);const nextId=RUN.slice(0,-1)+9;db.runs.push({...db.runs[0],id:nextId,state:"queued"});const next=await bindMissionPlanningJob(proof,db,{runId:nextId,customerId:CUSTOMER,missionId:MISSION});assert.ok(next);assert.equal((await executeMissionPlanning(next,{},deps)).status,409);assert.equal(calls,1);assert.equal(db.saved.length,0)}
});
Deno.test("lost admission/proposal/reviewer/final receipts never repeat paid work or duplicate plan records",async()=>{
 for(const mode of["claimLost","proposalLost","reviewReceiptLost","finalFailure","finalResponseLost"]as const){const{db,job}=await setup();db[mode]=true;let calls=0;const deps={db,openaiKey:"fixture-model",fetch:(async()=>{calls++;return calls===1?envelope(plan):envelope({keep_indexes:[0]})})as typeof fetch};const result=await executeMissionPlanning(job,{},deps);assert.equal(result.status,mode==="claimLost"?503:502);const before=calls;assert.equal((await executeMissionPlanning(job,{},deps)).status,503);assert.equal(calls,before);assert.equal(db.saved.length,mode==="finalResponseLost"?1:0)}
});
Deno.test("concurrent same-run planner calls consume one primary and one optional reviewer",async()=>{const{db,job}=await setup();let calls=0;const deps={db,openaiKey:"fixture-model",fetch:(async()=>{calls++;await Promise.resolve();return calls===1?envelope(plan):envelope({keep_indexes:[]})})as typeof fetch};const results=await Promise.all([executeMissionPlanning(job,{},deps),executeMissionPlanning(job,{},deps)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,503]);assert.equal(calls,2);assert.equal(db.saved.length,1);assert.equal(results.find(r=>r.status===200)?.body.outcome,"awaiting_client_plan_review")});
