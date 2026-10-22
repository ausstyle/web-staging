-- A bounded administrative repair for the existing VM's Google API egress.
-- Reuses engineering approval and provisioning audit; no customer is fabricated,
-- no IAM, public IP, firewall, NAT or paid plan change is authorized here.
BEGIN;
CREATE FUNCTION public.sandy_video_network_prepare_authorize(p_change_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE source public.sandy_engineering_changes%ROWTYPE;event_id bigint;
BEGIN
 SELECT * INTO source FROM public.sandy_engineering_changes WHERE id=p_change_id;
 IF p_request_id IS NULL OR source.id IS NULL OR source.status NOT IN('approved','implementing','committed','deployed','verified')
 OR NOT public.sandy_api_current_owner(source.requested_by)
 OR NOT source.scope @> '["sandy-video","video.install","osconfig.googleapis.com","google_cloud:network"]'::jsonb
 OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.change_id=source.id AND e.actor=source.requested_by AND ((e.event_type='status_changed' AND e.detail->>'to'='approved') OR e.event_type='delegated_auto_approved'))
 THEN RETURN jsonb_build_object('ok',false,'error','existing_owner_approved_video_network_scope_required');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-video-network:'||p_request_id::text,0));
 IF EXISTS(SELECT 1 FROM public.sandy_customer_provisioning_events WHERE request_id=p_request_id AND operation='administration.video.network.prepare' AND detail->>'source_change_id' IS DISTINCT FROM source.id::text) THEN RETURN jsonb_build_object('ok',false,'error','request_id_conflict');END IF;
 INSERT INTO public.sandy_customer_provisioning_events(request_id,operation,detail)
 VALUES(p_request_id,'administration.video.network.prepare',jsonb_build_object('phase','authorized','actor_kind','trusted_internal_service','owner_authority_id',source.requested_by,'source_change_id',source.id,'project_id','elaborate-haven-511518-a5','zone','europe-west1-b','instance_id','6831598645020395570','allowed_effect','enable_private_google_access_on_current_vm_subnetwork','iam_changes_authorized',false,'paid_resource_creation_authorized',false)) RETURNING id INTO event_id;
 RETURN jsonb_build_object('ok',true,'admission_id',event_id);
END $$;
REVOKE ALL ON FUNCTION public.sandy_video_network_prepare_authorize(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_video_network_prepare_authorize(uuid,uuid) TO service_role;

CREATE FUNCTION public.sandy_video_network_prepare_record(p_admission_id bigint,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE admission public.sandy_customer_provisioning_events%ROWTYPE;
BEGIN
 SELECT * INTO admission FROM public.sandy_customer_provisioning_events WHERE id=p_admission_id AND operation='administration.video.network.prepare' AND detail->>'phase'='authorized' FOR UPDATE;
 IF NOT FOUND OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>3000
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_result) k WHERE k NOT IN('phase','google_http','google_error_status','google_error_message','error','operation_name','subnetwork','prior_private_google_access','private_google_access_enabled','configuration_verified','mutation_attempted','accepted','reconciliation_required'))
 OR p_result->>'phase' IS NULL OR p_result->>'phase' NOT IN('observed','accepted','failed','unknown')
 OR jsonb_typeof(p_result->'configuration_verified') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(p_result->'mutation_attempted') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(p_result->'accepted') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(p_result->'reconciliation_required') IS DISTINCT FROM 'boolean'
 OR (p_result?'private_google_access_enabled' AND jsonb_typeof(p_result->'private_google_access_enabled') IS DISTINCT FROM 'boolean')
 OR (p_result?'prior_private_google_access' AND jsonb_typeof(p_result->'prior_private_google_access') IS DISTINCT FROM 'boolean')
 OR (p_result?'error' AND (jsonb_typeof(p_result->'error') IS DISTINCT FROM 'string' OR p_result->>'error' NOT IN('fixed_running_video_vm_required','fixed_project_vm_subnetwork_required','subnetwork_identity_or_state_unverified','video_network_provider_rejected','network_operation_identity_unverified','subnetwork_readback_identity_unverified','video_network_mutation_outcome_unknown','video_network_provider_unavailable')))
 OR (p_result->>'configuration_verified'='true' AND p_result->>'private_google_access_enabled' IS DISTINCT FROM 'true')
 OR (p_result?'google_http' AND (jsonb_typeof(p_result->'google_http') IS DISTINCT FROM 'number' OR p_result->>'google_http'!~'^[1-5][0-9]{2}$'))
 OR (p_result?'google_error_status' AND (jsonb_typeof(p_result->'google_error_status') IS DISTINCT FROM 'string' OR p_result->>'google_error_status'!~'^[A-Z_]{1,60}$'))
 OR (p_result?'google_error_message' AND (jsonb_typeof(p_result->'google_error_message') IS DISTINCT FROM 'string' OR length(p_result->>'google_error_message')>500))
 OR (p_result?'subnetwork' AND (jsonb_typeof(p_result->'subnetwork') IS DISTINCT FROM 'string' OR p_result->>'subnetwork'!~'^[a-z][a-z0-9-]{0,62}$'))
 OR (p_result?'operation_name' AND (jsonb_typeof(p_result->'operation_name') IS DISTINCT FROM 'string' OR p_result->>'operation_name'!~'^operation-[A-Za-z0-9-]{1,180}$'))
 OR (p_result->>'phase'='observed' AND (p_result->>'configuration_verified'<>'true' OR p_result->>'reconciliation_required'<>'false'))
 OR (p_result->>'phase' IN('accepted','unknown') AND (p_result->>'configuration_verified'<>'false' OR p_result->>'reconciliation_required'<>'true'))
 OR (p_result->>'phase'='accepted' AND p_result->>'accepted'<>'true')
 OR (p_result->>'phase' IN('accepted','unknown') AND p_result->>'mutation_attempted'<>'true')
 OR (p_result->>'accepted'='true' AND p_result->>'mutation_attempted'<>'true')
 OR (p_result->>'phase'='failed' AND (p_result->>'configuration_verified'<>'false' OR p_result->>'accepted'<>'false' OR p_result->>'reconciliation_required'<>'false'))
 THEN RETURN jsonb_build_object('ok',false,'error','invalid_video_network_observation');END IF;
 UPDATE public.sandy_customer_provisioning_events SET detail=detail||jsonb_build_object('phase','finalized') WHERE id=admission.id;
 INSERT INTO public.sandy_customer_provisioning_events(request_id,operation,detail)
 VALUES(admission.request_id,'administration.video.network.prepare',jsonb_build_object('actor_kind','trusted_internal_service','source_change_id',admission.detail->>'source_change_id','owner_authority_id',admission.detail->>'owner_authority_id','admission_id',admission.id)||p_result);
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.sandy_video_network_prepare_record(bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_video_network_prepare_record(bigint,jsonb) TO service_role;
COMMIT;
