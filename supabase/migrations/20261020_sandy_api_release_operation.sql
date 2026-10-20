-- Sandy API owns operation metadata; MCP exposes this only after the API handler is deployed.
insert into public.sandy_operation_registry
(operation,domain,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,updated_at)
values ('deployment.management.release','deployment','engineering:execute',true,
'{"type":"object","properties":{"function_slug":{"type":"string","enum":["sandy-operation-api","sandy-api-mcp"]},"source_ref":{"type":"string","const":"main"},"change_id":{"type":"string"}},"required":["function_slug","source_ref","change_id"],"additionalProperties":false}'::jsonb,
'{"type":"object"}'::jsonb,'sandy-operation-api',true,false,true,false,now())
on conflict (operation) do update set input_schema=excluded.input_schema,output_schema=excluded.output_schema,handler=excluded.handler,is_mutation=true,verified=false,updated_at=now();
