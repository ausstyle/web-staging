import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
const url=Deno.env.get("SUPABASE_URL")||"";
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ai=Deno.env.get("OPENAI_API_KEY")||"";
const db=createClient(url,key,{auth:{persistSession:false}});
const reply=(code:number,x:any)=>new Response(JSON.stringify(x),{status:code,headers:{"content-type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method!=="POST")return reply(405,{error:"post_only"});
 const auth=req.headers.get("authorization")==="Bearer "+key;
 const token=req.headers.get("x-sandy-qa-scheduler")||"";
 const allowed=!auth&&token.length>=40&&(await db.rpc("sandy_qualitative_authorize",{p_token:token})).data===true;
 if(!key||!ai||(!auth&&!allowed))return reply(403,{error:"unauthorized"});
 let body:any={};try{body=await req.json()}catch{return reply(400,{error:"invalid_json"})}
 if(body.op!=="investigate")return reply(400,{error:"invalid_op"});
 let query=db.from("sandy_qa_engineering_handoffs").select("issue_key,status,evidence,root_cause,recommended_fix,regression_plan,target_function").in("status",["investigation_ready","verification_pending"]).limit(5);
 if(typeof body.issue_key==="string")query=query.eq("issue_key",body.issue_key.slice(0,160));
 const {data:items,error:listError}=await query;
 if(listError)return reply(500,{error:"handoff_query",code:listError.code});
 const results:any[]=[];
 for(const item of (items||[]).slice(0,2)){
  const {data:existing}=await db.from("sandy_qa_investigation_runs").select("id").eq("issue_key",item.issue_key).eq("status","completed").limit(1);
  if(existing?.length&&!body.recheck){results.push({issue_key:item.issue_key,status:"already_investigated"});continue}
  const {data:run,error:startError}=await db.from("sandy_qa_investigation_runs").insert({issue_key:item.issue_key}).select("id").single();
  if(startError){results.push({issue_key:item.issue_key,status:"locked_or_error",code:startError.code});continue}
  try{
   const {data:proof}=await db.from("sandy_evidence_checks").select("source_channel,source_id,claim_type,verdict,task_id,checked_at,evidence").eq("verdict","contradicted").eq("claim_type",item.evidence?.confirmed_claim_type||"").order("checked_at",{ascending:false}).limit(8);
   const input={issue:item.issue_key,existing_handoff:item,evidence:(proof||[]).map((x:any)=>({source_channel:x.source_channel,source_id:x.source_id,verdict:x.verdict,task_id:x.task_id,checked_at:x.checked_at,evidence:x.evidence})),limitations:"You have no repository code, execution traces, provider receipts, customer profile or credentials. Never claim code inspected or tests performed."};
   const resp=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"authorization":"Bearer "+ai,"content-type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",input:[{role:"system",content:"Return JSON only with keys evidence_summary,root_cause_hypothesis,missing_evidence,proposed_code_change,regression_tests,risk,requires_approval. Distinguish observed proof from unverified cause. Do not invent code snippets, deployment or verification."},{role:"user",content:"Provide an investigation in JSON using only this evidence: "+JSON.stringify(input).slice(0,13000)}],text:{format:{type:"json_object"}},max_output_tokens:1500}),signal:AbortSignal.timeout(50000)});
   if(!resp.ok)throw Error("ai_http_"+resp.status);
   const output=await resp.json();
   const textOut=(output.output||[]).flatMap((x:any)=>(x.content||[]).filter((y:any)=>y.type==="output_text").map((y:any)=>y.text)).join("");
   const result=JSON.parse(textOut);
   const {error:saveError}=await db.from("sandy_qa_investigation_runs").update({status:"completed",result,finished_at:new Date().toISOString(),evidence:{checked_records:proof?.length||0}}).eq("id",run.id);
   if(saveError)throw Error("save_"+saveError.code);
   const {error:handoffError}=await db.from("sandy_qa_engineering_handoffs").update({root_cause:String(result.root_cause_hypothesis||"").slice(0,3000),recommended_fix:String(result.proposed_code_change||"").slice(0,3000),regression_plan:Array.isArray(result.regression_tests)?result.regression_tests.slice(0,10):item.regression_plan,status:item.status==="investigation_ready"?"fix_proposed":item.status,evidence:{...item.evidence,investigation_run_id:run.id,investigation_status:"completed",missing_evidence:result.missing_evidence}}).eq("issue_key",item.issue_key);
   if(handoffError)throw Error("handoff_"+handoffError.code);
   results.push({issue_key:item.issue_key,status:"investigated",run_id:run.id});
  }catch(e){const message=String(e instanceof Error?e.message:e).slice(0,250);await db.from("sandy_qa_investigation_runs").update({status:"error",error:message,finished_at:new Date().toISOString()}).eq("id",run.id);results.push({issue_key:item.issue_key,status:"error",error:message})}
 }
 return reply(200,{ok:true,results});
});