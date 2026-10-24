import assert from 'node:assert/strict';
import {extractTaskConfiguration} from '../../supabase/functions/_shared/sandy-agent-operations/task_analysis_model.ts';
import {literalTaskTitle,taskAnalysisRequest,taskAnalysisValue} from '../../supabase/functions/_shared/sandy-agent-operations/task_analysis_profile.ts';
const job={taskId:'10000000-0000-4000-8000-000000000001',customerId:'20000000-0000-4000-8000-000000000001',title:'Call Alice tomorrow'};
const broker={base:'https://zmqlyygzqoidkcwdysok.supabase.co',serviceCredential:'isolated-test-only'};
const configuration=taskAnalysisValue({contact_name:'Alice',date_text:'tomorrow'},job.title)!;
function dbFor(state='started'){
 const calls:any[]=[];return {calls,rpc:(name:string,args:any)=>{calls.push({name,args});return Promise.resolve({data:name==='sandy_task_model_admit'?{ok:true,state,audit_id:'fixture',reused:state!=='started',result:configuration}:{ok:true},error:null});},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})};
}
Deno.test('literal task preserves zero admission and zero model path',async()=>{
 const db=dbFor();let calls=0;
 assert.equal(literalTaskTitle('“Exact literal”'),true);
 assert.equal(await extractTaskConfiguration(db,{...job,title:'"Exact literal"'},broker,async()=>{calls++;throw Error('must not fetch');}),null);
 assert.equal(calls,0);assert.equal(db.calls.length,0);
});
Deno.test('fixed existing Gateway receives bounded typed contract, actual usage is preserved without invented price',async()=>{
 const db=dbFor();let count=0;
 const result=await extractTaskConfiguration(db,job,broker,async(url,init)=>{
  count++;assert.equal(url,broker.base+'/functions/v1/sandy-openai-gateway-v4');
  const body=JSON.parse(String(init?.body));assert.deepEqual(body,taskAnalysisRequest(job.title));assert.equal(body.max_output_tokens,512);assert.equal(body.store,false);assert.equal("tools" in body,false);
  return new Response(JSON.stringify({id:'resp_fixture',status:'completed',model:'gpt-unknown-exact-alias',output:[{type:'message',status:'completed',content:[{type:'output_text',text:JSON.stringify(configuration)}]}],usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:0}}}),{status:200});
 });
 assert.deepEqual(result,configuration);assert.equal(count,1);
 const final=db.calls.at(-1);assert.equal(final.name,'sandy_task_model_finish');assert.equal(final.args.p_state,'succeeded');assert.equal(final.args.p_provider_response_id,'resp_fixture');assert.match(final.args.p_response_sha256,/^[a-f0-9]{64}$/);
 assert.equal(final.args.p_metrics.usage.total_tokens,120);assert.equal(final.args.p_metrics.estimated_cost_usd,null);assert.equal(final.args.p_metrics.provider_effect_verified,false);
});
Deno.test('lost provider or receipt never returns success and reserves unknown without retry',async()=>{
 const db=dbFor();let count=0;
 await assert.rejects(()=>extractTaskConfiguration(db,job,broker,async()=>{count++;throw Error('private raw network error');}),/outcome_requires_reconciliation/);
 assert.equal(count,1);assert.equal(db.calls.at(-1).args.p_state,'unknown');
 const prior=dbFor('unknown');await assert.rejects(()=>extractTaskConfiguration(prior,job,broker,async()=>{count++;throw Error('must not fetch');}),/outcome_requires_reconciliation/);assert.equal(count,1);
});
Deno.test('incomplete/malformed envelopes and unsafe extraction never become configuration success',async()=>{
 assert.equal(taskAnalysisValue({contact_name:'Invented Person'},job.title),null);
 assert.equal(taskAnalysisValue({hour:24},job.title),null);
 for(const envelope of [{id:'resp_fixture',status:'incomplete',output:[]},{id:'resp_fixture',status:'completed',output:[],error:{message:'private provider error'}}]){
  const db=dbFor();await assert.rejects(()=>extractTaskConfiguration(db,job,broker,async()=>new Response(JSON.stringify(envelope))),/outcome_requires_reconciliation/);assert.equal(db.calls.at(-1).args.p_state,'unknown');
 }
});
Deno.test('previous succeeded typed result reuses receipt without another provider request',async()=>{
 const db=dbFor('succeeded');assert.deepEqual(await extractTaskConfiguration(db,job,broker,async()=>{throw Error('must not fetch');}),configuration);assert.equal(db.calls.length,1);
});
