-- Dedicated Sandy Mail Cloud SQL database only. No Supabase migration.
CREATE SCHEMA core;
REVOKE ALL ON SCHEMA core FROM PUBLIC;
CREATE TABLE core.tenants (
 tenant_id uuid PRIMARY KEY, region text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core.mail_accounts (
 tenant_id uuid NOT NULL REFERENCES core.tenants, account_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('hosted','connected')), provider text NOT NULL,
 PRIMARY KEY (tenant_id,account_id)
);
CREATE TABLE core.mailboxes (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL, name text NOT NULL,
 PRIMARY KEY (tenant_id,account_id,mailbox_id),
 FOREIGN KEY (tenant_id,account_id) REFERENCES core.mail_accounts
);
CREATE TABLE core.ingestions (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL,
 delivery_id text NOT NULL CHECK (length(delivery_id) BETWEEN 1 AND 200),
 input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
 raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
 raw_size bigint NOT NULL CHECK (raw_size > 0 AND raw_size <= 26214400),
 raw_key text NOT NULL, envelope jsonb NOT NULL, source text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','complete')),
 attempts integer NOT NULL DEFAULT 0, last_error text, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,account_id,mailbox_id,delivery_id),
 FOREIGN KEY (tenant_id,account_id,mailbox_id) REFERENCES core.mailboxes
);
CREATE INDEX ingestion_pending ON core.ingestions (tenant_id,account_id,mailbox_id,updated_at) WHERE state='pending';
CREATE TABLE core.messages (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL, message_id uuid NOT NULL,
 delivery_id text NOT NULL, internet_message_id text NOT NULL, subject text NOT NULL,
 headers jsonb NOT NULL, sent_at timestamptz, received_at timestamptz NOT NULL,
 security_state text NOT NULL DEFAULT 'quarantined' CHECK (security_state IN ('quarantined','clean','blocked')),
 PRIMARY KEY (tenant_id,account_id,mailbox_id,message_id),
 UNIQUE (tenant_id,account_id,mailbox_id,delivery_id),
 FOREIGN KEY (tenant_id,account_id,mailbox_id,delivery_id) REFERENCES core.ingestions
);
CREATE INDEX inbox_keyset ON core.messages (tenant_id,account_id,mailbox_id,received_at DESC,message_id DESC);
CREATE TABLE core.envelopes (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL, message_id uuid NOT NULL,
 sender text NOT NULL, recipients jsonb NOT NULL,
 PRIMARY KEY (tenant_id,account_id,mailbox_id,message_id),
 FOREIGN KEY (tenant_id,account_id,mailbox_id,message_id) REFERENCES core.messages
);
CREATE TABLE core.bodies (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL, message_id uuid NOT NULL,
 text_body text NOT NULL, html_source text NOT NULL, display_html text NOT NULL,
 PRIMARY KEY (tenant_id,account_id,mailbox_id,message_id),
 FOREIGN KEY (tenant_id,account_id,mailbox_id,message_id) REFERENCES core.messages
);
CREATE TABLE core.mime_objects (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL, message_id uuid NOT NULL,
 object_key text NOT NULL, generation bigint NOT NULL CHECK (generation > 0), sha256 text NOT NULL, size_bytes bigint NOT NULL,
 PRIMARY KEY (tenant_id,account_id,mailbox_id,message_id),
 FOREIGN KEY (tenant_id,account_id,mailbox_id,message_id) REFERENCES core.messages
);
CREATE TABLE core.attachments (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL, message_id uuid NOT NULL,
 ordinal integer NOT NULL, filename text NOT NULL, content_type text NOT NULL, content_id text NOT NULL,
 object_key text NOT NULL, generation bigint NOT NULL CHECK (generation > 0), sha256 text NOT NULL, size_bytes bigint NOT NULL,
 scan_state text NOT NULL DEFAULT 'pending' CHECK (scan_state IN ('pending','clean','blocked')),
 PRIMARY KEY (tenant_id,account_id,mailbox_id,message_id,ordinal),
 FOREIGN KEY (tenant_id,account_id,mailbox_id,message_id) REFERENCES core.messages
);
CREATE TABLE core.memberships (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL, message_id uuid NOT NULL,
 flags text[] NOT NULL DEFAULT '{}',
 PRIMARY KEY (tenant_id,account_id,mailbox_id,message_id),
 FOREIGN KEY (tenant_id,account_id,mailbox_id,message_id) REFERENCES core.messages
);
CREATE TABLE core.inbound_receipts (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL, message_id uuid NOT NULL,
 receipt_id uuid NOT NULL UNIQUE, delivery_id text NOT NULL, raw_sha256 text NOT NULL,
 object_key text NOT NULL, generation bigint NOT NULL, attachment_count integer NOT NULL,
 release_ref text NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,account_id,mailbox_id,message_id),
 FOREIGN KEY (tenant_id,account_id,mailbox_id,message_id) REFERENCES core.messages
);
CREATE TABLE core.outbox (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL, message_id uuid NOT NULL,
 event_id uuid NOT NULL UNIQUE, event_type text NOT NULL DEFAULT 'mail.message.quarantined.v1',
 created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 PRIMARY KEY (tenant_id,account_id,mailbox_id,message_id),
 FOREIGN KEY (tenant_id,account_id,mailbox_id,message_id) REFERENCES core.messages
);
-- Context is supplied ONLY by the authenticated service, never by customer SQL access.
-- FORCE applies even to owners; the runtime must additionally be non-owner/NOBYPASSRLS.
DO $policy$
DECLARE t text; predicate text;
BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='core' LOOP
  predicate := 'tenant_id = nullif(current_setting(''mail.tenant_id'',true),'''')::uuid';
  IF t <> 'tenants' THEN predicate := predicate || ' AND account_id = nullif(current_setting(''mail.account_id'',true),'''')::uuid'; END IF;
  IF t NOT IN ('tenants','mail_accounts') THEN predicate := predicate || ' AND mailbox_id = nullif(current_setting(''mail.mailbox_id'',true),'''')::uuid'; END IF;
  EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY scoped ON core.%I USING (%s) WITH CHECK (%s)',t,predicate,predicate);
 END LOOP;
END $policy$;
REVOKE ALL ON ALL TABLES IN SCHEMA core FROM PUBLIC;
