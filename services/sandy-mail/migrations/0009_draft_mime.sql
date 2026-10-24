-- MIME originals stay in immutable object storage, never inline mailbox SQL.
-- Existing RLS and tenant/mailbox primary keys remain authoritative.
ALTER TABLE core.mail_drafts ADD COLUMN mime_original jsonb;
ALTER TABLE core.mail_drafts ADD CONSTRAINT draft_mime_object CHECK (
 mime_original IS NULL OR ((
 jsonb_typeof(mime_original)='object' AND
 (mime_original ?& ARRAY['key','generation','sha256','size']) AND
 mime_original->>'key' LIKE 'mail/v1/' || tenant_id::text || '/' || account_id::text || '/' || mailbox_id::text || '/%' AND
 (mime_original->>'generation')::bigint>0 AND
 (mime_original->>'size')::bigint BETWEEN 1 AND 26214400 AND
 mime_original->>'sha256' ~ '^[a-f0-9]{64}$'
 ) IS TRUE));
-- An older plain-text writer must not silently change a rich projection while
-- retaining its original MIME. Rollback must also stop old export workers.
CREATE FUNCTION core.guard_draft_mime_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.mime_original IS NOT NULL AND NEW.mime_original IS NOT DISTINCT FROM OLD.mime_original
 AND (NEW.subject IS DISTINCT FROM OLD.subject OR NEW.recipients IS DISTINCT FROM OLD.recipients OR NEW.body_text IS DISTINCT FROM OLD.body_text) THEN
  RAISE EXCEPTION 'mime_draft_requires_full_mime_edit';
 END IF;
 IF OLD.mime_original IS NOT NULL AND NEW.mime_original IS NULL THEN
  RAISE EXCEPTION 'mime_draft_original_cannot_be_discarded';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION core.guard_draft_mime_projection() FROM PUBLIC;
CREATE TRIGGER mail_draft_mime_guard BEFORE UPDATE ON core.mail_drafts
FOR EACH ROW EXECUTE FUNCTION core.guard_draft_mime_projection();
