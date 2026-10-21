BEGIN;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.sandy_operation_registry WHERE handler='sandy-provider-gap-api')<>35 THEN RAISE EXCEPTION 'provider-gap registry count mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE handler='sandy-provider-gap-api' AND verified) THEN RAISE EXCEPTION 'source installation claimed live verification'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE handler='sandy-provider-gap-api' AND (is_mutation OR error_contract->>'requires_approval'='true') AND api_exposed) THEN RAISE EXCEPTION 'unattested sensitive contract exposed'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE handler='sandy-provider-gap-api' AND error_contract->>'api_key_delegable' IS DISTINCT FROM 'false') THEN RAISE EXCEPTION 'unsupported delegated credential exposure'; END IF;
 IF (SELECT count(*) FROM public.sandy_operation_registry WHERE handler='sandy-provider-gap-api' AND api_exposed)<>10 THEN RAISE EXCEPTION 'metadata exposure count mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE handler='sandy-provider-gap-api' AND (error_contract->>'provider_source_sha256' !~ '^[a-f0-9]{64}$' OR error_contract->>'contract_sha256' !~ '^[a-f0-9]{64}$')) THEN RAISE EXCEPTION 'source or contract digest invalid'; END IF;
 IF (SELECT error_contract->>'canonical_operation' FROM public.sandy_operation_registry WHERE operation='supabase.logs.query') IS DISTINCT FROM 'supabase.project.logs.query' THEN RAISE EXCEPTION 'logs alias evidence missing'; END IF;
END $$;
ROLLBACK;
