-- Legacy provider component fixture only. No HTTP Auth session/provider calls/credential material.
BEGIN;
SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='3s';
DO $trigger_guard$
BEGIN
 IF EXISTS(
  SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE NOT t.tgisinternal AND (
   n.nspname='auth' AND c.relname='users' OR n.nspname='public' AND c.relname IN
   ('email_customers','sandy_agenda_access','sandy_tasks','sandy_calendar_events',
    'sandy_universal_files','sandy_agenda_companies','sandy_agenda_categories',
    'sandy_memory_portal_accounts','email_customer_addresses','sandy_memory_settings',
    'sandy_temporal_facts','sandy_temporal_triggers','sandy_task_events'))
  AND NOT EXISTS(SELECT 1 FROM (VALUES
   ('net','http_post','05103078b4b36c776bc0925f4fecf8e2'),
   ('public','sandy_agenda_category_prevent_cycle','e7c1ae21e27ff5ee1f38c8a5f12e48e0'),
   ('public','sandy_agenda_task_company_guard','a12c1f18921df22ff346f83aaffe52ba'),
   ('public','sandy_calendar_enqueue_event','549bb2516d861abf39232bce49a02dbe'),
   ('public','sandy_calendar_plan_task_dates','8794732d85f6f73aadbf423c50499faf'),
   ('public','sandy_calendar_propose_due_changes','a0def30314192eb96338ab5ed179ff31'),
   ('public','sandy_calendar_replan_on_event_change','ecaa8aae639fb4387c1e08baeea1231b'),
   ('public','sandy_company_prevent_duplicate','ecf56d01c77909395e64034094549d7d'),
   ('public','sandy_company_prevent_duplicate','8b73dcba4cb3c07b9a37c16e79cb9a9d'),
   ('public','sandy_default_task_responsibility','f9c5d6e2476bfa9081211af7290e8160'),
   ('public','sandy_initialise_member_memory','40515b54d1cccfd1d671f6d33cb4c754'),
   ('public','sandy_life_settings_seed_trigger','1b207174e593ce00beb2a36253e6da7b'),
   ('public','sandy_life_task_default_context','7cb49cc3a348a3a5e7f5d390b7a3f562'),
   ('public','sandy_mission_enqueue_new','889bbb237231b30bc98b77bafd0f812d'),
   ('public','sandy_mission_guard_review_status','a29ef62cc45007549b97c3295623efc3'),
   ('public','sandy_queue_new_customer_drive','7b200107d31e8915d7a756383d86614a'),
   ('public','sandy_task_enqueue_analysis','b897552ed35245daab4f23d08c882960'),
   ('public','sandy_task_event_audit','52e91a2f057d05c9ee47db9d55c37454'),
   ('public','sandy_task_stamp_and_validate','dfdc9cb6623e492c7fd9de5e9e87aa21'),
   ('public','sandy_temporal_dependency_unblocked','46d7e4ce4aac885292e18efcd5e989a6'),
   ('public','sandy_temporal_task_change','4f497435196c2e2b5fc09f41f516423a')
  ) safe(schema_name,function_name,source_md5)
  WHERE safe.schema_name=(SELECT nspname FROM pg_namespace WHERE oid=p.pronamespace)
   AND safe.function_name=p.proname AND safe.source_md5=md5(pg_get_functiondef(p.oid)))
 ) THEN RAISE EXCEPTION 'Fixture trigger drift: inspect deployed trigger source before running'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='net' AND p.proname='http_post' AND md5(pg_get_functiondef(p.oid))='05103078b4b36c776bc0925f4fecf8e2') THEN
  RAISE EXCEPTION 'PG-net asynchronous queue implementation changed: no task-create fixture permitted';
 END IF;
