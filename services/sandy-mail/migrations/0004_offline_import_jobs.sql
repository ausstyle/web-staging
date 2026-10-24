-- Mail-domain import state, driven by the existing worker/release owner. No new
-- scheduler, identity, role, grant or public API. Preserve all source objects.
CREATE TABLE core.mail_import_jobs (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,job_id uuid NOT NULL,
 job_key text NOT NULL CHECK(length(job_key) BETWEEN 1 AND 200),input_sha256 text NOT NULL,
 spec jsonb NOT NULL,state text NOT NULL CHECK(state IN ('STAGING','DISCOVERING','IMPORTING','VERIFYING','COMPLETE','COMPLETED_WITH_EXCEPTIONS','NEEDS_ACTION','PAUSED')),
 inventory_complete boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,account_id,mailbox_id,job_id),UNIQUE(tenant_id,account_id,mailbox_id,job_key),
 FOREIGN KEY(tenant_id,account_id,mailbox_id) REFERENCES core.mailboxes
);
CREATE TABLE core.mail_import_sources (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,job_id uuid NOT NULL,
 source_key text NOT NULL,manifest jsonb NOT NULL,complete boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,account_id,mailbox_id,job_id,source_key),
 FOREIGN KEY(tenant_id,account_id,mailbox_id,job_id) REFERENCES core.mail_import_jobs
);
CREATE UNIQUE INDEX receipt_import_binding ON core.inbound_receipts(tenant_id,account_id,mailbox_id,message_id,receipt_id);
CREATE TABLE core.mail_import_items (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,job_id uuid NOT NULL,
 ordinal bigint NOT NULL CHECK(ordinal>0),source_key text NOT NULL,source_path text NOT NULL,source_folder text NOT NULL,
 original_object jsonb NOT NULL,raw_sha256 text NOT NULL,raw_size bigint NOT NULL CHECK(raw_size>0),
 envelope jsonb NOT NULL,flags text[] NOT NULL DEFAULT '{}',properties jsonb NOT NULL,
 delivery_id text NOT NULL,state text NOT NULL CHECK(state IN ('PENDING','VERIFIED','EXCEPTION')),
 message_id uuid,receipt_id uuid,
 PRIMARY KEY(tenant_id,account_id,mailbox_id,job_id,ordinal),UNIQUE(tenant_id,account_id,mailbox_id,job_id,source_key),
 FOREIGN KEY(tenant_id,account_id,mailbox_id,job_id) REFERENCES core.mail_import_jobs,
 FOREIGN KEY(tenant_id,account_id,mailbox_id,message_id,receipt_id) REFERENCES core.inbound_receipts(tenant_id,account_id,mailbox_id,message_id,receipt_id),
 CHECK((state='VERIFIED' AND message_id IS NOT NULL AND receipt_id IS NOT NULL) OR (state<>'VERIFIED' AND message_id IS NULL AND receipt_id IS NULL))
);
CREATE TABLE core.mail_import_checkpoints (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,job_id uuid NOT NULL,
 phase text NOT NULL,cursor bigint NOT NULL DEFAULT 0 CHECK(cursor>=0),item_count bigint NOT NULL DEFAULT 0,
 chain_sha256 text NOT NULL DEFAULT '',
 PRIMARY KEY(tenant_id,account_id,mailbox_id,job_id,phase),
 FOREIGN KEY(tenant_id,account_id,mailbox_id,job_id) REFERENCES core.mail_import_jobs
);
CREATE TABLE core.mail_import_exceptions (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,job_id uuid NOT NULL,
 exception_key text NOT NULL,item_ordinal bigint,code text NOT NULL,retryable boolean NOT NULL,
 evidence jsonb NOT NULL,resolved boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,account_id,mailbox_id,job_id,exception_key),
 FOREIGN KEY(tenant_id,account_id,mailbox_id,job_id) REFERENCES core.mail_import_jobs
);
CREATE TABLE core.mail_import_reconciliation (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,job_id uuid NOT NULL,
 expected bigint NOT NULL,verified bigint NOT NULL,exceptions bigint NOT NULL,pending bigint NOT NULL,
 verified_bytes bigint NOT NULL,chain_sha256 text NOT NULL,report_object jsonb NOT NULL,
 PRIMARY KEY(tenant_id,account_id,mailbox_id,job_id),
 FOREIGN KEY(tenant_id,account_id,mailbox_id,job_id) REFERENCES core.mail_import_jobs,
 CHECK(expected=verified+exceptions+pending),CHECK(pending=0)
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['mail_import_jobs','mail_import_sources','mail_import_items','mail_import_checkpoints','mail_import_exceptions','mail_import_reconciliation'] LOOP
  EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY scoped ON core.%I USING(tenant_id=nullif(current_setting(''mail.tenant_id'',true),'''')::uuid AND account_id=nullif(current_setting(''mail.account_id'',true),'''')::uuid AND mailbox_id=nullif(current_setting(''mail.mailbox_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''mail.tenant_id'',true),'''')::uuid AND account_id=nullif(current_setting(''mail.account_id'',true),'''')::uuid AND mailbox_id=nullif(current_setting(''mail.mailbox_id'',true),'''')::uuid)',t);
  EXECUTE format('REVOKE ALL ON core.%I FROM PUBLIC',t);
 END LOOP;
END $$;
