BEGIN;
-- Retain legacy history, but do not admit new fixture work around a revoked or
-- expired standing envelope. Revocation and expiry are distinct auditable states.
CREATE OR REPLACE FUNCTION public.sandy_engineering_resolve_standing(p_user_id uuid, p_session_id uuid, p_epoch integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE resolved jsonb;d public.sandy_engineering_standing_delegations;ops jsonb;
BEGIN
 resolved:=public.sandy_engineering_resolve_identity(p_user_id,p_session_id,p_epoch);
 IF resolved->>'ok' IS DISTINCT FROM 'true' THEN RETURN resolved;END IF;
 SELECT * INTO d FROM public.sandy_engineering_standing_delegations WHERE identity_user_id=p_user_id;
 IF d.id IS NULL THEN RETURN jsonb_build_object('ok',false,'policy_present',false,'error','standing_delegation_inactive','http_status',403);END IF;
 IF d.owner_authority_id::text IS DISTINCT FROM resolved->>'owner_authority_id' THEN RETURN jsonb_build_object('ok',false,'policy_present',true,'error','standing_delegation_authority_mismatch','http_status',403);END IF;
 IF d.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'policy_present',true,'error','standing_delegation_revoked','http_status',403);END IF;
 IF d.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'policy_present',true,'error','standing_delegation_expired','http_status',403);END IF;
 SELECT coalesce(jsonb_agg(c.operation ORDER BY c.operation),'[]'::jsonb) INTO ops
 FROM public.sandy_engineering_operation_classes c JOIN public.sandy_operation_registry r USING(operation)
 WHERE d.policy->'classes'->c.provider ? c.operation_class AND c.operation_class<>'restricted'
 AND r.error_contract->>'contract_sha256'=c.contract_sha256 AND r.is_mutation=c.is_mutation AND r.api_exposed AND r.ai_exposed;
 ops:=ops||'["system.execution.get","system.lifecycle.get","system.lifecycle.verify","system.lifecycle.compensate"]'::jsonb;
 RETURN jsonb_build_object('ok',true,'policy_present',true,'identity_user_id',p_user_id,'owner_authority_id',d.owner_authority_id,'session_id',p_session_id,
 'delegation_id',d.id,'version',d.version,'operations',ops,'expires_at',d.expires_at,'policy',d.policy);
END $function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