END $trigger_guard$;
DO $approval_trigger_guard$ BEGIN IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN('sandy_controller_admins','sandy_engineering_changes','sandy_deployment_jobs') AND NOT EXISTS(SELECT 1 FROM(VALUES ('sandy_api_capture_mutation_approval','b95469e8fc5337dd01a18fc64e633a28'),('sandy_api_capture_read_job_approval','05809076f961fa8fef71be6da2ee2eeb'),('sandy_api_read_retry_job_scope','8eb63ada7681b1ff7306e45589502240'),('sandy_api_update_read_retry_target_pin','79c54b42562a576636b23274df5a4236'),('sandy_orch_legacy_job_pin','b3012701c2fe98755641e9f9dfe9acc8'),('sandy_orch_legacy_request_scope','051e4ed896cde2c520ba32d0e9cecc78'),('sandy_require_engineering_change_write','ebac0f91a816e77f351911eb8ba5ea24'))safe(name,source_md5) WHERE safe.name=t.tgname AND safe.source_md5=md5(pg_get_functiondef(p.oid)))) THEN RAISE EXCEPTION 'approval_fixture_trigger_drift';END IF;END $approval_trigger_guard$;

CREATE TEMP TABLE vm_protocol_checks(label text PRIMARY KEY) ON COMMIT DROP;
CREATE FUNCTION pg_temp.vm_check(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'VM protocol check failed: %',label;END IF;INSERT INTO pg_temp.vm_protocol_checks VALUES(label);END $$;
CREATE FUNCTION pg_temp.vm_admit(op text,args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=current_setting('vm.test.owner')::uuid;config public.sandy_vm_protocol_contracts;change_id uuid;approval uuid;manifest jsonb;rid uuid:=gen_random_uuid();admission jsonb;arguments_canonical text:=args::text;scope_canonical text;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 SELECT * INTO config FROM public.sandy_vm_protocol_contracts WHERE operation=op;
 scope_canonical:=public.sandy_vm_protocol_scope(op,args,actor)::text;
 INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,requested_by,status,change_purpose,feature_improvement) VALUES('VM protocol rollback fixture','Exact protocol owner proof','No remote provider/VM execution',actor,'approved','Rollback fixture only','Pinned protocol custody') RETURNING id INTO change_id;
 manifest:=jsonb_build_object('operation',op,'input_sha256',encode(extensions.digest(arguments_canonical,'sha256'),'hex'),'contract_sha256',config.contract_sha256,'scope_sha256',encode(extensions.digest(scope_canonical,'sha256'),'hex'),'maximum_declared_cost_units',0);
 INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status,approved_by,approved_at,engineering_change_id) VALUES(actor::text,'supabase','write','vm-protocol-rollback-only',jsonb_build_object('sandy_api_execution',manifest),gen_random_uuid()::text,'approved',actor::text,clock_timestamp(),change_id) RETURNING id INTO approval;
 admission:=public.sandy_api_admit_execution(actor,NULL,op,encode(extensions.digest(arguments_canonical,'sha256'),'hex'),rid,NULL,config.contract_sha256,encode(extensions.digest(scope_canonical,'sha256'),'hex'),0,approval);
 IF admission->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'VM fixture admit refused: %',admission;END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','service_role')::text,true);
 RETURN jsonb_build_object('operation',op,'arguments',args,'canonical_arguments',arguments_canonical,'canonical_scope',scope_canonical,'actor_id',actor,'tenant_id',NULL,'credential_id',NULL,'request_id',rid,'grant_id',admission->>'grant_id','admission_id',admission->>'admission_id');
