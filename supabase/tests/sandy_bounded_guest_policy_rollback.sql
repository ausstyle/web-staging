-- Synthetic database component fixtures. Every policy/flag/session/job change
-- rolls back. No normal Auth login, provider request or guest execution occurs.
BEGIN;
DO $test$
DECLARE base jsonb;p jsonb;bad jsonb;s jsonb;windows_scope jsonb;t record;actual boolean;
 uid uuid:='7a519da9-2ee3-4edf-adec-42697da5a560';owner uuid;epoch integer;
 sid uuid:=gen_random_uuid();req uuid:=gen_random_uuid();job uuid;aid uuid;gid uuid;guest_job uuid;task_scope jsonb;
 contract text;args text:='{"content_base64":"eA==","path":"sandy-engineering-canary/probe.txt","sha256":"2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881","vm_name":"sandy-video"}';
 scope text:='{"instance_id":"6831598645020395570","project_id":"elaborate-haven-511518-a5","provider":"gcp_guest","vm_name":"sandy-video","zone":"europe-west1-b"}';
 result jsonb;hash text;checks integer:=0;
BEGIN
 SELECT policy INTO base FROM public.sandy_engineering_standing_delegations WHERE identity_user_id=uid;
 p:=jsonb_set(base,'{classes,gcp}','["metadata_read","guest_read","guest_files_write","guest_services_write","guest_packages_write"]');
 p:=p||'{"computer":{"targets":{
  "sandy-video":{"project_id":"elaborate-haven-511518-a5","zone":"europe-west1-b","instance_id":"6831598645020395570","file_prefixes":["sandy-engineering-canary/"],"services":["sandy-engineering-canary"],"packages":{"manager":"apt","names":["hello"]}},
  "sandy-windows":{"project_id":"elaborate-haven-511518-a5","zone":"europe-west1-b","instance_id":"8120150462304566315","file_prefixes":["sandy-engineering-canary/"],"services":["SandyEngineeringCanary"],"packages":{"manager":"winget","names":["Microsoft.PowerShell"]}}
 }}}'::jsonb;
 IF NOT public.sandy_engineering_computer_policy_valid(p)
 OR NOT public.sandy_engineering_computer_policy_valid(base) THEN RAISE EXCEPTION 'valid_policy_refused';END IF;checks:=checks+2;
 FOR bad IN SELECT value FROM (VALUES
  ('null'::jsonb),(p-'computer'),
  (jsonb_set(p,'{computer,targets}','{}')),
  (jsonb_set(p,'{computer,targets,sandy-video,instance_id}','"999"')),
  (jsonb_set(p,'{computer,targets,sandy-video,zone}','"other-zone"')),
  (jsonb_set(p,'{computer,targets,sandy-video,extra}','true')),
  (jsonb_set(p,'{computer,targets,sandy-video,file_prefixes}','["/"]')),
  (jsonb_set(p,'{computer,targets,sandy-video,file_prefixes}','["../"]')),
  (jsonb_set(p,'{computer,targets,sandy-video,file_prefixes}','["safe/../"]')),
  (jsonb_set(p,'{computer,targets,sandy-video,file_prefixes}','["safe"]')),
  (jsonb_set(p,'{computer,targets,sandy-video,file_prefixes}','[123]')),
  (jsonb_set(p,'{computer,targets,sandy-video,services}','["../bad"]')),
  (jsonb_set(p,'{computer,targets,sandy-windows,packages,manager}','"apt"')),
  (jsonb_set(p,'{computer,targets,sandy-video,packages,names}','["hello;curl"]')),
  (jsonb_set(p,'{resources,gcp}','["another-project"]'))
 ) invalid(value) LOOP
  IF public.sandy_engineering_computer_policy_valid(bad) IS DISTINCT FROM false THEN RAISE EXCEPTION 'invalid_computer_policy_allowed';END IF;checks:=checks+1;
 END LOOP;
 s:=scope::jsonb;
 windows_scope:=s||'{"vm_name":"sandy-windows","instance_id":"8120150462304566315"}'::jsonb;
 FOR t IN SELECT * FROM (VALUES
  ('upload_allowed','gcp.vm.files.upload',args::jsonb,s,p,true),
  ('download_allowed','gcp.vm.files.download','{"vm_name":"sandy-video","path":"sandy-engineering-canary/probe.txt"}'::jsonb,s,p,true),
  ('outside_prefix','gcp.vm.files.upload',jsonb_set(args::jsonb,'{path}','"customer/file.txt"'),s,p,false),
  ('prefix_boundary','gcp.vm.files.upload',jsonb_set(args::jsonb,'{path}','"sandy-engineering-canary-other/probe.txt"'),s,p,false),
  ('path_escape','gcp.vm.files.upload',jsonb_set(args::jsonb,'{path}','"sandy-engineering-canary/../secret"'),s,p,false),
  ('extra_argument','gcp.vm.files.upload',args::jsonb||'{"command":"whoami"}',s,p,false),
  ('wrong_scope_instance','gcp.vm.files.upload',args::jsonb,jsonb_set(s,'{instance_id}','"999"'),p,false),
  ('wrong_scope_zone','gcp.vm.files.upload',args::jsonb,jsonb_set(s,'{zone}','"other-zone"'),p,false),
  ('wrong_scope_provider','gcp.vm.files.upload',args::jsonb,jsonb_set(s,'{provider}','"gcp"'),p,false),
  ('extra_scope','gcp.vm.files.upload',args::jsonb,s||'{"role":"owner"}',p,false),
  ('metadata_grant_not_write','gcp.vm.files.upload',args::jsonb,s,base,false),
  ('missing_computer_bounds','gcp.vm.files.upload',args::jsonb,s,p-'computer',false),
  ('service_start','gcp.vm.services.start','{"vm_name":"sandy-video","service":"sandy-engineering-canary"}'::jsonb,s,p,true),
  ('service_status','gcp.vm.services.status','{"vm_name":"sandy-video","service":"sandy-engineering-canary"}'::jsonb,s,p,true),
  ('unlisted_service','gcp.vm.services.stop','{"vm_name":"sandy-video","service":"sshd"}'::jsonb,s,p,false),
  ('missing_service','gcp.vm.services.stop','{"vm_name":"sandy-video"}'::jsonb,s,p,false),
  ('package_install','gcp.vm.packages.install','{"vm_name":"sandy-video","manager":"apt","packages":["hello"]}'::jsonb,s,p,true),
  ('package_remove','gcp.vm.packages.remove','{"vm_name":"sandy-video","manager":"apt","packages":["hello"]}'::jsonb,s,p,true),
  ('wrong_package','gcp.vm.packages.install','{"vm_name":"sandy-video","manager":"apt","packages":["openssh-server"]}'::jsonb,s,p,false),
  ('wrong_manager','gcp.vm.packages.install','{"vm_name":"sandy-video","manager":"winget","packages":["hello"]}'::jsonb,s,p,false),
  ('duplicate_packages','gcp.vm.packages.install','{"vm_name":"sandy-video","manager":"apt","packages":["hello","hello"]}'::jsonb,s,p,false),
  ('missing_packages','gcp.vm.packages.install','{"vm_name":"sandy-video","manager":"apt"}'::jsonb,s,p,false),
  ('windows_package','gcp.vm.packages.install','{"vm_name":"sandy-windows","manager":"winget","packages":["Microsoft.PowerShell"]}'::jsonb,windows_scope,p,true),
  ('windows_service','gcp.vm.services.restart','{"vm_name":"sandy-windows","service":"SandyEngineeringCanary"}'::jsonb,windows_scope,p,true),
  ('enrollment_not_routine','gcp.vm.access.bootstrap','{"vm_name":"sandy-video"}'::jsonb,s,p,false),
  ('firewall_not_routine','gcp.vm.firewall_guest.manage','{"vm_name":"sandy-video","action":"allow","rule_id":"test"}'::jsonb,s,p,false),
  ('native_exec_not_routine','gcp.vm.ssh.exec','{"vm_name":"sandy-video","command":"whoami"}'::jsonb,s,p,false),
  ('existing_status','gcp.vm.agent.status','{"vm_name":"sandy-video"}'::jsonb,s,base,true)
 ) cases(name,operation,arguments,scope,policy,expected) LOOP
  actual:=public.sandy_engineering_policy_target(t.policy,t.operation,t.arguments,t.scope);
  IF actual IS DISTINCT FROM t.expected THEN RAISE EXCEPTION 'bounded_guest_target_assertion: % actual %',t.name,actual;END IF;checks:=checks+1;
 END LOOP;
 IF has_function_privilege('service_role','public.sandy_engineering_admin_set_standing(uuid,jsonb,text,timestamptz,boolean,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_engineering_admin_set_standing(uuid,jsonb,text,timestamptz,boolean,text)','EXECUTE')
 THEN RAISE EXCEPTION 'workload_policy_self_administration_exposed';END IF;checks:=checks+1;
 SELECT credential_epoch,authorized_by INTO epoch,owner FROM public.sandy_engineering_test_identities WHERE user_id=uid;
 -- Administrator fixture only, never committed or represented as a real grant.
 result:=public.sandy_engineering_admin_set_standing(uid,p,encode(extensions.digest(p::text,'sha256'),'hex'),clock_timestamp()+interval '1 day',false,'b183486fdd64209eeedfb007b7cc37b07cdc4ed9');
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'bounded_admin_fixture_failed';END IF;checks:=checks+1;
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after)
 VALUES(sid,uid,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '30 minutes');
 PERFORM public.sandy_engineering_register_session(uid,sid,epoch,clock_timestamp()+interval '30 minutes');
 -- Only component fixtures temporarily expose the source-matched operation.
 UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true,verified=false WHERE operation='gcp.vm.files.upload';
 SELECT error_contract->>'contract_sha256' INTO contract FROM public.sandy_operation_registry WHERE operation='gcp.vm.files.upload';
 hash:=encode(extensions.digest(args,'sha256'),'hex');
 result:=public.sandy_engineering_prepare_delegated(uid,sid,epoch,req,'gcp.vm.files.upload',args,contract,scope);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'bounded_prepare_failed %',result;END IF;job:=(result->>'authorization_id')::uuid;
 result:=public.sandy_api_admit_execution(owner,NULL,'gcp.vm.files.upload',hash,req,NULL,contract,encode(extensions.digest(scope,'sha256'),'hex'),0,job);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'bounded_admit_failed %',result;END IF;aid:=(result->>'admission_id')::uuid;gid:=(result->>'grant_id')::uuid;
 result:=public.sandy_api_consume_execution_grant(gid,owner,NULL,'gcp.vm.files.upload',hash,req,contract,encode(extensions.digest(scope,'sha256'),'hex'));
 IF result->>'allowed' IS DISTINCT FROM 'true' OR NOT public.sandy_guest_admission_current(aid,owner,'gcp.vm.files.upload',hash)
 THEN RAISE EXCEPTION 'bounded_standing_mutation_gate_refused';END IF;checks:=checks+1;
 result:=public.sandy_guest_enqueue(owner,'sandy-video','gcp.vm.files.upload',aid,req,args,hash);
 IF result->>'error' IS DISTINCT FROM 'guest_enrollment_required' THEN RAISE EXCEPTION 'absent_enrollment_gate_bypassed';END IF;checks:=checks+1;
 -- A nonexecuted synthetic task tests receipt isolation without enrollment.
 INSERT INTO public.sandy_guest_jobs(actor_id,admission_id,vm_name,generation,operation,request_id,input_sha256,arguments,registry_revision_sha256)
 VALUES(owner,aid,'sandy-video',0,'gcp.vm.files.upload',req,hash,args::jsonb,public.sandy_api_registry_revision('gcp.vm.files.upload')) RETURNING id INTO guest_job;
 task_scope:=jsonb_build_object('provider','gcp_guest','project_id','elaborate-haven-511518-a5','receipt_actor_id',owner);
 IF NOT public.sandy_engineering_policy_target(p,'gcp.vm.tasks.get',jsonb_build_object('job_id',guest_job),task_scope)
 THEN RAISE EXCEPTION 'own_scoped_task_read_refused';END IF;checks:=checks+1;
 IF public.sandy_engineering_policy_target(p,'gcp.vm.tasks.get',jsonb_build_object('job_id',guest_job),task_scope||jsonb_build_object('receipt_actor_id',gen_random_uuid()))
 OR public.sandy_engineering_policy_target(p,'gcp.vm.tasks.get',jsonb_build_object('job_id',gen_random_uuid()),task_scope)
 OR public.sandy_engineering_policy_target(base,'gcp.vm.tasks.get',jsonb_build_object('job_id',guest_job),task_scope)
 THEN RAISE EXCEPTION 'unscoped_task_receipt_allowed';END IF;checks:=checks+3;
 IF EXISTS(SELECT 1 FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=job)
 OR EXISTS(SELECT 1 FROM public.sandy_deployment_jobs WHERE id=job AND (approved_by IS NOT NULL OR approved_at IS NOT NULL))
 THEN RAISE EXCEPTION 'owner_approval_manufactured';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_standing_delegations SET revoked_at=clock_timestamp() WHERE identity_user_id=uid;
 IF public.sandy_guest_admission_current(aid,owner,'gcp.vm.files.upload',hash) THEN RAISE EXCEPTION 'revoked_guest_write_grant_allowed';END IF;checks:=checks+1;
 PERFORM set_config('sandy.bounded.guest.checks',checks::text,true);
END $test$;
SELECT current_setting('sandy.bounded.guest.checks')::integer checks;
ROLLBACK;
