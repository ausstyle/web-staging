-- Additive owner-only project metadata contracts. Deployment and integration
-- evidence is recorded separately after actual execution; registration is not proof.
BEGIN;
INSERT INTO public.sandy_operation_registry (
  operation, domain, description, permission_scope, is_mutation,
  input_schema, output_schema, handler, api_exposed, ui_exposed, ai_exposed,
  verified, implementation_state, source_repository, source_path,
  dependencies, error_contract, retry_policy, rollback_policy
)
SELECT operation, 'supabase', description, 'infrastructure:read', false,
  CASE WHEN operation = 'supabase.branches.get' THEN
    '{"type":"object","required":["name"],"properties":{"name":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$"}},"additionalProperties":false}'::jsonb
  ELSE '{"type":"object","properties":{},"additionalProperties":false}'::jsonb END,
  '{"type":"object","required":["ok","contract_version","operation","project_id","result","observed_at","provider_request_id"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"type":"string"},"project_id":{"const":"zmqlyygzqoidkcwdysok"},"result":{"anyOf":[{"type":"object"},{"type":"array"}]},"observed_at":{"type":"string","format":"date-time"},"provider_request_id":{"type":["string","null"]}},"additionalProperties":false}'::jsonb,
  'sandy-provider-read-api', true, false, true, false, 'deployed_unverified',
  'ausstyle/web-staging', 'supabase/functions/sandy-provider-read-api/index.ts',
  '["controller_owner_session","SANDY_SUPABASE_MANAGEMENT_TOKEN","project:zmqlyygzqoidkcwdysok"]'::jsonb,
  '{"version":"1.0.0","authorization":"owner_required","provider_denied":"provider_query_failed","provider_unavailable":"provider_response_unavailable","unsupported":"operation_not_implemented"}'::jsonb,
  '{"automatic":false,"safe_to_retry":true,"reason":"read_only; callers must respect provider 429 and backoff"}'::jsonb,
  '{"applicable":false,"reason":"read_only"}'::jsonb
FROM (VALUES
  ('supabase.projects.get', 'Read the fixed Sandy Supabase project identity; contract v1.0.0.'),
  ('supabase.project.health', 'Read auth/database/REST/storage/realtime service health; contract v1.0.0.'),
  ('supabase.branches.list', 'List branches belonging to the fixed Sandy project; contract v1.0.0.'),
  ('supabase.branches.get', 'Read a named branch within the fixed Sandy project; contract v1.0.0.'),
  ('supabase.network.restrictions.get', 'Read requested/applied database network restrictions; contract v1.0.0.'),
  ('supabase.domains.get', 'Read custom hostname status without verification tokens; contract v1.0.0.'),
  ('supabase.functions.secrets.list', 'List secret names and update timestamps; never values or digests; contract v1.0.0.'),
  ('supabase.backups.list', 'List backup status metadata; no download or restore; contract v1.0.0.')
) AS contracts(operation, description)
ON CONFLICT (operation) DO NOTHING;
COMMIT;
