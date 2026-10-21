-- Sensitive reads and mutations retain a source-required immutable owner
-- approval proof even if future registry flags are accidentally weakened.
-- Exact prior function bytes are guarded; no grants/exposure/verified flags change.
BEGIN;
DO $$ BEGIN
 IF encode(extensions.digest(pg_get_functiondef('public.sandy_supabase_service_context(uuid,uuid,text)'::regprocedure),'sha256'),'hex') IS DISTINCT FROM 'e17d207f1571df81b65adbc1a801d682ae5cadd141b1a49777b29e2d1072e818' THEN RAISE EXCEPTION 'supabase_service_context_source_changed';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sandy_supabase_service_context(p_actor uuid,p_admission uuid,p_canonical text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;r public.sandy_operation_registry;args jsonb;c public.sandy_supabase_tenant_consents;controls public.sandy_supabase_tenant_controls;tenant uuid;target uuid;v_email text;
BEGIN
 IF p_actor IS NULL OR p_admission IS NULL OR p_canonical IS NULL OR octet_length(p_canonical)>196608 THEN RAISE EXCEPTION 'service_context_invalid';END IF;
 args:=p_canonical::jsonb;tenant:=(args->>'tenant_id')::uuid;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR SHARE;
 IF a.id IS NULL OR a.actor_id IS DISTINCT FROM p_actor OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL OR a.approval_id IS NULL OR a.state IS DISTINCT FROM 'consumed' OR a.expires_at<=clock_timestamp()
 OR a.scope_sha256 IS DISTINCT FROM '04573c462b9fa724cc78afc55ca40999b05855765084fc1c1e449fd8e06f2a14' OR a.input_sha256 IS DISTINCT FROM encode(extensions.digest(p_canonical,'sha256'),'hex') OR NOT public.sandy_api_current_owner(p_actor) THEN RAISE EXCEPTION 'service_scoped_admission_required';END IF;
 SELECT * INTO r FROM public.sandy_operation_registry WHERE operation=a.operation FOR SHARE;
 IF r.operation IS NULL OR r.handler IS DISTINCT FROM 'sandy-supabase-service-api' OR r.api_exposed IS DISTINCT FROM true OR r.verified IS DISTINCT FROM true
 OR r.is_mutation IS DISTINCT FROM a.is_mutation OR r.error_contract->>'requires_approval' IS DISTINCT FROM 'true' OR r.error_contract->>'api_key_delegable' IS DISTINCT FROM 'false' OR r.error_contract->>'contract_sha256' IS DISTINCT FROM a.contract_sha256 OR public.sandy_api_registry_revision(a.operation) IS DISTINCT FROM a.registry_revision_sha256 THEN RAISE EXCEPTION 'service_current_verified_contract_required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_api_mutation_approval_snapshots proof JOIN public.sandy_deployment_jobs job ON job.id=proof.job_id JOIN public.sandy_engineering_changes change ON change.id=proof.engineering_change_id
 WHERE proof.job_id=a.approval_id AND proof.actor_id=p_actor AND proof.operation=a.operation AND proof.input_sha256=a.input_sha256 AND proof.contract_sha256=a.contract_sha256 AND proof.scope_sha256=a.scope_sha256
 AND a.declared_cost_units<=proof.maximum_declared_cost_units AND job.status='running' AND change.status='approved' AND proof.job_fingerprint_sha256=public.sandy_api_job_fingerprint(job)) THEN RAISE EXCEPTION 'immutable_scoped_owner_approval_required';END IF;
 IF tenant IS NULL OR NOT EXISTS(SELECT 1 FROM public.email_customers WHERE id=tenant) THEN RAISE EXCEPTION 'service_tenant_required';END IF;
 SELECT * INTO controls FROM public.sandy_supabase_tenant_controls WHERE tenant_id=tenant FOR SHARE;
 SELECT * INTO c FROM public.sandy_supabase_tenant_consents WHERE tenant_id=tenant FOR SHARE;
 IF a.operation NOT IN('supabase.compliance.audit','supabase.compliance.hold.create','supabase.compliance.retention.extend') AND (c.tenant_id IS NULL OR c.expires_at<=clock_timestamp() OR public.sandy_supabase_portal_tenant(c.auth_user_id) IS DISTINCT FROM tenant OR NOT a.operation=ANY(c.operations)) THEN RAISE EXCEPTION 'current_explicit_tenant_consent_required';END IF;
 IF a.operation IN('supabase.auth.users.delete','supabase.storage.buckets.empty','supabase.storage.buckets.delete','supabase.storage.objects.delete','supabase.storage.objects.update','supabase.storage.objects.move','supabase.vault.secrets.managed.delete','supabase.vault.secrets.managed.update')
 AND (c.allow_erasure IS DISTINCT FROM true OR controls.legal_hold IS TRUE OR controls.retention_until>clock_timestamp()) THEN RAISE EXCEPTION 'tenant_erasure_retention_or_legal_hold_refused';END IF;
 IF a.operation LIKE 'supabase.storage.%' THEN
  IF a.operation='supabase.storage.buckets.create' THEN
   IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='sandy-service-v1-tenant-'||tenant::text)
   OR EXISTS(SELECT 1 FROM public.sandy_supabase_managed_buckets b WHERE b.tenant_id=tenant AND b.state<>'deleted') THEN RAISE EXCEPTION 'existing_or_reserved_bucket_adoption_refused';END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.sandy_supabase_managed_buckets b JOIN storage.buckets provider ON provider.id=b.bucket_id WHERE b.tenant_id=tenant AND b.bucket_id='sandy-service-v1-tenant-'||tenant::text AND b.state='active') AND NOT (a.operation='supabase.storage.buckets.delete' AND EXISTS(SELECT 1 FROM public.sandy_supabase_managed_buckets b WHERE b.tenant_id=tenant AND b.state='active')) THEN RAISE EXCEPTION 'active_service_owned_bucket_required';END IF;
 END IF;
 IF args ? 'user_id' THEN
  target:=(args->>'user_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.sandy_supabase_managed_users WHERE tenant_id=tenant AND user_id=target) THEN RAISE EXCEPTION 'tenant_managed_user_required';END IF;
  IF r.is_mutation AND (EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=target) OR EXISTS(SELECT 1 FROM auth.users WHERE id=target AND (raw_app_meta_data->>'sandy_gcp_machine'='true' OR is_super_admin IS TRUE))) THEN RAISE EXCEPTION 'protected_system_identity_refused';END IF;
 END IF;
 IF args ? 'subject_user_id' AND NOT public.sandy_supabase_tenant_member(tenant,(args->>'subject_user_id')::uuid) THEN RAISE EXCEPTION 'tenant_policy_subject_required';END IF;
 IF a.operation='supabase.realtime.channels.subscribe' AND NOT EXISTS(SELECT 1 FROM public.sandy_supabase_managed_channels ch WHERE ch.tenant_id=tenant AND ch.state='active' AND ch.name=args->>'name') THEN RAISE EXCEPTION 'managed_channel_required';END IF;
 IF a.operation='supabase.auth.users.create' THEN
  v_email:=lower(args->>'email');
  IF v_email IS NULL OR v_email IS DISTINCT FROM args->>'email' OR NOT v_email=ANY(c.approved_emails) OR EXISTS(SELECT 1 FROM auth.users u WHERE lower(u.email)=v_email) THEN RAISE EXCEPTION 'explicit_new_managed_email_required';END IF;
 END IF;
 IF args ? 'path' AND (args->>'path' !~ '^[A-Za-z0-9_./ -]+$' OR args->>'path' ~ '(^/|(^|/)\.{1,2}(/|$))' OR octet_length(args->>'path')>1024) THEN RAISE EXCEPTION 'storage_path_invalid';END IF;
 IF args ? 'destination' AND (args->>'destination' !~ '^[A-Za-z0-9_./ -]+$' OR args->>'destination' ~ '(^/|(^|/)\.{1,2}(/|$))' OR octet_length(args->>'destination')>1024) THEN RAISE EXCEPTION 'storage_destination_invalid';END IF;
 RETURN jsonb_build_object('tenant_id',tenant,'operation',a.operation,'arguments',args,'consent_revision',coalesce(c.revision,0),'bucket_id','sandy-service-v1-tenant-'||tenant::text);
END $$;

COMMIT;
