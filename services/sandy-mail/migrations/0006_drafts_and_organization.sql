-- Additive Mail-domain state. A mailbox remains the authorization/storage
-- container; folders/labels organize messages without changing original scopes.
CREATE TABLE core.mail_drafts (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,draft_id uuid NOT NULL,
 subject text NOT NULL CHECK(octet_length(subject)<=998),recipients text[] NOT NULL CHECK(cardinality(recipients)<=50),
 body_text text NOT NULL CHECK(octet_length(body_text)<=65536),revision bigint NOT NULL CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,account_id,mailbox_id,draft_id),
 FOREIGN KEY(tenant_id,account_id,mailbox_id) REFERENCES core.mailboxes
);
CREATE INDEX mail_drafts_page ON core.mail_drafts(tenant_id,account_id,mailbox_id,updated_at DESC,draft_id DESC);
CREATE TABLE core.mail_collections (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,collection_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('folder','label')),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 normalized_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,account_id,mailbox_id,collection_id),
 UNIQUE(tenant_id,account_id,mailbox_id,collection_id,kind),
 UNIQUE(tenant_id,account_id,mailbox_id,kind,normalized_name),
 FOREIGN KEY(tenant_id,account_id,mailbox_id) REFERENCES core.mailboxes
);
CREATE TABLE core.mail_message_organization (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,message_id uuid NOT NULL,
 folder_id uuid,folder_kind text NOT NULL DEFAULT 'folder' CHECK(folder_kind='folder'),revision bigint NOT NULL CHECK(revision>0),
 PRIMARY KEY(tenant_id,account_id,mailbox_id,message_id),
 FOREIGN KEY(tenant_id,account_id,mailbox_id,message_id) REFERENCES core.messages,
 FOREIGN KEY(tenant_id,account_id,mailbox_id,folder_id,folder_kind) REFERENCES core.mail_collections(tenant_id,account_id,mailbox_id,collection_id,kind)
);
CREATE INDEX mail_message_folder ON core.mail_message_organization(tenant_id,account_id,mailbox_id,folder_id,message_id);
CREATE TABLE core.mail_message_labels (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,message_id uuid NOT NULL,label_id uuid NOT NULL,
 label_kind text NOT NULL DEFAULT 'label' CHECK(label_kind='label'),active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(tenant_id,account_id,mailbox_id,message_id,label_id),
 FOREIGN KEY(tenant_id,account_id,mailbox_id,message_id) REFERENCES core.messages,
 FOREIGN KEY(tenant_id,account_id,mailbox_id,label_id,label_kind) REFERENCES core.mail_collections(tenant_id,account_id,mailbox_id,collection_id,kind)
);
CREATE INDEX mail_active_label ON core.mail_message_labels(tenant_id,account_id,mailbox_id,label_id,message_id) WHERE active;
-- Domain receipts, not another operation gateway, scheduler or dispatch queue.
-- No recipient delivery or provider verification may be inferred from these rows.
CREATE TABLE core.mail_edit_receipts (
 tenant_id uuid NOT NULL,account_id uuid NOT NULL,mailbox_id uuid NOT NULL,
 actor_ref text NOT NULL CHECK(length(actor_ref) BETWEEN 1 AND 200),mutation_key uuid NOT NULL,
 operation text NOT NULL,input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 receipt_id uuid NOT NULL UNIQUE,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,account_id,mailbox_id,actor_ref,mutation_key),
 FOREIGN KEY(tenant_id,account_id,mailbox_id) REFERENCES core.mailboxes
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['mail_drafts','mail_collections','mail_message_organization','mail_message_labels','mail_edit_receipts'] LOOP
  EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY scoped ON core.%I USING(tenant_id=nullif(current_setting(''mail.tenant_id'',true),'''')::uuid AND account_id=nullif(current_setting(''mail.account_id'',true),'''')::uuid AND mailbox_id=nullif(current_setting(''mail.mailbox_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''mail.tenant_id'',true),'''')::uuid AND account_id=nullif(current_setting(''mail.account_id'',true),'''')::uuid AND mailbox_id=nullif(current_setting(''mail.mailbox_id'',true),'''')::uuid)',t);
  EXECUTE format('REVOKE ALL ON core.%I FROM PUBLIC',t);
 END LOOP;
END $$;
