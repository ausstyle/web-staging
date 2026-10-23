"""Run synthetic account isolation tests in a fresh network-isolated local Postgres.
No URL, credential, production database, or existing container is accepted.
"""
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IMAGE = 'postgres:17-alpine@sha256:e4cb93687b062cd25a0e8f672d85a7708235009d70d31f8a7698d9370092a9c4'
BOOTSTRAP = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
CREATE TABLE public.sandy_operation_registry(operation text primary key,domain text,description text,permission_scope text,is_mutation boolean,input_schema jsonb,output_schema jsonb,handler text,api_exposed boolean,ui_exposed boolean,ai_exposed boolean,verified boolean,implementation_state text,source_repository text,source_path text,error_contract jsonb);
CREATE TABLE auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean,raw_app_meta_data jsonb default '{}'::jsonb);
CREATE TABLE public.email_customers(id uuid primary key);
CREATE TABLE public.email_customer_addresses(customer_id uuid, normalized_email text,is_primary boolean);
CREATE TABLE public.sandy_memory_portal_accounts(auth_user_id uuid,customer_id uuid,revoked_at timestamptz);
"""


def main():
    container = 'sandy-hosting-test-' + uuid.uuid4().hex
    started = False
    try:
        subprocess.run(['docker', 'run', '-d', '--name', container, '--network', 'none',
                        '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE], check=True, capture_output=True)
        started = True
        for _ in range(40):
            if subprocess.run(['docker', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError('isolated_postgres_not_ready')
        source = (ROOT / 'supabase/migrations/20261021140000_sandy_customer_provisioning.sql').read_text()
        bootstrap = BOOTSTRAP
        for start, end in [
            ('CREATE TABLE public.sandy_customer_provisioning_receipts', 'DO $$ DECLARE name'),
            ('CREATE FUNCTION public.sandy_provisioning_customer_id()', 'CREATE FUNCTION public.sandy_provisioning_workspace_verified'),
        ]:
            bootstrap += source[source.index(start):source.index(end)]
        for sql in [bootstrap,
                    (ROOT / 'supabase/migrations/20261024010000_sandy_hosting_logical_accounts.sql').read_text(),
                    (ROOT / 'supabase/migrations/20261024010010_sandy_hosting_account_contracts.sql').read_text(),
                    (ROOT / 'scripts/sandy/test_hosting_accounts.sql').read_text()]:
            subprocess.run(['docker', 'exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, check=True)
        print('Isolated logical-account SQL checks passed; no live account or provider effect')
    finally:
        if started:
            subprocess.run(['docker', 'rm', '-fv', container], check=True, capture_output=True)


if __name__ == '__main__':
    main()
