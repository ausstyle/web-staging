import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";

test("chart maintenance preserves classifications, draft references and posted history", async () => {
  const f = await fixture();
  try {
    const revision = async () =>
      (await f.run("accounting.workspace.get")).book.revision;
    const create = async (account_id: string, kind = "expense") =>
      f.run("accounting.accounts.create", {
        account_id,
        name: "Synthetic " + account_id,
        kind,
        expected_revision: await revision(),
      });
    const archive = async (account_id: string) =>
      f.run("accounting.accounts.archive", {
        account_id,
        reason: "Synthetic chart cleanup",
        expected_revision: await revision(),
      });
    for (const kind of ["asset", "liability", "equity", "revenue", "expense"]) {
      await create("demo-" + kind, kind);
    }
    const before = await revision();
    const request = {
      account_id: "office",
      name: "Office supplies",
      kind: "expense",
      expected_revision: before,
    };
    const first = await f.run(
      "accounting.accounts.create",
      request,
      "office-create",
    );
    assert.deepEqual(
      await f.run("accounting.accounts.create", request, "office-create"),
      first,
    );
    await assert.rejects(
      f.run("accounting.accounts.create", { ...request, account_id: "stale" }),
      /version_conflict/,
    );
    await assert.rejects(create("office"), /unique/);
    await assert.rejects(create("bad-kind", "unknown"), /invalid_account_kind/);
    for (const protectedId of ["bank", "ar", "ap", "tax"]) {
      await assert.rejects(archive(protectedId), /protected_account/);
    }
    const draft = f.document("bill", "30.00");
    draft.lines[0].account_id = "office";
    const bill = await f.run("accounting.payables.bill.draft", draft);
    await assert.rejects(archive("office"), /account_in_use/);
    await f.run("accounting.documents.approve", {
      document_id: bill.document_id,
      expected_version: 1,
    });
    await assert.rejects(
      f.db.query(
        "UPDATE accounting.accounts SET kind='asset' WHERE id='office'",
      ),
      /account_identity_immutable/,
    );
    await assert.rejects(
      f.db.query("DELETE FROM accounting.accounts WHERE id='office'"),
      /account_delete_forbidden/,
    );
    const j = await f.run("accounting.ledger.journal.post", {
      ...f.journal("25.00"),
      lines: [{ account_id: "demo-asset", amount: "25.00" }, {
        account_id: "capital",
        amount: "-25.00",
      }],
    });
    await f.run("accounting.ledger.journal.reverse", {
      journal_id: j.journal_id,
      effective_date: "2026-10-03",
      reason: "Synthetic correction",
      evidence: [f.source],
    });
    await assert.rejects(archive("demo-asset"), /account_in_use/);
    const old = await revision();
    const retired = await archive("demo-expense");
    assert.equal(retired.state, "ARCHIVED");
    await assert.rejects(
      f.run("accounting.accounts.archive", {
        account_id: "demo-liability",
        expected_revision: old,
        reason: "Stale reviewer",
      }),
      /version_conflict/,
    );
    await assert.rejects(
      f.run("accounting.ledger.journal.post", {
        ...f.journal("1.00"),
        lines: [{ account_id: "demo-expense", amount: "1.00" }, {
          account_id: "capital",
          amount: "-1.00",
        }],
      }),
      /account_unavailable/,
    );
    const pnl = await f.run("accounting.reporting.run", {
      report: "profit_and_loss",
      through: "2026-10-31",
      basis: "accrual",
    });
    assert.equal(pnl.profit, "-30.00");
    assert.equal(pnl.rows[0].account_id, "office");
    const w = await f.run("accounting.workspace.get");
    assert.equal(
      w.accounts.find((a: any) => a.id === "demo-expense").active,
      false,
    );
    assert.equal(
      w.accounts.find((a: any) => a.id === "office").kind,
      "expense",
    );
    await assert.rejects(
      f.run(
        "accounting.accounts.create",
        {
          ...request,
          expected_revision: await revision(),
        },
        "other-company-account",
        "other-company",
      ),
      /forbidden/,
    );
    assert.equal((await f.run("accounting.audit.verify")).valid, true);
  } finally {
    await f.db.close();
  }
});
