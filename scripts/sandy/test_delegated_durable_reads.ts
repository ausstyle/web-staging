/** Isolated actual queue/RPC bodies with explicit synthetic Auth/policy fixtures.
 * These tests do not claim a real Owner login, token or provider effect. */
import {PGlite} from 'npm:@electric-sql/pglite@0.3.14';
import assert from 'node:assert/strict';
import {Ajv} from 'npm:ajv@8.17.1';
import {fullFormats} from 'npm:ajv-formats@3.0.1/dist/formats.js';
import {orchestrationContracts} from '../../supabase/functions/sandy-orchestration-api/contracts.ts';
const owner='10000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000002',session='10000000-0000-4000-8000-000000000003',delegation='10000000-0000-4000-8000-000000000004',worker='10000000-0000-4000-8000-000000000005';
Deno.test('delegated read jobs reuse original durable queue without Owner substitution',async(t)=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA extensions;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('fixture.role',true)$$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('fixture.uid',true),'')::uuid$$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT current_setting('fixture.jwt',true)::jsonb$$;
 CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT sha256(convert_to($1,'UTF8'))$$;
 CREATE TABLE auth.users(id uuid,role text,email text,raw_app_meta_data jsonb,banned_until timestamptz);
 CREATE TABLE public.sandy_controller_admins(auth_user_id uuid,enabled boolean,role text);
 CREATE TABLE public.sandy_operation_registry(operation text PRIMARY KEY,handler text,permission_scope text,is_mutation boolean,input_schema jsonb,output_schema jsonb,api_exposed boolean,ai_exposed boolean,verified boolean,error_contract jsonb);
 CREATE TABLE public.sandy_engineering_standing_delegations(id uuid PRIMARY KEY,identity_user_id uuid,version integer,owner_authority_id uuid,revoked_at timestamptz,expires_at timestamptz,policy jsonb);
 CREATE TABLE public.sandy_engineering_test_identities(user_id uuid,enabled boolean,revoked_at timestamptz,rotation_state text,authorized_by uuid,credential_epoch integer);
 CREATE TABLE public.sandy_engineering_operation_classes(operation text,provider text,operation_class text,method text,is_mutation boolean,contract_sha256 text);
 CREATE TABLE public.sandy_engineering_execution_authorizations(identity_user_id uuid,request_id uuid,operation text,input_sha256 text,delegation_id uuid,delegation_version integer,job_id uuid,owner_authority_id uuid,contract_sha256 text,scope_sha256 text);
 CREATE TABLE public.sandy_api_execution_admissions(id uuid,approval_id uuid,actor_id uuid,request_id uuid,operation text,input_sha256 text,contract_sha256 text,scope_sha256 text,tenant_id uuid,credential_id uuid,customer_key_id uuid,registry_revision_sha256 text,state text);
 CREATE FUNCTION public.sandy_api_registry_revision(text) RETURNS text LANGUAGE sql AS $$SELECT repeat('d',64)$$;
 CREATE FUNCTION public.sandy_api_current_owner(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=$1 AND enabled AND role='owner')$$;
 CREATE FUNCTION public.sandy_engineering_resolve_identity(uuid,uuid,integer) RETURNS jsonb LANGUAGE sql AS $$SELECT CASE WHEN $1='${actor}' AND $2='${session}' AND $3=2 AND current_setting('fixture.session_live',true)='true' THEN jsonb_build_object('ok',true) ELSE jsonb_build_object('ok',false,'error','invalid_workload_session') END$$;
 CREATE FUNCTION public.sandy_engineering_resolve_standing(uuid,uuid,integer) RETURNS jsonb LANGUAGE sql AS $$SELECT CASE WHEN (public.sandy_engineering_resolve_identity($1,$2,$3)->>'ok')='true' AND EXISTS(SELECT 1 FROM public.sandy_engineering_standing_delegations WHERE id='${delegation}' AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN jsonb_build_object('ok',true,'delegation_id','${delegation}','version',6,'operations',jsonb_build_array('github.repos.get')) ELSE jsonb_build_object('ok',false,'error','standing_delegation_inactive') END$$;
 CREATE FUNCTION public.sandy_engineering_policy_target(jsonb,text,jsonb,jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT $1->'classes'->'github' ? 'metadata_read' AND $4='{"provider":"github","repository":"ausstyle/web-staging"}'::jsonb AND NOT ($3 ? 'repository')$$;
 INSERT INTO public.sandy_controller_admins VALUES('${owner}',true,'owner');
 INSERT INTO auth.users VALUES('${actor}','authenticated','sandy-engineering-test@sandy-ai.internal','{"sandy_engineering_test":true,"sandy_engineering_epoch":2}',NULL);
 INSERT INTO public.sandy_engineering_test_identities VALUES('${actor}',true,NULL,'ready','${owner}',2);
 INSERT INTO public.sandy_engineering_standing_delegations VALUES('${delegation}','${actor}',6,'${owner}',NULL,clock_timestamp()+interval '1 day','{"classes":{"github":["metadata_read"]},"resources":{"github":["ausstyle/web-staging"]},"requests_per_minute":30,"declared_unit_budget":0}');
 INSERT INTO public.sandy_operation_registry VALUES('github.repos.get','sandy-provider-operation-api','infrastructure:read',false,'{"type":"object","additionalProperties":false}','{"type":"object"}',true,true,false,jsonb_build_object('contract_sha256',repeat('a',64)));
 INSERT INTO public.sandy_engineering_operation_classes VALUES('github.repos.get','github','metadata_read','GET',false,repeat('a',64));
 SELECT set_config('fixture.role','authenticated',false),set_config('fixture.uid','${actor}',false),set_config('fixture.session_live','true',false),set_config('fixture.jwt','{"role":"authenticated","aud":"authenticated","session_id":"${session}","app_metadata":{"sandy_engineering_test":true,"sandy_engineering_epoch":2}}',false);`);
 const original=await Deno.readTextFile('supabase/migrations/20261020231000_sandy_durable_orchestration.sql');
 await db.exec(original.slice(original.indexOf('BEGIN;')+6,original.indexOf('-- Central compatibility request service.')));
 await db.exec(await Deno.readTextFile('supabase/migrations/20261024003200_sandy_delegated_durable_reads.sql'));
 const value=async(sql:string,params:any[]=[])=>((await db.query(sql,params)).rows[0] as any).v;
 const admit=(key:string,args='{}')=>value('SELECT public.sandy_orch_admit_workload_read($1,$2,$3) v',['github.repos.get',args,key]);
 const claim=()=>value(`SELECT public.sandy_orch_claim('${worker}',1,90) v`);
 let first:any,leased:any,dispatch:any;
 await t.step('normal workload admission and idempotency do not create Controller membership or expand policy',async()=>{
  first=await admit('fixture-durable-workload-first');assert.equal(first.ok,true);assert.equal(first.executed,false);assert.equal(first.principal_kind,'engineering_workload');
  assert.equal((await admit('fixture-durable-workload-first')).job_id,first.job_id);
  assert.equal((await admit('fixture-durable-workload-first','{"query":{}}')).error,'idempotency_conflict');
  assert.equal(await value(`SELECT public.sandy_orch_owner('${actor}') v`),false);
  assert.equal(await value(`SELECT count(*)::int v FROM public.sandy_controller_admins WHERE auth_user_id='${actor}'`),0);
  assert.equal(await value('SELECT version v FROM public.sandy_engineering_standing_delegations'),6);
  assert.equal((await admit('fixture-durable-wrong-resource','{"repository":"evil/repo"}')).error,'engineering_policy_blocked');
  assert.equal((await value("SELECT public.sandy_orch_admit_workload_read('github.files.delete','{}','fixture-durable-no-write') v")).error,'operation_not_delegated_metadata_read');
 });
 await t.step('fenced shared claim records workload route; one dispatch preserves stable request ID',async()=>{
  leased=(await claim()).claims[0];assert.equal(leased.job_id,first.job_id);assert.equal(leased.principal_kind,'engineering_workload');
  dispatch=await value('SELECT public.sandy_orch_resolve_workload_dispatch($1,$2,$3) v',[first.job_id,leased.lease_token,worker]);assert.equal(dispatch.ok,true);assert.equal(dispatch.identity_user_id,actor);
  assert.equal((await value('SELECT public.sandy_orch_resolve_workload_dispatch($1,$2,$3) v',[first.job_id,leased.lease_token,worker])).ok,false);
  assert.equal((await value('SELECT public.sandy_orch_resolve_dispatch($1,$2,$3) v',[first.job_id,leased.lease_token,worker])).ok,false);
 });
 await t.step('actual receipt links workload authorization to Owner-authority admission without substituting identity',async()=>{
  const missing=await value('SELECT public.sandy_orch_finish($1,$2,$3,$4,\'succeeded\') v',[first.job_id,leased.lease_token,worker,dispatch.dispatch_id]);assert.equal(missing.error,'execution_admission_required');assert.equal(await value('SELECT state v FROM public.sandy_orch_jobs WHERE id=$1',[first.job_id]),'running');
  const authorization='20000000-0000-4000-8000-000000000001',admission='20000000-0000-4000-8000-000000000002';
  await db.query(`INSERT INTO public.sandy_engineering_execution_authorizations VALUES($1,$2,'github.repos.get',$3,$4,6,$5,$6,repeat('a',64),repeat('c',64))`,[actor,dispatch.dispatch_id,dispatch.input_sha256,delegation,authorization,owner]);
  await db.query(`INSERT INTO public.sandy_api_execution_admissions VALUES($1,$2,$3,$4,'github.repos.get',$5,repeat('a',64),repeat('c',64),NULL,NULL,NULL,repeat('d',64),'succeeded')`,[admission,authorization,owner,dispatch.dispatch_id,dispatch.input_sha256]);
  assert.equal(await value('SELECT public.sandy_orch_workload_receipt_matches($1,$2,$3) v',[first.job_id,admission,dispatch.dispatch_id]),true);
  assert.equal(await value('SELECT public.sandy_orch_workload_receipt_matches($1,$2,$3) v',[first.job_id,owner,dispatch.dispatch_id]),false);
  const finished=await value('SELECT public.sandy_orch_finish($1,$2,$3,$4,\'succeeded\',\'{"ok":true,"synthetic":true}\',NULL,NULL,$5) v',[first.job_id,leased.lease_token,worker,dispatch.dispatch_id,admission]);assert.equal(finished.state,'succeeded');
  assert.equal((await value('SELECT public.sandy_orch_workload_job($1) v',[first.job_id])).latest_attempt.execution_admission_id,admission);
  const again=await value('SELECT public.sandy_orch_finish($1,$2,$3,$4,\'failed\') v',[first.job_id,leased.lease_token,worker,dispatch.dispatch_id]);assert.equal(again.reused,true);assert.equal(again.receipt_outcome,'succeeded');
 });
 await t.step('queued cancellation, session expiry, revocation, budget and contract drift fail closed',async()=>{
  const cancellation=await admit('fixture-durable-cancelled');assert.equal((await value('SELECT public.sandy_orch_workload_job($1,true) v',[cancellation.job_id])).state,'cancelled');
  const drift=await admit('fixture-durable-drift');await db.exec("UPDATE public.sandy_operation_registry SET api_exposed=false");assert.equal((await claim()).claims.length,0);assert.equal(await value('SELECT state v FROM public.sandy_orch_jobs WHERE id=$1',[drift.job_id]),'blocked');await db.exec('UPDATE public.sandy_operation_registry SET api_exposed=true');
  const revoked=await admit('fixture-durable-revoked');await db.exec('UPDATE public.sandy_engineering_standing_delegations SET revoked_at=clock_timestamp()');assert.equal((await claim()).claims.length,0);assert.equal(await value('SELECT state v FROM public.sandy_orch_jobs WHERE id=$1',[revoked.job_id]),'blocked');await db.exec('UPDATE public.sandy_engineering_standing_delegations SET revoked_at=NULL');
  await db.exec("SELECT set_config('fixture.session_live','false',false)");assert.equal((await admit('fixture-durable-expired-session')).ok,false);await db.exec("SELECT set_config('fixture.session_live','true',false)");
  await db.exec("UPDATE public.sandy_engineering_standing_delegations SET policy=jsonb_set(policy,'{requests_per_minute}','0')");assert.equal((await admit('fixture-durable-no-budget')).error,'durable_workload_budget_exhausted');
  for(const role of ['service_role','anon']){await db.query("SELECT set_config('fixture.role',$1,false)",[role]);await assert.rejects(admit('fixture-durable-no-service-owner'),/normal_authenticated_engineering_workload_required/);}
 });
 await t.step('different idempotency keys share an actor admission lock and cannot exceed the queue quota',async()=>{
  const migration=await Deno.readTextFile('supabase/migrations/20261024003200_sandy_delegated_durable_reads.sql');assert.ok(migration.includes("hashtextextended(actor::text||':workload-read-admission',0)"));assert.ok(!migration.includes("':workload-read:'||p_idempotency_key"));
  await db.exec("BEGIN;SELECT set_config('fixture.role','authenticated',false);UPDATE public.sandy_engineering_standing_delegations SET policy=jsonb_set(policy,'{requests_per_minute}','30')");
  for(let i=0;i<20;i++)assert.equal((await admit('fixture-durable-quota-'+String(i).padStart(3,'0'))).ok,true);
  assert.equal((await admit('fixture-durable-quota-overflow')).error,'durable_workload_budget_exhausted');
  assert.equal(await value("SELECT count(*)::integer v FROM public.sandy_orch_jobs WHERE actor_id=$1 AND principal_kind='engineering_workload' AND state IN('queued','leased','running')",[actor]),20);
  await db.exec('ROLLBACK');
 });
 await t.step('expired read with an independently bound canonical success is reconciled without replay or invented output',async()=>{
  await db.exec("SELECT set_config('fixture.role','authenticated',false);UPDATE public.sandy_engineering_standing_delegations SET policy=jsonb_set(policy,'{requests_per_minute}','30');UPDATE public.sandy_orch_jobs SET state='cancelled' WHERE state='queued';ALTER TABLE public.sandy_api_execution_admissions ADD COLUMN provider_http_status integer,ADD COLUMN result_sha256 text");
  await db.exec(await Deno.readTextFile('supabase/migrations/20261024005300_sandy_known_read_receipt_recovery.sql'));
  const prepare=async(key:string,patch:{state?:string;status?:number;hash?:string;input?:string}={})=>{
   const created=await admit(key);assert.equal(created.ok,true);const lease=(await claim()).claims.find((x:any)=>x.job_id===created.job_id);
   assert.ok(lease);
   const dispatch=await value('SELECT public.sandy_orch_resolve_workload_dispatch($1,$2,$3) v',[created.job_id,lease.lease_token,worker]);assert.equal(dispatch.ok,true);
   const authorization=crypto.randomUUID(),admission=crypto.randomUUID();
   await db.query(`INSERT INTO public.sandy_engineering_execution_authorizations VALUES($1,$2,'github.repos.get',$3,$4,6,$5,$6,repeat('a',64),repeat('c',64))`,[actor,dispatch.dispatch_id,dispatch.input_sha256,delegation,authorization,owner]);
   await db.query(`INSERT INTO public.sandy_api_execution_admissions VALUES($1,$2,$3,$4,'github.repos.get',$5,repeat('a',64),repeat('c',64),NULL,NULL,NULL,repeat('d',64),$6,$7,$8)`,[admission,authorization,owner,dispatch.dispatch_id,patch.input??dispatch.input_sha256,patch.state??'succeeded',patch.status??200,patch.hash??'e'.repeat(64)]);
   await db.query("UPDATE public.sandy_orch_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=$1",[created.job_id]);
   return{created,admission};
  };
  const known=await prepare('fixture-expired-known-success');
  const independent=await admit('fixture-independent-after-known');
  const next=await claim();assert.equal(next.claims.length,1);assert.equal(next.claims[0].job_id,independent.job_id);
  assert.equal(await value('SELECT state v FROM public.sandy_orch_jobs WHERE id=$1',[known.created.job_id]),'needs_reconciliation');
  assert.equal(await value('SELECT attempts v FROM public.sandy_orch_jobs WHERE id=$1',[known.created.job_id]),1);
  assert.equal(await value('SELECT result v FROM public.sandy_orch_jobs WHERE id=$1',[known.created.job_id]),null);
  assert.equal(await value('SELECT execution_admission_id v FROM public.sandy_orch_attempts WHERE job_id=$1',[known.created.job_id]),known.admission);
  assert.equal(await value('SELECT outcome v FROM public.sandy_orch_attempts WHERE job_id=$1',[known.created.job_id]),'unknown');
  // Use the actual public status projection expression, without impersonating
  // an Owner or relaxing the workload's separate status authorization route.
  const jobFunction=original.slice(original.indexOf('CREATE FUNCTION public.sandy_orch_job('),original.indexOf('CREATE FUNCTION public.sandy_orch_events_page('));
  const start=jobFunction.indexOf(" RETURN jsonb_build_object('ok',true,'job',")+8,end=jobFunction.indexOf(';\nEND $$;',start);assert.ok(start>8&&end>start);
  const projection=jobFunction.slice(start,end);
  const publicStatus=await value('SELECT '+projection.replaceAll('p_job_id','$1')+' v FROM public.sandy_orch_jobs record_row WHERE id=$1',[known.created.job_id]);
  const validator=new Ajv({strict:true,allErrors:true,allowUnionTypes:true});
  for(const [name,format] of Object.entries(fullFormats))validator.addFormat(name,format);
  const schema=orchestrationContracts.find(x=>x.operation==='orchestration.jobs.get')!.output_schema;
  assert.equal(validator.validate(schema,publicStatus),true,JSON.stringify(validator.errors));
  assert.equal(publicStatus.job.provider_execution_completed,false);
  assert.equal(validator.validate(schema,{...publicStatus,job:{...publicStatus.job,latest_attempt:{...publicStatus.job.latest_attempt,outcome:'lease_expired_canonical_read_observed'}}}),false);

  assert.equal(await value("SELECT count(*)::integer v FROM public.sandy_orch_events WHERE job_id=$1 AND event_type='expired_read_canonical_receipt_observed'",[known.created.job_id]),1);
  assert.equal((await value('SELECT public.sandy_orch_workload_job($1,true) v',[independent.job_id])).state,'cancelled');
  assert.equal((await claim()).claims.length,0);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await value(`SELECT has_function_privilege('${role}','public.sandy_orch_known_expired_workload_read(uuid)','EXECUTE') v`),false);
  for(const [name,patch] of [['unknown',{state:'unknown'}],['failed',{state:'failed'}],['wrong-input',{input:'f'.repeat(64)}],['no-success-status',{status:500}],['bad-result-digest',{hash:'not-a-digest'}]] as const){
   const unproven=await prepare('fixture-expired-'+name,patch);
   assert.equal((await claim()).claims.length,0);
   assert.equal(await value('SELECT state v FROM public.sandy_orch_jobs WHERE id=$1',[unproven.created.job_id]),'queued');
   assert.equal(await value('SELECT attempts v FROM public.sandy_orch_jobs WHERE id=$1',[unproven.created.job_id]),1);
   assert.equal(await value('SELECT error_code v FROM public.sandy_orch_jobs WHERE id=$1',[unproven.created.job_id]),'lease_expired_outcome_unknown');
   await value('SELECT public.sandy_orch_workload_job($1,true) v',[unproven.created.job_id]);
  }
 });
 }finally{await db.close();}
});
