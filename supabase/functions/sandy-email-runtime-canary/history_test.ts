import assert from "node:assert/strict";
import { emailExecutiveHistory } from "./history.ts";
const source = { customer_id: "10000000-0000-4000-8000-000000000001", conversation_id: "20000000-0000-4000-8000-000000000002", created_at: "2026-10-22T10:00:00Z" };
Deno.test("email history is bound to the source customer/thread and excludes unsent drafts", async () => {
  const filters: unknown[][] = [];
  const chronological = [
    { direction: "incoming", body_text: "Earlier question" },
    { direction: "outgoing", delivery_status: "draft", body_text: "Unsent draft must not be a reply" },
    { direction: "outgoing", delivery_status: "sent", provider_message_id: "receipt", sent_at: "2026-10-22T09:00:00Z", body_text: "Actually delivered answer" },
    { direction: "outgoing", delivery_status: "sent", provider_message_id: "later", sent_at: "2026-10-22T11:00:00Z", body_text: "Future delivery must not be prior context" },
    { direction: "incoming", body_text: "Unanswered follow-up" },
  ];
  const q: any = { then: (resolve: any) => Promise.resolve({ data: [...chronological].reverse() }).then(resolve) };
  for (const method of ["select", "eq", "lt", "order", "limit"]) q[method] = (...args: unknown[]) => { filters.push([method, ...args]); return q; };
  const result = await emailExecutiveHistory({ from: (table: string) => { assert.equal(table, "email_messages"); return q; } }, source);
  assert.deepEqual(result, [{ user: "Earlier question", assistant: "Actually delivered answer" }]);
  assert(filters.some(x => x[0] === "eq" && x[1] === "customer_id" && x[2] === source.customer_id));
  assert(filters.some(x => x[0] === "eq" && x[1] === "conversation_id" && x[2] === source.conversation_id));
  assert(filters.some(x => x[0] === "lt" && x[1] === "created_at" && x[2] === source.created_at));
});
Deno.test("unthreaded email has no invented history and source/query failures remain visible", async () => {
  assert.deepEqual(await emailExecutiveHistory({}, { ...source, conversation_id: null }), []);
  await assert.rejects(emailExecutiveHistory({}, { ...source, customer_id: "forged" }));
  const q: any = { then: (resolve: any) => Promise.resolve({ error: {} }).then(resolve) };
  for (const method of ["select", "eq", "lt", "order", "limit"]) q[method] = () => q;
  await assert.rejects(emailExecutiveHistory({ from: () => q }, source), /email_history_unavailable/);
});
