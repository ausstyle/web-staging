/** Real local PostgreSQL component checks; never production/provider acceptance. */
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { strict as assert } from "node:assert";
import { canonicalJson } from "../../supabase/functions/_shared/sandy_api_protocol.ts";
Deno.test("project creation custody enforces consumed admission, cost, identity, source and single use", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA vault;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_setting(''fixture.auth_role'',true)';
SELECT set_config('fixture.auth_role','service_role',false);
CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS 'SELECT sha256(convert_to($1,''UTF8''))';
CREATE FUNCTION public.sandy_api_current_owner(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT $1=''10000000-0000-4000-8000-000000000001''::uuid';
CREATE FUNCTION public.sandy_api_registry_revision(text) RETURNS text LANGUAGE sql AS 'SELECT repeat(''c'',64)';
CREATE TABLE public.sandy_operation_registry(operation text PRIMARY KEY,handler text,api_exposed boolean,verified boolean,error_contract jsonb);
CREATE TABLE public.sandy_api_execution_admissions(id uuid PRIMARY KEY,actor_id uuid,operation text,state text,expires_at timestamptz,is_mutation boolean,tenant_id uuid,credential_id uuid,declared_cost_units bigint,input_sha256 text,contract_sha256 text,registry_revision_sha256 text);
CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES('sandy-project-create-db-password:sandy-eng-fixture','isolated-noncredential-password');
INSERT INTO public.sandy_operation_registry VALUES('supabase.projects.create','sandy-provider-gap-api',true,true,jsonb_build_object('contract_sha256',repeat('b',64),'requires_cost_approval',true));
`);
    const migration = await Deno.readTextFile(
      "supabase/migrations/20261023160000_sandy_missing_supabase_contracts.sql",
    );
    await db.exec(migration.split("-- GENERATED_REGISTRY")[0] + "\nCOMMIT;");
    const args = canonicalJson({
      name: "sandy-eng-fixture",
      region: "eu-west-1",
    });
    const admission = "10000000-0000-4000-8000-000000000004";
    const insert = async () => {
      await db.exec(
        "DELETE FROM public.sandy_supabase_project_creation_dispatches; DELETE FROM public.sandy_api_execution_admissions;",
      );
      await db.query(
        `INSERT INTO public.sandy_api_execution_admissions VALUES($1,'10000000-0000-4000-8000-000000000001','supabase.projects.create','consumed',clock_timestamp()+interval '60 seconds',true,NULL,NULL,1,encode(extensions.digest($2,'sha256'),'hex'),repeat('b',64),repeat('c',64))`,
        [admission, args],
      );
    };
    const claim = () =>
      db.query(
        "SELECT public.sandy_supabase_project_creation_material($1,$2) AS material",
        [admission, args],
      );
    await t.step(
      "legitimate exact consumed fixture can claim existing material once",
      async () => {
        await insert();
        const result = await claim();
        assert.equal(result.rows.length, 1);
        assert.equal(
          (result.rows[0] as any).material,
          "isolated-noncredential-password",
        );
        await assert.rejects(claim);
        assert.equal(
          (await db.query(
            "SELECT * FROM public.sandy_supabase_project_creation_dispatches",
          )).rows.length,
          1,
        );
      },
    );
    for (
      const [name, change] of [
        ["unconsumed", "state='admitted'"],
        ["expired", "expires_at=clock_timestamp()-interval '1 second'"],
        ["zero budget", "declared_cost_units=0"],
        ["non-owner", "actor_id='10000000-0000-4000-8000-000000000099'"],
        ["tenant", "tenant_id='10000000-0000-4000-8000-000000000099'"],
        ["API key", "credential_id='10000000-0000-4000-8000-000000000099'"],
        ["wrong operation", "operation='supabase.projects.list'"],
        ["changed input", "input_sha256=repeat('a',64)"],
        ["changed contract", "contract_sha256=repeat('a',64)"],
        ["changed registry", "registry_revision_sha256=repeat('a',64)"],
      ]
    ) {
      await t.step(name + " is refused", async () => {
        await insert();
        await db.exec(
          "UPDATE public.sandy_api_execution_admissions SET " + change,
        );
        await assert.rejects(
          claim,
          /current_consumed_budgeted_creation_admission_required/,
        );
      });
    }
    await t.step(
      "caller cannot exchange material for different arguments",
      async () => {
        await insert();
        await assert.rejects(() =>
          db.query(
            "SELECT public.sandy_supabase_project_creation_material($1,$2)",
            [
              admission,
              canonicalJson({ name: "sandy-eng-other", region: "eu-west-1" }),
            ],
          )
        );
      },
    );
    await t.step(
      "missing or ambiguous existing custody is refused",
      async () => {
        await insert();
        await db.exec("UPDATE vault.decrypted_secrets SET name='unrelated'");
        await assert.rejects(
          claim,
          /existing_project_password_custody_required/,
        );
        await db.exec(
          "UPDATE vault.decrypted_secrets SET name='sandy-project-create-db-password:sandy-eng-fixture'; INSERT INTO vault.decrypted_secrets SELECT * FROM vault.decrypted_secrets;",
        );
        await assert.rejects(
          claim,
          /existing_project_password_custody_required/,
        );
        await db.exec(
          "DELETE FROM vault.decrypted_secrets; INSERT INTO vault.decrypted_secrets VALUES('sandy-project-create-db-password:sandy-eng-fixture','isolated-noncredential-password');",
        );
      },
    );
    await t.step(
      "public, anonymous and ordinary authenticated roles cannot claim material or read dispatches",
      async () => {
        await insert();
        for (const role of ["anon", "authenticated"]) {
          await db.exec("SET ROLE " + role);
          try {
            await assert.rejects(claim, /permission denied/);
            await assert.rejects(
              () =>
                db.query(
                  "SELECT * FROM public.sandy_supabase_project_creation_dispatches",
                ),
              /permission denied/,
            );
          } finally {
            await db.exec("RESET ROLE");
          }
        }
      },
    );
    await t.step(
      "unverified or disabled registry cannot expose custody",
      async () => {
        await insert();
        await db.exec(
          "UPDATE public.sandy_operation_registry SET verified=false",
        );
        await assert.rejects(claim);
        await db.exec(
          "UPDATE public.sandy_operation_registry SET verified=true,api_exposed=false",
        );
        await assert.rejects(claim);
      },
    );
  } finally {
    await db.close();
  }
});
