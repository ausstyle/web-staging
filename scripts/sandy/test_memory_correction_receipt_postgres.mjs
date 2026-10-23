// Actual shared SQL and original correction action, isolated PostgreSQL only.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(
  process.argv[2] ? pathToFileURL(process.argv[2]).href : "@electric-sql/pglite"
);
const db = new PGlite();
let passed = 0;
const actor = "10000000-0000-4000-8000-000000000001",
  customer = "20000000-0000-4000-8000-000000000001",
  foreign = "30000000-0000-4000-8000-000000000001",
  original = "40000000-0000-4000-8000-000000000001";
const read = async (path) => readFile(new URL(path, import.meta.url), "utf8");
try {
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;CREATE SCHEMA sandy_private;CREATE SCHEMA extensions;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 CREATE TABLE sandy_memory_portal_accounts(auth_user_id uuid,customer_id uuid,revoked_at timestamptz);
 CREATE TABLE email_customer_addresses(customer_id uuid,is_primary boolean,normalized_email text);
 CREATE FUNCTION sandy_api_current_agenda_customer_id() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
 CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256(convert_to($1,'UTF8'))$$;
 CREATE TABLE sandy_tasks(id uuid,customer_id uuid,parent_task_id uuid,company_id uuid,category_id uuid,archived_at timestamptz);
 CREATE TABLE sandy_calendar_events(id uuid,customer_id uuid,starts_at timestamptz,ends_at timestamptz);
 CREATE TABLE sandy_customer_mutation_receipts(mutation_id uuid PRIMARY KEY,customer_id uuid,auth_user_id uuid,operation text,idempotency_key text,arguments_sha256 text,result jsonb,UNIQUE(customer_id,auth_user_id,operation,idempotency_key));
 CREATE TABLE sandy_operation_registry(operation text PRIMARY KEY,handler text,permission_scope text,is_mutation boolean,api_exposed boolean,ai_exposed boolean,verified boolean,input_schema jsonb,output_schema jsonb,description text,error_contract jsonb,updated_at timestamptz);
 CREATE TABLE email_ai_profile_facts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL,category text NOT NULL,fact_key text NOT NULL,fact_value text NOT NULL,confidence text CHECK(confidence IN('explicit','inferred')),status text CHECK(status IN('active','superseded','rejected')),supersedes_fact_id uuid,last_observed_at timestamptz,reviewed_at timestamptz,created_at timestamptz DEFAULT now());
 CREATE TABLE sandy_memory_rejected_facts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,original_fact_id uuid UNIQUE,category text,fact_key text,rejected_value text,corrected_value text,reason text,rejected_at timestamptz DEFAULT now());
 CREATE TABLE sandy_memory_audit(owner_customer_id uuid,action text,actor text,detail jsonb);
 CREATE FUNCTION record_fixture_rejection() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$DECLARE corrected text;BEGIN
 IF old.status='active' AND new.status IN('rejected','superseded') THEN
 SELECT fact_value INTO corrected FROM email_ai_profile_facts WHERE customer_id=new.customer_id AND supersedes_fact_id=new.id AND status='active' ORDER BY created_at DESC LIMIT 1;
 INSERT INTO sandy_memory_rejected_facts(customer_id,original_fact_id,category,fact_key,rejected_value,corrected_value,reason) VALUES(new.customer_id,new.id,new.category,new.fact_key,new.fact_value,corrected,CASE WHEN new.status='superseded' THEN 'customer_corrected' ELSE 'customer_marked_incorrect' END) ON CONFLICT(original_fact_id) DO UPDATE SET corrected_value=excluded.corrected_value,reason=excluded.reason;
 END IF;RETURN new;END $$;
 CREATE TRIGGER record_fixture_rejection AFTER UPDATE ON email_ai_profile_facts FOR EACH ROW EXECUTE FUNCTION record_fixture_rejection();
 `,
  );
  const existingService = await read(
    "../../supabase/migrations/20261020234000_sandy_customer_mutation_contracts.sql",
  );
  const existingNormalizer = existingService.match(
    /CREATE FUNCTION public\.sandy_api_customer_text[\s\S]*?\$text\$;/,
  )?.[0];
  assert.ok(existingNormalizer);
  await db.exec(existingNormalizer);
  await db.exec(await read("./fixtures/correct_customer_fact_v1.sql"));
  await db.exec(
    `REVOKE ALL ON FUNCTION sandy_private.correct_customer_fact(uuid,uuid,text) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION sandy_private.correct_customer_fact(uuid,uuid,text) TO service_role;
 CREATE FUNCTION sandy_memory_correct_fact(uuid,uuid,text) RETURNS uuid LANGUAGE sql SET search_path='' AS $$SELECT sandy_private.correct_customer_fact($1,$2,$3)$$;
 REVOKE ALL ON FUNCTION sandy_memory_correct_fact(uuid,uuid,text) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION sandy_memory_correct_fact(uuid,uuid,text) TO service_role;`,
  );
  await db.exec(
    await read(
      "../../supabase/migrations/20261024004000_sandy_memory_correction_confidence.sql",
    ),
  );
  await db.exec(await read("./fixtures/customer_mutation_v1.sql"));
  await db.exec(
    `REVOKE ALL ON FUNCTION sandy_api_customer_mutation(text,jsonb,text) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION sandy_api_customer_mutation(text,jsonb,text) TO authenticated;`,
  );
  const old =
    JSON.parse(await read("./fixtures/memory_correction_registry_v1.json"))[0];
  await db.query(
    "INSERT INTO sandy_operation_registry(operation,handler,permission_scope,is_mutation,api_exposed,ai_exposed,verified,input_schema,output_schema) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      old.operation,
      old.handler,
      old.permission_scope,
      old.is_mutation,
      false,
      false,
      false,
      JSON.stringify(old.input_schema),
      JSON.stringify(old.output_schema),
    ],
  );
  const acl = (await db.query(
    "SELECT oid,proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='sandy_api_customer_mutation(text,jsonb,text)'::regprocedure",
  )).rows;
  await db.exec(
    await read(
      "../../supabase/migrations/20261024004100_sandy_memory_correction_receipt.sql",
    ),
  );
  assert.deepEqual(
    (await db.query(
      "SELECT oid,proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='sandy_api_customer_mutation(text,jsonb,text)'::regprocedure",
    )).rows,
    acl,
  );
  passed++;
  assert.deepEqual(
    (await db.query(
      "SELECT api_exposed,ai_exposed,verified FROM sandy_operation_registry",
    )).rows,
    [{ api_exposed: false, ai_exposed: false, verified: false }],
  );
  passed++;
  await db.query(
    "INSERT INTO auth.users VALUES($1,'fixture@example.invalid',now())",
    [actor],
  );
  await db.query(
    "INSERT INTO sandy_memory_portal_accounts VALUES($1,$2,NULL)",
    [actor, customer],
  );
  await db.query(
    "INSERT INTO email_customer_addresses VALUES($1,true,'fixture@example.invalid')",
    [customer],
  );
  await db.query(
    "INSERT INTO email_ai_profile_facts(id,customer_id,category,fact_key,fact_value,confidence,status) VALUES($1,$2,'other','fixture-key','old fixture value','explicit','active')",
    [original, customer],
  );
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",
    [actor],
  );
  const args = {
    id: original,
    confirm: true,
    new_value: "corrected fixture value",
  };
  const call = async (a = args, key = "memory-shared-fixture-0001") =>
    (await db.query(
      "SELECT sandy_api_customer_mutation('memory.fact_correct',$1,$2) result",
      [JSON.stringify(a), key],
    )).rows[0].result;
  assert.equal((await call()).error, "operation_requires_live_verification");
  passed++;
  // Isolated test registry only. Production flags are never changed by this test.
  await db.exec(
    "UPDATE sandy_operation_registry SET api_exposed=true,verified=true",
  );
  for (
    const invalid of [
      { ...args, confirm: false },
      { ...args, customer_id: foreign },
      { ...args, new_value: {} },
      { ...args, new_value: " " },
    ]
  ) {
    assert.equal((await call(invalid)).http_status, 400);
    passed++;
  }
  assert.equal((await call({ ...args, id: foreign })).http_status, 404);
  passed++;
  const first = await call();
  assert.equal(first.ok, true);
  assert.equal(first.item.customer_id, customer);
  assert.equal(first.item.original_status, "superseded");
  assert.equal(first.item.corrected_value, args.new_value);
  assert.ok(first.item.rejection_id);
  passed++;
  const replay = await call();
  assert.equal(replay.reused, true);
  assert.equal(replay.mutation_id, first.mutation_id);
  assert.equal(replay.item.id, first.item.id);
  passed++;
  assert.deepEqual(
    (await db.query(
      "SELECT (SELECT count(*)::integer FROM sandy_customer_mutation_receipts) receipts,(SELECT count(*)::integer FROM sandy_memory_audit) audits,(SELECT count(*)::integer FROM sandy_memory_rejected_facts) rejections",
    )).rows,
    [{ receipts: 1, audits: 1, rejections: 1 }],
  );
  passed++;
  assert.equal(
    (await call({ ...args, new_value: "different value" })).http_status,
    409,
  );
  passed++;
  const unchanged = await call(
    { ...args, id: first.item.id },
    "memory-shared-fixture-unchanged",
  );
  assert.equal(unchanged.item.original_status, "active");
  assert.equal(unchanged.item.rejection_id, null);
  passed++;
  const rejected = await call(
    { ...args, id: first.item.id, new_value: null },
    "memory-shared-fixture-reject",
  );
  assert.equal(rejected.item.status, "rejected");
  assert.equal(rejected.item.corrected_value, null);
  passed++;
  await db.exec("UPDATE sandy_memory_portal_accounts SET revoked_at=now()");
  assert.equal((await call()).http_status, 403);
  passed++;
  await db.exec(
    "UPDATE sandy_memory_portal_accounts SET revoked_at=NULL;UPDATE auth.users SET email_confirmed_at=NULL",
  );
  assert.equal((await call()).http_status, 403);
  passed++;
  await db.exec(
    "UPDATE auth.users SET email_confirmed_at=now();UPDATE email_customer_addresses SET normalized_email='wrong@example.invalid'",
  );
  assert.equal((await call()).http_status, 403);
  passed++;
  await db.exec(
    "UPDATE email_customer_addresses SET normalized_email='fixture@example.invalid'",
  );
  await db.query(
    "INSERT INTO email_ai_profile_facts(id,customer_id,category,fact_key,fact_value,confidence,status) VALUES($1,$2,'other','rollback-fixture','rollback original','explicit','active')",
    [foreign, customer],
  );
  await db.exec(
    "CREATE FUNCTION deny_fixture_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture audit unavailable';END$$;CREATE TRIGGER deny_fixture_audit BEFORE INSERT ON sandy_memory_audit FOR EACH ROW EXECUTE FUNCTION deny_fixture_audit()",
  );
  const failed = await call(
    { ...args, id: foreign },
    "memory-shared-fixture-rollback",
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.reconciliation_required, true);
  assert.equal(
    (await db.query("SELECT status FROM email_ai_profile_facts WHERE id=$1", [
      foreign,
    ])).rows[0].status,
    "active",
  );
  assert.equal(
    (await db.query(
      "SELECT count(*)::integer n FROM sandy_memory_rejected_facts WHERE original_fact_id=$1",
      [foreign],
    )).rows[0].n,
    0,
  );
  passed++;
  console.log(
    JSON.stringify({
      test_class: "isolated_postgresql_wasm",
      passed,
      production_database_used: false,
      new_store: false,
      original_action_and_shared_receipt_used: true,
    }),
  );
} finally {
  await db.close();
}
