-- Real existing owner-approved change; temporary metadata changes below roll
-- back and do not manufacture a human session or invoke a Google provider.
DO $test$
DECLARE source public.sandy_engineering_changes%ROWTYPE;request uuid:=gen_random_uuid();admission bigint;result jsonb;valid jsonb;checks integer:=0;job_count bigint;resource_count bigint;
BEGIN
 SELECT * INTO source FROM public.sandy_engineering_changes WHERE id=current_setting('sandy.fixture.vm_change')::uuid;
 IF source.id IS NULL THEN RAISE EXCEPTION 'existing approved source required';END IF;
 SELECT count(*) INTO job_count FROM public.sandy_deployment_jobs;SELECT count(*) INTO resource_count FROM public.sandy_customer_resources;
 IF has_function_privilege('anon','public.sandy_video_network_prepare_authorize(uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.sandy_video_network_prepare_authorize(uuid,uuid)','EXECUTE') OR has_function_privilege('anon','public.sandy_video_network_prepare_record(bigint,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.sandy_video_network_prepare_record(bigint,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'network service privilege boundary';END IF;checks:=checks+4;
 result:=public.sandy_video_network_prepare_authorize(gen_random_uuid(),request);IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'unknown approval accepted';END IF;checks:=checks+1;
 result:=public.sandy_video_network_prepare_authorize(source.id,NULL);IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'missing request correlation accepted';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_changes SET scope=source.scope-'google_cloud:network' WHERE id=source.id;
 result:=public.sandy_video_network_prepare_authorize(source.id,request);IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'install approval allowed unapproved network effect';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_changes SET scope=source.scope,requested_by='7a519da9-2ee3-4edf-adec-42697da5a560' WHERE id=source.id;
 result:=public.sandy_video_network_prepare_authorize(source.id,request);IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'nonowner source accepted';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_changes SET requested_by=source.requested_by WHERE id=source.id;
 result:=public.sandy_video_network_prepare_authorize(source.id,request);IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'genuine approved scoped source denied';END IF;checks:=checks+1;admission:=(result->>'admission_id')::bigint;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_customer_provisioning_events WHERE id=admission AND actor_id IS NULL AND customer_id IS NULL AND detail->>'owner_authority_id'=source.requested_by::text AND detail->>'instance_id'='6831598645020395570' AND detail->>'iam_changes_authorized'='false' AND detail->>'paid_resource_creation_authorized'='false') THEN RAISE EXCEPTION 'authority, target and noncustomer audit attribution';END IF;checks:=checks+3;
 valid:='{"phase":"observed","mutation_attempted":true,"accepted":true,"private_google_access_enabled":true,"configuration_verified":true,"reconciliation_required":false}'::jsonb;
 result:=public.sandy_video_network_prepare_record(-1,valid);IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'unknown admission accepted';END IF;checks:=checks+1;
 result:=public.sandy_video_network_prepare_record(admission,valid||'{"token":"not-a-real-secret"}');IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'arbitrary audit payload accepted';END IF;checks:=checks+1;
 result:=public.sandy_video_network_prepare_record(admission,valid||'{"private_google_access_enabled":"true"}');IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'string boolean accepted';END IF;checks:=checks+1;
 result:=public.sandy_video_network_prepare_record(admission,valid||'{"phase":"accepted"}');IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'accepted phase misrepresented as completion';END IF;checks:=checks+1;
 result:=public.sandy_video_network_prepare_record(admission,valid||'{"phase":"unknown","configuration_verified":false}');IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'unknown phase without reconciliation accepted';END IF;checks:=checks+1;
 result:=public.sandy_video_network_prepare_record(admission,valid||'{"google_http":true}');IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'invalid provider status accepted';END IF;checks:=checks+1;
 result:=public.sandy_video_network_prepare_record(admission,valid);IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'actual typed observation denied';END IF;checks:=checks+1;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_customer_provisioning_events WHERE id=admission AND detail->>'phase'='finalized') OR (SELECT count(*) FROM public.sandy_customer_provisioning_events WHERE request_id=request AND detail->>'phase'='observed')<>1 THEN RAISE EXCEPTION 'admission and observation not finalized together';END IF;checks:=checks+2;
 result:=public.sandy_video_network_prepare_record(admission,valid);IF result->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'finalization replay accepted';END IF;checks:=checks+1;
 IF (SELECT count(*) FROM public.sandy_deployment_jobs)<>job_count OR (SELECT count(*) FROM public.sandy_customer_resources)<>resource_count THEN RAISE EXCEPTION 'audit preparation provisioned a resource';END IF;checks:=checks+2;
 CREATE TEMP TABLE sandy_video_network_prepare_test_report AS SELECT checks passed,0 failed,true rolled_back,false provider_calls;
END $test$;
SELECT * FROM sandy_video_network_prepare_test_report;
