
-- Applied to production 2026-10-17 (migration 20261017194557)
create or replace function public.sandy_v2_refresh_database_inventory()
returns integer language plpgsql security invoker
set search_path=pg_catalog,public
as $$
declare n integer;
begin
 insert into public.sandy_v2_component_inventory(
 component_key,component_type,source_of_truth,deployment_state,verification_note,last_verified_at,updated_at)
 select 'db:public.'||t.table_name,'database_table','pg_catalog:information_schema.tables','schema_observed',
 'Current PostgreSQL table metadata; actual row permissions and application semantics require separate verification',now(),now()
 from information_schema.tables t where t.table_schema='public' and t.table_type='BASE TABLE'
 on conflict(component_key) do update
 set deployment_state='schema_observed',last_verified_at=now(),updated_at=now();
 get diagnostics n=row_count;
 return n;
end $$;
revoke all on function public.sandy_v2_refresh_database_inventory() from public,anon,authenticated;
grant execute on function public.sandy_v2_refresh_database_inventory() to service_role;
select public.sandy_v2_refresh_database_inventory();
