--08800 owner-approved one-use delivery for exactly6 provider-download classes.
BEGIN;
DO $timestamp$
DECLARE original text;
BEGIN
 SELECT prosrc INTO original FROM pg_proc WHERE oid='public.sandy_provider_supplement_save_opaque(jsonb)'::regprocedure AND prosecdef;
 IF encode(extensions.digest(original,'sha256'),'hex') IS DISTINCT FROM 'c524ede19db40057cbdcb7e680b558222eaa8fee5bf4afea797e26cf065ee1c5' THEN RAISE EXCEPTION 'reviewed08400_save_function_required'; END IF;
END $timestamp$;
CREATE OR REPLACE FUNCTION public.sandy_provider_supplement_save_opaque(p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS '
DECLARE admission public.sandy_api_execution_admissions; payload bytea; secret uuid; receipt public.sandy_provider_supplement_opaque; capture_time timestamptz;
BEGIN
 admission:=public.sandy_provider_supplement_context(p_context);
 IF p_context->>''payload_base64'' IS NULL OR octet_length(p_context->>''payload_base64'')>1398104
 OR p_context->>''payload_base64'' !~ ''^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$''
 OR p_context->>''payload_sha256'' !~ ''^[a-f0-9]{64}$'' OR p_context->>''media_type'' IS NULL
 OR p_context->>''media_type'' !~ ''^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$'' OR octet_length(p_context->>''media_type'')>100
 OR jsonb_typeof(p_context->''byte_length'') IS DISTINCT FROM ''number'' THEN RAISE EXCEPTION ''supplement_payload_invalid''; END IF;
 payload:=decode(p_context->>''payload_base64'',''base64'');
 IF octet_length(payload)>1048576 OR octet_length(payload) IS DISTINCT FROM (p_context->>''byte_length'')::integer
 OR replace(encode(payload,''base64''),E''\n'','''') IS DISTINCT FROM p_context->>''payload_base64''
 OR encode(extensions.digest(payload,''sha256''),''hex'') IS DISTINCT FROM p_context->>''payload_sha256''
 OR p_context->>''kind'' IN (''cursor'',''redirect'') AND octet_length(payload) NOT BETWEEN 1 AND 8192
 THEN RAISE EXCEPTION ''supplement_payload_integrity_failed''; END IF;
 PERFORM public.sandy_provider_supplement_cleanup_opaque();
 -- A consumed exact admission has one immutable custody result; a retry cannot
 -- create a second object or substitute different response material.
 IF EXISTS(SELECT 1 FROM public.sandy_provider_supplement_opaque WHERE source_admission_id=admission.id)
 THEN RAISE EXCEPTION ''supplement_admission_already_captured''; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(''sandy_provider_supplement_quota'',0));
 IF (SELECT count(*) FROM public.sandy_provider_supplement_opaque WHERE actor_id=admission.actor_id)>=32
 OR (SELECT coalesce(sum(byte_length),0) FROM public.sandy_provider_supplement_opaque)+octet_length(payload)>67108864
 THEN RAISE EXCEPTION ''supplement_private_custody_quota_reached''; END IF;
 secret:=vault.create_secret(p_context->>''payload_base64'',''SANDY_PROVIDER_MEDIA_''||gen_random_uuid()::text,''Private short-lived provider media/cursor; never return material'');
 capture_time:=clock_timestamp();
 INSERT INTO public.sandy_provider_supplement_opaque(created_at,actor_id,source_admission_id,operation,registry_revision_sha256,scope_sha256,
 source_input_sha256,binding_sha256,target,kind,vault_secret_id,payload_sha256,byte_length,media_type,expires_at)
 VALUES(capture_time,admission.actor_id,admission.id,admission.operation,admission.registry_revision_sha256,admission.scope_sha256,
 admission.input_sha256,p_context->>''binding_sha256'',p_context->>''target'',p_context->>''kind'',secret,p_context->>''payload_sha256'',
 octet_length(payload),p_context->>''media_type'',capture_time+CASE WHEN p_context->>''kind''=''artifact'' THEN interval ''10 minutes'' ELSE interval ''5 minutes'' END)
 RETURNING * INTO receipt;
 RETURN jsonb_build_object(''custody_id'',receipt.id,''byte_length'',receipt.byte_length,''sha256'',receipt.payload_sha256,
  ''media_type'',receipt.media_type,''expires_at'',receipt.expires_at);
END ';
REVOKE ALL ON FUNCTION public.sandy_provider_supplement_save_opaque(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_provider_supplement_save_opaque(jsonb) TO service_role;

CREATE FUNCTION public.sandy_provider_artifact_deliver(p_actor uuid,p_admission uuid,p_arguments_canonical text,p_scope_canonical text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE args jsonb; scope jsonb; admission public.sandy_api_execution_admissions; source_admission public.sandy_api_execution_admissions;
 entry public.sandy_operation_registry; source_entry public.sandy_operation_registry; saved public.sandy_provider_supplement_opaque;
 material text; payload bytea; expected_source_hash text; expected_scope jsonb;
BEGIN
 IF p_actor IS NULL OR p_admission IS NULL OR p_arguments_canonical IS NULL OR octet_length(p_arguments_canonical)>16000
 OR p_scope_canonical IS NULL OR octet_length(p_scope_canonical)>18000 THEN RAISE EXCEPTION 'artifact_delivery_context_invalid'; END IF;
 BEGIN args:=p_arguments_canonical::jsonb;scope:=p_scope_canonical::jsonb;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'artifact_delivery_context_invalid'; END;
 IF jsonb_typeof(args) IS DISTINCT FROM 'object' OR NOT(args ?& ARRAY['custody_id','expected_sha256','source_operation','source_input_sha256','source_scope_sha256'])
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(args) k WHERE k NOT IN ('custody_id','expected_sha256','source_operation','source_input_sha256','source_scope_sha256'))
 OR EXISTS(SELECT 1 FROM jsonb_each(args) v WHERE jsonb_typeof(v.value) IS DISTINCT FROM 'string')
 OR args->>'custody_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR args->>'expected_sha256' !~ '^[a-f0-9]{64}$' OR args->>'source_input_sha256' !~ '^[a-f0-9]{64}$' OR args->>'source_scope_sha256' !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'artifact_delivery_context_invalid'; END IF;
 IF args->>'source_operation' NOT IN ('github.actions.jobs.logs.capture','github.actions.jobs.steps.logs.capture','github.actions.runs.attempts.logs.capture','github.actions.runs.logs.capture','github.actions.artifacts.download.capture','gcp.artifacts.files.download.capture') THEN RAISE EXCEPTION 'artifact_delivery_source_class_required'; END IF;
 expected_scope:=jsonb_build_object('provider','sandy_private_artifacts','artifact_class','provider_download','project_ref','zmqlyygzqoidkcwdysok',
  'custody_id',args->>'custody_id','expected_sha256',args->>'expected_sha256','source_operation',args->>'source_operation',
  'source_input_sha256',args->>'source_input_sha256','source_scope_sha256',args->>'source_scope_sha256');
 IF scope IS DISTINCT FROM expected_scope THEN RAISE EXCEPTION 'artifact_delivery_context_invalid'; END IF;
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR SHARE;
 IF admission.id IS NULL OR admission.actor_id IS DISTINCT FROM p_actor OR admission.operation IS DISTINCT FROM 'provider.artifacts.read_private'
 OR admission.tenant_id IS NOT NULL OR admission.credential_id IS NOT NULL OR admission.approval_id IS NULL OR admission.is_mutation IS DISTINCT FROM false
 OR admission.state IS DISTINCT FROM 'consumed' OR admission.expires_at<=clock_timestamp() OR NOT public.sandy_api_current_owner(p_actor)
 OR admission.input_sha256 IS DISTINCT FROM encode(extensions.digest(p_arguments_canonical,'sha256'),'hex')
 OR admission.scope_sha256 IS DISTINCT FROM encode(extensions.digest(p_scope_canonical,'sha256'),'hex')
 THEN RAISE EXCEPTION 'artifact_delivery_owner_admission_required'; END IF;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=admission.operation FOR SHARE;
 IF entry.handler IS DISTINCT FROM 'sandy-provider-artifact-api' OR entry.permission_scope IS DISTINCT FROM 'infrastructure:write'
 OR entry.api_exposed IS DISTINCT FROM true OR entry.verified IS DISTINCT FROM true OR entry.is_mutation IS DISTINCT FROM false
 OR entry.error_contract->>'requires_approval' IS DISTINCT FROM 'true' OR entry.error_contract->>'requires_grant' IS DISTINCT FROM 'true'
 OR entry.error_contract->>'api_key_delegable' IS DISTINCT FROM 'false' OR entry.error_contract->>'contract_sha256' IS DISTINCT FROM 'e573fd716c831ca9e8e825a54caa0db6a4ff2e93397b9d270cd7e21198364d38'
 OR admission.contract_sha256 IS DISTINCT FROM 'e573fd716c831ca9e8e825a54caa0db6a4ff2e93397b9d270cd7e21198364d38' OR admission.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(admission.operation)
 THEN RAISE EXCEPTION 'artifact_delivery_current_contract_required'; END IF;
 SELECT * INTO saved FROM public.sandy_provider_supplement_opaque WHERE id=(args->>'custody_id')::uuid FOR UPDATE;
 IF saved.id IS NULL OR saved.kind IS DISTINCT FROM 'artifact' OR saved.actor_id IS DISTINCT FROM p_actor OR saved.operation IS DISTINCT FROM args->>'source_operation'
 OR saved.source_input_sha256 IS DISTINCT FROM args->>'source_input_sha256' OR saved.scope_sha256 IS DISTINCT FROM args->>'source_scope_sha256'
 OR saved.payload_sha256 IS DISTINCT FROM args->>'expected_sha256' OR saved.consumed_at IS NOT NULL OR saved.expires_at<=clock_timestamp()
 OR saved.byte_length NOT BETWEEN 0 AND 1048576 OR saved.media_type ~* '(x-sandy|private-key|pem-file|pkcs)'
 OR saved.source_admission_id=p_admission OR saved.target ~ '[[:cntrl:]#]' OR (CASE saved.operation
 WHEN 'github.actions.jobs.logs.capture' THEN saved.target !~ '^https://api\.github\.com/repos/ausstyle/web-staging/actions/jobs/[0-9]+/logs$'
 WHEN 'github.actions.jobs.steps.logs.capture' THEN saved.target !~ '^https://api\.github\.com/repos/ausstyle/web-staging/actions/jobs/[0-9]+/steps/[0-9]+/logs$'
 WHEN 'github.actions.runs.attempts.logs.capture' THEN saved.target !~ '^https://api\.github\.com/repos/ausstyle/web-staging/actions/runs/[0-9]+/attempts/[0-9]+/logs$'
 WHEN 'github.actions.runs.logs.capture' THEN saved.target !~ '^https://api\.github\.com/repos/ausstyle/web-staging/actions/runs/[0-9]+/logs$'
 WHEN 'github.actions.artifacts.download.capture' THEN saved.target !~ '^https://api\.github\.com/repos/ausstyle/web-staging/actions/artifacts/[0-9]+/zip$'
 WHEN 'gcp.artifacts.files.download.capture' THEN saved.target !~ '^https://artifactregistry\.googleapis\.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/repositories/[a-z][a-z0-9-]{0,62}/files/(?:[A-Za-z0-9._~@:/+-]|%[0-9A-F]{2})+:download\?alt=media$'
 ELSE true END) THEN RAISE EXCEPTION 'artifact_delivery_binding_expired_or_used'; END IF;
 SELECT * INTO source_admission FROM public.sandy_api_execution_admissions WHERE id=saved.source_admission_id FOR SHARE;
 IF source_admission.id IS NULL OR source_admission.actor_id IS DISTINCT FROM p_actor OR source_admission.tenant_id IS NOT NULL OR source_admission.credential_id IS NOT NULL
 OR source_admission.approval_id IS NULL OR source_admission.operation IS DISTINCT FROM saved.operation OR source_admission.is_mutation IS DISTINCT FROM false
 OR source_admission.state IS DISTINCT FROM 'succeeded' OR source_admission.input_sha256 IS DISTINCT FROM saved.source_input_sha256
 OR source_admission.scope_sha256 IS DISTINCT FROM saved.scope_sha256 OR source_admission.registry_revision_sha256 IS DISTINCT FROM saved.registry_revision_sha256
 THEN RAISE EXCEPTION 'artifact_delivery_source_not_succeeded'; END IF;
 SELECT * INTO source_entry FROM public.sandy_operation_registry WHERE operation=saved.operation FOR SHARE;
 expected_source_hash:=CASE saved.operation
 WHEN 'github.actions.jobs.logs.capture' THEN 'ad7725d944a8d8e40a48005bf607df81c5a131b8adab505a52c68a2422f13b7a'
 WHEN 'github.actions.jobs.steps.logs.capture' THEN '16d6bd4d22294d3963e0c652b618cc1a98535b47d9e28122d4781a74dedd99bb'
 WHEN 'github.actions.runs.attempts.logs.capture' THEN '441e7f5918997671e1424b9841332833ea66b2327b8c30baab1a104f461d74db'
 WHEN 'github.actions.runs.logs.capture' THEN 'ea7fea836eb47d787049352301dbcaadb448a1345689a7269ebab60421cc0e83'
 WHEN 'github.actions.artifacts.download.capture' THEN 'f545b7dba950737d1735f99c6621cb70ce5b1527f0793005d1615b07f1e790fe'
 WHEN 'gcp.artifacts.files.download.capture' THEN '0fb722ac705e3d7b37f5ff873e85a1c100dacb3a2770e430c9ad6922ad32987f'
 ELSE NULL END;
 IF expected_source_hash IS NULL OR source_entry.handler IS DISTINCT FROM 'sandy-provider-supplement-api' OR source_entry.is_mutation IS DISTINCT FROM false
 OR source_entry.api_exposed IS DISTINCT FROM true OR source_entry.verified IS DISTINCT FROM true OR source_entry.permission_scope IS DISTINCT FROM 'infrastructure:write'
 OR source_entry.error_contract->>'requires_approval' IS DISTINCT FROM 'true' OR source_entry.error_contract->>'requires_grant' IS DISTINCT FROM 'true'
 OR source_entry.error_contract->>'api_key_delegable' IS DISTINCT FROM 'false' OR source_entry.error_contract->>'contract_sha256' IS DISTINCT FROM expected_source_hash
 OR source_admission.contract_sha256 IS DISTINCT FROM expected_source_hash OR public.sandy_api_registry_revision(saved.operation) IS DISTINCT FROM saved.registry_revision_sha256
 THEN RAISE EXCEPTION 'artifact_delivery_source_contract_changed'; END IF;
 SELECT decrypted_secret INTO material FROM vault.decrypted_secrets WHERE id=saved.vault_secret_id;
 IF material IS NULL OR octet_length(material)>1398104 OR material !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
 THEN RAISE EXCEPTION 'artifact_delivery_integrity_failed'; END IF;
 payload:=decode(material,'base64');
 IF octet_length(payload) IS DISTINCT FROM saved.byte_length OR replace(encode(payload,'base64'),chr(10),'') IS DISTINCT FROM material
 OR encode(extensions.digest(payload,'sha256'),'hex') IS DISTINCT FROM saved.payload_sha256 THEN RAISE EXCEPTION 'artifact_delivery_integrity_failed'; END IF;
 -- Defense in depth for recognizable embedded credential material. Classification
 -- is the exact source operation, not a claim to recognize every secret in an archive.
 IF encode(payload,'escape') ~ '-----BEGIN (RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|"(private_key|client_secret|service_role_key|refresh_token)"[[:space:]]*:|(^|[^A-Za-z0-9_])(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sbp_[A-Za-z0-9]{20,})|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
 THEN RAISE EXCEPTION 'artifact_delivery_credential_material_refused'; END IF;
 UPDATE public.sandy_provider_supplement_opaque SET consumed_at=clock_timestamp(),consumed_by=admission.id WHERE id=saved.id;
 RETURN jsonb_build_object('custody_id',saved.id,'sha256',saved.payload_sha256,'byte_length',saved.byte_length,'media_type',saved.media_type,
  'content_base64',material,'source_operation',saved.operation,'source_input_sha256',saved.source_input_sha256,'source_scope_sha256',saved.scope_sha256,
  'artifact_class','provider_download','consumed',true,'content_returned',true);
END $body$;
REVOKE ALL ON FUNCTION public.sandy_provider_artifact_deliver(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_provider_artifact_deliver(uuid,uuid,text,text) TO service_role;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy)
VALUES('provider.artifacts.read_private','provider','Owner-approved one-use bounded byte delivery for six explicit provider-download classes','infrastructure:write',false,'{"type":"object","properties":{"custody_id":{"type":"string","format":"uuid","pattern":"^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$"},"expected_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"source_operation":{"enum":["github.actions.jobs.logs.capture","github.actions.jobs.steps.logs.capture","github.actions.runs.attempts.logs.capture","github.actions.runs.logs.capture","github.actions.artifacts.download.capture","gcp.artifacts.files.download.capture"]},"source_input_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"source_scope_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"required":["custody_id","expected_sha256","source_operation","source_input_sha256","source_scope_sha256"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"operation":{"const":"provider.artifacts.read_private"},"contract_version":{"const":"1.0.0"},"request_state":{"const":"delivered"},"executed":{"const":true},"admission_id":{"type":"string","format":"uuid","pattern":"^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$"},"result":{"type":"object","properties":{"custody_id":{"type":"string","format":"uuid","pattern":"^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$"},"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"byte_length":{"type":"integer","minimum":0,"maximum":1048576},"media_type":{"type":"string","minLength":1,"maxLength":100},"content_base64":{"type":"string","maxLength":1398104,"pattern":"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"},"source_operation":{"enum":["github.actions.jobs.logs.capture","github.actions.jobs.steps.logs.capture","github.actions.runs.attempts.logs.capture","github.actions.runs.logs.capture","github.actions.artifacts.download.capture","gcp.artifacts.files.download.capture"]},"source_input_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"source_scope_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"artifact_class":{"const":"provider_download"},"consumed":{"const":true},"content_returned":{"const":true}},"required":["custody_id","sha256","byte_length","media_type","content_base64","source_operation","source_input_sha256","source_scope_sha256","artifact_class","consumed","content_returned"],"additionalProperties":false},"reconciliation_required":{"const":false}},"required":["ok","operation","contract_version","request_state","executed","admission_id","result","reconciliation_required"],"additionalProperties":false}'::jsonb,'sandy-provider-artifact-api',false,false,false,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-provider-artifact-api/index.ts','["normal_owner_session","exact_artifact_scope_approval","one_use_exact_admission","verified_source_capture","same_source_owner","unexpired_private_download_artifact"]'::jsonb,'{"version":"1.0.0","contract_sha256":"e573fd716c831ca9e8e825a54caa0db6a4ff2e93397b9d270cd7e21198364d38","requires_grant":true,"requires_approval":true,"api_key_delegable":false,"requirement_ids":[63,128,129],"source_review_only":true,"runtime_provider_verified":false,"allowed_source_operations":["github.actions.jobs.logs.capture","github.actions.jobs.steps.logs.capture","github.actions.runs.attempts.logs.capture","github.actions.runs.logs.capture","github.actions.artifacts.download.capture","gcp.artifacts.files.download.capture"],"max_bytes":1048576,"credential_source_classes_supported":false,"recognizable_credentials_refused":true,"archive_contents_proven_secret_free":false,"one_use_delivery":true}'::jsonb,'{"automatic":false,"safe_to_retry":false}'::jsonb,'{"automatic":false,"reason":"Consumed artifact delivery cannot be reversed or automatically redispatched"}'::jsonb);
COMMIT;
