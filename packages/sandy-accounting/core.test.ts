import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";
import { date, decimal, minor, roundRatio } from "./money.ts";

test("exact decimals, rounding and dates use independent expected values", () => {
  assert.equal(minor("9007199254740993.27", 2), 900719925474099327n);
  assert.equal(decimal(-1n, 2), "-0.01");
  assert.equal(minor("12", 0), 12n);
  assert.equal(roundRatio(5n, 1n, 2n), 3n);
  assert.equal(roundRatio(-5n, 1n, 2n), -3n);
  assert.equal(roundRatio(1n, 1n, 3n), 0n);
  assert.equal(roundRatio(2n, 1n, 3n), 1n);
  for (const v of ["1e3", "NaN", "01.00", "1.001", "+1", "1,000"]) {
    assert.throws(() => minor(v, 2));
  }
  assert.throws(() => date("2026-02-29"));
  assert.equal(date("2024-02-29"), "2024-02-29");
});
test("synthetic invoice, bill, partial receipts, bank reconciliation, reports and audit", async () => {
  const f = await fixture();
  try {
    const opening = await f.run(
      "accounting.ledger.journal.post",
      f.journal(),
      "opening",
    );
    const inv = await f.run("accounting.sales.invoice.draft", f.document());
    assert.equal(inv.state, "DRAFT");
    assert.equal(
      (await f.run("accounting.reporting.run", {
        report: "trial_balance",
        through: "2026-10-31",
        basis: "accrual",
      })).debit_total,
      "1000.00",
    );
    await f.run("accounting.documents.approve", {
      document_id: inv.document_id,
      expected_version: 1,
    });
    const payment = await f.run("accounting.documents.payment.record", {
      document_id: inv.document_id,
      expected_version: 2,
      amount: "40.00",
      effective_date: "2026-10-03",
      bank_account: "bank",
      evidence: [f.source],
    });
    assert.equal(payment.remaining, "60.00");
    assert.equal(payment.money_moved, false);
    const bill = await f.run(
      "accounting.payables.bill.draft",
      f.document("bill", "30.00"),
    );
    await f.run("accounting.documents.approve", {
      document_id: bill.document_id,
      expected_version: 1,
    });
    const paid = await f.run("accounting.documents.payment.record", {
      document_id: bill.document_id,
      expected_version: 2,
      amount: "30.00",
      effective_date: "2026-10-03",
      bank_account: "bank",
      evidence: [f.source],
    });
    const statement = await f.run("accounting.banking.statements.import", {
      bank_account: "bank",
      lines: [
        {
          source_key: "opening",
          effective_date: "2026-10-01",
          amount: "1000.00",
          reference: "Synthetic opening",
          evidence: [f.source],
        },
        {
          source_key: "receipt",
          effective_date: "2026-10-03",
          amount: "40.00",
          reference: "Synthetic receipt",
          evidence: [f.source],
        },
        {
          source_key: "bill-paid",
          effective_date: "2026-10-03",
          amount: "-30.00",
          reference: "Synthetic bill payment",
          evidence: [f.source],
        },
      ],
    });
    const suggestions = await f.run("accounting.intelligence.matches.propose");
    assert.equal(suggestions.suggestions.length, 3);
    assert.equal(suggestions.ledger_mutated, false);
    for (
      const [i, jid, amount] of [[0, opening.journal_id, "1000.00"], [
        1,
        payment.journal_id,
        "40.00",
      ], [2, paid.journal_id, "-30.00"]] as const
    ) {
      await f.run("accounting.banking.reconcile.apply", {
        statement_id: statement.statement_ids[i],
        journal_id: jid,
        ordinal: 0,
        amount,
      });
    }
    const report = (name: string, through = "2026-10-31") =>
      f.run("accounting.reporting.run", {
        report: name,
        through,
        basis: "accrual",
      });
    const tb = await report("trial_balance");
    assert.deepEqual(
      Object.fromEntries(tb.rows.map((r: any) => [r.account_id, r.amount])),
      {
        bank: "1010.00",
        capital: "-1000.00",
        ar: "60.00",
        sales: "-100.00",
        expense: "30.00",
        ap: "0.00",
      },
    );
    assert.equal(tb.debit_total, "1100.00");
    assert.equal(tb.credit_total, "1100.00");
    assert.equal((await report("profit_and_loss")).profit, "70.00");
    assert.equal((await report("balance_sheet")).profit, "70.00");
    assert.equal((await report("aged_receivables")).rows[0].amount, "60.00");
    assert.equal(
      (await report("aged_receivables", "2026-10-02")).rows[0].amount,
      "100.00",
    );
    assert.deepEqual((await report("bank_reconciliation")).rows[0], {
      account_id: "bank",
      book: "1010.00",
      statement: "1010.00",
      difference: "0.00",
      unmatched_statement_ids: [],
    });
    assert.equal((await f.run("accounting.audit.verify")).valid, true);
    const drill = await f.run("accounting.reporting.drilldown", {
      journal_id: opening.journal_id,
    });
    assert.equal(drill.lines.length, 2);
    f.revokeEvidence();
    await assert.rejects(
      f.run("accounting.reporting.drilldown", {
        journal_id: opening.journal_id,
      }),
      /evidence_missing_or_revoked/,
    );
  } finally {
    await f.db.close();
  }
});
test("atomic failures, retries, immutable lines, scoped RLS, locks and reversals", async () => {
  const f = await fixture();
  try {
    const invalid = f.journal();
    invalid.lines[1].amount = "-999.99";
    await assert.rejects(
      f.run("accounting.ledger.journal.post", invalid),
      /unbalanced/,
    );
    assert.equal(
      (await f.db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM accounting.journals",
      )).rows[0].n,
      0,
    );
    const results = await Promise.all(
      Array.from(
        { length: 30 },
        () => f.run("accounting.ledger.journal.post", f.journal(), "retry"),
      ),
    );
    assert.equal(new Set(results.map((r) => r.journal_id)).size, 1);
    await assert.rejects(
      f.run("accounting.ledger.journal.post", f.journal("1.00"), "retry"),
      /idempotency_conflict/,
    );
    const jid = results[0].journal_id;
    await assert.rejects(
      f.db.query("UPDATE accounting.lines SET amount=20 WHERE journal_id=$1", [
        jid,
      ]),
      /line_immutable/,
    );
    await assert.rejects(
      f.db.query(
        "UPDATE accounting.journals SET narration='changed' WHERE id=$1",
        [jid],
      ),
      /journal_immutable/,
    );
    await assert.rejects(
      f.db.query(
        "INSERT INTO accounting.lines VALUES('synthetic-tenant','synthetic-company',$1,5,'bank',10,10)",
        [jid],
      ),
      /journal_immutable/,
    );
    for (let i = 0; i < 100; i++) {
      await assert.rejects(
        f.run(
          i % 2 ? "accounting.workspace.get" : "accounting.ledger.journal.post",
          i % 2 ? {} : f.journal(),
          String(i),
          "other-company",
        ),
        /forbidden/,
      );
    }
    await f.db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE accounting_fixture");
      await tx.query(
        "SELECT set_config('accounting.tenant','wrong-tenant',true),set_config('accounting.company','synthetic-company',true)",
      );
      assert.equal(
        (await tx.query("SELECT * FROM accounting.journals")).rows.length,
        0,
      );
    });
    const rev = await f.run("accounting.ledger.journal.reverse", {
      journal_id: jid,
      effective_date: "2026-10-02",
      reason: "Synthetic correction",
      evidence: [f.source],
    });
    assert.equal(rev.state, "POSTED");
    await assert.rejects(
      f.run("accounting.ledger.journal.reverse", {
        journal_id: jid,
        effective_date: "2026-10-02",
        reason: "Again",
        evidence: [f.source],
      }),
      /unique/,
    );
    assert.equal(
      (await f.run("accounting.reporting.run", {
        report: "trial_balance",
        through: "2026-10-31",
        basis: "accrual",
      })).debit_total,
      "0.00",
    );
    const w = await f.run("accounting.workspace.get");
    await f.run("accounting.organisations.period.lock", {
      through: "2026-10-10",
      expected_revision: String(w.book.revision),
    });
    await assert.rejects(
      f.run("accounting.ledger.journal.post", f.journal()),
      /period_locked/,
    );
    await assert.rejects(
      f.run("accounting.organisations.period.lock", {
        through: "2026-09-30",
        expected_revision: String(BigInt(w.book.revision) + 1n),
      }),
      /reopen_not_supported/,
    );
    f.revoke();
    await assert.rejects(
      f.run("accounting.ledger.journal.post", f.journal(), "retry"),
      /forbidden/,
    );
  } finally {
    await f.db.close();
  }
});
test("statement dedup, split/partial match, double match prevention and undo", async () => {
  const f = await fixture();
  try {
    const j = await f.run(
      "accounting.ledger.journal.post",
      f.journal("100.00"),
    );
    const args = {
      bank_account: "bank",
      lines: [{
        source_key: "one",
        effective_date: "2026-10-01",
        amount: "100.00",
        reference: "Fixture",
        evidence: [f.source],
      }],
    };
    const s = await f.run("accounting.banking.statements.import", args);
    assert.deepEqual(
      (await f.run("accounting.banking.statements.import", args)).statement_ids,
      s.statement_ids,
    );
    await assert.rejects(
      f.run("accounting.banking.statements.import", {
        ...args,
        lines: [{ ...args.lines[0], amount: "101.00" }],
      }),
      /statement_source_conflict/,
    );
    const match = {
      statement_id: s.statement_ids[0],
      journal_id: j.journal_id,
      ordinal: 0,
      amount: "40.00",
    };
    const m = await f.run("accounting.banking.reconcile.apply", match);
    assert.equal(m.state, "PARTIAL");
    const rest = await f.run("accounting.banking.reconcile.apply", {
      ...match,
      amount: "60.00",
    });
    assert.equal(rest.state, "RECONCILED");
    await assert.rejects(
      f.run("accounting.banking.reconcile.apply", match),
      /overmatched/,
    );
    await assert.rejects(
      f.run("accounting.ledger.journal.reverse", {
        journal_id: j.journal_id,
        effective_date: "2026-10-02",
        reason: "Test",
        evidence: [f.source],
      }),
      /unreconcile_first/,
    );
    await f.run("accounting.banking.reconcile.reverse", {
      match_id: m.match_id,
      reason: "Synthetic correction",
    });
    assert.equal((await f.run("accounting.workspace.get")).matches.length, 1);
    await assert.rejects(
      f.run("accounting.banking.reconcile.reverse", {
        match_id: m.match_id,
        reason: "Again",
      }),
      /match_unavailable/,
    );
  } finally {
    await f.db.close();
  }
});
test("FX requires explicit source and rejects rounded imbalance; draft source cannot authorize effects", async () => {
  const f = await fixture();
  try {
    const fx = {
      ...f.journal("10.00"),
      currency: "USD",
      fx: {
        numerator: "3",
        denominator: "2",
        source: f.source,
        date: "2026-10-01",
      },
    };
    const j = await f.run("accounting.ledger.journal.post", fx);
    assert.deepEqual(j.lines.map((l: any) => l.base_amount), ["1500", "-1500"]);
    await assert.rejects(
      f.run("accounting.ledger.journal.post", {
        ...fx,
        fx: { ...fx.fx, source: { ...f.source, sha256: "0".repeat(64) } },
      }),
      /evidence_missing/,
    );
    await assert.rejects(
      f.run("accounting.ledger.journal.post", {
        ...fx,
        lines: [{ account_id: "bank", amount: "0.01" }, {
          account_id: "bank",
          amount: "0.01",
        }, { account_id: "capital", amount: "-0.02" }],
      }),
      /rounding/,
    );
    await assert.rejects(
      f.run("accounting.ledger.journal.post", {
        ...f.journal(),
        approval: true,
      }),
      /argument_fields/,
    );
    await assert.rejects(
      f.run("accounting.payroll.stp.submit", {}),
      /unsupported/,
    );
    await assert.rejects(
      f.run("accounting.reporting.run", {
        report: "aged_receivables",
        through: "2026-10-31",
        basis: "cash",
      }),
      /report_requires_accrual/,
    );
  } finally {
    await f.db.close();
  }
});
