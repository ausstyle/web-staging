-- Recoverable intake envelope beside MIME; header recipients remain distinct from
-- SMTP envelope recipients. No mail is released from quarantine by this change.
CREATE TABLE core.intake_objects (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL, delivery_id text NOT NULL,
 object_key text NOT NULL, generation bigint NOT NULL CHECK (generation>0), sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'), size_bytes bigint NOT NULL,
 PRIMARY KEY (tenant_id,account_id,mailbox_id,delivery_id),
 FOREIGN KEY (tenant_id,account_id,mailbox_id,delivery_id) REFERENCES core.ingestions
);
CREATE TABLE core.recipients (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, mailbox_id uuid NOT NULL, message_id uuid NOT NULL,
 ordinal integer NOT NULL, kind text NOT NULL CHECK (kind IN ('From','Sender','Reply-To','To','Cc','Bcc')),
 display_name text NOT NULL, address text NOT NULL,
 PRIMARY KEY (tenant_id,account_id,mailbox_id,message_id,ordinal),
 FOREIGN KEY (tenant_id,account_id,mailbox_id,message_id) REFERENCES core.messages
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['intake_objects','recipients'] LOOP
  EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY scoped ON core.%I USING (tenant_id=nullif(current_setting(''mail.tenant_id'',true),'''')::uuid AND account_id=nullif(current_setting(''mail.account_id'',true),'''')::uuid AND mailbox_id=nullif(current_setting(''mail.mailbox_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''mail.tenant_id'',true),'''')::uuid AND account_id=nullif(current_setting(''mail.account_id'',true),'''')::uuid AND mailbox_id=nullif(current_setting(''mail.mailbox_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
REVOKE ALL ON core.intake_objects,core.recipients FROM PUBLIC;
