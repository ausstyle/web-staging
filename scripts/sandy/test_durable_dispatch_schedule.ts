/** Isolated timer/ACL tests. Synthetic transport only; no provider/network calls. */
import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
import assert from 'node:assert/strict';
Deno.test('existing durable dispatcher timer is fixed, private, bounded and disabled until configured',async(t)=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA vault;CREATE SCHEMA net;CREATE SCHEMA cron;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('fixture.role',true)$$;
 CREATE TABLE public.sandy_engineering_changes(id uuid PRIMARY KEY);
 CREATE TABLE public.sandy_engineering_change_events(change_id uuid,event_type text,actor uuid,detail jsonb);
 CREATE TABLE public.sandy_orch_jobs(id uuid PRIMARY KEY,state text);
 CREATE TABLE public.sandy_orch_outbox(job_id uuid,available_at timestamptz,lease_until timestamptz);
 CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),decrypted_secret text,name text,description text);
 CREATE VIEW vault.decrypted_secrets AS SELECT * FROM vault.secrets;
 CREATE FUNCTION vault.create_secret(new_secret text,new_name text DEFAULT NULL,new_description text DEFAULT '',new_key_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$INSERT INTO vault.secrets(decrypted_secret,name,description) VALUES($1,$2,$3) RETURNING id$$;
 CREATE FUNCTION vault.update_secret(secret_id uuid,new_secret text DEFAULT NULL,new_name text DEFAULT NULL,new_description text DEFAULT NULL,new_key_id uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$UPDATE vault.secrets SET decrypted_secret=coalesce($2,decrypted_secret) WHERE id=$1$$;
 CREATE TABLE net.fixture_requests(id bigserial,url text,body jsonb,headers jsonb,timeout_ms integer);
 CREATE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}',params jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$INSERT INTO net.fixture_requests(url,body,headers,timeout_ms) VALUES($1,$2,$4,$5) RETURNING id$$;
 CREATE TABLE cron.job(jobname text,schedule text,command text);
 CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$INSERT INTO cron.job VALUES($1,$2,$3) RETURNING 1::bigint$$;`);
 await db.exec(await Deno.readTextFile('supabase/migrations/20261024003000_sandy_durable_dispatch_schedule.sql'));
 const value=async(sql:string,params:any[]=[])=>((await db.query(sql,params)).rows[0] as any).v;
 await t.step('no public or workload access to private timer/config/credential',async()=>{
  for(const role of ['anon','authenticated','service_role']){
   assert.equal(await value(`SELECT has_function_privilege('${role}','public.sandy_orch_worker_tick()','EXECUTE') v`),false);
   assert.equal(await value(`SELECT has_table_privilege('${role}','public.sandy_orch_worker_control','SELECT') v`),false);
  }
  for(const role of ['anon','authenticated'])assert.equal(await value(`SELECT has_function_privilege('${role}','public.sandy_orch_worker_bind_transport(text)','EXECUTE') v`),false);
  assert.equal(await value('SELECT public.sandy_orch_worker_tick() v').then(x=>x.state),'disabled');
 });
 await t.step('existing private service transport binds without creating admission or authority',async()=>{
  await db.exec("SELECT set_config('fixture.role','authenticated',false)");await assert.rejects(db.query('SELECT public.sandy_orch_worker_bind_transport($1)',['fixture-secret-'.repeat(12)]),/private_worker_transport_binding_required/);
  await db.exec("SELECT set_config('fixture.role','service_role',false)");
  const result=await value('SELECT public.sandy_orch_worker_bind_transport($1) v',['fixture-secret-'.repeat(12)]);assert.deepEqual(result,{ok:true,bound:true,authority_expanded:false});
  const change='10000000-0000-4000-8000-000000000001';await db.query('INSERT INTO public.sandy_engineering_changes VALUES($1)',[change]);
  await db.query("UPDATE public.sandy_orch_worker_control SET enabled=true,release_change_id=$1,source_commit=repeat('a',40)",[change]);
  assert.equal((await value('SELECT public.sandy_orch_worker_tick() v')).state,'idle');assert.equal(await value('SELECT count(*)::integer v FROM net.fixture_requests'),0);
 });
 await t.step('due queue causes one fixed worker tick, never arbitrary URL/operation or claimed success',async()=>{
  const job='10000000-0000-4000-8000-000000000002';await db.query("INSERT INTO public.sandy_orch_jobs VALUES($1,'queued')",[job]);await db.query("INSERT INTO public.sandy_orch_outbox VALUES($1,clock_timestamp()-interval '1 second',NULL)",[job]);
  const result=await value('SELECT public.sandy_orch_worker_tick() v');assert.equal(result.state,'dispatch_requested');assert.equal(result.provider_executed,false);
  const request=(await db.query('SELECT url,body,timeout_ms FROM net.fixture_requests')).rows[0];assert.deepEqual(request,{url:'https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-orchestration-api',body:{action:'worker_run',arguments:{limit:1,lease_seconds:90}},timeout_ms:30000});
  assert.equal((await value('SELECT public.sandy_orch_worker_tick() v')).state,'rate_limited');
  assert.equal(await value('SELECT count(*)::integer v FROM net.fixture_requests'),1);
  const events=await value("SELECT jsonb_agg(detail) v FROM public.sandy_engineering_change_events");assert.equal(JSON.stringify(events).includes('fixture-secret'),false);
  assert.equal(await value("SELECT state v FROM public.sandy_orch_jobs WHERE id='10000000-0000-4000-8000-000000000002'"),'queued');
 });
 await t.step('cancelled and future work do not wake executor, expired leases can recover, kill switch stops',async()=>{
  await db.exec("UPDATE public.sandy_orch_worker_control SET last_requested_at=NULL;UPDATE public.sandy_orch_jobs SET state='cancelled'");assert.equal((await value('SELECT public.sandy_orch_worker_tick() v')).state,'idle');
  await db.exec("UPDATE public.sandy_orch_jobs SET state='queued';UPDATE public.sandy_orch_outbox SET available_at=clock_timestamp()+interval '1 hour'");assert.equal((await value('SELECT public.sandy_orch_worker_tick() v')).state,'idle');
  await db.exec("UPDATE public.sandy_orch_jobs SET state='running';UPDATE public.sandy_orch_outbox SET lease_until=clock_timestamp()-interval '1 second'");assert.equal((await value('SELECT public.sandy_orch_worker_tick() v')).state,'dispatch_requested');
  await db.exec('UPDATE public.sandy_orch_worker_control SET enabled=false,last_requested_at=NULL');assert.equal((await value('SELECT public.sandy_orch_worker_tick() v')).state,'disabled');
  const cron=(await db.query('SELECT * FROM cron.job')).rows;assert.deepEqual(cron,[{jobname:'sandy-orchestration-dispatch-every-minute',schedule:'* * * * *',command:'SELECT public.sandy_orch_worker_tick()'}]);
 });
 }finally{await db.close();}
});