END $$;
CREATE FUNCTION pg_temp.vm_consume(c jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE result jsonb;config public.sandy_vm_protocol_contracts;
BEGIN
 SELECT * INTO config FROM public.sandy_vm_protocol_contracts WHERE operation=c->>'operation';
 result:=public.sandy_vm_protocol_context(c);
 IF result->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'VM fixture context refused: %',result;END IF;
 result:=public.sandy_api_consume_execution_grant((c->>'grant_id')::uuid,(c->>'actor_id')::uuid,NULL,c->>'operation',encode(extensions.digest(c->>'canonical_arguments','sha256'),'hex'),(c->>'request_id')::uuid,config.contract_sha256,encode(extensions.digest(c->>'canonical_scope','sha256'),'hex'));
 IF result->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'VM fixture consume refused: %',result;END IF;
END $$;
CREATE FUNCTION pg_temp.vm_metadata(c jsonb,p jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$SELECT public.sandy_vm_protocol_metadata((c->>'actor_id')::uuid,(c->>'admission_id')::uuid,c->>'operation',c->>'canonical_arguments',c->>'canonical_scope',p)$$;
CREATE FUNCTION pg_temp.vm_resolve(c jsonb,command_sha text DEFAULT NULL,recipe_sha text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$SELECT public.sandy_vm_protocol_resolve_execution((c->>'actor_id')::uuid,(c->>'admission_id')::uuid,c->>'operation',c->>'canonical_arguments',c->>'canonical_scope',command_sha,recipe_sha)$$;
CREATE FUNCTION pg_temp.vm_claim(c jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT public.sandy_vm_protocol_claim_execution((c->>'actor_id')::uuid,(c->>'admission_id')::uuid,c->>'operation',c->>'canonical_arguments',c->>'canonical_scope')$$;
CREATE FUNCTION pg_temp.vm_save(c jsonb,r jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT public.sandy_vm_protocol_save_result((c->>'actor_id')::uuid,(c->>'admission_id')::uuid,c->>'operation',c->>'canonical_arguments',c->>'canonical_scope',r)$$;
CREATE FUNCTION pg_temp.vm_finish_document(c jsonb) RETURNS text LANGUAGE plpgsql AS $$DECLARE result jsonb;mutation boolean;contract_version text;material text;BEGIN
 SELECT m.result INTO result FROM public.sandy_vm_protocol_metadata_receipts m WHERE m.admission_id=(c->>'admission_id')::uuid;
 IF result IS NULL THEN SELECT receipt_metadata||jsonb_build_object('custody_id',id,'output_sha256',payload_sha256) INTO result FROM public.sandy_vm_protocol_outputs WHERE admission_id=(c->>'admission_id')::uuid;END IF;
 IF c->'arguments'->>'include_output'='true' THEN
  SELECT d.decrypted_secret INTO material FROM public.sandy_vm_protocol_outputs o JOIN vault.decrypted_secrets d ON d.id=o.vault_secret_id WHERE o.admission_id=(c->>'admission_id')::uuid;
  result:=result||jsonb_build_object('stdout_base64',convert_from(decode(material,'base64'),'UTF8')::jsonb->>'stdout_base64','stderr_base64',convert_from(decode(material,'base64'),'UTF8')::jsonb->>'stderr_base64');
 END IF;
 SELECT output_schema->'properties'->'contract_version'->>'const' INTO contract_version FROM public.sandy_vm_protocol_contracts WHERE operation=c->>'operation';
 SELECT is_mutation INTO mutation FROM public.sandy_api_execution_admissions WHERE id=(c->>'admission_id')::uuid;
 RETURN jsonb_build_object('ok',true,'operation',c->>'operation','contract_version',contract_version,'request_state',CASE WHEN mutation THEN 'completed' ELSE 'observed' END,'executed',true,'admission_id',c->>'admission_id','result',result,'reconciliation_required',false)::text;END $$;
CREATE FUNCTION pg_temp.vm_finish(c jsonb) RETURNS void LANGUAGE plpgsql AS $$DECLARE r jsonb;outdoc text:=pg_temp.vm_finish_document(c);BEGIN
 r:=public.sandy_vm_protocol_finish((c->>'admission_id')::uuid,'succeeded',encode(extensions.digest(outdoc,'sha256'),'hex'),outdoc);IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'VM finish refused: %',r;END IF;END $$;
DO $fixture$
DECLARE actor uuid:=gen_random_uuid();c jsonb;enroll jsonb;registration jsonb;execution jsonb;b jsonb;cmd jsonb;r jsonb;saved jsonb;bytes bytea;material jsonb;denied boolean;old_registry jsonb;output_id uuid;op text;bad text;configuration jsonb;secret uuid;windows_enroll jsonb;
BEGIN
 PERFORM set_config('vm.test.owner',actor::text,true);
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(actor,'authenticated','authenticated','sandy-vm-protocol-rollback-'||actor::text||'@example.invalid',now(),'{"provider":"email"}','{"sandy_vm_protocol_fixture":true}');
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true);
 PERFORM pg_temp.vm_check('all_nine_closed',(SELECT count(*)=9 FROM public.sandy_operation_registry WHERE handler='sandy-vm-protocol-api' AND NOT api_exposed AND NOT ai_exposed AND NOT ui_exposed AND NOT verified));
 FOREACH op IN ARRAY ARRAY['contracts','bindings','commands','outputs','attempts','admission_contexts','metadata_receipts'] LOOP PERFORM pg_temp.vm_check(op||'_private_acl',NOT has_table_privilege('authenticated','public.sandy_vm_protocol_'||op,'SELECT') AND NOT has_table_privilege('service_role','public.sandy_vm_protocol_'||op,'SELECT'));END LOOP;
 PERFORM pg_temp.vm_check('resolver_rpc_private',NOT has_function_privilege('authenticated','public.sandy_vm_protocol_resolve_execution(uuid,uuid,text,text,text,text,text)','EXECUTE') AND NOT has_function_privilege('anon','public.sandy_vm_protocol_resolve_execution(uuid,uuid,text,text,text,text,text)','EXECUTE'));
 IF EXISTS(SELECT 1 FROM public.sandy_credential_consumer_bindings WHERE consumer='gcp_access_token') THEN RAISE EXCEPTION 'No production credential read permitted by VM rollback fixture';END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE handler='sandy-vm-protocol-api';
 enroll:=pg_temp.vm_admit('gcp.vm.protocol_bindings.enroll',jsonb_build_object('vm_name','sandy-video','ssh',jsonb_build_object('mode','private_key','host_key_sha256','SHA256:'||repeat('A',43))));
 r:=public.sandy_vm_protocol_context(enroll);IF r->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'enrollment fixture policy: %',r;END IF;PERFORM pg_temp.vm_check('enrollment_owner_context',true);
 PERFORM pg_temp.vm_check('foreign_actor_refused',public.sandy_vm_protocol_context(enroll||jsonb_build_object('actor_id',gen_random_uuid()))->>'allowed'='false');
 PERFORM pg_temp.vm_check('altered_input_refused',public.sandy_vm_protocol_context(enroll||jsonb_build_object('arguments','{}'::jsonb,'canonical_arguments','{}'))->>'allowed'='false');
 PERFORM pg_temp.vm_check('delegated_identity_refused',public.sandy_vm_protocol_context(enroll||jsonb_build_object('credential_id',gen_random_uuid()))->>'allowed'='false');
 PERFORM pg_temp.vm_check('scope_substitution_refused',public.sandy_vm_protocol_context(enroll||jsonb_build_object('canonical_scope','{}'))->>'allowed'='false');
 UPDATE auth.users SET email_confirmed_at=NULL WHERE id=actor;PERFORM pg_temp.vm_check('unconfirmed_owner_refused',public.sandy_vm_protocol_context(enroll)->>'allowed'='false');UPDATE auth.users SET email_confirmed_at=clock_timestamp() WHERE id=actor;
 SELECT error_contract INTO old_registry FROM public.sandy_operation_registry WHERE operation=enroll->>'operation';UPDATE public.sandy_operation_registry SET error_contract=error_contract||'{"requires_approval":false}'::jsonb WHERE operation=enroll->>'operation';
 PERFORM pg_temp.vm_check('approval_metadata_drift_refused',public.sandy_vm_protocol_context(enroll)->>'allowed'='false');UPDATE public.sandy_operation_registry SET error_contract=old_registry WHERE operation=enroll->>'operation';
 PERFORM pg_temp.vm_consume(enroll);
 denied:=false;BEGIN PERFORM pg_temp.vm_metadata(enroll,'{"identity_pin_verified":false}'::jsonb);EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='owner_verified_identity_pin_required';END;PERFORM pg_temp.vm_check('enrollment_without_identity_probe_refused',denied);
 b:=pg_temp.vm_metadata(enroll,jsonb_build_object('identity_pin_verified',true,'vm_proof_sha256',repeat('a',64)));
 bad:=jsonb_set(pg_temp.vm_finish_document(enroll)::jsonb,'{result,vm_proof_sha256}',to_jsonb(repeat('f',64)))::text;
 denied:=false;BEGIN PERFORM public.sandy_vm_protocol_finish((enroll->>'admission_id')::uuid,'succeeded',encode(extensions.digest(bad,'sha256'),'hex'),bad);EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='native_protocol_exact_output_required';END;PERFORM pg_temp.vm_check('metadata_finish_tamper_refused',denied);
 denied:=false;BEGIN PERFORM public.sandy_vm_protocol_public_bindings(actor);EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='vm_owner_enrollment_proof_required';END;PERFORM pg_temp.vm_check('unfinished_enrollment_not_usable',denied);
 PERFORM pg_temp.vm_finish(enroll);
 PERFORM pg_temp.vm_check('native_mutation_finished_without_fake_http',(SELECT state='succeeded' AND provider_http_status IS NULL FROM public.sandy_api_execution_admissions WHERE id=(enroll->>'admission_id')::uuid));
 PERFORM pg_temp.vm_check('succeeded_owner_pinned_binding_available',public.sandy_vm_protocol_public_bindings(actor)->'sandy-video'->>'version'=b->>'binding_id');
 denied:=false;BEGIN PERFORM pg_temp.vm_metadata(enroll,jsonb_build_object('identity_pin_verified',true,'vm_proof_sha256',repeat('a',64)));EXCEPTION WHEN OTHERS THEN denied:=true;END;PERFORM pg_temp.vm_check('enrollment_replay_refused',denied);
 c:=pg_temp.vm_admit('gcp.vm.protocol_bindings.get','{"vm_name":"sandy-video"}');PERFORM pg_temp.vm_consume(c);PERFORM pg_temp.vm_check('binding_get_exact',pg_temp.vm_metadata(c)->>'binding_id'=b->>'binding_id');PERFORM pg_temp.vm_finish(c);
 registration:=pg_temp.vm_admit('cloud.vm.commands.register','{"vm_name":"sandy-video","command":"printf fixture","expires_in_seconds":600}');PERFORM pg_temp.vm_consume(registration);cmd:=pg_temp.vm_metadata(registration);PERFORM pg_temp.vm_finish(registration);
 PERFORM pg_temp.vm_check('command_digest_only_result',cmd->>'command_sha256'=encode(extensions.digest('printf fixture','sha256'),'hex') AND NOT cmd?'command');
 PERFORM pg_temp.vm_check('command_exact_ttl',(SELECT expires_at-created_at=interval '10 minutes' FROM public.sandy_vm_protocol_commands WHERE id=(cmd->>'command_ref')::uuid));
 PERFORM pg_temp.vm_check('command_encrypted_native_vault',(SELECT s.secret<>'printf fixture' AND d.decrypted_secret='printf fixture' FROM public.sandy_vm_protocol_commands v JOIN vault.secrets s ON s.id=v.vault_secret_id JOIN vault.decrypted_secrets d ON d.id=s.id WHERE v.id=(cmd->>'command_ref')::uuid));
 c:=pg_temp.vm_admit('cloud.vm.commands.get',jsonb_build_object('command_ref',cmd->>'command_ref'));PERFORM pg_temp.vm_consume(c);PERFORM pg_temp.vm_check('command_get_metadata_only',NOT pg_temp.vm_metadata(c)?'command');PERFORM pg_temp.vm_finish(c);
 execution:=pg_temp.vm_admit('cloud.vm.exec',jsonb_build_object('project_id','elaborate-haven-511518-a5','zone','europe-west1-b','instance','sandy-video','command_ref',cmd->>'command_ref'));PERFORM pg_temp.vm_consume(execution);
 r:=pg_temp.vm_resolve(execution);PERFORM pg_temp.vm_check('registered_command_exact_private_resolve',r->>'command'='printf fixture' AND r->'binding'->>'version'=b->>'binding_id');
 PERFORM pg_temp.vm_check('private_admission_arguments_encrypted',(SELECT s.secret<>execution->>'canonical_arguments' AND d.decrypted_secret=execution->>'canonical_arguments' FROM public.sandy_vm_protocol_admission_contexts p JOIN vault.secrets s ON s.id=p.arguments_vault_id JOIN vault.decrypted_secrets d ON d.id=s.id WHERE p.admission_id=(execution->>'admission_id')::uuid));
 UPDATE public.sandy_vm_protocol_commands SET vm_name='sandy-windows' WHERE id=(cmd->>'command_ref')::uuid;
 denied:=false;BEGIN PERFORM pg_temp.vm_resolve(execution);EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='immutable_same_actor_vm_command_required';END;PERFORM pg_temp.vm_check('cross_vm_command_refused',denied);UPDATE public.sandy_vm_protocol_commands SET vm_name='sandy-video' WHERE id=(cmd->>'command_ref')::uuid;
 SELECT vault_secret_id INTO secret FROM public.sandy_vm_protocol_commands WHERE id=(cmd->>'command_ref')::uuid;PERFORM vault.update_secret(secret,'tampered fixture command');
 denied:=false;BEGIN PERFORM pg_temp.vm_resolve(execution);EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='registered_vm_command_integrity_required';END;PERFORM pg_temp.vm_check('vault_command_digest_tamper_refused',denied);PERFORM vault.update_secret(secret,'printf fixture');
 PERFORM pg_temp.vm_check('gcp_consumer_post108_configuration_only',public.sandy_credential_resolve_consumer('gcp_access_token',actor,(execution->>'admission_id')::uuid,'cloud.vm.exec')->>'source'='existing_configuration');
 denied:=false;BEGIN PERFORM public.sandy_credential_resolve_consumer('github_api',actor,(execution->>'admission_id')::uuid,'cloud.vm.exec');EXCEPTION WHEN OTHERS THEN denied:=true;END;PERFORM pg_temp.vm_check('wrong_consumer_refused',denied);
 denied:=false;BEGIN PERFORM pg_temp.vm_resolve(execution,repeat('f',64));EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='registered_vm_command_integrity_required';END;PERFORM pg_temp.vm_check('expected_command_sha_refused',denied);
 PERFORM pg_temp.vm_check('first_attempt_claimed',pg_temp.vm_claim(execution)->>'claimed'='true');
 denied:=false;BEGIN PERFORM pg_temp.vm_claim(execution);EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='vm_execution_attempt_replay_refused';END;PERFORM pg_temp.vm_check('attempt_replay_refused_before_transport',denied);
 material:=jsonb_build_object('protocol','ssh2','exit_code',0,'command_sha256',r->>'command_sha256','stdout_base64','RklYVFVSRSBPVVRQVVQ=','stderr_base64','');bytes:=convert_to(material::text,'UTF8');
 r:=jsonb_build_object('payload_base64',replace(encode(bytes,'base64'),E'\n',''),'payload_sha256',encode(extensions.digest(bytes,'sha256'),'hex'),'byte_length',octet_length(bytes),'command_sha256',r->>'command_sha256','public_metadata',jsonb_build_object('vm_name','sandy-video','instance_id','6831598645020395570','protocol','ssh2','exit_code',0,'command_succeeded',true,'effect_confirmed',false,'command_sha256',r->>'command_sha256','stdout_bytes',14,'stdout_sha256',encode(extensions.digest(decode('RklYVFVSRSBPVVRQVVQ=','base64'),'sha256'),'hex'),'stderr_bytes',0,'stderr_sha256',encode(extensions.digest('','sha256'),'hex'),'binding_id',b->>'binding_id','vm_proof_sha256',repeat('a',64),'credential_cleanup_verified',NULL,'shell_deleted',NULL));
 denied:=false;BEGIN PERFORM pg_temp.vm_save(execution,r||jsonb_build_object('payload_sha256',repeat('f',64)));EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='vm_output_custody_integrity_required';END;PERFORM pg_temp.vm_check('output_wrong_digest_refused',denied);
 saved:=pg_temp.vm_save(execution,r);output_id:=(saved->>'custody_id')::uuid;
 PERFORM pg_temp.vm_check('output_native_vault_exact_ttl',(SELECT o.expires_at-o.created_at=interval '10 minutes' AND d.decrypted_secret=r->>'payload_base64' AND o.payload_sha256=saved->>'sha256' FROM public.sandy_vm_protocol_outputs o JOIN vault.decrypted_secrets d ON d.id=o.vault_secret_id WHERE o.id=output_id));
 PERFORM pg_temp.vm_check('output_no_public_bytes',NOT saved?'payload_base64' AND NOT saved?'stdout_base64');
 denied:=false;BEGIN PERFORM pg_temp.vm_save(execution,r);EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='vm_output_capture_replay_refused';END;PERFORM pg_temp.vm_check('output_replay_refused',denied);
 bad:=jsonb_set(pg_temp.vm_finish_document(execution)::jsonb,'{result,stdout_sha256}',to_jsonb(repeat('f',64)))::text;
 denied:=false;BEGIN PERFORM public.sandy_vm_protocol_finish((execution->>'admission_id')::uuid,'succeeded',encode(extensions.digest(bad,'sha256'),'hex'),bad);EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='native_protocol_exact_output_required';END;PERFORM pg_temp.vm_check('native_output_finish_tamper_refused',denied);
 PERFORM pg_temp.vm_finish(execution);
 c:=pg_temp.vm_admit('gcp.vm.ssh.exec','{"vm_name":"sandy-video","command":"printf inline","include_output":true}');PERFORM pg_temp.vm_consume(c);PERFORM pg_temp.vm_check('inline_ssh_exact_command',pg_temp.vm_resolve(c)->>'command'='printf inline');
 -- Exercise a real nonzero native receipt: unknown must never become success.
 r:=pg_temp.vm_resolve(c);PERFORM pg_temp.vm_claim(c);
 material:=jsonb_build_object('protocol','ssh2','exit_code',1,'command_sha256',r->>'command_sha256','stdout_base64','','stderr_base64','');bytes:=convert_to(material::text,'UTF8');
 SELECT receipt_metadata INTO configuration FROM public.sandy_vm_protocol_outputs WHERE id=output_id;
 configuration:=configuration||jsonb_build_object('exit_code',1,'command_succeeded',false,'command_sha256',r->>'command_sha256','stdout_bytes',0,'stdout_sha256',encode(extensions.digest('','sha256'),'hex'));
 saved:=pg_temp.vm_save(c,jsonb_build_object('payload_base64',replace(encode(bytes,'base64'),E'\n',''),'payload_sha256',encode(extensions.digest(bytes,'sha256'),'hex'),'byte_length',octet_length(bytes),'command_sha256',r->>'command_sha256','public_metadata',configuration));
 bad:=(pg_temp.vm_finish_document(c)::jsonb||jsonb_build_object('ok',false))::text;
 denied:=false;BEGIN PERFORM public.sandy_vm_protocol_finish((c->>'admission_id')::uuid,'unknown',encode(extensions.digest(bad,'sha256'),'hex'),bad);EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='native_protocol_unknown_result_forbidden';END;
 PERFORM pg_temp.vm_check('unknown_with_native_result_refused',denied);
 PERFORM pg_temp.vm_check('unknown_cannot_claim_success',(SELECT state='consumed' FROM public.sandy_api_execution_admissions WHERE id=(c->>'admission_id')::uuid));
 bad:=(bad::jsonb||jsonb_build_object('request_state','failed','error','remote_command_failed'))::text;
 PERFORM pg_temp.vm_check('explicit_authorized_output_matches_private_capture',bad::jsonb->'result'->>'stdout_base64'='' AND bad::jsonb->'result'->>'stderr_base64'='');
 denied:=false;BEGIN PERFORM public.sandy_vm_protocol_finish((c->>'admission_id')::uuid,'failed',encode(extensions.digest(jsonb_set(bad::jsonb,'{result,stdout_base64}','"Zm9yZ2Vk"')::text,'sha256'),'hex'),jsonb_set(bad::jsonb,'{result,stdout_base64}','"Zm9yZ2Vk"')::text);EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='native_protocol_exact_output_required';END;
 PERFORM pg_temp.vm_check('forged_authorized_output_refused',denied);

 PERFORM public.sandy_vm_protocol_finish((c->>'admission_id')::uuid,'failed',encode(extensions.digest(bad,'sha256'),'hex'),bad);
 PERFORM pg_temp.vm_check('known_nonzero_command_failed',(SELECT state='failed' AND provider_http_status IS NULL FROM public.sandy_api_execution_admissions WHERE id=(c->>'admission_id')::uuid));
 c:=pg_temp.vm_admit('gcp.vm.ssh.exec','{"vm_name":"sandy-video","command":"printf uncertain"}');PERFORM pg_temp.vm_consume(c);PERFORM pg_temp.vm_claim(c);
 bad:='{"ok":false,"request_state":"unknown","reconciliation_required":true}';
 saved:=public.sandy_vm_protocol_finish((c->>'admission_id')::uuid,'unknown',encode(extensions.digest(bad,'sha256'),'hex'),bad);
 PERFORM pg_temp.vm_check('unknown_without_result_requires_reconciliation',saved->>'state'='unknown' AND saved->>'reconciliation_required'='true');
 PERFORM pg_temp.vm_check('unknown_preserves_running_job',(SELECT a.state='unknown' AND j.status='running' AND j.finished_at IS NULL FROM public.sandy_api_execution_admissions a JOIN public.sandy_deployment_jobs j ON j.id=a.approval_id WHERE a.id=(c->>'admission_id')::uuid));
 -- Synthetic public certificate/probe marker is NOT TLS/provider verification.
 windows_enroll:=pg_temp.vm_admit('gcp.vm.protocol_bindings.enroll',jsonb_build_object('vm_name','sandy-windows','winrm',jsonb_build_object('server_name','fixture.internal','certificate_pem','-----BEGIN CERTIFICATE-----SYNTHETIC-SQL-FIXTURE-ONLY','certificate_sha256',repeat('b',64))));PERFORM pg_temp.vm_consume(windows_enroll);PERFORM pg_temp.vm_metadata(windows_enroll,jsonb_build_object('identity_pin_verified',true,'vm_proof_sha256',repeat('b',64)));PERFORM pg_temp.vm_finish(windows_enroll);
 c:=pg_temp.vm_admit('gcp.vm.winrm.exec','{"vm_name":"sandy-windows","command":"Write-Output fixture"}');PERFORM pg_temp.vm_consume(c);r:=pg_temp.vm_resolve(c);PERFORM pg_temp.vm_check('inline_winrm_fixed_binding',r->>'command'='Write-Output fixture' AND r->'binding'->'winrm'->>'certificate_sha256'=repeat('b',64));
 c:=pg_temp.vm_admit('cloud.vm.commands.revoke',jsonb_build_object('command_ref',cmd->>'command_ref'));PERFORM pg_temp.vm_consume(c);PERFORM pg_temp.vm_metadata(c);PERFORM pg_temp.vm_finish(c);
 PERFORM pg_temp.vm_check('revoked_command_vault_deleted',NOT EXISTS(SELECT 1 FROM public.sandy_vm_protocol_commands v JOIN vault.secrets s ON s.id=v.vault_secret_id WHERE v.id=(cmd->>'command_ref')::uuid));
 c:=pg_temp.vm_admit('cloud.vm.exec',jsonb_build_object('project_id','elaborate-haven-511518-a5','zone','europe-west1-b','instance','sandy-video','command_ref',cmd->>'command_ref'));PERFORM pg_temp.vm_consume(c);
 denied:=false;BEGIN PERFORM pg_temp.vm_resolve(c);EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='immutable_same_actor_vm_command_required';END;PERFORM pg_temp.vm_check('revoked_command_refused',denied);
 c:=pg_temp.vm_admit('gcp.vm.protocol_bindings.revoke',jsonb_build_object('vm_name','sandy-video','binding_id',b->>'binding_id'));PERFORM pg_temp.vm_consume(c);PERFORM pg_temp.vm_metadata(c);PERFORM pg_temp.vm_finish(c);
 PERFORM pg_temp.vm_check('revoked_binding_absent',NOT public.sandy_vm_protocol_public_bindings(actor)?'sandy-video' AND public.sandy_vm_protocol_public_bindings(actor)?'sandy-windows');
 PERFORM pg_temp.vm_check('six_new_rows_only',(SELECT count(*) FROM public.sandy_operation_registry)-(SELECT count(*) FROM pg_temp.vm_registry_snapshot)=6 AND (SELECT count(*)=9 FROM public.sandy_vm_protocol_contracts));
 PERFORM pg_temp.vm_check('all_unrelated_registry_rows_unchanged',NOT EXISTS(SELECT 1 FROM pg_temp.vm_registry_snapshot old FULL JOIN public.sandy_operation_registry now USING(operation) WHERE NOT EXISTS(SELECT 1 FROM public.sandy_vm_protocol_contracts c WHERE c.operation=coalesce(old.operation,now.operation)) AND old.document IS DISTINCT FROM to_jsonb(now)));
END $fixture$;
SELECT jsonb_build_object('passed',true,'checks',(SELECT count(*) FROM pg_temp.vm_protocol_checks),'labels',(SELECT jsonb_agg(label ORDER BY label) FROM pg_temp.vm_protocol_checks),'actual_auth_session',false,'provider_called',false,'dummy_vault_material_only',true,'full_rollback',true) AS evidence;
ROLLBACK;
