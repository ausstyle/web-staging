-- Fixed read-only catalog queries, not an arbitrary SQL execution interface.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sandy_operation_registry
    WHERE operation = 'supabase.projects.get' AND handler = 'sandy-provider-read-api') THEN
    RAISE EXCEPTION 'project read contracts must be installed first';
  END IF;
END $$;
INSERT INTO public.sandy_operation_registry (
  operation, domain, description, permission_scope, is_mutation,
  input_schema, output_schema, handler, api_exposed, ui_exposed, ai_exposed,
  verified, implementation_state, source_repository, source_path,
  dependencies, error_contract, retry_policy, rollback_policy
)
SELECT contracts.operation, 'supabase', contracts.description,
  base.permission_scope, false, base.input_schema, base.output_schema,
  base.handler, true, false, true, false, 'deployed_unverified',
  base.source_repository, base.source_path, base.dependencies,
  base.error_contract, base.retry_policy, base.rollback_policy
FROM public.sandy_operation_registry AS base
CROSS JOIN (VALUES
  ('supabase.db.migrations.list', 'List the latest 200 migration versions and names; no SQL bodies; contract v1.0.0.'),
  ('supabase.database.inspect', 'List up to 200 visible database schema names; contract v1.0.0.'),
  ('supabase.schema.tables.list', 'List up to 1000 public table/view names and types; no customer rows; contract v1.0.0.'),
  ('supabase.schema.functions.list', 'List up to 1000 public routine signatures; never source bodies; contract v1.0.0.'),
  ('supabase.schema.indexes.list', 'List up to 1000 public index names; never index expression bodies; contract v1.0.0.'),
  ('supabase.database.connections.list', 'Read aggregate connection state counts; no queries, usernames or client addresses; contract v1.0.0.')
) AS contracts(operation, description)
WHERE base.operation = 'supabase.projects.get'
ON CONFLICT (operation) DO NOTHING;
COMMIT;
