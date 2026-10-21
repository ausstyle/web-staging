--08900 real pinned SSH/WinRM protocol owner boundary; no provider activation.
BEGIN;
DO $guard$ BEGIN IF (SELECT encode(extensions.digest(prosrc,'sha256'),'hex') FROM pg_proc WHERE oid='public.sandy_credential_resolve_consumer(text,uuid,uuid,text)'::regprocedure AND prosecdef) IS DISTINCT FROM '15e4e7f70d59457e963f04855537da6af09566966feb5c3c51695f2629e47b87' THEN RAISE EXCEPTION 'reviewed_post108_consumer_required';END IF;END $guard$;
-- Private owner-pinned protocol identity, immutable command and output custody.
CREATE TABLE public.sandy_vm_protocol_contracts(operation text PRIMARY KEY,kind text NOT NULL,handler text NOT NULL,permission_scope text NOT NULL,is_mutation boolean NOT NULL,input_schema jsonb NOT NULL,output_schema jsonb NOT NULL,contract_sha256 text NOT NULL CHECK(contract_sha256~'^[a-f0-9]{64}$'));
CREATE TABLE public.sandy_vm_protocol_bindings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES auth.users(id),vm_name text NOT NULL CHECK(vm_name IN('sandy-video','sandy-windows')),
 instance_id text NOT NULL,configuration jsonb NOT NULL,enrollment_admission_id uuid UNIQUE NOT NULL REFERENCES public.sandy_api_execution_admissions(id),
 enrollment_arguments_canonical text NOT NULL,vm_proof_sha256 text NOT NULL CHECK(vm_proof_sha256~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL,revoked_at timestamptz,
 CHECK(instance_id=CASE vm_name WHEN 'sandy-video' THEN '6831598645020395570' ELSE '8120150462304566315' END)
);
CREATE UNIQUE INDEX sandy_vm_protocol_one_current_binding ON public.sandy_vm_protocol_bindings(actor_id,vm_name) WHERE revoked_at IS NULL;
CREATE TABLE public.sandy_vm_protocol_commands(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES auth.users(id),vm_name text NOT NULL CHECK(vm_name IN('sandy-video','sandy-windows')),
 allowed_operation text NOT NULL CHECK(allowed_operation IN('cloud.vm.exec','video.install','video.logs','video.restart','video.verify_call')),
 recipe_sha256 text CHECK(recipe_sha256~'^[a-f0-9]{64}$'),command_sha256 text NOT NULL CHECK(command_sha256~'^[a-f0-9]{64}$'),vault_secret_id uuid UNIQUE NOT NULL,
 registration_admission_id uuid UNIQUE NOT NULL REFERENCES public.sandy_api_execution_admissions(id),created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz,
 CHECK(expires_at>=created_at+interval '60 seconds' AND expires_at<=created_at+interval '1 hour'),CHECK(allowed_operation='cloud.vm.exec' OR recipe_sha256 IS NOT NULL)
);
CREATE TABLE public.sandy_vm_protocol_outputs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES auth.users(id),admission_id uuid UNIQUE NOT NULL REFERENCES public.sandy_api_execution_admissions(id),
 operation text NOT NULL,vm_name text NOT NULL,binding_id uuid NOT NULL REFERENCES public.sandy_vm_protocol_bindings(id),command_sha256 text NOT NULL CHECK(command_sha256~'^[a-f0-9]{64}$'),
 input_sha256 text NOT NULL,scope_sha256 text NOT NULL,payload_sha256 text NOT NULL CHECK(payload_sha256~'^[a-f0-9]{64}$'),byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 100000),
 vault_secret_id uuid UNIQUE NOT NULL,receipt_metadata jsonb NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,CHECK(expires_at=created_at+interval '10 minutes')
);
CREATE TABLE public.sandy_vm_protocol_attempts(admission_id uuid PRIMARY KEY REFERENCES public.sandy_api_execution_admissions(id),actor_id uuid NOT NULL REFERENCES auth.users(id),binding_id uuid NOT NULL REFERENCES public.sandy_vm_protocol_bindings(id),command_sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.sandy_vm_protocol_admission_contexts(admission_id uuid PRIMARY KEY REFERENCES public.sandy_api_execution_admissions(id),arguments_vault_id uuid UNIQUE NOT NULL,input_sha256 text NOT NULL,scope_canonical text NOT NULL CHECK(octet_length(scope_canonical)<=8000),expires_at timestamptz NOT NULL);
CREATE TABLE public.sandy_vm_protocol_metadata_receipts(admission_id uuid PRIMARY KEY REFERENCES public.sandy_api_execution_admissions(id),result jsonb NOT NULL);
ALTER TABLE public.sandy_vm_protocol_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_vm_protocol_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_vm_protocol_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_vm_protocol_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_vm_protocol_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_vm_protocol_admission_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_vm_protocol_metadata_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_vm_protocol_contracts,public.sandy_vm_protocol_bindings,public.sandy_vm_protocol_commands,public.sandy_vm_protocol_outputs,public.sandy_vm_protocol_attempts,public.sandy_vm_protocol_admission_contexts,public.sandy_vm_protocol_metadata_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_vm_protocol_current_binding(p_actor uuid,p_vm text) RETURNS public.sandy_vm_protocol_bindings LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b public.sandy_vm_protocol_bindings; a public.sandy_api_execution_admissions; c public.sandy_vm_protocol_contracts;
BEGIN
 SELECT * INTO b FROM public.sandy_vm_protocol_bindings WHERE actor_id=p_actor AND vm_name=p_vm AND revoked_at IS NULL FOR SHARE;
 IF b.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=b.enrollment_admission_id FOR SHARE;
 SELECT * INTO c FROM public.sandy_vm_protocol_contracts WHERE operation='gcp.vm.protocol_bindings.enroll';
 IF a.id IS NULL OR a.actor_id IS DISTINCT FROM p_actor OR a.operation IS DISTINCT FROM c.operation OR a.state IS DISTINCT FROM 'succeeded'
 OR a.principal_kind IS DISTINCT FROM 'auth_user' OR a.credential_id IS NOT NULL OR a.tenant_id IS NOT NULL OR a.customer_key_id IS NOT NULL
 OR a.approval_id IS NULL OR a.contract_sha256 IS DISTINCT FROM c.contract_sha256
 OR a.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(c.operation)
 OR a.input_sha256 IS DISTINCT FROM encode(extensions.digest(b.enrollment_arguments_canonical,'sha256'),'hex')
 OR b.configuration IS DISTINCT FROM (b.enrollment_arguments_canonical::jsonb-'vm_name')
 OR b.enrollment_arguments_canonical::jsonb->>'vm_name' IS DISTINCT FROM p_vm THEN RAISE EXCEPTION 'vm_owner_enrollment_proof_required';END IF;
 RETURN b;
END $$;
REVOKE ALL ON FUNCTION public.sandy_vm_protocol_current_binding(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_vm_protocol_public_bindings(p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb:='{}';vm text;b public.sandy_vm_protocol_bindings;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.sandy_api_current_owner(p_actor)
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false)) THEN RAISE EXCEPTION 'actual_current_owner_required';END IF;
 FOREACH vm IN ARRAY ARRAY['sandy-video','sandy-windows'] LOOP
  b:=public.sandy_vm_protocol_current_binding(p_actor,vm);
  IF b.id IS NOT NULL THEN result:=result||jsonb_build_object(vm,b.configuration||jsonb_build_object('verified',true,'instance_id',b.instance_id,'version',b.id));END IF;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sandy_vm_protocol_public_bindings(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_vm_protocol_public_bindings(uuid) TO service_role;

CREATE FUNCTION public.sandy_vm_protocol_scope(p_operation text,p_arguments jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_vm_protocol_contracts;vm text;instance_id text;protocol text;b public.sandy_vm_protocol_bindings;s jsonb;
BEGIN
 SELECT * INTO c FROM public.sandy_vm_protocol_contracts WHERE operation=p_operation;
 IF c.operation IS NULL THEN RAISE EXCEPTION 'vm_source_contract_required';END IF;
 IF c.kind IN('command_get','command_revoke') THEN RETURN jsonb_build_object('provider','gcp_vm_command_metadata','project_id','elaborate-haven-511518-a5','zone','europe-west1-b','command_ref',p_arguments->>'command_ref');END IF;
 vm:=CASE WHEN c.kind='registered_exec' THEN p_arguments->>'instance' ELSE p_arguments->>'vm_name' END;
 IF vm NOT IN('sandy-video','sandy-windows') OR vm IS NULL THEN RAISE EXCEPTION 'fixed_vm_required';END IF;
 instance_id:=CASE vm WHEN 'sandy-video' THEN '6831598645020395570' ELSE '8120150462304566315' END;
 IF c.kind IN('ssh','winrm','registered_exec') THEN
  b:=public.sandy_vm_protocol_current_binding(p_actor,vm);
  protocol:=CASE WHEN c.kind='winrm' OR c.kind='registered_exec' AND vm='sandy-windows' THEN 'winrm' ELSE 'ssh' END;
  IF b.id IS NULL OR NOT b.configuration ? protocol THEN RAISE EXCEPTION 'verified_vm_protocol_binding_required';END IF;
  s:=jsonb_build_object('provider','gcp','project_id','elaborate-haven-511518-a5','zone','europe-west1-b','vm_name',vm,'instance_id',instance_id,'protocol',protocol,'binding_version',b.id);
  IF protocol='ssh' THEN s:=s||jsonb_build_object('ssh_host_key_sha256',b.configuration->'ssh'->>'host_key_sha256','ssh_authentication_mode',b.configuration->'ssh'->>'mode');
  ELSE s:=s||jsonb_build_object('winrm_certificate_sha256',b.configuration->'winrm'->>'certificate_sha256','winrm_server_name',b.configuration->'winrm'->>'server_name');END IF;
  IF c.kind='registered_exec' THEN s:=s||jsonb_build_object('command_ref',p_arguments->>'command_ref');END IF;
  RETURN s;
 END IF;
 s:=jsonb_build_object('provider',CASE WHEN c.kind LIKE 'binding_%' THEN 'gcp_vm_protocol_config' ELSE 'gcp_vm_command_metadata' END,'project_id','elaborate-haven-511518-a5','zone','europe-west1-b','vm_name',vm,'instance_id',instance_id);
 IF c.kind='binding_enroll' THEN s:=s||jsonb_build_object('ssh_host_key_sha256',p_arguments->'ssh'->>'host_key_sha256','winrm_certificate_sha256',p_arguments->'winrm'->>'certificate_sha256');END IF;
 IF c.kind='binding_revoke' THEN s:=s||jsonb_build_object('binding_id',p_arguments->>'binding_id');END IF;
 IF c.kind='command_register' THEN s:=s||jsonb_build_object('allowed_operation',coalesce(p_arguments->>'allowed_operation','cloud.vm.exec'),'recipe_sha256',p_arguments->>'recipe_sha256');END IF;
 RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.sandy_vm_protocol_scope(text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_vm_protocol_context(p_context jsonb,p_expected_state text DEFAULT 'admitted') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;r public.sandy_operation_registry;c public.sandy_vm_protocol_contracts;proof public.sandy_vm_protocol_admission_contexts;secret uuid;material text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_expected_state IS NULL OR p_expected_state NOT IN('admitted','consumed') OR jsonb_typeof(p_context) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'internal_service_transport_required';END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=(p_context->>'admission_id')::uuid FOR SHARE;
 SELECT * INTO c FROM public.sandy_vm_protocol_contracts WHERE operation=p_context->>'operation';
 SELECT * INTO r FROM public.sandy_operation_registry WHERE operation=p_context->>'operation' FOR SHARE;
 IF a.id IS NULL OR c.operation IS NULL OR a.actor_id IS DISTINCT FROM (p_context->>'actor_id')::uuid OR a.operation IS DISTINCT FROM c.operation
 OR a.state IS DISTINCT FROM p_expected_state OR a.principal_kind IS DISTINCT FROM 'auth_user' OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL OR a.customer_key_id IS NOT NULL
 OR a.expires_at<=clock_timestamp() OR NOT public.sandy_api_current_owner(a.actor_id)
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=a.actor_id AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false))
 OR a.request_id IS DISTINCT FROM (p_context->>'request_id')::uuid OR a.grant_id IS DISTINCT FROM (p_context->>'grant_id')::uuid
 OR p_context->'tenant_id' IS DISTINCT FROM 'null'::jsonb OR p_context->'credential_id' IS DISTINCT FROM 'null'::jsonb
 THEN RETURN jsonb_build_object('allowed',false,'error','actual_current_owner_admission_required','http_status',403);END IF;
 IF r.operation IS NULL OR r.handler IS DISTINCT FROM c.handler OR r.handler IS DISTINCT FROM 'sandy-vm-protocol-api'
 OR r.api_exposed IS DISTINCT FROM true OR r.verified IS DISTINCT FROM true OR r.permission_scope IS DISTINCT FROM c.permission_scope
 OR r.is_mutation IS DISTINCT FROM c.is_mutation OR a.is_mutation IS DISTINCT FROM c.is_mutation
 OR r.input_schema IS DISTINCT FROM c.input_schema OR r.output_schema IS DISTINCT FROM c.output_schema
 OR r.error_contract->>'contract_sha256' IS DISTINCT FROM c.contract_sha256 OR a.contract_sha256 IS DISTINCT FROM c.contract_sha256
 OR r.error_contract->>'requires_approval' IS DISTINCT FROM 'true' OR r.error_contract->>'requires_grant' IS DISTINCT FROM 'true'
 OR r.error_contract->>'requires_real_user_session' IS DISTINCT FROM 'true' OR r.error_contract->>'api_key_delegable' IS DISTINCT FROM 'false'
 OR a.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(c.operation)
 THEN RETURN jsonb_build_object('allowed',false,'error','exact_vm_protocol_contract_required','http_status',409);END IF;
 IF jsonb_typeof(p_context->'arguments') IS DISTINCT FROM 'object' OR NOT public.sandy_product_input_valid(c.input_schema,p_context->'arguments')
 OR p_context->>'canonical_arguments' IS NULL OR octet_length(p_context->>'canonical_arguments')>100000
 OR (p_context->>'canonical_arguments')::jsonb IS DISTINCT FROM p_context->'arguments'
 OR encode(extensions.digest(p_context->>'canonical_arguments','sha256'),'hex') IS DISTINCT FROM a.input_sha256
 OR p_context->>'canonical_scope' IS NULL OR octet_length(p_context->>'canonical_scope')>8000
 OR (p_context->>'canonical_scope')::jsonb IS DISTINCT FROM public.sandy_vm_protocol_scope(c.operation,p_context->'arguments',a.actor_id)
 OR encode(extensions.digest(p_context->>'canonical_scope','sha256'),'hex') IS DISTINCT FROM a.scope_sha256
 THEN RETURN jsonb_build_object('allowed',false,'error','exact_vm_input_and_scope_required','http_status',403);END IF;
 IF a.approval_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.sandy_api_mutation_approval_snapshots p JOIN public.sandy_deployment_jobs j ON j.id=p.job_id JOIN public.sandy_engineering_changes ch ON ch.id=p.engineering_change_id
 WHERE p.job_id=a.approval_id AND p.actor_id=a.actor_id AND p.operation=a.operation AND p.input_sha256=a.input_sha256 AND p.contract_sha256=a.contract_sha256 AND p.scope_sha256=a.scope_sha256
 AND a.declared_cost_units<=p.maximum_declared_cost_units AND j.status=CASE WHEN p_expected_state='admitted' THEN 'approved' ELSE 'running' END AND ch.status='approved' AND p.job_fingerprint_sha256=public.sandy_api_job_fingerprint(j))
 THEN RETURN jsonb_build_object('allowed',false,'error','immutable_vm_owner_approval_required','http_status',403);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-vm-admission:'||a.id::text,0));
 SELECT * INTO proof FROM public.sandy_vm_protocol_admission_contexts WHERE admission_id=a.id;
 IF proof.admission_id IS NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('sandy-vm-context-quota:'||a.actor_id::text,0));
  IF (SELECT count(*) FROM public.sandy_vm_protocol_admission_contexts p JOIN public.sandy_api_execution_admissions original ON original.id=p.admission_id WHERE original.actor_id=a.actor_id AND p.expires_at>clock_timestamp())>=128 THEN RAISE EXCEPTION 'private_vm_context_quota';END IF;
  SELECT vault.create_secret(p_context->>'canonical_arguments') INTO secret;
  INSERT INTO public.sandy_vm_protocol_admission_contexts(admission_id,arguments_vault_id,input_sha256,scope_canonical,expires_at) VALUES(a.id,secret,a.input_sha256,p_context->>'canonical_scope',a.expires_at);
 ELSE
  SELECT decrypted_secret INTO material FROM vault.decrypted_secrets WHERE id=proof.arguments_vault_id;
  IF material IS DISTINCT FROM p_context->>'canonical_arguments' OR proof.input_sha256 IS DISTINCT FROM a.input_sha256 OR proof.scope_canonical IS DISTINCT FROM p_context->>'canonical_scope' THEN RAISE EXCEPTION 'vm_context_immutable';END IF;
 END IF;
 RETURN jsonb_build_object('allowed',true,'admission_id',a.id,'reused',false);
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('allowed',false,'error','invalid_vm_protocol_context','http_status',400);
END $$;
REVOKE ALL ON FUNCTION public.sandy_vm_protocol_context(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_vm_protocol_context(jsonb,text) TO service_role;

CREATE FUNCTION public.sandy_vm_protocol_consumed(p_actor uuid,p_admission uuid,p_operation text,p_arguments_canonical text,p_scope_canonical text) RETURNS public.sandy_api_execution_admissions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;proof jsonb;
BEGIN
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR SHARE;
 proof:=public.sandy_vm_protocol_context(jsonb_build_object('admission_id',p_admission,'actor_id',p_actor,'operation',p_operation,'request_id',a.request_id,'grant_id',a.grant_id,'tenant_id',NULL,'credential_id',NULL,'arguments',p_arguments_canonical::jsonb,'canonical_arguments',p_arguments_canonical,'canonical_scope',p_scope_canonical),'consumed');
 IF proof->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'vm_scoped_consumed_approval_required';END IF;
 RETURN a;
END $$;
REVOKE ALL ON FUNCTION public.sandy_vm_protocol_consumed(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_vm_protocol_metadata(p_actor uuid,p_admission uuid,p_operation text,p_arguments_canonical text,p_scope_canonical text,p_proof jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;c public.sandy_vm_protocol_contracts;b public.sandy_vm_protocol_bindings;cmd public.sandy_vm_protocol_commands;
 args jsonb:=p_arguments_canonical::jsonb;vm text;instant timestamptz:=clock_timestamp();secret uuid;sha text;returned jsonb;
BEGIN
 a:=public.sandy_vm_protocol_consumed(p_actor,p_admission,p_operation,p_arguments_canonical,p_scope_canonical);
 IF EXISTS(SELECT 1 FROM public.sandy_vm_protocol_metadata_receipts WHERE admission_id=a.id) THEN RAISE EXCEPTION 'vm_metadata_replay_refused';END IF;
 SELECT * INTO c FROM public.sandy_vm_protocol_contracts WHERE operation=p_operation;
 vm:=args->>'vm_name';
 IF c.kind='binding_enroll' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('sandy-vm-binding:'||p_actor::text||':'||vm,0));
  IF NOT (args ? 'ssh' OR args ? 'winrm') OR p_proof->>'identity_pin_verified' IS DISTINCT FROM 'true' OR p_proof->>'vm_proof_sha256' IS NULL OR p_proof->>'vm_proof_sha256' !~ '^[a-f0-9]{64}$'
  OR vm='sandy-video' AND args ? 'winrm' OR vm='sandy-windows' AND args->'ssh'->>'mode'='oslogin'
  OR EXISTS(SELECT 1 FROM public.sandy_vm_protocol_bindings WHERE enrollment_admission_id=a.id) THEN RAISE EXCEPTION 'owner_verified_identity_pin_required';END IF;
  UPDATE public.sandy_vm_protocol_bindings SET revoked_at=instant WHERE actor_id=p_actor AND vm_name=vm AND revoked_at IS NULL;
  INSERT INTO public.sandy_vm_protocol_bindings(actor_id,vm_name,instance_id,configuration,enrollment_admission_id,enrollment_arguments_canonical,vm_proof_sha256,created_at)
  VALUES(p_actor,vm,CASE vm WHEN 'sandy-video' THEN '6831598645020395570' ELSE '8120150462304566315' END,args-'vm_name',a.id,p_arguments_canonical,p_proof->>'vm_proof_sha256',instant) RETURNING * INTO b;
 ELSIF c.kind IN('binding_get','binding_revoke') THEN
  b:=public.sandy_vm_protocol_current_binding(p_actor,vm);
  IF b.id IS NULL OR c.kind='binding_revoke' AND b.id IS DISTINCT FROM (args->>'binding_id')::uuid THEN RAISE EXCEPTION 'current_owner_binding_required';END IF;
  IF c.kind='binding_revoke' THEN UPDATE public.sandy_vm_protocol_bindings SET revoked_at=instant WHERE id=b.id RETURNING * INTO b;END IF;
 ELSIF c.kind='command_register' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('sandy-vm-private-command:'||p_actor::text,0));
  IF EXISTS(SELECT 1 FROM public.sandy_vm_protocol_commands WHERE registration_admission_id=a.id) THEN RAISE EXCEPTION 'command_registration_replay_refused';END IF;
  IF (SELECT count(*) FROM public.sandy_vm_protocol_commands WHERE actor_id=p_actor AND revoked_at IS NULL AND expires_at>instant)>=32 THEN RAISE EXCEPTION 'private_command_quota';END IF;
  IF coalesce(args->>'allowed_operation','cloud.vm.exec')<>'cloud.vm.exec' AND (args->>'recipe_sha256' IS NULL OR vm<>'sandy-video') THEN RAISE EXCEPTION 'immutable_video_recipe_required';END IF;
  sha:=encode(extensions.digest(args->>'command','sha256'),'hex');
  SELECT vault.create_secret(args->>'command') INTO secret;
  INSERT INTO public.sandy_vm_protocol_commands(actor_id,vm_name,allowed_operation,recipe_sha256,command_sha256,vault_secret_id,registration_admission_id,created_at,expires_at)
  VALUES(p_actor,vm,coalesce(args->>'allowed_operation','cloud.vm.exec'),args->>'recipe_sha256',sha,secret,a.id,instant,instant+make_interval(secs=>coalesce((args->>'expires_in_seconds')::integer,600))) RETURNING * INTO cmd;
 ELSIF c.kind IN('command_get','command_revoke') THEN
  SELECT * INTO cmd FROM public.sandy_vm_protocol_commands WHERE id=(args->>'command_ref')::uuid AND actor_id=p_actor AND revoked_at IS NULL AND expires_at>instant FOR UPDATE;
  IF cmd.id IS NULL THEN RAISE EXCEPTION 'current_private_command_required';END IF;
  IF c.kind='command_revoke' THEN UPDATE public.sandy_vm_protocol_commands SET revoked_at=instant WHERE id=cmd.id RETURNING * INTO cmd;DELETE FROM vault.secrets WHERE id=cmd.vault_secret_id;END IF;
 ELSE RAISE EXCEPTION 'protocol_metadata_operation_required';END IF;
 IF b.id IS NOT NULL THEN returned:=jsonb_build_object('binding_id',b.id,'vm_name',b.vm_name,'instance_id',b.instance_id,'state',CASE WHEN b.revoked_at IS NULL THEN 'owner_pinned' ELSE 'revoked' END,'ssh_host_key_sha256',b.configuration->'ssh'->>'host_key_sha256','winrm_certificate_sha256',b.configuration->'winrm'->>'certificate_sha256','enrollment_admission_id',b.enrollment_admission_id,'vm_proof_sha256',b.vm_proof_sha256);
 ELSE returned:=jsonb_build_object('command_ref',cmd.id,'vm_name',cmd.vm_name,'instance_id',CASE cmd.vm_name WHEN 'sandy-video' THEN '6831598645020395570' ELSE '8120150462304566315' END,'command_sha256',cmd.command_sha256,'allowed_operation',cmd.allowed_operation,'recipe_sha256',cmd.recipe_sha256,'expires_at',to_char(cmd.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'state',CASE WHEN cmd.revoked_at IS NULL THEN 'registered' ELSE 'revoked' END);END IF;
 INSERT INTO public.sandy_vm_protocol_metadata_receipts(admission_id,result) VALUES(a.id,returned);
 RETURN returned;
END $$;
REVOKE ALL ON FUNCTION public.sandy_vm_protocol_metadata(uuid,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_vm_protocol_metadata(uuid,uuid,text,text,text,jsonb) TO service_role;

CREATE FUNCTION public.sandy_vm_protocol_resolve_execution(p_actor uuid,p_admission uuid,p_operation text,p_arguments_canonical text,p_scope_canonical text,p_expected_command_sha256 text DEFAULT NULL,p_expected_recipe_sha256 text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;c public.sandy_vm_protocol_contracts;b public.sandy_vm_protocol_bindings;cmd public.sandy_vm_protocol_commands;registration public.sandy_api_execution_admissions;
 args jsonb:=p_arguments_canonical::jsonb;vm text;command text;sha text;recipe text;
BEGIN
 a:=public.sandy_vm_protocol_consumed(p_actor,p_admission,p_operation,p_arguments_canonical,p_scope_canonical);
 SELECT * INTO c FROM public.sandy_vm_protocol_contracts WHERE operation=p_operation;
 IF c.kind NOT IN('ssh','winrm','registered_exec') OR c.kind IS NULL THEN RAISE EXCEPTION 'protocol_execution_operation_required';END IF;
 vm:=CASE WHEN c.kind='registered_exec' THEN args->>'instance' ELSE args->>'vm_name' END;
 b:=public.sandy_vm_protocol_current_binding(p_actor,vm);
 IF b.id IS NULL THEN RAISE EXCEPTION 'owner_enrolled_binding_required';END IF;
 IF c.kind='registered_exec' THEN
  SELECT * INTO cmd FROM public.sandy_vm_protocol_commands WHERE id=(args->>'command_ref')::uuid FOR SHARE;
  SELECT * INTO registration FROM public.sandy_api_execution_admissions WHERE id=cmd.registration_admission_id FOR SHARE;
  IF cmd.id IS NULL OR cmd.actor_id IS DISTINCT FROM p_actor OR cmd.vm_name IS DISTINCT FROM vm OR cmd.allowed_operation IS DISTINCT FROM p_operation OR cmd.revoked_at IS NOT NULL OR cmd.expires_at<=clock_timestamp()
  OR registration.actor_id IS DISTINCT FROM p_actor OR registration.operation IS DISTINCT FROM 'cloud.vm.commands.register' OR registration.state IS DISTINCT FROM 'succeeded'
  OR registration.credential_id IS NOT NULL OR registration.tenant_id IS NOT NULL OR registration.customer_key_id IS NOT NULL OR registration.approval_id IS NULL
  OR registration.contract_sha256 IS DISTINCT FROM (SELECT contract_sha256 FROM public.sandy_vm_protocol_contracts WHERE operation='cloud.vm.commands.register')
  OR registration.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(registration.operation)
  THEN RAISE EXCEPTION 'immutable_same_actor_vm_command_required';END IF;
  IF p_operation LIKE 'video.%' AND (p_expected_recipe_sha256 IS NULL OR p_expected_command_sha256 IS NULL OR cmd.recipe_sha256 IS DISTINCT FROM p_expected_recipe_sha256) THEN RAISE EXCEPTION 'trusted_video_recipe_required';END IF;
  SELECT decrypted_secret INTO command FROM vault.decrypted_secrets WHERE id=cmd.vault_secret_id;sha:=cmd.command_sha256;recipe:=cmd.recipe_sha256;
 ELSE command:=args->>'command';sha:=encode(extensions.digest(command,'sha256'),'hex');END IF;
 IF command IS NULL OR char_length(command) NOT BETWEEN 1 AND 4096 OR encode(extensions.digest(command,'sha256'),'hex') IS DISTINCT FROM sha
 OR p_expected_command_sha256 IS NOT NULL AND p_expected_command_sha256 IS DISTINCT FROM sha OR p_expected_recipe_sha256 IS NOT NULL AND p_expected_recipe_sha256 IS DISTINCT FROM recipe
 THEN RAISE EXCEPTION 'registered_vm_command_integrity_required';END IF;
 RETURN jsonb_build_object('vm_name',vm,'command',command,'command_sha256',sha,'recipe_sha256',recipe,'binding',b.configuration||jsonb_build_object('verified',true,'instance_id',b.instance_id,'version',b.id));
END $$;
REVOKE ALL ON FUNCTION public.sandy_vm_protocol_resolve_execution(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_vm_protocol_resolve_execution(uuid,uuid,text,text,text,text,text) TO service_role;

CREATE FUNCTION public.sandy_vm_protocol_claim_execution(p_actor uuid,p_admission uuid,p_operation text,p_arguments_canonical text,p_scope_canonical text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resolved jsonb;
BEGIN
 resolved:=public.sandy_vm_protocol_resolve_execution(p_actor,p_admission,p_operation,p_arguments_canonical,p_scope_canonical);
 INSERT INTO public.sandy_vm_protocol_attempts(admission_id,actor_id,binding_id,command_sha256) VALUES(p_admission,p_actor,(resolved->'binding'->>'version')::uuid,resolved->>'command_sha256');
 RETURN jsonb_build_object('claimed',true);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'vm_execution_attempt_replay_refused';
END $$;
REVOKE ALL ON FUNCTION public.sandy_vm_protocol_claim_execution(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_vm_protocol_claim_execution(uuid,uuid,text,text,text) TO service_role;

CREATE FUNCTION public.sandy_vm_protocol_save_result(p_actor uuid,p_admission uuid,p_operation text,p_arguments_canonical text,p_scope_canonical text,p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;resolved jsonb;bytes bytea;payload jsonb;secret uuid;output public.sandy_vm_protocol_outputs;instant timestamptz:=clock_timestamp();expected jsonb;meta jsonb;
BEGIN
 a:=public.sandy_vm_protocol_consumed(p_actor,p_admission,p_operation,p_arguments_canonical,p_scope_canonical);
 -- No video label may bypass its recipe resolver through result custody.
 IF p_operation LIKE 'video.%' THEN RAISE EXCEPTION 'reviewed_video_custody_extension_required';END IF;
 resolved:=public.sandy_vm_protocol_resolve_execution(p_actor,p_admission,p_operation,p_arguments_canonical,p_scope_canonical);
 IF NOT EXISTS(SELECT 1 FROM public.sandy_vm_protocol_attempts WHERE admission_id=a.id AND actor_id=p_actor AND binding_id=(resolved->'binding'->>'version')::uuid AND command_sha256=resolved->>'command_sha256') THEN RAISE EXCEPTION 'vm_claimed_execution_required';END IF;
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_result))<>5 OR length(p_result->>'payload_base64')>133336
 OR p_result->>'payload_sha256' IS NULL OR p_result->>'payload_sha256' !~ '^[a-f0-9]{64}$' OR p_result->>'command_sha256' IS DISTINCT FROM resolved->>'command_sha256'
 THEN RAISE EXCEPTION 'vm_output_custody_integrity_required';END IF;
 bytes:=decode(p_result->>'payload_base64','base64');
 IF octet_length(bytes) NOT BETWEEN 1 AND 100000 OR replace(encode(bytes,'base64'),E'\n','') IS DISTINCT FROM p_result->>'payload_base64'
 OR (p_result->>'byte_length')::integer IS DISTINCT FROM octet_length(bytes) OR encode(extensions.digest(bytes,'sha256'),'hex') IS DISTINCT FROM p_result->>'payload_sha256'
 THEN RAISE EXCEPTION 'vm_output_custody_integrity_required';END IF;
 payload:=convert_from(bytes,'UTF8')::jsonb;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(payload))<>5
 OR payload->>'protocol' NOT IN('ssh2','winrm_https') OR payload->>'protocol' IS NULL OR payload->>'command_sha256' IS DISTINCT FROM resolved->>'command_sha256'
 OR (payload->>'exit_code')::bigint NOT BETWEEN 0 AND 2147483647 OR payload->>'exit_code' IS NULL
 OR payload->>'stdout_base64' IS NULL OR payload->>'stderr_base64' IS NULL
 OR replace(encode(decode(payload->>'stdout_base64','base64'),'base64'),E'\n','') IS DISTINCT FROM payload->>'stdout_base64'
 OR replace(encode(decode(payload->>'stderr_base64','base64'),'base64'),E'\n','') IS DISTINCT FROM payload->>'stderr_base64'
 OR octet_length(decode(payload->>'stdout_base64','base64'))+octet_length(decode(payload->>'stderr_base64','base64'))>65536
 THEN RAISE EXCEPTION 'vm_output_custody_integrity_required';END IF;
 meta:=p_result->'public_metadata';
 expected:=jsonb_build_object('vm_name',resolved->>'vm_name','instance_id',resolved->'binding'->>'instance_id','protocol',payload->>'protocol','exit_code',(payload->>'exit_code')::integer,'command_succeeded',(payload->>'exit_code')::integer=0,'effect_confirmed',false,'command_sha256',resolved->>'command_sha256',
 'stdout_bytes',octet_length(decode(payload->>'stdout_base64','base64')),'stdout_sha256',encode(extensions.digest(decode(payload->>'stdout_base64','base64'),'sha256'),'hex'),'stderr_bytes',octet_length(decode(payload->>'stderr_base64','base64')),'stderr_sha256',encode(extensions.digest(decode(payload->>'stderr_base64','base64'),'sha256'),'hex'),
 'binding_id',resolved->'binding'->>'version','vm_proof_sha256',meta->>'vm_proof_sha256','credential_cleanup_verified',CASE WHEN resolved->'binding'->'ssh'->>'mode'='oslogin' THEN true ELSE NULL END,'shell_deleted',CASE WHEN payload->>'protocol'='winrm_https' THEN true ELSE NULL END);
 IF meta IS DISTINCT FROM expected OR meta->>'vm_proof_sha256' IS NULL OR meta->>'vm_proof_sha256' !~ '^[a-f0-9]{64}$' OR payload->>'protocol' IS DISTINCT FROM (CASE WHEN p_scope_canonical::jsonb->>'protocol'='ssh' THEN 'ssh2' ELSE 'winrm_https' END) THEN RAISE EXCEPTION 'vm_output_metadata_integrity_required';END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_vm_protocol_outputs WHERE admission_id=a.id) THEN RAISE EXCEPTION 'vm_output_capture_replay_refused';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-vm-private-output:'||p_actor::text,0));
 IF (SELECT count(*) FROM public.sandy_vm_protocol_outputs WHERE actor_id=p_actor AND expires_at>instant)>=32 THEN RAISE EXCEPTION 'private_output_quota';END IF;
 SELECT vault.create_secret(p_result->>'payload_base64') INTO secret;
 INSERT INTO public.sandy_vm_protocol_outputs(actor_id,admission_id,operation,vm_name,binding_id,command_sha256,input_sha256,scope_sha256,payload_sha256,byte_length,vault_secret_id,receipt_metadata,created_at,expires_at)
 VALUES(p_actor,a.id,p_operation,resolved->>'vm_name',(resolved->'binding'->>'version')::uuid,resolved->>'command_sha256',a.input_sha256,a.scope_sha256,p_result->>'payload_sha256',octet_length(bytes),secret,meta,instant,instant+interval '10 minutes') RETURNING * INTO output;
 RETURN jsonb_build_object('custody_id',output.id,'sha256',output.payload_sha256,'byte_length',output.byte_length);
END $$;
REVOKE ALL ON FUNCTION public.sandy_vm_protocol_save_result(uuid,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_vm_protocol_save_result(uuid,uuid,text,text,text,jsonb) TO service_role;

-- SSH/WSMan have no HTTP receipt. Generic core finish intentionally refuses
-- mutation->succeeded, so completion requires this exact private native readback.
-- No existing core receipt function or provider HTTP status is altered/invented.
CREATE FUNCTION public.sandy_vm_protocol_finish(p_admission_id uuid,p_outcome text,p_result_sha256 text,p_output_canonical text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;c public.sandy_vm_protocol_contracts;proof public.sandy_vm_protocol_admission_contexts;arguments text;result jsonb;expected jsonb;outdoc jsonb;o public.sandy_vm_protocol_outputs;material text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_outcome IS NULL OR p_outcome NOT IN('succeeded','failed','unknown') OR p_result_sha256 IS NULL OR p_result_sha256 !~ '^[a-f0-9]{64}$' OR p_output_canonical IS NULL OR octet_length(p_output_canonical)>12000 OR encode(extensions.digest(p_output_canonical,'sha256'),'hex') IS DISTINCT FROM p_result_sha256 THEN RAISE EXCEPTION 'protocol_exact_receipt_required';END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission_id FOR UPDATE;
 SELECT * INTO c FROM public.sandy_vm_protocol_contracts WHERE operation=a.operation;
 IF a.id IS NULL OR c.operation IS NULL THEN RAISE EXCEPTION 'protocol_exact_receipt_required';END IF;
 IF a.state IN('succeeded','failed','unknown') THEN
  IF a.state=p_outcome AND a.result_sha256=p_result_sha256 THEN RETURN jsonb_build_object('ok',true,'admission_id',a.id,'state',a.state,'reused',true);END IF;
  RAISE EXCEPTION 'protocol_receipt_conflict';
 END IF;
 SELECT * INTO proof FROM public.sandy_vm_protocol_admission_contexts WHERE admission_id=a.id;
 SELECT decrypted_secret INTO arguments FROM vault.decrypted_secrets WHERE id=proof.arguments_vault_id;
 IF arguments IS NULL THEN RAISE EXCEPTION 'protocol_current_scoped_context_required';END IF;
 PERFORM public.sandy_vm_protocol_consumed(a.actor_id,a.id,a.operation,arguments,proof.scope_canonical);
 outdoc:=p_output_canonical::jsonb;
 -- Uncertainty is terminal pending reconciliation; a captured result must never
 -- fall through the native mutation-success path under an unknown outcome.
 IF p_outcome='unknown' AND outdoc ? 'result' THEN
  RAISE EXCEPTION 'native_protocol_unknown_result_forbidden';
 END IF;
 IF p_outcome IN('failed','unknown') AND NOT outdoc ? 'result' THEN
  RETURN public.sandy_api_finish_execution(a.id,p_outcome,NULL,NULL,p_result_sha256);
 END IF;
 IF c.kind IN('ssh','winrm','registered_exec') THEN
  SELECT * INTO o FROM public.sandy_vm_protocol_outputs WHERE admission_id=a.id AND actor_id=a.actor_id FOR SHARE;
  SELECT decrypted_secret INTO material FROM vault.decrypted_secrets WHERE id=o.vault_secret_id;
  IF o.id IS NULL OR o.expires_at<=clock_timestamp() OR o.operation IS DISTINCT FROM a.operation OR o.input_sha256 IS DISTINCT FROM a.input_sha256 OR o.scope_sha256 IS DISTINCT FROM a.scope_sha256
  OR material IS NULL OR encode(extensions.digest(decode(material,'base64'),'sha256'),'hex') IS DISTINCT FROM o.payload_sha256 THEN RAISE EXCEPTION 'native_protocol_output_readback_required';END IF;
  result:=o.receipt_metadata||jsonb_build_object('custody_id',o.id,'output_sha256',o.payload_sha256);
  IF (result->>'command_succeeded')::boolean IS DISTINCT FROM (p_outcome='succeeded') THEN RAISE EXCEPTION 'native_protocol_exit_outcome_required';END IF;
 ELSE
  IF p_outcome IS DISTINCT FROM 'succeeded' THEN RAISE EXCEPTION 'native_protocol_metadata_outcome_required';END IF;
  SELECT m.result INTO result FROM public.sandy_vm_protocol_metadata_receipts m WHERE m.admission_id=a.id;
  IF result IS NULL THEN RAISE EXCEPTION 'native_protocol_metadata_readback_required';END IF;
 END IF;
 expected:=jsonb_build_object('ok',p_outcome='succeeded','operation',a.operation,'contract_version','1.0.0','request_state',CASE WHEN p_outcome='failed' THEN 'failed' WHEN a.is_mutation THEN 'completed' ELSE 'observed' END,'executed',true,'admission_id',a.id,'result',result,'reconciliation_required',false);
 IF p_outcome='failed' THEN expected:=expected||jsonb_build_object('error','remote_command_failed');END IF;
 IF outdoc IS DISTINCT FROM expected THEN RAISE EXCEPTION 'native_protocol_exact_output_required';END IF;
 IF NOT a.is_mutation OR p_outcome='failed' THEN RETURN public.sandy_api_finish_execution(a.id,p_outcome,NULL,NULL,p_result_sha256);END IF;
 UPDATE public.sandy_api_execution_admissions SET state='succeeded',finished_at=clock_timestamp(),provider_http_status=NULL,provider_request_id_sha256=NULL,result_sha256=p_result_sha256 WHERE id=a.id;
 UPDATE public.sandy_deployment_jobs SET status='succeeded',result=jsonb_build_object('source','sandy-vm-protocol-api','admission_id',a.id,'result_sha256',p_result_sha256,'native_readback',true,'provider_effect_confirmed',false),error=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=a.approval_id AND status='running';
 PERFORM public.sandy_api_append_audit(a.actor_id,a.operation,a.request_id,NULL,a.id,'execution','succeeded',a.input_sha256,p_result_sha256,NULL,NULL);
 RETURN jsonb_build_object('ok',true,'admission_id',a.id,'state','succeeded','reused',false,'reconciliation_required',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_vm_protocol_finish(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_vm_protocol_finish(uuid,text,text,text) TO service_role;

CREATE FUNCTION public.sandy_vm_protocol_cleanup() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ids uuid[];n integer:=0;
BEGIN
 SELECT array_agg(vault_secret_id) INTO ids FROM (SELECT vault_secret_id FROM public.sandy_vm_protocol_outputs WHERE expires_at<=clock_timestamp() LIMIT 100 FOR UPDATE SKIP LOCKED)s;
 DELETE FROM vault.secrets WHERE id=ANY(ids);DELETE FROM public.sandy_vm_protocol_outputs WHERE vault_secret_id=ANY(ids);GET DIAGNOSTICS n=ROW_COUNT;
 SELECT array_agg(vault_secret_id) INTO ids FROM (SELECT vault_secret_id FROM public.sandy_vm_protocol_commands WHERE expires_at<=clock_timestamp() OR revoked_at IS NOT NULL LIMIT 100 FOR UPDATE SKIP LOCKED)s;
 DELETE FROM vault.secrets WHERE id=ANY(ids);DELETE FROM public.sandy_vm_protocol_commands WHERE vault_secret_id=ANY(ids);
 SELECT array_agg(arguments_vault_id) INTO ids FROM (SELECT arguments_vault_id FROM public.sandy_vm_protocol_admission_contexts WHERE expires_at<=clock_timestamp() LIMIT 100 FOR UPDATE SKIP LOCKED)s;
 DELETE FROM vault.secrets WHERE id=ANY(ids);DELETE FROM public.sandy_vm_protocol_admission_contexts WHERE arguments_vault_id=ANY(ids);
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.sandy_vm_protocol_cleanup() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.sandy_credential_resolve_consumer(p_consumer text,p_actor uuid,p_admission uuid,p_operation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $consumer$
DECLARE admission public.sandy_api_execution_admissions; credential public.sandy_api_credentials;
 entry public.sandy_operation_registry; binding public.sandy_credential_consumer_bindings;
 target public.sandy_credential_targets; version public.sandy_credential_versions; previous public.sandy_credential_consumer_access;
 operation_target public.sandy_credential_targets; expected_consumer text; material text; target_document jsonb;
BEGIN
 IF p_consumer IS NULL OR p_consumer NOT IN ('supabase_management','github_api','gcp_access_token')
 OR p_actor IS NULL OR p_admission IS NULL OR p_operation IS NULL OR p_operation !~ '^[a-z][a-z0-9_.-]{2,100}$' THEN RAISE EXCEPTION 'consumer_execution_context_invalid'; END IF;
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR SHARE;
 IF admission.id IS NULL OR admission.actor_id IS DISTINCT FROM p_actor OR admission.operation IS DISTINCT FROM p_operation OR admission.state IS DISTINCT FROM 'consumed'
 OR admission.tenant_id IS NOT NULL OR admission.expires_at<=clock_timestamp() OR NOT public.sandy_api_current_owner(p_actor) THEN RAISE EXCEPTION 'consumer_scoped_admission_required'; END IF;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation FOR SHARE;
 IF entry.operation IS NULL OR entry.api_exposed IS DISTINCT FROM true OR public.sandy_api_registry_revision(p_operation) IS DISTINCT FROM admission.registry_revision_sha256
 OR entry.handler IS NULL OR entry.handler NOT IN ('sandy-provider-operation-api','sandy-credential-lifecycle-api','sandy-database-operation-api','sandy-guest-operation-api','sandy-provider-read-api','sandy-provider-gap-api','sandy-provider-supplement-api','sandy-provider-sensitive-api','sandy-provider-bound-api','sandy-legacy-compatibility-api','sandy-vm-protocol-api') THEN RAISE EXCEPTION 'consumer_current_contract_required'; END IF;
 IF entry.handler='sandy-legacy-compatibility-api' THEN
  IF (SELECT consumer FROM public.sandy_legacy_provider_contracts WHERE operation=p_operation) IS DISTINCT FROM p_consumer
  OR public.sandy_legacy_provider_context(jsonb_build_object('operation',p_operation,'actor_id',p_actor,'admission_id',p_admission,
   'request_id',admission.request_id,'grant_id',admission.grant_id,'tenant_id',NULL,'credential_id',NULL),'consumed')->>'allowed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'consumer_scoped_admission_required';END IF;
 END IF;
 IF entry.handler='sandy-vm-protocol-api' THEN
  IF p_consumer IS DISTINCT FROM 'gcp_access_token' OR NOT EXISTS(SELECT 1 FROM public.sandy_vm_protocol_contracts WHERE operation=p_operation AND kind IN('ssh','winrm','registered_exec','binding_enroll'))
  OR NOT EXISTS(SELECT 1 FROM public.sandy_vm_protocol_admission_contexts proof JOIN vault.decrypted_secrets material ON material.id=proof.arguments_vault_id WHERE proof.admission_id=admission.id AND proof.input_sha256=admission.input_sha256 AND proof.expires_at>clock_timestamp() AND encode(extensions.digest(material.decrypted_secret,'sha256'),'hex')=proof.input_sha256 AND public.sandy_vm_protocol_context(jsonb_build_object('actor_id',p_actor,'admission_id',p_admission,'operation',p_operation,'request_id',admission.request_id,'grant_id',admission.grant_id,'tenant_id',NULL,'credential_id',NULL,'arguments',material.decrypted_secret::jsonb,'canonical_arguments',material.decrypted_secret,'canonical_scope',proof.scope_canonical),'consumed')->>'allowed'='true')
  THEN RAISE EXCEPTION 'consumer_scoped_admission_required';END IF;
 END IF;
 IF admission.credential_id IS NOT NULL THEN
  SELECT * INTO credential FROM public.sandy_api_credentials WHERE id=admission.credential_id FOR SHARE;
  IF credential.id IS NULL OR credential.principal_id IS DISTINCT FROM p_actor OR credential.tenant_id IS NOT NULL OR credential.revoked_at IS NOT NULL OR credential.expires_at<=clock_timestamp()
  OR NOT p_operation=ANY(credential.allowed_operations) OR entry.is_mutation OR entry.error_contract->>'api_key_delegable' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'consumer_delegated_scope_refused'; END IF;
 END IF;
 -- Original metadata reads have gateway-owned grants. They must first claim
 -- the exact versioned argument context against that actual consumed admission.
 IF entry.handler='sandy-provider-read-api' AND (
  admission.is_mutation OR entry.is_mutation OR entry.permission_scope IS DISTINCT FROM 'infrastructure:read'
  OR admission.scope_sha256 IS DISTINCT FROM encode(extensions.digest('{"permission_scope":"infrastructure:read","sandy_project_ref":"zmqlyygzqoidkcwdysok"}','sha256'),'hex')
  OR NOT EXISTS(SELECT 1 FROM public.sandy_provider_read_admission_proofs proof WHERE proof.admission_id=admission.id
   AND proof.actor_id=admission.actor_id AND proof.credential_id IS NOT DISTINCT FROM admission.credential_id
   AND proof.request_id=admission.request_id AND proof.grant_id=admission.grant_id AND proof.operation=admission.operation
   AND proof.input_sha256=admission.input_sha256 AND proof.scope_sha256=admission.scope_sha256
   AND proof.registry_revision_sha256=admission.registry_revision_sha256)) THEN RAISE EXCEPTION 'consumer_scoped_admission_required'; END IF;
 expected_consumer:=CASE WHEN p_operation='cloud.vm.exec' AND entry.handler='sandy-vm-protocol-api' THEN 'gcp_access_token' WHEN p_operation LIKE 'supabase.%' THEN 'supabase_management' WHEN p_operation LIKE 'github.%' THEN 'github_api' WHEN p_operation LIKE 'gcp.%' THEN 'gcp_access_token' END;
 IF entry.handler='sandy-credential-lifecycle-api' THEN
  SELECT * INTO operation_target FROM public.sandy_credential_targets WHERE scope_sha256=admission.scope_sha256 AND enabled AND verified LIMIT 1;
  expected_consumer:=CASE operation_target.provider WHEN 'supabase_edge_secret' THEN 'supabase_management' WHEN 'github_actions_secret' THEN 'github_api' WHEN 'gcp_secret' THEN 'gcp_access_token' WHEN 'gcp_service_account_key' THEN 'gcp_access_token' END;
 END IF;
 IF expected_consumer IS DISTINCT FROM p_consumer THEN RAISE EXCEPTION 'consumer_provider_scope_mismatch'; END IF;
 SELECT * INTO binding FROM public.sandy_credential_consumer_bindings WHERE consumer=p_consumer FOR SHARE;
 IF binding.consumer IS NULL THEN RETURN jsonb_build_object('ok',true,'source','existing_configuration','active_version_id',NULL); END IF;
 SELECT * INTO target FROM public.sandy_credential_targets WHERE id=binding.target_id FOR SHARE;
 IF target.id IS NULL THEN RAISE EXCEPTION 'consumer_configured_target_missing'; END IF;
 IF target.active_version_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.sandy_credential_consumer_access WHERE target_id=target.id)
  OR EXISTS(SELECT 1 FROM public.sandy_credential_rotations WHERE target_id=target.id AND state='activated') THEN RAISE EXCEPTION 'consumer_active_pointer_removed'; END IF;
  RETURN jsonb_build_object('ok',true,'source','existing_configuration','active_version_id',NULL);
 END IF;
 IF NOT binding.enabled OR NOT binding.verified OR NOT target.enabled OR NOT target.verified OR target.config_sha256 IS DISTINCT FROM binding.target_config_sha256
 OR NOT public.sandy_credential_consumer_target_matches(p_consumer,target) THEN RAISE EXCEPTION 'consumer_active_binding_refused'; END IF;
 SELECT * INTO version FROM public.sandy_credential_versions WHERE id=target.active_version_id AND target_id=target.id FOR SHARE;
 IF version.id IS NULL OR version.state IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'consumer_active_version_refused'; END IF;
 -- Active versions must retain the prior custody proof, including a real
 -- successful verification admission with a digest-bound observation.
 IF NOT EXISTS(SELECT 1 FROM public.sandy_credential_rotations rotation JOIN public.sandy_api_execution_admissions proof ON proof.id=rotation.verification_admission_id
  WHERE rotation.target_id=target.id AND rotation.staged_version_id=version.id AND rotation.state='activated'
  AND rotation.target_config_sha256=target.config_sha256 AND proof.operation='system.credentials.provider.verify' AND proof.state='succeeded'
  AND proof.actor_id=rotation.actor_id AND proof.credential_id IS NULL AND proof.approval_id IS NOT NULL AND proof.scope_sha256=target.scope_sha256
  AND proof.result_sha256=encode(extensions.digest(rotation.verification_canonical,'sha256'),'hex')
  AND rotation.verification_canonical::jsonb=rotation.verification_evidence
  AND rotation.verification_evidence->>'rotation_id'=rotation.id::text AND rotation.verification_evidence->>'target_id'=target.id::text
  AND rotation.verification_evidence->>'target_config_sha256'=target.config_sha256
  AND rotation.verification_evidence->>'provider_verified'='true' AND rotation.verification_evidence->>'material_sha256'=version.material_sha256) THEN RAISE EXCEPTION 'consumer_active_readback_required'; END IF;
 SELECT * INTO previous FROM public.sandy_credential_consumer_access WHERE admission_id=p_admission AND consumer=p_consumer;
 IF previous.admission_id IS NOT NULL AND (previous.actor_id IS DISTINCT FROM p_actor OR previous.target_id IS DISTINCT FROM target.id OR previous.version_id IS DISTINCT FROM version.id OR previous.material_sha256 IS DISTINCT FROM version.material_sha256) THEN RAISE EXCEPTION 'consumer_pointer_changed_during_execution'; END IF;
 SELECT decrypted_secret INTO material FROM vault.decrypted_secrets WHERE id=version.vault_secret_id;
 IF material IS NULL OR octet_length(material) NOT BETWEEN 1 AND 65536 OR encode(extensions.digest(material,'sha256'),'hex') IS DISTINCT FROM version.material_sha256 THEN RAISE EXCEPTION 'consumer_material_integrity_failed'; END IF;
 INSERT INTO public.sandy_credential_consumer_access(admission_id,consumer,actor_id,target_id,version_id,material_sha256)
 VALUES(p_admission,p_consumer,p_actor,target.id,version.id,version.material_sha256) ON CONFLICT DO NOTHING;
 IF previous.admission_id IS NULL THEN PERFORM public.sandy_api_append_audit(p_actor,p_operation,admission.request_id,admission.credential_id,p_admission,'credential_consumer','resolved',admission.input_sha256,
  encode(extensions.digest(jsonb_build_object('consumer',p_consumer,'target_id',target.id,'version_id',version.id,'material_sha256',version.material_sha256)::text,'sha256'),'hex')); END IF;
 target_document:=jsonb_build_object('id',target.id,'provider',target.provider,'resource',target.resource,'enabled',target.enabled,'verified',target.verified,'active_version_id',target.active_version_id,'scope_sha256',target.scope_sha256,'config_sha256',target.config_sha256);
 RETURN jsonb_build_object('ok',true,'source','vault_active','consumer',p_consumer,'admission_id',p_admission,'active_version_id',version.id,'target',target_document,'value',material,'material_sha256',version.material_sha256,'provider_version_id',version.provider_version_id);
END $consumer$;
DO $cron$ BEGIN IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN PERFORM cron.schedule('sandy-vm-protocol-private-ttl','* * * * *','SELECT public.sandy_vm_protocol_cleanup()');END IF;END $cron$;
COMMIT;
