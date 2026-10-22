import { classifyToolReceipt } from "../_shared/sandy-executive/receipt.ts";

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 1e9;

/** Only the server's customer/request-scoped task query supplies these values.
 * Persisted execution metadata supports assessment; it does not independently
 * attest a provider effect. Never forward arbitrary tool outputs or identifiers.
 */
export function pilotExecutionEvidence(edgeStatus: number, taskStatus: unknown, trace: unknown) {
  const tools: Obj[] = [];
  if (Array.isArray(trace)) for (const entry of trace.slice(0, 64)) {
    if (!object(entry) || typeof entry.tool !== "string" || !/^[a-z][a-z0-9_.:-]{0,99}$/i.test(entry.tool)) continue;
    const tool: Obj = { tool: entry.tool, disposition: classifyToolReceipt(entry) };
    for (const key of ["success", "read_only", "send_executed", "sent_mail_verified", "duplicate_prevented"])
      if (typeof entry[key] === "boolean") tool[key] = entry[key];
    for (const key of ["count", "record_count", "citations"])
      if (count(entry[key])) tool[key] = entry[key];
    if (Number.isInteger(entry.provider_status) && Number(entry.provider_status) >= 100 && Number(entry.provider_status) <= 599)
      tool.provider_status = entry.provider_status;
    if (typeof entry.timezone === "string") {
      try { new Intl.DateTimeFormat("en", { timeZone: entry.timezone }); tool.timezone = entry.timezone; } catch { /* Unverified zone omitted. */ }
    }
    if (object(entry.deadline_evidence)) {
      const deadlines: Obj = {};
      for (const key of ["total_overdue", "total_tasks", "total_outstanding"])
        if (count(entry.deadline_evidence[key])) deadlines[key] = entry.deadline_evidence[key];
      if (typeof entry.deadline_evidence.complete === "boolean") deadlines.complete = entry.deadline_evidence.complete;
      if (Object.keys(deadlines).length) tool.deadline_evidence = deadlines;
    }
    tools.push(tool);
  }
  return {
    source: "server_persisted_customer_request_task",
    edge_status: Number.isInteger(edgeStatus) && edgeStatus >= 100 && edgeStatus <= 599 ? edgeStatus : null,
    task_status: ["queued", "running", "completed", "failed"].includes(String(taskStatus)) ? taskStatus : null,
    tools,
    trace_truncated: Array.isArray(trace) && trace.length > 64,
    provider_effect_independently_verified: false,
  };
}
