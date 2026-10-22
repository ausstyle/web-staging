BEGIN;
-- Reconcile the deployed guest gate, preserving the legacy approval path.
-- This installs no delegation, operation class, exposure flag or VM enrollment.
DO $$ BEGIN
 IF (SELECT encode(extensions.digest(prosrc,'sha256'),'hex') FROM pg_proc
     WHERE oid='public.sandy_guest_admission_current(uuid,uuid,text,text)'::regprocedure)
    IS DISTINCT FROM 'f1bcc1aa1c489bde40e805e9d5b7accc3e12fb396365cbd27fe8e21780459555' THEN
  RAISE EXCEPTION 'guest_admission_preimage_changed';
 END IF;
END $$;
-- The worker must also honor a shortened/revoked Supabase session lifetime,
-- independently of its previously registered local access-token expiry.
DO $$ BEGIN
 IF (SELECT encode(extensions.digest(prosrc,'sha256'),'hex') FROM pg_proc
     WHERE oid='public.sandy_engineering_resolve_identity(uuid,uuid,integer)'::regprocedure)
    IS DISTINCT FROM 'b820394506be80e6d0ea17ef8910a8023a1be1989072ca94f418621edde23868' THEN
  RAISE EXCEPTION 'engineering_identity_preimage_changed';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sandy_engineering_resolve_identity(p_user_id uuid, p_session_id uuid, p_epoch integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE identity public.sandy_engineering_test_identities%ROWTYPE; BEGIN
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id;
 IF identity.user_id IS NULL OR NOT identity.enabled OR identity.revoked_at IS NOT NULL OR identity.rotation_state<>'ready'
  OR identity.credential_epoch IS DISTINCT FROM p_epoch OR NOT public.sandy_api_current_owner(identity.authorized_by)
  OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_auth_sessions WHERE identity_user_id=p_user_id AND session_id=p_session_id
    AND credential_epoch=p_epoch AND revoked_at IS NULL AND expires_at>clock_timestamp())
  OR EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=p_user_id)
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND role='authenticated' AND email='sandy-engineering-test@sandy-ai.internal'
   AND raw_app_meta_data->>'sandy_engineering_test'='true' AND raw_app_meta_data->>'sandy_engineering_epoch'=p_epoch::text
   AND (banned_until IS NULL OR banned_until<=clock_timestamp()))
  OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=p_session_id AND user_id=p_user_id
    AND (not_after IS NULL OR not_after>clock_timestamp()))
  OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id=identity.delegation_change_id AND status='approved')
  OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id=identity.source_approval_change_id AND status IN('approved','implementing','committed','deployed','verified'))
 THEN RETURN jsonb_build_object('ok',false,'error','engineering_identity_not_authorized','http_status',403);END IF;
 RETURN jsonb_build_object('ok',true,'owner_authority_id',identity.authorized_by,'identity_user_id',p_user_id,
 'policy_sha256',identity.policy_sha256,'credential_epoch',identity.credential_epoch,'session_id',p_session_id,
 'operations',jsonb_build_array('github.files.update','github.commit','supabase.deploy_edge_function','supabase.db.migrations.apply','supabase.functions.secrets.set','supabase.logs.query'),'vm_read_scope',public.sandy_engineering_vm_read_scope(p_user_id,p_epoch));
END $function$
;
CREATE OR REPLACE FUNCTION public.sandy_guest_admission_current(
 p_admission_id uuid,p_actor_id uuid,p_operation text,p_input_sha256 text
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions a
 JOIN public.sandy_operation_registry r ON r.operation=a.operation
 LEFT JOIN public.sandy_api_mutation_approval_snapshots proof ON proof.job_id=a.approval_id
 LEFT JOIN public.sandy_deployment_jobs job ON job.id=a.approval_id
 WHERE a.id=p_admission_id AND a.actor_id=p_actor_id AND a.operation=p_operation
 AND a.input_sha256=p_input_sha256
 AND a.tenant_id IS NULL AND a.credential_id IS NULL AND a.customer_key_id IS NULL
 AND a.state='consumed' AND a.expires_at>clock_timestamp()
 AND public.sandy_api_current_owner(p_actor_id) AND r.handler='sandy-guest-operation-api'
 AND r.api_exposed=true AND r.verified=true
 AND a.contract_sha256 IS NOT DISTINCT FROM r.error_contract->>'contract_sha256'
 AND a.registry_revision_sha256=public.sandy_api_registry_revision(a.operation)
 AND (NOT(r.is_mutation OR coalesce(r.error_contract->>'requires_approval'='true',false))
  -- Shared verifier rechecks the exact request/input/contract/scope, immutable
  -- workload session binding, current identity, grant version/expiry/revocation
  -- and running policy job. Never manufacture an owner approval snapshot.
  OR public.sandy_engineering_authorized_admission(a.id,'consumed')
  OR (proof.actor_id=p_actor_id AND job.status='running'
   AND proof.job_fingerprint_sha256=public.sandy_api_job_fingerprint(job)
   AND EXISTS(SELECT 1 FROM public.sandy_engineering_changes c
    WHERE c.id=proof.engineering_change_id AND c.status='approved'))))
$$;
REVOKE ALL ON FUNCTION public.sandy_guest_admission_current(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
-- Called only by the existing SECURITY DEFINER enrollment/queue/worker RPCs.
COMMIT;
