# Production triggers catalog reference

Metadata only; not executable SQL.

- {"tbl":"sandy_qa_engineering_handoffs","tgname":"sandy_qa_handoff_guard_t","def":"CREATE TRIGGER sandy_qa_handoff_guard_t BEFORE INSERT OR UPDATE ON public.sandy_qa_engineering_handoffs FOR EACH ROW EXECUTE FUNCTION sandy_qa_handoff_guard()"}
- {"tbl":"sandy_task_delegations","tgname":"sandy_task_delegation_scope","def":"CREATE TRIGGER sandy_task_delegation_scope BEFORE INSERT OR UPDATE ON public.sandy_task_delegations FOR EACH ROW EXECUTE FUNCTION sandy_task_delegation_scope_guard()"}
- {"tbl":"sandy_tasks","tgname":"sandy_agenda_task_company_check","def":"CREATE CONSTRAINT TRIGGER sandy_agenda_task_company_check AFTER INSERT OR UPDATE ON public.sandy_tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sandy_agenda_task_company_guard()"}
- {"tbl":"sandy_tasks","tgname":"sandy_life_task_auto_inbox","def":"CREATE TRIGGER sandy_life_task_auto_inbox AFTER INSERT ON public.sandy_tasks FOR EACH ROW EXECUTE FUNCTION sandy_life_task_default_context()"}
- {"tbl":"sandy_tasks","tgname":"sandy_mission_enqueue_on_task","def":"CREATE TRIGGER sandy_mission_enqueue_on_task AFTER INSERT OR UPDATE OF metadata ON public.sandy_tasks FOR EACH ROW EXECUTE FUNCTION sandy_mission_enqueue_new()"}
- {"tbl":"sandy_tasks","tgname":"sandy_mission_review_guard","def":"CREATE TRIGGER sandy_mission_review_guard BEFORE UPDATE OF status ON public.sandy_tasks FOR EACH ROW EXECUTE FUNCTION sandy_mission_guard_review_status()"}
- {"tbl":"sandy_tasks","tgname":"sandy_task_audit","def":"CREATE TRIGGER sandy_task_audit AFTER INSERT OR UPDATE ON public.sandy_tasks FOR EACH ROW EXECUTE FUNCTION sandy_task_event_audit()"}
- {"tbl":"sandy_tasks","tgname":"sandy_task_stamp","def":"CREATE TRIGGER sandy_task_stamp BEFORE INSERT OR UPDATE ON public.sandy_tasks FOR EACH ROW EXECUTE FUNCTION sandy_task_stamp_and_validate()"}
- {"tbl":"sandy_tasks","tgname":"sandy_tasks_default_responsibility","def":"CREATE TRIGGER sandy_tasks_default_responsibility BEFORE INSERT ON public.sandy_tasks FOR EACH ROW EXECUTE FUNCTION sandy_default_task_responsibility()"}
