-- Persist snapshot facts before provider work. Original mailbox rows are never
-- updated by exports. No roles, grants, scheduler or download route is created.
CREATE TABLE core.mail_export_jobs (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,job_id uuid NOT NULL,
 job_key text NOT NULL,input_sha256 text NOT NULL,spec jsonb NOT NULL,
 snapshot_at timestamptz NOT NULL,mailbox_name text NOT NULL,expected_messages bigint NOT NULL,
 pending_ingestions bigint NOT NULL,state text NOT NULL CHECK(state IN ('BUILDING','VERIFYING','COMPLETE','COMPLETED_WITH_EXCEPTIONS','NEEDS_ACTION','CANCELLED','EXPIRED')),
 cursor bigint NOT NULL DEFAULT 0,verified_part bigint NOT NULL DEFAULT 0,verified_chain text NOT NULL DEFAULT '',report_object jsonb,
 PRIMARY KEY(tenant_id,account_id,mailbox_id,job_id),UNIQUE(tenant_id,account_id,mailbox_id,job_key),
 FOREIGN KEY(tenant_id,account_id,mailbox_id) REFERENCES core.mailboxes
);
CREATE TABLE core.mail_export_items (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,job_id uuid NOT NULL,
 ordinal bigint NOT NULL,snapshot jsonb NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','EXPORTED','EXCEPTION')),
 part_number bigint,
 PRIMARY KEY(tenant_id,account_id,mailbox_id,job_id,ordinal),
 FOREIGN KEY(tenant_id,account_id,mailbox_id,job_id) REFERENCES core.mail_export_jobs
);
CREATE TABLE core.mail_export_parts (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,job_id uuid NOT NULL,
 part_number bigint NOT NULL,first_ordinal bigint NOT NULL,last_ordinal bigint NOT NULL,
 exported bigint NOT NULL,excluded bigint NOT NULL,descriptor jsonb NOT NULL,
 PRIMARY KEY(tenant_id,account_id,mailbox_id,job_id,part_number),
 FOREIGN KEY(tenant_id,account_id,mailbox_id,job_id) REFERENCES core.mail_export_jobs
);
CREATE TABLE core.mail_export_exceptions (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,job_id uuid NOT NULL,
 source_key text NOT NULL,ordinal bigint,code text NOT NULL,retryable boolean NOT NULL,
 resolved boolean NOT NULL DEFAULT false,evidence jsonb NOT NULL,
 PRIMARY KEY(tenant_id,account_id,mailbox_id,job_id,source_key),
 FOREIGN KEY(tenant_id,account_id,mailbox_id,job_id) REFERENCES core.mail_export_jobs
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['mail_export_jobs','mail_export_items','mail_export_parts','mail_export_exceptions'] LOOP
  EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY scoped ON core.%I USING(tenant_id=nullif(current_setting(''mail.tenant_id'',true),'''')::uuid AND account_id=nullif(current_setting(''mail.account_id'',true),'''')::uuid AND mailbox_id=nullif(current_setting(''mail.mailbox_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''mail.tenant_id'',true),'''')::uuid AND account_id=nullif(current_setting(''mail.account_id'',true),'''')::uuid AND mailbox_id=nullif(current_setting(''mail.mailbox_id'',true),'''')::uuid)',t);
  EXECUTE format('REVOKE ALL ON core.%I FROM PUBLIC',t);
 END LOOP;
END $$;
