-- Administrative PostgreSQL component fixtures only. No Auth user/session is
-- created, no customer resource is read, and no HTTP/provider request executes.
BEGIN;
DO $$ BEGIN
 IF has_function_privilege('anon','public.sandy_api_authenticate_customer_key(text)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_api_admit_customer_key_execution(uuid,uuid,text,text,text,text,text,uuid,text,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.sandy_api_authenticate_customer_key(text)','EXECUTE') THEN RAISE EXCEPTION 'customer_key_acl'; END IF;
END $$;
DO $$
DECLARE key_id uuid:=gen_random_uuid(); other_key uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); other_customer uuid:=gen_random_uuid();
 owner_id uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); req2 uuid:=gen_random_uuid(); admission uuid; grant_id uuid;
 metadata jsonb; result jsonb; revision text; scope_hash text; count_before integer; count_after integer;
BEGIN
 INSERT INTO public.sandy_operations_keys(id,customer_id,name,key_hash,prefix,scopes,expires_at)
 VALUES(key_id,customer,'Synthetic rollback routing fixture',repeat('a',64),'sandyop_00000000',ARRAY['tasks:read','calendar:write'],NULL),
 (other_key,other_customer,'Synthetic rollback routing fixture',repeat('b',64),'sandyop_00000000',ARRAY['tasks:read'],clock_timestamp()+interval '1 hour');
 UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true,handler='sandy-operations-api',permission_scope='tasks:read',is_mutation=false
 WHERE operation='tasks.list';
 metadata:=public.sandy_api_authenticate_customer_key(repeat('a',64));
 IF metadata->>'kind'<>'customer_key' OR (metadata->>'key_id')::uuid<>key_id OR (metadata->>'customer_id')::uuid<>customer
 OR metadata->'allowed_operations'<>'["tasks.get","tasks.list"]'::jsonb OR metadata->'expires_at'<>'null'::jsonb
 OR metadata ?| ARRAY['actor_id','auth_user_id','email','key_hash','secret_sha256','value'] THEN RAISE EXCEPTION 'customer_key_identity_fabricated_or_exposed'; END IF;
 revision:=metadata->>'key_revision_sha256';scope_hash:=public.sandy_api_customer_key_scope_sha256(key_id,customer,'tasks:read',revision);
 result:=public.sandy_api_authenticate_customer_key(repeat('f',64));
 IF result->>'error'<>'invalid_customer_key' THEN RAISE EXCEPTION 'wrong_secret_accepted'; END IF;
 result:=public.sandy_api_admit_customer_key_execution(key_id,other_customer,repeat('a',64),revision,'tasks.list','api',repeat('1',64),request_id,repeat('2',64),scope_hash);
 IF result->>'error'<>'customer_key_scope_denied' THEN RAISE EXCEPTION 'caller_tenant_override'; END IF;
 result:=public.sandy_api_admit_customer_key_execution(key_id,customer,repeat('b',64),revision,'tasks.list','api',repeat('1',64),request_id,repeat('2',64),scope_hash);
 IF result->>'error'<>'customer_key_scope_denied' THEN RAISE EXCEPTION 'different_key_hash_accepted'; END IF;
 result:=public.sandy_api_admit_customer_key_execution(key_id,customer,repeat('a',64),revision,'calendar.list','api',repeat('1',64),request_id,repeat('2',64),scope_hash);
 IF result->>'error'<>'customer_key_scope_denied' THEN RAISE EXCEPTION 'write_scope_implies_read'; END IF;
 result:=public.sandy_api_admit_customer_key_execution(key_id,customer,repeat('a',64),revision,'tasks.create','api',repeat('1',64),request_id,repeat('2',64),scope_hash);
 IF result->>'error'<>'customer_key_scope_denied' THEN RAISE EXCEPTION 'key_mutation_admitted'; END IF;
 result:=public.sandy_api_admit_customer_key_execution(key_id,customer,repeat('a',64),revision,'tasks.list','api',repeat('1',64),request_id,repeat('2',64),repeat('3',64));
 IF result->>'error'<>'customer_key_contract_changed' THEN RAISE EXCEPTION 'tenant_scope_digest_ignored'; END IF;
 result:=public.sandy_api_admit_customer_key_execution(key_id,customer,repeat('a',64),revision,'tasks.list','api',repeat('1',64),request_id,repeat('2',64),scope_hash);
 IF result->>'allowed'<>'true' OR result->>'principal_kind'<>'customer_key' THEN RAISE EXCEPTION 'customer_key_admission_refused'; END IF;
 admission:=(result->>'admission_id')::uuid;grant_id:=(result->>'grant_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions WHERE id=admission AND actor_id IS NULL AND principal_kind='customer_key'
 AND customer_key_id=key_id AND tenant_id=customer AND credential_id IS NULL AND approval_id IS NULL AND declared_cost_units=0 AND NOT is_mutation) THEN RAISE EXCEPTION 'shared_admission_identity_wrong'; END IF;
 SELECT sum(requests) INTO count_before FROM public.sandy_api_customer_key_rate_windows WHERE customer_id=customer;
 result:=public.sandy_api_admit_customer_key_execution(key_id,customer,repeat('a',64),revision,'tasks.list','api',repeat('1',64),request_id,repeat('2',64),scope_hash);
 IF result->>'error'<>'admission_already_recorded' THEN RAISE EXCEPTION 'replay_authorizes_execution'; END IF;
 SELECT sum(requests) INTO count_after FROM public.sandy_api_customer_key_rate_windows WHERE customer_id=customer;
 IF count_before<>count_after THEN RAISE EXCEPTION 'replay_charged_twice'; END IF;
 result:=public.sandy_api_admit_customer_key_execution(key_id,customer,repeat('a',64),revision,'tasks.list','api',repeat('4',64),request_id,repeat('2',64),scope_hash);
 IF result->>'error'<>'request_id_conflict' THEN RAISE EXCEPTION 'request_input_conflict'; END IF;
 result:=public.sandy_api_consume_customer_key_grant(grant_id,key_id,customer,repeat('a',64),revision,'tasks.list','api',repeat('4',64),request_id,repeat('2',64),scope_hash);
 IF result->>'error'<>'customer_key_grant_scope_denied' THEN RAISE EXCEPTION 'grant_input_override'; END IF;
 result:=public.sandy_api_get_customer_key_receipt(other_key,other_customer,repeat('b',64),request_id);
 IF result->>'error'<>'admission_not_found' THEN RAISE EXCEPTION 'cross_key_receipt_disclosure'; END IF;
 result:=public.sandy_api_consume_execution_grant(grant_id,key_id,customer,'tasks.list',repeat('1',64),request_id,repeat('2',64),scope_hash);
 IF result->>'error'<>'execution_grant_scope_denied' THEN RAISE EXCEPTION 'key_masquerades_as_auth'; END IF;
 BEGIN UPDATE public.sandy_api_execution_admissions SET actor_id=owner_id WHERE id=admission;
 RAISE EXCEPTION 'principal_changed'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'sandy_api_admission_identity_immutable' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.sandy_api_execution_admissions(actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,expires_at)
 VALUES(NULL,'tasks.list',gen_random_uuid(),false,repeat('1',64),repeat('2',64),repeat('3',64),repeat('4',64),0,clock_timestamp()+interval '1 minute');
 RAISE EXCEPTION 'null_auth_actor_accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE public.sandy_operations_keys SET last_used_at=clock_timestamp() WHERE id=key_id;
 result:=public.sandy_api_consume_customer_key_grant(grant_id,key_id,customer,repeat('a',64),revision,'tasks.list','api',repeat('1',64),request_id,repeat('2',64),scope_hash);
 IF result->>'allowed'<>'true' THEN RAISE EXCEPTION 'customer_grant_refused'; END IF;
 result:=public.sandy_api_consume_customer_key_grant(grant_id,key_id,customer,repeat('a',64),revision,'tasks.list','api',repeat('1',64),request_id,repeat('2',64),scope_hash);
 IF result->>'error'<>'customer_key_grant_used_or_expired' THEN RAISE EXCEPTION 'customer_grant_replayed'; END IF;
 result:=public.sandy_api_get_customer_key_receipt(key_id,customer,repeat('a',64),request_id);
 IF result->>'request_state'<>'consumed' OR result->'executed'<>'null'::jsonb OR result->>'redispatch_permitted'<>'false'
 OR result ?| ARRAY['grant_id','customer_key_id','input_sha256','scope_sha256','key_hash'] THEN RAISE EXCEPTION 'unknown_receipt_unsafe'; END IF;
 result:=public.sandy_api_finish_execution(admission,'succeeded',200,NULL,repeat('5',64));
 IF result->>'state'<>'succeeded' THEN RAISE EXCEPTION 'shared_finish_unavailable'; END IF;
 result:=public.sandy_api_get_customer_key_receipt(key_id,customer,repeat('a',64),request_id);
 IF result->>'completed'<>'true' OR result->>'request_state'<>'succeeded' THEN RAISE EXCEPTION 'customer_receipt_result_lost'; END IF;
 IF (SELECT count(*) FROM public.sandy_api_audit_events WHERE admission_id=admission)<>3
 OR EXISTS(SELECT 1 FROM public.sandy_api_audit_events WHERE admission_id=admission AND actor_id IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM public.sandy_api_audit_events WHERE admission_id=admission AND phase='customer_key_admission' AND credential_id=key_id) THEN RAISE EXCEPTION 'central_audit_wrong_principal'; END IF;
 -- Independent API/AI controls are rechecked at the final consumption boundary.
 result:=public.sandy_api_admit_customer_key_execution(key_id,customer,repeat('a',64),revision,'tasks.list','mcp',repeat('1',64),req2,repeat('2',64),scope_hash);
 grant_id:=(result->>'grant_id')::uuid;
 UPDATE public.sandy_operation_registry SET ai_exposed=false WHERE operation='tasks.list';
 result:=public.sandy_api_consume_customer_key_grant(grant_id,key_id,customer,repeat('a',64),revision,'tasks.list','mcp',repeat('1',64),req2,repeat('2',64),scope_hash);
 IF result->>'error'<>'customer_key_scope_denied' THEN RAISE EXCEPTION 'changed_ai_scope_consumed'; END IF;
 result:=public.sandy_api_admit_customer_key_execution(key_id,customer,repeat('a',64),revision,'tasks.list','api',repeat('1',64),gen_random_uuid(),repeat('2',64),scope_hash);
 IF result->>'allowed'<>'true' THEN RAISE EXCEPTION 'api_ai_exposure_conflated'; END IF;
 UPDATE public.sandy_operations_keys SET scopes=ARRAY['files:read'] WHERE id=key_id;
 result:=public.sandy_api_consume_customer_key_grant(grant_id,key_id,customer,repeat('a',64),revision,'tasks.list','mcp',repeat('1',64),req2,repeat('2',64),scope_hash);
 IF result->>'error'<>'customer_key_scope_denied' THEN RAISE EXCEPTION 'changed_scope_consumed'; END IF;
 UPDATE public.sandy_operations_keys SET revoked_at=clock_timestamp() WHERE id=key_id;
 result:=public.sandy_api_authenticate_customer_key(repeat('a',64));
 IF result->>'error'<>'invalid_customer_key' THEN RAISE EXCEPTION 'revoked_key_accepted'; END IF;
 result:=public.sandy_api_get_customer_key_receipt(key_id,customer,repeat('a',64),request_id);
 IF result->>'error'<>'invalid_customer_key' THEN RAISE EXCEPTION 'revoked_key_receipt'; END IF;
 UPDATE public.sandy_operations_keys SET expires_at=clock_timestamp()-interval '1 second' WHERE id=other_key;
 result:=public.sandy_api_authenticate_customer_key(repeat('b',64));
 IF result->>'error'<>'invalid_customer_key' THEN RAISE EXCEPTION 'expired_key_accepted'; END IF;
 UPDATE public.sandy_operations_keys SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=other_key;
 metadata:=public.sandy_api_authenticate_customer_key(repeat('b',64));
 INSERT INTO public.sandy_api_customer_key_rate_windows(customer_id,bucket,window_start,requests)
 VALUES(other_customer,'tenant',date_trunc('minute',clock_timestamp()),60) ON CONFLICT(customer_id,bucket,window_start) DO UPDATE SET requests=60;
 result:=public.sandy_api_admit_customer_key_execution(other_key,other_customer,repeat('b',64),metadata->>'key_revision_sha256','tasks.list','api',repeat('1',64),gen_random_uuid(),repeat('2',64),
 public.sandy_api_customer_key_scope_sha256(other_key,other_customer,'tasks:read',metadata->>'key_revision_sha256'));
 IF result->>'error'<>'customer_key_rate_exceeded' THEN RAISE EXCEPTION 'tenant_rate_bypassed'; END IF;
 UPDATE public.sandy_operations_keys SET revoked_at=clock_timestamp() WHERE id=other_key;
 -- Existing normal owner admission remains on its unchanged Auth identity path.
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(owner_id,'owner',true);
 result:=public.sandy_api_admit_execution(owner_id,NULL,'tasks.list',repeat('1',64),gen_random_uuid(),NULL,repeat('2',64),repeat('3',64),0,NULL);
 IF result->>'allowed'<>'true' OR NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions WHERE id=(result->>'admission_id')::uuid
 AND principal_kind='auth_user' AND actor_id=owner_id AND customer_key_id IS NULL) THEN RAISE EXCEPTION 'owner_admission_changed'; END IF;
 result:=public.sandy_api_verify_audit(owner_id);
 IF result->>'valid'<>'true' THEN RAISE EXCEPTION 'shared_audit_chain_broken'; END IF;
 PERFORM set_config('sandy.customer_key_test_hash',repeat('b',64),true);
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.sandy_api_authenticate_customer_key(repeat('a',64)); RAISE EXCEPTION 'customer_rpc_exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.sandy_api_authenticate_customer_key(current_setting('sandy.customer_key_test_hash'));
 IF result->>'error'<>'invalid_customer_key' THEN RAISE EXCEPTION 'service_rpc_missing'; END IF;
 BEGIN INSERT INTO public.sandy_api_customer_key_rate_windows VALUES(gen_random_uuid(),'forged',clock_timestamp(),0); RAISE EXCEPTION 'service_direct_rate_write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_customer_key_policy_component',
 'checks',ARRAY['service_only_rpcs','no_auth_identity_fabricated','stored_scope_derivation','nullable_legacy_expiry','wrong_hash_refused','tenant_override_refused',
 'write_scope_not_read','mutations_closed','tenant_scope_digest','same_central_admission','idempotency_no_redispatch','no_double_rate_charge','input_conflict',
 'one_use_scoped_grant','cross_key_receipt_404','owner_grant_rejects_customer_key','immutable_identity','null_auth_actor_refused','last_used_not_identity_revision','tenant_rate_limit','unknown_receipt_no_redispatch','shared_finish',
 'same_append_only_audit','api_ai_flags_rechecked','scope_change','revocation','expiry','owner_path_regression','audit_hash_chain','no_direct_service_writes'],
 'fixtures','rolled_back','auth_users_created',false,'auth_session_tested',false,'customer_resource_read',false,'provider_called',false) AS evidence;
ROLLBACK;
