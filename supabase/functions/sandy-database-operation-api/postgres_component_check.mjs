/** Local PostgreSQL/WASM COMPONENT tests. No cloud request, credential, Auth
 * session or production owner is created. Synthetic authorization rows exercise
 * the private database boundary only; HTTP identity remains independently gated.
 * Install @electric-sql/pglite@0.3.14 in a disposable directory, then set
 * SANDY_TEST_PGLITE_MODULE to its dist/index.js file URL if it differs below.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import(process.env.SANDY_TEST_PGLITE_MODULE ?? 'file:///tmp/sandy-pglite/node_modules/@electric-sql/pglite/dist/index.js');
const db = new PGlite();
const source = readFileSync(new URL('../../migrations/20261021005000_sandy_database_operation_contracts.sql', import.meta.url),'utf8');
const policy = readFileSync(new URL('../../migrations/20261020233000_sandy_api_access_audit.sql', import.meta.url),'utf8');
const deno = process.env.SANDY_TEST_DENO ?? '/workspace/.cloud-setup/toolchain/node_modules/.bin/deno';
const planUrl = new URL('./plan.ts',import.meta.url).href;
const contractUrl = new URL('./contracts.ts',import.meta.url).href;
const protocolUrl = new URL('../_shared/sandy_api_protocol.ts',import.meta.url).href;
const actor = randomUUID();
let checks=0;
const checked = (condition,message)=>{assert.ok(condition,message);checks++;};
const result = async(sql,params=[]) => (await db.query(sql,params)).rows;
const scalar = async(sql,params=[]) => Object.values((await result(sql,params))[0])[0];
await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA extensions;
 CREATE FUNCTION extensions.digest(value text,algorithm text) RETURNS bytea LANGUAGE SQL IMMUTABLE AS $$ SELECT pg_catalog.sha256(pg_catalog.convert_to(value,'UTF8')) $$;
 CREATE TABLE public.sandy_controller_admins(auth_user_id uuid PRIMARY KEY,role text,enabled boolean);
 CREATE TABLE public.sandy_engineering_changes(id uuid PRIMARY KEY,status text);
 CREATE TABLE public.sandy_deployment_jobs(id uuid PRIMARY KEY,requested_by uuid,provider text,operation text,target text,payload jsonb,approved_by uuid,approved_at timestamptz,engineering_change_id uuid,status text);
 CREATE TABLE public.sandy_operation_registry(operation text PRIMARY KEY,domain text,description text,permission_scope text,is_mutation boolean,input_schema jsonb,output_schema jsonb,handler text,api_exposed boolean,ui_exposed boolean,ai_exposed boolean,verified boolean,implementation_state text,source_repository text,source_path text,dependencies jsonb,retry_policy jsonb,rollback_policy jsonb,error_contract jsonb);
 CREATE TABLE public.sandy_api_execution_admissions(id uuid PRIMARY KEY,grant_id uuid,actor_id uuid,tenant_id uuid,operation text,request_id uuid,is_mutation boolean,credential_id uuid,input_sha256 text,contract_sha256 text,scope_sha256 text,registry_revision_sha256 text,declared_cost_units bigint,approval_id uuid,state text,expires_at timestamptz);
 CREATE TABLE public.sandy_api_mutation_approval_snapshots(job_id uuid PRIMARY KEY,actor_id uuid,engineering_change_id uuid,operation text,input_sha256 text,contract_sha256 text,scope_sha256 text,maximum_declared_cost_units bigint,job_fingerprint_sha256 text);
`);
await db.exec(policy.slice(policy.indexOf('CREATE FUNCTION public.sandy_api_current_owner('),policy.indexOf('CREATE FUNCTION public.sandy_api_audit_payload(')));
await db.exec(source);
await db.query('INSERT INTO public.sandy_controller_admins VALUES($1,\'owner\',true)',[actor]);
await db.exec(`CREATE TABLE public.fixture_table(id int PRIMARY KEY,value text);INSERT INTO public.fixture_table VALUES(1,'before'),(2,'second');
 CREATE TABLE public.fixture_audit(id int);
 CREATE FUNCTION public.fixture_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.fixture_audit VALUES(new.id);RETURN new;END $$;
 CREATE TRIGGER fixture_audit_change AFTER UPDATE ON public.fixture_table FOR EACH ROW EXECUTE FUNCTION public.fixture_audit_change();
 CREATE TABLE public.fixture_sensitive(id int,access_token text);INSERT INTO public.fixture_sensitive VALUES(1,'synthetic-never-echo');`);
async function compile(operation,args){
 const code=`import {compileDatabasePlan} from ${JSON.stringify(planUrl)};import {databaseOperations,databaseScope} from ${JSON.stringify(contractUrl)};import {argumentDigest,canonicalJson} from ${JSON.stringify(protocolUrl)};const x=JSON.parse(await new Response(Deno.stdin.readable).text());const op=databaseOperations[x.operation];console.log(JSON.stringify({operation:x.operation,arguments:x.args,arguments_canonical:canonicalJson(x.args),input_sha256:await argumentDigest(x.args),contract_sha256:op.contract_sha256,scope_sha256:await argumentDigest(databaseScope),plan:await compileDatabasePlan(x.operation,x.args)}));`;
 return JSON.parse(execFileSync(deno,['eval',code],{input:JSON.stringify({operation,args}),encoding:'utf8',env:{...process.env,DENO_DIR:'/workspace/.cloud-setup/deno-cache'}}));
}
async function admission(operation,args,principal=actor){
 const p=await compile(operation,args);p.actor_id=principal;p.tenant_id=null;p.credential_id=null;p.request_id=randomUUID();p.grant_id=randomUUID();p.admission_id=randomUUID();
 const engineering=randomUUID(),approval=randomUUID();
 await db.query('UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE operation=$1',[operation]);
 await db.query("INSERT INTO public.sandy_engineering_changes VALUES($1,'approved')",[engineering]);
 await db.query("INSERT INTO public.sandy_deployment_jobs VALUES($1,$2,'supabase',$3,'local_component','{}'::jsonb,$2,clock_timestamp(),$4,'running')",[approval,principal,operation,engineering]);
 const fingerprint=await scalar('SELECT public.sandy_api_job_fingerprint(j) FROM public.sandy_deployment_jobs j WHERE id=$1',[approval]);
 await db.query('INSERT INTO public.sandy_api_mutation_approval_snapshots VALUES($1,$2,$3,$4,$5,$6,$7,100,$8)',[approval,principal,engineering,operation,p.input_sha256,p.contract_sha256,p.scope_sha256,fingerprint]);
 const revision=await scalar('SELECT public.sandy_api_registry_revision($1)',[operation]);
 await db.query("INSERT INTO public.sandy_api_execution_admissions VALUES($1,$2,$3,NULL,$4,$5,$6,NULL,$7,$8,$9,$10,1,$11,'consumed',clock_timestamp()+interval '60 seconds')",[p.admission_id,p.grant_id,principal,operation,p.request_id,databaseMutation(operation),p.input_sha256,p.contract_sha256,p.scope_sha256,revision,approval]);
 if(operation==='supabase.sql.receipt.get')p.plan.statements[0].parameters.push(principal);
 return p;
}
function databaseMutation(operation){return !['supabase.sql.query','supabase.sql.receipt.get','supabase.db.diff','supabase.db.migrations.plan','supabase.db.migrations.verify','supabase.data.bulk_export'].includes(operation);}
async function execute(p,readOnly=false){
 await db.exec(readOnly?'BEGIN READ ONLY':'BEGIN');
 try{
  const refs=[...new Set((readOnly?p.plan.statements:[]).flatMap(s=>s.passive_relations??[]).filter(r=>r.schema==='public').map(r=>'"public"."'+r.name+'"'))].sort();
  if(refs.length)await db.exec('LOCK TABLE '+refs.join(',')+' IN ACCESS SHARE MODE');
  const observed=await scalar(`SELECT public.sandy_api_database_${readOnly?'read':'write'}($1::jsonb)`,[JSON.stringify(p)]);
  await db.exec(readOnly?'ROLLBACK':'COMMIT');
  return observed;
 }catch(error){await db.exec('ROLLBACK');throw error;}
}
const value="é'; SELECT net.http_post('outside.invalid');--";
const read=await admission('supabase.sql.query',{sql:'SELECT $1::text AS value',parameters:[{type:'text',value}],limit:10});
const observed=await execute(read,true);checked(observed.ok===true&&observed.read_only===true,'actual PostgreSQL read-only execution');checked(observed.statements[0].rows[0].value===value,'one real JSONB USING binding preserves Unicode/quotes');
const notReadOnly=await scalar('SELECT public.sandy_api_database_read($1::jsonb)',[JSON.stringify(read)]);checked(notReadOnly.error==='database_read_only_transport_required','read-only transport enforced by actual server');
const forged=structuredClone(read);forged.arguments_canonical='{}';checked((await execute(forged,true)).error==='database_argument_binding_mismatch','canonical argument proof checked');
const foreign=structuredClone(read);foreign.actor_id=randomUUID();checked((await execute(foreign,true)).error==='database_execution_grant_refused','actor cannot be rebound');
const verify={sql:'SELECT id,value FROM public.fixture_table WHERE id=$1::int4',parameters:[{type:'int4',value:1}],expected_rows:[{id:1,value:'after'}]};
const write=await admission('supabase.sql.execute',{sql:'UPDATE public.fixture_table SET value=$1::text WHERE id=$2::int4 RETURNING *; -- trailing fixture comment',parameters:[{type:'text',value:'after'},{type:'int4',value:1}],max_affected_rows:1,verification:verify});
const changed=await execute(write);checked(changed.ok===true&&changed.mutation_committed===true&&changed.verification_passed===true,'actual DML and postcondition commit together');checked(await scalar('SELECT value FROM public.fixture_table WHERE id=1')==='after','independent actual row readback');checked(Number(await scalar('SELECT count(*) FROM public.fixture_audit'))===1,'existing trigger ran once');
const replay=await execute(write);checked(replay.command_id===changed.command_id&&replay.receipt_reused===true,'stable receipt prevents duplicate command');checked(Number(await scalar('SELECT count(*) FROM public.fixture_audit'))===1,'replay did not rerun trigger');
const failure=await admission('supabase.sql.execute',{sql:"UPDATE public.fixture_table SET value='must_rollback' WHERE id=1 RETURNING *",max_affected_rows:1,verification:verify});
checked((await execute(failure)).error==='database_postcondition_failed','actual failed postcondition');checked(await scalar('SELECT value FROM public.fixture_table WHERE id=1')==='after','failed postcondition rolls back business effect');checked(Number(await scalar('SELECT count(*) FROM public.fixture_audit'))===1,'failed postcondition rolls back trigger effect');checked(Number(await scalar('SELECT count(*) FROM public.sandy_database_execution_receipts WHERE admission_id=$1',[failure.admission_id]))===0,'failed postcondition has no success receipt');
const cumulative=await admission('supabase.sql.transaction',{statements:[{sql:"UPDATE public.fixture_table SET value='first' WHERE id=1 RETURNING *"},{sql:"UPDATE public.fixture_table SET value='second_change' WHERE id=2 RETURNING *"}],max_affected_rows:1,verification:{sql:'SELECT true AS ok',expected_rows:[{ok:true}]}});
checked((await execute(cumulative)).error==='database_affected_row_limit','aggregate affected-row cap');checked(await scalar('SELECT value FROM public.fixture_table WHERE id=1')==='after','aggregate cap rolls back all statements');
const sensitive=await admission('supabase.sql.query',{sql:'SELECT * FROM public.fixture_sensitive'});const denied=await execute(sensitive,true);checked(denied.error==='database_sensitive_source_refused'&&!JSON.stringify(denied).includes('synthetic-never-echo'),'wildcard sensitive results fail closed without echo');
const precedence=await execute(await admission('supabase.sql.query',{sql:'SELECT 1 + 2 * 3 AS value'}),true);checked(precedence.ok===true&&precedence.statements[0].rows[0].value===7,'operator precedence survives compilation');
await db.exec(`CREATE FUNCTION public.fixture_overload(int4,text) RETURNS int4 LANGUAGE SQL IMMUTABLE AS $$ SELECT 999 $$;CREATE OPERATOR public.+ (FUNCTION=public.fixture_overload,LEFTARG=int4,RIGHTARG=text);CREATE TABLE public.fixture_api(id int,api_key text);INSERT INTO public.fixture_api VALUES(1,'synthetic-never-echo');`);
const overload=await execute(await admission('supabase.sql.query',{sql:"SELECT 1::int4 + '2'::text AS value"}),true);checked(overload.ok===false&&overload.error==='database_read_failed','pg_catalog-only resolution refuses a public operator overload');
for(const sql of ["SELECT row_to_json(t)::text AS safe FROM public.fixture_sensitive t", "SELECT to_jsonb(t) ->> $1 AS safe FROM public.fixture_sensitive t", "SELECT row_to_json(t)::text AS safe FROM public.fixture_api t"]){const args={sql};if(sql.includes('$1'))args.parameters=[{type:'text',value:'access_token'}];const x=await execute(await admission('supabase.sql.query',args),true);checked(x.error==='database_sensitive_source_refused'&&!JSON.stringify(x).includes('synthetic-never-echo'),'source credential columns refused before scalar serialization');}
const blockedSnapshot=await scalar('SELECT public.sandy_api_database_schema_snapshot()');
const storedSensitive=await admission('supabase.schema.materialized_views.create',{migration:{version:'20261021010100_local_sensitive',name:'Refused stored credential definition',expected_before_sha256:blockedSnapshot.sha256},name:'fixture_stored_sensitive',query:{sql:'SELECT row_to_json(t)::text AS safe FROM public.fixture_sensitive t'}});
const storedRefusal=await execute(storedSensitive);checked(storedRefusal.error==='database_sensitive_source_refused','materialized view cannot copy credential sources into aliased columns');checked(await scalar("SELECT to_regclass('public.fixture_stored_sensitive') IS NULL"),'refused stored definition leaves no relation or ledger');
const before=await scalar('SELECT public.sandy_api_database_schema_snapshot()');checked(before.possibly_truncated===false,'complete actual schema snapshot');
await db.exec('BEGIN;GRANT SELECT ON public.fixture_table TO authenticated;');const acl=await scalar('SELECT public.sandy_api_database_schema_snapshot()');await db.exec('ROLLBACK');checked(acl.sha256!==before.sha256,'ACL drift changes schema snapshot');
const migration={version:'20261021010101_local_fixture',name:'Local PostgreSQL component fixture',expected_before_sha256:before.sha256};
const createArgs={migration,name:'fixture_created',columns:[{name:'id',type:'text',nullable:false}],primary_key:['id']};
const create=await admission('supabase.schema.tables.create',createArgs);const created=await execute(create);checked(created.ok===true&&created.migration.reused===false,'versioned DDL applied with actual postcondition/ledger');checked(await scalar("SELECT to_regclass('public.fixture_created') IS NOT NULL"),'created object readback');
const createAgain=await admission('supabase.schema.tables.create',createArgs);const reused=await execute(createAgain);checked(reused.ok===true&&reused.migration.reused===true,'new approved request reuses same version/checksum without DDL replay');
const conflict=await admission('supabase.schema.tables.create',{...createArgs,name:'fixture_conflicting'});checked((await execute(conflict)).error==='database_migration_checksum_conflict','version checksum conflict refused');checked(await scalar("SELECT to_regclass('public.fixture_conflicting') IS NULL"),'checksum conflict creates no object');
const snapshot=await scalar('SELECT public.sandy_api_database_schema_snapshot()');
const repair=await admission('supabase.db.migrations.ledger.repair',{version:migration.version,expected_checksum:created.migration.checksum,replacement_checksum:'f'.repeat(64),expected_schema_sha256:snapshot.sha256,reason:'Local component reconciliation only',smoke_tests:[{sql:'SELECT count(*) AS count FROM public.fixture_created',expected_rows:[{count:0}]}]});
const repaired=await execute(repair);checked(repaired.ok===true&&repaired.migration.revision===2&&repaired.migration.repaired===true,'repair uses actual schema/postconditions and increments revision');checked(Number(await scalar('SELECT count(*) FROM public.sandy_database_migration_revisions'))===1,'repair preserves append-only prior checksum evidence');
await db.query("UPDATE public.sandy_api_execution_admissions SET state='unknown',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[write.admission_id]);
const reconciliation=await admission('supabase.sql.receipt.get',{source_request_id:write.request_id});const reconciled=await execute(reconciliation,true);checked(reconciled.ok===true&&reconciled.statements[0].rows[0].command_id===changed.command_id,'fresh read grant reconciles original expired/unknown command without dispatch');

const dataCases=[
 ['supabase.data.insert',{table:'fixture_table',rows:[{id:3,value:'inserted'}],max_affected_rows:1,verification:{sql:'SELECT id,value FROM public.fixture_table WHERE id=3',expected_rows:[{id:3,value:'inserted'}]}}],
 ['supabase.data.upsert',{table:'fixture_table',rows:[{id:3,value:'upserted'}],conflict_columns:['id'],max_affected_rows:1,verification:{sql:'SELECT id,value FROM public.fixture_table WHERE id=3',expected_rows:[{id:3,value:'upserted'}]}}],
 ['supabase.data.bulk_import',{table:'fixture_table',rows:[{id:4,value:'bulk4'},{id:5,value:'bulk5'}],max_affected_rows:2,verification:{sql:'SELECT id,value FROM public.fixture_table WHERE id>=4 ORDER BY id',expected_rows:[{id:4,value:'bulk4'},{id:5,value:'bulk5'}]}}],
 ['supabase.data.update',{table:'fixture_table',values:{value:'typed_update'},filters:[{column:'id',operator:'eq',value:{type:'int4',value:3}}],max_affected_rows:1,verification:{sql:'SELECT id,value FROM public.fixture_table WHERE id=3',expected_rows:[{id:3,value:'typed_update'}]}}],
 ['supabase.data.delete',{table:'fixture_table',filters:[{column:'id',operator:'eq',value:{type:'int4',value:3}}],max_affected_rows:1,verification:{sql:'SELECT count(*) AS count FROM public.fixture_table WHERE id=3',expected_rows:[{count:0}]}}],
];
for(const [operation,args] of dataCases){const p=await admission(operation,args);const observed=await execute(p);checked(observed.ok===true&&observed.verification_passed===true,`${operation} actual bound PostgreSQL execution`);}
const exported=await execute(await admission('supabase.data.bulk_export',{table:'fixture_table',columns:['id','value'],order_by:['id'],limit:100}),true);checked(exported.ok===true&&exported.statements[0].rows.length===4,'actual bounded typed export');
await db.exec('CREATE VIEW public.fixture_opaque_view AS SELECT * FROM public.fixture_table');
const opaque=await execute(await admission('supabase.sql.query',{sql:'SELECT * FROM public.fixture_opaque_view'}),true);checked(opaque.error==='database_passive_relation_required','view cannot hide an executable dependency in passive SQL');
const sensitiveWrite=await admission('supabase.sql.execute',{sql:'UPDATE public.fixture_sensitive SET id=2 WHERE id=1 RETURNING *',max_affected_rows:1,verification:{sql:'SELECT true AS ok',expected_rows:[{ok:true}]}});
const sensitiveFailure=await execute(sensitiveWrite);checked(sensitiveFailure.error==='database_sensitive_source_refused'&&!JSON.stringify(sensitiveFailure).includes('synthetic-never-echo'),'wildcard mutation result refuses credentials and rolls back');checked(Number(await scalar('SELECT id FROM public.fixture_sensitive'))===1,'sensitive result failure rolls back actual DML');
await db.exec(`CREATE TABLE public.fixture_large(id int PRIMARY KEY,value text);INSERT INTO public.fixture_large VALUES(1,repeat('x',600000));`);
const largeMutation=await admission('supabase.sql.execute',{sql:'UPDATE public.fixture_large SET id=2 WHERE id=1 RETURNING *',max_affected_rows:1,verification:{sql:'SELECT true AS ok',expected_rows:[{ok:true}]}});const largeRefusal=await execute(largeMutation);checked(largeRefusal.error==='database_result_size_limit','receipt size is bounded before commit');checked(Number(await scalar('SELECT id FROM public.fixture_large'))===1,'oversized receipt failure rolls back actual mutation');
const otherOwner=randomUUID();await db.query("INSERT INTO public.sandy_controller_admins VALUES($1,'owner',true)",[otherOwner]);
const foreignReceipt=await execute(await admission('supabase.sql.receipt.get',{source_request_id:write.request_id},otherOwner),true);checked(foreignReceipt.ok===true&&foreignReceipt.statements[0].rows.length===0,'a different owner cannot read the original private command receipt');
await db.exec('CREATE MATERIALIZED VIEW public.fixture_refresh AS SELECT id,value FROM public.fixture_table;INSERT INTO public.fixture_table VALUES(90,\'refresh_input\')');
await db.exec('BEGIN;SET LOCAL search_path=pg_catalog');const refreshDefinition=await scalar("SELECT pg_get_viewdef('public.fixture_refresh'::regclass,false)");await db.exec('ROLLBACK');
const refreshSnapshot=await scalar('SELECT public.sandy_api_database_schema_snapshot()');
const refreshMigration={version:'20261021010102_local_refresh',name:'Reviewed local refresh',expected_before_sha256:refreshSnapshot.sha256};
const refreshMismatch=await admission('supabase.schema.materialized_views.refresh',{migration:{...refreshMigration,version:'20261021010103_local_refusal'},name:'fixture_refresh',definition_sql:'SELECT 1 AS id'});checked((await execute(refreshMismatch)).error==='database_materialized_definition_changed','materialized refresh refuses a different actual definition');
const refresh=await admission('supabase.schema.materialized_views.refresh',{migration:refreshMigration,name:'fixture_refresh',definition_sql:refreshDefinition});const refreshed=await execute(refresh);checked(refreshed.ok===true&&refreshed.verification_passed===true,'reviewed source-locked materialized view refresh executes');checked(Number(await scalar('SELECT count(*) FROM public.fixture_refresh WHERE id=90'))===1,'materialized refresh has actual stored-row readback');
const refreshedAgain=await execute(await admission('supabase.schema.materialized_views.refresh',{migration:refreshMigration,name:'fixture_refresh',definition_sql:refreshDefinition}));checked(refreshedAgain.ok===true&&refreshedAgain.migration.reused===true&&Number(await scalar('SELECT count(*) FROM public.fixture_refresh WHERE id=90'))===1,'refresh migration replay preserves populated data');
await db.exec('CREATE INDEX fixture_alias_private ON public.sandy_controller_admins(enabled)');const protectedSnapshot=await scalar('SELECT public.sandy_api_database_schema_snapshot()');
const indexDrop=await admission('supabase.schema.indexes.drop',{migration:{version:'20261021010104_private_index',name:'Refused private-parent alias',expected_before_sha256:protectedSnapshot.sha256},name:'fixture_alias_private'});checked((await execute(indexDrop)).error==='database_protected_object_refused','innocent index alias cannot bypass protected parent');checked(await scalar("SELECT to_regclass('public.fixture_alias_private') IS NOT NULL"),'private-parent index remains intact');
const ambiguous=await admission('supabase.sql.execute',{sql:"UPDATE public.fixture_table SET value='ambiguous' WHERE id=1 RETURNING *",max_affected_rows:1,verification:{sql:'SELECT false AS ok,true AS ok',expected_rows:[{ok:true}]}});checked((await execute(ambiguous)).error==='database_duplicate_output_columns','duplicate verification names cannot manufacture success');checked(await scalar('SELECT value FROM public.fixture_table WHERE id=1')==='after','ambiguous verification rolls back business effect');
const stagedSnapshot=await scalar('SELECT public.sandy_api_database_schema_snapshot()');
const stagedArgs={migration:{version:'20261021010105_dependent',name:'CREATE then bound write with smoke',expected_before_sha256:stagedSnapshot.sha256},statements:[{sql:'CREATE TABLE public.fixture_dependent(id int PRIMARY KEY,value text)'},{sql:'INSERT INTO public.fixture_dependent(id,value) VALUES($1::int4,$2::text) RETURNING *',parameters:[{type:'int4',value:1},{type:'text',value:'dependent'}]}],smoke_tests:[{sql:'SELECT id,value FROM public.fixture_dependent',expected_rows:[{id:1,value:'dependent'}]}]};
const staged=await execute(await admission('supabase.db.migrations.transactional_apply',stagedArgs));checked(staged.ok===true&&staged.verification_passed===true,'dependent migration CREATE then INSERT then smoke executes in order');const stagedReplay=await execute(await admission('supabase.db.migrations.transactional_apply',stagedArgs));checked(stagedReplay.ok===true&&stagedReplay.migration.reused===true&&Number(await scalar('SELECT count(*) FROM public.fixture_dependent'))===1,'dependent migration new-admission replay skips CREATE and INSERT');
checked(await scalar("SELECT NOT has_function_privilege('authenticated','public.sandy_api_database_write(jsonb)','EXECUTE') AND NOT has_function_privilege('service_role','public.sandy_api_database_read(jsonb)','EXECUTE') AND NOT has_table_privilege('service_role','public.sandy_database_execution_receipts','SELECT')"),'private executor and durable receipt ACLs deny app/service sessions');
console.log(JSON.stringify({ok:true,test_type:'local_postgresql_component_only',checks,http_authentication_verified:false,cloud_requests:0,cloud_writes:0}));
await db.close();
