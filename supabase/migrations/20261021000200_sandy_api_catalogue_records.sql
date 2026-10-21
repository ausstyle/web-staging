-- Keep large installed executor catalogues out of PostgREST URL query strings.
-- The API still applies principal grants, installed mappings and exposure rules.
BEGIN;
CREATE FUNCTION public.sandy_api_catalogue_records(p_operations text[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_operations IS NULL OR cardinality(p_operations) NOT BETWEEN 1 AND 4096
 OR EXISTS(SELECT 1 FROM unnest(p_operations) op WHERE op IS NULL OR op !~ '^[a-z][a-z0-9_.-]{2,100}$') THEN
  RAISE EXCEPTION 'invalid_installed_operation_set' USING ERRCODE='22023';
 END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
  'operation',r.operation,'domain',r.domain,'permission_scope',r.permission_scope,
  'is_mutation',r.is_mutation,'input_schema',r.input_schema,'output_schema',r.output_schema,
  'handler',r.handler,'api_exposed',r.api_exposed,'ai_exposed',r.ai_exposed,
  'verified',r.verified,'last_verified_at',r.last_verified_at,'error_contract',r.error_contract
 ) ORDER BY r.operation),'[]'::jsonb)
 FROM public.sandy_operation_registry r WHERE r.api_exposed AND r.operation=ANY(p_operations));
END $$;
REVOKE ALL ON FUNCTION public.sandy_api_catalogue_records(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_api_catalogue_records(text[]) TO service_role;
COMMIT;
