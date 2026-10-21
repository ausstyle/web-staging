BEGIN;
DO $$
DECLARE source text; denied boolean:=false; result jsonb;
BEGIN
 SELECT prosrc INTO source FROM pg_proc WHERE oid='public.sandy_credential_resolve_consumer(text,uuid,uuid,text)'::regprocedure;
 IF encode(extensions.digest(source,'sha256'),'hex') IS DISTINCT FROM 'ff5e15282be44ce823b77e71d477dc3be74bb93c58a7ded1d279e0f2bdd3999c' THEN RAISE EXCEPTION 'consumer_resolver_source_mismatch'; END IF;
 IF position('sandy-provider-gap-api' in source)=0 OR position('sandy_provider_read_admission_proofs' in source)=0
 OR position('consumer_active_readback_required' in source)=0 OR position('consumer_active_pointer_removed' in source)=0
 OR position('consumer_pointer_changed_during_execution' in source)=0 THEN RAISE EXCEPTION 'consumer_guards_missing'; END IF;
 IF position('sandy-supabase-service-api' in source)>0 THEN RAISE EXCEPTION 'unneeded_management_consumer_access'; END IF;
 IF has_function_privilege('anon','public.sandy_credential_resolve_consumer(text,uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_credential_resolve_consumer(text,uuid,uuid,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.sandy_credential_resolve_consumer(text,uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'consumer_acl_mismatch'; END IF;
 BEGIN
  result:=public.sandy_credential_resolve_consumer('supabase_management',gen_random_uuid(),gen_random_uuid(),'supabase.orgs.list');
 EXCEPTION WHEN raise_exception THEN denied:=SQLERRM='consumer_scoped_admission_required'; END;
 IF NOT denied THEN RAISE EXCEPTION 'unbound_consumer_access_accepted'; END IF;
END $$;
ROLLBACK;
