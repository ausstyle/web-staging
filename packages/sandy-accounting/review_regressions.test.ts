import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";

// Expected balances supplied by the separate financial reviewer at 995283e.
test("review oracle: dated payments/credits/reversals preserve seven historical cutoffs", async () => {
  const f = await fixture();
  try {
    // Independently specified postings for payments, credits and out-of-order reversal dates.
    const input = f.document();
    Object.assign(input.lines[0], {
      tax: "10.00",
      tax_account: "tax",
      tax_rule_ref: f.source,
    });
    const d = await f.run("accounting.sales.invoice.draft", input);
    await f.run("accounting.documents.approve", {
      document_id: d.document_id,
      expected_version: 1,
    });
    let version = 2;
    const evidence = [f.source];
    const pay = async (amount: string, day: string) =>
      f.run("accounting.documents.payment.record", {
        document_id: d.document_id,
        expected_version: version++,
        amount,
        effective_date: day,
        bank_account: "bank",
        evidence,
      });
    const credit = async (amount: string, day: string, number: string) =>
      f.run("accounting.documents.credit.record", {
        document_id: d.document_id,
        expected_version: version++,
        amount,
        effective_date: day,
        number,
        reason: "synthetic",
        evidence,
      });
    const p1 = await pay("36.67", "2026-10-03");
    const c1 = await credit("22.00", "2026-10-04", "C1");
    await pay("22.00", "2026-10-10");
    await f.run("accounting.documents.payment.reverse", {
      allocation_id: p1.allocation_id,
      expected_version: version++,
      effective_date: "2026-10-08",
      reason: "synthetic",
      evidence,
    });
    await credit("55.00", "2026-10-12", "C2");
    await f.run("accounting.documents.credit.reverse", {
      credit_id: c1.credit_id,
      expected_version: version++,
      effective_date: "2026-10-06",
      reason: "synthetic",
      evidence,
    });
    const oracle = [
      ["2026-10-02", { ar: "110.00", sales: "-100.00", tax: "-10.00" }, "0.00"],
      ["2026-10-03", {
        ar: "73.33",
        bank: "36.67",
        sales: "-100.00",
        tax: "-10.00",
      }, "33.34"],
      ["2026-10-04", {
        ar: "51.33",
        bank: "36.67",
        sales: "-80.00",
        tax: "-8.00",
      }, "33.34"],
      ["2026-10-06", {
        ar: "73.33",
        bank: "36.67",
        sales: "-100.00",
        tax: "-10.00",
      }, "33.34"],
      ["2026-10-08", {
        ar: "110.00",
        bank: "0.00",
        sales: "-100.00",
        tax: "-10.00",
      }, "0.00"],
      ["2026-10-10", {
        ar: "88.00",
        bank: "22.00",
        sales: "-100.00",
        tax: "-10.00",
      }, "20.00"],
      ["2026-10-12", {
        ar: "33.00",
        bank: "22.00",
        sales: "-50.00",
        tax: "-5.00",
      }, "20.00"],
    ] as const;
    for (const [through, expected, cashProfit] of oracle) {
      const report = await f.run("accounting.reporting.run", {
        report: "trial_balance",
        through,
        basis: "accrual",
      });
      const rows = Object.fromEntries(
        report.rows.map((r: any) => [r.account_id, r.amount]),
      );
      assert.deepEqual(rows, expected);
      assert.equal(report.debit_total, report.credit_total);
      const aged = await f.run("accounting.reporting.run", {
        report: "aged_receivables",
        through,
        basis: "accrual",
      });
      assert.equal(aged.rows[0].amount, expected.ar);
      const cash = await f.run("accounting.reporting.run", {
        report: "profit_and_loss",
        through,
        basis: "cash",
      });
      assert.equal(cash.profit, cashProfit);
    }
  } finally {
    await f.db.close();
  }
});

