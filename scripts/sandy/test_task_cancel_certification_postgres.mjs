// Exact shared transactional service and private fixture readiness, no network.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runMemoryReceiptTests} from './test_memory_correction_receipt_postgres.mjs';
await runMemoryReceiptTests(async ({db,actor,customer,foreign})=>{
  await db.exec(
    `DROP TRIGGER deny_fixture_audit ON sandy_memory_audit;DROP FUNCTION deny_fixture_audit();
 ALTER TABLE auth.users ADD COLUMN raw_user_meta_data jsonb DEFAULT '{"sandy_api_isolated_session_test":true}'::jsonb;
 CREATE TABLE email_customers(id uuid PRIMARY KEY,display_name text,google_drive_folder_status text);
 CREATE TABLE sandy_memory_settings(customer_id uuid,learning_enabled boolean,proactive_enabled boolean);
 ALTER TABLE auth.users ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
 CREATE TABLE sandy_controller_admins(auth_user_id uuid,role text,enabled boolean);
 CREATE TABLE sandy_engineering_artifacts(id uuid PRIMARY KEY,change_id uuid NOT NULL,artifact_type text NOT NULL,target text NOT NULL,before_ref text,after_ref text,rollback_strategy text NOT NULL,rollback_notes text,metadata jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE sandy_engineering_change_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,change_id uuid NOT NULL,event_type text NOT NULL,actor uuid,detail jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now());
 GRANT USAGE ON SCHEMA auth TO service_role,authenticated;GRANT INSERT,UPDATE,SELECT ON sandy_engineering_artifacts,sandy_engineering_change_events TO service_role;
 GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
 UPDATE sandy_operation_registry SET api_exposed=false,ai_exposed=false,verified=false;`,
  );
  const sql = await readFile(
    new URL(
      "../../supabase/migrations/20261024004200_sandy_memory_private_certification.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(`ALTER TABLE sandy_tasks ADD COLUMN title text,ADD COLUMN source_kind text,ADD COLUMN metadata jsonb DEFAULT '{}',ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN status text,ADD COLUMN priority text,ADD COLUMN version integer DEFAULT 1;
INSERT INTO sandy_operation_registry(operation,handler,permission_scope,is_mutation,api_exposed,ai_exposed,verified) VALUES('tasks.update','sandy-operations-api','tasks:write',true,true,true,false);`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261024004300_sandy_task_cancel_private_certification.sql',import.meta.url),'utf8'));

 const artifact='71000000-0000-4000-8000-000000000001',change='72000000-0000-4000-8000-000000000001',task='73000000-0000-4000-8000-000000000001';
 const email='sandy-service-acceptance-12345678-1234-4234-8234-1234567890ab@example.invalid';
 const deployment='zmqlyygzqoidkcwdysok_6e50ff35-5878-42e2-982c-c205df6cac2e_61',contract='d14a757c041f6f6658d50093aa6de841f8300da480a7db76e6936dd8f44ddedf',key='task_cancel_cert_12345678901234567890123456789012:one';
 await db.query('UPDATE auth.users SET email=$1,email_confirmed_at=now()',[email]);
 await db.query('UPDATE email_customer_addresses SET normalized_email=$1',[email]);
 await db.query("INSERT INTO email_customers VALUES($1,'Isolated Sandy API service acceptance','excluded')",[customer]);
 await db.query('INSERT INTO sandy_memory_settings VALUES($1,false,false)',[customer]);
 await db.query("INSERT INTO sandy_tasks(id,customer_id,title,metadata,status,priority,source_kind) VALUES($1,$2,'Isolated Sandy API service task',$3,'waiting','normal','sandy_api_fixture')",[task,customer,JSON.stringify({sandy_mission:true})]);
 const metadata={kind:'runtime_task_cancel_certification',schema_version:1,operation:'tasks.update',fixture_user_id:actor,fixture_customer_id:customer,release_commit:'b'.repeat(40),api_bundle_sha256:'a'.repeat(64),api_deployment_id:deployment,contract_sha256:contract,idempotency_prefix:'task_cancel_cert_12345678901234567890123456789012:',task_ids:[task],max_mutations:1,budget_units:0,expires_at:new Date(Date.now()+600000).toISOString()};
 await db.query("INSERT INTO sandy_engineering_artifacts(id,change_id,artifact_type,target,rollback_strategy,metadata) VALUES($1,$2,'configuration','tasks.update','manual_review',$3)",[artifact,change,JSON.stringify(metadata)]);
 const claims=async(normal=true)=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[normal?actor:'',normal?'authenticated':'']);
 const proof=async(target=task)=> (await db.query('SELECT sandy_api_task_cancel_private_readiness($1,$2,$3,$4,$5) result',[artifact,deployment,contract,target,key])).rows[0].result;
 const install=()=>db.query("INSERT INTO sandy_engineering_change_events(change_id,event_type,actor,detail) SELECT change_id,'task_cancel_private_readiness_installed',NULL,jsonb_build_object('artifact_id',id,'artifact_sha256',encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),'release_commit',metadata->>'release_commit','api_bundle_sha256',metadata->>'api_bundle_sha256','api_deployment_id',metadata->>'api_deployment_id','contract_sha256',metadata->>'contract_sha256') FROM sandy_engineering_artifacts a WHERE id=$1",[artifact]);
 assert.equal((await proof()).ok,false);
 await assert.rejects(install(),e=>e.code==='42501');
 await claims(false);await install();await claims();
 assert.equal((await proof()).ok,true);assert.equal((await proof(foreign)).ok,false);
 await db.exec(`CREATE OR REPLACE FUNCTION sandy_api_current_agenda_customer_id() RETURNS uuid LANGUAGE sql AS $$SELECT customer_id FROM public.sandy_memory_portal_accounts WHERE auth_user_id=auth.uid() AND revoked_at IS NULL$$;`);
 await db.query("SELECT set_config('request.headers',$1,false)",[JSON.stringify({'x-sandy-certification-id':artifact,'x-sandy-api-deployment-id':deployment})]);
 const mutate=async(args,k=key)=>(await db.query("SELECT sandy_api_customer_mutation('tasks.update',$1,$2) result",[JSON.stringify(args),k])).rows[0].result;
 assert.equal((await mutate({id:task,status:'completed'})).error,'operation_requires_live_verification');
 assert.equal((await mutate({id:task,status:'cancelled',title:'not allowed'})).error,'operation_requires_live_verification');
 const actual=await mutate({id:task,status:'cancelled'});assert.equal(actual.ok,true);assert.equal(actual.item.status,'cancelled');
 const replay=await mutate({id:task,status:'cancelled'});assert.equal(replay.reused,true);assert.equal(replay.mutation_id,actual.mutation_id);
 assert.equal((await mutate({id:task,status:'cancelled'},key+'new')).error,'operation_requires_live_verification');
 assert.equal((await db.query("SELECT count(*)::int n FROM sandy_customer_mutation_receipts WHERE operation='tasks.update'")).rows[0].n,1);
 assert.equal((await db.query("SELECT verified FROM sandy_operation_registry WHERE operation='tasks.update'")).rows[0].verified,false);
 await claims(false);await db.query("INSERT INTO sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES($1,'task_cancel_private_readiness_revoked',NULL,$2)",[change,JSON.stringify({artifact_id:artifact})]);await claims();
 assert.equal((await proof()).ok,false);
 const sources={private_schema_sources:(await db.query("SELECT proname,encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha,prosecdef,proconfig,pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid IN('public.sandy_guard_task_cancel_private_readiness_event()'::regprocedure,'public.sandy_api_task_cancel_private_readiness(uuid,text,text,uuid,text)'::regprocedure) ORDER BY proname")).rows,shared_rpc_after:(await db.query("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha FROM pg_proc WHERE oid='public.sandy_api_customer_mutation(text,jsonb,text)'::regprocedure")).rows[0].sha};
 const manifest=JSON.parse(await readFile(new URL('../../docs/sandy-engineering/evaluations/task-cancel-adapter-release.json',import.meta.url),'utf8'));
 assert.deepEqual(sources.private_schema_sources,manifest.private_schema_sources);
 assert.equal(sources.shared_rpc_after,manifest.shared_rpc_after_private_readiness_prosrc_sha256);
 console.log(JSON.stringify({task_cancel_private_profile_assertions:12,actual_same_RPC:true,network_used:false,registry_verified:false}));
});
