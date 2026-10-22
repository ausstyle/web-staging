-- Administrative component fixtures only. No Auth users/sessions or real owner
-- credentials; no VM command, software, firewall, metadata or reboot is executed.
BEGIN;
DO $$
DECLARE actor uuid:=gen_random_uuid();other_owner uuid:=gen_random_uuid();req uuid:=gen_random_uuid();
 grant_id uuid;admission uuid;job uuid;lease uuid;nonce uuid;result jsonb;task jsonb;
 args text:='{"service":"fixture.service","vm_name":"sandy-video"}';
 input_hash text:=encode(extensions.digest(args,'sha256'),'hex');contract_hash text;scope_hash text:=repeat('a',64);
 original_schema jsonb; evidence text; t text;fixture_reboot uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true),(other_owner,'owner',true);
 SELECT error_contract->>'contract_sha256',input_schema INTO contract_hash,original_schema FROM public.sandy_operation_registry WHERE operation='gcp.vm.services.status';
 IF contract_hash IS NULL THEN RAISE EXCEPTION 'guest registry missing';END IF;
 FOREACH t IN ARRAY ARRAY['sandy_guest_enrollments','sandy_guest_jobs','sandy_guest_access_receipts'] LOOP
 IF has_table_privilege('service_role','public.'||t,'INSERT') OR has_table_privilege('service_role','public.'||t,'UPDATE')
 OR has_table_privilege('authenticated','public.'||t,'SELECT') OR has_table_privilege('anon','public.'||t,'SELECT') THEN RAISE EXCEPTION 'guest private ACL too broad: %',t;END IF;
 END LOOP;
 IF has_function_privilege('service_role','public.sandy_guest_admission_current(uuid,uuid,text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_guest_claim(text,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'guest helper/agent RPC exposed';END IF;
 result:=public.sandy_guest_get_status(actor,'sandy-video',NULL);
 IF result->>'enabled' IS DISTINCT FROM 'false' OR result->>'agent_connected' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'catalog falsely enrolled existing VM';END IF;
 result:=public.sandy_guest_access(actor,'sandy-video','gcp.vm.access.bootstrap',gen_random_uuid(),encode(extensions.digest('{"vm_name":"sandy-video"}','sha256'),'hex'),'fixture-key',repeat('a',64),repeat('b',64));
 IF result->>'error' IS DISTINCT FROM 'guest_verified_approval_required' THEN RAISE EXCEPTION 'unapproved enrollment accepted';END IF;
 result:=public.sandy_guest_access(actor,'sandy-windows','gcp.vm.access.bootstrap',gen_random_uuid(),encode(extensions.digest('{"vm_name":"sandy-video"}','sha256'),'hex'),'fixture-key',repeat('a',64),repeat('b',64));
 IF result->>'error' IS DISTINCT FROM 'guest_input_digest_mismatch' THEN RAISE EXCEPTION 'access VM substituted outside approval digest';END IF;
 -- Enable only a synthetic transaction-local read fixture. This is not a normal
 -- Auth issuer/enrollment test and never establishes real production approval.
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE operation='gcp.vm.services.status';
 UPDATE public.sandy_guest_enrollments SET enabled=true,generation=1,key_id='fixture-key',public_key_sha256=repeat('a',64),worker_sha256=repeat('b',64) WHERE vm_name='sandy-video';
 result:=public.sandy_guest_heartbeat('sandy-video','wrong-instance',1,'fixture-key','1.0.0','linux','fixture-boot-before',repeat('b',64));
 IF result->>'error' IS DISTINCT FROM 'guest_identity_or_enrollment_denied' THEN RAISE EXCEPTION 'foreign VM heartbeat accepted';END IF;
 result:=public.sandy_guest_heartbeat('sandy-video','6831598645020395570',1,'fixture-key','1.0.0','linux','fixture-boot-before',repeat('b',64));
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture heartbeat refused';END IF;
 result:=public.sandy_api_admit_execution(actor,NULL,'gcp.vm.services.status',input_hash,req,NULL,contract_hash,scope_hash,0,NULL);
 admission:=(result->>'admission_id')::uuid;grant_id:=(result->>'grant_id')::uuid;
 result:=public.sandy_api_consume_execution_grant(grant_id,actor,NULL,'gcp.vm.services.status',input_hash,req,contract_hash,scope_hash);
 IF result->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture read grant failed';END IF;
 result:=public.sandy_guest_enqueue(actor,'sandy-video','gcp.vm.services.status',admission,req,args,repeat('f',64));
 IF result->>'error' IS DISTINCT FROM 'guest_input_digest_mismatch' THEN RAISE EXCEPTION 'guest argument override accepted';END IF;
 result:=public.sandy_guest_enqueue(actor,'sandy-video','gcp.vm.services.status',admission,req,args,input_hash);job:=(result->>'job_id')::uuid;
 IF result->>'state' IS DISTINCT FROM 'queued' OR result->>'executed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'queue acceptance pretended execution';END IF;
 result:=public.sandy_guest_enqueue(actor,'sandy-video','gcp.vm.services.status',admission,req,args,input_hash);
 IF result->>'reused' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'queue admission not idempotent';END IF;
 result:=public.sandy_guest_get_status(other_owner,NULL,job);
 IF result->>'error' IS DISTINCT FROM 'guest_job_not_found' THEN RAISE EXCEPTION 'cross-owner job receipt visible';END IF;
 result:=public.sandy_guest_claim('sandy-video','6831598645020395570','fixture-key',repeat('a',64),repeat('b',64));task:=result->'task';lease:=(task->>'lease_id')::uuid;nonce:=(task->>'nonce')::uuid;
 IF task->>'job_id' IS DISTINCT FROM job::text OR task->>'input_sha256' IS DISTINCT FROM input_hash OR task->'arguments' IS DISTINCT FROM args::jsonb THEN RAISE EXCEPTION 'claimed task lost exact input binding';END IF;
 result:=public.sandy_guest_claim('sandy-video','6831598645020395570','fixture-key',repeat('a',64),repeat('b',64));
 IF result->'task' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'claimed task was redelivered';END IF;
 result:=public.sandy_guest_start('sandy-video','6831598645020395570',job,lease,gen_random_uuid());
 IF result->>'allowed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'wrong nonce started task';END IF;
 result:=public.sandy_guest_start('sandy-video','6831598645020395570',job,lease,nonce);
 IF result->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'owned read task did not start';END IF;
 result:=public.sandy_guest_start('sandy-video','6831598645020395570',job,lease,nonce);
 IF result->>'allowed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'task executed twice';END IF;
 evidence:='{"kind":"service_readback","mutation_exit_code":0,"readback_exit_code":0,"service":"fixture.service","state":"active"}';
 result:=public.sandy_guest_finish('sandy-video','6831598645020395570',job,lease,nonce,'completed',evidence,encode(extensions.digest(evidence,'sha256'),'hex'));
 IF result->>'recorded' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'readback receipt not recorded';END IF;
 result:=public.sandy_guest_finish('sandy-video','6831598645020395570',job,lease,nonce,'completed',evidence,encode(extensions.digest(evidence,'sha256'),'hex'));
 IF result->>'reused' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'lost result reply was not recoverable idempotently';END IF;
 result:=public.sandy_guest_get_status(actor,NULL,job);
 IF result->>'state' IS DISTINCT FROM 'completed' OR result ? 'arguments' OR result ? 'nonce' OR result ? 'lease_id' THEN RAISE EXCEPTION 'receipt projection unsafe';END IF;
 -- A new read task with an elapsed execution lease becomes unknown and never
 -- becomes queued again; no provider action is replayed by a lease timeout.
 req:=gen_random_uuid();result:=public.sandy_api_admit_execution(actor,NULL,'gcp.vm.services.status',input_hash,req,NULL,contract_hash,scope_hash,0,NULL);
 admission:=(result->>'admission_id')::uuid;grant_id:=(result->>'grant_id')::uuid;
 PERFORM public.sandy_api_consume_execution_grant(grant_id,actor,NULL,'gcp.vm.services.status',input_hash,req,contract_hash,scope_hash);
 result:=public.sandy_guest_enqueue(actor,'sandy-video','gcp.vm.services.status',admission,req,args,input_hash);job:=(result->>'job_id')::uuid;
 result:=public.sandy_guest_claim('sandy-video','6831598645020395570','fixture-key',repeat('a',64),repeat('b',64));task:=result->'task';lease:=(task->>'lease_id')::uuid;nonce:=(task->>'nonce')::uuid;
 PERFORM public.sandy_guest_start('sandy-video','6831598645020395570',job,lease,nonce);
 UPDATE public.sandy_guest_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=job;
 result:=public.sandy_guest_claim('sandy-video','6831598645020395570','fixture-key',repeat('a',64),repeat('b',64));
 IF result->'task' IS DISTINCT FROM 'null'::jsonb OR (SELECT state FROM public.sandy_guest_jobs WHERE id=job)<>'unknown' THEN RAISE EXCEPTION 'unknown OS outcome was replayed';END IF;
 -- Immutable revision changes block old queued contracts at actual dispatch.
 req:=gen_random_uuid();result:=public.sandy_api_admit_execution(actor,NULL,'gcp.vm.services.status',input_hash,req,NULL,contract_hash,scope_hash,0,NULL);
 admission:=(result->>'admission_id')::uuid;grant_id:=(result->>'grant_id')::uuid;
 PERFORM public.sandy_api_consume_execution_grant(grant_id,actor,NULL,'gcp.vm.services.status',input_hash,req,contract_hash,scope_hash);
 result:=public.sandy_guest_enqueue(actor,'sandy-video','gcp.vm.services.status',admission,req,args,input_hash);job:=(result->>'job_id')::uuid;
 UPDATE public.sandy_operation_registry SET input_schema=input_schema||'{"fixture_revision":true}'::jsonb WHERE operation='gcp.vm.services.status';
 PERFORM public.sandy_guest_claim('sandy-video','6831598645020395570','fixture-key',repeat('a',64),repeat('b',64));
 IF (SELECT state FROM public.sandy_guest_jobs WHERE id=job)<>'blocked' THEN RAISE EXCEPTION 'stale contract dispatched';END IF;
 UPDATE public.sandy_operation_registry SET input_schema=original_schema WHERE operation='gcp.vm.services.status';
 -- Synthetic internal receipt fixture tests reboot != scheduling; it does not
 -- exercise or assert a positive real mutation approval/enrollment path.
 req:=gen_random_uuid();
 INSERT INTO public.sandy_api_execution_admissions(actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,
 registry_revision_sha256,declared_cost_units,state,expires_at) VALUES(actor,'gcp.vm.reboot',req,true,input_hash,repeat('b',64),scope_hash,repeat('c',64),0,'consumed',clock_timestamp()+interval '1 minute') RETURNING id INTO admission;
 lease:=gen_random_uuid();nonce:=gen_random_uuid();
 INSERT INTO public.sandy_guest_jobs(id,actor_id,admission_id,vm_name,generation,operation,request_id,input_sha256,arguments,registry_revision_sha256,state,lease_id,nonce,lease_expires_at)
 VALUES(fixture_reboot,actor,admission,'sandy-video',1,'gcp.vm.reboot',req,input_hash,'{"vm_name":"sandy-video","delay_seconds":60}',repeat('c',64),'running',lease,nonce,clock_timestamp()+interval '1 minute');
 evidence:='{"kind":"reboot_scheduled","exit_code":0,"reboot_observed":false,"before_boot_id_sha256":"'||encode(extensions.digest('fixture-boot-before','sha256'),'hex')||'"}';
 result:=public.sandy_guest_finish('sandy-video','6831598645020395570',fixture_reboot,lease,nonce,'completed',evidence,encode(extensions.digest(evidence,'sha256'),'hex'));
 IF result->>'error' IS DISTINCT FROM 'guest_reboot_readback_required' THEN RAISE EXCEPTION 'scheduled reboot claimed complete';END IF;
 result:=public.sandy_guest_finish('sandy-video','6831598645020395570',fixture_reboot,lease,nonce,'accepted',evidence,encode(extensions.digest(evidence,'sha256'),'hex'));
 IF result->>'state' IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'accepted reboot not recorded';END IF;
 PERFORM public.sandy_guest_heartbeat('sandy-video','6831598645020395570',1,'fixture-key','1.0.0','linux','fixture-boot-before',repeat('b',64));
 IF (SELECT state FROM public.sandy_guest_jobs WHERE id=fixture_reboot)<>'accepted' THEN RAISE EXCEPTION 'same boot counted as reboot';END IF;
 PERFORM public.sandy_guest_heartbeat('sandy-video','6831598645020395570',1,'fixture-key','1.0.0','linux','fixture-boot-after',repeat('b',64));
 IF (SELECT state FROM public.sandy_guest_jobs WHERE id=fixture_reboot)<>'completed' THEN RAISE EXCEPTION 'new boot readback not observed';END IF;
 IF (SELECT state FROM public.sandy_api_execution_admissions WHERE id=admission)<>'accepted' THEN RAISE EXCEPTION 'VM report bypassed independent mutation evidence gate';END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_api_audit_events WHERE actor_id=actor AND to_jsonb(sandy_api_audit_events)::text LIKE '%fixture.service%') THEN RAISE EXCEPTION 'raw guest args entered audit';END IF;
 PERFORM set_config('sandy.guest_test_actor',actor::text,true);
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE response jsonb;BEGIN
 response:=public.sandy_guest_get_status(current_setting('sandy.guest_test_actor')::uuid,'sandy-video',NULL);
 IF response->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'service RPC unavailable';END IF;
 BEGIN UPDATE public.sandy_guest_enrollments SET enabled=true WHERE vm_name='sandy-video';RAISE EXCEPTION 'service role directly enabled guest';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_component','fixtures','rolled_back',
 'checks',ARRAY['disabled_catalog','fixed_vm_identity','exact_input_digest','one_use_grants','queue_idempotency','owned_receipts','no_lease_redelivery','start_cas','receipt_only_retry','unknown_no_replay','immutable_contract_dispatch','reboot_scheduling_not_completion','boot_identity_readback','digest_only_audit','service_only_rpcs'],
 'real_vm_called',false,'controller_session_tested',false,'positive_real_mutation_approval_path_tested',false,'auth_users_created',false,'software_installed',false,'reboot_performed',false) AS evidence;
ROLLBACK;
