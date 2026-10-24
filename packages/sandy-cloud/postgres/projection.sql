-- Candidate addition to the uninstalled Cloud schema; no ownership assignment.
-- The existing lifecycle table has only from_state/to_state, so a version commit
-- is recorded here as its actual event, not a fabricated state transition.
BEGIN;
CREATE TABLE sandy_cloud.projection_events (
 tenant_id text NOT NULL, workspace_id text NOT NULL, version_id uuid NOT NULL,
 file_id uuid NOT NULL REFERENCES public.sandy_universal_files(id),
 customer_id uuid NOT NULL, writer_assignment_id text NOT NULL,
 expected_revision bigint NOT NULL, revision bigint NOT NULL,
 prior_storage jsonb NOT NULL, projected_ref jsonb NOT NULL,
 trace_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,workspace_id,version_id),
 FOREIGN KEY(tenant_id,workspace_id,file_id,version_id)
   REFERENCES sandy_cloud.versions(tenant_id,workspace_id,file_id,version_id),
 CHECK(revision=expected_revision+1)
);
ALTER TABLE sandy_cloud.projection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandy_cloud.projection_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sandy_cloud.projection_events FROM PUBLIC;
CREATE TRIGGER immutable_projection BEFORE UPDATE OR DELETE ON sandy_cloud.projection_events
 FOR EACH ROW EXECUTE FUNCTION sandy_cloud.reject_mutation();
COMMIT;
