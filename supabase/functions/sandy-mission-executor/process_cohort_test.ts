// Disposable PostgreSQL + actual killed client processes. No model/provider calls.
// Canonical receipt RPCs are loaded unchanged; surrounding domain tables are fixtures.
import assert from 'node:assert/strict';
import pg from 'npm:pg@8.16.3';
const DSN='postgres://mission_fixture:isolated-ci-only@127.0.0.1:55432/mission_ci';
const source='6f6b7ce3d1bca03d9637c46a3535c4f288efef4c3a5532cc8a6ef5a6de3b0dc4';
const connect=async()=>{const c=new pg.Client({connectionString:DSN,application_name:'isolated-mission-process-cohort',statement_timeout:8000});c.on('error',()=>{});await c.connect();return c;};
const prepare=async(c:any,f:any)=>(await c.query('SELECT public.sandy_prepare_mission_work_product($1,$2,$3,$4) receipt',[f.run,f.customer,f.mission,source])).rows[0].receipt;
const draft=JSON.stringify({title:'Synthetic internal draft',content:'Fixture draft pending review; no external action. '.repeat(8),content_type:'checklist'});
const finish=async(c:any,id:string,waiting=false)=>(await c.query('SELECT public.sandy_finish_mission_work_product($1,$2,$3,$4,$5,NULL) result',[id,waiting?'waiting':'succeeded',waiting?null:'resp_isolated_fixture',waiting?null:'a'.repeat(64),waiting?null:draft])).rows[0].result;
if(Deno.args[0]==='worker'){
 const f=JSON.parse(Deno.args[1]);const mode=Deno.args[2];const c=await connect();await c.query('BEGIN');const claim=await prepare(c,f);
 if(mode!=='before_claim_commit')await c.query('COMMIT');
 if(mode==='during_finish'||mode==='after_finish_commit'){
  await c.query('BEGIN');await finish(c,claim.id);if(mode==='after_finish_commit')await c.query('COMMIT');
 }
 await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({ready:true,receipt:claim.id})+'\n'));
 await Deno.stdin.read(new Uint8Array(1));await c.end();
}else{
 let root:any;
 async function init(){
  root=await connect();assert.equal((await root.query('SELECT current_database() db')).rows[0].db,'mission_ci');
  assert.equal((await root.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,0,'refuse nonempty database');
  await root.query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
   CREATE TABLE email_customers(id uuid PRIMARY KEY);
   CREATE TABLE sandy_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES email_customers(id),parent_task_id uuid REFERENCES sandy_tasks(id),title text,details text,status text,priority text,metadata jsonb DEFAULT '{}',company_id uuid,archived_at timestamptz,created_at timestamptz DEFAULT now(),UNIQUE(id,customer_id));
   CREATE TABLE sandy_mission_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES email_customers(id),mission_task_id uuid REFERENCES sandy_tasks(id),stage text,state text,error text,result jsonb,updated_at timestamptz DEFAULT now());
   CREATE TABLE sandy_mission_work_products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),mission_task_id uuid REFERENCES sandy_tasks(id),milestone_task_id uuid REFERENCES sandy_tasks(id),customer_id uuid REFERENCES email_customers(id),run_id uuid REFERENCES sandy_mission_runs(id),title text,content text,content_type text,state text,sources jsonb,created_at timestamptz DEFAULT now());
   CREATE TABLE sandy_task_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,task_id uuid,event_type text,actor text,snapshot jsonb);`);
  const sql=await Deno.readTextFile(new URL('../../migrations/20261021010060_sandy_mission_work_product.sql',import.meta.url));
  const marker="DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry";
  assert.equal(sql.split(marker).length,2);await root.query(sql.split(marker)[0]+'COMMIT;');
  await root.query(await Deno.readTextFile(new URL('../../migrations/20261018004600_sandy_mission_single_active_stage_guard.sql',import.meta.url)));
 }
 async function fixture(blocked=false){
  const f={customer:crypto.randomUUID(),mission:crypto.randomUUID(),run:crypto.randomUUID(),plan:crypto.randomUUID(),step:crypto.randomUUID(),dependency:crypto.randomUUID()};
  await root.query('INSERT INTO email_customers VALUES($1)',[f.customer]);
  await root.query("INSERT INTO sandy_tasks(id,customer_id,title,details,status,metadata) VALUES($1,$2,'Synthetic mission','No external action','waiting',$3)",[f.mission,f.customer,{sandy_mission:true,execution_state:'plan_approved_external_actions_still_gated'}]);
  await root.query("INSERT INTO sandy_mission_runs(id,customer_id,mission_task_id,stage,state) VALUES($1,$2,$3,'plan','completed'),($4,$2,$3,'execute','queued')",[f.plan,f.customer,f.mission,f.run]);
  await root.query("INSERT INTO sandy_tasks(id,customer_id,parent_task_id,title,status,metadata,created_at) VALUES($1,$2,$3,'Prerequisite',$4,$5,now()-interval '1 second'),($6,$2,$3,'Draft','todo',$7,now())",[f.dependency,f.customer,f.mission,blocked?'todo':'completed',{mission_run_id:f.plan,plan_index:1,assigned_to:'client',stage:'planned',approval_required:true},f.step,{mission_run_id:f.plan,plan_index:2,assigned_to:'sandy',stage:'planned',approval_required:false,depends_on:[1]}]);return f;
 }
 async function counts(f:any){return (await root.query("SELECT (SELECT count(*)::int FROM sandy_mission_work_products WHERE mission_task_id=$1) products,(SELECT count(*)::int FROM sandy_tasks WHERE parent_task_id=$1 AND metadata->>'stage'='deliverable_review') reviews",[f.mission])).rows[0];}
 async function killWorker(f:any,mode:string){
  const child=new Deno.Command(Deno.execPath(),{args:['run','--no-lock','--cached-only','--allow-net=127.0.0.1:55432','--allow-env',new URL(import.meta.url).pathname,'worker',JSON.stringify(f),mode],stdin:'piped',stdout:'piped',stderr:'inherit'}).spawn();
  const reader=child.stdout.getReader();let line='';let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.race([(async()=>{while(!line.includes('\n')){const part=await reader.read();if(part.done)throw Error('worker exited before checkpoint');line+=new TextDecoder().decode(part.value);}assert.equal(JSON.parse(line).ready,true);})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('worker checkpoint timeout')),10000);})]);
   child.kill('SIGKILL');assert.equal((await child.status).success,false);
  }finally{clearTimeout(timer);try{child.kill('SIGKILL');}catch{/* Already terminated own child. */}await child.status;await reader.cancel().catch(()=>{});reader.releaseLock();await child.stdin.close().catch(()=>{});}

 }
 async function blocked(pid:number){for(let n=0;n<100;n++){if((await root.query('SELECT cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n>0)return;await new Promise(r=>setTimeout(r,20));}throw Error('expected lock wait not observed');}
 Deno.test('canonical mission process-death, durable wait and cancellation cohort',async()=>{
  try{await init();
   for(const mode of ['before_claim_commit','after_claim_commit','during_finish','after_finish_commit']){
    const f=await fixture();await killWorker(f,mode);
    const fresh=await connect();try{
     if(mode==='before_claim_commit'){const claim=await prepare(fresh,f);assert.ok(claim.id);assert.deepEqual(await counts(f),{products:0,reviews:0});}
     else{await assert.rejects(()=>prepare(fresh,f),/one_use_claim/);const row=(await fresh.query('SELECT state FROM sandy_mission_work_product_audit WHERE run_id=$1',[f.run])).rows[0];assert.equal(row.state,mode==='after_finish_commit'?'succeeded':'started');assert.deepEqual(await counts(f),{products:mode==='after_finish_commit'?1:0,reviews:mode==='after_finish_commit'?1:0});}
    }finally{await fresh.end();}
   }
   // Two restarted clients cannot both acquire the same queued run.
   const duplicate=await fixture(),first=await connect(),second=await connect();try{
    await first.query('BEGIN');await prepare(first,duplicate);const pid=(await second.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    const other=prepare(second,duplicate).then(()=>({ok:true,error:''}),e=>({ok:false,error:String(e)}));await blocked(pid);await first.query('COMMIT');const outcome=await other;assert.equal(outcome.ok,false);assert.match(outcome.error,/one_use_claim/);
    assert.equal((await root.query('SELECT count(*)::int n FROM sandy_mission_work_product_audit WHERE run_id=$1',[duplicate.run])).rows[0].n,1);
   }finally{await first.query('ROLLBACK').catch(()=>{});await Promise.all([first.end(),second.end()]);}
   // A durable dependency wait survives reconnect, then a new run may claim only after the prerequisite changes.
   const waiting=await fixture(true);let c=await connect();const w=await prepare(c,waiting);assert.equal(w.waiting_reason,'blocked_by_milestone_dependencies');await finish(c,w.id,true);await c.end();c=await connect();
   assert.equal((await c.query('SELECT state FROM sandy_mission_work_product_audit WHERE id=$1',[w.id])).rows[0].state,'waiting');await assert.rejects(()=>prepare(c,waiting),/one_use_claim/);await c.end();
   waiting.run=crypto.randomUUID();await root.query("INSERT INTO sandy_mission_runs(id,customer_id,mission_task_id,stage,state) VALUES($1,$2,$3,'execute','queued')",[waiting.run,waiting.customer,waiting.mission]);const stillBlocked=await prepare(root,waiting);assert.equal(stillBlocked.waiting_reason,'blocked_by_milestone_dependencies');await finish(root,stillBlocked.id,true);
   await root.query("UPDATE sandy_tasks SET status='completed' WHERE id=$1",[waiting.dependency]);waiting.run=crypto.randomUUID();await root.query("INSERT INTO sandy_mission_runs(id,customer_id,mission_task_id,stage,state) VALUES($1,$2,$3,'execute','queued')",[waiting.run,waiting.customer,waiting.mission]);assert.equal((await prepare(root,waiting)).waiting_reason,null);assert.deepEqual(await counts(waiting),{products:0,reviews:0});
   // Both real concurrent lock orders: cancellation wins, or committed draft wins.
   for(const cancelFirst of [true,false]){
    const f=await fixture(),claim=await prepare(root,f),a=await connect(),b=await connect();try{
     const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;await a.query('BEGIN');
     if(cancelFirst){await a.query("UPDATE sandy_tasks SET status='cancelled' WHERE id=$1",[f.mission]);const pending=finish(b,claim.id).then(()=>({ok:true,error:''}),e=>({ok:false,error:String(e)}));await blocked(pid);await a.query('COMMIT');const result=await pending;assert.equal(result.ok,false);assert.match(result.error,/mission_unavailable/);assert.deepEqual(await counts(f),{products:0,reviews:0});}
     else{await finish(a,claim.id);const pending=b.query("UPDATE sandy_tasks SET status='cancelled' WHERE id=$1",[f.mission]);await blocked(pid);await a.query('COMMIT');await pending;assert.deepEqual(await counts(f),{products:1,reviews:1});await assert.rejects(()=>finish(root,claim.id),/finish_claim_required/);}
     assert.equal((await root.query('SELECT status FROM sandy_tasks WHERE id=$1',[f.mission])).rows[0].status,'cancelled');
    }finally{await a.query('ROLLBACK').catch(()=>{});await Promise.all([a.end(),b.end()]);}
   }
   console.log('PASS: 4 killed-client checkpoints, duplicate-claim race, dependency wait/reconnect/new-run, 2 concurrent cancellation orders; provider calls=0. Post-claim crash stays fenced/started: automatic restart recovery remains unimplemented.');
  }finally{await root?.end();}
 });
}
