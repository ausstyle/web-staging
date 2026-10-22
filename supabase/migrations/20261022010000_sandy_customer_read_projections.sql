BEGIN;
-- These projections restore two existing application reads without reopening
-- private tables to service_role, authenticated clients or anonymous callers.
-- Each normal Auth session is rechecked inside the database service boundary.
CREATE FUNCTION public.sandy_api_customer_read_customer(p_require_portal boolean)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $principal$
DECLARE actor uuid:=auth.uid(); session_uuid uuid; customer uuid;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RETURN NULL;END IF;
 BEGIN session_uuid:=(auth.jwt()->>'session_id')::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;END;
 IF session_uuid IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
   WHERE u.id=actor AND s.id=session_uuid AND u.email_confirmed_at IS NOT NULL
   AND NOT coalesce(u.is_anonymous,false) AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN RETURN NULL;END IF;
 customer:=public.sandy_api_current_agenda_customer_id();
 IF customer IS NULL THEN RETURN NULL;END IF;
 IF p_require_portal AND NOT EXISTS(SELECT 1 FROM public.sandy_memory_portal_accounts p
   WHERE p.auth_user_id=actor AND p.customer_id=customer AND p.revoked_at IS NULL) THEN RETURN NULL;END IF;
 RETURN customer;
END $principal$;
REVOKE ALL ON FUNCTION public.sandy_api_customer_read_customer(boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_api_agenda_list_pins()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $pins$
DECLARE customer uuid:=public.sandy_api_customer_read_customer(true);items jsonb;
BEGIN
 IF customer IS NULL THEN RAISE EXCEPTION 'customer_access_required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('task_id',p.task_id,'position',p.position) ORDER BY p.position,p.task_id),'[]'::jsonb)
 INTO items FROM (SELECT pin.task_id,pin.position FROM public.sandy_task_pins pin
 JOIN public.sandy_tasks t ON t.id=pin.task_id AND t.customer_id=customer AND t.archived_at IS NULL
 WHERE pin.customer_id=customer ORDER BY pin.position,pin.task_id LIMIT 100) p;
 RETURN jsonb_build_object('ok',true,'pins',items);
END $pins$;

CREATE FUNCTION public.sandy_api_calendar_timezone_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $timezone$
DECLARE customer uuid:=public.sandy_api_customer_read_customer(false);profile jsonb;
BEGIN
 IF customer IS NULL THEN RAISE EXCEPTION 'customer_access_required' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('home_timezone',p.home_timezone,'current_timezone',p.current_timezone,
   'current_source',p.current_source,'current_confidence',p.current_confidence,'observed_at',p.observed_at)
 INTO profile FROM public.sandy_timezone_profiles p WHERE p.customer_id=customer;
 RETURN jsonb_build_object('ok',true,'profile',profile);
END $timezone$;
REVOKE ALL ON FUNCTION public.sandy_api_agenda_list_pins(),public.sandy_api_calendar_timezone_get() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_api_agenda_list_pins(),public.sandy_api_calendar_timezone_get() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
