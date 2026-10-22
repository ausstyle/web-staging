-- Administrative PostgreSQL component fixtures only. No Auth sessions, provider
-- requests or customer approvals are manufactured; all rows below are synthetic
-- state-machine fixtures and roll back. They are not provider verification.
BEGIN;
DO $$
DECLARE actor uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid();
 source_req uuid:=gen_random_uuid(); source_admission uuid:=gen_random_uuid(); read_admission uuid:=gen_random_uuid(); snap uuid:=gen_random_uuid();
 h text:=repeat('a',64); before_sha text; after_sha text; args jsonb; inverse_args jsonb; read_result jsonb; read_text text; record jsonb;
 reply jsonb; observation_uuid uuid; vm jsonb; t text;
BEGIN
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true),(other_owner,'owner',true),(viewer,'viewer',true);
 FOREACH t IN ARRAY ARRAY['sandy_lifecycle_snapshots','sandy_lifecycle_compensations','sandy_lifecycle_observations'] LOOP
  IF has_table_privilege('service_role','public.'||t,'SELECT') OR has_table_privilege('service_role','public.'||t,'INSERT')
   OR has_table_privilege('authenticated','public.'||t,'SELECT') THEN RAISE EXCEPTION 'lifecycle private evidence ACL incorrect'; END IF;
 END LOOP;
 IF has_function_privilege('anon','public.sandy_lifecycle_context(uuid,uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.sandy_lifecycle_capture(uuid,uuid,jsonb)','EXECUTE')
  OR has_function_privilege('service_role','public.sandy_lifecycle_blob_sha(text)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.sandy_lifecycle_context(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'lifecycle RPC scope incorrect'; END IF;
 IF NOT public.sandy_lifecycle_json_proof('{"b":2,"a":1}','{"a":1,"b":2}',encode(sha256(convert_to('{"a":1,"b":2}','UTF8')),'hex'))
  OR public.sandy_lifecycle_json_proof('{"a":1}','{"a":2}',h) OR public.sandy_lifecycle_json_proof('{}','invalid json',h) THEN RAISE EXCEPTION 'canonical evidence text proof incorrect'; END IF;
 IF public.sandy_lifecycle_blob_sha('aGVsbG8K') IS DISTINCT FROM 'ce013625030ba8dba906f756967f9e9ca394464a'
  OR public.sandy_lifecycle_blob_sha('invalid:base64') IS NOT NULL THEN RAISE EXCEPTION 'Git blob precondition hash incorrect'; END IF;
 before_sha:=public.sandy_lifecycle_blob_sha('YmVmb3JlCg==');after_sha:=public.sandy_lifecycle_blob_sha('YWZ0ZXIK');
 args:=jsonb_build_object('path',jsonb_build_object('path','docs/sandy-api/compensation-fixtures/example.txt'),
  'body',jsonb_build_object('message','fixture only','branch','main','content','YWZ0ZXIK','sha',before_sha));
 inverse_args:=jsonb_build_object('path',args->'path','body',jsonb_build_object('message','Sandy compensation for '||source_req::text,'branch','main','content','YmVmb3JlCg==','sha',after_sha));
 record:=jsonb_build_object('source_arguments',args,'read_result',jsonb_build_object('path',args->'path'->>'path','type','file','encoding','base64','sha',before_sha,'content','YmVmb3JlCg=='),
  'read_arguments',jsonb_build_object('path',args->'path','query',jsonb_build_object('ref','main')),
  'verify_arguments',jsonb_build_object('path',args->'path','query',jsonb_build_object('ref','main')),
  'compensation_arguments',inverse_args,'baseline',jsonb_build_object('exists',true,'sha',before_sha),
  'expected_effect',jsonb_build_object('exists',true,'sha',after_sha),'compensation_operation','github.files.upsert',
  'verify_operation','github.files.metadata.get','verify_input_sha256',h,'compensation_input_sha256',h,
  'resource',jsonb_build_object('provider','github','repository','ausstyle/web-staging','branch','main','path',args->'path'->>'path'));
 IF NOT public.sandy_lifecycle_valid_preimage('github.files.upsert',source_req,record)
  OR public.sandy_lifecycle_valid_preimage('github.files.upsert',source_req,jsonb_set(record,'{compensation_arguments,body,sha}',to_jsonb(repeat('f',40))))
  OR public.sandy_lifecycle_valid_preimage('github.files.upsert',source_req,jsonb_set(record,'{read_result,content}','"Zm9yZ2VkCg=="')) THEN RAISE EXCEPTION 'immutable Git precondition validation incorrect'; END IF;
 vm:='{"id":"1234567890123456789","name":"sandy-fixture","zone":"https://www.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b","selfLink":"https://www.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/sandy-fixture","creationTimestamp":"2026-10-20T00:00:00Z","status":"TERMINATED","disks":[{"type":"PERSISTENT"}]}'::jsonb;
 IF public.sandy_lifecycle_vm_identity(vm) IS NULL OR public.sandy_lifecycle_vm_identity(jsonb_set(vm,'{disks}','[{"type":"SCRATCH"}]')) IS NOT NULL
  OR public.sandy_lifecycle_vm_identity(vm-'id') IS NOT NULL THEN RAISE EXCEPTION 'safe numeric VM identity guard incorrect'; END IF;
 reply:=public.sandy_lifecycle_source_guard(actor,gen_random_uuid());
 IF reply->>'error' IS DISTINCT FROM 'verified_approved_preimage_scope_required' THEN RAISE EXCEPTION 'missing verified source scope accepted'; END IF;
 reply:=public.sandy_lifecycle_context(viewer,source_req);IF reply->>'error' IS DISTINCT FROM 'owner_required' THEN RAISE EXCEPTION 'viewer read lifecycle context'; END IF;
 reply:=public.sandy_lifecycle_context(actor,source_req);IF reply->>'error' IS DISTINCT FROM 'immutable_provider_preimage_missing' THEN RAISE EXCEPTION 'historical missing preimage not explicit'; END IF;
 -- Synthetic state-machine rows exercise real SQL proof comparisons only.
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,expires_at,state,consumed_at)
 VALUES(source_admission,actor,'github.files.upsert',source_req,true,h,h,h,h,0,clock_timestamp()+interval '1 minute','accepted',clock_timestamp()-interval '1 minute');
 INSERT INTO public.sandy_lifecycle_snapshots(id,actor_id,source_admission_id,source_request_id,source_operation,source_arguments,record)
 VALUES(snap,actor,source_admission,source_req,'github.files.upsert',args,record);
 BEGIN UPDATE public.sandy_lifecycle_snapshots SET record='{}' WHERE id=snap;RAISE EXCEPTION 'private preimage mutable';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'provider_lifecycle_evidence_is_immutable' THEN RAISE; END IF;END;
 read_result:=jsonb_build_object('path',args->'path'->>'path','type','file','sha',after_sha);read_text:=read_result::text;
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,expires_at,state,finished_at,result_sha256)
 VALUES(read_admission,actor,'github.files.metadata.get',gen_random_uuid(),false,h,h,h,h,0,clock_timestamp()+interval '1 minute','succeeded',clock_timestamp(),encode(sha256(convert_to(read_text,'UTF8')),'hex'));
 reply:=public.sandy_lifecycle_observe(actor,snap,'source',read_admission,read_result,read_text,false);
 IF reply->>'error' IS DISTINCT FROM 'lifecycle_readback_proof_invalid' THEN RAISE EXCEPTION 'mismatched readback match bit accepted'; END IF;
 reply:=public.sandy_lifecycle_observe(actor,snap,'source',read_admission,jsonb_set(read_result,'{sha}',to_jsonb(repeat('f',40))),read_text,true);
 IF reply->>'error' IS DISTINCT FROM 'lifecycle_readback_proof_invalid' THEN RAISE EXCEPTION 'changed readback contents accepted'; END IF;
 reply:=public.sandy_lifecycle_observe(actor,snap,'source',read_admission,read_result,read_text,true);observation_uuid:=(reply->>'observation_id')::uuid;
 IF reply->>'effect_confirmed' IS DISTINCT FROM 'true' OR observation_uuid IS NULL THEN RAISE EXCEPTION 'actual readback proof comparison failed'; END IF;
 BEGIN UPDATE public.sandy_lifecycle_observations SET matched=false WHERE id=observation_uuid;RAISE EXCEPTION 'recorded proof mutable';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'provider_lifecycle_evidence_is_immutable' THEN RAISE; END IF;END;
 reply:=public.sandy_lifecycle_reserve_compensation(actor,snap,gen_random_uuid(),observation_uuid);
 IF reply->>'error' IS DISTINCT FROM 'verified_scoped_compensation_approval_required' THEN RAISE EXCEPTION 'unapproved compensation reserved'; END IF;
 reply:=public.sandy_lifecycle_context(other_owner,source_req);IF reply->>'error' IS DISTINCT FROM 'immutable_provider_preimage_missing' THEN RAISE EXCEPTION 'cross-owner preimage disclosure'; END IF;
 PERFORM set_config('sandy.lifecycle_test_actor',actor::text,true);
 PERFORM set_config('sandy.lifecycle_test_request',source_req::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.sandy_lifecycle_context(gen_random_uuid(),gen_random_uuid());RAISE EXCEPTION 'customer private RPC allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE reply jsonb;BEGIN
 reply:=public.sandy_lifecycle_context(current_setting('sandy.lifecycle_test_actor')::uuid,current_setting('sandy.lifecycle_test_request')::uuid);
 IF reply->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'real service-role lifecycle RPC denied'; END IF;
END $$;
RESET ROLE;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_component','provider_called',false,'controller_session_tested',false,'fixtures','rolled_back',
 'checks',ARRAY['private_acl','scoped_rpc','canonical_digest_bytes','git_blob_sha','immutable_git_precondition','safe_numeric_vm_identity','scratch_disk_refusal','missing_verified_source_scope','viewer_refusal','historical_preimage_dependency','immutable_snapshot','real_readback_digest_binding','match_bit_refusal','changed_readback_refusal','immutable_observation','separate_compensation_approval','cross_owner_refusal','actual_service_role_rpc']) AS evidence;
ROLLBACK;
