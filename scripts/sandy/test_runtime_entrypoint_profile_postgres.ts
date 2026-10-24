/** Actual fixed-profile constraint and immutable receipt trigger in isolated PG. */
import {PGlite} from "npm:@electric-sql/pglite@0.3.14";
import assert from "node:assert/strict";
const old="3aadfb520f651e9a6807cbb24b5d4409fcfbb25fb69fe5d72036916e44db8679",current="f4f15732b13e21d9fbd76de8173aac71672e4a5a49e8d17baf0884abe967f796";
Deno.test("source repair preserves history but admits only exact current entrypoint for new v4 receipts",async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE sandy_agent_tasks(id uuid PRIMARY KEY,customer_id uuid,channel text,request_id text,status text);
 CREATE TABLE sandy_runtime_conversation_audit(id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,task_id uuid,customer_id uuid,channel text,request_id text,state text,source_runtime text,source_sha256 text,round int,selected_model text,provider_response_id text,response_sha256 text,error text,finished_at timestamptz);
 ALTER TABLE sandy_runtime_conversation_audit ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE ON sandy_runtime_conversation_audit TO service_role;
 CREATE TABLE sandy_operation_registry(operation text,handler text,api_exposed bool,ui_exposed bool,ai_exposed bool,verified bool,error_contract jsonb);
 INSERT INTO sandy_operation_registry VALUES('agent.runtime.conversation.respond','internal:agent.runtime.conversation.respond@1.0.0',false,false,false,false,'{"v4_profile":{"source_sha256":"${old}"}}');`);
 const original=await Deno.readTextFile('supabase/migrations/20261021010000_sandy_runtime_conversation.sql');
 await db.exec(original.slice(original.indexOf('CREATE FUNCTION public.sandy_runtime_conversation_receipt_guard()'),original.indexOf('REVOKE ALL ON FUNCTION public.sandy_runtime_conversation_receipt_guard()'))+`CREATE TRIGGER receipt_binding BEFORE INSERT OR UPDATE ON sandy_runtime_conversation_audit FOR EACH ROW EXECUTE FUNCTION sandy_runtime_conversation_receipt_guard();`);
 const profile=await Deno.readTextFile('supabase/migrations/20261021010010_sandy_runtime_conversation_v4.sql');
 await db.exec(profile.slice(profile.indexOf('ALTER TABLE public.sandy_runtime_conversation_audit ADD CONSTRAINT'),profile.indexOf('DO $guard$ BEGIN')));
 await db.exec(await Deno.readTextFile('supabase/migrations/20261024005000_sandy_runtime_model_receipt_metrics.sql'));
 const claim=async(runtime:string,source:string)=>{
  const id=crypto.randomUUID();await db.query("INSERT INTO sandy_agent_tasks VALUES($1::uuid,NULL,'web',$1::uuid::text,'running')",[id]);
  return db.query<{id:number}>("INSERT INTO sandy_runtime_conversation_audit(task_id,channel,request_id,state,source_runtime,source_sha256,round,selected_model) VALUES($1::uuid,'web',$1::uuid::text,'started',$2,$3,0,'fixture') RETURNING id",[id,runtime,source]);
 };
 const historical=await claim('sandy-agent-runtime-v4',old);
 await db.exec("UPDATE sandy_runtime_conversation_audit SET state='succeeded',provider_response_id='historical',response_sha256='historical',finished_at=now()");
 await assert.rejects(claim('sandy-agent-runtime-v4',current),/check constraint/);
 const oldRow=await db.query('SELECT * FROM sandy_runtime_conversation_audit WHERE id=$1',[historical.rows[0].id]);
 await db.exec(await Deno.readTextFile('supabase/migrations/20261024005100_sandy_runtime_entrypoint_source_profile.sql'));
 assert.deepEqual((await db.query('SELECT * FROM sandy_runtime_conversation_audit WHERE id=$1',[historical.rows[0].id])).rows,oldRow.rows);
 await assert.rejects(claim('sandy-agent-runtime-v4',old),/v4_new_receipt_entrypoint_source_required/);
 await assert.rejects(claim('sandy-agent-runtime-v4','a'.repeat(64)),/v4_new_receipt_entrypoint_source_required/);
 await assert.rejects(claim('sandy-agent-runtime-unreviewed',current),/check constraint/);
 await assert.rejects(claim('sandy-agent-runtime-v2',current),/check constraint/);
 const accepted=await claim('sandy-agent-runtime-v4',current);assert.equal(accepted.rows.length,1);
 await claim('sandy-agent-runtime-v2','d4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78');
 await claim('sandy-agent-runtime-v1-backup-r50','f4bfcd9191660fb4f2784d1e9d30151f204bee5eca096d49d02fa9fe330ab993');
 await assert.rejects(db.query("UPDATE sandy_runtime_conversation_audit SET source_sha256=$1 WHERE id=$2",[current,historical.rows[0].id]),/transition_denied/);
 const security=await db.query("SELECT relrowsecurity,has_table_privilege('authenticated',oid,'INSERT') customer_insert,has_table_privilege('anon',oid,'SELECT') anon_read FROM pg_class WHERE oid='sandy_runtime_conversation_audit'::regclass");
 assert.deepEqual(security.rows,[{relrowsecurity:true,customer_insert:false,anon_read:false}]);
 const states=await db.query("SELECT md5(pg_get_functiondef('sandy_runtime_conversation_receipt_guard()'::regprocedure)) guard_md5,md5(pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='sandy_runtime_conversation_fixed_source_profile'))) constraint_md5");
 console.log(JSON.stringify(states.rows[0]));
 }finally{await db.close();}
});
