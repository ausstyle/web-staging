// Real isolated SQL persistence with a deliberately lost commit acknowledgement.
// RPC/provider transports are fixtures; this does not certify production SQL RPCs.
import assert from 'node:assert/strict';
import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
import {authenticateMissionExecutor,bindMissionWorkProductJob,missionExecutorSource} from '../_shared/sandy-agent-operations/worker_mission_identity.ts';
import {executeMissionWorkProduct} from '../_shared/sandy-agent-operations/worker_mission.ts';
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function fixture(mode:string){
 const pg=new PGlite(),run=crypto.randomUUID(),customer=crypto.randomUUID(),mission=crypto.randomUUID(),audit=crypto.randomUUID();let modelCalls=0,finishes=0,unknownAttempts=0;
 await pg.exec(`CREATE TABLE sandy_mission_runs(id text,customer_id text,mission_task_id text,stage text,state text);
 CREATE TABLE sandy_mission_work_product_audit(id text,run_id text,customer_id text,mission_task_id text,source_sha256 text,state text,waiting_reason text,provider_response_id text,response_sha256 text,draft_sha256 text,work_product_id text,review_task_id text,finished_at text);
 CREATE TABLE fixture_products(id text PRIMARY KEY,run_id text UNIQUE,content text);
 CREATE TABLE fixture_reviews(id text PRIMARY KEY,product_id text UNIQUE);`);
 await pg.query("INSERT INTO sandy_mission_runs VALUES($1,$2,$3,'execute','queued')",[run,customer,mission]);
 const db={from(table:string){
  assert.ok(['sandy_mission_runs','sandy_mission_work_product_audit'].includes(table));const filters:string[]=[],values:unknown[]=[];
  const q:any={select:()=>q,eq(k:string,v:unknown){assert.match(k,/^[a-z_]+$/);values.push(v);filters.push(k+'=$'+values.length);return q;},async maybeSingle(){
   if(mode==='read_throw'&&table==='sandy_mission_work_product_audit')throw Error('isolated read transport lost');
   if(mode==='read_error'&&table==='sandy_mission_work_product_audit')return {data:null,error:{code:'isolated_unavailable'}};
   return {data:(await pg.query(`SELECT * FROM ${table} WHERE ${filters.join(' AND ')}`,values)).rows[0]??null,error:null};
  }};return q;
 },async rpc(name:string,args:any){
  if(name==='sandy_prepare_mission_work_product'){
   if((await pg.query('SELECT id FROM sandy_mission_work_product_audit WHERE run_id=$1',[run])).rows.length)return {data:null,error:{code:'23505'}};
   await pg.query("INSERT INTO sandy_mission_work_product_audit(id,run_id,customer_id,mission_task_id,source_sha256,state,waiting_reason) VALUES($1,$2,$3,$4,$5,'started',$6)",[audit,run,customer,mission,missionExecutorSource.sourceSha256,mode==='waiting'?'no_eligible_internal_step':null]);
   await pg.query("UPDATE sandy_mission_runs SET state='running' WHERE id=$1",[run]);
   return {data:{id:audit,waiting_reason:mode==='waiting'?'no_eligible_internal_step':null,context:{project:'Synthetic',milestone:'Internal draft'}},error:null};
  }
  assert.equal(name,'sandy_finish_mission_work_product');
  if(args.p_state==='unknown'){unknownAttempts++;if(mode==='read_throw')throw Error('isolated unknown marking transport lost');return {data:null,error:{code:'fixture_terminal_receipt_preserved'}};}
  finishes++;const product=crypto.randomUUID(),review=crypto.randomUUID();
  await pg.exec('BEGIN');
  if(mode!=='waiting'){
   await pg.query('INSERT INTO fixture_products VALUES($1,$2,$3)',[product,run,args.p_draft_canonical]);
   await pg.query('INSERT INTO fixture_reviews VALUES($1,$2)',[review,product]);
  }
  await pg.query("UPDATE sandy_mission_work_product_audit SET state=$2,provider_response_id=$3,response_sha256=$4,draft_sha256=$5,work_product_id=$6,review_task_id=$7,finished_at=$8 WHERE id=$1",[audit,mode==='waiting'?'waiting':'succeeded',args.p_provider_response_id,args.p_response_sha256,args.p_draft_canonical?await sha(args.p_draft_canonical):null,mode==='waiting'?null:product,mode==='waiting'?null:review,new Date().toISOString()]);
  await pg.query("UPDATE sandy_mission_runs SET state='completed' WHERE id=$1",[run]);
  if(mode==='rollback')await pg.exec('ROLLBACK');else await pg.exec('COMMIT');
  // Corrupt fixtures model untrusted/mismatched readback; not production writes.
  const mutations:Record<string,string>={foreign:"customer_id='foreign'",wrong_source:"source_sha256='different'",wrong_provider:"provider_response_id='other'",wrong_digest:"draft_sha256='different'",unknown:"state='unknown'",missing_review:"review_task_id=NULL"};
  if(mutations[mode])await pg.exec('UPDATE sandy_mission_work_product_audit SET '+mutations[mode]);
  if(mode==='throw')throw Error('isolated lost final acknowledgement');
  return {data:null,error:{code:'isolated lost final acknowledgement'}};
 }};
 const proof=authenticateMissionExecutor(new Request('https://fixture.invalid',{headers:{'x-email-ai-renewal-key':'fixture'}}),'fixture');assert.ok(proof);
 const job=await bindMissionWorkProductJob(proof,db,{runId:run,customerId:customer,missionId:mission});assert.ok(job);
 const deps={db,openaiKey:'fixture',fetch:(async()=>{modelCalls++;return Response.json({id:'resp_fixture',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({title:'Internal draft',content:'Draft pending review; no external action. '.repeat(8),content_type:'checklist'})}]}]});}) as typeof fetch};
 return {pg,job,deps,counts:()=>({modelCalls,finishes,unknownAttempts})};
}
Deno.test('committed SQL receipt recovers lost or thrown ACK once, including no-model wait',async()=>{
 for(const mode of ['lost','throw','waiting']){const f=await fixture(mode);try{
  const result=await executeMissionWorkProduct(f.job,{},f.deps);assert.equal(result.status,200);assert.equal(result.body.outcome,mode==='waiting'?'waiting':'draft_pending_review');assert.equal(result.body.execution_verified,false);
  assert.equal((await executeMissionWorkProduct(f.job,{},f.deps)).status,409);
  assert.deepEqual(f.counts(),{modelCalls:mode==='waiting'?0:1,finishes:1,unknownAttempts:0});
  assert.equal((await f.pg.query<{n:number}>('SELECT count(*)::int n FROM fixture_products')).rows[0].n,mode==='waiting'?0:1);
  assert.equal((await f.pg.query<{n:number}>('SELECT count(*)::int n FROM fixture_reviews')).rows[0].n,mode==='waiting'?0:1);
 }finally{await f.pg.close();}}
});
Deno.test('rollback, unavailable, foreign or mismatched receipts remain uncertain without redispatch',async()=>{
 for(const mode of ['rollback','read_error','read_throw','foreign','wrong_source','wrong_provider','wrong_digest','unknown','missing_review']){const f=await fixture(mode);try{
  const result=await executeMissionWorkProduct(f.job,{},f.deps);assert.equal(result.status,502,mode);assert.equal(result.body.reconciliation_required,true,mode);
  assert.equal((await executeMissionWorkProduct(f.job,{},f.deps)).status,409);assert.deepEqual(f.counts(),{modelCalls:1,finishes:1,unknownAttempts:1});
 }finally{await f.pg.close();}}
});
