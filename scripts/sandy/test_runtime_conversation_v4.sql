-- Component-only fixture. No model/broker/tool request is made.
BEGIN;
CREATE TEMP TABLE v4_conversation_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.v4_conversation_assert(name text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'v4 conversation assertion failed: %',name; END IF;
 INSERT INTO v4_conversation_checks VALUES(name);
END $$;
CREATE FUNCTION pg_temp.v4_conversation_denied(name text, statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN denied:=true; END;
 PERFORM pg_temp.v4_conversation_assert(name,denied);
END $$;
SELECT pg_temp.v4_conversation_assert('v4 metadata keeps public execution closed',
 (SELECT is_mutation AND NOT api_exposed AND NOT ui_exposed AND NOT ai_exposed AND NOT verified AND
  (error_contract->'v4_profile'->>'source_only')::boolean AND error_contract->'v4_profile'->>'transport'='fixed_original_v4_broker'
  FROM public.sandy_operation_registry WHERE operation='agent.runtime.conversation.respond'));
SELECT pg_temp.v4_conversation_assert('audit remains private to server automation',
 NOT has_table_privilege('authenticated','public.sandy_runtime_conversation_audit','SELECT,INSERT,UPDATE,DELETE') AND
 NOT has_table_privilege('anon','public.sandy_runtime_conversation_audit','SELECT,INSERT,UPDATE,DELETE'));
INSERT INTO public.sandy_agent_tasks(id,customer_id,channel,request_id,user_request,status) VALUES
 ('52000000-0000-4000-8000-000000000001',NULL,'test','runtime-v4-conversation-rollback-20261021','Synthetic v4 fixture; no model call','running'),
 ('52000000-0000-4000-8000-000000000002',NULL,'test','runtime-v2-conversation-rollback-20261021','Synthetic v2 fixture; no model call','running'),
 ('52000000-0000-4000-8000-000000000003',NULL,'test','runtime-v1-conversation-rollback-20261021','Synthetic v1 fixture; no model call','running');
CREATE TEMP TABLE v4_claim AS SELECT 'agent.runtime.conversation.respond'::text AS operation,'1.0.0'::text AS contract_version,
 'trusted_runtime'::text AS principal_kind,NULL::uuid AS auth_user_id,NULL::uuid AS customer_id,
 '52000000-0000-4000-8000-000000000001'::uuid AS task_id,'test'::text AS channel,
 'runtime-v4-conversation-rollback-20261021'::text AS request_id,'sandy-agent-runtime-v4'::text AS source_runtime,
 '3aadfb520f651e9a6807cbb24b5d4409fcfbb25fb69fe5d72036916e44db8679'::text AS source_sha256,
 0 AS round,'gpt-4.1-mini'::text AS selected_model,repeat('a',64)::text AS request_sha256,'started'::text AS state;
SELECT pg_temp.v4_conversation_denied('v4 cannot select an arbitrary source hash',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,repeat('f',64),round,selected_model,request_sha256,state FROM v4_claim$$);
SELECT pg_temp.v4_conversation_denied('v4 cannot relabel the v2 source as its own',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,'d4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78',round,selected_model,request_sha256,state FROM v4_claim$$);
INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state) SELECT * FROM v4_claim;
SELECT pg_temp.v4_conversation_assert('exact v4 source allows an actual task-bound nullable-customer claim',
 (SELECT customer_id IS NULL AND auth_user_id IS NULL AND state='started' FROM public.sandy_runtime_conversation_audit WHERE task_id='52000000-0000-4000-8000-000000000001'));
INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,'52000000-0000-4000-8000-000000000002',channel,'runtime-v2-conversation-rollback-20261021','sandy-agent-runtime-v2','d4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78',round,selected_model,request_sha256,state FROM v4_claim;
INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,'52000000-0000-4000-8000-000000000003',channel,'runtime-v1-conversation-rollback-20261021','sandy-agent-runtime-v1-backup-r50','f4bfcd9191660fb4f2784d1e9d30151f204bee5eca096d49d02fa9fe330ab993',round,selected_model,request_sha256,state FROM v4_claim;
SELECT pg_temp.v4_conversation_assert('both previously deployed fallback source profiles remain supported',
 (SELECT count(*)=3 FROM public.sandy_runtime_conversation_audit WHERE task_id IN ('52000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000003')));
UPDATE public.sandy_runtime_conversation_audit SET state='succeeded',finished_at=now(),provider_response_id='resp_synthetic_v4_fixture',response_sha256=repeat('b',64)
 WHERE task_id='52000000-0000-4000-8000-000000000001' AND round=0;
SELECT pg_temp.v4_conversation_denied('v4 continuation cannot change source profile',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,'sandy-agent-runtime-v2','d4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78',1,selected_model,request_sha256,state FROM v4_claim$$);
INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,1,selected_model,request_sha256,state FROM v4_claim;
UPDATE public.sandy_runtime_conversation_audit SET state='unknown',finished_at=now(),error='synthetic_lost_broker_response'
 WHERE task_id='52000000-0000-4000-8000-000000000001' AND round=1;
SELECT pg_temp.v4_conversation_denied('unknown broker round cannot be followed by a paid continuation',
 $$INSERT INTO public.sandy_runtime_conversation_audit(operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,round,selected_model,request_sha256,state)
 SELECT operation,contract_version,principal_kind,auth_user_id,customer_id,task_id,channel,request_id,source_runtime,source_sha256,2,selected_model,request_sha256,state FROM v4_claim$$);
SELECT jsonb_build_object('status','pass','component_checks',count(*),'real_provider_calls',0,'all_changes_rolled_back',true) AS v4_runtime_conversation_component_evidence FROM v4_conversation_checks;
ROLLBACK;
