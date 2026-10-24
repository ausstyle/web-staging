-- PROPOSAL ONLY. Not in supabase/migrations; no deployment imports this file.
-- Shared API/Cloud extension of canonical files/admissions, not a file catalogue.
BEGIN;
CREATE SCHEMA sandy_artifact_custody;
REVOKE ALL ON SCHEMA sandy_artifact_custody FROM PUBLIC;
CREATE TABLE sandy_artifact_custody.scanner_releases (
 issuer text NOT NULL, release text NOT NULL,
 public_key_hex text NOT NULL CHECK(public_key_hex ~ '^[a-f0-9]{64}$'),
 trust_revision bigint NOT NULL CHECK(trust_revision>0),
 revoked_at timestamptz,
 PRIMARY KEY(issuer,release)
);
CREATE FUNCTION sandy_artifact_custody.scanner_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
 OR (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') THEN
 RAISE EXCEPTION 'IMMUTABLE_SCANNER_RELEASE';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scanner_transition BEFORE UPDATE OR DELETE ON sandy_artifact_custody.scanner_releases
 FOR EACH ROW EXECUTE FUNCTION sandy_artifact_custody.scanner_transition();
CREATE TABLE sandy_artifact_custody.scan_receipts (
 id uuid PRIMARY KEY, artifact_id uuid NOT NULL,
 file_id uuid NOT NULL REFERENCES public.sandy_universal_files(id),
 admission_id uuid NOT NULL REFERENCES public.sandy_api_execution_admissions(id),
 issuer text NOT NULL, release text NOT NULL, trust_revision bigint NOT NULL,
 attestation jsonb NOT NULL, signature_hex text NOT NULL CHECK(signature_hex ~ '^[a-f0-9]{128}$'),
 expires_at timestamptz NOT NULL,
 FOREIGN KEY(issuer,release) REFERENCES sandy_artifact_custody.scanner_releases
);
CREATE TABLE sandy_artifact_custody.claims (
 artifact_id uuid PRIMARY KEY,
 receipt_id uuid NOT NULL UNIQUE REFERENCES sandy_artifact_custody.scan_receipts(id),
 admission_id uuid NOT NULL REFERENCES public.sandy_api_execution_admissions(id),
 binding_sha256 text NOT NULL CHECK(binding_sha256 ~ '^[a-f0-9]{64}$'),
 authority_revision text NOT NULL,
 lease_token uuid NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN('CLAIMED','SEALED','ABANDONED')),
 private_handle text UNIQUE, proof jsonb,
 CHECK ((state='SEALED' AND private_handle IS NOT NULL AND proof IS NOT NULL)
   OR (state<>'SEALED' AND private_handle IS NULL AND proof IS NULL))
);
CREATE FUNCTION sandy_artifact_custody.immutable_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_SCAN_RECEIPT'; END $$;
CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE ON sandy_artifact_custody.scan_receipts
 FOR EACH ROW EXECUTE FUNCTION sandy_artifact_custody.immutable_receipt();
CREATE FUNCTION sandy_artifact_custody.claim_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state<>'CLAIMED' OR NEW.state NOT IN('SEALED','ABANDONED')
 OR (to_jsonb(NEW)-ARRAY['state','private_handle','proof']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','private_handle','proof']) THEN
 RAISE EXCEPTION 'TERMINAL_CUSTODY_CLAIM';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER claim_transition BEFORE UPDATE OR DELETE ON sandy_artifact_custody.claims
 FOR EACH ROW EXECUTE FUNCTION sandy_artifact_custody.claim_transition();
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['scanner_releases','scan_receipts','claims'] LOOP
 EXECUTE format('ALTER TABLE sandy_artifact_custody.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE sandy_artifact_custody.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON sandy_artifact_custody.%I FROM PUBLIC',t);
 END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sandy_artifact_custody FROM PUBLIC;
COMMIT;
