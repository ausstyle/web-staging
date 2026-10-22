import assert from "node:assert/strict";
import { taskDeadlineEvidence } from "./task_deadlines.ts";

const now = new Date("2026-10-21T22:46:00Z");
const snapshot = (...dates: unknown[]) => ({ outstanding_count: dates.length, shown_count: dates.length,
  tasks: dates.map((due_at, i) => ({ id: String(i), status: "todo", due_at })) });

Deno.test("actual web regression: October 20 is overdue at the October 21 turn", () => {
  const result = taskDeadlineEvidence(snapshot("2026-10-20T06:00:00+00:00"), now);
  assert.equal(result.tasks[0].deadline_state, "overdue");
  assert.equal(result.deadline_evidence.total_overdue, 1);
  assert.equal(result.deadline_evidence.as_of, now.toISOString());
});
Deno.test("compare absolute instants across offsets, midnight and DST boundaries", () => {
  const at = new Date("2026-10-25T01:30:00Z");
  const result = taskDeadlineEvidence(snapshot("2026-10-25T02:30:00+02:00", "2026-10-25T02:30:00+01:00", "2026-10-24T21:31:00-04:00"), at);
  assert.deepEqual(result.tasks.map((t: any) => t.deadline_state), ["overdue", "due_now", "upcoming"]);
  assert.equal(result.deadline_evidence.total_overdue, 1);
});
Deno.test("a missing deadline is distinguished from an overdue or unknown deadline", () => {
  const result = taskDeadlineEvidence(snapshot(null, "2026-10-22T12:00:00Z"), now);
  assert.deepEqual(result.tasks.map((t: any) => t.deadline_state), ["no_deadline", "upcoming"]);
  assert.equal(result.deadline_evidence.total_overdue, 0);
});
Deno.test("invalid or local dates remain unknown, never a verified zero", () => {
  for (const date of [undefined, "", "yesterday", "2026-10-20", "2026-10-20T06:00:00", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-10-20T24:00:00Z", "2026-10-20T00:00:00+14:30"]) {
    const result = taskDeadlineEvidence(snapshot(date), now);
    assert.equal(result.tasks[0].deadline_state, "unknown", String(date));
    assert.equal(result.deadline_evidence.total_overdue, null);
  }
});
Deno.test("truncated results retain a lower bound, not an exact account count", () => {
  const result = taskDeadlineEvidence({ ...snapshot("2026-10-20T06:00:00Z"), outstanding_count: 151 }, now);
  assert.equal(result.deadline_evidence.overdue_in_returned_records, 1);
  assert.equal(result.deadline_evidence.total_overdue, null);
  assert.equal(result.deadline_evidence.coverage, "partial");
});
Deno.test("error and malformed snapshots cannot acquire deadline evidence", () => {
  for (const value of [{ error: "denied", ...snapshot(null) }, {}, { tasks: [null] }, { tasks: "not records" }]) {
    assert.equal(taskDeadlineEvidence(value, now), value);
  }
  const data = snapshot(null);
  assert.equal(taskDeadlineEvidence(data, new Date("invalid")), data);
});
Deno.test("no mutation of authorized records or transport fields", () => {
  const data = { ...snapshot("2026-10-20T06:00:00Z"), outstanding_count: 1, definition: "original", task_id: "bound-task" };
  const before = structuredClone(data);
  const result = taskDeadlineEvidence(data, now);
  assert.deepEqual(data, before);
  assert.equal(result.task_id, "bound-task");
  assert.equal(result.definition, "original");
  assert.equal(result.tasks[0].due_at, before.tasks[0].due_at);
});
Deno.test("microsecond database timestamps and empty complete snapshots are supported", () => {
  assert.equal(taskDeadlineEvidence(snapshot("2026-10-20T06:00:00.123456+00:00"), now).deadline_evidence.total_overdue, 1);
  assert.equal(taskDeadlineEvidence(snapshot(), now).deadline_evidence.total_overdue, 0);
});
