-- Actual PostgreSQL installation/privilege component test, never Auth integration.
BEGIN;
DO $$
DECLARE denied boolean:=false; x jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='sandy_provider_package_identity_proofs' AND c.relrowsecurity) THEN RAISE EXCEPTION 'proof RLS missing'; END IF;
 IF has_table_privilege('service_role','public.sandy_provider_package_identity_proofs','INSERT')
 OR has_table_privilege('service_role','public.sandy_provider_package_identity_proofs','UPDATE')
 OR has_table_privilege('service_role','public.sandy_provider_package_identity_proofs','SELECT')
 OR has_table_privilege('authenticated','public.sandy_provider_package_identity_proofs','SELECT') THEN RAISE EXCEPTION 'private proof privilege leak'; END IF;
 IF NOT has_function_privilege('service_role','public.sandy_provider_save_package_proof(uuid,text,jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_provider_save_package_proof(uuid,text,jsonb)','EXECUTE')
 OR has_function_privilege('service_role','public.sandy_provider_package_proof_context(uuid,text,text[])','EXECUTE') THEN RAISE EXCEPTION 'private RPC privilege mismatch'; END IF;
 BEGIN
  x:=public.sandy_provider_save_package_proof(gen_random_uuid(),'{}','{}');
 EXCEPTION WHEN raise_exception THEN denied:=SQLERRM='package_proof_scoped_admission_required'; END;
 IF NOT denied THEN RAISE EXCEPTION 'unbound proof write accepted'; END IF;
 denied:=false;
 BEGIN
  x:=public.sandy_provider_load_package_proof(gen_random_uuid(),'{}');
 EXCEPTION WHEN raise_exception THEN denied:=SQLERRM='package_proof_scoped_admission_required'; END;
 IF NOT denied THEN RAISE EXCEPTION 'unbound proof read accepted'; END IF;
END $$;
ROLLBACK;
