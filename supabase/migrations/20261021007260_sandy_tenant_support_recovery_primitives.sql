-- Private single-case recovery primitives. Historical Auth attribution stays
-- encrypted/server-internal; the public customer content projection omits it.
BEGIN;
CREATE FUNCTION public.sandy_tenant_support_manifest_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT $m${"id":"support_case_recovery_v1","format_version":"1.0.0","project_ref":"zmqlyygzqoidkcwdysok","complete_tenant_coverage":false,"external_provider_assets_included":false,"private_recovery_only":true,"customer_export_projection":"customer_content_fragments_v1","retained_control_copies":true,"case_scope_required":true,"schema_sha256":"13ddd4182869ee7099717776840a259103f7ebfca73ec10b646d8c7afeca78a8","row_limit_per_table":1000,"maximum_artifact_bytes":2097152,"tables":[{"table":"sandy_product_support_cases","columns":[{"name":"id","type":"uuid","nullable":false,"generated":"","identity":""},{"name":"customer_id","type":"uuid","nullable":false,"generated":"","identity":""},{"name":"subject","type":"text","nullable":false,"generated":"","identity":""},{"name":"details","type":"text","nullable":false,"generated":"","identity":""},{"name":"category","type":"text","nullable":false,"generated":"","identity":""},{"name":"state","type":"text","nullable":false,"generated":"","identity":""},{"name":"version","type":"integer","nullable":false,"generated":"","identity":""},{"name":"created_at","type":"timestamp with time zone","nullable":false,"generated":"","identity":""},{"name":"updated_at","type":"timestamp with time zone","nullable":false,"generated":"","identity":""}],"primary_key":["id"],"order":["id"]},{"table":"sandy_product_support_comments","columns":[{"name":"id","type":"uuid","nullable":false,"generated":"","identity":""},{"name":"case_id","type":"uuid","nullable":false,"generated":"","identity":""},{"name":"actor_id","type":"uuid","nullable":false,"generated":"","identity":""},{"name":"body","type":"text","nullable":false,"generated":"","identity":""},{"name":"created_at","type":"timestamp with time zone","nullable":false,"generated":"","identity":""}],"primary_key":["id"],"order":["id"]}],"manifest_sha256":"8dceb6dd7e7ead7a0b5f4cd463d2266a360aa64ab8f407f92518cc37ca9149cb"}$m$::jsonb $$;
CREATE FUNCTION public.sandy_tenant_support_schema_sha256() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $schema$
WITH selected AS (
 SELECT n.nspname AS schema,c.relname AS name,c.oid,c.relkind,c.relowner,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('sandy_product_support_cases','sandy_product_support_comments'
 )
), structure AS (
 SELECT jsonb_agg(jsonb_build_object(
  'schema',s.schema,'name',s.name,'kind',s.relkind,'owner',pg_get_userbyid(s.relowner),
  'rls',s.relrowsecurity,'force_rls',s.relforcerowsecurity,
  'columns',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'position',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'nullable',NOT a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,
   'default',pg_get_expr(d.adbin,d.adrelid)
  ) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid=s.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
  'constraints',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'name',k.conname,'kind',k.contype,'definition',pg_get_constraintdef(k.oid),
   'deferrable',k.condeferrable,'initially_deferred',k.condeferred,'validated',k.convalidated
  ) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=s.oid),'[]'::jsonb),
  'incoming_fks',coalesce((SELECT jsonb_agg(jsonb_build_object('name',k.conname,'source',k.conrelid::regclass::text,'definition',pg_get_constraintdef(k.oid),'delete_action',k.confdeltype) ORDER BY k.conrelid::regclass::text,k.conname) FROM pg_constraint k WHERE k.confrelid=s.oid AND k.contype='f'),'[]'::jsonb),
  'triggers',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),
   'function_sha256',encode(extensions.digest(pg_get_functiondef(t.tgfoid),'sha256'),'hex')
  ) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=s.oid AND NOT t.tgisinternal),'[]'::jsonb)
 ) ORDER BY s.name) AS document FROM selected s
)
SELECT encode(extensions.digest(document::text,'sha256'),'hex') FROM structure
$schema$;
CREATE FUNCTION public.sandy_tenant_support_capture(p_tenant uuid,p_case uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $$
DECLARE manifest jsonb:=public.sandy_tenant_support_manifest_v1();cases jsonb;comments jsonb;payload jsonb;text_bytes bigint;comment_count integer;
BEGIN
 IF p_tenant IS NULL OR p_case IS NULL OR public.sandy_tenant_support_schema_sha256() IS DISTINCT FROM manifest->>'schema_sha256' THEN RAISE EXCEPTION 'tenant_support_schema_or_scope_invalid';END IF;
 SELECT count(*),coalesce(sum(octet_length(c.body)),0) INTO comment_count,text_bytes FROM public.sandy_product_support_comments c JOIN public.sandy_product_support_cases parent ON parent.id=c.case_id AND parent.customer_id=p_tenant WHERE parent.id=p_case;
 IF comment_count>1000 OR text_bytes+coalesce((SELECT octet_length(subject)+octet_length(details) FROM public.sandy_product_support_cases WHERE id=p_case AND customer_id=p_tenant),0)>1600000 THEN RAISE EXCEPTION 'tenant_support_private_image_bound_exceeded';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'customer_id',c.customer_id,'subject',c.subject,'details',c.details,'category',c.category,'state',c.state,'version',c.version,'created_at',c.created_at,'updated_at',c.updated_at) ORDER BY c.id),'[]') INTO cases FROM public.sandy_product_support_cases c WHERE c.id=p_case AND c.customer_id=p_tenant;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'case_id',c.case_id,'actor_id',c.actor_id,'body',c.body,'created_at',c.created_at) ORDER BY c.id),'[]') INTO comments FROM(SELECT c.* FROM public.sandy_product_support_comments c JOIN public.sandy_product_support_cases parent ON parent.id=c.case_id AND parent.customer_id=p_tenant WHERE parent.id=p_case ORDER BY c.id LIMIT 1001)c;
 IF jsonb_array_length(comments)>1000 THEN RAISE EXCEPTION 'tenant_support_comment_bound_exceeded';END IF;
 payload:=jsonb_build_object('format_version','1.0.0','tenant_id',p_tenant,'case_id',p_case,'manifest',manifest->>'id','manifest_sha256',manifest->>'manifest_sha256','schema_sha256',manifest->>'schema_sha256','complete_tenant_coverage',false,'external_provider_assets_included',false,'private_recovery_only',true,'retained_control_copies',true,'tables',jsonb_build_object('sandy_product_support_cases',cases,'sandy_product_support_comments',comments));
 IF octet_length(payload::text)>2097152 THEN RAISE EXCEPTION 'tenant_support_private_image_bound_exceeded';END IF;
 RETURN payload;
