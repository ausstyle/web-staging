-- Exact dependency source for isolated tests only; never deployed by 05800.
CREATE FUNCTION public.sandy_automatic_memory_learning_allowed(p_customer_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE allowed boolean;
BEGIN
 SELECT s.enabled IS TRUE AND s.learning_enabled IS TRUE AND s.consent_at IS NOT NULL
  AND s.consent_at<=clock_timestamp() AND s.updated_at<=clock_timestamp() INTO allowed
 FROM public.sandy_memory_settings s WHERE s.customer_id=p_customer_id FOR SHARE;
 RETURN coalesce(allowed,false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_automatic_memory_learning_allowed(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_automatic_memory_learning_allowed(uuid) TO service_role;
