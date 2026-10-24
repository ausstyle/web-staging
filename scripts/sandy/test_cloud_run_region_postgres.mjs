// Isolated PostgreSQL migration checks. Never contacts Supabase or providers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite }=await import(pathToFileURL(process.argv[2]).href);const db=new PGlite();let checks=0;
try {
 await db.exec('CREATE TABLE sandy_operation_registry(operation text PRIMARY KEY,handler text,input_schema jsonb,error_contract jsonb,api_exposed boolean,ai_exposed boolean,verified boolean);');
 const names=['gcp.cloud_run.services.list','gcp.cloud_run.services.get'];
 const hashes=['ad8434eb282fa18f82550223acd62a633daad0072af1dd8a5d10a79232dbe7a2','29606689e560dd6bf4e6b2fb056686de44497fa61778a394074d9d25b26a5f39'];
 const migration=await readFile(new URL('../../supabase/migrations/20261024002500_sandy_cloud_run_region_contracts.sql',import.meta.url),'utf8');
 const reset=async()=>{await db.exec('DELETE FROM sandy_operation_registry');for(let i=0;i<2;i++)await db.query("INSERT INTO sandy_operation_registry VALUES($1,'sandy-provider-operation-api','{}',$2,$3,$3,false)",[names[i],JSON.stringify({contract_sha256:hashes[i],preserved:'evidence'}),i===0]);};
 await reset();await db.exec(migration);const rows=(await db.query('SELECT * FROM sandy_operation_registry ORDER BY operation')).rows;
 assert.equal(rows.length,2);assert.equal(rows[0].api_exposed,false);assert.equal(rows[1].api_exposed,true);assert.equal(rows[0].ai_exposed,false);assert.equal(rows[1].ai_exposed,true);assert.ok(rows.every(r=>r.verified===false&&r.error_contract.preserved==='evidence'));checks++;
 assert.deepEqual(rows[1].input_schema.properties.region.enum,['europe-west1','europe-west8']);assert.ok(!rows[0].input_schema.properties.region);checks++;
 await assert.rejects(db.exec(migration),/cloud_run_contract_baseline_changed/);await db.exec('ROLLBACK');assert.deepEqual((await db.query('SELECT * FROM sandy_operation_registry ORDER BY operation')).rows,rows);checks++;
 for(const alteration of ["UPDATE sandy_operation_registry SET error_contract='{}' WHERE operation='gcp.cloud_run.services.get'","DELETE FROM sandy_operation_registry WHERE operation='gcp.cloud_run.services.get'","UPDATE sandy_operation_registry SET handler='unexpected'"]) {
  await reset();await db.exec(alteration);const before=(await db.query('SELECT * FROM sandy_operation_registry ORDER BY operation')).rows;
  await assert.rejects(db.exec(migration),/cloud_run_contract_baseline_changed/);await db.exec('ROLLBACK');assert.deepEqual((await db.query('SELECT * FROM sandy_operation_registry ORDER BY operation')).rows,before);checks++;
 }
 console.log(JSON.stringify({isolated_postgres_checks:checks,live_changes:false}));
}finally{await db.close();}