test("review FX half-boundaries use exact SQL integer division and exact reversals", async () => {
  const f = await fixture();
  try {
    const vectors = [
      ["0.03", 2, "499999999999999999", "999999999999999999", "1"],
      ["0.03", 2, "1", "2", "2"],
      ["0.03", 2, "500000000000000000", "999999999999999999", "2"],
      ["14999999999999999.98", 2, "1", "999999999999999999", "1"],
      ["0.030", 3, "499999999999999999", "999999999999999999", "1"],
    ] as const;
    for (
      const [amount, precision, numerator, denominator, expected] of vectors
    ) {
      const j = await f.run("accounting.ledger.journal.post", {
        ...f.journal(amount),
        currency: "USD",
        precision,
        fx: { numerator, denominator, date: "2026-10-01", source: f.source },
      });
      assert.deepEqual(j.lines.map((line: any) => line.base_amount), [
        expected,
        "-" + expected,
      ]);
      const reversed = await f.run("accounting.ledger.journal.reverse", {
        journal_id: j.journal_id,
        effective_date: "2026-10-02",
        reason: "Synthetic FX review reversal",
        evidence: [f.source],
      });
      assert.deepEqual(reversed.lines.map((line: any) => line.base_amount), [
        "-" + expected,
        expected,
      ]);
    }
    const report = (through: string) =>
      f.run("accounting.reporting.run", {
        report: "trial_balance",
        through,
        basis: "accrual",
      });
    assert.equal(
      (await report("2026-10-01")).rows.find((row: any) =>
        row.account_id === "bank"
      ).amount,
      "0.07",
    );
    assert.equal(
      (await report("2026-10-02")).rows.find((row: any) =>
        row.account_id === "bank"
      ).amount,
      "0.00",
    );
    for (const bad of [null, 1, 9007199254740992]) {
      await assert.rejects(
        f.run("accounting.ledger.journal.post", {
          ...f.journal("1.00"),
          currency: "USD",
          fx: {
            numerator: bad,
            denominator: "2",
            date: "2026-10-01",
            source: f.source,
          },
        }),
        /fx_ratio/,
      );
    }
    assert.equal((await f.run("accounting.audit.verify")).valid, true);
  } finally {
    await f.db.close();
  }
});

test("review direct-role guards reject manual AR/AP, unknown source and inexact FX postings", async () => {
  const f = await fixture();
  try {
    const direct = (
      account: string,
      source = "manual",
      fx: any = null,
      amount = "2500",
      base = "2500",
    ) =>
      f.db.transaction(async (tx) => {
        await tx.query("SET LOCAL ROLE accounting_fixture");
        await tx.query(
          "SELECT set_config('accounting.tenant','synthetic-tenant',true),set_config('accounting.company','synthetic-company',true),set_config('accounting.actor','synthetic-reviewer',true)",
        );
        const id = crypto.randomUUID();
        await tx.query(
          "INSERT INTO accounting.journals(tenant_id,company_id,id,effective_date,narration,currency,precision,evidence,actor_id,source,fx) VALUES('synthetic-tenant','synthetic-company',$1,'2026-10-01','Synthetic review',$2,2,$3,'synthetic-reviewer',$4,$5)",
          [
            id,
            fx ? "USD" : "AUD",
            JSON.stringify([f.source]),
            source,
            fx ? JSON.stringify(fx) : null,
          ],
        );
        await tx.query(
          "INSERT INTO accounting.lines VALUES('synthetic-tenant','synthetic-company',$1,0,$2,$3,$4),('synthetic-tenant','synthetic-company',$1,1,'capital',-$3::numeric,-$4::numeric)",
          [id, account, amount, base],
        );
        await tx.query(
          "UPDATE accounting.journals SET state='POSTED' WHERE id=$1",
          [id],
        );
      });
    for (const account of ["ar", "ap"]) {
      await assert.rejects(direct(account), /subledger_operation_required/);
    }
    await assert.rejects(
      direct("bank", "unrecognised_source"),
      /journal_source/,
    );
    const fx = {
      numerator: "499999999999999999",
      denominator: "999999999999999999",
      date: "2026-10-01",
      source: f.source,
    };
    await assert.rejects(
      direct("bank", "manual", fx, "3", "2"),
      /fx_conversion_mismatch/,
    );
    for (const bad of [null, 1]) {
      await assert.rejects(
        direct("bank", "manual", { ...fx, numerator: bad }),
        /fx_ratio/,
      );
    }
    assert.equal(
      (await f.db.query("SELECT * FROM accounting.journals")).rows.length,
      0,
    );
    assert.equal((await f.run("accounting.audit.verify")).events, 0);
  } finally {
    await f.db.close();
  }
});
