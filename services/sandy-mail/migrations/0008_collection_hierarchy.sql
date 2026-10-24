-- Preserve collections independently of message membership. No grants, roles,
-- provider state, deletions or changes to historical canary migrations.
ALTER TABLE core.mail_collections ADD COLUMN parent_id uuid,
 ADD COLUMN parent_kind text NOT NULL DEFAULT 'folder' CHECK(parent_kind='folder'),
 ADD CONSTRAINT collection_parent_kind CHECK(parent_id IS NULL OR (kind='folder' AND parent_id<>collection_id)),
 ADD FOREIGN KEY(tenant_id,account_id,mailbox_id,parent_id,parent_kind)
 REFERENCES core.mail_collections(tenant_id,account_id,mailbox_id,collection_id,kind);
ALTER TABLE core.mail_collections DROP CONSTRAINT mail_collections_tenant_id_account_id_mailbox_id_kind_norma_key;
ALTER TABLE core.mail_collections ADD CONSTRAINT collection_sibling_name
 UNIQUE NULLS NOT DISTINCT(tenant_id,account_id,mailbox_id,kind,parent_id,normalized_name);
-- Existing runtime has no collection UPDATE/DELETE permission. Keeping parent
-- edges immutable prevents later moves from introducing cycles; only insertions
-- under existing parents are exposed by this increment.
ALTER TABLE core.mail_import_items ADD COLUMN collection_receipt_id uuid;
ALTER TABLE core.mail_import_items ADD FOREIGN KEY(tenant_id,account_id,mailbox_id,collection_receipt_id)
 REFERENCES core.mail_edit_receipts(tenant_id,account_id,mailbox_id,receipt_id);
ALTER TABLE core.mail_import_items DROP CONSTRAINT mail_import_verified_binding;
ALTER TABLE core.mail_import_items ADD CONSTRAINT mail_import_verified_binding CHECK(
 (state<>'VERIFIED' AND message_id IS NULL AND receipt_id IS NULL AND draft_id IS NULL AND draft_receipt_id IS NULL AND collection_receipt_id IS NULL)
 OR (state='VERIFIED' AND coalesce(properties->>'record_kind','message')='message' AND message_id IS NOT NULL AND receipt_id IS NOT NULL AND draft_id IS NULL AND draft_receipt_id IS NULL AND collection_receipt_id IS NULL)
 OR (state='VERIFIED' AND coalesce(properties->>'record_kind','message')='draft' AND message_id IS NULL AND receipt_id IS NULL AND draft_id IS NOT NULL AND draft_receipt_id IS NOT NULL AND collection_receipt_id IS NULL)
 OR (state='VERIFIED' AND coalesce(properties->>'record_kind','message')='collections' AND message_id IS NULL AND receipt_id IS NULL AND draft_id IS NULL AND draft_receipt_id IS NULL AND collection_receipt_id IS NOT NULL)
);
