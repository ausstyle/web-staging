import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";
import { forecast } from "./forecast.ts";
test("partial payment correction and invoice void retain historical ageing and GL lineage", async () => {
  const f = await fixture();
  try {
    const d = await f.run("accounting.sales.invoice.draft", f.document());
    await f.run("accounting.documents.approve", {
      document_id: d.document_id,
      expected_version: 1,
    });
    const payment = await f.run("accounting.documents.payment.record", {
      document_id: d.document_id,
      expected_version: 2,
      amount: "40.00",
      effective_date: "2026-10-03",
      bank_account: "bank",
      evidence: [f.source],
    });
    const correction = {
      effective_date: "2026-10-04",
      reason: "Synthetic receipt entered in error",
      evidence: [f.source],
    };
    await assert.rejects(
      f.run("accounting.documents.void", {
        document_id: d.document_id,
        expected_version: 3,
        ...correction,
      }),
      /reverse_payments_first/,
    );
    const rev = await f.run("accounting.documents.payment.reverse", {
      allocation_id: payment.allocation_id,
      expected_version: 3,
      ...correction,
    });
    assert.equal(rev.money_moved, false);
    const aged = (through: string) =>
      f.run("accounting.reporting.run", {
        report: "aged_receivables",
        through,
        basis: "accrual",
      });
    assert.equal((await aged("2026-10-03")).rows[0].amount, "60.00");
    assert.equal((await aged("2026-10-04")).rows[0].amount, "100.00");
    await f.run("accounting.documents.void", {
      document_id: d.document_id,
      expected_version: 4,
      ...correction,
      effective_date: "2026-10-05",
    });
    assert.equal((await aged("2026-10-04")).rows.length, 1);
    assert.equal((await aged("2026-10-05")).rows.length, 0);
    const tb = await f.run("accounting.reporting.run", {
      report: "trial_balance",
      through: "2026-10-31",
      basis: "accrual",
    });
    assert.equal(tb.debit_total, "0.00");
    assert.equal(tb.credit_total, "0.00");
    await assert.rejects(
      f.run("accounting.documents.payment.record", {
        document_id: d.document_id,
        expected_version: 5,
        amount: "40.00",
        effective_date: "2026-10-06",
        bank_account: "bank",
        evidence: [f.source],
      }),
      /unapproved_or_void/,
    );
    assert.equal((await f.run("accounting.audit.verify")).events, 5);
  } finally {
    await f.db.close();
  }
});
test("13-week and 12-month cash scenarios have exact sums, stable month ends, explicit assumptions", () => {
  const input = {
    as_of: "2026-10-01",
    captured_at: "2026-10-01T00:00:00Z",
    currency: "AUD",
    precision: 2,
    opening: "1000.00",
    horizon: "13_weeks" as const,
    flows: [{
      source_id: "invoice",
      due: "2026-10-02",
      amount: "100.00",
      probability_bps: 8000,
    }, {
      source_id: "bill",
      due: "2026-10-05",
      amount: "-30.00",
      probability_bps: 10000,
    }, {
      source_id: "late",
      due: "2027-05-01",
      amount: "200.00",
      probability_bps: 10000,
    }],
  };
  const base = forecast(input);
  assert.equal(base.buckets.length, 13);
  assert.equal(base.buckets[0].closing, "1050.00");
  assert.equal(base.buckets[12].closing, "1050.00");
  assert.deepEqual(base.excluded_source_ids, ["late"]);
  assert.equal(base.ledger_mutated, false);
  const alternative = forecast({
    ...input,
    flows: input.flows.map((f) => ({ ...f, probability_bps: 10000 })),
  });
  assert.equal(alternative.buckets[0].closing, "1070.00");
  const months = forecast({
    ...input,
    as_of: "2026-01-31",
    horizon: "12_months",
  });
  assert.equal(months.buckets[0].until_exclusive, "2026-02-28");
  assert.equal(months.buckets[1].until_exclusive, "2026-03-31");
  assert.equal(months.buckets.length, 12);
  assert.throws(
    () => forecast({ ...input, flows: [...input.flows, input.flows[0]] }),
    /forecast_input/,
  );
});
