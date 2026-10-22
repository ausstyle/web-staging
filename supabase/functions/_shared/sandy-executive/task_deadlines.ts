type RecordValue = Record<string, any>;
const object = (v: unknown): v is RecordValue => !!v && typeof v === "object" && !Array.isArray(v);

// Database due_at values denote instants. Reject date-only/local/invalid values
// rather than allowing Date.parse to guess a zone or normalize an invalid day.
function instant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const p = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/);
  if (!p) return null;
  const [, y, m, d, h, min, sec, oh, om] = p;
  const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  if (+m < 1 || +m > 12 || +d < 1 || +d > days || +h > 23 || +min > 59 || +sec > 59 ||
      (oh !== undefined && (+oh > 14 || +om > 59 || (+oh === 14 && +om !== 0)))) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Enrich an already authorized task-tool result at the Executive boundary.
 * Does not read records, authorize callers, change deadlines or execute effects.
 * Counts always refer to the returned snapshot, never to conversation memory.
 */
export function taskDeadlineEvidence(result: RecordValue, asOf: Date): RecordValue {
  if (result.error || !Array.isArray(result.tasks) || result.tasks.some((t: unknown) => !object(t))) return result;
  if (!Number.isFinite(asOf.getTime())) return result;
  const tasks = result.tasks.map((task: RecordValue) => {
    const due = instant(task.due_at);
    const state = task.due_at === null ? "no_deadline" : due === null ? "unknown" :
      due < asOf.getTime() ? "overdue" : due === asOf.getTime() ? "due_now" : "upcoming";
    return { ...task, deadline_state: state };
  });
  const overdue = tasks.filter((t: RecordValue) => t.deadline_state === "overdue").length;
  const unknown = tasks.filter((t: RecordValue) => t.deadline_state === "unknown").length;
  const complete = Number.isInteger(result.outstanding_count) && result.outstanding_count === tasks.length &&
    result.shown_count === tasks.length && unknown === 0;
  return { ...result, tasks, deadline_evidence: {
    as_of: asOf.toISOString(), definition: "An outstanding task is overdue when its recorded due_at instant is strictly earlier than as_of.",
    coverage: complete ? "complete" : "partial", assessed_records: tasks.length,
    overdue_in_returned_records: overdue, unknown_deadlines: unknown,
    total_overdue: complete ? overdue : null,
  } };
}
