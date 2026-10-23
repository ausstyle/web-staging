// Isolated PostgreSQL reproduction; never connects to production/customer data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : "@electric-sql/pglite");
const db = new PGlite();
const customer = "10000000-0000-4000-8000-000000000001", other = "20000000-0000-4000-8000-000000000001", id = "30000000-0000-4000-8000-000000000001";
let passed = 0;
try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA sandy_private;
    CREATE TABLE email_ai_profile_facts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL,category text NOT NULL,fact_key text NOT NULL,fact_value text NOT NULL,
      confidence text CHECK(confidence IN('explicit','inferred')),status text CHECK(status IN('active','rejected','superseded')),supersedes_fact_id uuid,last_observed_at timestamptz,reviewed_at timestamptz);
    CREATE TABLE sandy_memory_rejected_facts(original_fact_id uuid PRIMARY KEY,customer_id uuid,rejected_value text,corrected_value text);
    CREATE FUNCTION capture_fixture_rejection() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
      IF old.status='active' AND new.status IN('rejected','superseded') THEN
        INSERT INTO sandy_memory_rejected_facts SELECT old.id,old.customer_id,old.fact_value,(SELECT fact_value FROM email_ai_profile_facts WHERE customer_id=old.customer_id AND supersedes_fact_id=old.id AND status='active' LIMIT 1);
      END IF;RETURN new;END $$;
    CREATE TRIGGER capture_fixture_rejection AFTER UPDATE ON email_ai_profile_facts FOR EACH ROW EXECUTE FUNCTION capture_fixture_rejection();`);
  await db.exec(await readFile(new URL("./fixtures/correct_customer_fact_v1.sql", import.meta.url), "utf8"));
  await db.exec(`REVOKE ALL ON FUNCTION sandy_private.correct_customer_fact(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION sandy_private.correct_customer_fact(uuid,uuid,text) TO service_role;
    INSERT INTO email_ai_profile_facts(id,customer_id,category,fact_key,fact_value,confidence,status) VALUES('${id}','${customer}','other','fixture-key','old fixture value','explicit','active');`);
  await assert.rejects(db.query("SELECT sandy_private.correct_customer_fact($1,$2,'new fixture value')", [customer, id]), error => error.code === "23514"); passed++;
  assert.equal((await db.query("SELECT status FROM email_ai_profile_facts WHERE id=$1", [id])).rows[0].status, "active"); passed++;
  assert.equal((await db.query("SELECT count(*)::integer n FROM sandy_memory_rejected_facts")).rows[0].n, 0); passed++;
  const beforeAcl = (await db.query("SELECT oid,proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='sandy_private.correct_customer_fact(uuid,uuid,text)'::regprocedure")).rows[0];
  await db.exec(await readFile(new URL("../../supabase/migrations/20261024004000_sandy_memory_correction_confidence.sql", import.meta.url), "utf8"));
  assert.deepEqual((await db.query("SELECT oid,proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='sandy_private.correct_customer_fact(uuid,uuid,text)'::regprocedure")).rows[0], beforeAcl); passed++;
  await assert.rejects(db.query("SELECT sandy_private.correct_customer_fact($1,$2,'foreign change')", [other, id]), error => error.code === "P0002"); passed++;
  assert.equal((await db.query("SELECT sandy_private.correct_customer_fact($1,$2,'old fixture value') id", [customer, id])).rows[0].id, id); passed++;
  await assert.rejects(db.query("SELECT sandy_private.correct_customer_fact($1,$2,'x')", [customer, id])); passed++;
  const corrected = (await db.query("SELECT sandy_private.correct_customer_fact($1,$2,'new fixture value') id", [customer, id])).rows[0].id;
  assert.deepEqual((await db.query("SELECT fact_value,confidence,status,supersedes_fact_id FROM email_ai_profile_facts WHERE id=$1", [corrected])).rows, [{ fact_value: "new fixture value", confidence: "explicit", status: "active", supersedes_fact_id: id }]); passed++;
  assert.equal((await db.query("SELECT status FROM email_ai_profile_facts WHERE id=$1", [id])).rows[0].status, "superseded"); passed++;
  assert.deepEqual((await db.query("SELECT * FROM sandy_memory_rejected_facts WHERE original_fact_id=$1", [id])).rows, [{ original_fact_id: id, customer_id: customer, rejected_value: "old fixture value", corrected_value: "new fixture value" }]); passed++;
  await assert.rejects(db.query("SELECT sandy_private.correct_customer_fact($1,$2,'repeat')", [customer, id]), error => error.code === "P0002"); passed++;
  await db.query("SELECT sandy_private.correct_customer_fact($1,$2,NULL)", [customer, corrected]);
  assert.equal((await db.query("SELECT status FROM email_ai_profile_facts WHERE id=$1", [corrected])).rows[0].status, "rejected"); passed++;
  const privileges = (await db.query("SELECT has_function_privilege('anon','sandy_private.correct_customer_fact(uuid,uuid,text)','EXECUTE') anon,has_function_privilege('authenticated','sandy_private.correct_customer_fact(uuid,uuid,text)','EXECUTE') authenticated,has_function_privilege('service_role','sandy_private.correct_customer_fact(uuid,uuid,text)','EXECUTE') service")).rows[0];
  assert.deepEqual(privileges, { anon: false, authenticated: false, service: true }); passed++;
  console.log(JSON.stringify({ test_class: "isolated_postgresql_wasm", passed, baseline_constraint_failure_reproduced: true, correction_and_rejection_verified: true, production_database_used: false }));
} finally { await db.close(); }
