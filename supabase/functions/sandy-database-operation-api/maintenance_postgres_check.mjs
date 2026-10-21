/** Ephemeral PostgreSQL/WASM component checks. No cloud connection, Auth session,
 * production owner, extension installation or real recurring job is created.
 * Synthetic admissions exercise the actual private SQL/approval/audit boundary.
 * The cron schema is a scheduler-interface fixture, NOT pg_cron verification.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
const { PGlite } = await import(process.env.SANDY_TEST_PGLITE_MODULE ?? 'file:///tmp/sandy-pglite/node_modules/@electric-sql/pglite/dist/index.js');
const db = new PGlite();
const migration = name => readFileSync(new URL(`../../migrations/${name}`,import.meta.url),'utf8');
const deno = process.env.SANDY_TEST_DENO ?? '/workspace/.cloud-setup/toolchain/node_modules/.bin/deno';
const sqlUrl=new URL('./sql.ts',import.meta.url).href;
const actor=randomUUID(),other=randomUUID();
let checks=0;
const checked=(value,message)=>{assert.ok(value,message);checks++;};
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const rpc=async(name,...args)=>scalar(`SELECT public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args.map(v=>typeof v==='object'&&v!==null?JSON.stringify(v):v));
await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA extensions;
 CREATE FUNCTION extensions.digest(value text,algorithm text) RETURNS bytea LANGUAGE SQL IMMUTABLE AS $$ SELECT pg_catalog.sha256(pg_catalog.convert_to(value,'UTF8')) $$;
 CREATE TABLE public.sandy_controller_admins(auth_user_id uuid PRIMARY KEY,role text,enabled boolean);
 CREATE TABLE public.sandy_engineering_changes(id uuid PRIMARY KEY,status text);
 CREATE TABLE public.sandy_deployment_jobs(id uuid PRIMARY KEY,requested_by text,provider text,operation text,target text,payload jsonb,approved_by text,approved_at timestamptz,engineering_change_id uuid,status text,result jsonb,error text,started_at timestamptz,finished_at timestamptz,updated_at timestamptz);
 CREATE TABLE public.sandy_operation_registry(operation text PRIMARY KEY,domain text,description text,permission_scope text,is_mutation boolean,input_schema jsonb,output_schema jsonb,handler text,api_exposed boolean,ui_exposed boolean,ai_exposed boolean,verified boolean,implementation_state text,source_repository text,source_path text,dependencies jsonb,retry_policy jsonb,rollback_policy jsonb,error_contract jsonb,updated_at timestamptz);
`);
await db.exec(migration('20261020233000_sandy_api_access_audit.sql'));
await db.exec(migration('20261021005000_sandy_database_operation_contracts.sql'));
await db.exec(migration('20261021005100_sandy_database_maintenance.sql'));
await db.query("INSERT INTO public.sandy_controller_admins VALUES($1,'owner',true),($2,'owner',true)",[actor,other]);
await db.exec(`CREATE TABLE public.fixture_maintenance(id int PRIMARY KEY,value text);INSERT INTO public.fixture_maintenance VALUES(1,'before'),(2,'second');`);
const operations=['supabase.database.vacuum','supabase.database.cron.jobs.create','supabase.database.cron.jobs.update','supabase.database.maintenance.receipt.get'];
for(const op of operations)await db.query(`INSERT INTO public.sandy_operation_registry(operation,handler,api_exposed,verified,error_contract) VALUES($1,'sandy-database-operation-api',true,true,$2) ON CONFLICT(operation) DO UPDATE SET handler=EXCLUDED.handler,api_exposed=true,verified=true,error_contract=EXCLUDED.error_contract`,[op,JSON.stringify({contract_sha256:'a'.repeat(64),requires_approval:true,requires_grant:true})]);
async function compile(command){
 const code=`import {compileSql,parsedStatement} from ${JSON.stringify(sqlUrl)};const x=JSON.parse(await new Response(Deno.stdin.readable).text());console.log(JSON.stringify({statement:await compileSql(x.sql,x.parameters??[],Object.hasOwn(await parsedStatement(x.sql,'definition'),'SelectStmt')?'query':'dml'),verifications:await Promise.all(x.verifications.map(async v=>({...await compileSql(v.sql,v.parameters??[],'query'),expected_rows:v.expected_rows})))}));`;
 const plan=JSON.parse(execFileSync(deno,['eval',code],{input:JSON.stringify(command),encoding:'utf8',env:{...process.env,DENO_DIR:'/workspace/.cloud-setup/deno-cache'}}));
 return {...plan,canonical:canonical(plan),sha256:digest(plan)};
}
async function admission(operation,args,principal=actor){
 const context={actor_id:principal,tenant_id:null,credential_id:null,request_id:randomUUID(),grant_id:randomUUID(),admission_id:randomUUID(),operation,
  arguments:args,arguments_canonical:canonical(args),input_sha256:digest(args),contract_sha256:'a'.repeat(64),scope_sha256:digest({provider:'supabase',project_ref:'zmqlyygzqoidkcwdysok',database:'postgres',schema:'public'})};
 const approval=randomUUID(),engineering=randomUUID();
 await db.query("INSERT INTO public.sandy_engineering_changes VALUES($1,'approved')",[engineering]);
 await db.query("INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,payload,approved_by,approved_at,engineering_change_id,status) VALUES($1,$2,'supabase',$3,'local_component','{}',$2,clock_timestamp(),$4,'running')",[approval,principal,operation,engineering]);
 await db.query(`INSERT INTO public.sandy_api_mutation_approval_snapshots(job_id,actor_id,engineering_change_id,operation,input_sha256,contract_sha256,scope_sha256,maximum_declared_cost_units,job_fingerprint_sha256) SELECT $1,$2,$3,$4,$5,$6,$7,100,public.sandy_api_job_fingerprint(j) FROM public.sandy_deployment_jobs j WHERE j.id=$1`,[approval,principal,engineering,operation,context.input_sha256,context.contract_sha256,context.scope_sha256]);
 await db.query(`INSERT INTO public.sandy_api_execution_admissions(id,grant_id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,approval_id,state,expires_at,consumed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,public.sandy_api_registry_revision($4),1,$10,'consumed',clock_timestamp()+interval '60 seconds',clock_timestamp())`,[context.admission_id,context.grant_id,principal,operation,context.request_id,!operation.endsWith('receipt.get'),context.input_sha256,context.contract_sha256,context.scope_sha256,approval]);
 if(operation==='supabase.database.vacuum')context.target_table=args.table;
 if(operation.includes('.cron.')){context.plan=await compile(args.command);context.standing={...args.standing,max_affected_rows:args.command.max_affected_rows};}
 return context;
}
const standing=()=>({expires_at:new Date(Date.now()+3600000).toISOString(),max_runs:3,min_interval_seconds:60});
const command=(value='after',expected=value)=>({sql:'UPDATE public.fixture_maintenance SET value=$1::text WHERE id=1 RETURNING id',parameters:[{type:'text',value}],max_affected_rows:1,verifications:[{sql:'SELECT value FROM public.fixture_maintenance WHERE id=1',expected_rows:[{value:expected}]}]});
const args=(c=command())=>({name:'local-component',schedule:'* * * * *',command:c,standing:standing()});
const create=async(a=args(),principal=actor)=>{const p=await admission('supabase.database.cron.jobs.create',a,principal);return {p,response:await rpc('sandy_api_maintenance_cron_upsert',p)};};
const run=id=>rpc('sandy_api_maintenance_cron_run',id);
checked((await rpc('sandy_api_maintenance_reserve',{})).ok===false,'no unbound native authorization');
const vacuum=await admission('supabase.database.vacuum',{table:'fixture_maintenance'});
const rebound={...vacuum,target_table:'sandy_operation_registry'};
checked((await rpc('sandy_api_maintenance_reserve',rebound)).error==='maintenance_target_binding_invalid','native target equals approved argument');
const reserved=await rpc('sandy_api_maintenance_reserve',vacuum);checked(reserved.ok&&reserved.state==='reserved','native reserve captures real relation and backend');
checked((await rpc('sandy_api_maintenance_start',reserved.command_id,randomUUID())).error==='maintenance_lease_refused','wrong one-use lease refused');
checked((await rpc('sandy_api_maintenance_start',reserved.command_id,reserved.lease_token)).ok,'native command starts on reserved physical backend');
checked((await rpc('sandy_api_maintenance_start',reserved.command_id,reserved.lease_token)).error==='maintenance_lease_refused','native start is compare-and-set, never replay');
checked((await rpc('sandy_api_maintenance_finish',reserved.command_id,reserved.lease_token,'accepted',{provider_protocol:'http',provider_command_tag:'VACUUM',command_completed:true})).error==='maintenance_native_completion_required','native completion cannot be an HTTP substitute');
await db.exec('VACUUM (ANALYZE false, FREEZE false, TRUNCATE false, SKIP_LOCKED true) \"public\".\"fixture_maintenance\"');
const finished=await rpc('sandy_api_maintenance_finish',reserved.command_id,reserved.lease_token,'observed',{provider_protocol:'postgres',provider_command_tag:'VACUUM',command_completed:true,readback:{after:{vacuum_count:999999}}});
checked(finished.ok&&['accepted','observed'].includes(finished.result.request_state),'actual local VACUUM outside a transaction has honest durable receipt');
checked(!JSON.stringify(finished).includes('lease_token')&&!JSON.stringify(finished).includes('backend_pid')&&!JSON.stringify(finished).includes('999999'),'native receipt discards supplied statistics and private lease');
checked((await rpc('sandy_api_maintenance_finish_native',vacuum.admission_id,canonical({...finished.result,command_completed:false}))).error==='maintenance_native_receipt_refused','native finalizer binds exact stored receipt');
checked((await rpc('sandy_api_maintenance_finish_native',vacuum.admission_id,canonical(finished.result))).ok,'native finalizer accepts exact native proof');
checked(await scalar('SELECT provider_http_status IS NULL AND state=\'accepted\' FROM public.sandy_api_execution_admissions WHERE id=$1',[vacuum.admission_id]),'native acceptance preserves NULL HTTP status');
checked((await rpc('sandy_api_maintenance_finish_native',vacuum.admission_id,canonical(finished.result))).reused===true,'exact native finalizer replay is idempotent');
checked(Number(await scalar("SELECT count(*) FROM public.sandy_api_audit_events WHERE admission_id=$1 AND phase='native_postgres'",[vacuum.admission_id]))===1,'native finalizer appends shared immutable audit exactly once');
const unknown=await admission('supabase.database.vacuum',{table:'fixture_maintenance'});await rpc('sandy_api_maintenance_reserve',unknown);
checked((await rpc('sandy_api_maintenance_mark_unknown',unknown.admission_id,'connection lost')).result.request_state==='unknown','lost connection records only unknown');
checked((await rpc('sandy_api_maintenance_reserve',unknown)).error==='maintenance_command_already_reserved','unknown native outcome cannot redispatch');
const receipt=await admission('supabase.database.maintenance.receipt.get',{request_id:vacuum.request_id});
checked((await rpc('sandy_api_maintenance_receipt',receipt)).result.command_id===reserved.command_id,'fresh owner grant reconciles native receipt');
const foreign=await admission('supabase.database.maintenance.receipt.get',{request_id:vacuum.request_id},other);
checked((await rpc('sandy_api_maintenance_receipt',foreign)).result===null,'foreign owner cannot inspect native receipt');
const absent=await create();checked(absent.response.error==='maintenance_pg_cron_entitlement_unavailable','missing scheduler is a precise dependency, not missing implementation');
// Explicit scheduler-interface fixtures. These execute actual INSERT/UPDATE to
// test wrapper dispatch, transaction rollback and revocation, never recurring work.
await db.exec(`CREATE SCHEMA cron;
 CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobname text,schedule text,command text,database text,username text,active boolean NOT NULL DEFAULT true);
 CREATE FUNCTION cron.schedule(job_name text,schedule text,command text) RETURNS bigint LANGUAGE SQL AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,schedule,command) RETURNING jobid $$;
 CREATE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL,database text DEFAULT NULL,username text DEFAULT NULL,active boolean DEFAULT NULL) RETURNS void LANGUAGE SQL AS $$ UPDATE cron.job j SET schedule=coalesce($2,j.schedule),command=coalesce($3,j.command),database=coalesce($4,j.database),username=coalesce($5,j.username),active=coalesce($6,j.active) WHERE jobid=$1 $$;
 REVOKE ALL ON SCHEMA cron FROM PUBLIC;REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cron FROM PUBLIC;
`);
const made=await create();checked(made.response.ok,'approved bounded schedule uses actual scheduler interface');
const schedule=made.response.result.schedule_id;
const wrapper=await scalar('SELECT command FROM cron.job WHERE jobid=$1',[made.response.result.cron_job_id]);
checked(wrapper.includes("SET statement_timeout = '15s'")&&wrapper.includes("SET lock_timeout = '3s'")&&wrapper.includes(`public.sandy_api_maintenance_cron_run('${schedule}'::uuid)`)&&!wrapper.includes('UPDATE public.fixture'),'scheduler stores only fixed timed wrapper, no user SQL');
checked((await rpc('sandy_api_maintenance_cron_upsert',made.p)).reused===true&&Number(await scalar('SELECT count(*) FROM cron.job'))===1,'schedule admission replay never creates duplicate');
checked((await run(schedule)).error==='maintenance_server_deadline_required','scheduled effects require actual positive server deadlines');await db.exec("SET statement_timeout='15s';SET lock_timeout='3s'");
const first=await run(schedule);checked(first.ok&&first.result.verification_passed,'scheduled real DML and postcondition commit together');
checked(await scalar('SELECT value FROM public.fixture_maintenance WHERE id=1')==='after','scheduled row independently read back');
checked((await run(schedule)).error==='maintenance_minimum_interval','standing recurrence cannot run faster than approved interval');
checked(Number(await scalar("SELECT requests FROM public.sandy_api_rate_windows WHERE actor_id=$1 AND bucket='principal'",[actor]))===1,'cron consumes shared principal quota');
checked(Number(await scalar("SELECT count(*) FROM public.sandy_api_audit_events WHERE phase='scheduled_owner_authorization' AND outcome='admitted'"))===1,'scheduled authorization uses shared hash-chain phase');
const failed=await create(args(command('must-rollback','different')));
const failure=await run(failed.response.result.schedule_id);checked(failure.error==='maintenance_postcondition_failed'&&failure.paused,'failed postcondition pauses schedule');
checked(await scalar('SELECT value FROM public.fixture_maintenance WHERE id=1')==='after','failed postcondition rolls back business effects');
checked(await scalar('SELECT active=false FROM cron.job WHERE jobid=$1',[failed.response.result.cron_job_id]),'failed run deactivates scheduler interface');
checked((await run(failed.response.result.schedule_id)).error==='maintenance_schedule_paused','failed schedule has no automatic retry');
const updateArgs={...args(command('updated')),schedule_id:schedule,expected_revision:1,name:'reapproved',active:true};
const updated=await admission('supabase.database.cron.jobs.update',updateArgs);const update=await rpc('sandy_api_maintenance_cron_upsert',updated);
checked(update.ok&&update.result.revision===2&&update.result.cron_job_id===made.response.result.cron_job_id,'fresh full approval changes owned schedule with CAS revision');
checked(Number(await scalar('SELECT count(*) FROM public.sandy_database_maintenance_schedule_versions WHERE schedule_id=$1',[schedule]))===2,'prior command and approval version preserved immutably');
const stale=await admission('supabase.database.cron.jobs.update',{...updateArgs,command:command('stale')});
checked((await rpc('sandy_api_maintenance_cron_upsert',stale)).error==='maintenance_schedule_revision_conflict','stale revision never overwrites schedule');
const foreignUpdate=await admission('supabase.database.cron.jobs.update',{...updateArgs,expected_revision:2},other);
checked((await rpc('sandy_api_maintenance_cron_upsert',foreignUpdate)).error==='maintenance_schedule_revision_conflict','another owner cannot adopt existing schedule');
const changed=await create();await db.query('UPDATE public.sandy_api_execution_admissions SET expires_at=clock_timestamp()-interval \'1 hour\' WHERE id=$1',[changed.p.admission_id]);
checked((await run(changed.response.result.schedule_id)).ok,'explicit standing authorization survives only original enqueue TTL');
const revoked=await create();await db.query('UPDATE public.sandy_controller_admins SET enabled=false WHERE auth_user_id=$1',[actor]);
checked((await run(revoked.response.result.schedule_id)).error==='maintenance_standing_authorization_expired_or_changed','owner revocation prevents future effect');
await db.query('UPDATE public.sandy_controller_admins SET enabled=true WHERE auth_user_id=$1',[actor]);
const drift=await create();await db.query("UPDATE public.sandy_operation_registry SET input_schema='{\"drift\":true}' WHERE operation=$1",[drift.p.operation]);
checked((await run(drift.response.result.schedule_id)).error==='maintenance_standing_authorization_expired_or_changed','registry contract revision drift pauses before effect');
await db.query('UPDATE public.sandy_operation_registry SET input_schema=NULL WHERE operation=$1',[drift.p.operation]);
for(const [setup,cleanup,label] of [
 [`CREATE FUNCTION public.fixture_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW;END $$;CREATE TRIGGER fixture_effect AFTER UPDATE ON public.fixture_maintenance FOR EACH ROW EXECUTE FUNCTION public.fixture_effect()`,`DROP TRIGGER fixture_effect ON public.fixture_maintenance;DROP FUNCTION public.fixture_effect()`,'user trigger'],
 [`CREATE RULE fixture_rule AS ON UPDATE TO public.fixture_maintenance DO ALSO NOTIFY fixture_event`,`DROP RULE fixture_rule ON public.fixture_maintenance`,'rewrite rule'],
 [`ALTER TABLE public.fixture_maintenance ENABLE ROW LEVEL SECURITY;CREATE POLICY fixture_policy ON public.fixture_maintenance USING(true)`,`DROP POLICY fixture_policy ON public.fixture_maintenance;ALTER TABLE public.fixture_maintenance DISABLE ROW LEVEL SECURITY`,'RLS policy'],
 [`ALTER TABLE public.fixture_maintenance ALTER COLUMN value SET DEFAULT 'hidden'`,`ALTER TABLE public.fixture_maintenance ALTER COLUMN value DROP DEFAULT`,'default expression'],
 [`CREATE TABLE public.fixture_parent(id int PRIMARY KEY);ALTER TABLE public.fixture_maintenance ADD CONSTRAINT fixture_fk FOREIGN KEY(id) REFERENCES public.fixture_parent(id) NOT VALID`,`ALTER TABLE public.fixture_maintenance DROP CONSTRAINT fixture_fk;DROP TABLE public.fixture_parent`,'foreign-key cascade boundary'],
]){await db.exec(setup);const denied=await create();checked(denied.response.error==='maintenance_hidden_relation_effect_refused',`${label} rejected before schedule activation`);await db.exec(cleanup);}
const rowCap=await create(args({sql:"UPDATE public.fixture_maintenance SET value='overcap' RETURNING id",max_affected_rows:1,verifications:[{sql:'SELECT true AS ok',expected_rows:[{ok:true}]}]}));
checked((await run(rowCap.response.result.schedule_id)).error==='maintenance_affected_row_limit','actual cumulative affected-row cap');
checked(await scalar('SELECT value FROM public.fixture_maintenance WHERE id=1')==='after','row cap rolls back all mutation effects');
const rate=await create();await db.query("UPDATE public.sandy_api_rate_windows SET requests=60 WHERE actor_id=$1 AND bucket='principal'",[actor]);
checked((await run(rate.response.result.schedule_id)).error==='maintenance_principal_rate_limit','scheduled execution cannot evade global API request quota');
await db.query("UPDATE public.sandy_api_rate_windows SET requests=0 WHERE actor_id=$1 AND bucket='principal'",[actor]);
const max=await create({...args(),standing:{...standing(),max_runs:1}});checked((await run(max.response.result.schedule_id)).ok,'one-run bounded schedule executes once');
checked((await run(max.response.result.schedule_id)).error==='maintenance_schedule_paused','lifetime run limit deactivates schedule');
const badStanding=await create({...args(),standing:{...standing(),min_interval_seconds:1}});checked(badStanding.response.error==='maintenance_standing_plan_invalid','unbounded recurrence rates rejected');
// Reset only ephemeral fixture schedule activity to exercise independent caps.
await db.exec('UPDATE public.sandy_database_maintenance_schedules SET active=false;UPDATE cron.job SET active=false');
const pure=await create(args({sql:'SELECT id FROM public.fixture_maintenance ORDER BY id',max_affected_rows:1,verifications:[{sql:'SELECT true AS ok',expected_rows:[{ok:true}]}]}));
const queried=await run(pure.response.result.schedule_id);checked(queried.ok&&Number(queried.result.affected_rows)===0,'pure scheduled query executes with zero mutation count');
await db.exec('CREATE TABLE public.fixture_many(id int);INSERT INTO public.fixture_many SELECT * FROM generate_series(1,101)');
const many=await create(args({sql:'SELECT id FROM public.fixture_many',max_affected_rows:1,verifications:[{sql:'SELECT true AS ok',expected_rows:[{ok:true}]}]}));
checked((await run(many.response.result.schedule_id)).error==='maintenance_result_limit_or_sensitive','scheduled query result count is bounded');
const revokedProof=await create();await db.query("UPDATE public.sandy_deployment_jobs SET payload='{\"changed\":true}' WHERE id=(SELECT approval_id FROM public.sandy_api_execution_admissions WHERE id=$1)",[revokedProof.p.admission_id]);
checked((await run(revokedProof.response.result.schedule_id)).error==='maintenance_standing_authorization_expired_or_changed','changed source engineering job cannot retain standing authorization');
const corrupted=await admission('supabase.database.cron.jobs.create',args());corrupted.plan.sha256='b'.repeat(64);
checked((await rpc('sandy_api_maintenance_cron_upsert',corrupted)).error==='maintenance_standing_plan_invalid','compiled plan canonical digest checked at SQL boundary');
const lateTrigger=await create();await db.exec('CREATE FUNCTION public.fixture_late_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW;END $$;CREATE TRIGGER fixture_late_effect AFTER UPDATE ON public.fixture_maintenance FOR EACH ROW EXECUTE FUNCTION public.fixture_late_effect()');
checked((await run(lateTrigger.response.result.schedule_id)).error==='maintenance_hidden_relation_effect_refused','new trigger after scheduling is rechecked before each real execution');
await db.exec('DROP TRIGGER fixture_late_effect ON public.fixture_maintenance;DROP FUNCTION public.fixture_late_effect()');
await db.exec('CREATE TABLE public.fixture_child(extra int) INHERITS(public.fixture_maintenance)');
checked((await create()).response.error==='maintenance_hidden_relation_effect_refused','inheritance cannot hide child relation effects');
const nativeInherited=await admission('supabase.database.vacuum',{table:'fixture_maintenance'});checked((await rpc('sandy_api_maintenance_reserve',nativeInherited)).error==='maintenance_native_hidden_effect_refused','native maintenance rejects hidden inherited target traversal');
await db.exec('DROP TABLE public.fixture_child');
await db.exec('UPDATE public.sandy_database_maintenance_schedules SET active=false;UPDATE cron.job SET active=false');
for(let n=0;n<10;n++)checked((await create()).response.ok,'bounded actor schedule activation '+(n+1));
checked((await create()).response.error==='maintenance_actor_schedule_limit','actor cannot activate more than ten standing schedules');
const receiptSchedule=await admission('supabase.database.maintenance.receipt.get',{request_id:made.p.request_id});
const safeReceipt=(await rpc('sandy_api_maintenance_receipt',receiptSchedule)).result;
checked(safeReceipt.schedule_id===schedule&&!JSON.stringify(safeReceipt).includes('UPDATE')&&!JSON.stringify(safeReceipt).includes('parameters'),'schedule receipt never leaks SQL, arguments or owner proof');
for(const role of ['anon','authenticated','service_role']){
 checked(Number(await scalar(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'sandy_api_maintenance_%' AND has_function_privilege($1,p.oid,'EXECUTE')`,[role]))===0,`${role} cannot execute any maintenance helper`);
 checked(Number(await scalar(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'sandy_database_maintenance_%' AND has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE')`,[role]))===0,`${role} cannot read/write private maintenance ledgers`);
}
await assert.rejects(()=>db.query('UPDATE public.sandy_database_maintenance_schedule_versions SET label=\'changed\' WHERE schedule_id=$1',[schedule]),/maintenance_immutable_record/);checks++;
await assert.rejects(()=>db.exec("DELETE FROM public.sandy_api_audit_events"),/sandy_api_append_only_audit/);checks++;
checked(Number(await scalar("SELECT count(*) FROM public.sandy_api_audit_events WHERE provider_http_status IS NOT NULL"))===0,'native and scheduled proof never fabricate HTTP provider evidence');
await db.close();
console.log(`maintenance PostgreSQL/WASM component checks: ${checks} passed (ephemeral only; cron is an interface fixture; Auth and real pg_cron remain independently gated)`);
