// Isolated PostgreSQL state-machine tests; no network, Auth or production writes.
// PGlite lacks pgcrypto: SHA-256 is PostgreSQL built-in, SHA-1 uses fixed Node
// test vectors. Production retains the existing pgcrypto digest implementation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite(); let checks = 0;
const actor='10000000-0000-4000-8000-000000000001', id='20000000-0000-4000-8000-000000000002', job='30000000-0000-4000-8000-000000000003';
const hash=(algorithm,b)=>createHash(algorithm).update(b).digest('hex');
const canonical=JSON.stringify({body:{content:'hello',encoding:'utf-8'}});
const bytes=Buffer.from('hello'), framed=Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes]);
const proof={version:1,kind:'github_blob',repository:'ausstyle/web-staging',blob_sha:hash('sha1',framed),byte_length:5,content_sha256:hash('sha256',bytes),read_http_status:200};
try {
await db.exec(`CREATE SCHEMA extensions; CREATE TABLE sha1_vectors(input bytea PRIMARY KEY,output bytea);
 CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE SQL AS $$ SELECT CASE WHEN $2='sha256' THEN sha256($1) WHEN $2='sha1' THEN (SELECT output FROM public.sha1_vectors WHERE input=$1) ELSE NULL END $$;
 CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE SQL AS $$ SELECT extensions.digest(convert_to($1,'UTF8'),$2) $$;
 CREATE TABLE sandy_api_execution_admissions(id uuid PRIMARY KEY, principal_kind text,tenant_id uuid,credential_id uuid,is_mutation boolean,operation text,actor_id uuid,approval_id uuid,input_sha256 text,provider_http_status integer,state text,effect_verification jsonb,result_sha256 text,finished_at timestamptz,request_id uuid,contract_sha256 text,scope_sha256 text);
 CREATE TABLE sandy_deployment_jobs(id uuid PRIMARY KEY,status text,approved_by text,requested_by text,finished_at timestamptz,updated_at timestamptz,result jsonb);
 CREATE TABLE sandy_engineering_execution_authorizations(job_id uuid,identity_user_id uuid,owner_authority_id uuid,request_id uuid,operation text,input_sha256 text,contract_sha256 text,scope_sha256 text);
 CREATE TABLE audit(phase text,outcome text);
 CREATE TABLE fixture_authority(owner_allowed boolean,policy_allowed boolean); INSERT INTO fixture_authority VALUES(true,true);
 CREATE FUNCTION sandy_api_current_owner(uuid) RETURNS boolean LANGUAGE SQL AS $$SELECT owner_allowed FROM public.fixture_authority$$;
 CREATE FUNCTION sandy_engineering_policy_job_authorized(uuid,text) RETURNS boolean LANGUAGE SQL AS $$SELECT policy_allowed FROM public.fixture_authority$$;
 CREATE FUNCTION sandy_api_append_audit(uuid,text,uuid,uuid,uuid,text,text,text,text,integer,text) RETURNS void LANGUAGE SQL AS $$ INSERT INTO public.audit VALUES($6,$7) $$;`);
await db.query('INSERT INTO sha1_vectors VALUES($1,$2)',[framed,Buffer.from(proof.blob_sha,'hex')]);
const old=await readFile(new URL('../../supabase/migrations/20261022046000_sandy_github_delete_recovery.sql',import.meta.url),'utf8');
const start=old.indexOf('CREATE OR REPLACE FUNCTION');const end=old.indexOf('CREATE OR REPLACE FUNCTION',start+1);
await db.exec(old.slice(start,end));
const migration=await readFile(new URL('../../supabase/migrations/20261024001000_sandy_github_blob_settlement.sql',import.meta.url),'utf8');
await db.exec("CREATE ROLE service_role; REVOKE ALL ON FUNCTION sandy_api_verify_github_mutation(uuid,text,jsonb) FROM PUBLIC; GRANT EXECUTE ON FUNCTION sandy_api_verify_github_mutation(uuid,text,jsonb) TO service_role;");
const aclBefore=(await db.query("SELECT proacl::text acl FROM pg_proc WHERE oid='sandy_api_verify_github_mutation(uuid,text,jsonb)'::regprocedure")).rows[0].acl;
await db.exec(migration);
assert.equal((await db.query("SELECT proacl::text acl FROM pg_proc WHERE oid='sandy_api_verify_github_mutation(uuid,text,jsonb)'::regprocedure")).rows[0].acl,aclBefore);checks++;
// Preserve a service-only ACL across replacement; migration contains no GRANT.
assert.equal(/\bGRANT\b/i.test(migration),false);checks++;
const treeMigration=await readFile(new URL('../../supabase/migrations/20261024013000_sandy_github_tree_settlement.sql',import.meta.url),'utf8');
await db.exec(treeMigration);
assert.equal((await db.query("SELECT proacl::text acl FROM pg_proc WHERE oid='sandy_api_verify_github_mutation(uuid,text,jsonb)'::regprocedure")).rows[0].acl,aclBefore);checks++;
assert.equal(/\bGRANT\b/i.test(treeMigration),false);checks++;
const args=JSON.stringify({body:{base_tree:'b'.repeat(40),tree:[{path:'a.txt',mode:'100644',type:'blob',sha:'c'.repeat(40)}]}});
const treeProof={version:1,kind:'github_tree',repository:'ausstyle/web-staging',tree_sha:'a'.repeat(40),base_tree_sha:'b'.repeat(40),input_sha256:hash('sha256',args),read_http_status:200};
const reset=async()=>{await db.exec('DELETE FROM audit;DELETE FROM sandy_api_execution_admissions;DELETE FROM sandy_deployment_jobs;UPDATE fixture_authority SET owner_allowed=true,policy_allowed=true;');
 await db.query(`INSERT INTO sandy_api_execution_admissions(id,principal_kind,is_mutation,operation,actor_id,approval_id,input_sha256,provider_http_status,state,result_sha256,request_id,contract_sha256,scope_sha256) VALUES($1,'auth_user',true,'github.git.trees.create',$2,$3,$4,201,'accepted','accepted-digest',$1,'contract','scope')`,[id,actor,job,hash('sha256',args)]);
 await db.query("INSERT INTO sandy_deployment_jobs(id,status) VALUES($1,'running')",[job]);};
const verify=async(p=treeProof,input=args)=>(await db.query('SELECT sandy_api_verify_github_mutation($1,$2,$3) result',[id,input,p])).rows[0].result;
const state=async()=>(await db.query('SELECT state FROM sandy_api_execution_admissions')).rows[0].state;
await reset();let r=await verify();assert.equal(r.ok,true);assert.equal(await state(),'succeeded');assert.equal((await db.query('SELECT count(*) n FROM audit')).rows[0].n,1);checks++;
r=await verify();assert.equal(r.reused,true);assert.equal((await db.query('SELECT count(*) n FROM audit')).rows[0].n,1);checks++;
for(const patch of [{tree_sha:'bad'},{base_tree_sha:null},{input_sha256:'0'.repeat(64)},{kind:'github_blob'},{repository:'foreign/repo'},{read_http_status:404},{extra:true}]){await reset();r=await verify({...treeProof,...patch});assert.equal(r.ok,false);assert.equal(await state(),'accepted');checks++;}
for(const sql of ["UPDATE fixture_authority SET owner_allowed=false","UPDATE fixture_authority SET policy_allowed=false","UPDATE sandy_api_execution_admissions SET tenant_id=id","UPDATE sandy_api_execution_admissions SET input_sha256='wrong'","UPDATE sandy_api_execution_admissions SET state='unknown'","UPDATE sandy_deployment_jobs SET status='failed'","UPDATE sandy_api_execution_admissions SET operation='github.git.blobs.create'"]){await reset();await db.exec(sql);r=await verify();assert.equal(r.ok,false);assert.equal((await db.query('SELECT count(*) n FROM audit')).rows[0].n,0);checks++;}
for(const body of [{tree:null},{tree:{bad:true}},{tree:[],base_tree:'bad'},{tree:Array.from({length:129},()=>({}))}]){await reset();const input=JSON.stringify({body});const digest=hash('sha256',input);await db.query('UPDATE sandy_api_execution_admissions SET input_sha256=$1',[digest]);r=await verify({...treeProof,input_sha256:digest},input);assert.equal(r.ok,false);checks++;}
await reset();await db.exec("CREATE FUNCTION deny_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER deny_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION deny_audit();");
await assert.rejects(verify(),/fixture audit failure/);assert.equal(await state(),'accepted');assert.equal((await db.query('SELECT status FROM sandy_deployment_jobs')).rows[0].status,'running');checks++;
await db.exec('DROP TRIGGER deny_audit ON audit');
await assert.rejects(db.exec(treeMigration),/github_tree_settlement_baseline_changed/);await db.exec('ROLLBACK');checks++;
console.log(JSON.stringify({postgres_state_machine_checks:checks,live_acceptance:false}));
}finally{await db.close();}
