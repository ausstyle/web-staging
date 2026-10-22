BEGIN;
-- Preserve the exact deployed source/publication protections on every other
-- provider path. Fail visibly if another release changed the shared policy.
DO $$ BEGIN
 IF encode(extensions.digest(pg_get_functiondef('public.sandy_engineering_policy_target(jsonb,text,jsonb,jsonb)'::regprocedure),'sha256'),'hex') <> '99398928e8f7ce3009af3387a300d793fbc812c45dd6d72ffaa77c225935589e' THEN
  RAISE EXCEPTION 'engineering_target_policy_preimage_changed';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sandy_engineering_policy_target(p_policy jsonb, p_operation text, p_args jsonb, p_scope jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE c public.sandy_engineering_operation_classes;resource text;target text;branch text;v text;
BEGIN
 SELECT * INTO c FROM public.sandy_engineering_operation_classes WHERE operation=p_operation;
 -- Guest readiness is a bounded read model, not a Compute API proxy or guest
 -- execution grant. Reuse the existing GCP metadata class only for this reviewed
 -- descriptor and exact installed project/zone/instance binding.
 IF p_scope->>'provider'='gcp_guest' OR c.source_path='supabase/functions/sandy-guest-operation-api/contracts.json' THEN
  RETURN coalesce(p_scope->>'provider'='gcp_guest' AND c.provider='gcp' AND c.operation_class='metadata_read' AND c.method='GET'
   AND c.path='/sandy/guest/agent-status' AND NOT c.is_mutation
   AND c.source_path='supabase/functions/sandy-guest-operation-api/contracts.json'
   AND (p_policy->'classes'->'gcp' ? 'metadata_read') IS TRUE
   AND jsonb_typeof(p_args)='object' AND (p_args-'vm_name')='{}'::jsonb
   AND jsonb_typeof(p_scope)='object'
   AND (p_scope-ARRAY['provider','project_id','zone','vm_name','instance_id'])='{}'::jsonb
   AND EXISTS(SELECT 1 FROM public.sandy_guest_enrollments e
     WHERE e.vm_name=p_args->>'vm_name' AND e.vm_name=p_scope->>'vm_name'
       AND e.project_id=p_scope->>'project_id' AND e.zone=p_scope->>'zone'
       AND e.instance_id=p_scope->>'instance_id'
       AND (p_policy->'resources'->'gcp' ? e.project_id) IS TRUE),false);
 END IF;
 IF c.operation IS NULL OR c.operation_class='restricted' OR (p_policy->'classes'->c.provider ? c.operation_class) IS DISTINCT FROM true
 OR p_scope->>'provider' IS DISTINCT FROM c.provider OR jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 resource:=CASE c.provider WHEN 'github' THEN p_scope->>'repository' WHEN 'supabase' THEN p_scope->>'project_ref' ELSE p_scope->>'project_id' END;
 IF resource IS NULL OR (p_policy->'resources'->c.provider ? resource) IS DISTINCT FROM true THEN RETURN false;END IF;
 IF c.provider='github' THEN
  IF c.operation_class IN('code_write','source_read') THEN
   target:=p_args->'path'->>'path';
   IF target IS NULL OR target='' OR target LIKE '/%' OR target ~ '(^|/)(\.|\.\.)(/|$)|[%\\?#[:cntrl:]]'
    OR lower(target) ~ '(^|/)(\.env[^/]*|\.git)(/|$)|(^|/)[^/]*(credential|private.?key|service.?account)[^/]*\.json$|\.(pem|key|p12|pfx)$'
   THEN RETURN false;END IF;
   IF c.operation_class='code_write' THEN
    IF lower(target) ~ '(^|/)\.github(/|$)' THEN RETURN false;END IF;
    branch:=p_args->'body'->>'branch';
    IF branch IS NULL OR branch NOT LIKE 'engineering/%' OR branch ~ '(^|/)\.\.?(/|$)|[%\\?#[:cntrl:]]' THEN RETURN false;END IF;
   ELSE
    branch:=p_args->'query'->>'ref';
    IF branch IS NULL OR branch !~ '^[a-f0-9]{40}$' THEN RETURN false;END IF;
   END IF;
  ELSIF c.operation_class='git_write' AND c.path ~ '/git/trees$' THEN
   FOR v IN SELECT t->>'path' FROM jsonb_array_elements(p_args->'body'->'tree') t LOOP
    IF v IS NULL OR v='' OR v LIKE '/%' OR v ~ '(^|/)(\.|\.\.)(/|$)|[%\\?#[:cntrl:]]'
     OR lower(v) ~ '(^|/)(\.env[^/]*|\.git|\.github)(/|$)|(^|/)[^/]*(credential|private.?key|service.?account)[^/]*\.json$|\.(pem|key|p12|pfx)$' THEN RETURN false;END IF;
   END LOOP;
  ELSIF c.operation_class='git_write' AND c.path ~ '/git/refs' THEN
   branch:=coalesce(p_args->'body'->>'ref',p_args->'path'->>'ref');
   IF branch IS NULL OR branch !~ '^(refs/)?heads/engineering/[A-Za-z0-9_./-]+$' OR branch ~ '(^|/)\.\.?(/|$)' OR coalesce((p_args->'body'->>'force')::boolean,false) THEN RETURN false;END IF;
  ELSIF c.operation_class='pull_request_write' THEN
   -- Routine draft creation is bounded to an engineering source branch. Changes
   -- to existing production PRs, merges and reviews require a restricted policy.
   IF c.method<>'POST' OR c.path<>'/repos/{owner}/{repo}/pulls' OR coalesce(p_args->'body'->>'head','') NOT LIKE 'engineering/%'
    OR p_args->'body'->>'base' IS DISTINCT FROM 'main' OR p_args->'body'->>'draft' IS DISTINCT FROM 'true' THEN RETURN false;END IF;
  END IF;
 ELSE
  FOR v IN SELECT s #>> '{}' FROM jsonb_path_query(p_args,'strict $.** ? (@.type() == "string")') s LOOP
   IF v ~ 'projects/[^/[:space:]"'']+' AND EXISTS(SELECT 1 FROM regexp_matches(v,'projects/([^/[:space:]"'']+)','g') m WHERE NOT(p_policy->'resources'->'gcp' ? m[1])) THEN RETURN false;END IF;
  END LOOP;
 END IF;
 RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $function$;

INSERT INTO public.sandy_engineering_operation_classes(operation,provider,operation_class,method,path,is_mutation,contract_sha256,source_path) VALUES('gcp.vm.agent.status','gcp','metadata_read','GET','/sandy/guest/agent-status',false,'d4427a3a3521209402de89c0607e8c3a2f31563b7a89fb1bed5c5f5135c134a1','supabase/functions/sandy-guest-operation-api/contracts.json');
-- This migration classifies an existing installed read only. Exposure is changed
-- separately after source-attested deployment; no mutation or IAM grant is added.
COMMIT;
