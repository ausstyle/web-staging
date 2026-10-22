-- Restore the prior gateway artifact first. Preserve all execution/audit history.
BEGIN;
DROP FUNCTION public.sandy_api_consume_customer_read(uuid,text,uuid,text,text,text);
DROP FUNCTION public.sandy_api_admit_customer_read(text,uuid,text,text,text);
DROP FUNCTION public.sandy_api_customer_read_policy(text,text);
NOTIFY pgrst,'reload schema';
COMMIT;
