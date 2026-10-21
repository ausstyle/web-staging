-- Additive 07010 invariant checks. Include the shared administrative component
-- fixture helper immediately after BEGIN. No Auth session/approval is exercised.
BEGIN;
-- SHARED_OWNER_COMPONENT_FIXTURE
DO $test$
DECLARE tenant uuid:=gen_random_uuid();subject uuid:=gen_random_uuid();email text:='approval-fixture-'||gen_random_uuid()::text||'@example.invalid';actor uuid;admission uuid;other_admission uuid;other_approval uuid;canonical text;scope text:='04573c462b9fa724cc78afc55ca40999b05855765084fc1c1e449fd8e06f2a14';r jsonb;refused boolean;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES(subject,email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}');
 INSERT INTO public.email_customers(id) VALUES(tenant);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary) VALUES(tenant,email,true);
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(subject,tenant);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE operation IN('supabase.tenant.consent.set','supabase.auth.users.get','supabase.compliance.audit');
 PERFORM public.sandy_supabase_tenant_consent_set(ARRAY['supabase.auth.users.get','supabase.compliance.audit'],ARRAY[]::text[],false,clock_timestamp()+interval '1 hour');
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 canonical:=jsonb_build_object('tenant_id',tenant,'user_id',subject)::text;
 admission:=pg_temp.sandy_owner_component_admission('supabase.auth.users.get',canonical::jsonb,scope);
 r:=public.sandy_supabase_service_context(actor,admission,canonical);
 IF r->>'operation'<>'supabase.auth.users.get' THEN RAISE EXCEPTION 'immutable_approval_fixture_not_accepted';END IF;
 UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{requires_approval}','false'::jsonb) WHERE operation='supabase.auth.users.get';
 admission:=pg_temp.sandy_owner_component_admission('supabase.auth.users.get',canonical::jsonb,scope);
 refused:=false;BEGIN PERFORM public.sandy_supabase_service_context(actor,admission,canonical);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'service_current_verified_contract_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'registry_read_approval_flag_drift_allowed';END IF;
 UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{requires_approval}','true'::jsonb) WHERE operation='supabase.auth.users.get';
 admission:=pg_temp.sandy_owner_component_admission('supabase.auth.users.get',canonical::jsonb,scope);
 UPDATE public.sandy_api_execution_admissions SET approval_id=NULL WHERE id=admission;
 refused:=false;BEGIN PERFORM public.sandy_supabase_service_context(actor,admission,canonical);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'service_scoped_admission_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'missing_immutable_approval_allowed';END IF;
 admission:=pg_temp.sandy_owner_component_admission('supabase.auth.users.get',canonical::jsonb,scope);
 other_admission:=pg_temp.sandy_owner_component_admission('supabase.compliance.audit',jsonb_build_object('tenant_id',tenant),scope);
 SELECT approval_id INTO other_approval FROM public.sandy_api_execution_admissions WHERE id=other_admission;
 UPDATE public.sandy_api_execution_admissions SET approval_id=NULL WHERE id=other_admission;
 UPDATE public.sandy_api_execution_admissions SET approval_id=other_approval WHERE id=admission;
 refused:=false;BEGIN PERFORM public.sandy_supabase_service_context(actor,admission,canonical);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'immutable_scoped_owner_approval_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'cross_operation_approval_snapshot_allowed';END IF;
 admission:=pg_temp.sandy_owner_component_admission('supabase.auth.users.get',canonical::jsonb,scope);
 UPDATE public.sandy_deployment_jobs SET target='CHANGED-ROLLBACK-FIXTURE' WHERE id=(SELECT approval_id FROM public.sandy_api_execution_admissions WHERE id=admission);
 refused:=false;BEGIN PERFORM public.sandy_supabase_service_context(actor,admission,canonical);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'immutable_scoped_owner_approval_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'changed_job_fingerprint_allowed';END IF;
 admission:=pg_temp.sandy_owner_component_admission('supabase.auth.users.get',canonical::jsonb,scope);
 UPDATE public.sandy_engineering_changes SET status='proposed' WHERE id=(SELECT engineering_change_id FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=(SELECT approval_id FROM public.sandy_api_execution_admissions WHERE id=admission));
 refused:=false;BEGIN PERFORM public.sandy_supabase_service_context(actor,admission,canonical);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'immutable_scoped_owner_approval_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'revoked_engineering_approval_allowed';END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_component','fixtures','rolled_back','real_auth_session_tested',false,'real_owner_approval_tested',false,'owner_membership_changed',false,'provider_called',false,'checks',jsonb_build_array('bound_immutable_approval_snapshot','registry_flag_drift_refusal','missing_proof_refusal','cross_operation_proof_refusal','changed_job_fingerprint_refusal','revoked_engineering_change_refusal')) AS evidence;
ROLLBACK;
