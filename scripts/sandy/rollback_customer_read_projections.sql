-- Administrative rollback only, after restoring the previous gateway artifact.
-- The addition is data-free: this removes only the three newly added functions.
BEGIN;
DROP FUNCTION public.sandy_api_agenda_list_pins();
DROP FUNCTION public.sandy_api_calendar_timezone_get();
DROP FUNCTION public.sandy_api_customer_read_customer(boolean);
NOTIFY pgrst,'reload schema';
COMMIT;
