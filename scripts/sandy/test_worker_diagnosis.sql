-- Real database state-machine/metadata test. All synthetic internal job records
-- are rolled back. No customer/owner identity, provider or model call is made.
BEGIN;
CREATE TEMP TABLE diagnosis_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.diagnosis_assert(name text,value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'worker diagnosis assertion failed: %',name; END IF; INSERT INTO diagnosis_checks VALUES(name); END $$;
CREATE FUNCTION pg_temp.diagnosis_reject(name text,statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
  IF position(expected IN SQLERRM)=0 THEN RAISE EXCEPTION 'unexpected rejection for %: %',name,SQLERRM; END IF;
  rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'missing expected rejection: %',name; END IF;
 INSERT INTO diagnosis_checks VALUES(name);
END $$;
CREATE TEMP TABLE diagnosis_fixtures(name text PRIMARY KEY,job_id uuid NOT NULL,receipt_id uuid);
WITH j AS(INSERT INTO public.sandy_auto_improve_runs(source_type,source_ref,problem,status) VALUES
 ('manual','rollback-diagnosis-unknown-'||gen_random_uuid(),'Rollback component failure description, no provider/model execution.','queued') RETURNING id)
 INSERT INTO diagnosis_fixtures SELECT 'unknown',id,NULL FROM j;
WITH j AS(INSERT INTO public.sandy_auto_improve_runs(source_type,source_ref,problem,status) VALUES
 ('manual','rollback-diagnosis-success-'||gen_random_uuid(),'Rollback component proposal description, no provider/model execution.','queued') RETURNING id)
 INSERT INTO diagnosis_fixtures SELECT 'success',id,NULL FROM j;
WITH j AS(INSERT INTO public.sandy_auto_improve_runs(source_type,source_ref,problem,status) VALUES
 ('qa_failure','rollback-diagnosis-qa-'||gen_random_uuid(),'Rollback component QA diagnosis, no provider/model execution.','queued') RETURNING id)
 INSERT INTO diagnosis_fixtures SELECT 'qa',id,NULL FROM j;
WITH j AS(INSERT INTO public.sandy_auto_improve_runs(source_type,source_ref,problem,status) VALUES
 ('qa_failure','rollback-diagnosis-handoff-loss-'||gen_random_uuid(),'Rollback component saved proposal, no provider/model execution.','queued') RETURNING id)
 INSERT INTO diagnosis_fixtures SELECT 'handoff_loss',id,NULL FROM j;
SELECT pg_temp.diagnosis_assert('closed cost mutation metadata',is_mutation AND NOT api_exposed AND NOT ui_exposed AND NOT ai_exposed AND NOT verified AND
 (error_contract->>'consumes_model_resources')::boolean AND (error_contract->>'sensitive')::boolean AND (error_contract->>'internal_only')::boolean AND
 handler='internal:agent.reliability.diagnosis.propose@1.0.0' AND input_schema->'properties'='{}'::jsonb AND input_schema->>'additionalProperties'='false')
 FROM public.sandy_operation_registry WHERE operation='agent.reliability.diagnosis.propose';
SELECT pg_temp.diagnosis_assert('no invented user customer or owner',
 output_schema->'properties'->'auth_user_id'->>'type'='null' AND output_schema->'properties'->'customer_id'->>'type'='null' AND
 error_contract->>'principal_kind'='trusted_internal_worker' AND NOT(error_contract->>'proposals_are_provider_execution_proof')::boolean)
 FROM public.sandy_operation_registry WHERE operation='agent.reliability.diagnosis.propose';
SELECT pg_temp.diagnosis_assert('receipt RLS and no direct application write',
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.sandy_worker_diagnosis_audit'::regclass) AND
 NOT has_table_privilege('anon','public.sandy_worker_diagnosis_audit','SELECT') AND NOT has_table_privilege('authenticated','public.sandy_worker_diagnosis_audit','SELECT') AND
 has_table_privilege('service_role','public.sandy_worker_diagnosis_audit','SELECT') AND NOT has_table_privilege('service_role','public.sandy_worker_diagnosis_audit','INSERT') AND
 NOT has_table_privilege('service_role','public.sandy_worker_diagnosis_audit','UPDATE'));
SELECT pg_temp.diagnosis_assert('only service transport can invoke worker receipt functions',
 NOT has_function_privilege('anon','public.sandy_claim_auto_improve_operation(uuid,text,text,text,text,text)','EXECUTE') AND
 NOT has_function_privilege('authenticated','public.sandy_claim_auto_improve_operation(uuid,text,text,text,text,text)','EXECUTE') AND
 has_function_privilege('service_role','public.sandy_claim_auto_improve_operation(uuid,text,text,text,text,text)','EXECUTE') AND
 NOT has_function_privilege('authenticated','public.sandy_finish_auto_improve_operation(uuid,text,text,text,text,text)','EXECUTE'));
SELECT pg_temp.diagnosis_reject('actual job is required',format('SELECT public.sandy_claim_auto_improve_operation(%L,%L,%L,%L,%L,%L)',gen_random_uuid(),'manual','absent',repeat('1',64),repeat('2',64),'7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74'),'diagnosis_actual_job_required');
SELECT pg_temp.diagnosis_reject('wrong problem digest cannot claim',format('SELECT public.sandy_claim_auto_improve_operation(%L,%L,%L,%L,%L,%L)',j.id,j.source_type,j.source_ref,repeat('1',64),repeat('2',64),'7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74'),'diagnosis_claim_job_scope_mismatch')
 FROM public.sandy_auto_improve_runs j JOIN diagnosis_fixtures f ON f.job_id=j.id WHERE f.name='unknown';
SELECT pg_temp.diagnosis_reject('wrong source profile cannot claim',format('SELECT public.sandy_claim_auto_improve_operation(%L,%L,%L,%L,%L,%L)',j.id,j.source_type,j.source_ref,encode(extensions.digest(j.problem,'sha256'),'hex'),repeat('2',64),repeat('f',64)),'diagnosis_claim_job_scope_mismatch')
 FROM public.sandy_auto_improve_runs j JOIN diagnosis_fixtures f ON f.job_id=j.id WHERE f.name='unknown';
SELECT pg_temp.diagnosis_assert('rejected claims preserve queued state with no receipt',j.status='queued' AND NOT EXISTS(SELECT 1 FROM public.sandy_worker_diagnosis_audit WHERE job_id=j.id))
 FROM public.sandy_auto_improve_runs j JOIN diagnosis_fixtures f ON f.job_id=j.id WHERE f.name='unknown';
UPDATE diagnosis_fixtures f SET receipt_id=(public.sandy_claim_auto_improve_operation(j.id,j.source_type,j.source_ref,encode(extensions.digest(j.problem,'sha256'),'hex'),repeat('2',64),'7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74')->>'id')::uuid
 FROM public.sandy_auto_improve_runs j WHERE j.id=f.job_id AND f.name IN('unknown','success');
SELECT pg_temp.diagnosis_assert('atomic claim changes actual job and records unprivileged identity',bool_and(j.status='analysing' AND a.state='started' AND a.auth_user_id IS NULL AND a.customer_id IS NULL AND a.principal_kind='trusted_internal_worker' AND a.problem_sha256=encode(extensions.digest(j.problem,'sha256'),'hex')))
 FROM diagnosis_fixtures f JOIN public.sandy_auto_improve_runs j ON j.id=f.job_id JOIN public.sandy_worker_diagnosis_audit a ON a.id=f.receipt_id WHERE f.name IN('unknown','success');
SELECT pg_temp.diagnosis_reject('started receipt cannot redispatch',format('SELECT public.sandy_claim_auto_improve_operation(%L,%L,%L,%L,%L,%L)',j.id,j.source_type,j.source_ref,encode(extensions.digest(j.problem,'sha256'),'hex'),repeat('2',64),'7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74'),'diagnosis_one_use_claim_already_exists')
 FROM public.sandy_auto_improve_runs j JOIN diagnosis_fixtures f ON f.job_id=j.id WHERE f.name='unknown';
SELECT pg_temp.diagnosis_reject('receipt scope is immutable',format('UPDATE public.sandy_worker_diagnosis_audit SET state=''unknown'',error=''diagnosis_outcome_requires_reconciliation'',finished_at=now(),request_sha256=%L WHERE id=%L',repeat('3',64),receipt_id),'diagnosis_receipt_scope_immutable') FROM diagnosis_fixtures WHERE name='unknown';
SELECT pg_temp.diagnosis_reject('success needs a stored proposal',format('SELECT public.sandy_finish_auto_improve_operation(%L,%L,%L,%L,%L,NULL)',receipt_id,'succeeded','resp_rollback_fixture',repeat('4',64),'{"root_cause":"Hypothesis","proposed_changes":[],"regression_tests":[]}'),'diagnosis_saved_proposal_receipt_required') FROM diagnosis_fixtures WHERE name='unknown';
SELECT pg_temp.diagnosis_assert('unknown receipt is committed without a fictitious proposal',public.sandy_finish_auto_improve_operation(receipt_id,'unknown',NULL,NULL,NULL,'diagnosis_outcome_requires_reconciliation')) FROM diagnosis_fixtures WHERE name='unknown';
SELECT pg_temp.diagnosis_assert('unknown sets compatible failed job status and preserves durable uncertainty',j.status='failed' AND a.state='unknown' AND a.proposal_sha256 IS NULL)
 FROM diagnosis_fixtures f JOIN public.sandy_auto_improve_runs j ON j.id=f.job_id JOIN public.sandy_worker_diagnosis_audit a ON a.id=f.receipt_id WHERE f.name='unknown';
UPDATE public.sandy_auto_improve_runs SET status='queued',updated_at=now()-interval '2 hours' WHERE id=(SELECT job_id FROM diagnosis_fixtures WHERE name='unknown');
SELECT pg_temp.diagnosis_reject('reset or historical failed-hour status cannot bypass one-use receipt',format('SELECT public.sandy_claim_auto_improve_operation(%L,%L,%L,%L,%L,%L)',j.id,j.source_type,j.source_ref,encode(extensions.digest(j.problem,'sha256'),'hex'),repeat('2',64),'7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74'),'diagnosis_one_use_claim_already_exists')
 FROM public.sandy_auto_improve_runs j JOIN diagnosis_fixtures f ON f.job_id=j.id WHERE f.name='unknown';
UPDATE public.sandy_auto_improve_runs SET status='proposed',diagnosis='{"root_cause":"Hypothesis"}',proposed_fix='{"root_cause":"Hypothesis","proposed_changes":[],"regression_tests":[]}' WHERE id=(SELECT job_id FROM diagnosis_fixtures WHERE name='success');
SELECT pg_temp.diagnosis_assert('actual stored unverified proposal permits a success receipt',public.sandy_finish_auto_improve_operation(receipt_id,'succeeded','resp_rollback_fixture',repeat('4',64),'{"root_cause":"Hypothesis","proposed_changes":[],"regression_tests":[]}',NULL)) FROM diagnosis_fixtures WHERE name='success';
SELECT pg_temp.diagnosis_assert('receipt hashes describe response and proposal without claiming deployment',a.state='succeeded' AND a.response_sha256=repeat('4',64) AND a.proposal_sha256=encode(extensions.digest('{"root_cause":"Hypothesis","proposed_changes":[],"regression_tests":[]}','sha256'),'hex'))
 FROM public.sandy_worker_diagnosis_audit a JOIN diagnosis_fixtures f ON f.receipt_id=a.id WHERE f.name='success';
SELECT pg_temp.diagnosis_reject('completed receipt cannot be reset',format('UPDATE public.sandy_worker_diagnosis_audit SET state=%L WHERE id=%L','started',receipt_id),'diagnosis_receipt_transition_denied') FROM diagnosis_fixtures WHERE name='success';
SELECT pg_temp.diagnosis_reject('QA job needs its actual existing issue before claim',format('SELECT public.sandy_claim_auto_improve_operation(%L,%L,%L,%L,%L,%L)',j.id,j.source_type,j.source_ref,encode(extensions.digest(j.problem,'sha256'),'hex'),repeat('2',64),'7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74'),'diagnosis_existing_qa_issue_required')
 FROM public.sandy_auto_improve_runs j JOIN diagnosis_fixtures f ON f.job_id=j.id WHERE f.name='qa';
INSERT INTO public.sandy_evidence_improvement_queue(issue_key,claim_type) SELECT 'v2:auto_qa:'||j.source_ref,'rollback_component_no_provider_claim' FROM public.sandy_auto_improve_runs j JOIN diagnosis_fixtures f ON f.job_id=j.id WHERE f.name IN('qa','handoff_loss');
UPDATE diagnosis_fixtures f SET receipt_id=(public.sandy_claim_auto_improve_operation(j.id,j.source_type,j.source_ref,encode(extensions.digest(j.problem,'sha256'),'hex'),repeat('2',64),'7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74')->>'id')::uuid
 FROM public.sandy_auto_improve_runs j WHERE j.id=f.job_id AND f.name IN('qa','handoff_loss');
UPDATE public.sandy_auto_improve_runs SET status='proposed',diagnosis='{"root_cause":"Hypothesis"}',proposed_fix='{"root_cause":"Hypothesis","proposed_changes":[],"regression_tests":[]}' WHERE id IN(SELECT job_id FROM diagnosis_fixtures WHERE name IN('qa','handoff_loss'));
SELECT pg_temp.diagnosis_reject('QA success cannot substitute model assertion for actual approval handoff',format('SELECT public.sandy_finish_auto_improve_operation(%L,%L,%L,%L,%L,NULL)',receipt_id,'succeeded','resp_rollback_fixture',repeat('4',64),'{"root_cause":"Hypothesis","proposed_changes":[],"regression_tests":[]}'),'diagnosis_actual_approval_handoff_required') FROM diagnosis_fixtures WHERE name='qa';
INSERT INTO public.sandy_qa_engineering_handoffs(issue_key,status,approval_required,evidence,verification)
 SELECT 'v2:auto_qa:'||j.source_ref,'fix_proposed',true,jsonb_build_object('source_type',j.source_type,'source_ref',j.source_ref,'diagnosis_id',j.id,'proposal_only',true),'{"status":"not_verified"}' FROM public.sandy_auto_improve_runs j JOIN diagnosis_fixtures f ON f.job_id=j.id WHERE f.name='qa';
SELECT pg_temp.diagnosis_assert('QA succeeds with actual scoped approval-required unverified handoff',public.sandy_finish_auto_improve_operation(receipt_id,'succeeded','resp_rollback_fixture',repeat('4',64),'{"root_cause":"Hypothesis","proposed_changes":[],"regression_tests":[]}',NULL)) FROM diagnosis_fixtures WHERE name='qa';
SELECT pg_temp.diagnosis_assert('lost handoff can be recorded unknown',public.sandy_finish_auto_improve_operation(receipt_id,'unknown','resp_rollback_fixture',repeat('4',64),NULL,'diagnosis_outcome_requires_reconciliation')) FROM diagnosis_fixtures WHERE name='handoff_loss';
SELECT pg_temp.diagnosis_assert('saved proposal survives later handoff uncertainty',j.status='proposed' AND j.proposed_fix->>'root_cause'='Hypothesis' AND a.state='unknown')
 FROM diagnosis_fixtures f JOIN public.sandy_auto_improve_runs j ON j.id=f.job_id JOIN public.sandy_worker_diagnosis_audit a ON a.id=f.receipt_id WHERE f.name='handoff_loss';
SELECT pg_temp.diagnosis_assert('receipt retains no failure text or raw source reference',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sandy_worker_diagnosis_audit' AND column_name IN('problem','source_ref','proposal','proposed_fix','authorization','credential')));
SELECT jsonb_build_object('status','pass','component_checks',count(*),'real_provider_calls',0,'real_model_calls',0,'real_customer_execution_tested',false,'all_changes_rolled_back',true) AS worker_diagnosis_evidence FROM diagnosis_checks;
ROLLBACK;
