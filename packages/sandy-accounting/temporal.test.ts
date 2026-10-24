import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";
test("backdated replacement receipts cannot create historical overpayment", async () => {
  const f = await fixture();
  try {
    const d = await f.run("accounting.sales.invoice.draft", f.document());
    await f.run("accounting.documents.approve", {
      document_id: d.document_id,
      expected_version: 1,
    });
    const p = await f.run("accounting.documents.payment.record", {
      document_id: d.document_id,
      expected_version: 2,
      amount: "60.00",
      effective_date: "2026-10-03",
      bank_account: "bank",
      evidence: [f.source],
    });
    await f.run("accounting.documents.payment.reverse", {
      allocation_id: p.allocation_id,
      expected_version: 3,
      effective_date: "2026-10-10",
      reason: "Synthetic correction",
      evidence: [f.source],
    });
    await assert.rejects(
      f.run("accounting.documents.payment.record", {
        document_id: d.document_id,
        expected_version: 4,
        amount: "100.00",
        effective_date: "2026-10-05",
        bank_account: "bank",
        evidence: [f.source],
      }),
      /payment_before_history/,
    );
    await f.run("accounting.documents.payment.record", {
      document_id: d.document_id,
      expected_version: 4,
      amount: "100.00",
      effective_date: "2026-10-10",
      bank_account: "bank",
      evidence: [f.source],
    });
    const aged = await f.run("accounting.reporting.run", {
      report: "aged_receivables",
      through: "2026-10-05",
      basis: "accrual",
    });
    assert.equal(aged.rows[0].amount, "40.00");
  } finally {
    await f.db.close();
  }
});
test("period profit excludes earlier revenue while cumulative balance sheet retains it", async () => {
  const f = await fixture();
  try {
    for (
      const [day, amount] of [["2026-09-30", "50.00"], ["2026-10-01", "100.00"]]
    ) {
      await f.run("accounting.ledger.journal.post", {
        ...f.journal(amount, day),
        lines: [{ account_id: "bank", amount }, {
          account_id: "sales",
          amount: "-" + amount,
        }],
      });
    }
    const monthly = await f.run("accounting.reporting.run", {
      report: "profit_and_loss",
      from: "2026-10-01",
      through: "2026-10-31",
      basis: "accrual",
    });
    const cumulative = await f.run("accounting.reporting.run", {
      report: "balance_sheet",
      through: "2026-10-31",
      basis: "accrual",
    });
    assert.equal(monthly.profit, "100.00");
    assert.equal(cumulative.profit, "150.00");
  } finally {
    await f.db.close();
  }
});
