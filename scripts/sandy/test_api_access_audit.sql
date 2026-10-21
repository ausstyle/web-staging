-- Administrative SQL component suite only: no Auth users/sessions, providers,
-- communications, real owner credentials or existing production approvals used.
-- All membership, registry, credential, grant and audit fixtures roll back.
BEGIN;
DO $$
DECLARE
 actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); key_id uuid:=gen_random_uuid();
 rate_key uuid:=gen_random_uuid(); exp_key uuid:=gen_random_uuid(); revoked_key uuid:=gen_random_uuid();
 req uuid:=gen_random_uuid(); req2 uuid:=gen_random_uuid(); admission uuid; grant_id uuid;
 response jsonb; before_count bigint; after_count bigint; h text:=repeat('a',64);
 contract_hash text:=repeat('b',64); scope_hash text:=repeat('c',64); result_hash text:=repeat('d',64);
 fixture_job uuid:=gen_random_uuid(); fake_change uuid:=gen_random_uuid(); t text; f text;
BEGIN
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true),(viewer,'viewer',true),(other_owner,'owner',true);
 INSERT INTO public.sandy_operation_registry(operation,domain,permission_scope,is_mutation,input_schema,output_schema,
 handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state)
 VALUES('testing.access_policy.read','engineering','engineering:read',false,'{"type":"object"}','{"type":"object"}',
 'sandy-infrastructure-read',true,false,true,false,'deployed_unverified'),
 ('testing.access_policy.write','engineering','engineering:write',true,'{"type":"object"}','{"type":"object"}',
 'sandy-provider-operation-api',true,false,false,false,'deployed_unverified'),
 ('testing.access_policy.jwt_read','engineering','engineering:read',false,'{"type":"object"}','{"type":"object"}',
 'sandy-engineering-control',true,false,true,false,'deployed_unverified');
 FOREACH t IN ARRAY ARRAY['sandy_api_credentials','sandy_api_execution_admissions','sandy_api_rate_windows',
 'sandy_api_mutation_approval_snapshots','sandy_api_audit_events','sandy_api_audit_head','sandy_api_audit_checkpoints'] LOOP
  IF has_table_privilege('service_role','public.'||t,'INSERT') OR has_table_privilege('service_role','public.'||t,'UPDATE')
   OR has_table_privilege('service_role','public.'||t,'DELETE') OR has_table_privilege('anon','public.'||t,'SELECT')
   OR has_table_privilege('authenticated','public.'||t,'SELECT') THEN RAISE EXCEPTION 'policy table privileges too broad: %',t; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['sandy_api_current_owner(uuid)','sandy_api_registry_revision(text)',
 'sandy_api_capture_mutation_approval()','sandy_api_refuse_approval_snapshot_edit()'] LOOP
  IF has_function_privilege('service_role','public.'||f,'EXECUTE') THEN RAISE EXCEPTION 'private policy helper delegated: %',f; END IF;
 END LOOP;
 IF has_function_privilege('anon','public.sandy_api_authenticate_credential(uuid,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.sandy_api_authenticate_credential(uuid,text)','EXECUTE') THEN
  RAISE EXCEPTION 'credential RPC exposed to customer roles'; END IF;
 response:=public.sandy_api_issue_credential(viewer,key_id,h,NULL,ARRAY['testing.access_policy.read'],600,5,10);
 IF response->>'error' IS DISTINCT FROM 'owner_required' THEN RAISE EXCEPTION 'viewer issued key'; END IF;
 response:=public.sandy_api_issue_credential(actor,key_id,h,NULL,ARRAY['testing.access_policy.read'],3601,5,10);
 IF response->>'error' IS DISTINCT FROM 'invalid_credential_policy' THEN RAISE EXCEPTION 'excessive TTL accepted'; END IF;
 response:=public.sandy_api_issue_credential(actor,key_id,h,NULL,ARRAY['testing.access_policy.write'],600,5,10);
 IF response->>'error' IS DISTINCT FROM 'credential_operation_not_delegable' THEN RAISE EXCEPTION 'mutation key accepted'; END IF;
 response:=public.sandy_api_issue_credential(actor,key_id,h,NULL,ARRAY['testing.access_policy.jwt_read'],600,5,10);
 IF response->>'error' IS DISTINCT FROM 'credential_operation_not_delegable' THEN RAISE EXCEPTION 'JWT backend delegated to opaque key'; END IF;
 response:=public.sandy_api_issue_credential(actor,key_id,h,gen_random_uuid(),ARRAY['testing.access_policy.read'],600,5,10);
 IF response->>'error' IS DISTINCT FROM 'tenant_api_key_backend_unavailable' THEN RAISE EXCEPTION 'unimplemented tenant key accepted'; END IF;
 response:=public.sandy_api_issue_credential(actor,key_id,h,NULL,ARRAY['testing.access_policy.read'],600,5,10);
 IF response->>'ok' IS DISTINCT FROM 'true' OR response ? 'secret_sha256' THEN RAISE EXCEPTION 'key issuance metadata incorrect'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_api_credentials WHERE id=key_id AND secret_sha256=h AND expires_at<=issued_at+interval '1 hour') THEN
  RAISE EXCEPTION 'hash-only credential or TTL not persisted'; END IF;
 response:=public.sandy_api_authenticate_credential(key_id,repeat('f',64));
 IF response->>'error' IS DISTINCT FROM 'invalid_api_credential' THEN RAISE EXCEPTION 'wrong key hash accepted'; END IF;
 response:=public.sandy_api_authenticate_credential(key_id,h);
 IF response->>'principal_id' IS DISTINCT FROM actor::text OR response ? 'secret_sha256' THEN RAISE EXCEPTION 'key principal derivation failed'; END IF;
 response:=public.sandy_api_admit_execution(actor,NULL,'testing.access_policy.read',h,req,key_id,contract_hash,scope_hash,3,NULL);
 admission:=(response->>'admission_id')::uuid;grant_id:=(response->>'grant_id')::uuid;
 IF response->>'allowed' IS DISTINCT FROM 'true' OR response->>'executed' IS DISTINCT FROM 'false' OR admission IS NULL THEN RAISE EXCEPTION 'read admission failed'; END IF;
 SELECT count(*) INTO before_count FROM public.sandy_api_audit_events WHERE admission_id=admission;
 response:=public.sandy_api_admit_execution(actor,NULL,'testing.access_policy.read',h,req,key_id,contract_hash,scope_hash,3,NULL);
 IF response->>'reused' IS DISTINCT FROM 'true' OR response->>'allowed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'admission replay authorized redispatch'; END IF;
 SELECT count(*) INTO after_count FROM public.sandy_api_audit_events WHERE admission_id=admission;
 IF after_count<>before_count OR (SELECT admitted_units FROM public.sandy_api_credentials WHERE id=key_id)<>3 THEN RAISE EXCEPTION 'replay charged twice'; END IF;
 response:=public.sandy_api_admit_execution(actor,NULL,'testing.access_policy.read',repeat('e',64),req,key_id,contract_hash,scope_hash,3,NULL);
 IF response->>'error' IS DISTINCT FROM 'request_id_conflict' THEN RAISE EXCEPTION 'request digest collision accepted'; END IF;
 response:=public.sandy_api_consume_execution_grant(grant_id,actor,NULL,'testing.access_policy.read',repeat('e',64),req,contract_hash,scope_hash);
 IF response->>'error' IS DISTINCT FROM 'execution_grant_scope_denied' THEN RAISE EXCEPTION 'grant argument override accepted'; END IF;
 response:=public.sandy_api_consume_execution_grant(grant_id,actor,NULL,'testing.access_policy.read',h,req,contract_hash,scope_hash);
 IF response->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'grant consumption failed'; END IF;
 response:=public.sandy_api_consume_execution_grant(grant_id,actor,NULL,'testing.access_policy.read',h,req,contract_hash,scope_hash);
 IF response->>'error' IS DISTINCT FROM 'execution_grant_used_or_expired' THEN RAISE EXCEPTION 'consumed grant reused'; END IF;
 response:=public.sandy_api_get_execution_receipt(actor,req,key_id);
 IF response->>'request_state' IS DISTINCT FROM 'consumed' OR response->'executed'<>'null'::jsonb
  OR response->>'reconciliation_required' IS DISTINCT FROM 'true' OR response->>'redispatch_permitted' IS DISTINCT FROM 'false'
  OR response ? 'grant_id' OR response ? 'input_sha256' OR response ? 'credential_id' THEN RAISE EXCEPTION 'lost reply receipt unsafe'; END IF;
 response:=public.sandy_api_get_execution_receipt(other_owner,req,NULL);
 IF response->>'error' IS DISTINCT FROM 'admission_not_found' THEN RAISE EXCEPTION 'cross-owner receipt visible'; END IF;
 response:=public.sandy_api_finish_execution(admission,'succeeded',200,'opaque-provider-request',result_hash);
 IF response->>'state' IS DISTINCT FROM 'succeeded' OR response->>'reused' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'read receipt failed'; END IF;
 response:=public.sandy_api_finish_execution(admission,'succeeded',200,'opaque-provider-request',result_hash);
 IF response->>'reused' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'receipt replay not idempotent'; END IF;
 response:=public.sandy_api_finish_execution(admission,'failed',500,NULL,result_hash);
 IF response->>'error' IS DISTINCT FROM 'execution_receipt_conflict' THEN RAISE EXCEPTION 'terminal receipt overwritten'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions WHERE id=admission AND provider_request_id_sha256='opaque-provider-request') THEN RAISE EXCEPTION 'raw request ID stored'; END IF;
 response:=public.sandy_api_get_execution_receipt(actor,req,key_id);
 IF response->>'request_state' IS DISTINCT FROM 'succeeded' OR response->>'completed' IS DISTINCT FROM 'true'
  OR response->>'executed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'successful read receipt lost'; END IF;

 response:=public.sandy_api_admit_execution(actor,NULL,'testing.access_policy.read',h,gen_random_uuid(),key_id,contract_hash,scope_hash,8,NULL);
 IF response->>'error' IS DISTINCT FROM 'declared_unit_budget_exceeded' THEN RAISE EXCEPTION 'declared budget bypassed'; END IF;
 response:=public.sandy_api_admit_execution(actor,NULL,'testing.access_policy.jwt_read',h,gen_random_uuid(),key_id,contract_hash,scope_hash,0,NULL);
 IF response->>'error' IS DISTINCT FROM 'credential_scope_denied' THEN RAISE EXCEPTION 'key scope bypassed'; END IF;
 response:=public.sandy_api_admit_execution(viewer,NULL,'testing.access_policy.read',h,gen_random_uuid(),NULL,contract_hash,scope_hash,0,NULL);
 IF response->>'error' IS DISTINCT FROM 'owner_required' THEN RAISE EXCEPTION 'viewer got admission'; END IF;
 response:=public.sandy_api_admit_execution(actor,NULL,'testing.access_policy.write',h,gen_random_uuid(),NULL,contract_hash,scope_hash,0,NULL);
 IF response->>'error' IS DISTINCT FROM 'mutation_requires_verified_auth_approval' THEN RAISE EXCEPTION 'unverified write admitted'; END IF;
 UPDATE public.sandy_operation_registry SET verified=true WHERE operation='testing.access_policy.write';
 response:=public.sandy_api_admit_execution(actor,NULL,'testing.access_policy.write',h,gen_random_uuid(),NULL,contract_hash,scope_hash,0,NULL);
 IF response->>'error' IS DISTINCT FROM 'scoped_mutation_approval_required' THEN RAISE EXCEPTION 'unapproved write admitted'; END IF;
 -- A synthetic receipt fixture tests accepted != completed without fabricating
 -- an Auth user or pretending an unrelated real approval authorized a mutation.
 INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status,approved_by,approved_at)
 VALUES(fixture_job,'sandy-api-access-audit-rollback','google_cloud','get_vm','no-provider-target',fixture_job::text,'running',actor::text,clock_timestamp());
 INSERT INTO public.sandy_api_mutation_approval_snapshots(job_id,actor_id,engineering_change_id,operation,input_sha256,
 contract_sha256,scope_sha256,maximum_declared_cost_units,job_fingerprint_sha256)
 SELECT fixture_job,actor,fake_change,'testing.access_policy.write',h,contract_hash,scope_hash,1,public.sandy_api_job_fingerprint(j)
 FROM public.sandy_deployment_jobs j WHERE id=fixture_job;
 BEGIN
  UPDATE public.sandy_api_mutation_approval_snapshots SET input_sha256=repeat('e',64) WHERE sandy_api_mutation_approval_snapshots.job_id=fixture_job;
  RAISE EXCEPTION 'approval snapshot edit accepted';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'sandy_api_immutable_approval_snapshot' THEN RAISE; END IF; END;
 UPDATE public.sandy_deployment_jobs SET payload='{"changed_manifest":true}' WHERE id=fixture_job;
 response:=public.sandy_api_admit_execution(actor,NULL,'testing.access_policy.write',h,gen_random_uuid(),NULL,contract_hash,scope_hash,0,fixture_job);
 IF response->>'error' IS DISTINCT FROM 'scoped_mutation_approval_required' THEN RAISE EXCEPTION 'changed/nonexistent engineering proof accepted'; END IF;
 INSERT INTO public.sandy_api_execution_admissions(actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,
 scope_sha256,registry_revision_sha256,declared_cost_units,approval_id,expires_at,state)
 VALUES(actor,'testing.access_policy.write',req2,true,h,contract_hash,scope_hash,
 public.sandy_api_registry_revision('testing.access_policy.write'),0,fixture_job,clock_timestamp()+interval '60 seconds','consumed') RETURNING id INTO admission;
 response:=public.sandy_api_finish_execution(admission,'succeeded',200,NULL,result_hash);
 IF response->>'error' IS DISTINCT FROM 'mutation_readback_required' THEN RAISE EXCEPTION 'generic write200 counted as completion'; END IF;
 response:=public.sandy_api_finish_execution(admission,'accepted',202,'opaque-async-id',result_hash);
 IF response->>'state' IS DISTINCT FROM 'accepted' OR response->>'reconciliation_required' IS DISTINCT FROM 'true'
 OR (SELECT status FROM public.sandy_deployment_jobs WHERE id=fixture_job)<>'running' THEN RAISE EXCEPTION 'async acceptance became completion'; END IF;
 response:=public.sandy_api_get_execution_receipt(actor,req2,NULL);
 IF response->>'request_state' IS DISTINCT FROM 'accepted' OR response->>'accepted' IS DISTINCT FROM 'true'
  OR response->>'completed' IS DISTINCT FROM 'false' OR response->>'reconciliation_required' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'accepted receipt invented completion'; END IF;
 response:=public.sandy_api_issue_credential(actor,rate_key,repeat('e',64),NULL,ARRAY['testing.access_policy.read'],600,1,0);
 IF response->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'rate credential issuance failed'; END IF;
 response:=public.sandy_api_get_execution_receipt(actor,req,rate_key);
 IF response->>'error' IS DISTINCT FROM 'admission_not_found' THEN RAISE EXCEPTION 'key read another credential receipt'; END IF;

 response:=public.sandy_api_admit_execution(actor,NULL,'testing.access_policy.read',h,gen_random_uuid(),rate_key,contract_hash,scope_hash,0,NULL);
 IF response->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'per-key rate used another key counters'; END IF;
 response:=public.sandy_api_admit_execution(actor,NULL,'testing.access_policy.read',h,gen_random_uuid(),rate_key,contract_hash,scope_hash,0,NULL);
 IF response->>'error' IS DISTINCT FROM 'admission_rate_or_declared_units_exceeded' THEN RAISE EXCEPTION 'key rate limit bypassed'; END IF;
 response:=public.sandy_api_issue_credential(actor,exp_key,repeat('f',64),NULL,ARRAY['testing.access_policy.read'],60,1,0);
 UPDATE public.sandy_api_credentials SET issued_at=clock_timestamp()-interval '120 seconds',expires_at=clock_timestamp()-interval '60 seconds' WHERE id=exp_key;
 response:=public.sandy_api_authenticate_credential(exp_key,repeat('f',64));
 IF response->>'error' IS DISTINCT FROM 'invalid_api_credential' THEN RAISE EXCEPTION 'expired key accepted'; END IF;
 response:=public.sandy_api_revoke_credential(actor,key_id);
 IF response->>'revoked' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'key revocation failed'; END IF;
 response:=public.sandy_api_revoke_credential(actor,key_id);
 IF response->>'already_revoked' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'repeated revocation added audit'; END IF;
 response:=public.sandy_api_authenticate_credential(key_id,h);
 IF response->>'error' IS DISTINCT FROM 'invalid_api_credential' THEN RAISE EXCEPTION 'revoked key accepted'; END IF;
 response:=public.sandy_api_get_execution_receipt(actor,req,key_id);
 IF response->>'error' IS DISTINCT FROM 'invalid_api_credential' THEN RAISE EXCEPTION 'revoked key read receipt'; END IF;
 response:=public.sandy_api_get_execution_receipt(actor,req,NULL);
 IF response->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'owner lost receipt after revocation'; END IF;

 response:=public.sandy_api_verify_audit(actor);
 IF response->>'valid' IS DISTINCT FROM 'true' OR response->>'complete' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'audit chain invalid'; END IF;
 SET LOCAL timezone='Pacific/Auckland';
 response:=public.sandy_api_verify_audit(actor);
 IF response->>'valid' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'audit hash depends on session timezone'; END IF;
 SET LOCAL timezone='UTC';
 response:=public.sandy_api_checkpoint_audit(actor);
 IF response->>'external_anchor_established' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'database checkpoint claimed external trust'; END IF;
 response:=public.sandy_api_verify_audit(actor,0,repeat('f',64),1000);
 IF response->>'error' IS DISTINCT FROM 'audit_anchor_mismatch' THEN RAISE EXCEPTION 'external checkpoint mismatch accepted'; END IF;
 BEGIN
  UPDATE public.sandy_api_audit_events SET outcome='forged' WHERE sequence=(SELECT min(sequence) FROM public.sandy_api_audit_events);
  RAISE EXCEPTION 'audit edit accepted';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'sandy_api_append_only_audit' THEN RAISE; END IF; END;
 -- Privileged insertion is outside the service threat boundary, but the verifier
 -- must detect an unauthenticated tail rather than trusting only the head row.
 INSERT INTO public.sandy_api_audit_events(sequence,id,occurred_at,phase,outcome,previous_sha256,event_sha256)
 VALUES(nextval('public.sandy_api_audit_sequence'),gen_random_uuid(),clock_timestamp(),'tamper_fixture','forged',repeat('0',64),repeat('f',64));
 response:=public.sandy_api_verify_audit(actor);
 IF response->>'valid' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'audit tail tampering undetected'; END IF;
 PERFORM set_config('sandy.access_test_actor',actor::text,true);
 PERFORM set_config('sandy.access_test_credential',rate_key::text,true);
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE response jsonb; BEGIN
 response:=public.sandy_api_authenticate_credential(current_setting('sandy.access_test_credential')::uuid,repeat('e',64));
 IF response->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'service-role credential RPC unavailable'; END IF;
 BEGIN
  INSERT INTO public.sandy_api_credentials(id,principal_id,secret_sha256,allowed_operations,expires_at,requests_per_minute,declared_unit_budget)
  VALUES(gen_random_uuid(),gen_random_uuid(),repeat('9',64),ARRAY['testing.access_policy.read'],clock_timestamp()+interval '1 minute',1,0);
  RAISE EXCEPTION 'service-role wrote credential table directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.sandy_api_audit_head SET event_sha256=repeat('0',64) WHERE singleton;
  RAISE EXCEPTION 'service-role rewrote audit head';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.sandy_api_authenticate_credential(gen_random_uuid(),repeat('a',64));
  RAISE EXCEPTION 'customer role invoked credential RPC';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_component',
 'checks',ARRAY['synthetic_membership_only','no_auth_users_or_sessions_created','hash_only_key_storage','bounded_ttl',
 'key_read_scope','jwt_backend_refused','scope_actor_input_binding','idempotent_admission','no_double_charge',
 'per_key_rate','declared_unit_budget','revocation','expiry','one_use_grants','receipt_idempotency',
 'receipt_actor_key_scope','lost_reply_receipt_no_redispatch','revoked_key_receipt_denied',
 'unverified_or_unapproved_mutation_refused','immutable_approval_snapshot','changed_manifest_refused',
 'mutation_http200_not_completion','async_acceptance_recorded','append_only_audit','timezone_stable_hash',
 'audit_tail_tamper_detected','external_anchor_limits','service_only_rpcs','no_direct_service_table_writes'],
 'positive_real_mutation_approval_path_tested',false,'fixtures','rolled_back','provider_called',false,
 'controller_session_tested',false,'external_anchor_established',false) AS evidence;
ROLLBACK;
