// Isolated PostgreSQL authorization regression; no production customer/channel
// records or real Auth identities are created by this test.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.argv[2]);const db=new PGlite();let passed=0;
const actor='10000000-0000-4000-8000-000000000001';
const request='20000000-0000-4000-8000-000000000001';
const email='isolated-world-model@example.invalid';
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;CREATE SCHEMA extensions;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false,raw_app_meta_data jsonb DEFAULT '{}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
 CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256($1)$$;
 CREATE TABLE email_customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),display_name text,google_drive_folder_status text,updated_at timestamptz DEFAULT now());
 CREATE TABLE email_customer_addresses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid REFERENCES email_customers,email_address text,is_primary boolean,verified_at timestamptz,normalized_email text GENERATED ALWAYS AS(lower(btrim(email_address))) STORED UNIQUE);
 CREATE TABLE sandy_memory_portal_accounts(auth_user_id uuid PRIMARY KEY REFERENCES auth.users,customer_id uuid UNIQUE REFERENCES email_customers,revoked_at timestamptz);
 CREATE TABLE sandy_memory_settings(customer_id uuid PRIMARY KEY REFERENCES email_customers,learning_enabled boolean,proactive_enabled boolean);
 CREATE TABLE sandy_whatsapp_identities(wa_id text PRIMARY KEY,customer_id uuid,verification_status text,verified_at timestamptz);
 `);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261021130000_sandy_customer_onboarding.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('./fixtures/customer_onboarding_v10.sql',import.meta.url),'utf8'));
 await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",[actor,email]);
 await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,role:'authenticated'})]);
 const call=async(op='customer.onboarding.ensure',args={display_name:'Isolated receipt scope'},rid=request)=>(await db.query('SELECT sandy_customer_onboarding_execute($1,$2,$3) value',[op,JSON.stringify(args),rid])).rows[0].value;
 const original=await call();assert.equal(original.created,true);const customer=original.customer_id;passed++;
 assert.equal((await call()).reused,true);passed++;
 const before=(await db.query("SELECT oid::text,proacl::text acl,prosecdef,proconfig,encode(sha256(convert_to(prosrc,'UTF8')),'hex') source FROM pg_proc WHERE oid='sandy_customer_onboarding_execute(text,jsonb,uuid)'::regprocedure")).rows[0];
 assert.equal(before.source,'02703d0659ee09dd482b174e2f1480cf3b66535e8686e42230325981b662fe8a');passed++;
 const ledger=async()=>(await db.query("SELECT encode(sha256(convert_to(result::text,'UTF8')),'hex') sha FROM sandy_customer_onboarding_receipts WHERE actor_id=$1 AND request_id=$2",[actor,request])).rows[0].sha;
 const immutable=await ledger();
 await db.query('DELETE FROM sandy_memory_portal_accounts WHERE auth_user_id=$1',[actor]);
 assert.equal((await call()).customer_id,customer);passed++; // Reproduce deployed stale authorization.
 await db.query('INSERT INTO sandy_memory_portal_accounts VALUES($1,$2,NULL)',[actor,customer]);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261024004400_sandy_onboarding_receipt_scope.sql',import.meta.url),'utf8'));
 const after=(await db.query("SELECT oid::text,proacl::text acl,prosecdef,proconfig,encode(sha256(convert_to(prosrc,'UTF8')),'hex') source FROM pg_proc WHERE oid='sandy_customer_onboarding_execute(text,jsonb,uuid)'::regprocedure")).rows[0];
 for(const key of ['oid','acl','prosecdef','proconfig'])assert.deepEqual(after[key],before[key]);passed++;
 assert.equal((await call()).customer_id,customer);assert.equal((await call()).reused,true);passed++;
 await db.query('DELETE FROM sandy_memory_portal_accounts WHERE auth_user_id=$1',[actor]);
 const absent=await call();assert.equal(absent.error,'onboarding_required');assert.equal(absent.http_status,409);assert.ok(!JSON.stringify(absent).includes(customer));passed++;
 assert.equal(await ledger(),immutable);passed++;
 assert.equal((await db.query('SELECT count(*)::int n FROM email_customers')).rows[0].n,1);passed++;
 const recover=await call('customer.onboarding.ensure',{display_name:'Isolated receipt scope'},'20000000-0000-4000-8000-000000000003');assert.equal(recover.customer_id,customer);assert.equal(recover.created,false);passed++;
 assert.equal(await ledger(),immutable);passed++;
 await db.query('DELETE FROM sandy_memory_portal_accounts WHERE auth_user_id=$1',[actor]);
 // Simulate an independently changed current binding ONLY inside this isolated
 // database. No account/customer merge or verified channel is performed live.
 const second=(await db.query("INSERT INTO email_customers(display_name,google_drive_folder_status) VALUES('Other isolated tenant','excluded') RETURNING id")).rows[0].id;
 await db.query('UPDATE email_customer_addresses SET customer_id=$1 WHERE normalized_email=$2',[second,email]);
 await db.query('INSERT INTO sandy_memory_portal_accounts VALUES($1,$2,NULL)',[actor,second]);
 const replaced=await call();assert.equal(replaced.error,'identity_link_conflict');assert.ok(!JSON.stringify(replaced).includes(customer));passed++;
 assert.equal(await ledger(),immutable);passed++;
 const fresh=await call('customer.identity.get',{},'20000000-0000-4000-8000-000000000002');assert.equal(fresh.customer_id,second);assert.equal(fresh.memory_customer_id,second);passed++;
 await db.query('UPDATE sandy_memory_portal_accounts SET revoked_at=now() WHERE auth_user_id=$1',[actor]);
 assert.equal((await call()).error,'customer_access_revoked');passed++;
 await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,role:'service_role'})]);
 assert.equal((await call()).error,'user_session_required');passed++;
 const newActor='10000000-0000-4000-8000-000000000002';
 await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[newActor,'fresh-world-model@example.invalid']);
 await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:newActor,role:'authenticated'})]);
 const createdAfterFix=await call('customer.onboarding.ensure',{display_name:'Fresh isolated receipt scope'},'20000000-0000-4000-8000-000000000004');assert.equal(createdAfterFix.created,true);assert.notEqual(createdAfterFix.customer_id,customer);assert.notEqual(createdAfterFix.customer_id,second);passed++;
 const acl=(await db.query("SELECT has_function_privilege('anon','sandy_customer_onboarding_execute(text,jsonb,uuid)','EXECUTE') anon,has_function_privilege('service_role','sandy_customer_onboarding_execute(text,jsonb,uuid)','EXECUTE') service,has_function_privilege('authenticated','sandy_customer_onboarding_execute(text,jsonb,uuid)','EXECUTE') customer")).rows[0];assert.deepEqual(acl,{anon:false,service:false,customer:true});passed++;
 await assert.rejects(db.exec(await readFile(new URL('../../supabase/migrations/20261024004400_sandy_onboarding_receipt_scope.sql',import.meta.url),'utf8')),/reviewed onboarding receipt source preimage required/);passed++;
 console.log(JSON.stringify({test_class:'isolated_PostgreSQL_identity_receipt_scope',passed,production_database_used:false,verified_channel_records_created:0,new_stores:0,source_before:before.source,source_after:after.source}));
}finally{await db.close();}
