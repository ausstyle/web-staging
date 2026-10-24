-- Candidate additive extension, NOT an installed Supabase migration.
-- No identities, policies, API exposure or grants are installed by this file.
-- Canonical universal-file rows remain owned by the existing file service.
-- Install only after owner review, source preservation and a protected release.
BEGIN;
CREATE SCHEMA sandy_cloud;
REVOKE ALL ON SCHEMA sandy_cloud FROM PUBLIC;
CREATE TABLE sandy_cloud.workspaces (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  customer_id uuid NOT NULL,
  quota_bytes bigint NOT NULL CHECK (quota_bytes BETWEEN 0 AND 9007199254740991),
  used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  policy_epoch bigint NOT NULL CHECK (policy_epoch > 0),
  PRIMARY KEY (tenant_id, workspace_id),
  CHECK (used_bytes + reserved_bytes <= quota_bytes)
);
-- An extension of an existing canonical file, not an alternative file catalogue.
CREATE TABLE sandy_cloud.file_heads (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  file_id uuid NOT NULL REFERENCES public.sandy_universal_files(id),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740990),
  current_version_id uuid,
  PRIMARY KEY (tenant_id, workspace_id, file_id),
  UNIQUE (file_id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES sandy_cloud.workspaces
);
-- Populated only by the admitted transfer owner after reserving quota in the
-- same transaction. No client-supplied scan proof or SQL endpoint is provided.
CREATE TABLE sandy_cloud.upload_intents (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  intent_id text NOT NULL,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  file_id uuid NOT NULL,
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  ref jsonb NOT NULL CHECK (jsonb_typeof(ref) = 'object'),
  expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
  policy_epoch bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  reserved_bytes bigint NOT NULL CHECK (reserved_bytes BETWEEN 0 AND 9007199254740991),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'COMMITTED', 'EXPIRED')),
  PRIMARY KEY (tenant_id, workspace_id, intent_id),
  UNIQUE (tenant_id, workspace_id, actor_id, idempotency_key),
  FOREIGN KEY (tenant_id, workspace_id, file_id) REFERENCES sandy_cloud.file_heads
);
CREATE TABLE sandy_cloud.versions (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  version_id uuid NOT NULL,
  file_id uuid NOT NULL,
  intent_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  ref jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, workspace_id, version_id),
  UNIQUE (tenant_id, workspace_id, file_id, version_id),
  UNIQUE (tenant_id, workspace_id, file_id, revision),
  UNIQUE (tenant_id, workspace_id, intent_id),
  FOREIGN KEY (tenant_id, workspace_id, file_id) REFERENCES sandy_cloud.file_heads,
  FOREIGN KEY (tenant_id, workspace_id, intent_id) REFERENCES sandy_cloud.upload_intents
);
ALTER TABLE sandy_cloud.file_heads ADD CONSTRAINT current_version_scoped
  FOREIGN KEY (tenant_id, workspace_id, file_id, current_version_id)
  REFERENCES sandy_cloud.versions(tenant_id, workspace_id, file_id, version_id);
CREATE TABLE sandy_cloud.commit_receipts (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  intent_id text NOT NULL,
  receipt jsonb NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, intent_id),
  FOREIGN KEY (tenant_id, workspace_id, intent_id) REFERENCES sandy_cloud.upload_intents
);
-- Local transactional outbox only. Existing Mission workers own dispatch/leases.
CREATE TABLE sandy_cloud.outbox (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  version_id uuid NOT NULL,
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, workspace_id, version_id),
  FOREIGN KEY (tenant_id, workspace_id, version_id) REFERENCES sandy_cloud.versions
);
CREATE TABLE sandy_cloud.usage_events (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  version_id uuid NOT NULL,
  logical_bytes bigint NOT NULL CHECK (logical_bytes >= 0),
  PRIMARY KEY (tenant_id, workspace_id, version_id),
  FOREIGN KEY (tenant_id, workspace_id, version_id) REFERENCES sandy_cloud.versions
);
-- References only. Runtime owns signed scan receipts and scanner trust.
CREATE TABLE sandy_cloud.version_scans (
 tenant_id text NOT NULL, workspace_id text NOT NULL, version_id uuid NOT NULL,
 receipt_id uuid NOT NULL, evidence jsonb NOT NULL,
 PRIMARY KEY(tenant_id,workspace_id,version_id),
 FOREIGN KEY(tenant_id,workspace_id,version_id) REFERENCES sandy_cloud.versions
);
CREATE INDEX open_intent_expiry ON sandy_cloud.upload_intents (expires_at)
  WHERE state = 'OPEN';
CREATE FUNCTION sandy_cloud.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_CLOUD_RECORD'; END $$;
CREATE TRIGGER immutable_version BEFORE UPDATE OR DELETE ON sandy_cloud.versions
  FOR EACH ROW EXECUTE FUNCTION sandy_cloud.reject_mutation();
CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE ON sandy_cloud.commit_receipts
  FOR EACH ROW EXECUTE FUNCTION sandy_cloud.reject_mutation();
CREATE TRIGGER immutable_usage BEFORE UPDATE OR DELETE ON sandy_cloud.usage_events
  FOR EACH ROW EXECUTE FUNCTION sandy_cloud.reject_mutation();
CREATE TRIGGER immutable_scan_reference BEFORE UPDATE OR DELETE ON sandy_cloud.version_scans
  FOR EACH ROW EXECUTE FUNCTION sandy_cloud.reject_mutation();
-- Fail closed even for an accidentally granted non-BYPASSRLS role. Production
-- policies/role selection are a separate reviewed integration, not a TODO grant.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['workspaces','file_heads','upload_intents','version_scans',
    'versions','commit_receipts','outbox','usage_events'] LOOP
    EXECUTE format('ALTER TABLE sandy_cloud.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE sandy_cloud.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON sandy_cloud.%I FROM PUBLIC', t);
  END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sandy_cloud FROM PUBLIC;
COMMIT;
