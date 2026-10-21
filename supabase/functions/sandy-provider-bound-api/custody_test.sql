-- Administrative component fixtures, not Auth/approval/provider attestation.
BEGIN;
DO $test$
DECLARE actor uuid:=gen_random_uuid(); id1 uuid:=gen_random_uuid(); id2 uuid:=gen_random_uuid(); approval1 uuid:=gen_random_uuid(); approval2 uuid:=gen_random_uuid(); approval3 uuid:=gen_random_uuid();
 context jsonb; next_context jsonb; receipt jsonb; private_value jsonb; denied boolean; source text; target_suffix text; diff_id uuid:=gen_random_uuid();
 payload text:='SYNTHETIC-PROVIDER-CURSOR-NOT-A-CREDENTIAL'; op text:='gcp.pubsub.snapshots.list.bound'; saved uuid;
BEGIN
 IF (SELECT count(*) FROM public.sandy_operation_registry WHERE handler='sandy-provider-bound-api')<>48
 OR EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE handler='sandy-provider-bound-api' AND (api_exposed OR ai_exposed OR ui_exposed OR verified
 OR error_contract->>'requires_approval' IS DISTINCT FROM 'true' OR error_contract->>'api_key_delegable' IS DISTINCT FROM 'false'))
 THEN RAISE EXCEPTION 'bound_closed_registry_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.bound_registry_before b LEFT JOIN public.sandy_operation_registry r USING(operation) WHERE to_jsonb(r) IS DISTINCT FROM b.snapshot)
 THEN RAISE EXCEPTION 'existing_registry_changed'; END IF;
 IF has_function_privilege('authenticated','public.sandy_provider_supplement_save_opaque(jsonb)','EXECUTE')
 OR has_function_privilege('service_role','public.sandy_provider_supplement_context(jsonb)','EXECUTE')
 OR has_table_privilege('service_role','public.sandy_provider_supplement_opaque','SELECT') THEN RAISE EXCEPTION 'bound_private_acl_changed'; END IF;
 SELECT prosrc INTO source FROM pg_proc WHERE oid='public.sandy_provider_supplement_context(jsonb)'::regprocedure;
 IF position('entry.handler IS NULL OR entry.handler NOT IN' in source)=0 THEN RAISE EXCEPTION 'context_null_handler_fail_open'; END IF;
 SELECT prosrc INTO source FROM pg_proc WHERE oid='public.sandy_credential_resolve_consumer(text,uuid,uuid,text)'::regprocedure;
 IF position('sandy-provider-bound-api' in source)=0 OR position('sandy_provider_read_admission_proofs' in source)=0
 OR position('consumer_active_readback_required' in source)=0 OR position('consumer_active_pointer_removed' in source)=0
 OR position('consumer_pointer_changed_during_execution' in source)=0 THEN RAISE EXCEPTION 'bound_consumer_guards_lost'; END IF;
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true);
 INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status)
 VALUES(approval1,'bound_rollback_only','google_cloud','get_vm','synthetic-no-provider',approval1::text,'pending_approval'),
 (approval2,'bound_rollback_only','google_cloud','get_vm','synthetic-no-provider',approval2::text,'pending_approval'),
 (approval3,'bound_rollback_only','google_cloud','get_vm','synthetic-no-provider',approval3::text,'pending_approval');
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE operation=op;
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at,approval_id)
 VALUES(id1,actor,op,gen_random_uuid(),false,repeat('a',64),repeat('b',64),repeat('c',64),public.sandy_api_registry_revision(op),0,'consumed',clock_timestamp()+interval '5 minutes',approval1),
 (id2,actor,op,gen_random_uuid(),false,repeat('d',64),repeat('b',64),repeat('c',64),public.sandy_api_registry_revision(op),0,'consumed',clock_timestamp()+interval '5 minutes',approval2);
 context:=jsonb_build_object('actor',actor,'admission',id1,'operation',op,'scope_sha256',repeat('c',64),'input_sha256',repeat('a',64),
 'binding_sha256',repeat('e',64),'target','https://pubsub.googleapis.com/v1/projects/elaborate-haven-511518-a5/snapshots?pageSize=100','kind','cursor',
 'payload_base64',encode(convert_to(payload,'UTF8'),'base64'),'payload_sha256',encode(extensions.digest(payload,'sha256'),'hex'),
 'byte_length',octet_length(payload),'media_type','application/x-sandy-provider-cursor');
 denied:=false;BEGIN UPDATE public.sandy_operation_registry SET handler=NULL WHERE operation=op;
 EXCEPTION WHEN not_null_violation THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'bound_null_handler_context_accepted'; END IF;
 UPDATE public.sandy_operation_registry SET handler='sandy-provider-bound-api' WHERE operation=op;
 UPDATE public.sandy_api_execution_admissions SET registry_revision_sha256=public.sandy_api_registry_revision(op) WHERE id IN(id1,id2);
 denied:=false;BEGIN PERFORM public.sandy_provider_supplement_save_opaque(context||'{"target":"https://pubsub.googleapis.com/v1/projects/foreign/snapshots?pageSize=100"}');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'supplement_fixed_resource_required' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'bound_foreign_cursor_target_accepted'; END IF;
 receipt:=public.sandy_provider_supplement_save_opaque(context);saved:=(receipt->>'custody_id')::uuid;
 IF receipt ? 'payload_base64' OR receipt ? 'target' OR receipt ? 'token' THEN RAISE EXCEPTION 'bound_cursor_receipt_exposes_content'; END IF;
 next_context:=(context-'payload_base64'-'payload_sha256'-'byte_length'-'media_type')||jsonb_build_object('admission',id2,'input_sha256',repeat('d',64));
 denied:=false;BEGIN PERFORM public.sandy_provider_supplement_take_opaque(next_context||jsonb_build_object('binding_sha256',repeat('f',64)),saved);
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'supplement_opaque_binding_expired_or_used' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'bound_changed_cursor_arguments_accepted'; END IF;
 private_value:=public.sandy_provider_supplement_take_opaque(next_context,saved);
 IF private_value->>'payload_base64' IS DISTINCT FROM encode(convert_to(payload,'UTF8'),'base64') THEN RAISE EXCEPTION 'bound_dummy_cursor_readback_failed'; END IF;
 denied:=false;BEGIN PERFORM public.sandy_provider_supplement_take_opaque(next_context,saved);
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'supplement_opaque_binding_expired_or_used' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'bound_cursor_replay_accepted'; END IF;
 -- Optional supported branch-diff query strings must survive the real private
 -- custody target predicate; source-only saveOpaque stubs cannot establish this.
 op:='supabase.branches.diff.bound';
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE operation=op;
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at,approval_id)
 VALUES(diff_id,actor,op,gen_random_uuid(),false,repeat('a',64),repeat('b',64),repeat('c',64),public.sandy_api_registry_revision(op),0,'consumed',clock_timestamp()+interval '5 minutes',approval3);
 context:=context||jsonb_build_object('admission',diff_id,'operation',op,'kind','artifact','media_type','text/plain');
 FOREACH target_suffix IN ARRAY ARRAY['','?included_schemas=public%2Ctenant_a','?pgdelta=true','?included_schemas=public%2Ctenant_a&pgdelta=true','?included_schemas=&pgdelta='] LOOP
  PERFORM public.sandy_provider_supplement_context(context||jsonb_build_object('target','https://api.supabase.com/v1/branches/11111111-1111-4111-8111-111111111111/diff'||target_suffix));
 END LOOP;
 FOREACH target_suffix IN ARRAY ARRAY['?notify_url=https%3A%2F%2Fforeign.invalid','?included_schemas=public&foreign=x','?pgdelta=true&included_schemas=public','?included_schemas=%ZZ','?included_schemas=public&pgdelta=true&pgdelta=false','?included_schemas=public#fragment'] LOOP
  denied:=false;BEGIN PERFORM public.sandy_provider_supplement_context(context||jsonb_build_object('target','https://api.supabase.com/v1/branches/11111111-1111-4111-8111-111111111111/diff'||target_suffix));
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'supplement_fixed_resource_required' THEN RAISE;END IF;denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'bound_unreviewed_diff_query_accepted'; END IF;
 END LOOP;
 denied:=false;BEGIN PERFORM public.sandy_provider_supplement_context(context||jsonb_build_object('target','https://foreign.invalid/v1/branches/11111111-1111-4111-8111-111111111111/diff?pgdelta=true'));
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'supplement_fixed_resource_required' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'bound_foreign_diff_host_accepted'; END IF;
 receipt:=public.sandy_provider_supplement_save_opaque(context||jsonb_build_object('target','https://api.supabase.com/v1/branches/11111111-1111-4111-8111-111111111111/diff?included_schemas=public%2Ctenant_a&pgdelta=true'));
 IF receipt ? 'payload_base64' OR receipt ? 'target' OR receipt ? 'token' THEN RAISE EXCEPTION 'bound_diff_receipt_exposes_content'; END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_bound_registry_custody_component','new_closed_methods',48,
 'existing_registry_unchanged_before_fixture',true,'null_handler_refused_by_existing_schema',true,'foreign_cursor_target_refused',true,
 'changed_arguments_and_replayed_cursor_refused',true,'provider_called',false,'credential_resolved',false,
 'supported_diff_query_private_capture',true,'unknown_or_malformed_diff_queries_refused',true,
 'auth_session_tested',false,'real_approval_tested',false,'all_changes_rolled_back',true) AS evidence;
ROLLBACK;
