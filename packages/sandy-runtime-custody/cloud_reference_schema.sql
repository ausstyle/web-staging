-- SOURCE PROPOSAL ONLY. Apply only in reviewed order AFTER both candidate schemas.
-- One immutable reference extension; no copy of bytes, verdicts or identity maps.
BEGIN;
CREATE TABLE sandy_artifact_custody.cloud_scan_references (
 tenant_id text NOT NULL, workspace_id text NOT NULL, intent_id text NOT NULL,
 file_id uuid NOT NULL REFERENCES public.sandy_universal_files(id),
 receipt_id uuid NOT NULL REFERENCES sandy_artifact_custody.scan_receipts(id),
 artifact_id uuid NOT NULL, admission_id uuid NOT NULL REFERENCES public.sandy_api_execution_admissions(id),
 intent_sha256 text NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),
 binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object'),
 PRIMARY KEY(tenant_id,workspace_id,intent_id),
 FOREIGN KEY(tenant_id,workspace_id,intent_id) REFERENCES sandy_cloud.upload_intents
);
CREATE TRIGGER immutable_reference BEFORE UPDATE OR DELETE ON sandy_artifact_custody.cloud_scan_references
 FOR EACH ROW EXECUTE FUNCTION sandy_artifact_custody.immutable_receipt();
ALTER TABLE sandy_artifact_custody.cloud_scan_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandy_artifact_custody.cloud_scan_references FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sandy_artifact_custody.cloud_scan_references FROM PUBLIC;
COMMIT;
