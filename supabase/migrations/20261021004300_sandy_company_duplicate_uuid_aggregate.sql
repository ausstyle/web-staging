-- Repair the existing company duplicate guard's unsupported min(uuid) aggregate.
-- UUID textual order preserves the intended stable matching UUID selection.
-- All name resolution, tenant filtering, trigger behavior and ACLs are retained.
BEGIN;
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.sandy_company_prevent_duplicate()'::regprocedure)) IS DISTINCT FROM 'ecf56d01c77909395e64034094549d7d' THEN
  RAISE EXCEPTION 'Company duplicate guard source drift; review before applying';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.sandy_company_prevent_duplicate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare matching uuid; match_count integer;
begin
 select count(*),min(r.company_id::text)::uuid into match_count,matching from public.sandy_resolve_company_name(new.customer_id,new.name) r where r.company_id is distinct from new.id;
 if match_count>0 then raise exception 'company_name_matches_existing: %',matching using errcode='23505';end if;
 return new;
end $function$
;
COMMIT;
