-- Private snapshot-bound operational inspection. No public context selector.
-- Stored counts/configuration/version metadata are not provider execution proof.
BEGIN;
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.operational.activity') THEN RAISE EXCEPTION 'runtime_operational_operation_already_registered_reconcile_first: %','agent.runtime.operational.activity'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.operational.activity',
 'agent',
 'Inspect the actual source-scoped web activity snapshot; absent/unknown coverage is not zero or a lifetime count. Contract v1.0.0. Internal principal-bound snapshot only; no public handler readiness or production verification is asserted.',
 'runtime:operational',
 false,
 '{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"ok":{"const":true},"source":{"const":"sandy_web_turns"},"status":{"const":"verified"},"scope":{"const":"web_only"},"all_web_messages":{"type":"integer","minimum":0},"current_conversation_messages":{"type":["integer","null"],"minimum":0},"current_conversation_state":{"type":"string"},"cross_channel_available":{"type":"boolean"},"note":{"type":"string"}},"required":["ok","source","status","scope","all_web_messages","current_conversation_messages","current_conversation_state","cross_channel_available","note"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.operational.activity@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_operational.ts',
 '["identity:actual_trusted_runtime_customer_task","capability:process_local_exact_principal_snapshot","database:sandy_agent_operation_audit","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[151],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"runtime_principal_is_user_session":false,"customer_id_from_body":false,"runtime_context_process_local":true,"snapshot_mutable_from_body":false,"requires_stored_task_and_channel_revalidation":true,"source_qualifications_preserved":true,"metadata_is_provider_execution_proof":false,"source_review_only":true,"contract_sha256":"0577a0895071367c891d35c9ee1331a940ef85e45c42e7904eb0337b8986dfb6"}'::jsonb,
 '{"automatic":false,"reason":"No implicit retry; preserve source-specific unknown/unavailable states."}'::jsonb,
 '{"required":false,"reason":"Read-only recorded observations; no provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.operational.communication') THEN RAISE EXCEPTION 'runtime_operational_operation_already_registered_reconcile_first: %','agent.runtime.operational.communication'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.operational.communication',
 'agent',
 'Inspect stored customer/channel communication counts with verified identity/source coverage; never equate incoming email with customer-authored messages. Contract v1.0.0. Internal principal-bound snapshot only; no public handler readiness or production verification is asserted.',
 'runtime:operational',
 false,
 '{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"ok":{"const":true},"status":{"enum":["verified","partial"]},"scope":{"const":"customer_scoped_recorded_messages"},"counts":{"type":"object","properties":{"web_messages":{"type":["integer","null"],"minimum":0},"whatsapp_inbound_verified_identity":{"type":["integer","null"],"minimum":0},"voice_user_turns":{"type":["integer","null"],"minimum":0},"email_incoming_customer_linked":{"type":["integer","null"],"minimum":0},"email_authored_by_verified_customer":{"type":["integer","null"],"minimum":0}},"required":["web_messages","whatsapp_inbound_verified_identity","voice_user_turns","email_incoming_customer_linked","email_authored_by_verified_customer"],"additionalProperties":false},"known_customer_originated_subset":{"type":["integer","null"],"minimum":0},"missing_or_unverified":{"type":"array","maxItems":5,"items":{"type":"string"}},"source_provenance":{"type":"object","properties":{"web":{"type":"string"},"whatsapp":{"type":"string"},"voice":{"type":"string"},"email":{"type":"string"}},"required":["web","whatsapp","voice","email"],"additionalProperties":false},"completeness":{"type":"string"},"caveat":{"type":"string"}},"required":["ok","status","scope","counts","known_customer_originated_subset","missing_or_unverified","source_provenance","completeness","caveat"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.operational.communication@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_operational.ts',
 '["identity:actual_trusted_runtime_customer_task","capability:process_local_exact_principal_snapshot","database:sandy_agent_operation_audit","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[146,149,150,151],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"runtime_principal_is_user_session":false,"customer_id_from_body":false,"runtime_context_process_local":true,"snapshot_mutable_from_body":false,"requires_stored_task_and_channel_revalidation":true,"source_qualifications_preserved":true,"metadata_is_provider_execution_proof":false,"source_review_only":true,"contract_sha256":"7eba9302bfda8763b80e1d8e95964f0596ca0251144c207adf15881cfa934312"}'::jsonb,
 '{"automatic":false,"reason":"No implicit retry; preserve source-specific unknown/unavailable states."}'::jsonb,
 '{"required":false,"reason":"Read-only recorded observations; no provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.operational.connections') THEN RAISE EXCEPTION 'runtime_operational_operation_already_registered_reconcile_first: %','agent.runtime.operational.connections'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.operational.connections',
 'agent',
 'Inspect stored active customer/workspace connection snapshot with explicit locally-recorded, not provider-verified status. Contract v1.0.0. Internal principal-bound snapshot only; no public handler readiness or production verification is asserted.',
 'runtime:operational',
 false,
 '{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"ok":{"const":true},"source":{"const":"sandy_composio_connections"},"services":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"service":{"type":"string"},"workspace":{"type":"string"},"chat_actions":{"type":"string"},"state":{"const":"locally_recorded_active_not_provider_verified"}},"required":["service","workspace","chat_actions","state"],"additionalProperties":false}},"note":{"type":"string"}},"required":["ok","source","services","note"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.operational.connections@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_operational.ts',
 '["identity:actual_trusted_runtime_customer_task","capability:process_local_exact_principal_snapshot","database:sandy_agent_operation_audit","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[145],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"runtime_principal_is_user_session":false,"customer_id_from_body":false,"runtime_context_process_local":true,"snapshot_mutable_from_body":false,"requires_stored_task_and_channel_revalidation":true,"source_qualifications_preserved":true,"metadata_is_provider_execution_proof":false,"source_review_only":true,"contract_sha256":"f0daf509829fcfc4662f423e27244c771517f9cccb4e0fe9a229b93665da7b08"}'::jsonb,
 '{"automatic":false,"reason":"No implicit retry; preserve source-specific unknown/unavailable states."}'::jsonb,
 '{"required":false,"reason":"Read-only recorded observations; no provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.operational.environment') THEN RAISE EXCEPTION 'runtime_operational_operation_already_registered_reconcile_first: %','agent.runtime.operational.environment'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.operational.environment',
 'agent',
 'Inspect the original server clock/timezone context; it supplies no physical location or geolocation permission. Contract v1.0.0. Internal principal-bound snapshot only; no public handler readiness or production verification is asserted.',
 'runtime:operational',
 false,
 '{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"ok":{"const":true},"source":{"const":"server_clock_and_request_context"},"time":{"type":"string"},"timezone":{"type":"string","maxLength":80},"physical_location":{"const":"not_available"},"precision":{"const":"none"},"note":{"type":"string"}},"required":["ok","source","time","timezone","physical_location","precision","note"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.operational.environment@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_operational.ts',
 '["identity:actual_trusted_runtime_customer_task","capability:process_local_exact_principal_snapshot","database:sandy_agent_operation_audit","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[151,161],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"runtime_principal_is_user_session":false,"customer_id_from_body":false,"runtime_context_process_local":true,"snapshot_mutable_from_body":false,"requires_stored_task_and_channel_revalidation":true,"source_qualifications_preserved":true,"metadata_is_provider_execution_proof":false,"source_review_only":true,"contract_sha256":"024f70680a2465af97a651cd55ea4c2456b920e48fea0192c6020d8c74f6cd61"}'::jsonb,
 '{"automatic":false,"reason":"No implicit retry; preserve source-specific unknown/unavailable states."}'::jsonb,
 '{"required":false,"reason":"Read-only recorded observations; no provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.operational.capabilities') THEN RAISE EXCEPTION 'runtime_operational_operation_already_registered_reconcile_first: %','agent.runtime.operational.capabilities'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.operational.capabilities',
 'agent',
 'Inspect channel-filtered recorded capability/configuration and module metadata; stale module status becomes unverified and configured/deployed is not execution evidence. Contract v1.0.0. Internal principal-bound snapshot only; no public handler readiness or production verification is asserted.',
 'runtime:operational',
 false,
 '{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"ok":{"const":true},"source":{"type":"array","minItems":2,"maxItems":2,"items":{"enum":["sandy_capability_catalog","sandy_ai_integrations"]}},"capabilities":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"key":{"type":"string"},"verified_at":{"type":["string","null"]},"verification_note":{"type":["string","null"]}},"required":["key"],"additionalProperties":false}},"integration_configuration":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"key":{"type":"string"},"enabled":{"type":"boolean"},"status":{"type":["string","null"]},"verified_at":{"type":["string","null"]}},"required":["key","enabled"],"additionalProperties":false}},"module_status_source":{"const":"sandy_module_status"},"master_modules":{"type":"array","maxItems":1000,"items":{"type":"object"}},"modules":{"type":"array","maxItems":250,"items":{"type":"object"}},"note":{"type":"string"}},"required":["ok","source","capabilities","integration_configuration","module_status_source","master_modules","modules","note"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.operational.capabilities@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_operational.ts',
 '["identity:actual_trusted_runtime_customer_task","capability:process_local_exact_principal_snapshot","database:sandy_agent_operation_audit","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[155,160,161],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"runtime_principal_is_user_session":false,"customer_id_from_body":false,"runtime_context_process_local":true,"snapshot_mutable_from_body":false,"requires_stored_task_and_channel_revalidation":true,"source_qualifications_preserved":true,"metadata_is_provider_execution_proof":false,"source_review_only":true,"contract_sha256":"0c5e78a247b9fed4a7872c4cfbd8b6639c17148415713ffecf192aa9954048b6"}'::jsonb,
 '{"automatic":false,"reason":"No implicit retry; preserve source-specific unknown/unavailable states."}'::jsonb,
 '{"required":false,"reason":"Read-only recorded observations; no provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.operational.versions') THEN RAISE EXCEPTION 'runtime_operational_operation_already_registered_reconcile_first: %','agent.runtime.operational.versions'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.operational.versions',
 'agent',
 'Inspect authoritative version registry facts captured by the actual source adapter; unavailable/stale/executing identity distinctions are preserved. Legacy v1 has no version context. Contract v1.0.0. Internal principal-bound snapshot only; no public handler readiness or production verification is asserted.',
 'runtime:operational',
 false,
 '{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"ok":{"const":true},"schema_version":{"const":1},"executing":{"type":"object","properties":{"component":{"type":"string"},"generation":{"type":["string","null"]},"revision":{"type":["integer","null"],"minimum":0},"build_id":{"type":["string","null"]},"verified":{"type":"boolean"},"reason":{"type":"string"},"source":{"type":"string"}},"required":["component","verified"],"additionalProperties":false},"release":{"type":"object"},"components":{"type":"array","maxItems":1000,"items":{"type":"object"}},"specialist_modules":{"type":"array","maxItems":1000,"items":{"type":"object"}},"lookup_status":{"const":"available"},"checked_at":{"type":"string"}},"required":["ok","schema_version","executing","release","lookup_status"],"additionalProperties":true}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.operational.versions@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_operational.ts',
 '["identity:actual_trusted_runtime_customer_task","capability:process_local_exact_principal_snapshot","database:sandy_agent_operation_audit","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[161],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"runtime_principal_is_user_session":false,"customer_id_from_body":false,"runtime_context_process_local":true,"snapshot_mutable_from_body":false,"requires_stored_task_and_channel_revalidation":true,"source_qualifications_preserved":true,"metadata_is_provider_execution_proof":false,"source_review_only":true,"contract_sha256":"307a619aa0959a93ec75c83a97757b68846b65af03134685c8bc06bf0d00a183"}'::jsonb,
 '{"automatic":false,"reason":"No implicit retry; preserve source-specific unknown/unavailable states."}'::jsonb,
 '{"required":false,"reason":"Read-only recorded observations; no provider action is performed."}'::jsonb
);
COMMIT;
