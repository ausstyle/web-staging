// Private canary readiness is quality policy; normal customer authority is tested
// independently. No Supabase/network/customer data is used by these fixtures.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runMemoryReceiptTests } from "./test_memory_correction_receipt_postgres.mjs";
await runMemoryReceiptTests(async ({ db, actor, customer, foreign }) => {
  let passed = 0;
  await db.exec(
    `DROP TRIGGER deny_fixture_audit ON sandy_memory_audit;DROP FUNCTION deny_fixture_audit();
 ALTER TABLE auth.users ADD COLUMN raw_user_meta_data jsonb DEFAULT '{"sandy_api_isolated_session_test":true}'::jsonb;
 CREATE TABLE email_customers(id uuid PRIMARY KEY,display_name text,google_drive_folder_status text);
 CREATE TABLE sandy_memory_settings(customer_id uuid,learning_enabled boolean,proactive_enabled boolean);
 ALTER TABLE auth.users ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
 CREATE TABLE sandy_controller_admins(auth_user_id uuid,role text,enabled boolean);
 CREATE TABLE sandy_engineering_artifacts(id uuid PRIMARY KEY,change_id uuid NOT NULL,artifact_type text NOT NULL,target text NOT NULL,before_ref text,after_ref text,rollback_strategy text NOT NULL,rollback_notes text,metadata jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE sandy_engineering_change_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,change_id uuid NOT NULL,event_type text NOT NULL,actor uuid,detail jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now());
 GRANT USAGE ON SCHEMA auth TO service_role,authenticated;GRANT INSERT,UPDATE,SELECT ON sandy_engineering_artifacts,sandy_engineering_change_events TO service_role;
 GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
 UPDATE sandy_operation_registry SET api_exposed=false,ai_exposed=false,verified=false;`,
  );
  const sql = await readFile(
    new URL(
      "../../supabase/migrations/20261024004200_sandy_memory_private_certification.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(sql);
  await db.exec("CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text);INSERT INTO supabase_migrations.schema_migrations VALUES('20261024004200');");
  await db.exec(await readFile(new URL("../../supabase/migrations/20261024004210_sandy_memory_readiness_artifact_classification.sql",import.meta.url),"utf8"));
  await db.exec("ALTER TABLE sandy_engineering_artifacts ADD CHECK(artifact_type IN('github_commit','github_file','supabase_migration','edge_function','deployment_job','configuration','other')),ADD CHECK(rollback_strategy IN('git_revert','redeploy_prior','forward_migration','manual_review')); ");
  const manifest=JSON.parse(await readFile(new URL("../../docs/sandy-engineering/evaluations/memory-correction-adapter-release.json",import.meta.url),"utf8"));
  const sourceRows=(await db.query("SELECT proname,encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha,prosecdef,proconfig,pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid IN('public.sandy_guard_memory_private_readiness_event()'::regprocedure,'public.sandy_api_memory_private_readiness(uuid,text,text,uuid,text)'::regprocedure) ORDER BY proname")).rows;
  assert.deepEqual(sourceRows,manifest.readiness_classification_repair.candidate_sources);passed++;
  assert.deepEqual((await db.query("SELECT tgenabled,tgtype::int type,tgisinternal internal,tgfoid='public.sandy_guard_memory_private_readiness_event()'::regprocedure fixed_guard FROM pg_trigger WHERE tgrelid='public.sandy_engineering_change_events'::regclass AND tgname='sandy_memory_private_readiness_event_guard'")).rows,[{tgenabled:'O',type:31,internal:false,fixed_guard:true}]);passed++;

  assert.equal(
    (await db.query(
      "SELECT has_function_privilege('service_role','sandy_api_memory_private_readiness(uuid,text,text,uuid,text)','EXECUTE') service,has_function_privilege('anon','sandy_api_memory_private_readiness(uuid,text,text,uuid,text)','EXECUTE') anon",
    )).rows[0].service,
    false,
  );
  passed++;
  const artifact = "71000000-0000-4000-8000-000000000001",
    change = "72000000-0000-4000-8000-000000000001",
    key = "memory_cert_12345678901234567890123456789012:one",
    deployment = "zmqlyygzqoidkcwdysok_6e50ff35-5878-42e2-982c-c205df6cac2e_61",
    email =
      "sandy-service-acceptance-12345678-1234-4234-8234-1234567890ab@example.invalid";
  await db.query("UPDATE auth.users SET email=$1,email_confirmed_at=now()", [
    email,
  ]);
  await db.query("UPDATE email_customer_addresses SET normalized_email=$1", [
    email,
  ]);
  await db.query("INSERT INTO email_customers VALUES($1,'Isolated Sandy API service acceptance','excluded')",[customer]);
  await db.query("INSERT INTO sandy_memory_settings VALUES($1,false,false)",[customer]);
  const contract = (await db.query(
    "SELECT error_contract->>'contract_sha256' sha FROM sandy_operation_registry",
  )).rows[0].sha;
  const metadata = {
    kind:"runtime_private_certification",
    schema_version: 1,
    operation: "memory.fact_correct",
    fixture_user_id: actor,
    fixture_customer_id: customer,
    release_commit: "b".repeat(40),
    api_bundle_sha256: "a".repeat(64),
    api_deployment_id: deployment,
    contract_sha256: contract,
    idempotency_prefix: "memory_cert_12345678901234567890123456789012:",
    fact_ids: [foreign],
    max_mutations: 1,
    budget_units: 0,
    expires_at: new Date(Date.now() + 600000).toISOString(),
  };
  await db.query(
    "INSERT INTO sandy_engineering_artifacts(id,change_id,artifact_type,target,rollback_strategy,metadata) VALUES($1,$2,'configuration','memory.fact_correct','manual_review',$3)",
    [artifact, change, JSON.stringify(metadata)],
  );
  const proof = async (
    id = artifact,
    build = deployment,
    fact = foreign,
    k = key,
    sha = contract,
  ) =>
    (await db.query(
      "SELECT sandy_api_memory_private_readiness($1,$2,$3,$4,$5) result",
      [id, build, sha, fact, k],
    )).rows[0].result;
  assert.equal((await proof()).ok, false);
  passed++; // Generic artifact alone is not authorization/readiness.
  await db.exec("SET ROLE service_role");
  try {
    await assert.rejects(
      db.query(
        "INSERT INTO sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES($1,'memory_private_readiness_installed',NULL,$2)",
        [
          change,
          JSON.stringify({ artifact_id: artifact, owner_approved: true }),
        ],
      ),
      (e) => e.code === "42501",
    );
    passed++;
  } finally {
    await db.exec("RESET ROLE");
  }
  const claims = async (normal = true) =>
    db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",
      [normal ? actor : "", normal ? "authenticated" : ""],
    );
  const install = async (a = artifact) =>
    db.query(
      "INSERT INTO sandy_engineering_change_events(change_id,event_type,actor,detail) SELECT change_id,'memory_private_readiness_installed',NULL,jsonb_build_object('artifact_id',id,'artifact_sha256',encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),'release_commit',metadata->>'release_commit','api_bundle_sha256',metadata->>'api_bundle_sha256','api_deployment_id',metadata->>'api_deployment_id','contract_sha256',metadata->>'contract_sha256') FROM sandy_engineering_artifacts a WHERE id=$1",
      [a],
    );
  // A normal customer cannot turn even a matching fixture into protected source
  // attestation. Management's separate SQL identity must create that event.
  await assert.rejects(install(), (e) => e.code === "42501");
  passed++;
  await claims(false);
  for (const change of ["artifact_type='runtime_private_certification'", "rollback_strategy='revoke_readiness_only'"]) {
    await assert.rejects(db.query("UPDATE sandy_engineering_artifacts SET "+change+" WHERE id=$1",[artifact]),e=>e.code==='23514');passed++;
  }
  await db.query("UPDATE sandy_engineering_artifacts SET metadata=metadata-'kind' WHERE id=$1",[artifact]);
  await assert.rejects(install(),/fixed readiness artifact required/);passed++;
  await db.query("UPDATE sandy_engineering_artifacts SET metadata=$2 WHERE id=$1",[artifact,JSON.stringify(metadata)]);
  for (const [disable,restore] of [
    ["UPDATE auth.users SET raw_user_meta_data='{}'", "UPDATE auth.users SET raw_user_meta_data='{\"sandy_api_isolated_session_test\":true}'"],
    ["UPDATE email_customers SET google_drive_folder_status='pending'", "UPDATE email_customers SET google_drive_folder_status='excluded'"],
    ["UPDATE sandy_memory_settings SET learning_enabled=true", "UPDATE sandy_memory_settings SET learning_enabled=false"],
  ]) {
    await db.exec(disable);await assert.rejects(install(), /new isolated normal customer fixture required/);passed++;await db.exec(restore);
  }
  await install();
  await claims();
  assert.equal((await proof()).ok, true);
  passed++;
  await db.exec("UPDATE sandy_memory_settings SET proactive_enabled=true");assert.equal((await proof()).ok,false);passed++;
  await db.exec("UPDATE sandy_memory_settings SET proactive_enabled=false");
  for (
    const fields of [
      [artifact, deployment.replace("_61", "_60"), foreign, key, contract],
      [artifact, deployment, actor, key, contract],
      [artifact, deployment, foreign, "wrong-prefix", contract],
      [artifact, deployment, foreign, key, "c".repeat(64)],
    ]
  ) {
    assert.equal((await proof(...fields)).ok, false);
    passed++;
  }
  // Changing metadata invalidates the independently recorded full-row digest.
  await db.query(
    "UPDATE sandy_engineering_artifacts SET metadata=jsonb_set(metadata,'{max_mutations}','3') WHERE id=$1",
    [artifact],
  );
  assert.equal((await proof()).ok, false);
  passed++;
  await db.query(
    "UPDATE sandy_engineering_artifacts SET metadata=$2 WHERE id=$1",
    [artifact, JSON.stringify(metadata)],
  );
  await db.query(
    "UPDATE sandy_engineering_artifacts SET metadata=jsonb_set(metadata,'{expires_at}',to_jsonb((now()-interval '1 minute')::text)) WHERE id=$1",
    [artifact],
  );
  assert.equal((await proof()).ok, false);
  passed++;
  await db.query(
    "UPDATE sandy_engineering_artifacts SET metadata=$2 WHERE id=$1",
    [artifact, JSON.stringify(metadata)],
  );
  await db.query(
    "INSERT INTO sandy_controller_admins VALUES($1,'owner',true)",
    [actor],
  );
  assert.equal((await proof()).ok, false);
  passed++;
  await db.exec("DELETE FROM sandy_controller_admins");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    customer,
  ]);
  assert.equal((await proof()).ok, false);
  passed++;
  await claims();
  await db.exec("UPDATE sandy_memory_portal_accounts SET revoked_at=now()");
  assert.equal((await proof()).ok, false);
  passed++;
  await db.exec("UPDATE sandy_memory_portal_accounts SET revoked_at=NULL");
  const args = {
    id: foreign,
    confirm: true,
    new_value: "bounded certified fixture",
  };
  const call = async (k = key) =>
    (await db.query(
      "SELECT sandy_api_customer_mutation('memory.fact_correct',$1,$2) result",
      [JSON.stringify(args), k],
    )).rows[0].result;
  assert.equal((await call()).error, "operation_requires_live_verification");
  passed++;
  await db.query("SELECT set_config('request.headers',$1,false)", [
    JSON.stringify({
      "x-sandy-certification-id": artifact,
      "x-sandy-api-deployment-id": deployment,
    }),
  ]);
  const first = await call();
  assert.equal(first.ok, true);
  assert.equal(first.item.customer_id, customer);
  assert.ok(first.item.rejection_id);
  passed++;
  const replay = await call();
  assert.equal(replay.mutation_id, first.mutation_id);
  assert.equal(replay.reused, true);
  passed++;
  assert.equal(
    (await proof(artifact, deployment, foreign, key + "-another", contract))
      .error,
    "private_readiness_budget_exhausted",
  );
  passed++;
  assert.deepEqual(
    (await db.query(
      "SELECT api_exposed,ai_exposed,verified FROM sandy_operation_registry",
    )).rows,
    [{ api_exposed: false, ai_exposed: false, verified: false }],
  );
  passed++;
  await db.exec("SET ROLE service_role");
  try {
    await assert.rejects(
      db.query(
        "UPDATE sandy_engineering_change_events SET event_type='ordinary_event' WHERE event_type='memory_private_readiness_installed'",
      ),
      (e) => e.code === "42501",
    );
    passed++;
  } finally {
    await db.exec("RESET ROLE");
  }
  await claims(false);
  await db.query(
    "INSERT INTO sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES($1,'memory_private_readiness_revoked',NULL,$2)",
    [
      change,
      JSON.stringify({
        artifact_id: artifact,
        reason: "fixture acceptance complete",
      }),
    ],
  );
  await claims();
  assert.equal((await proof()).ok, false);
  passed++;
  assert.equal((await call()).ok, false);
  passed++;
  console.log(JSON.stringify({
    test_class: "isolated_postgresql_private_readiness",
    passed,
    new_grants: 0,
    new_tables_in_production_design: 0,
    global_flags_changed: false,
    actual_customer_or_MCP_acceptance: false,
  }));
});
