import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";
import { forecast } from "./forecast.ts";
test("supplier payment correction preserves AP history and exposes the unmatched bank evidence", async () => {
  const f = await fixture();
  try {
    await f.run("accounting.ledger.journal.post", f.journal());
    const bill = await f.run(
      "accounting.payables.bill.draft",
      f.document("bill"),
    );
    await f.run("accounting.documents.approve", {
      document_id: bill.document_id,
      expected_version: 1,
    });
    const payment = await f.run("accounting.documents.payment.record", {
      document_id: bill.document_id,
      expected_version: 2,
      amount: "40.00",
      effective_date: "2026-10-03",
      bank_account: "bank",
      evidence: [f.source],
    });
    const s = await f.run("accounting.banking.statements.import", {
      bank_account: "bank",
      lines: [{
        source_key: "supplier-payment",
        effective_date: "2026-10-03",
        amount: "-40.00",
        reference: "Synthetic supplier debit",
        evidence: [f.source],
      }],
    });
    const match = await f.run("accounting.banking.reconcile.apply", {
      statement_id: s.statement_ids[0],
      journal_id: payment.journal_id,
      ordinal: 0,
      amount: "-40.00",
    });
    const correction = {
      allocation_id: payment.allocation_id,
      expected_version: 3,
      effective_date: "2026-10-04",
      reason: "Synthetic payment attributed to wrong document",
      evidence: [f.source],
    };
    await assert.rejects(
      f.run("accounting.documents.payment.reverse", correction),
      /unreconcile_first/,
    );
    await f.run("accounting.banking.reconcile.reverse", {
      match_id: match.match_id,
      reason: correction.reason,
    });
    await f.run("accounting.documents.payment.reverse", correction);
    const report = (name: string, through: string) =>
      f.run("accounting.reporting.run", {
        report: name,
        through,
        basis: "accrual",
      });
    assert.equal(
      (await report("aged_payables", "2026-10-03")).rows[0].amount,
      "60.00",
    );
    assert.equal(
      (await report("aged_payables", "2026-10-04")).rows[0].amount,
      "100.00",
    );
    const beforeVoid = await report("trial_balance", "2026-10-03");
    assert.deepEqual(
      Object.fromEntries(
        beforeVoid.rows.map((r: any) => [r.account_id, r.amount]),
      ),
      {
        bank: "960.00",
        capital: "-1000.00",
        expense: "100.00",
        ap: "-60.00",
      },
    );
    await f.run("accounting.documents.void", {
      document_id: bill.document_id,
      expected_version: 4,
      effective_date: "2026-10-05",
      reason: "Synthetic supplier bill entered in error",
      evidence: [f.source],
    });
    assert.equal(
      (await report("aged_payables", "2026-10-04")).rows[0].amount,
      "100.00",
    );
    assert.equal((await report("aged_payables", "2026-10-05")).rows.length, 0);
    assert.equal(
      (await report("profit_and_loss", "2026-10-04")).profit,
      "-100.00",
    );
    assert.equal(
      (await report("profit_and_loss", "2026-10-05")).profit,
      "0.00",
    );
    const workspace = await f.run("accounting.workspace.get");
    assert.equal(workspace.payments.length, 1);
    assert.equal(workspace.payments[0].amount, "4000");
    assert.equal(
      workspace.payments[0].effective_date.toISOString().slice(0, 10),
      "2026-10-03",
    );
    assert.equal(
      workspace.payments[0].reversal_date.toISOString().slice(0, 10),
      "2026-10-04",
    );
    assert.equal(workspace.statements.length, 1);
    const bank = (await report("bank_reconciliation", "2026-10-05")).rows[0];
    assert.equal(bank.book, "1000.00");
    assert.equal(bank.statement, "-40.00");
    assert.deepEqual(bank.unmatched_statement_ids, s.statement_ids);
    assert.equal((await f.run("accounting.audit.verify")).valid, true);
  } finally {
    await f.db.close();
  }
});
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
