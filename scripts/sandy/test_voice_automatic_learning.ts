/** Isolated PostgreSQL with synthetic transcripts only. No live Auth, customer
 * transcript, provider, message or model call is used. Shared05500 is not copied. */
import assert from "node:assert/strict";
import {PGlite} from "npm:@electric-sql/pglite@0.3.14";
const customer="51000000-0000-4000-8000-000000000001",other="51000000-0000-4000-8000-000000000002",session="52000000-0000-4000-8000-000000000001",link="53000000-0000-4000-8000-000000000001";
Deno.test("automatic voice persistence requires current consent/source epoch and commits all derived records atomically",async()=>{
 const db=new PGlite();let passed=0;
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE TABLE sandy_memory_settings(customer_id uuid PRIMARY KEY,enabled boolean,learning_enabled boolean,consent_at timestamptz,updated_at timestamptz);
   CREATE TABLE sandy_voice_call_links(id uuid PRIMARY KEY,owner_customer_id uuid,revoked_at timestamptz,expires_at timestamptz);
   CREATE TABLE sandy_voice_call_sessions(id uuid PRIMARY KEY,owner_customer_id uuid,link_id uuid,created_at timestamptz,state text,review_status text,ended_at timestamptz);
   CREATE TABLE sandy_voice_private_auth(session_id uuid PRIMARY KEY,owner_customer_id uuid,verified_at timestamptz,expires_at timestamptz);
   CREATE TABLE sandy_voice_transcript_turns(id integer PRIMARY KEY,session_id uuid,owner_customer_id uuid,role text,text text,created_at timestamptz);
   CREATE TABLE email_ai_profile_facts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,category text,fact_key text,fact_value text,confidence text,status text,last_observed_at timestamptz,created_at timestamptz DEFAULT clock_timestamp(),supersedes_fact_id uuid);
   CREATE TABLE sandy_voice_memory_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid UNIQUE,owner_customer_id uuid,status text,summary text,candidates jsonb,committed_count integer,model text,error_code text,created_at timestamptz DEFAULT clock_timestamp(),completed_at timestamptz);
   CREATE TABLE sandy_voice_memory_facts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),review_id uuid,owner_customer_id uuid,fact_key text,fact_value text,category text,decision text,rationale text,saved_profile_fact_id uuid,UNIQUE(review_id,fact_key));
   INSERT INTO sandy_memory_settings VALUES('${customer}',true,true,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours');
   INSERT INTO sandy_voice_call_links VALUES('${link}','${customer}',NULL,clock_timestamp()+interval '1 hour');
   INSERT INTO sandy_voice_call_sessions VALUES('${session}','${customer}','${link}',clock_timestamp()-interval '1 hour','active',NULL,NULL);
   INSERT INTO sandy_voice_private_auth VALUES('${session}','${customer}',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour');
   INSERT INTO sandy_voice_transcript_turns VALUES(1,'${session}','${customer}','user','I like ordinary fixture coffee',clock_timestamp()-interval '30 minutes'),(2,'${session}','${other}','user','I own a foreign private fixture',clock_timestamp()-interval '30 minutes');
   INSERT INTO sandy_voice_memory_reviews(session_id,owner_customer_id,status)VALUES('${session}','${customer}','processing');`);
  const dependency=Deno.args[0];
  const shared=await Deno.readTextFile(dependency?dependency+"/supabase/migrations/20261024005500_sandy_automatic_memory_learning_consent.sql":new URL("../../supabase/migrations/20261024005500_sandy_automatic_memory_learning_consent.sql",import.meta.url));
  const helper=shared.slice(shared.indexOf("CREATE FUNCTION public.sandy_automatic_memory_learning_allowed"),shared.indexOf("CREATE FUNCTION public.sandy_whatsapp_automatic_memory_owner"));
  const fixture=await Deno.readTextFile(dependency?dependency+"/scripts/sandy/fixtures/automatic_memory_writers_v20.sql":new URL("./fixtures/automatic_memory_writers_v20.sql",import.meta.url));
  await db.exec(fixture.slice(fixture.indexOf("CREATE OR REPLACE FUNCTION public.sandy_voice_save_explicit_memory"),fixture.indexOf("CREATE OR REPLACE FUNCTION public.sandy_whatsapp_contact_capture")));
  await db.exec("REVOKE ALL ON FUNCTION sandy_voice_save_explicit_memory(uuid,text,text)FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION sandy_voice_save_explicit_memory(uuid,text,text)TO service_role;");
  await db.exec(helper);
  const before=(await db.query("SELECT oid::text,proacl::text,prosrc FROM pg_proc WHERE oid='sandy_voice_save_explicit_memory(uuid,text,text)'::regprocedure")).rows[0];
  await db.exec(await Deno.readTextFile(new URL("../../supabase/migrations/20261024005600_sandy_voice_automatic_learning.sql",import.meta.url)));
  assert.deepEqual((await db.query("SELECT oid::text,proacl::text,prosrc FROM pg_proc WHERE oid='sandy_voice_save_explicit_memory(uuid,text,text)'::regprocedure")).rows[0],before);passed++;
  const source=async(c=customer,cutoff:string|null=null)=>(await db.query<{result:any}>("SELECT sandy_voice_automatic_learning_source($1,$2,$3)result",[session,c,cutoff])).rows[0].result;
  const proposal={summary:"Ordinary synthetic summary",candidates:[{fact_key:"likes_coffee",fact_value:"Customer likes ordinary fixture coffee",source_quote:"I like ordinary fixture coffee",category:"preference",decision:"commit",rationale:"Synthetic exact quote"}]};
  const persist=async(snapshot:any,result=proposal)=>(await db.query<{result:any}>("SELECT sandy_voice_automatic_learning_persist($1,$2,$3,$4)result",[session,customer,JSON.stringify(snapshot),JSON.stringify(result)])).rows[0].result;
  const totals=async()=>(await db.query<{facts:number;audit:number;summaries:number}>("SELECT(SELECT count(*)::int FROM email_ai_profile_facts)facts,(SELECT count(*)::int FROM sandy_voice_memory_facts)audit,(SELECT count(*)::int FROM sandy_voice_memory_reviews WHERE summary IS NOT NULL)summaries")).rows[0];
  assert.equal((await source(other)).ok,false);passed++;
  let valid=await source();assert.equal(valid.ok,true);passed++;
  // Historical ended calls may be reviewed only inside their actual private
  // authority window. A later transcript is never evidence for derived writes.
  await db.exec("UPDATE sandy_voice_call_sessions SET state='ended',ended_at=clock_timestamp()-interval '20 minutes'");
  const historical=await source();assert.equal(historical.ok,true);assert.equal(historical.source_cutoff,historical.authorized_until);passed++;
  await db.exec("INSERT INTO sandy_voice_transcript_turns VALUES(3,'"+session+"','"+customer+"','user','This is after private call authority',clock_timestamp()-interval '10 minutes')");
  assert.equal((await persist(historical,{...proposal,candidates:[{...proposal.candidates[0],source_quote:'This is after private call authority'}]})).persisted,false);assert.deepEqual(await totals(),{facts:0,audit:0,summaries:0});passed++;
  await db.exec("UPDATE sandy_voice_call_sessions SET state='active',ended_at=NULL;UPDATE sandy_voice_private_auth SET expires_at=clock_timestamp()-interval '2 hours'");
  assert.equal((await source()).ok,false);assert.equal((await persist(valid)).persisted,false);passed++;
  await db.exec("UPDATE sandy_voice_private_auth SET expires_at=clock_timestamp()+interval '1 hour'");
  valid=await source();
  const policy=(await db.query("SELECT consent_at::text,updated_at::text FROM sandy_memory_settings WHERE customer_id=$1",[customer])).rows[0]as any;
  for(const setup of ["enabled=false","learning_enabled=false","consent_at=NULL","consent_at=clock_timestamp()+interval '1 hour'","updated_at=clock_timestamp()+interval '1 hour'"]){
   await db.exec("UPDATE sandy_memory_settings SET "+setup);assert.equal((await source()).ok,false);assert.equal((await persist(valid)).persisted,false);assert.deepEqual(await totals(),{facts:0,audit:0,summaries:0});passed++;
   await db.query("UPDATE sandy_memory_settings SET enabled=true,learning_enabled=true,consent_at=$1,updated_at=$2",[policy.consent_at,policy.updated_at]);
  }
  // A newly permitted epoch cannot backfill an earlier transcript, even using
  // a fresh snapshot. The source window excludes every old utterance.
  await db.exec("UPDATE sandy_memory_settings SET consent_at=clock_timestamp(),updated_at=clock_timestamp()");
  const regranted=await source();assert.equal(regranted.ok,true);assert.equal((await persist(valid)).persisted,false);passed++;
  const blocked=await persist(regranted);assert.equal(blocked.persisted,false);assert.deepEqual(await totals(),{facts:0,audit:0,summaries:0});passed++;
  await db.exec("DELETE FROM sandy_voice_memory_facts;UPDATE sandy_voice_memory_reviews SET status='processing',summary=NULL,candidates=NULL,committed_count=NULL;");
  await db.query("UPDATE sandy_memory_settings SET consent_at=$1,updated_at=$2",[policy.consent_at,policy.updated_at]);
  const goodSource=await source();
  // A foreign-owner or assistant quote cannot authorize an automatic fact.
  const foreign={...proposal,candidates:[{...proposal.candidates[0],source_quote:"I own a foreign private fixture"}]};
  assert.equal((await persist(goodSource,foreign)).persisted,false);assert.deepEqual(await totals(),{facts:0,audit:0,summaries:0});passed++;
  const mixed={...proposal,candidates:[proposal.candidates[0],{...foreign.candidates[0],fact_key:'foreign_claim'}]};
  assert.equal((await persist(goodSource,mixed)).persisted,false);assert.deepEqual(await totals(),{facts:0,audit:0,summaries:0});passed++;
  await db.exec("DELETE FROM sandy_voice_memory_facts;UPDATE sandy_voice_memory_reviews SET status='processing',summary=NULL,candidates=NULL,committed_count=NULL;");
  // Force audit failure after the profile writer; the transaction must roll
  // back profile, audit and summary together, never leave an un-audited fact.
  await db.exec("ALTER TABLE sandy_voice_memory_facts ADD CONSTRAINT fixture_refusal CHECK(fact_key<>'likes_coffee')");
  await assert.rejects(()=>persist(goodSource),(error:any)=>error.code==='23514');assert.deepEqual(await totals(),{facts:0,audit:0,summaries:0});passed++;
  await db.exec("ALTER TABLE sandy_voice_memory_facts DROP CONSTRAINT fixture_refusal");
  const result=await persist(goodSource);assert.equal(result.committed,1);assert.deepEqual(await totals(),{facts:1,audit:1,summaries:1});passed++;
  assert.equal((await persist(goodSource)).persisted,false);passed++;
  // Explicit customer remember remains available independently of automatic
  // learning opt-out; the existing writer source and permissions are untouched.
  await db.exec("UPDATE sandy_memory_settings SET learning_enabled=false");
  assert.equal((await db.query<{outcome:string}>("SELECT sandy_voice_save_explicit_memory($1,'explicit_customer_request','Explicit synthetic customer request')outcome",[customer])).rows[0].outcome,'saved');passed++;
  const acl=(await db.query("SELECT has_function_privilege('anon','sandy_voice_automatic_learning_persist(uuid,uuid,jsonb,jsonb)','EXECUTE')anon,has_function_privilege('authenticated','sandy_voice_automatic_learning_persist(uuid,uuid,jsonb,jsonb)','EXECUTE')customer,has_function_privilege('service_role','sandy_voice_automatic_learning_persist(uuid,uuid,jsonb,jsonb)','EXECUTE')internal")).rows[0];assert.deepEqual(acl,{anon:false,customer:false,internal:true});passed++;
  const sources=(await db.query("SELECT target.signature,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') source_sha256,p.prosecdef,p.proconfig FROM (VALUES('public.sandy_voice_automatic_learning_source(uuid,uuid,timestamptz)'),('public.sandy_voice_automatic_learning_persist(uuid,uuid,jsonb,jsonb)'))target(signature) JOIN pg_proc p ON p.oid=to_regprocedure(target.signature) ORDER BY target.signature")).rows;
  const release=JSON.parse(await Deno.readTextFile(new URL("../../docs/sandy-engineering/evaluations/voice-automatic-learning-release.json",import.meta.url)));
  for(const row of sources as any[])assert.deepEqual({source_sha256:row.source_sha256,prosecdef:row.prosecdef,proconfig:row.proconfig},release.SQL_candidate[row.signature]);
  console.log(JSON.stringify({SQL_candidate:sources}));
  console.log(JSON.stringify({test_class:"isolated_postgresql_wasm",passed,live_customer_sources_used:false,provider_model_calls:0,explicit_writer_preserved:true}));
 }finally{await db.close();}
});
