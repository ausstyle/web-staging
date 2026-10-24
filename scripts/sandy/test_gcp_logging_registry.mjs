// Isolated registry installation; no production connection or activation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href), db=new PGlite();
try{
 await db.exec(`CREATE TABLE sandy_operation_registry(operation text PRIMARY KEY,domain text,description text,permission_scope text,is_mutation boolean,input_schema jsonb,output_schema jsonb,handler text,api_exposed boolean,ui_exposed boolean,ai_exposed boolean,verified boolean,implementation_state text,source_repository text,source_path text,dependencies jsonb,error_contract jsonb,retry_policy jsonb,rollback_policy jsonb); INSERT INTO sandy_operation_registry(operation,verified) VALUES('existing.operation',true);`);
 const sql=await readFile(new URL('../../supabase/migrations/20261024023000_sandy_gcp_logging_query_closed.sql',import.meta.url),'utf8');
 await db.exec(sql);const row=(await db.query("SELECT * FROM sandy_operation_registry WHERE operation='gcp.logging.query'")).rows[0];
 for(const k of ['is_mutation','api_exposed','ui_exposed','ai_exposed','verified'])assert.equal(row[k],false);
 assert.equal(row.error_contract.requires_approval,true);assert.equal(row.error_contract.runtime_provider_verified,false);
 assert.equal(row.implementation_state,'source_ready');assert.equal(row.handler,'sandy-provider-gap-api');
 assert.deepEqual(row.error_contract.requirement_ids,[67]);assert.equal(row.input_schema.additionalProperties,false);
 assert.equal((await db.query("SELECT verified FROM sandy_operation_registry WHERE operation='existing.operation'")).rows[0].verified,true);
 await assert.rejects(db.exec(sql),/duplicate key/);await db.exec('ROLLBACK');assert.equal((await db.query('SELECT count(*) n FROM sandy_operation_registry')).rows[0].n,2);
 console.log(JSON.stringify({isolated_registry_checks:14,production_changed:false}));
}finally{await db.close();}
