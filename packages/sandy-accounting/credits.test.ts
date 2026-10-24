import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";

for (const kind of ["invoice", "bill"]) {
  test(`${kind}: credit/payment races, exact allocations, historical reversal and void`, async () => {
    const f = await fixture();
    try {
      const input = f.document(kind);
      input.lines[0] = {
        ...input.lines[0],
        tax: "10.00",
        tax_account: "tax",
        tax_rule_ref: f.source,
      } as any;
      const d = await f.run(
        kind === "invoice"
          ? "accounting.sales.invoice.draft"
          : "accounting.payables.bill.draft",
        input,
      );
      await f.run("accounting.documents.approve", {
        document_id: d.document_id,
        expected_version: 1,
      });
      const args = {
        document_id: d.document_id,
        expected_version: 2,
        number: "CREDIT-1",
        amount: "55.00",
        effective_date: "2026-10-03",
        reason: "Synthetic agreed reduction",
        evidence: [f.source],
      };
      const duplicates = await Promise.all(
        Array.from(
          { length: 10 },
          () =>
            f.run("accounting.documents.credit.record", args, "same-credit"),
        ),
      );
      assert.equal(new Set(duplicates.map((c) => c.credit_id)).size, 1);
      const credit = duplicates[0];
      assert.equal(credit.remaining, "55.00");
      const report = (report: string, through: string, basis = "accrual") =>
        f.run("accounting.reporting.run", { report, through, basis });
      const aged = kind === "invoice" ? "aged_receivables" : "aged_payables";
      assert.equal((await report(aged, "2026-10-02")).rows[0].amount, "110.00");
      assert.equal((await report(aged, "2026-10-03")).rows[0].amount, "55.00");
      assert.equal(
        (await report("profit_and_loss", "2026-10-03")).profit,
        kind === "invoice" ? "50.00" : "-50.00",
      );
      assert.equal(
        (await report("profit_and_loss", "2026-10-03", "cash")).profit,
        "0.00",
      );
      await assert.rejects(
        f.run("accounting.documents.credit.record", {
          ...args,
          expected_version: 3,
          number: "OVER",
          amount: "55.01",
        }),
        /overcredit/,
      );
      await assert.rejects(
        f.run("accounting.documents.void", {
          document_id: d.document_id,
          expected_version: 3,
          effective_date: "2026-10-04",
          reason: "Wrong void",
          evidence: [f.source],
        }),
        /reverse_credits_first/,
      );
      const payArgs = {
        document_id: d.document_id,
        expected_version: 3,
        effective_date: "2026-10-04",
        amount: "55.00",
        bank_account: "bank",
        evidence: [f.source],
      };
      const attempts = await Promise.allSettled([
        f.run("accounting.documents.payment.record", payArgs),
        f.run("accounting.documents.payment.record", payArgs),
      ]);
      assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
      const payment = attempts.find((r) => r.status === "fulfilled")!.value;
      assert.equal(payment.remaining, "0.00");
      assert.equal(
        (await report("profit_and_loss", "2026-10-04", "cash")).profit,
        kind === "invoice" ? "50.00" : "-50.00",
      );
      const stored = (await f.db.query<{ components: any[] }>(
        "SELECT components FROM accounting.allocations WHERE id=$1",
        [payment.allocation_id],
      )).rows[0];
      assert.deepEqual((stored.components as any[]).map((c) => c.amount), [
        "5000",
        "500",
      ]);
      await f.run("accounting.documents.credit.reverse", {
        credit_id: credit.credit_id,
        expected_version: 4,
        effective_date: "2026-10-05",
        reason: "Synthetic credit correction",
        evidence: [f.source],
      });
      assert.equal((await report(aged, "2026-10-04")).rows[0].amount, "0.00");
      assert.equal((await report(aged, "2026-10-05")).rows[0].amount, "55.00");
      assert.equal(
        (await report("profit_and_loss", "2026-10-05", "cash")).profit,
        kind === "invoice" ? "50.00" : "-50.00",
      );
      await assert.rejects(
        f.run("accounting.documents.credit.record", {
          ...args,
          expected_version: 5,
          number: "BACKDATED",
          effective_date: "2026-10-04",
        }),
        /credit_before_history/,
      );
      await assert.rejects(
        f.run("accounting.documents.payment.record", {
          ...payArgs,
          expected_version: 5,
        }),
        /payment_before_history/,
      );
      await f.run("accounting.documents.payment.reverse", {
        allocation_id: payment.allocation_id,
        expected_version: 5,
        effective_date: "2026-10-06",
        reason: "Synthetic payment correction",
        evidence: [f.source],
      });
      await assert.rejects(
        f.run("accounting.documents.void", {
          document_id: d.document_id,
          expected_version: 6,
          effective_date: "2026-10-04",
          reason: "Backdated void",
          evidence: [f.source],
        }),
        /void_before_payment_history/,
      );
      await f.run("accounting.documents.void", {
        document_id: d.document_id,
        expected_version: 6,
        effective_date: "2026-10-07",
        reason: "Synthetic bill/invoice error",
        evidence: [f.source],
      });
      assert.equal((await report(aged, "2026-10-07")).rows.length, 0);
      assert.equal(
        (await report("profit_and_loss", "2026-10-07")).profit,
        "0.00",
      );
      assert.equal(
        (await report("profit_and_loss", "2026-10-07", "cash")).profit,
        "0.00",
      );
      assert.equal((await f.run("accounting.audit.verify")).valid, true);
      await f.db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE accounting_fixture");
        await tx.query(
          "SELECT set_config('accounting.tenant','other-tenant',true),set_config('accounting.company','synthetic-company',true)",
        );
        assert.equal(
          (await tx.query("SELECT * FROM accounting.credits")).rows.length,
          0,
        );
        assert.equal(
          (await tx.query("SELECT * FROM accounting.credit_reversals")).rows
            .length,
          0,
        );
      });
      await assert.rejects(
        f.run(
          "accounting.documents.credit.record",
          args,
          "foreign-credit",
          "other-company",
        ),
        /forbidden/,
      );
      await assert.rejects(
        f.db.query("UPDATE accounting.credits SET amount=1 WHERE id=$1", [
          credit.credit_id,
        ]),
        /record_immutable/,
      );
    } finally {
      await f.db.close();
    }
  });
}

test("credit against paid balance is denied and a locked credit cannot post", async () => {
  const f = await fixture();
  try {
    const d = await f.run("accounting.sales.invoice.draft", f.document());
    await f.run("accounting.documents.approve", {
      document_id: d.document_id,
      expected_version: 1,
    });
    const credit = {
      document_id: d.document_id,
      expected_version: 2,
      number: "C1",
      amount: "10.00",
      effective_date: "2026-10-03",
      reason: "Synthetic",
      evidence: [f.source],
    };
    await f.run("accounting.organisations.period.lock", {
      through: "2026-10-03",
      expected_revision:
        (await f.run("accounting.workspace.get")).book.revision,
    });
    await assert.rejects(
      f.run("accounting.documents.credit.record", credit),
      /period_locked/,
    );
    await f.run("accounting.documents.payment.record", {
      document_id: d.document_id,
      expected_version: 2,
      amount: "100.00",
      effective_date: "2026-10-04",
      bank_account: "bank",
      evidence: [f.source],
    });
    await assert.rejects(
      f.run("accounting.documents.credit.record", {
        ...credit,
        expected_version: 3,
        effective_date: "2026-10-05",
      }),
      /overcredit/,
    );
  } finally {
    await f.db.close();
  }
});
