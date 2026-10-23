-- Append after the uncommitted forward migration in one transaction. No Owner session is fabricated.

DO $$ BEGIN
 IF has_function_privilege('service_role','public.sandy_engineering_set_admin_read_delegation(boolean,timestamptz,integer)','EXECUTE') OR has_column_privilege('service_role','public.sandy_engineering_control_grants','admin_read_policy','UPDATE') OR has_column_privilege('service_role','public.sandy_engineering_control_grants','admin_read_policy','INSERT') THEN RAISE EXCEPTION 'service_owner_authority_bypass';END IF;
 IF NOT has_column_privilege('service_role','public.sandy_engineering_control_grants','enabled','UPDATE') THEN RAISE EXCEPTION 'existing_revocation_permission_lost';END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_engineering_control_grants WHERE admin_read_policy IS NOT NULL OR admin_read_revision<>0) THEN RAISE EXCEPTION 'migration_established_unauthorized_policy';END IF;
END $$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.sandy_engineering_set_admin_read_delegation(true,clock_timestamp()+interval '1 day',0);RAISE EXCEPTION 'service_grant_unexpectedly_succeeded';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 SELECT identity_user_id,authorized_by,'controller_owner','scope_authorized','{"boundary":"gcp_admin_read_delegation","Owner_session_fingerprint":"fabricated"}'::jsonb FROM public.sandy_engineering_control_grants LIMIT 1;
 RAISE EXCEPTION 'forged_Owner_audit_unexpectedly_succeeded';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'genuine_owner_audit_context_required' THEN RAISE;END IF;END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.sandy_engineering_set_admin_read_delegation(true,clock_timestamp()+interval '1 day',0);RAISE EXCEPTION 'nonowner_grant_unexpectedly_succeeded';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;

-- Privileged, rollback-only policy fixture for database state-machine tests.
-- This bypasses the setter ONLY inside this discarded transaction. It is NOT
-- a genuine Owner authorization event, HTTP acceptance or provider evidence.
DO $$
DECLARE i public.sandy_engineering_test_identities;a jsonb;b jsonb;r jsonb;cfg jsonb;
BEGIN
 SELECT * INTO i FROM public.sandy_engineering_test_identities WHERE enabled AND revoked_at IS NULL AND active_session_expires_at>clock_timestamp() LIMIT 1;
 IF i.user_id IS NULL THEN RAISE EXCEPTION 'existing_active_workload_session_required_for_rollback_test';END IF;
 cfg:=jsonb_build_object('version',1,'connection','sandy-gcp-admin','project','elaborate-haven-511518-a5','targets',jsonb_build_array('6831598645020395570','8120150462304566315'),'read_only',true,'maximum_cost_units',0,'requests_per_minute',2,'expires_at',clock_timestamp()+interval '1 day');
 UPDATE public.sandy_engineering_control_grants SET admin_read_policy=cfg,admin_read_revision=1 WHERE identity_user_id=i.user_id;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.sandy_engineering_resolve_admin_read(i.user_id,i.active_session_id,i.credential_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture_policy_did_not_resolve';END IF;
 a:=public.sandy_gcp_admin_delegated_admit(i.user_id,i.active_session_id,i.credential_epoch);
 r:=public.sandy_gcp_admin_delegated_claim(i.user_id,i.active_session_id,i.credential_epoch,(a->>'admission_id')::uuid,(a->>'grant_id')::uuid,(a->>'request_id')::uuid);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture_claim_failed';END IF;
 BEGIN PERFORM public.sandy_gcp_admin_delegated_claim(i.user_id,i.active_session_id,i.credential_epoch,(a->>'admission_id')::uuid,(a->>'grant_id')::uuid,(a->>'request_id')::uuid);RAISE EXCEPTION 'replay_succeeded';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'delegated_administrator_admission_refused' THEN RAISE;END IF;END;
 b:=public.sandy_gcp_admin_delegated_admit(i.user_id,i.active_session_id,i.credential_epoch);
 UPDATE public.sandy_engineering_control_grants SET admin_read_revision=2 WHERE identity_user_id=i.user_id;
 BEGIN PERFORM public.sandy_gcp_admin_delegated_claim(i.user_id,i.active_session_id,i.credential_epoch,(b->>'admission_id')::uuid,(b->>'grant_id')::uuid,(b->>'request_id')::uuid);RAISE EXCEPTION 'changed_revision_succeeded';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'delegated_administrator_admission_refused' THEN RAISE;END IF;END;
 BEGIN PERFORM public.sandy_gcp_admin_delegated_admit(i.user_id,i.active_session_id,i.credential_epoch);RAISE EXCEPTION 'rate_limit_missing';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'administrator_read_rate_limited' THEN RAISE;END IF;END;
 r:=public.sandy_engineering_resolve_admin_read(i.user_id,i.active_session_id,i.credential_epoch+1);
 IF r->>'ok'='true' THEN RAISE EXCEPTION 'stale_epoch_accepted';END IF;
 UPDATE public.sandy_engineering_control_grants SET admin_read_policy=jsonb_set(cfg,'{maximum_cost_units}','1') WHERE identity_user_id=i.user_id;
 r:=public.sandy_engineering_resolve_admin_read(i.user_id,i.active_session_id,i.credential_epoch);
 IF r->>'ok'='true' THEN RAISE EXCEPTION 'positive_budget_accepted';END IF;
 UPDATE public.sandy_engineering_control_grants SET admin_read_policy=jsonb_set(cfg,'{expires_at}',to_jsonb(clock_timestamp()-interval '1 second')) WHERE identity_user_id=i.user_id;
 r:=public.sandy_engineering_resolve_admin_read(i.user_id,i.active_session_id,i.credential_epoch);
 IF r->>'ok'='true' THEN RAISE EXCEPTION 'expired_policy_accepted';END IF;
 UPDATE public.sandy_engineering_control_grants SET admin_read_policy=NULL,admin_read_revision=3 WHERE identity_user_id=i.user_id;
 r:=public.sandy_engineering_resolve_admin_read(i.user_id,i.active_session_id,i.credential_epoch);
 IF r->>'ok'='true' THEN RAISE EXCEPTION 'revoked_policy_accepted';END IF;
END $$;
ROLLBACK;
