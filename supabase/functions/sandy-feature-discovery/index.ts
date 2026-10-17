import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";

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
 const token=req.headers.get("x-sandy-qa-scheduler")||"";
 if(token.length<40)return respond(403,{error:"unauthorised"});
 const verified=await db.rpc("sandy_qualitative_authorize",{p_token:token});
 if(verified.error||verified.data!==true)return respond(403,{error:"unauthorised"});
 let params:any={};
 try{params=await req.json()}catch{return respond(400,{error:"invalid_json"})}
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
 if(!observed.length)return respond(200,{ok:true,status:"no_observed_evidence",created:0});
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
  created:results.filter(x=>x.status==="proposed").length,results});
});
