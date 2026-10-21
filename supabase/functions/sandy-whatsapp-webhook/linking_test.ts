import { linkingCommand, sha256 } from "./helpers.ts";
const wa = "15550000001", id = "11111111-1111-4111-8111-111111111111";
const email = "fixture@example.invalid";
function assert(value: unknown) { if (!value) throw Error("assertion failed"); }
function database(result: unknown, failure: unknown = null) {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const selections: string[] = [];
  const chain = {
    select: (selection: string) => { selections.push(selection); return chain; },
    eq: () => chain, is: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: { id, email }, error: null }),
  };
  return {
    calls, selections,
    db: {
      from: (name: string) => { assert(name === "sandy_whatsapp_link_challenges"); return chain; },
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, arguments: args });
        return Promise.resolve({ data: result, error: failure });
      },
    },
  };
}
Deno.test("linking completion delegates one bound hash to the atomic service", async () => {
  const mock = database({ ok: true, state: "verified", identity_merged: false });
  const result = await linkingCommand(mock.db, wa, "VERIFY 123456");
  assert(result?.startsWith("Your WhatsApp number is verified"));
  assert(mock.calls.length === 1 && mock.calls[0].name === "sandy_customer_whatsapp_link_finish");
  assert(JSON.stringify(mock.calls[0].arguments) === JSON.stringify({ p_wa_id: wa, p_challenge_id: id, p_candidate_hash: await sha256(wa + ":" + email + ":123456") }));
  assert(JSON.stringify(mock.selections) === JSON.stringify(["id,email"]));
});
for (const [error, prefix] of [
  ["invalid_link_proof", "That verification code is incorrect"],
  ["link_attempts_exceeded", "Verification attempts exceeded"],
  ["identity_link_conflict", "This number is already associated"],
  ["link_challenge_unavailable", "There is no active verification code"],
]) Deno.test("link completion truthfully reports " + error, async () => {
  const mock = database({ ok: false, error });
  assert((await linkingCommand(mock.db, wa, "123456"))?.startsWith(prefix));
});
for (const [label, result, failure] of [
  ["transport failure", null, { message: "private upstream details" }],
  ["unrecognized failure", { ok: false, error: "unexpected" }, null],
  ["missing verified state", { ok: true }, null],
  ["unexpected identity merging", { ok: true, state: "verified", identity_merged: true }, null],
]) Deno.test("link completion refuses misleading success after " + label, async () => {
  const mock = database(result, failure);
  let refused = false;
  try { await linkingCommand(mock.db, wa, "123456"); }
  catch (error) { refused = error instanceof Error && error.message === "link_completion_unavailable"; }
  assert(refused);
});
