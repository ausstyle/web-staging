// Isolated PostgreSQL fixtures. Never connects to Supabase or real Auth/customer data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : "@electric-sql/pglite");
const db = new PGlite(); let assertions = 0;
const owner = "10000000-0000-4000-8000-000000000001", workload = "20000000-0000-4000-8000-000000000002";
const change = "30000000-0000-4000-8000-000000000003", source = "a".repeat(40), manifest = "b".repeat(64);
const expect = async (name, action) => { await action(); assertions++; };
try {
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb);
 CREATE TABLE sandy_controller_admins(auth_user_id uuid,enabled boolean,role text);
 CREATE TABLE sandy_engineering_delegation_policy(id integer PRIMARY KEY,enabled boolean,allowed_risks text[],allowed_operations text[],
 require_authenticated_admin boolean,require_change_record boolean,require_test_evidence boolean,require_rollback_plan boolean,updated_at timestamptz);
 INSERT INTO sandy_engineering_delegation_policy VALUES(1,true,ARRAY['critical'],ARRAY['supabase_deploy_function'],true,true,false,false,now());
 CREATE TABLE sandy_engineering_changes(id uuid PRIMARY KEY,status text,risk text,scope jsonb,expected_behavior text,updated_at timestamptz);
 CREATE TABLE sandy_engineering_tests(change_id uuid,outcome text,checked_at timestamptz,evidence jsonb);
 CREATE TABLE sandy_engineering_change_events(id uuid DEFAULT gen_random_uuid(),change_id uuid,event_type text,actor uuid,detail jsonb);
 INSERT INTO auth.users VALUES('${owner}','{}'),('${workload}','{"sandy_engineering_test":true}');
 INSERT INTO sandy_controller_admins VALUES('${owner}',true,'owner'),('${workload}',true,'owner');`);
await db.exec(await readFile(new URL("../../supabase/migrations/20261022110000_sandy_owner_routine_delegation.sql", import.meta.url), "utf8"));
const reset = async () => { await db.query("DELETE FROM sandy_engineering_change_events WHERE change_id=$1",[change]);
 await db.query("DELETE FROM sandy_engineering_tests WHERE change_id=$1",[change]);
 await db.query("DELETE FROM sandy_engineering_changes WHERE id=$1",[change]);
 await db.query("INSERT INTO sandy_engineering_changes VALUES($1,'proposed','normal',$2,$3,now())",[change,JSON.stringify(["sandy-agent-runtime-v4","github:ausstyle/web-staging:engineering/sandy-unified-intelligence-20261021"]),`Release ${source}; manifest ${manifest}`]); };
const status = async () => (await db.query("SELECT status FROM sandy_engineering_changes WHERE id=$1",[change])).rows[0].status;
const config={targets:["sandy-agent-runtime-v4"],reviewers:["reviewer"],baseline_commit:"c".repeat(40),workflow_sha256:"d".repeat(64),expires_at:new Date(Date.now()+86400000).toISOString()};
await expect("workload cannot authorize policy even with a misleading Controller membership",async()=>{
 await assert.rejects(db.query("SELECT sandy_engineering_set_standing_delegation($1,true,$2)",[workload,JSON.stringify(config)]));
});
await expect("normal authenticated role cannot invoke internal approval RPC",async()=>{
 await db.exec("SET ROLE authenticated"); try { await assert.rejects(db.query("SELECT public.sandy_engineering_record_owner_approval($1,$2,'fixture')",[owner,change])); } finally { await db.exec("RESET ROLE"); }
});
await reset();
await expect("workload cannot record owner approval",async()=>{await assert.rejects(db.query("SELECT sandy_engineering_record_owner_approval($1,$2,'fixture')",[workload,change]));assert.equal(await status(),"proposed");});
await expect("owner action records approval plus actual actor atomically",async()=>{
 await db.query("SELECT sandy_engineering_record_owner_approval($1,$2,$3)",[owner,change,`Release ${source}; manifest ${manifest}`]);
 assert.equal(await status(),"approved");const rows=await db.query("SELECT actor,detail->>'to' AS target FROM sandy_engineering_change_events WHERE change_id=$1",[change]);assert.deepEqual(rows.rows,[{actor:owner,target:"approved"}]);
});
await reset();
await expect("unattested administrative status can receive a real owner attestation without resetting status",async()=>{
 await db.query("UPDATE sandy_engineering_changes SET status='approved' WHERE id=$1",[change]);
 await db.query("INSERT INTO sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES($1,'owner_directive_manual_db_approval',NULL,'{\"owner_session_verified\":false}')",[change]);
 await assert.rejects(db.query("SELECT sandy_engineering_record_owner_approval($1,$2,'wrong source')",[owner,change]));
 await assert.rejects(db.query("SELECT sandy_engineering_record_owner_approval($1,$2,$3)",[workload,change,`Release ${source}; manifest ${manifest}`]));
 await db.query("SELECT sandy_engineering_record_owner_approval($1,$2,$3)",[owner,change,`Release ${source}; manifest ${manifest}`]);
 const rows=(await db.query("SELECT event_type,actor,detail FROM sandy_engineering_change_events WHERE change_id=$1 ORDER BY event_type",[change])).rows;
 assert.equal(rows.length,2);assert.equal(rows[0].actor,null);assert.equal(rows[1].event_type,"owner_release_attested");assert.equal(rows[1].actor,owner);assert.equal(rows[1].detail.owner_session_authenticated,true);assert.equal(await status(),"approved");
});
await reset();
await expect("audit failure rolls back approval status",async()=>{
 await db.exec("CREATE FUNCTION deny_fixture_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER deny_fixture BEFORE INSERT ON sandy_engineering_change_events FOR EACH ROW EXECUTE FUNCTION deny_fixture_audit();");
 try { await assert.rejects(db.query("SELECT sandy_engineering_record_owner_approval($1,$2,'fixture')",[owner,change]));assert.equal(await status(),"proposed"); }
 finally { await db.exec("DROP TRIGGER deny_fixture ON sandy_engineering_change_events; DROP FUNCTION deny_fixture_audit();"); }
});
await expect("owner enables bounded policy and hardens legacy broad settings",async()=>{
 await db.query("SELECT sandy_engineering_set_standing_delegation($1,true,$2)",[owner,JSON.stringify(config)]);
 const p=(await db.query("SELECT * FROM sandy_engineering_delegation_policy")).rows[0];assert.deepEqual(p.allowed_risks,["low","normal"]);assert.equal(p.require_test_evidence,true);assert.equal(p.require_rollback_plan,true);assert.equal(p.standing_authorized_by,owner);
});
const proof={repository:"ausstyle/web-staging",source_commit:source,manifest_sha256:manifest,workflow_sha256:config.workflow_sha256,compared_from:config.baseline_commit,review_ids:[1],check_run_id:10};
const evidence={source_commit:source,manifest_sha256:manifest,release_manifest:{source_commit:source}};
await db.query("INSERT INTO sandy_engineering_tests VALUES($1,'passed',now(),$2)",[change,JSON.stringify(evidence)]);
const approve = async (revision, actor=owner, p=proof) => { const c=(await db.query("SELECT updated_at FROM sandy_engineering_changes WHERE id=$1",[change])).rows[0];return db.query("SELECT sandy_engineering_apply_standing_delegation($1,$2,$3,$4,$5,$6,$7)",[actor,change,revision,c.updated_at,source,manifest,JSON.stringify(p)]); };
await expect("wrong policy revision cannot authorize",async()=>{await assert.rejects(approve(0));assert.equal(await status(),"proposed");});
await expect("workload cannot call standing owner approval",async()=>{await assert.rejects(approve(1,workload));assert.equal(await status(),"proposed");});
await expect("missing trusted review proof cannot authorize",async()=>{await assert.rejects(approve(1,owner,{...proof,review_ids:[]}));assert.equal(await status(),"proposed");});
await expect("high risk remains excluded despite standing policy",async()=>{await db.query("UPDATE sandy_engineering_changes SET risk='high' WHERE id=$1",[change]);await assert.rejects(approve(1));assert.equal(await status(),"proposed");await db.query("UPDATE sandy_engineering_changes SET risk='normal' WHERE id=$1",[change]);});
await expect("eligible owner policy action records review-linked approval",async()=>{await approve(1);assert.equal(await status(),"approved");assert.equal((await db.query("SELECT detail->>'approval_mode' AS mode FROM sandy_engineering_change_events WHERE change_id=$1",[change])).rows[0].mode,"standing_owner_policy");});
await reset(); await db.query("INSERT INTO sandy_engineering_tests VALUES($1,'passed',now(),$2)",[change,JSON.stringify(evidence)]);
await expect("revocation immediately stops eligible approvals",async()=>{await db.query("SELECT sandy_engineering_set_standing_delegation($1,false,'{}')",[owner]);await assert.rejects(approve(2));assert.equal(await status(),"proposed");});
console.log(JSON.stringify({test_class:"isolated_postgresql_wasm",assertions,passed:true,production_database_used:false}));
} finally { await db.close(); }
