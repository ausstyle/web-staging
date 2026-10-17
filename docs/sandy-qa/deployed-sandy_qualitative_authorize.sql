-- Exact read-only reference from deployed database. Not a migration.
CREATE OR REPLACE FUNCTION public.sandy_qualitative_authorize(p_token text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$select exists(select 1 from public.sandy_qualitative_scheduler_key where id=1 and token_hash=encode(sha256(convert_to(coalesce(p_token,''),'UTF8')),'hex'))$function$

