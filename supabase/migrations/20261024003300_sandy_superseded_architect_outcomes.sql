-- Late callbacks from an already admitted engineering attempt must not regress
-- an advanced cycle or falsely certify production acceptance. Audit only.
BEGIN;
DO $migration$
DECLARE definition text;
BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.sandy_autonomous_engineering_record_event(text,text,text,jsonb)'::regprocedure)
 IS DISTINCT FROM '1915230f2ce611be12253604b71d54dfd1394cc6d797517a4ef0bcd20a715322' THEN
  RAISE EXCEPTION 'existing_engineering_cycle_event_source_changed';
 END IF;
 SELECT pg_get_functiondef('public.sandy_autonomous_engineering_record_event(text,text,text,jsonb)'::regprocedure) INTO definition;
 IF position(' v_phase:=c.phase; v_status:=c.status; v_next:=c.next_action;' IN definition)=0 THEN RAISE EXCEPTION 'cycle_event_transition_anchor_changed';END IF;
 definition:=replace(definition,' v_phase:=c.phase; v_status:=c.status; v_next:=c.next_action;',
 ' -- A fresh task needs its own admitted cycle; another Architect callback may
 -- be retained as evidence, never rewind an existing PR/release/acceptance.
 if p_event_type in (''architect_ready'',''architect_blocked'')
    and c.phase in (''review'',''deployment'',''verification'',''complete'')
    and exists(select 1 from public.sandy_autonomous_engineering_events e where e.cycle_id=c.id and e.event_type=''engineering_pr_created''
      and coalesce(e.evidence->>''pr_number'','''') ~ ''^[1-9][0-9]{0,6}$'') then
  if coalesce(p_evidence->>''run_id'','''') !~ ''^[0-9]{5,20}$''
     or p_evidence->>''source'' is distinct from ''github_oidc_observer''
     or p_evidence->>''decision'' is distinct from (case p_event_type when ''architect_ready'' then ''READY'' else ''BLOCKED'' end)
  then raise exception ''Verified superseded Architect observation required'';end if;
  insert into public.sandy_autonomous_engineering_events(cycle_id,event_key,event_type,evidence)
  values(c.id,p_event_key,''architect_outcome_superseded'',p_evidence||jsonb_build_object(
    ''received_event_type'',p_event_type,''preserved_phase'',c.phase,''preserved_status'',c.status,
    ''production_acceptance_inferred'',false,''provider_operation_executed'',false));
  return jsonb_build_object(''recorded'',true,''superseded'',true,''phase'',c.phase,''status'',c.status,''next_action'',c.next_action,
    ''production_acceptance_inferred'',false);
 end if;
 v_phase:=c.phase; v_status:=c.status; v_next:=c.next_action;');
 EXECUTE definition;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
