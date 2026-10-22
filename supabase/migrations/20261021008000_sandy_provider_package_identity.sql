-- Immutable provider-observed package identities. No provider plan change or write.
-- Restore-by-name has no provider CAS: an independent expiring namespace binding
-- is also required by the executor; this table alone never authorizes restore.
BEGIN;
CREATE TABLE public.sandy_provider_package_identity_proofs (
 admission_id uuid PRIMARY KEY REFERENCES public.sandy_api_execution_admissions(id) ON DELETE RESTRICT,
 repository_id bigint NOT NULL CHECK(repository_id>0),
 package_id bigint NOT NULL CHECK(package_id>0),
 package_type text NOT NULL CHECK(package_type IN ('npm','maven','rubygems','docker','nuget','container')),
 package_name text NOT NULL CHECK(length(package_name) BETWEEN 1 AND 214),
 version_id bigint CHECK(version_id>0),
 proof jsonb NOT NULL CHECK(jsonb_typeof(proof)='object'),
 observed_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sandy_provider_package_identity_lookup ON public.sandy_provider_package_identity_proofs(package_type,package_name,package_id,version_id,recorded_at DESC);
CREATE FUNCTION public.sandy_provider_package_identity_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'provider_package_identity_proof_immutable'; END $$;
CREATE TRIGGER sandy_provider_package_identity_immutable BEFORE UPDATE OR DELETE ON public.sandy_provider_package_identity_proofs FOR EACH ROW EXECUTE FUNCTION public.sandy_provider_package_identity_immutable();
REVOKE ALL ON FUNCTION public.sandy_provider_package_identity_immutable() FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.sandy_provider_package_identity_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_provider_package_identity_proofs FROM PUBLIC,anon,authenticated,service_role;
-- Service callers have no direct SELECT, INSERT, UPDATE or DELETE privilege.
CREATE FUNCTION public.sandy_provider_package_proof_context(p_admission uuid,p_arguments_canonical text,p_operations text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions; r public.sandy_operation_registry; args jsonb;
BEGIN
 IF p_admission IS NULL OR p_arguments_canonical IS NULL OR octet_length(p_arguments_canonical)>16384 THEN RAISE EXCEPTION 'package_proof_context_invalid'; END IF;
 args:=p_arguments_canonical::jsonb;
 IF jsonb_typeof(args) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'package_proof_arguments_invalid'; END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR SHARE;
 IF a.id IS NULL OR NOT a.operation=ANY(p_operations) OR a.state IS DISTINCT FROM 'consumed' OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL
 OR a.expires_at<=clock_timestamp() OR a.approval_id IS NULL OR NOT public.sandy_api_current_owner(a.actor_id)
 OR a.input_sha256 IS DISTINCT FROM encode(extensions.digest(p_arguments_canonical,'sha256'),'hex') THEN RAISE EXCEPTION 'package_proof_scoped_admission_required'; END IF;
 SELECT * INTO r FROM public.sandy_operation_registry WHERE operation=a.operation FOR SHARE;
 IF r.handler IS DISTINCT FROM 'sandy-provider-gap-api' OR r.api_exposed IS DISTINCT FROM true OR r.verified IS DISTINCT FROM true OR r.is_mutation IS DISTINCT FROM true
 OR r.error_contract->>'contract_sha256' IS DISTINCT FROM a.contract_sha256
 OR public.sandy_api_registry_revision(a.operation) IS DISTINCT FROM a.registry_revision_sha256 THEN RAISE EXCEPTION 'package_proof_verified_contract_required'; END IF;
 IF args->>'package_type' IS NULL OR args->>'package_type' NOT IN ('npm','maven','rubygems','docker','nuget','container')
 OR args->>'package_name' IS NULL OR length(args->>'package_name') NOT BETWEEN 1 AND 214
 OR args->>'expected_package_id' IS NULL OR args->>'expected_package_id' !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'package_proof_identity_invalid'; END IF;
 RETURN args;
END $$;
CREATE FUNCTION public.sandy_provider_save_package_proof(p_admission uuid,p_arguments_canonical text,p_proof jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE args jsonb; observed timestamptz; package_id bigint; repository_id bigint; version_id bigint;
BEGIN
 args:=public.sandy_provider_package_proof_context(p_admission,p_arguments_canonical,ARRAY['github.packages.delete','github.packages.versions.delete']);
 IF p_proof IS NULL OR jsonb_typeof(p_proof) IS DISTINCT FROM 'object' OR octet_length(p_proof::text)>4096
 OR p_proof->>'response_sha256' IS NULL OR p_proof->>'response_sha256' !~ '^[a-f0-9]{64}$'
 OR p_proof->>'package_type' IS DISTINCT FROM args->>'package_type' OR p_proof->>'package_name' IS DISTINCT FROM args->>'package_name'
 OR p_proof->>'package_id' IS DISTINCT FROM args->>'expected_package_id'
 OR p_proof->>'repository_id' IS NULL OR p_proof->>'repository_id' !~ '^[1-9][0-9]{0,15}$'
 OR (p_proof->>'version_id') IS DISTINCT FROM (args->>'version_id') THEN RAISE EXCEPTION 'provider_package_identity_evidence_invalid'; END IF;
 observed:=(p_proof->>'observed_at')::timestamptz;
 IF observed IS NULL OR observed<clock_timestamp()-interval '5 minutes' OR observed>clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION 'provider_package_identity_evidence_stale'; END IF;
 package_id:=(p_proof->>'package_id')::bigint;repository_id:=(p_proof->>'repository_id')::bigint;version_id:=(p_proof->>'version_id')::bigint;
 INSERT INTO public.sandy_provider_package_identity_proofs(admission_id,repository_id,package_id,package_type,package_name,version_id,proof,observed_at)
 VALUES(p_admission,repository_id,package_id,args->>'package_type',args->>'package_name',version_id,p_proof,observed);
 RETURN jsonb_build_object('ok',true,'admission_id',p_admission,'stored',true);
END $$;
CREATE FUNCTION public.sandy_provider_load_package_proof(p_admission uuid,p_arguments_canonical text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE args jsonb; evidence jsonb; requested_operation text;
BEGIN
 args:=public.sandy_provider_package_proof_context(p_admission,p_arguments_canonical,ARRAY['github.packages.restore','github.packages.versions.restore']);
 SELECT a.operation INTO requested_operation FROM public.sandy_api_execution_admissions a WHERE a.id=p_admission;
 SELECT p.proof INTO evidence FROM public.sandy_provider_package_identity_proofs p JOIN public.sandy_api_execution_admissions original ON original.id=p.admission_id
 WHERE p.package_type=args->>'package_type' AND p.package_name=args->>'package_name' AND p.package_id=(args->>'expected_package_id')::bigint
 AND p.version_id IS NOT DISTINCT FROM (args->>'version_id')::bigint AND original.state='accepted' AND original.provider_http_status BETWEEN 200 AND 299
 AND original.operation=CASE WHEN requested_operation='github.packages.restore' THEN 'github.packages.delete' ELSE 'github.packages.versions.delete' END
 AND p.observed_at>=clock_timestamp()-interval '30 days' ORDER BY p.recorded_at DESC LIMIT 1;
 RETURN evidence;
END $$;
REVOKE ALL ON FUNCTION public.sandy_provider_package_proof_context(uuid,text,text[]),public.sandy_provider_save_package_proof(uuid,text,jsonb),public.sandy_provider_load_package_proof(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_provider_save_package_proof(uuid,text,jsonb),public.sandy_provider_load_package_proof(uuid,text) TO service_role;
COMMIT;
