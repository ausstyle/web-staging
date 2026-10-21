import { isAgentPrincipal, type AgentPrincipal } from "./identity.ts";
type Obj = Record<string, any>;

/** Raw business rules extracted from byte-identical v2/v1/v4 action branches.
 * Only the central application executor calls this module after an audit claim.
 * It has no model/provider transport and cannot create a customer identity. */
export async function runtimeRecordOperation(ctx: AgentPrincipal, operation: string, args: Obj, db: any): Promise<Obj> {
  if (!isAgentPrincipal(ctx) || ctx.kind !== "trusted_runtime" || !ctx.taskId) return { error: "trusted_runtime_customer_task_required" };
  const bound = await db.from("sandy_agent_tasks").select("id,customer_id,status,user_request").eq("id", ctx.taskId).eq("customer_id", ctx.customerId).maybeSingle();
  if (bound.error || !bound.data || bound.data.id !== ctx.taskId || bound.data.customer_id !== ctx.customerId ||
    bound.data.user_request !== ctx.requestText || !["queued", "running"].includes(bound.data.status)) return { error: "runtime_record_task_binding_mismatch" };
  const customerId = ctx.customerId;
  if (operation === "agent.runtime.tasks.request_client_action") {
    const missionId = args.mission_id, title = args.title.trim(), details = args.details.trim();
    const { data: parent, error: pe } = await db.from("sandy_tasks").select("id,metadata").eq("id", missionId).eq("customer_id", customerId).maybeSingle();
    if (pe || parent?.metadata?.sandy_mission !== true) return { error: "mission_unavailable" };
    const { data: duplicate, error: de } = await db.from("sandy_tasks").select("id").eq("customer_id", customerId).eq("parent_task_id", missionId).eq("title", title).not("status", "in", "(completed,cancelled,canceled,deleted)").limit(1);
    if (de) return { error: de.code };
    if (duplicate?.length) return { ok: true, already_exists: true, task_id: duplicate[0].id };
    const { data: created, error: ce } = await db.from("sandy_tasks").insert({ customer_id: customerId, parent_task_id: missionId, title, details, status: "todo", priority: "high", metadata: { sandy_mission_step: true, assigned_to: "client", requested_by: "sandy", stage: "client_action" } }).select("id").single();
    return ce || !created?.id ? { error: "runtime_task_write_unverified", state: "unknown" } : { ok: true, task_id: created.id };
  }
  if (operation === "agent.runtime.tasks.list") {
    const { data, error } = await db.from("sandy_tasks").select("id,title,status,priority,due_at,parent_task_id,responsible_customer_id,created_at").eq("customer_id", customerId).is("archived_at", null).not("status", "in", "(completed,cancelled,canceled,deleted)").order("due_at", { ascending: true, nullsFirst: false }).limit(150);
    const { count: exactCount, error: countError } = await db.from("sandy_tasks").select("id", { count: "exact", head: true }).eq("customer_id", customerId).is("archived_at", null).not("status", "in", "(completed,cancelled,canceled,deleted)");
    const taskIds = (data || []).map((t: Obj) => t.id);
    const delegationQuery = taskIds.length ? await db.from("sandy_task_delegations").select("task_id,assignee_customer_id,status,scope").in("task_id", taskIds) : { data: [], error: null };
    const participantQuery = taskIds.length ? await db.from("sandy_task_participants").select("task_id,customer_id,role,status").in("task_id", taskIds) : { data: [], error: null };
    const assigneeIds = [...new Set((delegationQuery.data || []).map((d: Obj) => d.assignee_customer_id))];
    const namesQuery = assigneeIds.length ? await db.from("email_customers").select("id,display_name").in("id", assigneeIds) : { data: [], error: null };
    const assigneeNames = new Map((namesQuery.data || []).map((u: Obj) => [u.id, u.display_name]));
    if (error || countError || delegationQuery.error || participantQuery.error || namesQuery.error) return { error: error?.code || countError?.code || delegationQuery.error?.code || participantQuery.error?.code || namesQuery.error?.code };
    return {
      outstanding_count: exactCount ?? 0, shown_count: data?.length || 0,
      definition: "Outstanding includes todo, waiting, pending, blocked and in-progress tasks; excludes completed, cancelled, canceled, deleted and archived.",
      status_breakdown: (data || []).reduce((acc: Record<string, number>, t: Obj) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {}),
      in_progress_count: (data || []).filter((t: Obj) => ["in_progress", "in progress", "doing"].includes(String(t.status))).length,
      todo_is_in_progress: false,
      tasks: (data || []).map((t: Obj) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_at: t.due_at,
        responsible_customer_id: t.responsible_customer_id,
        delegations: (delegationQuery.data || []).filter((d: Obj) => d.task_id === t.id).map((d: Obj) => ({ assignee: assigneeNames.get(d.assignee_customer_id) || "Unknown", status: d.status, scope: d.scope })),
        participants: (participantQuery.data || []).filter((d: Obj) => d.task_id === t.id).map((d: Obj) => ({ role: d.role, status: d.status, customer_id: d.customer_id })),
      })),
    };
  }
  if (operation === "agent.runtime.history.search") {
    const { data, error } = await db.rpc("sandy_search_unified_history", { p_customer_id: customerId, p_query: args.query, p_limit: 8 });
    return error ? { error: error.code } : { matches: (data || []).map((v: Obj) => ({ ...v, content: String(v.content || "").slice(0, 1500) })) };
  }
  if (operation === "agent.runtime.images.request_approval") {
    const mission = args.mission_id, description = args.prompt.trim();
    const { data: flag } = await db.from("sandy_ai_integrations").select("deployment_status").eq("integration_key", "openai_image").maybeSingle();
    const { data: parent } = await db.from("sandy_tasks").select("id,metadata").eq("customer_id", customerId).eq("id", mission).maybeSingle();
    if (!flag || !parent || parent.metadata?.sandy_mission !== true) return { error: "image_approval_invalid" };
    const title = "Approve paid image generation";
    const { data: prior, error: duplicateError } = await db.from("sandy_tasks").select("id").eq("customer_id", customerId).eq("parent_task_id", mission).eq("title", title).not("status", "in", "(completed,cancelled,canceled,deleted)").limit(1);
    if (duplicateError) return { error: "approval_lookup_failed" };
    if (prior?.length) return { ok: true, approval_pending: true, task_id: prior[0].id };
    const { data: created, error: ce } = await db.from("sandy_tasks").insert({ customer_id: customerId, parent_task_id: mission, title, details: "Requested image: " + description, status: "todo", priority: "high", metadata: { sandy_mission_step: true, assigned_to: "client", stage: "approval", image_generation: true, prompt: description, cost_approval_required: true } }).select("id").single();
    return ce || !created?.id ? { error: "approval_record_failed", state: "unknown" } : { ok: true, approval_pending: true, task_id: created.id };
  }
  if (operation === "agent.runtime.connections.list") {
    const [accounts, companies, connector] = await Promise.all([
      db.from("sandy_composio_connections").select("toolkit_slug,connected_account_id,company_id,status").eq("customer_id", customerId).in("status", ["ACTIVE", "active"]).limit(100),
      db.from("sandy_agenda_companies").select("id,name").eq("customer_id", customerId),
      db.from("sandy_ai_integrations").select("enabled").eq("integration_key", "composio_connector").maybeSingle(),
    ]);
    if (accounts.error || companies.error || connector.error) return { error: "connections_unavailable" };
    return { services: (accounts.data || []).map((x: Obj) => ({ service: x.toolkit_slug, account_id: x.connected_account_id,
      workspace: x.company_id ? (companies.data || []).find((c: Obj) => c.id === x.company_id)?.name || "Company" : "Personal",
      connector_enabled: connector.data?.enabled === true,
      capabilities: x.toolkit_slug === "gmail" && connector.data?.enabled ? ["search_email_read_only", "prepare_email_for_confirmation", "send_email_after_explicit_confirmation", "verify_sent_email_receipt"] : ["connected_not_yet_available_in_chat"],
      ...(x.toolkit_slug === "gmail" ? { send_workflow: "Prepare exact recipient, subject and body, then the customer replies Confirm send <draft ID>. A successful send requires a provider message ID and independent Sent Mail verification." } : {}),
    })) };
  }
  if (operation === "agent.runtime.context.tasks.find") {
    const { data, error } = await db.from("sandy_tasks").select("id,title,status,priority,updated_at").eq("customer_id", customerId).is("archived_at", null).ilike("title", "%" + args.query.replace(/[%_,]/g, "") + "%").limit(8);
    return error ? { error: "lookup_failed" } : { records: data || [] };
  }
  if (operation === "agent.runtime.context.tasks.get") {
    const { data, error } = await db.from("sandy_tasks").select("id,title,details,status,priority,due_at,parent_task_id").eq("customer_id", customerId).eq("id", args.id).is("archived_at", null).limit(1);
    return error ? { error: "lookup_failed" } : { records: data || [] };
  }
  if (operation === "agent.runtime.context.files.find") {
    const { data, error } = await db.from("sandy_universal_files").select("id,display_name,mime_type,description,created_at,library_state").eq("owner_customer_id", customerId).ilike("display_name", "%" + args.query.replace(/[%_,]/g, "") + "%").limit(8);
    return error ? { error: "lookup_failed" } : { records: (data || []).filter((x: Obj) => !["deleted", "archived"].includes(x.library_state)) };
  }
  if (operation === "agent.runtime.context.memory.search") {
    const { data, error } = await db.from("sandy_memory_archive").select("id,channel,content,occurred_at").eq("owner_customer_id", customerId).eq("state", "active").ilike("content", "%" + args.query.replace(/[%_,]/g, "") + "%").limit(5);
    return error ? { error: "lookup_failed" } : { records: (data || []).map((x: Obj) => ({ ...x, content: String(x.content || "").slice(0, 900) })) };
  }
  return { error: "runtime_record_operation_not_supported" };
}
