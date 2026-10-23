/** Isolated PostgreSQL fixture. No real Auth, provider or customer state. */
import {PGlite} from "npm:@electric-sql/pglite@0.3.14";
import assert from "node:assert/strict";
import {receiptModelMetrics} from "../../supabase/functions/_shared/sandy-agent-operations/runtime_model_metrics.ts";
Deno.test("model telemetry extends terminal receipts while preserving immutable scope and initial claim",async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE sandy_agent_tasks(id uuid PRIMARY KEY,customer_id uuid,channel text,request_id text,status text);
 CREATE TABLE sandy_runtime_conversation_audit(id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,task_id uuid,customer_id uuid,channel text,request_id text,state text,source_runtime text,source_sha256 text,round int,selected_model text,provider_response_id text,response_sha256 text,error text,finished_at timestamptz);
 ALTER TABLE sandy_runtime_conversation_audit ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE ON sandy_runtime_conversation_audit TO service_role;
 GRANT USAGE ON SEQUENCE sandy_runtime_conversation_audit_id_seq TO service_role;
 INSERT INTO sandy_agent_tasks VALUES('10000000-0000-4000-8000-000000000001',NULL,'web','fixture-request','running');`);
 const original=await Deno.readTextFile('supabase/migrations/20261021010000_sandy_runtime_conversation.sql');
 const definition=original.slice(original.indexOf('CREATE FUNCTION public.sandy_runtime_conversation_receipt_guard()'),original.indexOf('REVOKE ALL ON FUNCTION public.sandy_runtime_conversation_receipt_guard()'));
 await db.exec(definition+`CREATE TRIGGER receipt_binding BEFORE INSERT OR UPDATE ON sandy_runtime_conversation_audit FOR EACH ROW EXECUTE FUNCTION sandy_runtime_conversation_receipt_guard();`);
 const migration=await Deno.readTextFile('supabase/migrations/20261024005000_sandy_runtime_model_receipt_metrics.sql');
 await db.exec(migration);
 const metrics=receiptModelMetrics({model:'fixture-model',usage:{input_tokens:100,output_tokens:5,total_tokens:105,input_tokens_details:{cached_tokens:0}}},Date.parse('2026-10-24T12:00:00Z'),Date.parse('2026-10-24T12:00:01Z'));
 const insert=`INSERT INTO sandy_runtime_conversation_audit(task_id,customer_id,channel,request_id,state,source_runtime,source_sha256,round,selected_model,model_metrics) VALUES('10000000-0000-4000-8000-000000000001',NULL,'web','fixture-request','started','fixture-runtime','fixture-source',0,'fixture-model',$1)`;
 await assert.rejects(db.query(insert,[metrics]),/started_claim_required/);
 await db.query(insert,[null]);
 await assert.rejects(db.query(`UPDATE sandy_runtime_conversation_audit SET state='succeeded',provider_response_id='fixture',response_sha256='fixture',finished_at=now(),model_metrics=$1,selected_model='wrong-model'`,[metrics]),/scope_immutable/);
 await assert.rejects(db.query(`UPDATE sandy_runtime_conversation_audit SET state='succeeded',provider_response_id='fixture',response_sha256='fixture',finished_at=now(),model_metrics=$1`,[{...metrics,provider_effect_verified:true}]),/check constraint/);
 await assert.rejects(db.query(`UPDATE sandy_runtime_conversation_audit SET state='succeeded',provider_response_id='fixture',response_sha256='fixture',finished_at=now(),model_metrics=$1`,[{...metrics,schema_version:null}]),/check constraint/);
 await db.query(`UPDATE sandy_runtime_conversation_audit SET state='succeeded',provider_response_id='fixture',response_sha256='fixture',finished_at=now(),model_metrics=$1`,[metrics]);
 await assert.rejects(db.query(`UPDATE sandy_runtime_conversation_audit SET model_metrics=NULL`),/transition_denied/);
 const rows=await db.query(`SELECT model_metrics->>'cost_basis' AS basis,model_metrics->'usage'->>'input_tokens' AS tokens FROM sandy_runtime_conversation_audit`);
 assert.deepEqual(rows.rows,[{basis:'unavailable_exact_fresh_rate',tokens:'100'}]);
 const acl=await db.query(`SELECT has_table_privilege('authenticated','public.sandy_runtime_conversation_audit','SELECT') AS readable,has_column_privilege('anon','public.sandy_runtime_conversation_audit','model_metrics','UPDATE') AS writable`);
 assert.deepEqual(acl.rows,[{readable:false,writable:false}]);
 }finally{await db.close();}
});