END $$;
CREATE FUNCTION public.sandy_tenant_support_apply(p_tenant uuid,p_case uuid,p_payload jsonb,p_action text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE manifest jsonb:=public.sandy_tenant_support_manifest_v1();cases jsonb:=p_payload->'tables'->'sandy_product_support_cases';comments jsonb:=p_payload->'tables'->'sandy_product_support_comments';affected integer;
BEGIN
 IF p_tenant IS NULL OR p_case IS NULL OR p_action IS NULL OR p_action NOT IN('erase','restore') OR p_payload->>'tenant_id' IS DISTINCT FROM p_tenant::text OR p_payload->>'case_id' IS DISTINCT FROM p_case::text OR p_payload->>'manifest_sha256' IS DISTINCT FROM manifest->>'manifest_sha256' OR p_payload->>'schema_sha256' IS DISTINCT FROM manifest->>'schema_sha256' OR public.sandy_tenant_support_schema_sha256() IS DISTINCT FROM manifest->>'schema_sha256' OR jsonb_typeof(cases) IS DISTINCT FROM 'array' OR jsonb_array_length(cases)<>1 OR jsonb_typeof(comments) IS DISTINCT FROM 'array' OR jsonb_array_length(comments)>1000 THEN RAISE EXCEPTION 'tenant_support_private_image_scope_failed';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(cases)c WHERE c->>'id' IS DISTINCT FROM p_case::text OR c->>'customer_id' IS DISTINCT FROM p_tenant::text) OR EXISTS(SELECT 1 FROM jsonb_array_elements(comments)c WHERE c->>'case_id' IS DISTINCT FROM p_case::text) THEN RAISE EXCEPTION 'tenant_support_private_image_owner_failed';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('tenant_manifest_lifecycle:'||p_tenant::text,0));
 IF p_action='erase' THEN
  DELETE FROM public.sandy_product_support_comments t USING jsonb_to_recordset(comments)r(id uuid,case_id uuid,actor_id uuid,body text,created_at timestamptz) WHERE t.case_id=p_case AND EXISTS(SELECT 1 FROM public.sandy_product_support_cases parent WHERE parent.id=t.case_id AND parent.customer_id=p_tenant) AND t.id=r.id AND t.case_id=r.case_id AND t.actor_id=r.actor_id AND t.body=r.body AND t.created_at=r.created_at;
  GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>jsonb_array_length(comments) THEN RAISE EXCEPTION 'tenant_support_comment_compare_conflict';END IF;
  DELETE FROM public.sandy_product_support_cases t USING jsonb_to_recordset(cases)r(id uuid,customer_id uuid,subject text,details text,category text,state text,version integer,created_at timestamptz,updated_at timestamptz) WHERE t.id=p_case AND t.customer_id=p_tenant AND t.id=r.id AND t.customer_id=r.customer_id AND t.subject=r.subject AND t.details=r.details AND t.category=r.category AND t.state=r.state AND t.version=r.version AND t.created_at=r.created_at AND t.updated_at=r.updated_at;
  GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'tenant_support_case_compare_conflict';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.sandy_product_support_cases WHERE id=p_case) OR EXISTS(SELECT 1 FROM public.sandy_product_support_comments WHERE case_id=p_case) THEN RAISE EXCEPTION 'tenant_support_restore_requires_empty_case_scope';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(comments)c LEFT JOIN auth.users actor ON actor.id=(c->>'actor_id')::uuid AND actor.deleted_at IS NULL WHERE actor.id IS NULL) THEN RAISE EXCEPTION 'tenant_support_existing_attribution_required';END IF;
  INSERT INTO public.sandy_product_support_cases(id,customer_id,subject,details,category,state,version,created_at,updated_at) SELECT id,customer_id,subject,details,category,state,version,created_at,updated_at FROM jsonb_to_recordset(cases)r(id uuid,customer_id uuid,subject text,details text,category text,state text,version integer,created_at timestamptz,updated_at timestamptz);
  INSERT INTO public.sandy_product_support_comments(id,case_id,actor_id,body,created_at) SELECT id,case_id,actor_id,body,created_at FROM jsonb_to_recordset(comments)r(id uuid,case_id uuid,actor_id uuid,body text,created_at timestamptz);
 END IF;
 RETURN jsonb_build_object('cases',1,'comments',jsonb_array_length(comments),'parent_notifications_replayed',false,'Auth_identity_created',false,'retained_control_copies',true);
END $$;
REVOKE ALL ON FUNCTION public.sandy_tenant_support_manifest_v1(),public.sandy_tenant_support_schema_sha256(),public.sandy_tenant_support_capture(uuid,uuid),public.sandy_tenant_support_apply(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
