// Executes the actual Python executor's emitted SQL, never a live database.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);const db=new PGlite();let checks=0;
const names=['gcp.cloud_run.services.get','gcp.cloud_run.services.list'];
const hashes=['29606689e560dd6bf4e6b2fb056686de44497fa61778a394074d9d25b26a5f39','ad8434eb282fa18f82550223acd62a633daad0072af1dd8a5d10a79232dbe7a2'];
const prior=names.map((operation,i)=>({operation,input_schema:{properties:{}},error_contract:{contract_sha256:hashes[i],preserve:'historical'}}));
function sql(rows,rollback=false){const p=spawnSync('python3',['scripts/sandy/hosting_read_sql_fixture.py'],{input:JSON.stringify({rows,prior,rollback}),encoding:'utf8'});assert.equal(p.status,0,p.stderr);return p.stdout;}
try{
 await db.exec(`CREATE TABLE sandy_operation_registry(operation text PRIMARY KEY,handler text,input_schema jsonb,error_contract jsonb,api_exposed boolean DEFAULT false,verified boolean DEFAULT false);
 CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text,created_by text,idempotency_key text);
 CREATE TABLE sandy_engineering_change_events(change_id uuid,event_type text,actor uuid,detail jsonb);`);
 for(const r of prior)await db.query("INSERT INTO sandy_operation_registry(operation,handler,input_schema,error_contract) VALUES($1,'sandy-provider-operation-api',$2,$3)",[r.operation,r.input_schema,r.error_contract]);
 const read=async()=> (await db.query('SELECT operation,input_schema,error_contract FROM sandy_operation_registry ORDER BY operation')).rows;
 const forward=sql(prior);
 // Alteration between the reader and transaction must abort all effects.
 await db.query("UPDATE sandy_operation_registry SET error_contract=error_contract || '{\"concurrent\":true}' WHERE operation=$1",[names[1]]);
 await assert.rejects(db.exec(forward),/contract preimage changed/);await db.exec('ROLLBACK');assert.equal((await db.query('SELECT * FROM supabase_migrations.schema_migrations')).rows.length,0);assert.equal((await db.query('SELECT * FROM sandy_engineering_change_events')).rows.length,0);checks++;
 await db.query('UPDATE sandy_operation_registry SET error_contract=$1 WHERE operation=$2',[prior[1].error_contract,names[1]]);
 await db.exec(forward);const installed=await read();assert.equal((await db.query('SELECT * FROM supabase_migrations.schema_migrations')).rows.length,1);assert.equal((await db.query('SELECT * FROM sandy_engineering_change_events')).rows.length,1);checks++;
 // A second forward cannot reapply or erase the first receipt.
 await assert.rejects(db.exec(forward),/contract preimage changed/);await db.exec('ROLLBACK');assert.deepEqual(await read(),installed);checks++;
 const reverse=sql(installed,true);await db.exec(reverse);assert.deepEqual(await read(),prior);assert.equal((await db.query('SELECT * FROM supabase_migrations.schema_migrations')).rows.length,1);assert.equal((await db.query('SELECT * FROM sandy_engineering_change_events')).rows.length,2);checks++;
 assert.ok((await db.query('SELECT api_exposed,verified FROM sandy_operation_registry')).rows.every(r=>!r.api_exposed&&!r.verified));checks++;
 // A failure recording the receipt must roll back both contract updates.
 await db.exec('DELETE FROM supabase_migrations.schema_migrations;ALTER TABLE sandy_engineering_change_events ADD CONSTRAINT reject_new CHECK(false) NOT VALID;');
 await assert.rejects(db.exec(forward),/reject_new/);await db.exec('ROLLBACK');assert.deepEqual(await read(),prior);assert.equal((await db.query('SELECT * FROM supabase_migrations.schema_migrations')).rows.length,0);checks++;
 // Exercise the real Owner predicate on synthetic rows, including its exact
 // targets, source/manifest, non-test identity, enabled role and 24h expiry.
 await db.exec(`ALTER TABLE sandy_engineering_change_events DROP CONSTRAINT reject_new;ALTER TABLE sandy_engineering_change_events ADD COLUMN occurred_at timestamptz DEFAULT now();
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb);
 CREATE TABLE sandy_controller_admins(auth_user_id uuid,enabled boolean,role text);
 CREATE TABLE sandy_engineering_changes(id uuid PRIMARY KEY,status text,risk text,scope jsonb,expected_behavior text);`);
 const ownerRun=spawnSync('python3',['scripts/sandy/hosting_read_sql_fixture.py'],{input:JSON.stringify({kind:'owner'}),encoding:'utf8'});assert.equal(ownerRun.status,0,ownerRun.stderr);const gate=JSON.parse(ownerRun.stdout);
 const actor='22222222-2222-4222-8222-222222222222',change='11111111-1111-4111-8111-111111111111';
 await db.query("INSERT INTO auth.users VALUES($1,'{}')",[actor]);await db.query("INSERT INTO sandy_controller_admins VALUES($1,true,'owner')",[actor]);
 await db.query("INSERT INTO sandy_engineering_changes VALUES($1,'approved','normal',$2,$3)",[change,gate.targets,gate.source+' '+gate.manifest+' executor_sha256='+gate.executor]);
 await db.query("INSERT INTO sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES($1,'status_changed',$2,$3)",[change,actor,{to:'approved',reason:gate.source+' '+gate.manifest+' executor_sha256='+gate.executor+' bounded source and contract rollback'}]);
 const admitted=async()=> (await db.query(gate.query)).rows[0].admitted;
 assert.equal(await admitted(),true);checks++;
 for(const [changeSql,restoreSql] of [
  ["UPDATE sandy_controller_admins SET role='controller'","UPDATE sandy_controller_admins SET role='owner'"],
  ["UPDATE sandy_controller_admins SET enabled=false","UPDATE sandy_controller_admins SET enabled=true"],
  ["UPDATE auth.users SET raw_app_meta_data='{\"sandy_engineering_test\":true}'","UPDATE auth.users SET raw_app_meta_data='{}'"],
  ["UPDATE sandy_engineering_changes SET scope='[]'",null],
  ["UPDATE sandy_engineering_change_events SET occurred_at=now()-interval '25 hours'","UPDATE sandy_engineering_change_events SET occurred_at=now()"],
  ["UPDATE sandy_engineering_changes SET status='proposed'","UPDATE sandy_engineering_changes SET status='approved'"]
 ]){await db.exec(changeSql);assert.equal(await admitted(),false);if(restoreSql)await db.exec(restoreSql);else await db.query('UPDATE sandy_engineering_changes SET scope=$1',[gate.targets]);checks++;}
 console.log(JSON.stringify({isolated_postgres_checks:checks,live_changes:false}));
}finally{await db.close();}
