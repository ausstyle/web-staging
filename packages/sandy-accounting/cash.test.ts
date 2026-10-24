import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";
import { allocate } from "./allocation.ts";

test("cash recognition allocates exact cents without exceeding remaining component budgets", () => {
  let budgets = [{ ordinal: 1, account_id: "sales", amount: "10000" }, {
    ordinal: 2,
    account_id: "tax",
    amount: "1000",
  }];
  const expected = [["3334", "333"], ["3333", "334"], ["3333", "333"]];
  for (const [index, payment] of [3667n, 3667n, 3666n].entries()) {
    const components = allocate(payment, budgets);
    assert.deepEqual(components.map((c) => c.amount), expected[index]);
    budgets = budgets.map((c) => ({
      ...c,
      amount: (BigInt(c.amount) - BigInt(
        components.find((x) => x.ordinal === c.ordinal)!.amount,
      )).toString(),
    }));
  }
  assert.deepEqual(budgets.map((c) => c.amount), ["0", "0"]);
  const ties = [1, 2, 3].map((ordinal) => ({
    ordinal,
    account_id: "sales",
    amount: "1",
  }));
  assert.deepEqual(allocate(1n, ties), [ties[0]]);
  assert.throws(() => allocate(4n, ties), /allocation_budget/);
});

test("cash view follows partial receipts/payments and exact dated reversals without rewriting accrual", async () => {
  const f = await fixture();
  try {
    await f.run("accounting.ledger.journal.post", f.journal());
    const input = f.document();
    input.lines[0] = {
      ...input.lines[0],
      tax: "10.00",
      tax_account: "tax",
      tax_rule_ref: f.source,
    } as any;
    const invoice = await f.run("accounting.sales.invoice.draft", input);
    const bill = await f.run(
      "accounting.payables.bill.draft",
      f.document("bill", "30.00"),
    );
    for (const document of [invoice, bill]) {
      await f.run("accounting.documents.approve", {
        document_id: document.document_id,
        expected_version: 1,
      });
    }
    const report = (
      report: string,
      through: string,
      basis = "cash",
      from?: string,
    ) =>
      f.run("accounting.reporting.run", {
        report,
        through,
        basis,
        ...(from ? { from } : {}),
      });
    assert.equal(
      (await report("profit_and_loss", "2026-10-02")).profit,
      "0.00",
    );
    assert.equal(
      (await report("profit_and_loss", "2026-10-02", "accrual")).profit,
      "70.00",
    );
    const receipt = await f.run("accounting.documents.payment.record", {
      document_id: invoice.document_id,
      expected_version: 2,
      amount: "36.67",
      effective_date: "2026-10-03",
      bank_account: "bank",
      evidence: [f.source],
    });
    await f.run("accounting.documents.payment.record", {
      document_id: bill.document_id,
      expected_version: 2,
      amount: "10.00",
      effective_date: "2026-10-03",
      bank_account: "bank",
      evidence: [f.source],
    });
    const auditBefore = await f.run("accounting.audit.verify");
    const cash = await report("trial_balance", "2026-10-03");
    assert.deepEqual(
      Object.fromEntries(cash.rows.map((r: any) => [r.account_id, r.amount])),
      {
        bank: "1026.67",
        capital: "-1000.00",
        sales: "-33.34",
        tax: "-3.33",
        expense: "10.00",
      },
    );
    assert.equal(cash.debit_total, cash.credit_total);
    assert.equal(cash.ledger_mutated, false);
    assert.equal(
      (await report("profit_and_loss", "2026-10-03")).profit,
      "23.34",
    );
    const sales = cash.rows.find((r: any) => r.account_id === "sales");
    assert.equal(
      sales.contributors[0].source_journal_id !== receipt.journal_id,
      true,
    );
    assert.equal(sales.contributors[0].allocation_id, receipt.allocation_id);
    assert.deepEqual(await f.run("accounting.audit.verify"), auditBefore);
    await f.run("accounting.documents.payment.reverse", {
      allocation_id: receipt.allocation_id,
      expected_version: 3,
      effective_date: "2026-10-04",
      reason: "Synthetic wrong receipt",
      evidence: [f.source],
    });
    assert.equal(
      (await report("profit_and_loss", "2026-10-03")).profit,
      "23.34",
    );
    assert.equal(
      (await report("profit_and_loss", "2026-10-04", "cash", "2026-10-04"))
        .profit,
      "-33.34",
    );
    assert.equal(
      (await report("profit_and_loss", "2026-10-04")).profit,
      "-10.00",
    );
    await f.run("accounting.documents.payment.record", {
      document_id: invoice.document_id,
      expected_version: 4,
      amount: "110.00",
      effective_date: "2026-10-05",
      bank_account: "bank",
      evidence: [f.source],
    });
    assert.equal(
      (await report("profit_and_loss", "2026-10-05")).profit,
      "90.00",
    );
    assert.equal(
      (await report("profit_and_loss", "2026-10-05", "accrual")).profit,
      "70.00",
    );
    const bs = await report("balance_sheet", "2026-10-05");
    assert.equal(bs.profit, "90.00");
    assert.equal(
      bs.rows.find((r: any) => r.account_id === "tax").amount,
      "-10.00",
    );
  } finally {
    await f.db.close();
  }
});

test("manual cash inclusion is explicit for non-bank adjustments and retained on reversal", async () => {
  const f = await fixture();
  try {
    const args = {
      ...f.journal("5.00"),
      lines: [{ account_id: "expense", amount: "5.00" }, {
        account_id: "capital",
        amount: "-5.00",
      }],
    };
    await f.run("accounting.ledger.journal.post", args);
    const j = await f.run("accounting.ledger.journal.post", {
      ...args,
      cash_basis: true,
    });
    const report = () =>
      f.run("accounting.reporting.run", {
        report: "profit_and_loss",
        through: "2026-10-31",
        basis: "cash",
      });
    assert.equal((await report()).profit, "-5.00");
    await f.run("accounting.ledger.journal.reverse", {
      journal_id: j.journal_id,
      effective_date: "2026-10-02",
      reason: "Synthetic adjustment correction",
      evidence: [f.source],
    });
    assert.equal((await report()).profit, "0.00");
  } finally {
    await f.db.close();
  }
});
