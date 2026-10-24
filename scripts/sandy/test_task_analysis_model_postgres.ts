import {PGlite} from "npm:@electric-sql/pglite@0.3.14";
import assert from "node:assert/strict";
import {taskAnalysisRequest} from '../../supabase/functions/_shared/sandy-agent-operations/task_analysis_profile.ts';
import {taskAnalysisSourceSha256} from '../../supabase/functions/_shared/sandy-agent-operations/task_analysis_model.ts';
const task='10000000-0000-4000-8000-000000000001',customer='20000000-0000-4000-8000-000000000001';
Deno.test('real PostgreSQL task admission is source/customer/contract bound, bounded and never paid-replayed',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon')$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);CREATE TABLE email_customers(id uuid PRIMARY KEY,display_name text,google_drive_folder_status text);CREATE TABLE sandy_memory_settings(customer_id uuid,enabled bool,learning_enabled bool,proactive_enabled bool);CREATE TABLE sandy_memory_portal_accounts(auth_user_id uuid,customer_id uuid,revoked_at timestamptz);CREATE TABLE sandy_controller_admins(auth_user_id uuid);
 CREATE TABLE sandy_tasks(id uuid PRIMARY KEY,customer_id uuid,title text,source_kind text,archived_at timestamptz);
 CREATE TABLE sandy_task_analysis_queue(task_id uuid PRIMARY KEY,customer_id uuid,source_title text,state text);
 CREATE TABLE sandy_openai_context_policies(capability text PRIMARY KEY,permitted_categories text[],prohibited_categories text[],require_external_research bool,max_context_chars int,enabled bool);
 CREATE TABLE sandy_openai_request_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT now(),customer_id uuid,source_channel text,source_reference text,request_id text,provider_response_id text,capability text,model text,policy_version text,context_manifest jsonb,rejected_manifest jsonb,request_sha256 text,request_chars int,decision text,violations jsonb,execution_status text,verified_success bool,meta jsonb);
 ALTER TABLE sandy_openai_request_audit ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT ON sandy_openai_request_audit TO service_role;GRANT SELECT ON sandy_openai_context_policies TO service_role;
 INSERT INTO sandy_tasks VALUES('${task}','${customer}','Call Alice tomorrow','manual',NULL);
 INSERT INTO sandy_task_analysis_queue VALUES('${task}','${customer}','Call Alice tomorrow','processing');`);
 await db.exec(await Deno.readTextFile('supabase/migrations/20261024005200_sandy_task_model_admission.sql'));
 const call=async(title='Call Alice tomorrow',sha=taskAnalysisSourceSha256,c=customer)=> (await db.query<{v:any}>('SELECT sandy_task_model_admit($1,$2,$3,$4) v',[task,c,sha,JSON.stringify(taskAnalysisRequest(title))])).rows[0].v;
 assert.equal((await call()).error,'task_model_private_runtime_required');
 await db.exec("SET request.jwt.claim.role='service_role'");
 assert.equal((await call()).error,'task_model_policy_disabled');
 assert.equal((await db.query<{v:string}>('SELECT sandy_task_model_mode($1,$2) v',[task,customer])).rows[0].v,'legacy_staging');
 await db.exec(`INSERT INTO auth.users VALUES('${customer}','fixture@example.invalid','{"sandy_api_isolated_session_test":true}');INSERT INTO email_customers VALUES('${customer}','Isolated Sandy API service acceptance','excluded');INSERT INTO sandy_memory_settings VALUES('${customer}',false,false,false);INSERT INTO sandy_memory_portal_accounts VALUES('${customer}','${customer}',NULL);UPDATE sandy_openai_context_policies SET execution_limits=execution_limits||jsonb_build_object('canary_customer_id','${customer}','canary_expires_at',clock_timestamp()+interval '14 minutes')`);
 assert.equal((await db.query<{v:string}>('SELECT sandy_task_model_mode($1,$2) v',[task,customer])).rows[0].v,'governed');
 // Add a delay only to the isolated fixture function, immediately before its
 // real advisory wait point. Production migration has no hook or sleep.
 const definition=(await db.query<{d:string}>(`SELECT pg_get_functiondef('sandy_task_model_admit(uuid,uuid,text,text)'::regprocedure) d`)).rows[0].d;
 const delayed=definition.replace(" PERFORM pg_advisory_xact_lock(hashtextextended('task-model-global:"," PERFORM pg_sleep(0.15); PERFORM pg_advisory_xact_lock(hashtextextended('task-model-global:");assert.notEqual(delayed,definition);await db.exec(delayed);
 await db.exec(`UPDATE sandy_openai_context_policies SET execution_limits=jsonb_set(execution_limits,'{canary_expires_at}',to_jsonb((clock_timestamp()+interval '50 milliseconds')::text))`);
 assert.equal((await db.query<{v:string}>('SELECT sandy_task_model_mode($1,$2) v',[task,customer])).rows[0].v,'governed');
 assert.equal((await call()).error,'task_model_policy_changed_before_reservation');
 assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM sandy_openai_request_audit')).rows[0].n,0);
 await db.exec(definition);

 await db.exec(`UPDATE sandy_openai_context_policies SET execution_limits=jsonb_set(execution_limits,'{canary_expires_at}',to_jsonb((clock_timestamp()-interval '1 second')::text))`);
 assert.equal((await db.query<{v:string}>('SELECT sandy_task_model_mode($1,$2) v',[task,customer])).rows[0].v,'blocked');
 await db.exec(`UPDATE sandy_openai_context_policies SET execution_limits=execution_limits-ARRAY['canary_customer_id','canary_expires_at']`);
 await db.exec(`UPDATE sandy_openai_context_policies SET execution_limits=jsonb_set(execution_limits,'{rollout_stage}','"enforced"')`);
 assert.equal((await db.query<{v:string}>('SELECT sandy_task_model_mode($1,$2) v',[task,customer])).rows[0].v,'blocked');
 await db.exec("UPDATE sandy_openai_context_policies SET enabled=true WHERE capability='task.configuration.extract'");
 assert.equal((await call(undefined,'0'.repeat(64))).error,'task_model_source_denied');
 assert.equal((await call(undefined,undefined,'20000000-0000-4000-8000-000000000099')).error,'task_model_current_request_required');
 assert.equal((await call('Wrong title')).error,'task_model_contract_denied');
 const source=await Deno.readTextFile('supabase/functions/sandy-task-analysis-worker/index.ts');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source))),n=>n.toString(16).padStart(2,'0')).join('');
 assert.equal(hash,taskAnalysisSourceSha256,'compiled helper and real entrypoint must agree');
 for(const [model,source] of [['gpt-wrong',taskAnalysisSourceSha256],['gpt-4.1-mini','0'.repeat(64)]]){
  await assert.rejects(db.query(`INSERT INTO sandy_openai_request_audit(capability,model,decision,execution_status,verified_success,meta) VALUES('task.configuration.extract',$1,'allowed','started',false,$2)`,[model,{source_sha256:source}]),/source_bound_claim_required/);
 }
 const admitted=await call();assert.equal(admitted.state,'started');assert.equal(admitted.reused,false);
 assert.equal((await call()).reused,true);
 const metrics={schema_version:'1',source:'received_provider_envelope',provider_effect_verified:false,cost_basis:'unavailable_usage_or_model',model_returned:null,request_duration_ms:1,usage:null,estimated_cost_usd:null,rate_verified_at:null};
 const finish=async(state:string,result:any=null)=> (await db.query<{v:any}>('SELECT sandy_task_model_finish($1,$2,$3,$4,$5,$6) v',[admitted.audit_id,state,'resp_fixture','a'.repeat(64),result,metrics])).rows[0].v;
 assert.equal((await finish('unknown')).ok,true);assert.equal((await finish('unknown')).ok,true);
 assert.equal((await call()).state,'unknown');assert.equal((await call()).reused,true);
 assert.equal((await finish('succeeded',{})).ok,false);
 await db.exec("UPDATE sandy_openai_context_policies SET execution_limits=jsonb_set(execution_limits,'{customer_requests_daily}','1')");
 await db.exec(`UPDATE sandy_tasks SET title='Call Bob tomorrow';UPDATE sandy_task_analysis_queue SET source_title='Call Bob tomorrow'`);
 assert.equal((await call('Call Bob tomorrow')).error,'task_model_customer_budget_exhausted');
 await db.exec(`UPDATE sandy_tasks SET title='"Literal"';UPDATE sandy_task_analysis_queue SET source_title='"Literal"'`);
 assert.equal((await call('"Literal"')).error,'task_model_current_request_required');
 await db.exec(`UPDATE sandy_tasks SET title='Call Carol tomorrow';UPDATE sandy_task_analysis_queue SET source_title='Call Carol tomorrow';UPDATE sandy_openai_context_policies SET execution_limits=jsonb_set(execution_limits,'{customer_requests_daily}','100')`);
 const second=await call('Call Carol tomorrow');assert.equal(second.state,'started');
 const result={contact_name:'Carol',time_text:null,date_text:'tomorrow',relative_text:null,date_ymd:null,due_date_ymd:null,hour:null,minute:null,relative_minutes:null,priority:null,timezone:null};
 const saved=await db.query<{v:any}>('SELECT sandy_task_model_finish($1,$2,$3,$4,$5,$6) v',[second.audit_id,'succeeded','resp_second','b'.repeat(64),result,metrics]);assert.equal(saved.rows[0].v.ok,true);
 const reused=await call('Call Carol tomorrow');assert.equal(reused.state,'succeeded');assert.deepEqual(reused.result,result);
 await assert.rejects(db.exec(`UPDATE sandy_openai_request_audit SET verified_success=true WHERE id='${second.audit_id}'`),/transition_denied/);
 await assert.rejects(db.exec(`DELETE FROM sandy_openai_request_audit WHERE id='${second.audit_id}'`),/audit_immutable/);
 await db.exec(`UPDATE sandy_tasks SET title='Call David tomorrow';UPDATE sandy_task_analysis_queue SET source_title='Call David tomorrow';UPDATE sandy_openai_context_policies SET execution_limits=jsonb_set(execution_limits,'{global_requests_daily}','2')`);
 assert.equal((await call('Call David tomorrow')).error,'task_model_global_budget_exhausted');
 await db.exec(`UPDATE sandy_openai_context_policies SET execution_limits=jsonb_set(jsonb_set(execution_limits,'{global_requests_daily}','10000'),'{customer_token_units_daily}','1')`);
 assert.equal((await call('Call David tomorrow')).error,'task_model_customer_budget_exhausted');
 const forged=taskAnalysisRequest('Call David tomorrow');forged.max_output_tokens=513;
 const denied=await db.query<{v:any}>('SELECT sandy_task_model_admit($1,$2,$3,$4) v',[task,customer,taskAnalysisSourceSha256,JSON.stringify(forged)]);assert.equal(denied.rows[0].v.error,'task_model_contract_denied');
 await db.exec('SET ROLE service_role');
 await assert.rejects(db.exec(`UPDATE sandy_openai_context_policies SET enabled=true`),/permission denied/);
 await assert.rejects(db.exec(`INSERT INTO sandy_openai_request_audit(capability) VALUES('task.configuration.extract')`),/protected_custody/);
 await db.exec('RESET ROLE');
 const count=await db.query<{n:number}>('SELECT count(*)::int n FROM sandy_openai_request_audit');assert.equal(count.rows[0].n,2);
 }finally{await db.close();}
});
