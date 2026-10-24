// Isolated PostgreSQL only. No external channel, consent, customer or provider
// record is created in production; these rows exercise the existing schema.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(
  process.argv[2] ? pathToFileURL(process.argv[2]).href : "@electric-sql/pglite"
);
const db = new PGlite();
let passed = 0;
const owner = "10000000-0000-4000-8000-000000000001",
  foreign = "10000000-0000-4000-8000-000000000002",
  source = "20000000-0000-4000-8000-000000000001",
  conversation = "30000000-0000-4000-8000-000000000001";
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const scalar = async (sql, args = []) =>
  (await db.query(sql, args)).rows[0].result;
try {
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE sandy_memory_settings(customer_id uuid PRIMARY KEY,enabled boolean,learning_enabled boolean,consent_at timestamptz,updated_at timestamptz);
 CREATE TABLE sandy_voice_call_sessions(id uuid PRIMARY KEY,link_id uuid,owner_customer_id uuid,state text,created_at timestamptz,ended_at timestamptz);
 CREATE TABLE sandy_voice_call_links(id uuid PRIMARY KEY,owner_customer_id uuid,revoked_at timestamptz,purpose text,expires_at timestamptz);
 CREATE TABLE sandy_voice_private_auth(session_id uuid PRIMARY KEY,owner_customer_id uuid,verified_at timestamptz,expires_at timestamptz);
 CREATE TABLE sandy_voice_transcript_turns(id bigint PRIMARY KEY,session_id uuid,owner_customer_id uuid,role text,text text,created_at timestamptz);
 CREATE TABLE sandy_web_conversations(id uuid PRIMARY KEY,customer_id uuid,created_at timestamptz);
 CREATE TABLE web_source_rows(id uuid PRIMARY KEY,conversation_id uuid,customer_id uuid,status text,question text,created_at timestamptz);
 CREATE TABLE source_text_read_counter(n integer);INSERT INTO source_text_read_counter VALUES(0);
 CREATE FUNCTION observe_source_text(v text) RETURNS text LANGUAGE plpgsql VOLATILE AS $$BEGIN UPDATE public.source_text_read_counter SET n=n+1;RETURN v;END$$;
 CREATE VIEW sandy_web_turns AS SELECT id,conversation_id,customer_id,status,observe_source_text(question) question,created_at FROM web_source_rows;
 CREATE TABLE sandy_whatsapp_messages(id bigint PRIMARY KEY,meta_message_id text,sender_wa_id text,direction text,body text,created_at timestamptz);
 CREATE TABLE sandy_whatsapp_identities(wa_id text PRIMARY KEY,customer_id uuid,verification_status text,allowed_scopes text[],verified_at timestamptz,updated_at timestamptz);
 CREATE TABLE email_messages(id uuid PRIMARY KEY,customer_id uuid,sender_address text,direction text,created_at timestamptz,received_at timestamptz,subject text,body_text text);
 CREATE TABLE email_customer_addresses(id uuid PRIMARY KEY,customer_id uuid,normalized_email text,verified_at timestamptz);
 CREATE TABLE sandy_temporal_ingestion_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,source_channel text,source_ref text,state text DEFAULT 'pending',attempts integer DEFAULT 0,last_error text,created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz DEFAULT clock_timestamp(),UNIQUE(source_channel,source_ref));
 CREATE TABLE sandy_temporal_facts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,subject_type text,subject_id text,predicate text NOT NULL,value jsonb,state text,confidence numeric,valid_from timestamptz,valid_until timestamptz,expires_at timestamptz,observed_at timestamptz,source_channel text,source_ref text,evidence jsonb,access_scope text,sensitivity text,review_status text);
 CREATE UNIQUE INDEX sandy_temporal_source_dedup ON sandy_temporal_facts(customer_id,source_channel,source_ref,predicate,subject_type,subject_id) WHERE source_ref IS NOT NULL;`,
  );
  await db.exec(
    await read("./fixtures/sandy_automatic_memory_learning_allowed_05500.sql"),
  );
  await db.exec(
    await read(
      "../../supabase/migrations/20261024005800_sandy_temporal_automatic_learning.sql",
    ),
  );
  await db.query(
    "INSERT INTO sandy_memory_settings VALUES($1,false,false,clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '20 seconds')",
    [owner],
  );
  await db.query(
    "INSERT INTO sandy_web_conversations VALUES($1,$2,clock_timestamp()-interval '60 seconds')",
    [conversation, owner],
  );
  await db.query(
    "INSERT INTO web_source_rows VALUES($1,$2,$3,'completed','My current timezone is UTC for the next week.',clock_timestamp()-interval '5 seconds')",
    [source, conversation, owner],
  );
  const snapshot = () =>
    scalar("SELECT sandy_temporal_automatic_source($1,'web',$2,NULL) result", [
      owner,
      source,
    ]);
  assert.equal((await snapshot()).ok, false);
  assert.equal(
    (await db.query("SELECT n FROM source_text_read_counter")).rows[0].n,
    0,
  );
  passed++;
  await db.exec(
    "UPDATE sandy_memory_settings SET enabled=true,learning_enabled=true,consent_at=NULL",
  );
  assert.equal((await snapshot()).ok, false);
  passed++;
  await db.exec(
    "UPDATE sandy_memory_settings SET consent_at=clock_timestamp()-interval '30 seconds',updated_at=clock_timestamp()-interval '20 seconds'",
  );
  await db.query("UPDATE sandy_web_conversations SET customer_id=$1", [
    foreign,
  ]);
  assert.equal((await snapshot()).ok, false);
  await db.query("UPDATE sandy_web_conversations SET customer_id=$1", [owner]);
  passed++;
  await db.exec(
    "UPDATE sandy_memory_settings SET consent_at=clock_timestamp()-interval '1 second',updated_at=clock_timestamp()-interval '1 second'",
  );
  assert.equal((await snapshot()).ok, false);
  passed++;
  await db.exec(
    "UPDATE sandy_memory_settings SET consent_at=clock_timestamp()-interval '30 seconds',updated_at=clock_timestamp()-interval '20 seconds'",
  );
  assert.equal((await snapshot()).ok, true);
  assert.ok(
    (await db.query("SELECT n FROM source_text_read_counter")).rows[0].n > 0,
  );
  passed++;
  const prepare = async () => {
    await db.exec(
      "DELETE FROM sandy_temporal_ingestion_jobs;DELETE FROM sandy_temporal_facts;UPDATE sandy_memory_settings SET enabled=true,learning_enabled=true,consent_at=clock_timestamp()-interval '30 seconds',updated_at=clock_timestamp()-interval '20 seconds'",
    );
    const j = (await db.query(
      "INSERT INTO sandy_temporal_ingestion_jobs(customer_id,source_channel,source_ref,state,attempts) VALUES($1,'web',$2,'processing',1) RETURNING id",
      [owner, source],
    )).rows[0].id;
    return {
      j,
      expected: await scalar(
        "SELECT sandy_temporal_automatic_prepare($1) result",
        [j],
      ),
    };
  };
  const receipt = {
      provider_response_id: "isolated-no-provider-id",
      response_sha256: "a".repeat(64),
    },
    facts = [{
      predicate: "timezone.current",
      value: { timezone: "UTC" },
      sensitive: false,
      source_quote: "My current timezone is UTC",
      confidence: .7,
    }];
  const finish = (x, f = facts) =>
    scalar("SELECT sandy_temporal_automatic_finish($1,$2,$3,$4) result", [
      x.j,
      JSON.stringify(x.expected),
      JSON.stringify(f),
      JSON.stringify(receipt),
    ]);
  let x = await prepare();
  assert.equal(x.expected.ok, true);
  await db.exec("UPDATE sandy_memory_settings SET learning_enabled=false");
  assert.equal((await finish(x)).persisted, false);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM sandy_temporal_facts")).rows[0]
      .n,
    0,
  );
  passed++;
  x = await prepare();
  await db.exec(
    "UPDATE sandy_memory_settings SET consent_at=clock_timestamp(),updated_at=clock_timestamp()",
  );
  assert.equal((await finish(x)).persisted, false);
  passed++;
  x = await prepare();
  await db.exec(
    "UPDATE web_source_rows SET question='Redacted source question'",
  );
  assert.equal((await finish(x)).persisted, false);
  await db.exec(
    "UPDATE web_source_rows SET question='My current timezone is UTC for the next week.'",
  );
  passed++;
  x = await prepare();
  const invalid = [...facts, {
    ...facts[0],
    source_quote: "Invented evidence",
  }];
  assert.equal((await finish(x, invalid)).persisted, false);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM sandy_temporal_facts")).rows[0]
      .n,
    0,
  );
  passed++;
  x = await prepare();
  assert.equal(
    (await finish(x, [{ ...facts[0], sensitive: true }])).persisted,
    false,
  );
  passed++;
  x = await prepare();
  assert.equal(
    (await finish(x, [{ ...facts[0], valid_from: "2026-10-24T10:00:00" }]))
      .persisted,
    false,
  );
  passed++;
  x = await prepare();
  const missingReceipt = await scalar(
    "SELECT sandy_temporal_automatic_finish($1,$2,$3,$4) result",
    [
      x.j,
      JSON.stringify(x.expected),
      JSON.stringify(facts),
      JSON.stringify({ provider_response_id: "isolated-no-provider-id" }),
    ],
  );
  assert.equal(missingReceipt.persisted, false);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM sandy_temporal_facts")).rows[0]
      .n,
    0,
  );
  passed++;
  x = await prepare();
  const numericReceipt = await scalar(
    "SELECT sandy_temporal_automatic_finish($1,$2,$3,$4) result",
    [
      x.j,
      JSON.stringify(x.expected),
      JSON.stringify(facts),
      JSON.stringify({
        provider_response_id: 1234,
        response_sha256: "a".repeat(64),
      }),
    ],
  );
  assert.equal(numericReceipt.persisted, false);
  passed++;
  await db.exec(
    "UPDATE web_source_rows SET question='My current timezone is UTC; reference 1234 for this week.'",
  );
  x = await prepare();
  assert.equal(
    (await finish(x, [{ ...facts[0], source_quote: 1234 }])).persisted,
    false,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM sandy_temporal_facts")).rows[0]
      .n,
    0,
  );
  await db.exec(
    "UPDATE web_source_rows SET question='My current timezone is UTC for the next week.'",
  );
  passed++;
  x = await prepare();
  const result = await finish(x);
  assert.equal(result.persisted, true);
  assert.equal(result.inserted, 1);
  const saved = (await db.query(
    "SELECT state,access_scope,evidence FROM sandy_temporal_facts",
  )).rows[0];
  assert.equal(saved.state, "inferred");
  assert.equal(saved.access_scope, "private");
  assert.equal(saved.evidence.source_quote, facts[0].source_quote);
  assert.equal(
    saved.evidence.provider_response_id,
    receipt.provider_response_id,
  );
  assert.equal((await finish(x)).persisted, false);
  passed++;
  await db.exec(
    await read("./fixtures/sandy_voice_automatic_learning_source_05600.sql"),
  );
  const session = "40000000-0000-4000-8000-000000000001",
    link = "50000000-0000-4000-8000-000000000001";
  await db.query(
    "INSERT INTO sandy_voice_call_links VALUES($1,$2,NULL,'voice_call',clock_timestamp()+interval '1 minute')",
    [link, owner],
  );
  await db.query(
    "INSERT INTO sandy_voice_call_sessions VALUES($1,$2,$3,'ended',clock_timestamp()-interval '60 seconds',clock_timestamp()-interval '1 second')",
    [session, link, owner],
  );
  await db.query(
    "INSERT INTO sandy_voice_private_auth VALUES($1,$2,clock_timestamp()-interval '15 seconds',clock_timestamp()+interval '1 minute')",
    [session, owner],
  );
  await db.query(
    "INSERT INTO sandy_voice_transcript_turns VALUES(101,$1,$2,'user','My current timezone is UTC for this week.',clock_timestamp()-interval '5 seconds')",
    [session, owner],
  );
  await db.exec(
    "UPDATE sandy_memory_settings SET enabled=true,learning_enabled=true,consent_at=clock_timestamp()-interval '30 seconds',updated_at=clock_timestamp()-interval '20 seconds'",
  );
  const voice = await scalar(
    "SELECT sandy_temporal_automatic_source($1,'voice','101',NULL) result",
    [owner],
  );
  assert.equal(voice.ok, true);
  assert.equal(voice.source_ref, "101");
  assert.equal(voice.text, "My current timezone is UTC for this week.");
  passed++;
  await db.exec("UPDATE sandy_voice_private_auth SET verified_at=NULL");
  assert.equal(
    (await scalar(
      "SELECT sandy_temporal_automatic_source($1,'voice','101',NULL) result",
      [owner],
    )).ok,
    false,
  );
  passed++;
  await db.query(
    "INSERT INTO sandy_whatsapp_identities VALUES('isolated-wa',$1,'unverified',ARRAY['memory_read'],clock_timestamp()-interval '15 seconds',clock_timestamp()-interval '10 seconds')",
    [owner],
  );
  await db.exec(
    "INSERT INTO sandy_whatsapp_messages VALUES(201,'isolated-message','isolated-wa','inbound','I expect a reply about the isolated document.',clock_timestamp()-interval '5 seconds')",
  );
  assert.equal(
    (await scalar(
      "SELECT sandy_temporal_automatic_source($1,'whatsapp','isolated-message',NULL) result",
      [owner],
    )).ok,
    false,
  );
  await db.exec(
    "UPDATE sandy_whatsapp_identities SET verification_status='verified'",
  );
  assert.equal(
    (await scalar(
      "SELECT sandy_temporal_automatic_source($1,'whatsapp','isolated-message',NULL) result",
      [owner],
    )).ok,
    true,
  );
  passed++;
  const email = "60000000-0000-4000-8000-000000000001";
  await db.query(
    "INSERT INTO email_messages VALUES($1,$2,'thirdparty@example.invalid','incoming',clock_timestamp()-interval '5 seconds',clock_timestamp()-interval '5 seconds','Document update','The isolated document is still pending.')",
    [email, owner],
  );
  const mail = await scalar(
    "SELECT sandy_temporal_automatic_source($1,'email',$2,NULL) result",
    [owner, email],
  );
  assert.equal(mail.ok, true);
  assert.equal(mail.author_role, "third_party");
  passed++;
  const acl = (await db.query(
    "SELECT has_function_privilege('authenticated','sandy_temporal_automatic_prepare(uuid)','EXECUTE') customer,has_function_privilege('anon','sandy_temporal_automatic_finish(uuid,jsonb,jsonb,jsonb)','EXECUTE') anon,has_function_privilege('service_role','sandy_temporal_automatic_prepare(uuid)','EXECUTE') service",
  )).rows[0];
  assert.deepEqual(acl, { customer: false, anon: false, service: true });
  passed++;
  console.log(
    JSON.stringify({
      isolated_postgresql_assertions: passed,
      production_used: false,
      provider_requests: 0,
      external_channels_created: false,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      test_failed: true,
      code: error.code ?? null,
      message: error.message,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
