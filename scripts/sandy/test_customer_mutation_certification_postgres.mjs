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

 await db.exec(`ALTER TABLE sandy_tasks ALTER COLUMN id SET DEFAULT gen_random_uuid(),ALTER COLUMN source_kind SET DEFAULT 'manual',ALTER COLUMN status SET DEFAULT 'todo',ALTER COLUMN priority SET DEFAULT 'normal',ADD COLUMN details text,ADD COLUMN due_at timestamptz,ADD COLUMN start_at timestamptz,ADD COLUMN next_review_at timestamptz,ADD COLUMN position integer,ADD COLUMN completed_at timestamptz;
 ALTER TABLE sandy_calendar_events ALTER COLUMN id SET DEFAULT gen_random_uuid(),ADD COLUMN title text,ADD COLUMN description text,ADD COLUMN timezone text DEFAULT 'UTC',ADD COLUMN all_day boolean DEFAULT false,ADD COLUMN location text,ADD COLUMN status text DEFAULT 'confirmed',ADD COLUMN sync_state text DEFAULT 'local',ADD COLUMN company_id uuid,ADD COLUMN created_at timestamptz DEFAULT now();
 CREATE TABLE sandy_agenda_companies(id uuid PRIMARY KEY,customer_id uuid,name text);
 CREATE TABLE sandy_agenda_categories(id uuid PRIMARY KEY,customer_id uuid,company_id uuid,name text);
 CREATE SCHEMA storage;CREATE TABLE storage.objects(bucket_id text,name text);
 CREATE TABLE sandy_universal_files(id uuid PRIMARY KEY,owner_customer_id uuid,display_name text,description text,metadata jsonb,storage_bucket text,storage_path text,provider text,provider_file_id text,library_state text DEFAULT 'active',library_state_changed_at timestamptz,created_at timestamptz DEFAULT now());
 CREATE OR REPLACE FUNCTION sandy_api_current_agenda_customer_id() RETURNS uuid LANGUAGE sql AS $$SELECT customer_id FROM public.sandy_memory_portal_accounts WHERE auth_user_id=auth.uid() AND revoked_at IS NULL$$;`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261024004500_sandy_customer_mutation_private_certification.sql',import.meta.url),'utf8'));
 const contracts=(await db.query('SELECT sandy_customer_mutation_contracts_v1() c')).rows[0].c;
 for(const op of Object.keys(contracts)) await db.query("INSERT INTO sandy_operation_registry(operation,handler,permission_scope,is_mutation,api_exposed,ai_exposed,verified) VALUES($1,'sandy-operations-api',$2,true,true,true,false) ON CONFLICT(operation) DO UPDATE SET api_exposed=true,ai_exposed=true,verified=false",[op,op.split('.')[0]+':write']);
 const artifact='71000000-0000-4000-8000-000000000001',change='72000000-0000-4000-8000-000000000001',task='73000000-0000-4000-8000-000000000001',event='74000000-0000-4000-8000-000000000001',file='75000000-0000-4000-8000-000000000001',company='76000000-0000-4000-8000-000000000001',category='77000000-0000-4000-8000-000000000001',nonce='12345678901234567890123456789012';
 const email='sandy-service-acceptance-12345678-1234-4234-8234-1234567890ab@example.invalid',deployment='zmqlyygzqoidkcwdysok_6e50ff35-5878-42e2-982c-c205df6cac2e_63',prefix='customer_mutation_cert_'+nonce+':';
 await db.query('UPDATE auth.users SET email=$1,email_confirmed_at=now()',[email]);await db.query('UPDATE email_customer_addresses SET normalized_email=$1',[email]);
 await db.query("INSERT INTO email_customers VALUES($1,'Isolated Sandy API service acceptance','excluded')",[customer]);await db.query('INSERT INTO sandy_memory_settings VALUES($1,false,false)',[customer]);
 await db.query("INSERT INTO sandy_tasks(id,customer_id,title,source_kind) VALUES($1,$2,'Isolated Sandy API service task','sandy_api_fixture')",[task,customer]);
 await db.query("INSERT INTO sandy_calendar_events(id,customer_id,title,starts_at,ends_at) VALUES($1,$2,'Isolated local event','2026-10-24T10:00:00Z','2026-10-24T11:00:00Z')",[event,customer]);
 await db.query("INSERT INTO sandy_universal_files(id,owner_customer_id,display_name,metadata,storage_bucket,storage_path) VALUES($1,$2,'Isolated metadata file',$3,'sandy-task-artifacts',$4)",[file,customer,JSON.stringify({customer_mutation_fixture:nonce}),'customer_mutation_fixtures/'+customer+'/'+nonce+'.docx']);await db.query("INSERT INTO storage.objects VALUES('sandy-task-artifacts',$1)",['customer_mutation_fixtures/'+customer+'/'+nonce+'.docx']);
 await db.query("INSERT INTO sandy_agenda_companies VALUES($1,$2,'Isolated mutation fixture company')",[company,customer]);await db.query("INSERT INTO sandy_agenda_categories VALUES($1,$2,$3,'Isolated mutation fixture category')",[category,customer,company]);
 const metadata={kind:'runtime_customer_mutation_certification',schema_version:1,operation:'customer.mutations',fixture_user_id:actor,fixture_customer_id:customer,fixture_nonce:nonce,release_commit:'b'.repeat(40),api_bundle_sha256:'a'.repeat(64),api_deployment_id:deployment,contract_sha256:'d25812379110342b5ff7fbd363a6adec85ab58e0a6351dd22eea7d9c196403cb',contracts,idempotency_prefix:prefix,task_ids:[task],calendar_ids:[event],file_ids:[file],company_ids:[company],category_ids:[category],max_mutations:26,budget_units:0,analysis_mode:'normal_queue_literal_title_only_no_model',expires_at:new Date(Date.now()+600000).toISOString()};
 await db.query("INSERT INTO sandy_engineering_artifacts(id,change_id,artifact_type,target,rollback_strategy,metadata) VALUES($1,$2,'configuration','customer.mutations','manual_review',$3)",[artifact,change,JSON.stringify(metadata)]);
 const claims=async(normal=true)=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[normal?actor:'',normal?'authenticated':'']);
 const proof=async(op,args,key=prefix+op.replaceAll('.','_'))=>(await db.query('SELECT sandy_api_customer_mutation_private_readiness($1,$2,$3,$4,$5,$6) result',[artifact,deployment,contracts[op],op,JSON.stringify(args),key])).rows[0].result;
 const install=()=>db.query("INSERT INTO sandy_engineering_change_events(change_id,event_type,actor,detail) SELECT change_id,'customer_mutation_private_readiness_installed',NULL,jsonb_build_object('artifact_id',id,'artifact_sha256',encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),'release_commit',metadata->>'release_commit','api_bundle_sha256',metadata->>'api_bundle_sha256','api_deployment_id',metadata->>'api_deployment_id','contract_sha256',metadata->>'contract_sha256') FROM sandy_engineering_artifacts a WHERE id=$1",[artifact]);
 await assert.rejects(install(),e=>e.code==='42501');await claims(false);await install();await claims();
 assert.equal((await proof('tasks.update',{id:task,status:'waiting'})).ok,true);
 assert.equal((await proof('tasks.create',{title:'Unbounded normal analysis'})).error,'private_readiness_literal_task_required');
 assert.equal((await proof('tasks.update',{id:foreign,status:'waiting'})).error,'private_readiness_target_denied');
 await db.query("SELECT set_config('request.headers',$1,false)",[JSON.stringify({'x-sandy-certification-id':artifact,'x-sandy-api-deployment-id':deployment})]);
 const mutate=async(op,args,key=prefix+op.replaceAll('.','_'))=>(await db.query('SELECT sandy_api_customer_mutation($1,$2,$3) result',[op,JSON.stringify(args),key])).rows[0].result;
 const cases=[['tasks.create',{title:'"Isolated literal task"',details:'Synthetic',status:'todo',priority:'low',company_id:company,category_id:category,parent_task_id:task,position:2}],['tasks.update',{id:task,title:'Isolated updated fixture',details:'Synthetic updated',status:'waiting',priority:'high',due_at:'2026-10-24T12:00:00Z',start_at:'2026-10-24T11:00:00Z',next_review_at:'2026-10-24T13:00:00Z',company_id:company,category_id:category,position:4}],['tasks.complete',{id:task}],['tasks.archive',{id:task}],['calendar.create',{title:'Isolated create event',starts_at:'2026-10-24T10:00:00Z',ends_at:'2026-10-24T10:30:00Z',description:'Synthetic',timezone:'UTC',all_day:false,location:'Fixture',status:'tentative',company_id:company}],['calendar.update',{id:event,title:'Updated local event',description:null,starts_at:'2026-10-24T11:00:00Z',ends_at:'2026-10-24T12:00:00Z',timezone:'Australia/Sydney',all_day:true,location:null,status:'confirmed',company_id:company}],['calendar.cancel',{id:event}],['files.rename',{id:file,name:'  Isolated Unicode ☁ file  '}],['files.set_description',{id:file,description:null}],['files.archive',{id:file}]];
 const receipts=[];
 for(const [op,args] of cases){const result=await mutate(op,args);assert.equal(result.ok,true,op+JSON.stringify(result));receipts.push(result.mutation_id);const replay=await mutate(op,args);assert.equal(replay.reused,true,op);assert.equal(replay.mutation_id,result.mutation_id);}
 assert.equal(new Set(receipts).size,10);
 assert.equal((await db.query("SELECT count(*)::int n FROM sandy_customer_mutation_receipts WHERE left(idempotency_key,length($1))=$1",[prefix])).rows[0].n,10);
 assert.equal((await db.query("SELECT count(*)::int n FROM sandy_operation_registry WHERE operation=ANY($1) AND verified",[Object.keys(contracts)])).rows[0].n,0);
 const altered=await mutate('tasks.update',{id:task,priority:'low'});assert.equal(altered.error,'idempotency_key_conflict');
 await claims(false);await db.query("INSERT INTO sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES($1,'customer_mutation_private_readiness_revoked',NULL,$2)",[change,JSON.stringify({artifact_id:artifact})]);await claims();assert.equal((await proof('files.rename',{id:file,name:'Changed'})).ok,false);
 const names=['sandy_customer_mutation_contracts_v1','sandy_customer_mutation_fixture_owned','sandy_customer_mutation_fixture_set_valid','sandy_guard_customer_mutation_private_readiness_event','sandy_api_customer_mutation_private_readiness'];
 const private_sources=(await db.query("SELECT proname,encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha,prosecdef,proconfig,pg_get_userbyid(proowner) owner FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1) ORDER BY proname",[names])).rows;
 const shared=(await db.query("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha FROM pg_proc WHERE oid='public.sandy_api_customer_mutation(text,jsonb,text)'::regprocedure")).rows[0].sha;
 const release=JSON.parse(await readFile(new URL('../../docs/sandy-engineering/evaluations/customer-mutation-private-release.json',import.meta.url),'utf8'));
 if(!process.env.CUSTOMER_SCHEMA_OUTPUT){assert.deepEqual(private_sources,release.private_schema_sources);assert.equal(shared,release.shared_rpc_after_private_readiness_prosrc_sha256);}
 if(process.env.CUSTOMER_SCHEMA_OUTPUT){const {writeFile}=await import('node:fs/promises');await writeFile(process.env.CUSTOMER_SCHEMA_OUTPUT,JSON.stringify({private_schema_sources:private_sources,shared_rpc_after:shared}));}
 console.log(JSON.stringify({existing_operations_actual_SQL:10,same_atomic_receipts:true,real_provider_or_production_used:false,registry_flags_enabled:false}));
});
