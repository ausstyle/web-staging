-- Explicit draft bindings reuse the import ledger without fabricating inbound
-- messages/receipts. Existing message constraints and forced RLS remain intact.
CREATE UNIQUE INDEX mail_edit_receipt_scope ON core.mail_edit_receipts(tenant_id,account_id,mailbox_id,receipt_id);
ALTER TABLE core.mail_import_items ADD COLUMN draft_id uuid, ADD COLUMN draft_receipt_id uuid;
ALTER TABLE core.mail_import_items ADD FOREIGN KEY(tenant_id,account_id,mailbox_id,draft_id) REFERENCES core.mail_drafts;
ALTER TABLE core.mail_import_items ADD FOREIGN KEY(tenant_id,account_id,mailbox_id,draft_receipt_id) REFERENCES core.mail_edit_receipts(tenant_id,account_id,mailbox_id,receipt_id);
ALTER TABLE core.mail_import_items DROP CONSTRAINT mail_import_items_check;
ALTER TABLE core.mail_import_items ADD CONSTRAINT mail_import_verified_binding CHECK(
 (state<>'VERIFIED' AND message_id IS NULL AND receipt_id IS NULL AND draft_id IS NULL AND draft_receipt_id IS NULL)
 OR (state='VERIFIED' AND coalesce(properties->>'record_kind','message')='message' AND message_id IS NOT NULL AND receipt_id IS NOT NULL AND draft_id IS NULL AND draft_receipt_id IS NULL)
 OR (state='VERIFIED' AND coalesce(properties->>'record_kind','message')='draft' AND message_id IS NULL AND receipt_id IS NULL AND draft_id IS NOT NULL AND draft_receipt_id IS NOT NULL)
);
