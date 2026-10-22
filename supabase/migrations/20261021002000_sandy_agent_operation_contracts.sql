-- Shared API/runtime application service. Registration is not execution evidence.
-- Before changing sandy-agent-runtime-v4, compare deployed version 11 and archived
-- source SHA256 9c67dc1376ca14e948ce31dd02e5c172408461453d818324f0c1a58743dc5304.
-- Do not replace or retarget the separate sandy-agent-runtime release router.
BEGIN;
CREATE TABLE public.sandy_agent_operation_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation text NOT NULL,
 principal_kind text NOT NULL CHECK (principal_kind IN ('auth_user','trusted_runtime')),
 customer_id uuid NOT NULL REFERENCES public.email_customers(id),
 auth_user_id uuid REFERENCES auth.users(id),
 task_id uuid REFERENCES public.sandy_agent_tasks(id),
 idempotency_key text,
 request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK (state IN ('started','succeeded','failed','unknown')),
 result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 CHECK ((principal_kind='auth_user' AND auth_user_id IS NOT NULL AND task_id IS NULL)
   OR (principal_kind='trusted_runtime' AND auth_user_id IS NULL AND task_id IS NOT NULL)),
 CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[a-zA-Z0-9_.:-]{8,160}$')
);
CREATE UNIQUE INDEX sandy_agent_operation_idempotency ON public.sandy_agent_operation_audit
 (customer_id,principal_kind,operation,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX sandy_agent_operation_task_audit ON public.sandy_agent_operation_audit(task_id,created_at);
ALTER TABLE public.sandy_agent_operation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_agent_operation_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.sandy_agent_operation_audit TO service_role;
COMMENT ON TABLE public.sandy_agent_operation_audit IS
 'Shared governed agent executor receipts: auth_user and trusted_runtime are distinct identities. Contains private idempotency results; no customer-facing direct table access. Never replay an interrupted model/write claim automatically.';
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gmail.messages.search') THEN
   RAISE EXCEPTION 'Agent operation already exists; reconcile before applying: %','gmail.messages.search';
 END IF;
END $guard$;
INSERT INTO public.sandy_operation_registry (
 operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,
 handler,api_exposed,ui_exposed,ai_exposed,verified,source_repository,source_path,
 dependencies,error_contract,retry_policy,rollback_policy
) VALUES (
 'gmail.messages.search','gmail','Search the authenticated customer''s single active Gmail account in the selected personal/company workspace; fixed Composio read tool, at most ten results. Contract v1.0.0; source extraction is not production verification.',
 'gmail:read',false,'{"type":"object","properties":{"query":{"type":"string","minLength":1,"maxLength":250},"workspace":{"type":"string","minLength":0,"maxLength":200}},"required":["query"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"read_only":{"const":true},"data":{"type":"string","minLength":0,"maxLength":18000},"principal_kind":{"enum":["auth_user","trusted_runtime"]},"task_id":{"type":["string","null"],"format":"uuid"}},"required":["ok","contract_version","read_only","data","principal_kind","task_id"],"additionalProperties":false}'::jsonb,
 'sandy-agent-operation-api',true,false,true,false,
 'ausstyle/web-staging','supabase/functions/_shared/sandy-agent-operations/service.ts',
 '["identity:confirmed_portal_user","database:sandy_agent_operation_audit","composio:customer_gmail_connection"]'::jsonb,
 '{"version":"1.0.0","principal":"actual_confirmed_portal_user_or_in_process_trusted_runtime_task_binding","runtime_principal_is_user_session":false,"customer_id_from_body":false,"unknown_outcome":"reconciliation_required","consumes_model_resources":false,"requirement_ids":[147,160],"mutations_require_verified_registry":true,"source_runtime_version":11}'::jsonb,
 '{"automatic":false,"reason":"Read may be requested again; no implicit provider retry."}'::jsonb,
 '{"required":false,"reason":"No automatic compensation is defined."}'::jsonb
);
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gmail.messages.recent') THEN
   RAISE EXCEPTION 'Agent operation already exists; reconcile before applying: %','gmail.messages.recent';
 END IF;
END $guard$;
INSERT INTO public.sandy_operation_registry (
 operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,
 handler,api_exposed,ui_exposed,ai_exposed,verified,source_repository,source_path,
 dependencies,error_contract,retry_policy,rollback_policy
) VALUES (
 'gmail.messages.recent','gmail','Read distinct recent inbox message summaries from the customer''s single active Personal Gmail account, with bounded pagination and truthful partial-provider evidence. Contract v1.0.0; source extraction is not production verification.',
 'gmail:read',false,'{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":25}},"required":["limit"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"response":{"type":"string","minLength":0,"maxLength":14000},"details":{"type":"object","properties":{"provider_status":{"type":"integer","minimum":100,"maximum":599},"returned":{"type":"integer","minimum":0,"maximum":25},"requested":{"type":"integer","minimum":1,"maximum":25},"pages":{"type":"integer","minimum":0,"maximum":20},"has_more_pages":{"type":"boolean"},"provider_error":{"type":["string","null"]}},"required":["provider_status","returned","requested","pages","has_more_pages","provider_error"],"additionalProperties":false},"read_only":{"const":true},"principal_kind":{"enum":["auth_user","trusted_runtime"]},"task_id":{"type":["string","null"],"format":"uuid"}},"required":["ok","contract_version","response","details","read_only","principal_kind","task_id"],"additionalProperties":false}'::jsonb,
 'sandy-agent-operation-api',true,false,true,false,
 'ausstyle/web-staging','supabase/functions/_shared/sandy-agent-operations/service.ts',
 '["identity:confirmed_portal_user","database:sandy_agent_operation_audit","composio:customer_gmail_connection"]'::jsonb,
 '{"version":"1.0.0","principal":"actual_confirmed_portal_user_or_in_process_trusted_runtime_task_binding","runtime_principal_is_user_session":false,"customer_id_from_body":false,"unknown_outcome":"reconciliation_required","consumes_model_resources":false,"requirement_ids":[147,160],"mutations_require_verified_registry":true,"source_runtime_version":11}'::jsonb,
 '{"automatic":false,"reason":"Read may be requested again; no implicit provider retry."}'::jsonb,
 '{"required":false,"reason":"No automatic compensation is defined."}'::jsonb
);
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gmail.drafts.prepare') THEN
   RAISE EXCEPTION 'Agent operation already exists; reconcile before applying: %','gmail.drafts.prepare';
 END IF;
END $guard$;
INSERT INTO public.sandy_operation_registry (
 operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,
 handler,api_exposed,ui_exposed,ai_exposed,verified,source_repository,source_path,
 dependencies,error_contract,retry_policy,rollback_policy
) VALUES (
 'gmail.drafts.prepare','gmail','Persist the exact customer-owned Gmail draft for separate explicit confirmation; does not send. Tenant-bound idempotency prevents duplicate drafts after an interrupted request. Contract v1.0.0; source extraction is not production verification.',
 'gmail:write',true,'{"type":"object","properties":{"to":{"type":"string","minLength":1,"maxLength":254},"subject":{"type":"string","minLength":1,"maxLength":300},"body":{"type":"string","minLength":1,"maxLength":12000},"workspace":{"type":"string","minLength":0,"maxLength":200},"account_id":{"type":"string","minLength":0,"maxLength":300},"idempotency_key":{"type":"string","pattern":"^[a-zA-Z0-9_.:-]{8,160}$"}},"required":["to","subject","body","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"awaiting_confirmation":{"const":true},"draft_id":{"type":"string","format":"uuid"},"to":{"type":"string","minLength":1,"maxLength":254},"subject":{"type":"string","minLength":1,"maxLength":300},"body":{"type":"string","minLength":1,"maxLength":12000},"workspace":{"type":"string","minLength":1,"maxLength":200},"account_id":{"type":"string","minLength":1,"maxLength":300},"instruction":{"type":"string","minLength":1,"maxLength":300},"principal_kind":{"enum":["auth_user","trusted_runtime"]},"task_id":{"type":["string","null"],"format":"uuid"}},"required":["ok","contract_version","awaiting_confirmation","draft_id","to","subject","body","workspace","account_id","instruction","principal_kind","task_id"],"additionalProperties":false}'::jsonb,
 'sandy-agent-operation-api',false,false,false,false,
 'ausstyle/web-staging','supabase/functions/_shared/sandy-agent-operations/service.ts',
 '["identity:confirmed_portal_user","database:sandy_agent_operation_audit","composio:customer_gmail_connection"]'::jsonb,
 '{"version":"1.0.0","principal":"actual_confirmed_portal_user_or_in_process_trusted_runtime_task_binding","runtime_principal_is_user_session":false,"customer_id_from_body":false,"unknown_outcome":"reconciliation_required","consumes_model_resources":false,"requirement_ids":[147],"mutations_require_verified_registry":true,"source_runtime_version":11}'::jsonb,
 '{"automatic":false,"reason":"No automatic retry after a committed audit claim; same-key completed results may be returned."}'::jsonb,
 '{"required":false,"reason":"No automatic compensation is defined."}'::jsonb
);
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gmail.drafts.confirm_send') THEN
   RAISE EXCEPTION 'Agent operation already exists; reconcile before applying: %','gmail.drafts.confirm_send';
 END IF;
END $guard$;
INSERT INTO public.sandy_operation_registry (
 operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,
 handler,api_exposed,ui_exposed,ai_exposed,verified,source_repository,source_path,
 dependencies,error_contract,retry_policy,rollback_policy
) VALUES (
 'gmail.drafts.confirm_send','gmail','Send only an explicitly confirmed, immutable customer-owned saved Gmail draft. Atomic claim forbids repeat send attempts; success requires matching provider message ID, recipient, subject and independent Sent Mail verification. Contract v1.0.0; source extraction is not production verification.',
 'gmail:send',true,'{"type":"object","properties":{"draft_id":{"type":"string","format":"uuid"},"confirmation":{"type":"string","minLength":1,"maxLength":100}},"required":["draft_id","confirmation"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"text":{"type":"string","minLength":1,"maxLength":2000},"state":{"const":"sent"},"success":{"const":true},"message_id":{"type":"string","pattern":"^[a-fA-F0-9]{8,64}$"},"sent_mail_verified":{"const":true},"duplicate_prevented":{"type":"boolean"},"principal_kind":{"enum":["auth_user","trusted_runtime"]},"task_id":{"type":["string","null"],"format":"uuid"}},"required":["ok","contract_version","text","state","success","message_id","sent_mail_verified","principal_kind","task_id"],"additionalProperties":false}'::jsonb,
 'sandy-agent-operation-api',false,false,false,false,
 'ausstyle/web-staging','supabase/functions/_shared/sandy-agent-operations/service.ts',
 '["identity:confirmed_portal_user","database:sandy_agent_operation_audit","composio:customer_gmail_connection"]'::jsonb,
 '{"version":"1.0.0","principal":"actual_confirmed_portal_user_or_in_process_trusted_runtime_task_binding","runtime_principal_is_user_session":false,"customer_id_from_body":false,"unknown_outcome":"reconciliation_required","consumes_model_resources":false,"requirement_ids":[147],"mutations_require_verified_registry":true,"source_runtime_version":11}'::jsonb,
 '{"automatic":false,"reason":"Never repeat send attempts; subsequent confirmations only reconcile existing receipt."}'::jsonb,
 '{"required":false,"reason":"An email cannot be unsent; preserve original receipt and independently verify Sent Mail."}'::jsonb
);
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.web.research') THEN
   RAISE EXCEPTION 'Agent operation already exists; reconcile before applying: %','agent.web.research';
 END IF;
END $guard$;
INSERT INTO public.sandy_operation_registry (
 operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,
 handler,api_exposed,ui_exposed,ai_exposed,verified,source_repository,source_path,
 dependencies,error_contract,retry_policy,rollback_policy
) VALUES (
 'agent.web.research','agent','Research public web information through the existing fixed Sandy model broker and enabled web-search feature flag; bounded paid model use, citations preserved. Contract v1.0.0; source extraction is not production verification.',
 'agent:execute',true,'{"type":"object","properties":{"query":{"type":"string","minLength":4,"maxLength":2000},"idempotency_key":{"type":"string","pattern":"^[a-zA-Z0-9_.:-]{8,160}$"}},"required":["query","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"answer":{"type":"string","minLength":1,"maxLength":24000},"citations":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"title":{"type":"string","minLength":0,"maxLength":2000},"url":{"type":"string","format":"uri","maxLength":4000}},"required":["title","url"],"additionalProperties":false}},"principal_kind":{"enum":["auth_user","trusted_runtime"]},"task_id":{"type":["string","null"],"format":"uuid"}},"required":["ok","contract_version","answer","citations","principal_kind","task_id"],"additionalProperties":false}'::jsonb,
 'sandy-agent-operation-api',false,false,false,false,
 'ausstyle/web-staging','supabase/functions/_shared/sandy-agent-operations/service.ts',
 '["identity:confirmed_portal_user","database:sandy_agent_operation_audit","configuration:existing_agent_feature_flag"]'::jsonb,
 '{"version":"1.0.0","principal":"actual_confirmed_portal_user_or_in_process_trusted_runtime_task_binding","runtime_principal_is_user_session":false,"customer_id_from_body":false,"unknown_outcome":"reconciliation_required","consumes_model_resources":true,"requirement_ids":[160],"mutations_require_verified_registry":true,"source_runtime_version":11}'::jsonb,
 '{"automatic":false,"reason":"No automatic retry after a committed audit claim; same-key completed results may be returned."}'::jsonb,
 '{"required":false,"reason":"Model resource use cannot be rolled back."}'::jsonb
);
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.documents.search') THEN
   RAISE EXCEPTION 'Agent operation already exists; reconcile before applying: %','agent.documents.search';
 END IF;
END $guard$;
INSERT INTO public.sandy_operation_registry (
 operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,
 handler,api_exposed,ui_exposed,ai_exposed,verified,source_repository,source_path,
 dependencies,error_contract,retry_policy,rollback_policy
) VALUES (
 'agent.documents.search','agent','Search only the authenticated customer''s independently verified vector store through the existing fixed Sandy model broker; caller cannot supply a store ID. Contract v1.0.0; source extraction is not production verification.',
 'agent:execute',true,'{"type":"object","properties":{"query":{"type":"string","minLength":3,"maxLength":1000},"idempotency_key":{"type":"string","pattern":"^[a-zA-Z0-9_.:-]{8,160}$"}},"required":["query","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"answer":{"type":"string","minLength":1,"maxLength":24000},"citations":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"file_id":{"type":"string","minLength":1,"maxLength":300},"filename":{"type":"string","minLength":0,"maxLength":1000}},"required":["file_id","filename"],"additionalProperties":false}},"principal_kind":{"enum":["auth_user","trusted_runtime"]},"task_id":{"type":["string","null"],"format":"uuid"}},"required":["ok","contract_version","answer","citations","principal_kind","task_id"],"additionalProperties":false}'::jsonb,
 'sandy-agent-operation-api',false,false,false,false,
 'ausstyle/web-staging','supabase/functions/_shared/sandy-agent-operations/service.ts',
 '["identity:confirmed_portal_user","database:sandy_agent_operation_audit","configuration:existing_agent_feature_flag"]'::jsonb,
 '{"version":"1.0.0","principal":"actual_confirmed_portal_user_or_in_process_trusted_runtime_task_binding","runtime_principal_is_user_session":false,"customer_id_from_body":false,"unknown_outcome":"reconciliation_required","consumes_model_resources":true,"requirement_ids":[156,160],"mutations_require_verified_registry":true,"source_runtime_version":11}'::jsonb,
 '{"automatic":false,"reason":"No automatic retry after a committed audit claim; same-key completed results may be returned."}'::jsonb,
 '{"required":false,"reason":"Model resource use cannot be rolled back."}'::jsonb
);
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.evaluations.list') THEN
   RAISE EXCEPTION 'Agent operation already exists; reconcile before applying: %','agent.evaluations.list';
 END IF;
END $guard$;
INSERT INTO public.sandy_operation_registry (
 operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,
 handler,api_exposed,ui_exposed,ai_exposed,verified,source_repository,source_path,
 dependencies,error_contract,retry_policy,rollback_policy
) VALUES (
 'agent.evaluations.list','agent','Owner-only read of at most twenty project-wide OpenAI evaluation definitions, controlled by the existing eval feature flag. No evaluations are run. Contract v1.0.0; source extraction is not production verification.',
 'controller:read',false,'{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"items":{"type":"array","maxItems":20,"items":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":300},"name":{"type":"string","minLength":1,"maxLength":2000},"created_at":{"type":"integer","minimum":0}},"required":["id","name","created_at"],"additionalProperties":false}},"read_only":{"const":true},"principal_kind":{"enum":["auth_user","trusted_runtime"]},"task_id":{"type":["string","null"],"format":"uuid"}},"required":["ok","contract_version","items","read_only","principal_kind","task_id"],"additionalProperties":false}'::jsonb,
 'sandy-agent-operation-api',true,false,true,false,
 'ausstyle/web-staging','supabase/functions/_shared/sandy-agent-operations/service.ts',
 '["identity:confirmed_portal_user","identity:enabled_controller_owner","database:sandy_agent_operation_audit","configuration:existing_agent_feature_flag"]'::jsonb,
 '{"version":"1.0.0","principal":"actual_confirmed_portal_user_or_in_process_trusted_runtime_task_binding","runtime_principal_is_user_session":false,"customer_id_from_body":false,"unknown_outcome":"reconciliation_required","consumes_model_resources":false,"requirement_ids":[155,160],"mutations_require_verified_registry":true,"source_runtime_version":11}'::jsonb,
 '{"automatic":false,"reason":"Read may be requested again; no implicit provider retry."}'::jsonb,
 '{"required":false,"reason":"No automatic compensation is defined."}'::jsonb
);
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.execution_plan.draft') THEN
   RAISE EXCEPTION 'Agent operation already exists; reconcile before applying: %','agent.execution_plan.draft';
 END IF;
END $guard$;
INSERT INTO public.sandy_operation_registry (
 operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,
 handler,api_exposed,ui_exposed,ai_exposed,verified,source_repository,source_path,
 dependencies,error_contract,retry_policy,rollback_policy
) VALUES (
 'agent.execution_plan.draft','agent','Draft a dependency-aware plan through the existing fixed model broker with planning-only instructions and bounded model use; does not execute plan actions. Contract v1.0.0; source extraction is not production verification.',
 'agent:execute',true,'{"type":"object","properties":{"goal":{"type":"string","minLength":5,"maxLength":3000},"idempotency_key":{"type":"string","pattern":"^[a-zA-Z0-9_.:-]{8,160}$"}},"required":["goal","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"plan":{"type":"string","minLength":1,"maxLength":24000},"executed":{"const":false},"principal_kind":{"enum":["auth_user","trusted_runtime"]},"task_id":{"type":["string","null"],"format":"uuid"}},"required":["ok","contract_version","plan","executed","principal_kind","task_id"],"additionalProperties":false}'::jsonb,
 'sandy-agent-operation-api',false,false,false,false,
 'ausstyle/web-staging','supabase/functions/_shared/sandy-agent-operations/service.ts',
 '["identity:confirmed_portal_user","database:sandy_agent_operation_audit","configuration:existing_agent_feature_flag"]'::jsonb,
 '{"version":"1.0.0","principal":"actual_confirmed_portal_user_or_in_process_trusted_runtime_task_binding","runtime_principal_is_user_session":false,"customer_id_from_body":false,"unknown_outcome":"reconciliation_required","consumes_model_resources":true,"requirement_ids":[154,160],"mutations_require_verified_registry":true,"source_runtime_version":11}'::jsonb,
 '{"automatic":false,"reason":"No automatic retry after a committed audit claim; same-key completed results may be returned."}'::jsonb,
 '{"required":false,"reason":"Model resource use cannot be rolled back."}'::jsonb
);
-- All rows remain unverified. Writes and paid model calls are unexposed.
COMMIT;
