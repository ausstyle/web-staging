import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runCustomerMutationTests} from './test_customer_mutation_certification_postgres.mjs';
await runCustomerMutationTests(async ({db,mutate,cases,foreign})=>{
 const read=path=>readFile(new URL(path,import.meta.url),'utf8');
 await db.exec(await read('./fixtures/task_company_guard_live.sql'));
 const acl=async()=> (await db.query("SELECT oid,proacl,prosecdef,proowner FROM pg_proc WHERE oid IN ('public.sandy_api_customer_mutation(text,jsonb,text)'::regprocedure,'public.sandy_agenda_task_company_guard()'::regprocedure) ORDER BY oid")).rows;
 const before=await acl();
 await db.exec('SET ROLE authenticated');
 await assert.rejects(mutate(...cases[0]),e=>e.code==='42501');
 await db.exec('RESET ROLE');
 assert.equal((await db.query("SELECT count(*)::int n FROM sandy_customer_mutation_receipts WHERE operation='tasks.create'")).rows[0].n,0);
 await db.exec(await read('../../supabase/migrations/20261024022000_sandy_customer_task_guard_commit.sql'));
 assert.deepEqual(await acl(),before);
 assert.equal((await db.query("SELECT has_table_privilege('authenticated','sandy_tasks','SELECT') allowed")).rows[0].allowed,false);
 await db.exec('BEGIN; SET LOCAL ROLE authenticated');
 const rolledBack=await mutate(...cases[0]);assert.equal(rolledBack.ok,true);
 await db.exec('ROLLBACK');
 assert.equal((await db.query('SELECT count(*)::int n FROM sandy_tasks WHERE id=$1',[rolledBack.item.id])).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM sandy_customer_mutation_receipts WHERE mutation_id=$1',[rolledBack.mutation_id])).rows[0].n,0);
 // Simulate a competing BEFORE trigger changing a reference after the RPC's
 // prevalidation. The original deferred guard must still reject and roll back.
 await db.exec(`CREATE FUNCTION corrupt_guard_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.parent_task_id:='99999999-9999-4999-8999-999999999999';RETURN NEW;END$$;
 CREATE TRIGGER corrupt_guard_fixture BEFORE INSERT ON sandy_tasks FOR EACH ROW EXECUTE FUNCTION corrupt_guard_fixture(); SET ROLE authenticated;`);
 const rejected=await mutate(...cases[0]);assert.equal(rejected.ok,false);assert.equal(rejected.error,'Parent task must belong to your Sandy account');
 await db.exec('RESET ROLE; DROP TRIGGER corrupt_guard_fixture ON sandy_tasks; DROP FUNCTION corrupt_guard_fixture()');
 assert.equal((await db.query("SELECT count(*)::int n FROM sandy_tasks WHERE parent_task_id='99999999-9999-4999-8999-999999999999'")).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM sandy_customer_mutation_receipts WHERE operation='tasks.create'")).rows[0].n,0);
 await db.exec('SET ROLE authenticated');
 const denied=await mutate("tasks.create",{...cases[0][1],parent_task_id:foreign});
 assert.equal(denied.ok,false);
 assert.equal(denied.error,"operation_requires_live_verification");
 for(const [op,args] of cases){
  const result=await mutate(op,args);assert.equal(result.ok,true,op+JSON.stringify(result));
  const replay=await mutate(op,args);assert.equal(replay.reused,true);assert.equal(replay.mutation_id,result.mutation_id);
 }
 await assert.rejects(db.query('SELECT * FROM sandy_tasks'),e=>e.code==='42501');
 await db.exec('RESET ROLE');
 assert.equal((await db.query("SELECT count(*)::int n FROM sandy_customer_mutation_receipts WHERE operation IN ('tasks.create','tasks.update','tasks.complete','tasks.archive')")).rows[0].n,4);
 const repaired=(await db.query("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha FROM pg_proc WHERE oid='public.sandy_api_customer_mutation(text,jsonb,text)'::regprocedure")).rows[0].sha;
 console.log(JSON.stringify({repaired_rpc_sha256:repaired,deferred_commit_denial_reproduced:true,ten_operations_as_authenticated:true,receipt_replay:true,table_access_still_denied:true,function_authority_unchanged:true,production_used:false}));
});
