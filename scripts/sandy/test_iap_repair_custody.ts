/** Isolated PostgreSQL transport fixtures. No real grants, identities or IAP. */
import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';
import assert from 'node:assert/strict';
const actor='10000000-0000-4000-8000-000000000001',session='10000000-0000-4000-8000-000000000002';
const source='a'.repeat(64),scope='b'.repeat(64),revision='sandy-engineering-mcp-fixture';
const proposal='52d56740-59c8-4db1-b7e6-a137c7699b86',fixtureExpiry=new Date(Date.now()+3600000).toISOString();
const names=['sandy-video','sandy-windows'],ids=['6831598645020395570','8120150462304566315'];
Deno.test('protected IAP custody is durable, one-use, grant-bound and fail-closed',async(t)=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA extensions;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('fixture.role',true)$$;
 CREATE FUNCTION extensions.digest(text,text)RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT sha256(convert_to($1,'UTF8'))$$;
 CREATE TABLE public.sandy_engineering_control_grants(identity_user_id uuid PRIMARY KEY,enabled boolean,revision int);
 INSERT INTO public.sandy_engineering_control_grants VALUES('${actor}',false,1);
 CREATE TABLE public.sandy_operation_registry(operation text,handler text,api_exposed boolean,ai_exposed boolean,is_mutation boolean,input_schema jsonb DEFAULT '{"properties":{"provider":{"enum":["github","supabase"]}}}');
 INSERT INTO public.sandy_operation_registry(operation,handler,api_exposed,ai_exposed,is_mutation) VALUES('engineering.job.execute','sandy-engineering-control',true,true,true);
 INSERT INTO public.sandy_operation_registry(operation,handler,api_exposed,ai_exposed,is_mutation) VALUES('engineering.implementation.request','sandy-engineering-control',true,true,true);
 CREATE TABLE public.sandy_deployment_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),requested_by text,engineering_change_id uuid,provider text,operation text,target text,payload jsonb,idempotency_key text UNIQUE,status text,approved_by text,approved_at timestamptz,started_at timestamptz,finished_at timestamptz,created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz DEFAULT clock_timestamp(),result jsonb);
 CREATE TABLE public.sandy_api_execution_admissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),grant_id uuid DEFAULT gen_random_uuid(),actor_id uuid,tenant_id uuid,operation text,request_id uuid,is_mutation boolean,credential_id uuid,input_sha256 text,contract_sha256 text,scope_sha256 text,registry_revision_sha256 text,declared_cost_units bigint,expires_at timestamptz,created_at timestamptz DEFAULT clock_timestamp(),consumed_at timestamptz,finished_at timestamptz,provider_http_status integer,result_sha256 text,state text DEFAULT 'admitted',principal_kind text DEFAULT 'auth_user',effect_verification jsonb);
 CREATE TABLE public.sandy_engineering_identity_events(identity_user_id uuid,owner_authority_id uuid,actor_kind text,event_type text,detail jsonb);
 CREATE TABLE public.sandy_engineering_change_events(change_id uuid,event_type text,actor uuid,detail jsonb);
 CREATE FUNCTION public.sandy_engineering_resolve_iap_repair(a uuid,s uuid,e integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT CASE WHEN a='${actor}' AND s='${session}' AND e=2 AND enabled THEN jsonb_build_object('ok',true,'owner_authority_id','${actor}','revision',revision,'scope_sha256','${scope}',
 'policy',jsonb_build_object('expires_at','${fixtureExpiry}','change_id','${proposal}')) ELSE jsonb_build_object('ok',false) END FROM public.sandy_engineering_control_grants WHERE identity_user_id=a$$;
 SELECT set_config('fixture.role','service_role',false);`);
 await db.exec(await Deno.readTextFile('supabase/migrations/20261024006000_sandy_iap_repair_custody.sql'));
 const val=async(sql:string,p:any[]=[])=>((await db.query(sql,p)).rows[0]as any).v;
 const admit=async(mode:string,parent:any=null,hash=source,rev=revision)=>await val('SELECT public.sandy_iap_repair_admit($1,$2,2,$3,$4,$5,$6) v',[actor,session,mode,parent,hash,rev]);
 const claim=async(a:any,hash=source,rev=revision)=>await val('SELECT public.sandy_iap_repair_claim($1,$2,2,$3,$4,$5,$6,$7) v',[actor,session,a.admission_id,a.grant_id,a.request_id,hash,rev]);
 const finish=async(a:any,p:any)=>await val('SELECT public.sandy_iap_repair_finish($1,$2,2,$3,$4,$5,$6) v',[actor,session,a.admission_id,a.grant_id,a.request_id,p]);
 const start=async(a:any,i:number)=>await val('SELECT public.sandy_iap_repair_write_started($1,$2,2,$3,$4,$5,1,$6,$7,$8,$9,$10) v',[actor,session,a.admission_id,a.grant_id,a.request_id,scope,names[i],ids[i],'c'.repeat(64),'d'.repeat(64)]);
 let plan:any,apply:any;
 const plans=names.map((vm_name,i)=>({vm_name,instance_id:ids[i],expires_at:new Date(Date.now()+3600000).toISOString(),before:{etag:'before',bindings:[]},candidate:{etag:'before',bindings:[{fixture:true}]},before_sha256:'c'.repeat(64),candidate_sha256:'d'.repeat(64)}));
 await t.step('missing independent grant and unreviewed source fail before an admission',async()=>{
  await assert.rejects(admit('plan'),/independent_iap_repair_grant_required/);
  await db.exec('UPDATE public.sandy_engineering_control_grants SET enabled=true');
  await assert.rejects(admit('plan',null,'bad'),/source_context_required/);
  await assert.rejects(admit('exec'),/source_context_required/);
  await assert.rejects(admit('apply'),/verified_parent_custody_required/);
  assert.equal(await val('SELECT count(*)::int v FROM public.sandy_api_execution_admissions'),0);
 });
 await t.step('claim binds actor, session, scope, source and runtime revision once',async()=>{
  plan=await admit('plan');
  await assert.rejects(claim(plan,'e'.repeat(64)),/claim_refused/);
  await assert.rejects(claim(plan,source,'sandy-engineering-mcp-wrong'),/claim_refused/);
  assert.equal((await claim(plan)).mode,'plan');
  await assert.rejects(claim(plan),/claim_refused/);
  await assert.rejects(start(plan,0),/one_use_fixed_target_write_refused/);
  await assert.rejects(finish(plan,{phase:'plan_preserved',plans:plans.slice(0,1)}),/fixed_plan_custody_required/);
  assert.equal((await finish(plan,{phase:'plan_preserved',plans,provider_receipts:[]})).state,'succeeded');
  await assert.rejects(finish(plan,{phase:'plan_preserved',plans}),/receipt_refused/);
 });
 await t.step('write reservation survives interruption and cannot be replayed',async()=>{
  apply=await admit('apply',plan.admission_id);await claim(apply);
  await assert.rejects(start(apply,1),/one_use_fixed_target_write_refused/);
  assert.equal((await start(apply,0)).write_attempt_reserved,true);
  await assert.rejects(start(apply,0),/one_use_fixed_target_write_refused/);
  await assert.rejects(finish(apply,{phase:'completed'}),/both_independent_readbacks_required/);
  await db.exec('UPDATE public.sandy_engineering_control_grants SET enabled=false,revision=2');
  await assert.rejects(start(apply,1),/current_independent_repair_grant_required/);
  assert.equal((await finish(apply,{phase:'failed_or_unknown',reconciliation_required:false})).state,'unknown');
  await db.exec('UPDATE public.sandy_engineering_control_grants SET enabled=true,revision=1');
  await assert.rejects(admit('apply',plan.admission_id),/already_consumed/);
  await assert.rejects(admit('rollback',apply.admission_id),/verified_parent_custody_required/);
 });
 await t.step('only independently read-back effects become rollback custody',async()=>{
  await db.exec("UPDATE public.sandy_api_execution_admissions SET created_at=clock_timestamp()-interval '2 minutes'");
  const p=await admit('plan');await claim(p);await finish(p,{phase:'plan_preserved',plans});
  const a=await admit('apply',p.admission_id);await claim(a);
  for(let i=0;i<2;i++){
   await start(a,i);
   await finish(a,{phase:'target_verified',mode:'apply',revision:1,vm_name:names[i],instance_id:ids[i],before:plans[i].before,observed_after:{...plans[i].candidate,etag:'observed'},proof:{change_required:true}});
  }
  assert.equal((await finish(a,{phase:'completed',mode:'apply',revision:1})).state,'succeeded');
  await db.exec("UPDATE public.sandy_api_execution_admissions SET created_at=clock_timestamp()-interval '2 minutes'");
  const rollback=await admit('rollback',a.admission_id);const r=await claim(rollback);assert.equal(r.mode,'rollback');assert.deepEqual(r.plans[0].before,plans[0].before);assert.equal(r.plans[0].observed_after.etag,'observed');
 });
 await t.step('normal workload prepares and executes only the existing proposal job, without forged Owner approval',async()=>{
  await db.exec("UPDATE public.sandy_api_execution_admissions SET created_at=clock_timestamp()-interval '2 minutes'");
  const prepare=()=>val('SELECT public.sandy_iap_repair_prepare_job($1,$2,2,$3,$4,NULL,$5,$6,$7) v',[actor,session,proposal,'plan','fixture-repair-job-01',source,revision]);
  const prepared=await prepare(),again=await prepare();assert.equal(again.job.id,prepared.job.id);assert.equal(again.reused,true);assert.equal(prepared.job.status,'authorized_by_policy');assert.equal(prepared.job.approved_by,null);assert.equal(prepared.job.approved_at,null);
  const j=prepared.job.id;
  await assert.rejects(val('SELECT public.sandy_iap_repair_job_admit($1,$2,2,$3,$4,$5) v',[actor,session,j,'f'.repeat(64),revision]),/source_pinned_iap_job_required/);
  const a=await val('SELECT public.sandy_iap_repair_job_admit($1,$2,2,$3,$4,$5) v',[actor,session,j,source,revision]);
  await assert.rejects(val('SELECT public.sandy_iap_repair_job_admit($1,$2,2,$3,$4,$5) v',[actor,session,j,source,revision]),/source_pinned_iap_job_required/);
  await claim(a);await finish(a,{phase:'plan_preserved',plans});
  const observed=await val('SELECT to_jsonb(j) v FROM public.sandy_deployment_jobs j WHERE id=$1',[j]);assert.equal(observed.status,'succeeded');assert.equal(observed.approved_by,null);
  const result=await val('SELECT public.sandy_iap_repair_status($1,$2,2,$3,$4,$5) v',[actor,session,a.admission_id,a.grant_id,a.request_id]);assert.equal(result.job_id,j);assert.equal(result.state,'succeeded');
  await db.exec('UPDATE public.sandy_engineering_control_grants SET enabled=false');
  await assert.rejects(prepare(),/independent_iap_repair_grant_required/);
  await db.exec('UPDATE public.sandy_engineering_control_grants SET enabled=true');
 });
 await t.step('ordinary authenticated callers cannot invoke transport RPCs or custody helper',async()=>{
  assert.equal(await val("SELECT has_function_privilege('authenticated','public.sandy_iap_repair_admit(uuid,uuid,integer,text,uuid,text,text)','EXECUTE') v"),false);
  assert.equal(await val("SELECT has_function_privilege('service_role','public.sandy_iap_repair_context(uuid,uuid,integer,uuid,uuid,uuid,boolean)','EXECUTE') v"),false);
  await db.exec("SELECT set_config('fixture.role','authenticated',false)");await assert.rejects(admit('plan'),/source_context_required/);
 });
 }finally{await db.close();}
});
