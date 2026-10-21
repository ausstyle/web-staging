-- Read-only discovery of the existing fixed Engineering MCP service.
-- The gateway requires an enabled owner and forwards the actual credential
-- context. Only initialize/tools-list protocol metadata is requested; there is
-- no tool execution, provider fallback or service-key user impersonation.
BEGIN;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.sandy_operation_registry
    WHERE operation='google_cloud.mcp.authenticated_discovery') THEN
    RAISE EXCEPTION 'MCP diagnostic contract already exists; reconcile before applying';
  END IF;
END $guard$;
INSERT INTO public.sandy_operation_registry (
 operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,
 handler,api_exposed,ui_exposed,ai_exposed,verified,source_repository,source_path,
 dependencies,error_contract,retry_policy,rollback_policy
) VALUES (

  'google_cloud.mcp.authenticated_discovery',
  'google_cloud',
  'Inspect the fixed Engineering MCP protocol and complete tool catalogue with owner authorization; initialize and tools/list only. Missing API catalogue metadata remains unknown. Contract v1.0.0; no tool execution is requested.',
  'infrastructure:read',
  false,
  '{"type":"object","properties":{},"additionalProperties":false}'::jsonb,
  '{"type":"object","required":["ok","contract_version","operation","stage","initialize_status","tools_status","protocol_version","server_info","tools","tool_count","catalogue_version","compatibility_gaps","tool_execution_requested","observed_at"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"const":"google_cloud.mcp.authenticated_discovery"},"stage":{"const":"tools/list"},"initialize_status":{"type":"integer","minimum":200,"maximum":299},"tools_status":{"type":"integer","minimum":200,"maximum":299},"protocol_version":{"const":"2025-03-26"},"server_info":{"type":"object","required":["name","version"],"properties":{"name":{"type":"string","minLength":1,"maxLength":200},"version":{"type":"string","minLength":1,"maxLength":200}},"additionalProperties":false},"tools":{"type":"array","maxItems":5000,"uniqueItems":true,"items":{"type":"string","pattern":"^[a-z][a-z0-9_.-]{2,100}$"}},"tool_count":{"type":"integer","minimum":0,"maximum":5000},"catalogue_version":{"type":["string","null"],"pattern":"^[a-f0-9]{64}$"},"compatibility_gaps":{"type":["array","null"],"maxItems":500,"items":{"type":"object","required":["name","operation","reason"],"properties":{"name":{"type":"string","pattern":"^[a-z][a-z0-9_.-]{2,100}$"},"operation":{"type":"string","pattern":"^[a-z][a-z0-9_.-]{2,100}$"},"reason":{"type":"string","maxLength":100}},"additionalProperties":false}},"tool_execution_requested":{"const":false},"observed_at":{"type":"string","format":"date-time"}},"additionalProperties":false}'::jsonb,
  'sandy-operation-api',
  true,
  false,
  true,
  false,
  'ausstyle/web-staging',
  'supabase/functions/sandy-operation-api/mcp_diagnostics.ts',
  '["identity:enabled_controller_owner","mcp:sandy-engineering-mcp","network:sandy-engineering-mcp-4pqn6jsfxq-ew.a.run.app"]'::jsonb,
  '{"version":"1.0.0","authentication":"mcp_session_rejected","transport":"mcp_discovery_unavailable","schema":"mcp_invalid_tool_catalogue","limits":"mcp_response_size_limit","pagination":"mcp_incomplete_or_invalid_tool_catalogue"}'::jsonb,
  '{"automatic":false,"reason":"readonly_protocol_diagnostic_no_tool_retry"}'::jsonb,
  '{"required":false,"reason":"readonly_protocol_metadata_only"}'::jsonb
);
-- No verification or deployment outcome is inferred from registration.
COMMIT;
