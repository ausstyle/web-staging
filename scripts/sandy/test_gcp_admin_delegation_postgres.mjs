// Isolated PostgreSQL policy/admission tests; never reaches a provider or real user.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const owner='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000002',session='30000000-0000-4000-8000-000000000003';
const policy={classes:{gcp:['metadata_read']},resources:{gcp:['elaborate-haven-511518-a5']},environments:['production'],declared_unit_budget:0};
let checks=0;
try {
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA extensions;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to($1,'UTF8')) $$;
CREATE TABLE auth.users(id uuid,email_confirmed_at timestamptz,is_anonymous boolean);
CREATE TABLE sandy_controller_admins(auth_user_id uuid,enabled boolean,role text);
INSERT INTO auth.users VALUES('${owner}',now(),false);
INSERT INTO sandy_controller_admins VALUES('${owner}',true,'owner');
CREATE FUNCTION sandy_api_current_owner(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${owner}'::uuid $$;
CREATE TABLE sandy_operation_registry(operation text PRIMARY KEY,handler text,api_exposed boolean,is_mutation boolean);
INSERT INTO sandy_operation_registry VALUES('engineering.preflight','sandy-engineering-control',true,false);
CREATE TABLE sandy_api_execution_admissions(id uuid DEFAULT gen_random_uuid(),grant_id uuid DEFAULT gen_random_uuid(),actor_id uuid,operation text,
request_id uuid,is_mutation boolean,input_sha256 text,contract_sha256 text,scope_sha256 text,registry_revision_sha256 text,declared_cost_units integer,
expires_at timestamptz,created_at timestamptz DEFAULT now(),state text DEFAULT 'admitted',consumed_at timestamptz,finished_at timestamptz,
provider_http_status integer,result_sha256 text,tenant_id uuid,credential_id uuid);
CREATE FUNCTION sandy_api_finish_execution(uuid,text,integer,text,text) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
 UPDATE public.sandy_api_execution_admissions SET state=$2 WHERE id=$1 AND state='consumed';
 IF NOT FOUND THEN RAISE EXCEPTION 'consume required'; END IF;RETURN jsonb_build_object('ok',true,'state',$2);END $$;
CREATE TABLE fixture_authority(enabled boolean,version integer,policy jsonb);
INSERT INTO fixture_authority VALUES(true,6,'${JSON.stringify(policy)}');
CREATE FUNCTION sandy_engineering_resolve_standing(uuid,uuid,integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('ok',enabled AND $1='${actor}'::uuid AND $2='${session}'::uuid AND $3=2,
 'identity_user_id',$1,'session_id',$2,'delegation_id','40000000-0000-4000-8000-000000000004','version',version,'policy',policy) FROM public.fixture_authority $$;
SELECT set_config('request.jwt.claim.role','service_role',false);`);
for(const path of ['supabase/migrations/20261022201500_sandy_gcp_admin_read_admission.sql','supabase/migrations/20261023001500_sandy_gcp_admin_delegated_read.sql']) await db.exec(await readFile(path,'utf8'));
await db.exec(await readFile('scripts/sandy/test_gcp_admin_read.sql','utf8'));checks++;
const authority=()=>db.query('SELECT sandy_gcp_admin_read_authority($1,$2,2) r',[actor,session]);
const admit=async()=> (await db.query('SELECT sandy_gcp_admin_read_admit($1,$2,2) r',[actor,session])).rows[0].r;
const claim=t=>db.query('SELECT sandy_gcp_admin_read_claim($1,$2,$3,$4,$5,2) r',[actor,t.admission_id,t.grant_id,t.request_id,session]);
await authority();checks++;
const ticket=await admit();
// A policy revision or revocation between admission and claim must stop dispatch.
await db.exec('UPDATE fixture_authority SET version=7');await assert.rejects(()=>claim(ticket));checks++;
await db.exec('UPDATE fixture_authority SET version=6,enabled=false');await assert.rejects(()=>claim(ticket));checks++;
await db.exec('UPDATE fixture_authority SET enabled=true');await claim(ticket);checks++;
await assert.rejects(()=>claim(ticket));checks++;
await assert.rejects(()=>db.query('SELECT sandy_gcp_admin_read_admit($1,$2,2)',[actor,crypto.randomUUID()]));checks++;
for(const patch of [{...policy,classes:{gcp:['guest_read']}},{...policy,resources:{gcp:['other-project']}},{...policy,environments:['test']},{...policy,declared_unit_budget:1}]){
 await db.query('UPDATE fixture_authority SET policy=$1',[JSON.stringify(patch)]);await assert.rejects(authority);checks++;
}
await db.query('UPDATE fixture_authority SET policy=$1',[JSON.stringify(policy)]);
await db.exec('SET ROLE authenticated');try{await assert.rejects(authority);checks++;}finally{await db.exec('RESET ROLE');}
console.log(JSON.stringify({isolated_database_checks:checks,provider_execution_verified:false}));
} finally { await db.close(); }
