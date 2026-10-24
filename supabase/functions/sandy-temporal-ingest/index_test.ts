import assert from "node:assert/strict";
import { createTemporalIngestHandler } from "./index.ts";
const owner = "10000000-0000-4000-8000-000000000001",
  id = "20000000-0000-4000-8000-000000000001",
  ref = "30000000-0000-4000-8000-000000000001";
function fixture(
  options: {
    deny?: boolean;
    finishDenied?: boolean;
    providerFailure?: boolean;
  } = {},
) {
  const calls: { name: string; args: any }[] = [],
    models: any[] = [],
    updates: any[] = [];
  const job = {
    id,
    customer_id: owner,
    source_channel: "web",
    source_ref: ref,
    attempts: 1,
    updated_at: "2026-10-24T00:00:00Z",
  };
  const expected = {
    ok: true,
    job_id: id,
    attempts: 1,
    claim_updated_at: job.updated_at,
    source: {
      customer_id: owner,
      source_channel: "web",
      source_ref: ref,
      text: "My current timezone is UTC for this week.",
      observed_at: job.updated_at,
      author_role: "owner",
    },
  };
  const db = {
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "sandy_temporal_automatic_prepare") {
        return {
          data: options.deny
            ? {
              ok: false,
              state: "skipped",
              error: "automatic_learning_not_authorized",
            }
            : expected,
        };
      }
      if (name === "sandy_temporal_automatic_finish") {
        return {
          data: options.finishDenied
            ? {
              ok: false,
              persisted: false,
              state: "skipped",
              error: "automatic_learning_consent_or_source_changed",
            }
            : { ok: true, persisted: true, inserted: 1, state: "completed" },
        };
      }
      if (name === "sandy_temporal_automatic_enqueue") {
        return { data: { ok: true, queued: true, job_id: id } };
      }
      throw Error("unexpected_rpc");
    },
    from: (table: string) => {
      assert.equal(table, "sandy_temporal_ingestion_jobs");
      let update: any;
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => ({ data: [{ ...job, attempts: 0 }] }),
        update: (u: any) => {
          update = u;
          updates.push(u);
          return chain;
        },
        maybeSingle: async () => ({
          data: update?.state === "processing" ? job : { id },
        }),
      };
      return chain;
    },
  };
  const handler = createTemporalIngestHandler({
    db,
    serviceKey: "private-unit-service",
    schedulerKey: "private-unit-scheduler",
    openaiKey: "private-unit-model",
    request: (async (url, init) => {
      models.push({ url, init });
      if (options.providerFailure) {
        throw Error("private source text must never be logged");
      }
      return Response.json({
        id: "isolated-provider-response",
        choices: [{
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              facts: [{
                predicate: "timezone.current",
                value: { timezone: "UTC" },
                source_quote: "My current timezone is UTC",
                sensitive: false,
              }],
            }),
          },
        }],
      });
    }) as typeof fetch,
  });
  const request = (body: unknown = {}, auth = "Bearer private-unit-service") =>
    handler(
      new Request("https://unit.invalid", {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { calls, models, updates, request };
}
Deno.test("private authentication fails before queue, source RPC or provider access", async () => {
  const f = fixture();
  assert.equal((await f.request({}, "Bearer invalid-unit")).status, 403);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.updates, []);
  assert.deepEqual(f.models, []);
});
Deno.test("missing consent/source admission cannot read raw source tables or invoke model/write facts", async () => {
  const f = fixture({ deny: true });
  const r = await (await f.request()).json();
  assert.equal(r.processed, 0);
  assert.equal(r.skipped, 1);
  assert.equal(f.models.length, 0);
  assert.deepEqual(f.calls.map((x) => x.name), [
    "sandy_temporal_automatic_prepare",
  ]);
});
Deno.test("one admitted bounded store:false request uses only guarded source then atomic finish", async () => {
  const f = fixture();
  const r = await (await f.request()).json();
  assert.equal(r.processed, 1);
  assert.equal(f.models.length, 1);
  const request = JSON.parse(f.models[0].init.body);
  assert.equal(request.store, false);
  assert.equal(request.max_completion_tokens, 1200);
  assert.equal(f.models[0].init.redirect, "error");
  const finish = f.calls.find((x) =>
    x.name === "sandy_temporal_automatic_finish"
  )!;
  assert.equal(finish.args.p_expected.source.customer_id, owner);
  assert.equal(
    finish.args.p_receipt.provider_response_id,
    "isolated-provider-response",
  );
  assert.match(finish.args.p_receipt.response_sha256, /^[a-f0-9]{64}$/);
});
Deno.test("post-model revoked or edited source result never propagates a successful insertion", async () => {
  const f = fixture({ finishDenied: true });
  const r = await (await f.request()).json();
  assert.equal(r.processed, 0);
  assert.equal(r.results[0].inserted, 0);
  assert.equal(r.results[0].state, "skipped");
  assert.equal(f.models.length, 1);
});
Deno.test("provider uncertainty is terminal review, contains no raw error and never retries model", async () => {
  const f = fixture({ providerFailure: true });
  const r = await (await f.request()).json();
  assert.equal(r.processed, 0);
  assert.equal(r.needs_review, 1);
  assert.equal(f.models.length, 1);
  assert.equal(
    f.calls.some((x) => x.name === "sandy_temporal_automatic_finish"),
    false,
  );
  assert.equal(JSON.stringify(r).includes("private source text"), false);
  assert.ok(f.updates.some((x) => x.state === "needs_review"));
});
Deno.test("targeted intake validates ownership through SQL before processing and rejects partial source requests", async () => {
  const f = fixture({ deny: true });
  assert.equal((await f.request({ source_channel: "voice" })).status, 400);
  assert.equal(f.calls.length, 0);
  await f.request({
    source_channel: "voice",
    source_ref: "101",
    customer_id: owner,
    limit: 3,
  });
  assert.equal(f.calls[0].name, "sandy_temporal_automatic_enqueue");
  assert.equal(f.calls[0].args.p_ref, "101");
  assert.equal(f.models.length, 0);
});
