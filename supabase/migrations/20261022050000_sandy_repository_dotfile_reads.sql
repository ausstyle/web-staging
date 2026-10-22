BEGIN;
-- Read CI definitions and ordinary dotfiles. Write controls remain unchanged.
CREATE OR REPLACE FUNCTION public.sandy_engineering_policy_target(p_policy jsonb,p_operation text,p_args jsonb,p_scope jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_engineering_operation_classes;resource text;target text;branch text;v text;
BEGIN
 SELECT * INTO c FROM public.sandy_engineering_operation_classes WHERE operation=p_operation;
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
END $$;
COMMIT;
