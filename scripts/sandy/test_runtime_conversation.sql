-- Component-only, rollback-only fixtures. No provider/model request is made.
BEGIN;
CREATE TEMP TABLE runtime_conversation_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.conversation_assert(name text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'conversation assertion failed: %',name; END IF;
 INSERT INTO runtime_conversation_checks VALUES(name);
END $$;
CREATE FUNCTION pg_temp.conversation_denied(name text, statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN denied:=true; END;
 PERFORM pg_temp.conversation_assert(name,denied);
END $$;
SELECT pg_temp.conversation_assert('registry exposure and real verification remain closed',
 (SELECT is_mutation AND NOT api_exposed AND NOT ui_exposed AND NOT ai_exposed AND NOT verified AND
   handler='internal:agent.runtime.conversation.respond@1.0.0' AND
   (error_contract->>'sensitive')::boolean AND (error_contract->>'consumes_model_resources')::boolean AND
   (error_contract->>'internal_only')::boolean
  FROM public.sandy_operation_registry WHERE operation='agent.runtime.conversation.respond'));
SELECT pg_temp.conversation_assert('registry JSON input cannot select model profile or tools',
 (SELECT input_schema->>'additionalProperties'='false' AND NOT (input_schema->'properties' ?| ARRAY['model','tools','profile','customer_id','auth_user_id'])
  FROM public.sandy_operation_registry WHERE operation='agent.runtime.conversation.respond'));
SELECT pg_temp.conversation_assert('private audit has RLS',
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.sandy_runtime_conversation_audit'::regclass));
SELECT pg_temp.conversation_assert('ordinary sessions have no audit privileges',
 NOT has_table_privilege('authenticated','public.sandy_runtime_conversation_audit','SELECT,INSERT,UPDATE,DELETE') AND
 NOT has_table_privilege('anon','public.sandy_runtime_conversation_audit','SELECT,INSERT,UPDATE,DELETE'));
SELECT pg_temp.conversation_assert('service can claim but cannot delete receipts',
 has_table_privilege('service_role','public.sandy_runtime_conversation_audit','SELECT,INSERT,UPDATE') AND
 NOT has_table_privilege('service_role','public.sandy_runtime_conversation_audit','DELETE'));
INSERT INTO public.sandy_agent_tasks(id,customer_id,channel,request_id,user_request,status)
 VALUES('51000000-0000-4000-8000-000000000001',NULL,'test','runtime-conversation-rollback-only-20261021','Synthetic component fixture; no model call','running');
CREATE TEMP TABLE conversation_claim_template AS SELECT
 'agent.runtime.conversation.respond'::text AS operation,'1.0.0'::text AS contract_version,
 'trusted_runtime'::text AS principal_kind,NULL::uuid AS auth_user_id,NULL::uuid AS customer_id,
 '51000000-0000-4000-8000-000000000001'::uuid AS task_id,'test'::text AS channel,
 'runtime-conversation-rollback-only-20261021'::text AS request_id,'sandy-agent-runtime-v2'::text AS source_runtime,
 'd4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78'::text AS source_sha256,
 0 AS round,'gpt-4.1-mini'::text AS selected_model,repeat('a',64)::text AS request_sha256,'started'::text AS state;
SELECT pg_temp.conversation_denied('invented tenant cannot bind the no-customer task',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,'51000000-0000-4000-8000-000000000002',task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state FROM conversation_claim_template$$);
SELECT pg_temp.conversation_denied('wrong task channel cannot be claimed',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,'email',request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state FROM conversation_claim_template$$);
SELECT pg_temp.conversation_denied('wrong request id cannot be claimed',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,'unrelated-request',source_runtime,source_sha256,round,selected_model,request_sha256,state FROM conversation_claim_template$$);
SELECT pg_temp.conversation_denied('runtime task never becomes an Auth identity',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,'51000000-0000-4000-8000-000000000002',customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state FROM conversation_claim_template$$);
SELECT pg_temp.conversation_denied('unrecognized runtime source hash is refused',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,repeat('f',64),round,selected_model,request_sha256,state FROM conversation_claim_template$$);
SELECT pg_temp.conversation_denied('later round cannot skip the actual first round',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,1,selected_model,request_sha256,state FROM conversation_claim_template$$);
INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT * FROM conversation_claim_template;
SELECT pg_temp.conversation_assert('real nullable task claim is represented without tenant invention',
 (SELECT customer_id IS NULL AND auth_user_id IS NULL AND principal_kind='trusted_runtime' AND state='started'
  FROM public.sandy_runtime_conversation_audit WHERE task_id='51000000-0000-4000-8000-000000000001' AND round=0));
SELECT pg_temp.conversation_denied('same task round cannot be redispatched',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT * FROM conversation_claim_template$$);
SELECT pg_temp.conversation_denied('claim scope cannot be changed during completion',
 $$UPDATE public.sandy_runtime_conversation_audit SET state='unknown',finished_at=now(),selected_model='different-model' WHERE task_id='51000000-0000-4000-8000-000000000001' AND round=0$$);
SELECT pg_temp.conversation_denied('success requires actual receipt fields',
 $$UPDATE public.sandy_runtime_conversation_audit SET state='succeeded',finished_at=now() WHERE task_id='51000000-0000-4000-8000-000000000001' AND round=0$$);
UPDATE public.sandy_runtime_conversation_audit SET state='succeeded',finished_at=now(),provider_response_id='resp_synthetic_component_fixture',response_sha256=repeat('b',64)
 WHERE task_id='51000000-0000-4000-8000-000000000001' AND round=0;
SELECT pg_temp.conversation_assert('synthetic completion can be recorded without provider content',
 (SELECT state='succeeded' AND provider_response_id='resp_synthetic_component_fixture' AND response_sha256=repeat('b',64)
  FROM public.sandy_runtime_conversation_audit WHERE task_id='51000000-0000-4000-8000-000000000001' AND round=0));
SELECT pg_temp.conversation_denied('terminal receipt cannot be rewritten',
 $$UPDATE public.sandy_runtime_conversation_audit SET state='unknown',error='invented' WHERE task_id='51000000-0000-4000-8000-000000000001' AND round=0$$);
SELECT pg_temp.conversation_denied('continuation cannot change the selected model',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,1,'different-model',request_sha256,state FROM conversation_claim_template$$);
INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,1,selected_model,request_sha256,state FROM conversation_claim_template;
UPDATE public.sandy_runtime_conversation_audit SET state='unknown',finished_at=now(),error='synthetic_interrupted_response_fixture'
 WHERE task_id='51000000-0000-4000-8000-000000000001' AND round=1;
SELECT pg_temp.conversation_denied('unknown round cannot be resumed as a verified continuation',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,2,selected_model,request_sha256,state FROM conversation_claim_template$$);
SELECT jsonb_build_object('status','pass','component_checks',count(*),'real_provider_calls',0,'all_changes_rolled_back',true) AS runtime_conversation_component_evidence FROM runtime_conversation_checks;
ROLLBACK;
