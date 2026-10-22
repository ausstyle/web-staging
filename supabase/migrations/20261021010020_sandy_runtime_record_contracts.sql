-- Separately closed trusted-runtime record contracts; no new public API routes.
-- Source extraction and metadata registration are not functional verification.
BEGIN;
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.tasks.list') THEN RAISE EXCEPTION 'runtime_record_operation_already_registered_reconcile_first: %','agent.runtime.tasks.list'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.tasks.list',
 'agent',
 'List actual outstanding tenant tasks, exact total, priority/deadline and stored participant/delegation context; todo is not reported as in progress. Contract v1.0.0. Internal runtime task capability only; no public handler readiness or production verification is asserted.',
 'runtime:records',
 false,
 '{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"outstanding_count":{"type":"integer","minimum":0},"shown_count":{"type":"integer","minimum":0,"maximum":150},"definition":{"type":"string","minLength":1,"maxLength":1000},"status_breakdown":{"type":"object","additionalProperties":{"type":"integer","minimum":0}},"in_progress_count":{"type":"integer","minimum":0,"maximum":150},"todo_is_in_progress":{"const":false},"tasks":{"type":"array","maxItems":150,"items":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":0,"maxLength":1000},"status":{"type":"string","minLength":0,"maxLength":100},"priority":{"anyOf":[{"type":"string","minLength":0,"maxLength":100},{"type":"null"}]},"due_at":{"anyOf":[{"type":"string","minLength":0,"maxLength":100},{"type":"null"}]},"responsible_customer_id":{"anyOf":[{"type":"string","format":"uuid"},{"type":"null"}]},"delegations":{"type":"array","items":{"type":"object","properties":{"assignee":{"type":"string","minLength":0,"maxLength":1000},"status":{"type":"string","minLength":0,"maxLength":100},"scope":{}},"required":["assignee","status"],"additionalProperties":false}},"participants":{"type":"array","items":{"type":"object","properties":{"role":{"type":"string","minLength":0,"maxLength":100},"status":{"type":"string","minLength":0,"maxLength":100},"customer_id":{"type":"string","format":"uuid"}},"required":["role","status","customer_id"],"additionalProperties":false}}},"required":["id","title","status","delegations","participants"],"additionalProperties":false}}},"required":["outstanding_count","shown_count","definition","status_breakdown","in_progress_count","todo_is_in_progress","tasks"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.tasks.list@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_records.ts',
 '["identity:actual_trusted_runtime_customer_task","database:sandy_agent_operation_audit","database:existing_tenant_records","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[153],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"principal":"in_process_verified_AgentPrincipal_trusted_runtime_customer_task","runtime_principal_is_user_session":false,"customer_id_from_body":false,"requires_stored_task_revalidation":true,"provider_or_model_execution":false,"source_review_only":true,"same_key_unknown_outcome":"reconciliation_required_no_reexecution","original_shared_branch_runtimes":["sandy-agent-runtime-v2","sandy-agent-runtime-v1-backup-r50","sandy-agent-runtime-v4"],"contract_sha256":"5469e0e43c16567038cd545c18e50d06145d8a98817020fb1e2b3adf18ce18f3"}'::jsonb,
 '{"automatic":false,"reason":"Same-key completed write may return the saved child ID; unknown writes require reconciliation without reexecution."}'::jsonb,
 '{"automatic":false,"reason":"Client action/image approval records require explicit reviewed follow-up; no model/image/provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.tasks.request_client_action') THEN RAISE EXCEPTION 'runtime_record_operation_already_registered_reconcile_first: %','agent.runtime.tasks.request_client_action'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.tasks.request_client_action',
 'agent',
 'Create or reuse a client-owned action under an actual customer-owned Sandy mission; no generic/duplicate requests or provider work. Contract v1.0.0. Internal runtime task capability only; no public handler readiness or production verification is asserted.',
 'runtime:records',
 true,
 '{"type":"object","properties":{"mission_id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":3,"maxLength":240},"details":{"type":"string","minLength":0,"maxLength":4000},"idempotency_key":{"type":"string","pattern":"^[a-zA-Z0-9_.:-]{8,160}$"}},"required":["mission_id","title","details","idempotency_key"],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"ok":{"const":true},"task_id":{"type":"string","format":"uuid"},"already_exists":{"const":true}},"required":["ok","task_id"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.tasks.request_client_action@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_records.ts',
 '["identity:actual_trusted_runtime_customer_task","database:sandy_agent_operation_audit","database:existing_tenant_records","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[153,154],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"principal":"in_process_verified_AgentPrincipal_trusted_runtime_customer_task","runtime_principal_is_user_session":false,"customer_id_from_body":false,"requires_stored_task_revalidation":true,"provider_or_model_execution":false,"source_review_only":true,"same_key_unknown_outcome":"reconciliation_required_no_reexecution","original_shared_branch_runtimes":["sandy-agent-runtime-v2","sandy-agent-runtime-v1-backup-r50","sandy-agent-runtime-v4"],"contract_sha256":"b2c65098e82270337cf58e2cb96320fcb9661da9adcf0abb73a39c9730772ba9"}'::jsonb,
 '{"automatic":false,"reason":"Same-key completed write may return the saved child ID; unknown writes require reconciliation without reexecution."}'::jsonb,
 '{"automatic":false,"reason":"Client action/image approval records require explicit reviewed follow-up; no model/image/provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.history.search') THEN RAISE EXCEPTION 'runtime_record_operation_already_registered_reconcile_first: %','agent.runtime.history.search'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.history.search',
 'agent',
 'Read at most eight matches from the existing tenant-bound unified history RPC, preserving provenance and 1500-character content snippets. Contract v1.0.0. Internal runtime task capability only; no public handler readiness or production verification is asserted.',
 'runtime:records',
 false,
 '{"type":"object","properties":{"query":{"type":"string","minLength":2,"maxLength":120}},"required":["query"],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"matches":{"type":"array","maxItems":8,"items":{"type":"object","properties":{"content":{"type":"string","minLength":0,"maxLength":1500}},"required":["content"],"additionalProperties":true}}},"required":["matches"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.history.search@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_records.ts',
 '["identity:actual_trusted_runtime_customer_task","database:sandy_agent_operation_audit","database:existing_tenant_records","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[151,152],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"principal":"in_process_verified_AgentPrincipal_trusted_runtime_customer_task","runtime_principal_is_user_session":false,"customer_id_from_body":false,"requires_stored_task_revalidation":true,"provider_or_model_execution":false,"source_review_only":true,"same_key_unknown_outcome":"reconciliation_required_no_reexecution","original_shared_branch_runtimes":["sandy-agent-runtime-v2","sandy-agent-runtime-v1-backup-r50","sandy-agent-runtime-v4"],"contract_sha256":"6145b151d5b264a6a8b0a803fad56c821fd0533bbe4eae086022c2112fec9846"}'::jsonb,
 '{"automatic":false,"reason":"Same-key completed write may return the saved child ID; unknown writes require reconciliation without reexecution."}'::jsonb,
 '{"automatic":false,"reason":"Client action/image approval records require explicit reviewed follow-up; no model/image/provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.images.request_approval') THEN RAISE EXCEPTION 'runtime_record_operation_already_registered_reconcile_first: %','agent.runtime.images.request_approval'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.images.request_approval',
 'agent',
 'Create or reuse an explicit client cost-approval task beneath an actual Sandy mission. Does not generate an image or consume model/provider units. Contract v1.0.0. Internal runtime task capability only; no public handler readiness or production verification is asserted.',
 'runtime:records',
 true,
 '{"type":"object","properties":{"mission_id":{"type":"string","format":"uuid"},"prompt":{"type":"string","minLength":5,"maxLength":2000},"idempotency_key":{"type":"string","pattern":"^[a-zA-Z0-9_.:-]{8,160}$"}},"required":["mission_id","prompt","idempotency_key"],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"ok":{"const":true},"approval_pending":{"const":true},"task_id":{"type":"string","format":"uuid"}},"required":["ok","approval_pending","task_id"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.images.request_approval@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_records.ts',
 '["identity:actual_trusted_runtime_customer_task","database:sandy_agent_operation_audit","database:existing_tenant_records","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[153,154,160],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"principal":"in_process_verified_AgentPrincipal_trusted_runtime_customer_task","runtime_principal_is_user_session":false,"customer_id_from_body":false,"requires_stored_task_revalidation":true,"provider_or_model_execution":false,"source_review_only":true,"same_key_unknown_outcome":"reconciliation_required_no_reexecution","original_shared_branch_runtimes":["sandy-agent-runtime-v2","sandy-agent-runtime-v1-backup-r50","sandy-agent-runtime-v4"],"contract_sha256":"3e3dc0fc45f06be2d7c400a6852df65b6780ccf461f96c5e3f4988d81dd1c47f"}'::jsonb,
 '{"automatic":false,"reason":"Same-key completed write may return the saved child ID; unknown writes require reconciliation without reexecution."}'::jsonb,
 '{"automatic":false,"reason":"Client action/image approval records require explicit reviewed follow-up; no model/image/provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.connections.list') THEN RAISE EXCEPTION 'runtime_record_operation_already_registered_reconcile_first: %','agent.runtime.connections.list'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.connections.list',
 'agent',
 'List stored active customer/workspace connections and existing connector configuration. Stored connection/configuration is not independent evidence of provider access or execution. Contract v1.0.0. Internal runtime task capability only; no public handler readiness or production verification is asserted.',
 'runtime:records',
 false,
 '{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"services":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"service":{"type":"string","minLength":1,"maxLength":300},"account_id":{"type":"string","minLength":1,"maxLength":500},"workspace":{"type":"string","minLength":0,"maxLength":1000},"connector_enabled":{"type":"boolean"},"capabilities":{"type":"array","maxItems":10,"items":{"type":"string","minLength":0,"maxLength":200}},"send_workflow":{"type":"string","minLength":0,"maxLength":1000}},"required":["service","account_id","workspace","connector_enabled","capabilities"],"additionalProperties":false}}},"required":["services"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.connections.list@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_records.ts',
 '["identity:actual_trusted_runtime_customer_task","database:sandy_agent_operation_audit","database:existing_tenant_records","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[145],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"principal":"in_process_verified_AgentPrincipal_trusted_runtime_customer_task","runtime_principal_is_user_session":false,"customer_id_from_body":false,"requires_stored_task_revalidation":true,"provider_or_model_execution":false,"source_review_only":true,"same_key_unknown_outcome":"reconciliation_required_no_reexecution","original_shared_branch_runtimes":["sandy-agent-runtime-v2","sandy-agent-runtime-v1-backup-r50","sandy-agent-runtime-v4"],"contract_sha256":"8cd9330b259b7066b48597cd010187e166867aa6fe4a45561b038e1fb637e4dd"}'::jsonb,
 '{"automatic":false,"reason":"Same-key completed write may return the saved child ID; unknown writes require reconciliation without reexecution."}'::jsonb,
 '{"automatic":false,"reason":"Client action/image approval records require explicit reviewed follow-up; no model/image/provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.context.tasks.find') THEN RAISE EXCEPTION 'runtime_record_operation_already_registered_reconcile_first: %','agent.runtime.context.tasks.find'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.context.tasks.find',
 'agent',
 'Read at most eight unarchived customer tasks matching the bounded task-relevant title lookup; caller cannot select a table or another customer. Contract v1.0.0. Internal runtime task capability only; no public handler readiness or production verification is asserted.',
 'runtime:records',
 false,
 '{"type":"object","properties":{"query":{"type":"string","minLength":3,"maxLength":180}},"required":["query"],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"records":{"type":"array","maxItems":8,"items":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":0,"maxLength":1000},"status":{"type":"string","minLength":0,"maxLength":100},"priority":{"anyOf":[{"type":"string","minLength":0,"maxLength":100},{"type":"null"}]},"updated_at":{"anyOf":[{"type":"string","minLength":0,"maxLength":100},{"type":"null"}]}},"additionalProperties":false}}},"required":["records"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.context.tasks.find@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_records.ts',
 '["identity:actual_trusted_runtime_customer_task","database:sandy_agent_operation_audit","database:existing_tenant_records","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[153],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"principal":"in_process_verified_AgentPrincipal_trusted_runtime_customer_task","runtime_principal_is_user_session":false,"customer_id_from_body":false,"requires_stored_task_revalidation":true,"provider_or_model_execution":false,"source_review_only":true,"same_key_unknown_outcome":"reconciliation_required_no_reexecution","original_shared_branch_runtimes":["sandy-agent-runtime-v2","sandy-agent-runtime-v1-backup-r50","sandy-agent-runtime-v4"],"contract_sha256":"ef58d8ce8cd51f3db28ee504cdde58ff9286ff2f7eef0c6c4e02abbe9a422621"}'::jsonb,
 '{"automatic":false,"reason":"Same-key completed write may return the saved child ID; unknown writes require reconciliation without reexecution."}'::jsonb,
 '{"automatic":false,"reason":"Client action/image approval records require explicit reviewed follow-up; no model/image/provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.context.tasks.get') THEN RAISE EXCEPTION 'runtime_record_operation_already_registered_reconcile_first: %','agent.runtime.context.tasks.get'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.context.tasks.get',
 'agent',
 'Read one actual tenant-owned unarchived task by ID for the existing runtime narrow context tool. Contract v1.0.0. Internal runtime task capability only; no public handler readiness or production verification is asserted.',
 'runtime:records',
 false,
 '{"type":"object","properties":{"id":{"type":"string","format":"uuid"}},"required":["id"],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"records":{"type":"array","maxItems":1,"items":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":0,"maxLength":1000},"details":{"anyOf":[{"type":"string"},{"type":"null"}]},"status":{"type":"string","minLength":0,"maxLength":100},"priority":{"anyOf":[{"type":"string","minLength":0,"maxLength":100},{"type":"null"}]},"due_at":{"anyOf":[{"type":"string","minLength":0,"maxLength":100},{"type":"null"}]},"parent_task_id":{"anyOf":[{"type":"string","format":"uuid"},{"type":"null"}]}},"additionalProperties":false}}},"required":["records"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.context.tasks.get@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_records.ts',
 '["identity:actual_trusted_runtime_customer_task","database:sandy_agent_operation_audit","database:existing_tenant_records","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[153],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"principal":"in_process_verified_AgentPrincipal_trusted_runtime_customer_task","runtime_principal_is_user_session":false,"customer_id_from_body":false,"requires_stored_task_revalidation":true,"provider_or_model_execution":false,"source_review_only":true,"same_key_unknown_outcome":"reconciliation_required_no_reexecution","original_shared_branch_runtimes":["sandy-agent-runtime-v2","sandy-agent-runtime-v1-backup-r50","sandy-agent-runtime-v4"],"contract_sha256":"0f3a3c88bc769cc1a94a5cee043479a81e4559be61c2a7af9eda2eb81bcdf8d0"}'::jsonb,
 '{"automatic":false,"reason":"Same-key completed write may return the saved child ID; unknown writes require reconciliation without reexecution."}'::jsonb,
 '{"automatic":false,"reason":"Client action/image approval records require explicit reviewed follow-up; no model/image/provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.context.files.find') THEN RAISE EXCEPTION 'runtime_record_operation_already_registered_reconcile_first: %','agent.runtime.context.files.find'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.context.files.find',
 'agent',
 'Read at most eight customer-owned file metadata records through the original bounded narrow lookup; excludes deleted and archived records and does not fetch contents. Contract v1.0.0. Internal runtime task capability only; no public handler readiness or production verification is asserted.',
 'runtime:records',
 false,
 '{"type":"object","properties":{"query":{"type":"string","minLength":3,"maxLength":180}},"required":["query"],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"records":{"type":"array","maxItems":8,"items":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"display_name":{"type":"string","minLength":0,"maxLength":1000},"mime_type":{"anyOf":[{"type":"string","minLength":0,"maxLength":500},{"type":"null"}]},"description":{"anyOf":[{"type":"string"},{"type":"null"}]},"created_at":{"anyOf":[{"type":"string","minLength":0,"maxLength":100},{"type":"null"}]},"library_state":{"anyOf":[{"type":"string","minLength":0,"maxLength":100},{"type":"null"}]}},"additionalProperties":false}}},"required":["records"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.context.files.find@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_records.ts',
 '["identity:actual_trusted_runtime_customer_task","database:sandy_agent_operation_audit","database:existing_tenant_records","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[156],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"principal":"in_process_verified_AgentPrincipal_trusted_runtime_customer_task","runtime_principal_is_user_session":false,"customer_id_from_body":false,"requires_stored_task_revalidation":true,"provider_or_model_execution":false,"source_review_only":true,"same_key_unknown_outcome":"reconciliation_required_no_reexecution","original_shared_branch_runtimes":["sandy-agent-runtime-v2","sandy-agent-runtime-v1-backup-r50","sandy-agent-runtime-v4"],"contract_sha256":"8af178410e0e23011f4803424ee06a4a662480ed34869738fbf1d2c9a32a0672"}'::jsonb,
 '{"automatic":false,"reason":"Same-key completed write may return the saved child ID; unknown writes require reconciliation without reexecution."}'::jsonb,
 '{"automatic":false,"reason":"Client action/image approval records require explicit reviewed follow-up; no model/image/provider action is performed."}'::jsonb
);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.context.memory.search') THEN RAISE EXCEPTION 'runtime_record_operation_already_registered_reconcile_first: %','agent.runtime.context.memory.search'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.context.memory.search',
 'agent',
 'Read at most five active customer-owned memory snippets through the original narrow lookup, preserving channel/time and truncating content to 900 characters. Contract v1.0.0. Internal runtime task capability only; no public handler readiness or production verification is asserted.',
 'runtime:records',
 false,
 '{"type":"object","properties":{"query":{"type":"string","minLength":3,"maxLength":180}},"required":["query"],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"records":{"type":"array","maxItems":5,"items":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"channel":{"type":"string","minLength":0,"maxLength":100},"content":{"type":"string","minLength":0,"maxLength":900},"occurred_at":{"anyOf":[{"type":"string","minLength":0,"maxLength":100},{"type":"null"}]}},"additionalProperties":false}}},"required":["records"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.context.memory.search@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_records.ts',
 '["identity:actual_trusted_runtime_customer_task","database:sandy_agent_operation_audit","database:existing_tenant_records","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[152],"internal_only":true,"sensitive":true,"consumes_model_resources":false,"principal":"in_process_verified_AgentPrincipal_trusted_runtime_customer_task","runtime_principal_is_user_session":false,"customer_id_from_body":false,"requires_stored_task_revalidation":true,"provider_or_model_execution":false,"source_review_only":true,"same_key_unknown_outcome":"reconciliation_required_no_reexecution","original_shared_branch_runtimes":["sandy-agent-runtime-v2","sandy-agent-runtime-v1-backup-r50","sandy-agent-runtime-v4"],"contract_sha256":"7c373dc6cd48f588f187b79864d90b25ae03d179cfebc45a213612b283614bf1"}'::jsonb,
 '{"automatic":false,"reason":"Same-key completed write may return the saved child ID; unknown writes require reconciliation without reexecution."}'::jsonb,
 '{"automatic":false,"reason":"Client action/image approval records require explicit reviewed follow-up; no model/image/provider action is performed."}'::jsonb
);
COMMIT;
