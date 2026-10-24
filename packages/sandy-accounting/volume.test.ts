import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "./fixture.ts";
import { decimal } from "./money.ts";

test(
  "10,000 deterministic mixed journal vouchers reconcile to independent integer oracle",
  { timeout: 600000 },
  async () => {
    const f = await fixture();
    try {
      let bank = 0n, expense = 0n, revenue = 0n;
      for (let i = 1; i <= 10000; i++) {
        const units = BigInt((i * 7919) % 100000 + 1), cost = i % 3 === 0;
        bank += cost ? -units : units;
        if (cost) expense += units;
        else revenue -= units;
        await f.run("accounting.ledger.journal.post", {
          ...f.journal(),
          effective_date: "2026-10-" + String(i % 28 + 1).padStart(2, "0"),
          narration: "Synthetic voucher " + i,
          lines: [{
            account_id: cost ? "expense" : "bank",
            amount: decimal(units, 2),
          }, {
            account_id: cost ? "bank" : "sales",
            amount: decimal(-units, 2),
          }],
        }, "volume-" + i);
      }
      const tb = await f.run("accounting.reporting.run", {
        report: "trial_balance",
        through: "2026-10-31",
        basis: "accrual",
      });
      const balances = Object.fromEntries(
        tb.rows.map((r: any) => [r.account_id, r.amount]),
      );
      assert.deepEqual(balances, {
        bank: decimal(bank, 2),
        sales: decimal(revenue, 2),
        expense: decimal(expense, 2),
      });
      assert.equal(tb.debit_total, tb.credit_total);
      assert.equal(
        (await f.db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM accounting.journals WHERE state='POSTED'",
        )).rows[0].n,
        10000,
      );
      assert.equal(
        (await f.db.query(
          "SELECT journal_id FROM accounting.lines GROUP BY journal_id HAVING sum(amount)<>0 OR sum(base_amount)<>0",
        )).rows.length,
        0,
      );
      assert.equal((await f.run("accounting.audit.verify")).events, 10000);
    } finally {
      await f.db.close();
    }
  },
);
test("committed effects survive process-equivalent database restart; interrupted transaction rolls back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "accounting-recovery-"));
  let f = await fixture(dir);
  try {
    const posted = await f.run(
      "accounting.ledger.journal.post",
      f.journal(),
      "restart",
    );
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO accounting.statements VALUES('synthetic-tenant','synthetic-company','failed','bank','failed','2026-10-02',10,'incomplete','[]')",
        );
        throw Error("simulated_crash_before_commit");
      }),
      /simulated_crash/,
    );
    await f.db.close();
    f = await fixture(dir);
    const retry = await f.run(
      "accounting.ledger.journal.post",
      f.journal(),
      "restart",
    );
    assert.deepEqual(retry, posted);
    assert.equal(
      (await f.db.query(
        "SELECT * FROM accounting.statements WHERE id='failed'",
      )).rows.length,
      0,
    );
    assert.equal((await f.run("accounting.audit.verify")).events, 1);
  } finally {
    await f.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
