BEGIN;
DO $$ BEGIN
 IF (SELECT encode(extensions.digest(pg_get_constraintdef(oid),'sha256'),'hex')
  FROM pg_constraint WHERE conrelid='public.sandy_engineering_operation_classes'::regclass
  AND conname='sandy_engineering_operation_classes_operation_class_check')
  IS DISTINCT FROM '30971aacc29f7e69365a8851eee92b2da1e850121f29151cd18927f56616ec96' THEN
  RAISE EXCEPTION 'operation_class_constraint_preimage_changed';
 END IF;
END $$;
ALTER TABLE public.sandy_engineering_operation_classes
 DROP CONSTRAINT sandy_engineering_operation_classes_operation_class_check;
ALTER TABLE public.sandy_engineering_operation_classes
 ADD CONSTRAINT sandy_engineering_operation_classes_operation_class_check CHECK(operation_class IN(
 'restricted','metadata_read','source_read','code_write','git_write','pull_request_write',
 'guest_read','guest_files_write','guest_services_write','guest_packages_write'));
-- Typed existing guest operations only. No delegation is established by this
-- migration; enrollment, IAM, reboot, firewall and native commands stay outside
-- these routine classes. A restricted administrator must install a policy.
CREATE FUNCTION public.sandy_engineering_computer_policy_valid(p_policy jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE computer jsonb;name text;config jsonb;entry public.sandy_guest_enrollments;v jsonb;
BEGIN
 IF jsonb_typeof(p_policy) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 computer:=p_policy->'computer';
 IF computer IS NULL THEN
  RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_policy->'classes'->'gcp') c
   WHERE c IN('guest_read','guest_files_write','guest_services_write','guest_packages_write'));
 END IF;
 IF jsonb_typeof(computer) IS DISTINCT FROM 'object'
 OR (computer-'targets')<>'{}'::jsonb
 OR jsonb_typeof(computer->'targets') IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM jsonb_object_keys(computer->'targets')) NOT BETWEEN 1 AND 2
 THEN RETURN false;END IF;
 FOR name,config IN SELECT * FROM jsonb_each(computer->'targets') LOOP
  SELECT * INTO entry FROM public.sandy_guest_enrollments WHERE vm_name=name;
  IF entry.vm_name IS NULL OR jsonb_typeof(config) IS DISTINCT FROM 'object'
  OR (config-ARRAY['project_id','zone','instance_id','file_prefixes','services','packages'])<>'{}'::jsonb
  OR config->>'project_id' IS DISTINCT FROM entry.project_id
  OR config->>'zone' IS DISTINCT FROM entry.zone OR config->>'instance_id' IS DISTINCT FROM entry.instance_id
  OR (p_policy->'resources'->'gcp' ? entry.project_id) IS DISTINCT FROM true
  OR jsonb_typeof(config->'file_prefixes') IS DISTINCT FROM 'array'
  OR jsonb_array_length(config->'file_prefixes')>16
  OR jsonb_typeof(config->'services') IS DISTINCT FROM 'array'
  OR jsonb_array_length(config->'services')>32
  OR jsonb_typeof(config->'packages') IS DISTINCT FROM 'object'
  OR ((config->'packages')-ARRAY['manager','names'])<>'{}'::jsonb
  OR jsonb_typeof(config->'packages'->'names') IS DISTINCT FROM 'array'
  OR jsonb_array_length(config->'packages'->'names')>20
  THEN RETURN false;END IF;
  IF (entry.platform='win32' AND config->'packages'->>'manager' IS DISTINCT FROM 'winget')
  OR (entry.platform='linux' AND coalesce(config->'packages'->>'manager','') NOT IN('apt','dnf'))
  THEN RETURN false;END IF;
  FOR v IN SELECT * FROM jsonb_array_elements(config->'file_prefixes') LOOP
   IF jsonb_typeof(v)<>'string' OR length(v #>> '{}') NOT BETWEEN 2 AND 180
   OR (v #>> '{}') !~ '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*/$'
   OR (v #>> '{}') ~ '(^|/)\.\.?(/|$)' THEN RETURN false;END IF;
  END LOOP;
  FOR v IN SELECT * FROM jsonb_array_elements(config->'services') LOOP
   IF jsonb_typeof(v)<>'string' OR (v #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9_.@:+-]{0,119}$'
   OR position('..' in v #>> '{}')>0 THEN RETURN false;END IF;
  END LOOP;
  FOR v IN SELECT * FROM jsonb_array_elements(config->'packages'->'names') LOOP
   IF jsonb_typeof(v)<>'string' OR (v #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9_.@:+-]{0,119}$'
   OR position('..' in v #>> '{}')>0 THEN RETURN false;END IF;
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $$;

CREATE FUNCTION public.sandy_engineering_guest_policy_target(
 p_policy jsonb,p_operation text,p_args jsonb,p_scope jsonb
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_engineering_operation_classes;e public.sandy_guest_enrollments;
 config jsonb;name text;prefix text;target_path text;
BEGIN
 SELECT * INTO c FROM public.sandy_engineering_operation_classes WHERE operation=p_operation;
 IF c.operation IS NULL OR c.provider<>'gcp'
 OR c.source_path<>'supabase/functions/sandy-guest-operation-api/contracts.json'
 OR (p_policy->'classes'->'gcp' ? c.operation_class) IS DISTINCT FROM true
 OR jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR jsonb_typeof(p_scope) IS DISTINCT FROM 'object'
 OR p_scope->>'provider' IS DISTINCT FROM 'gcp_guest'
 OR (p_scope-ARRAY['provider','project_id','zone','vm_name','instance_id'])<>'{}'::jsonb
 THEN RETURN false;END IF;
 SELECT * INTO e FROM public.sandy_guest_enrollments WHERE vm_name=p_args->>'vm_name';
 IF e.vm_name IS NULL OR e.vm_name IS DISTINCT FROM p_scope->>'vm_name'
 OR e.project_id IS DISTINCT FROM p_scope->>'project_id' OR e.zone IS DISTINCT FROM p_scope->>'zone'
 OR e.instance_id IS DISTINCT FROM p_scope->>'instance_id'
 OR (p_policy->'resources'->'gcp' ? e.project_id) IS DISTINCT FROM true
 THEN RETURN false;END IF;
 IF c.operation_class='metadata_read' THEN
  RETURN c.path='/sandy/guest/agent-status' AND c.method='GET' AND NOT c.is_mutation
   AND (p_args-'vm_name')='{}'::jsonb;
 END IF;
 IF NOT public.sandy_engineering_computer_policy_valid(p_policy) THEN RETURN false;END IF;
 config:=p_policy->'computer'->'targets'->e.vm_name;
 IF config IS NULL OR NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry r
  WHERE r.operation=c.operation AND r.handler='sandy-guest-operation-api'
   AND r.is_mutation=c.is_mutation AND r.error_contract->>'contract_sha256'=c.contract_sha256)
 THEN RETURN false;END IF;
 IF c.path='/sandy/guest/files' AND (
   c.operation_class='guest_files_write' AND c.method='POST' AND c.is_mutation
   OR c.operation_class='guest_read' AND c.method='GET' AND NOT c.is_mutation) THEN
  IF (p_args-CASE WHEN c.is_mutation THEN ARRAY['vm_name','path','content_base64','sha256'] ELSE ARRAY['vm_name','path'] END)<>'{}'::jsonb
  OR jsonb_typeof(p_args->'path') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
  target_path:=p_args->>'path';
  IF length(target_path) NOT BETWEEN 1 AND 180
  OR target_path !~ '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$'
  OR target_path ~ '(^|/)\.\.?(/|$)' THEN RETURN false;END IF;
  IF c.is_mutation AND (jsonb_typeof(p_args->'content_base64') IS DISTINCT FROM 'string'
   OR length(p_args->>'content_base64')>87384
   OR p_args->>'content_base64' !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
   OR jsonb_typeof(p_args->'sha256') IS DISTINCT FROM 'string'
   OR p_args->>'sha256' !~ '^[a-f0-9]{64}$') THEN RETURN false;END IF;
  RETURN EXISTS(SELECT 1 FROM jsonb_array_elements_text(config->'file_prefixes') p
   WHERE left(target_path,length(p))=p AND length(target_path)>length(p));
 ELSIF c.path='/sandy/guest/services' AND (
   c.operation_class='guest_services_write' AND c.method='POST' AND c.is_mutation
   OR c.operation_class='guest_read' AND c.method='GET' AND NOT c.is_mutation) THEN
  RETURN coalesce((p_args-ARRAY['vm_name','service'])='{}'::jsonb
   AND jsonb_typeof(p_args->'service')='string' AND config->'services' ? (p_args->>'service'),false);
 ELSIF c.path='/sandy/guest/packages' AND c.operation_class='guest_packages_write'
   AND c.method='POST' AND c.is_mutation THEN
  RETURN coalesce((p_args-ARRAY['vm_name','manager','packages'])='{}'::jsonb
   AND p_args->>'manager'=config->'packages'->>'manager'
   AND jsonb_typeof(p_args->'packages')='array' AND jsonb_array_length(p_args->'packages') BETWEEN 1 AND 20
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_args->'packages') p
    WHERE jsonb_typeof(p)<>'string' OR NOT(config->'packages'->'names' @> jsonb_build_array(p)))
   AND (SELECT count(*) FROM jsonb_array_elements(p_args->'packages'))=(SELECT count(DISTINCT p) FROM jsonb_array_elements(p_args->'packages') p),false);
 END IF;
 RETURN false;
EXCEPTION WHEN others THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_computer_policy_valid(jsonb),
 public.sandy_engineering_guest_policy_target(jsonb,text,jsonb,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

-- Preserve all existing GitHub/source guards and the administrator-only setter.
-- Refuse concurrent source changes rather than overwrite another release.
DO $install$ DECLARE definition text; BEGIN
 IF (SELECT encode(extensions.digest(prosrc,'sha256'),'hex') FROM pg_proc WHERE oid='public.sandy_engineering_admin_set_standing(uuid,jsonb,text,timestamp with time zone,boolean,text)'::regprocedure) IS DISTINCT FROM '6db48d95dcfba3c692b83b6d28a1baac9e5eba7c5f197f3e1694a7308fecbe99' THEN RAISE EXCEPTION 'bounded_guest_policy_preimage_changed';END IF;
 definition:=pg_get_functiondef('public.sandy_engineering_admin_set_standing(uuid,jsonb,text,timestamp with time zone,boolean,text)'::regprocedure);
 IF length(definition)-length(replace(definition,'''resources'',''classes'',''environments''',''))<>36 THEN RAISE EXCEPTION 'bounded_guest_exact_patch_required';END IF;
 definition:=replace(definition,'''resources'',''classes'',''environments''','''resources'',''classes'',''environments'',''computer''');
 IF length(definition)-length(replace(definition,'    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v) c WHERE c NOT IN(''metadata_read'',''source_read'',''code_write'',''git_write'',''pull_request_write''))
    OR (k<>''github'' AND v<>''["metadata_read"]''::jsonb)',''))<>206 THEN RAISE EXCEPTION 'bounded_guest_exact_patch_required';END IF;
 definition:=replace(definition,'    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v) c WHERE c NOT IN(''metadata_read'',''source_read'',''code_write'',''git_write'',''pull_request_write''))
    OR (k<>''github'' AND v<>''["metadata_read"]''::jsonb)','    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v) c WHERE NOT(
      k=''github'' AND c IN(''metadata_read'',''source_read'',''code_write'',''git_write'',''pull_request_write'')
      OR k=''supabase'' AND c=''metadata_read''
      OR k=''gcp'' AND c IN(''metadata_read'',''guest_read'',''guest_files_write'',''guest_services_write'',''guest_packages_write'')))');
 IF length(definition)-length(replace(definition,'  INSERT INTO public.sandy_engineering_changes',''))<>46 THEN RAISE EXCEPTION 'bounded_guest_exact_patch_required';END IF;
 definition:=replace(definition,'  INSERT INTO public.sandy_engineering_changes','  IF NOT public.sandy_engineering_computer_policy_valid(p_policy) THEN RAISE EXCEPTION ''invalid_bounded_computer_policy'' USING ERRCODE=''42501'';END IF;
  INSERT INTO public.sandy_engineering_changes');
 EXECUTE definition;
 IF (SELECT encode(extensions.digest(prosrc,'sha256'),'hex') FROM pg_proc WHERE oid='public.sandy_engineering_policy_target(jsonb,text,jsonb,jsonb)'::regprocedure) IS DISTINCT FROM '60f722b778b3eb9e01d14530790571ca8e8abf97a8b90e66b830fee43851c027' THEN RAISE EXCEPTION 'bounded_guest_policy_preimage_changed';END IF;
 definition:=pg_get_functiondef('public.sandy_engineering_policy_target(jsonb,text,jsonb,jsonb)'::regprocedure);
 IF length(definition)-length(replace(definition,' IF p_scope->>''provider''=''gcp_guest'' OR c.source_path=''supabase/functions/sandy-guest-operation-api/contracts.json'' THEN
  RETURN coalesce(p_scope->>''provider''=''gcp_guest'' AND c.provider=''gcp'' AND c.operation_class=''metadata_read'' AND c.method=''GET''
   AND c.path=''/sandy/guest/agent-status'' AND NOT c.is_mutation
   AND c.source_path=''supabase/functions/sandy-guest-operation-api/contracts.json''
   AND (p_policy->''classes''->''gcp'' ? ''metadata_read'') IS TRUE
   AND jsonb_typeof(p_args)=''object'' AND (p_args-''vm_name'')=''{}''::jsonb
   AND jsonb_typeof(p_scope)=''object''
   AND (p_scope-ARRAY[''provider'',''project_id'',''zone'',''vm_name'',''instance_id''])=''{}''::jsonb
   AND EXISTS(SELECT 1 FROM public.sandy_guest_enrollments e
     WHERE e.vm_name=p_args->>''vm_name'' AND e.vm_name=p_scope->>''vm_name''
       AND e.project_id=p_scope->>''project_id'' AND e.zone=p_scope->>''zone''
       AND e.instance_id=p_scope->>''instance_id''
       AND (p_policy->''resources''->''gcp'' ? e.project_id) IS TRUE),false);
 END IF;',''))<>1001 THEN RAISE EXCEPTION 'bounded_guest_exact_patch_required';END IF;
 definition:=replace(definition,' IF p_scope->>''provider''=''gcp_guest'' OR c.source_path=''supabase/functions/sandy-guest-operation-api/contracts.json'' THEN
  RETURN coalesce(p_scope->>''provider''=''gcp_guest'' AND c.provider=''gcp'' AND c.operation_class=''metadata_read'' AND c.method=''GET''
   AND c.path=''/sandy/guest/agent-status'' AND NOT c.is_mutation
   AND c.source_path=''supabase/functions/sandy-guest-operation-api/contracts.json''
   AND (p_policy->''classes''->''gcp'' ? ''metadata_read'') IS TRUE
   AND jsonb_typeof(p_args)=''object'' AND (p_args-''vm_name'')=''{}''::jsonb
   AND jsonb_typeof(p_scope)=''object''
   AND (p_scope-ARRAY[''provider'',''project_id'',''zone'',''vm_name'',''instance_id''])=''{}''::jsonb
   AND EXISTS(SELECT 1 FROM public.sandy_guest_enrollments e
     WHERE e.vm_name=p_args->>''vm_name'' AND e.vm_name=p_scope->>''vm_name''
       AND e.project_id=p_scope->>''project_id'' AND e.zone=p_scope->>''zone''
       AND e.instance_id=p_scope->>''instance_id''
       AND (p_policy->''resources''->''gcp'' ? e.project_id) IS TRUE),false);
 END IF;',' IF p_scope->>''provider''=''gcp_guest'' OR c.source_path=''supabase/functions/sandy-guest-operation-api/contracts.json'' THEN
  RETURN public.sandy_engineering_guest_policy_target(p_policy,p_operation,p_args,p_scope);
 END IF;');
 EXECUTE definition;
END $install$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gcp.vm.files.download' AND handler='sandy-guest-operation-api' AND is_mutation=false AND error_contract->>'contract_sha256'='50c9490e3ab0d4fba287595c992ee709190950021c82550fcf3b9589be0504f2') THEN RAISE EXCEPTION 'reviewed_guest_contract_required';END IF;END $$;
INSERT INTO public.sandy_engineering_operation_classes SELECT * FROM jsonb_populate_record(NULL::public.sandy_engineering_operation_classes,'{"operation":"gcp.vm.files.download","provider":"gcp","operation_class":"guest_read","method":"GET","path":"/sandy/guest/files","is_mutation":false,"contract_sha256":"50c9490e3ab0d4fba287595c992ee709190950021c82550fcf3b9589be0504f2","source_path":"supabase/functions/sandy-guest-operation-api/contracts.json"}'::jsonb);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gcp.vm.files.upload' AND handler='sandy-guest-operation-api' AND is_mutation=true AND error_contract->>'contract_sha256'='32b66e724903eac8058c8e3e1beea78038cc1a23f16c13be13d1500c27b7d392') THEN RAISE EXCEPTION 'reviewed_guest_contract_required';END IF;END $$;
INSERT INTO public.sandy_engineering_operation_classes SELECT * FROM jsonb_populate_record(NULL::public.sandy_engineering_operation_classes,'{"operation":"gcp.vm.files.upload","provider":"gcp","operation_class":"guest_files_write","method":"POST","path":"/sandy/guest/files","is_mutation":true,"contract_sha256":"32b66e724903eac8058c8e3e1beea78038cc1a23f16c13be13d1500c27b7d392","source_path":"supabase/functions/sandy-guest-operation-api/contracts.json"}'::jsonb);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gcp.vm.packages.install' AND handler='sandy-guest-operation-api' AND is_mutation=true AND error_contract->>'contract_sha256'='cf1747fa6e68fe80c4edd628127b0758caddd86ebd528a5f2c61b8a42961891a') THEN RAISE EXCEPTION 'reviewed_guest_contract_required';END IF;END $$;
INSERT INTO public.sandy_engineering_operation_classes SELECT * FROM jsonb_populate_record(NULL::public.sandy_engineering_operation_classes,'{"operation":"gcp.vm.packages.install","provider":"gcp","operation_class":"guest_packages_write","method":"POST","path":"/sandy/guest/packages","is_mutation":true,"contract_sha256":"cf1747fa6e68fe80c4edd628127b0758caddd86ebd528a5f2c61b8a42961891a","source_path":"supabase/functions/sandy-guest-operation-api/contracts.json"}'::jsonb);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gcp.vm.packages.remove' AND handler='sandy-guest-operation-api' AND is_mutation=true AND error_contract->>'contract_sha256'='ea511a6e3e19fbffc1b6791974c040ac2378910d7b1cefa8a961107fab31b9bf') THEN RAISE EXCEPTION 'reviewed_guest_contract_required';END IF;END $$;
INSERT INTO public.sandy_engineering_operation_classes SELECT * FROM jsonb_populate_record(NULL::public.sandy_engineering_operation_classes,'{"operation":"gcp.vm.packages.remove","provider":"gcp","operation_class":"guest_packages_write","method":"POST","path":"/sandy/guest/packages","is_mutation":true,"contract_sha256":"ea511a6e3e19fbffc1b6791974c040ac2378910d7b1cefa8a961107fab31b9bf","source_path":"supabase/functions/sandy-guest-operation-api/contracts.json"}'::jsonb);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gcp.vm.packages.update' AND handler='sandy-guest-operation-api' AND is_mutation=true AND error_contract->>'contract_sha256'='2bde8eb1767af9cb37398500057bf08fd0e62d88f7c94bfdeb08e132be5b36ff') THEN RAISE EXCEPTION 'reviewed_guest_contract_required';END IF;END $$;
INSERT INTO public.sandy_engineering_operation_classes SELECT * FROM jsonb_populate_record(NULL::public.sandy_engineering_operation_classes,'{"operation":"gcp.vm.packages.update","provider":"gcp","operation_class":"guest_packages_write","method":"POST","path":"/sandy/guest/packages","is_mutation":true,"contract_sha256":"2bde8eb1767af9cb37398500057bf08fd0e62d88f7c94bfdeb08e132be5b36ff","source_path":"supabase/functions/sandy-guest-operation-api/contracts.json"}'::jsonb);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gcp.vm.services.restart' AND handler='sandy-guest-operation-api' AND is_mutation=true AND error_contract->>'contract_sha256'='2ea7dba0bf304c1fea816b7b189fc50a76c2da5f78f653f669595eade1163159') THEN RAISE EXCEPTION 'reviewed_guest_contract_required';END IF;END $$;
INSERT INTO public.sandy_engineering_operation_classes SELECT * FROM jsonb_populate_record(NULL::public.sandy_engineering_operation_classes,'{"operation":"gcp.vm.services.restart","provider":"gcp","operation_class":"guest_services_write","method":"POST","path":"/sandy/guest/services","is_mutation":true,"contract_sha256":"2ea7dba0bf304c1fea816b7b189fc50a76c2da5f78f653f669595eade1163159","source_path":"supabase/functions/sandy-guest-operation-api/contracts.json"}'::jsonb);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gcp.vm.services.start' AND handler='sandy-guest-operation-api' AND is_mutation=true AND error_contract->>'contract_sha256'='dcba46fd88066d4ae5678f944000711fa490fa19da99ba028b74a0cd45fcdf33') THEN RAISE EXCEPTION 'reviewed_guest_contract_required';END IF;END $$;
INSERT INTO public.sandy_engineering_operation_classes SELECT * FROM jsonb_populate_record(NULL::public.sandy_engineering_operation_classes,'{"operation":"gcp.vm.services.start","provider":"gcp","operation_class":"guest_services_write","method":"POST","path":"/sandy/guest/services","is_mutation":true,"contract_sha256":"dcba46fd88066d4ae5678f944000711fa490fa19da99ba028b74a0cd45fcdf33","source_path":"supabase/functions/sandy-guest-operation-api/contracts.json"}'::jsonb);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gcp.vm.services.status' AND handler='sandy-guest-operation-api' AND is_mutation=false AND error_contract->>'contract_sha256'='d05f8eaf9c6052ac92b57872d0a89b18c70e1130a1106a3a503620bbe5b48e8c') THEN RAISE EXCEPTION 'reviewed_guest_contract_required';END IF;END $$;
INSERT INTO public.sandy_engineering_operation_classes SELECT * FROM jsonb_populate_record(NULL::public.sandy_engineering_operation_classes,'{"operation":"gcp.vm.services.status","provider":"gcp","operation_class":"guest_read","method":"GET","path":"/sandy/guest/services","is_mutation":false,"contract_sha256":"d05f8eaf9c6052ac92b57872d0a89b18c70e1130a1106a3a503620bbe5b48e8c","source_path":"supabase/functions/sandy-guest-operation-api/contracts.json"}'::jsonb);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='gcp.vm.services.stop' AND handler='sandy-guest-operation-api' AND is_mutation=true AND error_contract->>'contract_sha256'='28bc272daffb9fa124c2057256a1ace529e3c5a39815a87ee841cb34d8d01ed5') THEN RAISE EXCEPTION 'reviewed_guest_contract_required';END IF;END $$;
INSERT INTO public.sandy_engineering_operation_classes SELECT * FROM jsonb_populate_record(NULL::public.sandy_engineering_operation_classes,'{"operation":"gcp.vm.services.stop","provider":"gcp","operation_class":"guest_services_write","method":"POST","path":"/sandy/guest/services","is_mutation":true,"contract_sha256":"28bc272daffb9fa124c2057256a1ace529e3c5a39815a87ee841cb34d8d01ed5","source_path":"supabase/functions/sandy-guest-operation-api/contracts.json"}'::jsonb);
-- No operation registry row, exposure/verification flag, standing policy or enrollment is changed.
COMMIT;
