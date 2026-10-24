import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";
import { contentHash } from "./money.ts";
import { parseStatementCsv } from "./statement_csv.ts";

test("CSV uses explicit headers/dates/amounts and preserves quoted source text", () => {
  const rows = parseStatementCsv(
    '\uFEFFsource_key,date,amount,reference\r\nA,2026-02-28,-2.50,"Fee, with ""quote""\r\nand newline"\r\n',
    2,
  );
  assert.equal(rows[0].reference, 'Fee, with "quote"\r\nand newline');
  assert.equal(rows[0].amount, "-2.50");
  assert.equal(rows[0].record, 2);
  for (
    const input of [
      '"source_key,date,amount,reference"\nA,2026-10-01,1,x',
      'source_key,date,amount,reference\nA,2026-10-01,1,"open',
      'source_key,date,amount,reference\nA,2026-10-01,1,"closed"extra',
    ]
  ) assert.throws(() => parseStatementCsv(input, 2), /csv_/);
  for (
    const [value, error] of [
      ["2026-02-30,1", "invalid_date"],
      ["01/02/2026,1", "invalid_date"],
      ["2026-10-01,1.001", "excess_precision"],
      ["2026-10-01,0", "zero_statement"],
      ["2026-10-01,1e3", "invalid_decimal"],
    ]
  ) {
    assert.equal(
      parseStatementCsv(`source_key,date,amount,reference\nA,${value},x`, 2)[0]
        .error,
      error,
    );
  }
  assert.throws(() => parseStatementCsv("x".repeat(200001), 2), /csv_size/);
  assert.throws(
    () =>
      parseStatementCsv(
        "source_key,date,amount,reference\n" +
          "A,2026-10-01,1,x\n".repeat(2001),
        2,
      ),
    /csv_row_limit/,
  );
});

test("one bank entry offered to two statements is ambiguous; negative residuals remain exact", async () => {
  const f = await fixture();
  try {
    const journal = await f.run("accounting.ledger.journal.post", {
      ...f.journal(),
      narration: "Synthetic withdrawal",
      lines: [{ account_id: "bank", amount: "-10.00" }, {
        account_id: "expense",
        amount: "10.00",
      }],
    });
    const imported = await f.run("accounting.banking.statements.import", {
      bank_account: "bank",
      lines: ["A", "B"].map((source_key) => ({
        source_key,
        effective_date: "2026-10-01",
        amount: "-10.00",
        reference: "Synthetic withdrawal",
        evidence: [f.source],
      })),
    });
    const queue = await f.run("accounting.intelligence.matches.propose");
    assert.deepEqual(queue.queue.map((r: any) => r.status), [
      "AMBIGUOUS_MATCH",
      "AMBIGUOUS_MATCH",
    ]);
    const match = await f.run("accounting.banking.reconcile.apply", {
      statement_id: imported.statement_ids[0],
      journal_id: journal.journal_id,
      ordinal: 0,
      amount: "-4.00",
    });
    const partial = await f.run("accounting.intelligence.matches.propose");
    assert.equal(partial.queue[0].remaining, "-6.00");
    assert.equal(partial.queue[0].status, "PARTIAL_MATCH");
    assert.equal(partial.queue[1].status, "NO_EXACT_MATCH");
    assert.equal(partial.suggestions[0].amount, "-6.00");
    await f.run("accounting.banking.reconcile.reverse", {
      match_id: match.match_id,
      reason: "Synthetic correction",
    });
    assert.deepEqual(
      (await f.run("accounting.intelligence.matches.propose")).queue.map((
        r: any,
      ) => r.status),
      ["AMBIGUOUS_MATCH", "AMBIGUOUS_MATCH"],
    );
  } finally {
    await f.db.close();
  }
});

test("CSV preview/import is atomic, source-bound, replay-safe and preserves import evidence", async () => {
  const f = await fixture();
  try {
    const args = (index = 0, decisions: any[] = []) => ({
      bank_account: "bank",
      csv: f.csvFiles[index].csv,
      source: f.csvFiles[index].source,
      decisions,
    });
    const preview = (a = args()) =>
      f.run("accounting.banking.statements.csv.preview", a);
    const commit = (p: any, a = args(), key: string = crypto.randomUUID()) =>
      f.run("accounting.banking.statements.csv.import", {
        ...a,
        expected_revision: p.book_revision,
        preview_digest: p.preview_digest,
      }, key);
    const p = await preview();
    assert.equal(p.can_import, true);
    assert.deepEqual(p.rows.map((row: any) => row.status), [
      "NEW",
      "NEW",
      "NEW",
    ]);
    assert.equal((await f.run("accounting.audit.verify")).events, 0);
    assert.equal(
      (await f.db.query("SELECT * FROM accounting.statements")).rows.length,
      0,
    );
    await assert.rejects(
      commit({ ...p, preview_digest: "tampered" }),
      /csv_preview_changed/,
    );
    await assert.rejects(
      preview({ ...args(), csv: args().csv + "tamper" }),
      /csv_source_hash_mismatch/,
    );
    const replay = await Promise.all(
      Array.from({ length: 10 }, () => commit(p, args(), "one-csv-import")),
    );
    assert.equal(new Set(replay.map((r) => r.import_id)).size, 1);
    assert.equal(replay[0].inserted, 3);
    assert.equal(
      (await f.db.query("SELECT * FROM accounting.journals")).rows.length,
      0,
    );
    await assert.rejects(commit(p), /version_conflict/);
    const duplicates = await preview();
    assert.deepEqual(duplicates.rows.map((r: any) => r.status), [
      "DUPLICATE",
      "DUPLICATE",
      "DUPLICATE",
    ]);
    const duplicateReceipt = await commit(duplicates);
    assert.equal(duplicateReceipt.inserted, 0);
    assert.equal(duplicateReceipt.duplicates, 3);
    const conflict = await preview(args(1));
    assert.equal(conflict.rows[0].status, "SOURCE_CONFLICT");
    await assert.rejects(commit(conflict, args(1)), /csv_review_errors/);
    const possible = await preview(args(2));
    assert.equal(possible.rows[0].status, "POSSIBLE_DUPLICATE");
    assert.equal(possible.can_import, false);
    await assert.rejects(commit(possible, args(2)), /csv_review_errors/);
    const skipArgs = args(2, [{
      record: 2,
      decision: "SKIP",
      reason: "Synthetic overlap confirmed",
    }]);
    const skipped = await commit(await preview(skipArgs), skipArgs);
    assert.equal(skipped.skipped, 1);
    assert.equal(skipped.rows[0].statement_id, null);
    assert.equal(
      (await f.db.query("SELECT * FROM accounting.statements")).rows.length,
      3,
    );
    const keepArgs = args(2, [{
      record: 2,
      decision: "KEEP_DISTINCT",
      reason: "Synthetic separate transaction independently reviewed",
    }]);
    assert.equal((await commit(await preview(keepArgs), keepArgs)).inserted, 1);
    const history = await f.run("accounting.banking.statements.imports.get", {
      bank_account: "bank",
    });
    assert.equal(history.imports.length, 4);
    assert.ok(
      history.imports.every((entry: any) =>
        entry.actor_id === "synthetic-actor" && entry.created_at
      ),
    );
    assert.equal(
      history.imports.find((entry: any) => entry.id === skipped.import_id)
        .rows[0].review.reason,
      "Synthetic overlap confirmed",
    );
    await assert.rejects(
      f.db.query("UPDATE accounting.statement_imports SET actor_id='tampered'"),
      /record_immutable/,
    );
    await assert.rejects(
      f.db.query("DELETE FROM accounting.statements"),
      /record_immutable/,
    );
    await f.db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE accounting_fixture");
      await tx.query(
        "SELECT set_config('accounting.tenant','other-tenant',true),set_config('accounting.company','synthetic-company',true)",
      );
      assert.equal(
        (await tx.query("SELECT * FROM accounting.statement_imports")).rows
          .length,
        0,
      );
      await tx.query(
        "SELECT set_config('accounting.tenant','synthetic-tenant',true),set_config('accounting.company','other-company',true)",
      );
      assert.equal(
        (await tx.query("SELECT * FROM accounting.statement_imports")).rows
          .length,
        0,
      );
    });
    await assert.rejects(
      f.run(
        "accounting.banking.statements.csv.preview",
        args(),
        "foreign",
        "other-company",
      ),
      /forbidden/,
    );
    assert.equal((await f.run("accounting.audit.verify")).events, 4);
    f.revokeEvidence();
    await assert.rejects(preview(), /evidence_missing_or_revoked/);
    await assert.rejects(
      commit(p, args(), "one-csv-import"),
      /evidence_missing_or_revoked/,
    );
    await assert.rejects(
      f.run("accounting.banking.statements.imports.get", {
        bank_account: "bank",
      }),
      /evidence_missing_or_revoked/,
    );
  } finally {
    await f.db.close();
  }
});

test("CSV intra-file collisions, invalid rows and overlapping files never silently lose transactions", async () => {
  const f = await fixture();
  try {
    const original = f.boundary.evidence;
    const allowed = new Set<string>();
    f.boundary.evidence = async (actor, company, source, tx) =>
      allowed.has(source.sha256) || original(actor, company, source, tx);
    const preview = async (csv: string, decisions: any[] = []) => {
      const source = {
        ...f.source,
        file_id: "synthetic-csv-test",
        locator: "whole CSV file",
        sha256: await contentHash(csv),
      };
      allowed.add(source.sha256);
      const args = { bank_account: "bank", csv, source, decisions };
      const p = await f.run("accounting.banking.statements.csv.preview", args);
      return { p, args };
    };
    const head = "source_key,date,amount,reference\n";
    const many = await preview(
      head +
        Array.from({ length: 40 }, (_, i) => `KEY-${i},2026-10-02,2,same`).join(
          "\n",
        ),
    );
    assert.equal(many.p.rows[39].possible_duplicate_count, 39);
    assert.equal(many.p.rows[39].possible_duplicate_keys.length, 20);
    const first = await preview(
      head + "A,2026-10-01,1.0,x\nA,2026-10-01,1.00,x\nB,2026-10-01,1.00,x\n",
    );
    assert.deepEqual(first.p.rows.map((r: any) => r.status), [
      "NEW",
      "DUPLICATE",
      "POSSIBLE_DUPLICATE",
    ]);
    assert.equal(first.p.can_import, false);
    const reviewed = await preview(first.args.csv, [{
      record: 4,
      decision: "KEEP_DISTINCT",
      reason: "Two independently identified synthetic transactions",
    }]);
    const imported = await f.run("accounting.banking.statements.csv.import", {
      ...reviewed.args,
      expected_revision: reviewed.p.book_revision,
      preview_digest: reviewed.p.preview_digest,
    });
    assert.equal(imported.inserted, 2);
    assert.equal(imported.duplicates, 1);
    assert.equal(imported.rows[0].statement_id, imported.rows[1].statement_id);
    // A different file carrying the same provider ID deduplicates but keeps its own import receipt.
    const overlap = await preview(head + "A,2026-10-01,1.00,x\n");
    assert.equal(overlap.p.rows[0].status, "DUPLICATE");
    const invalid = await preview(
      head + "NEW,2026-10-01,2,new\nBAD,2026-02-30,3,bad\nA,2026-10-01,9,x\n",
    );
    assert.deepEqual(invalid.p.rows.map((r: any) => r.status), [
      "NEW",
      "INVALID",
      "SOURCE_CONFLICT",
    ]);
    await assert.rejects(
      f.run("accounting.banking.statements.csv.import", {
        ...invalid.args,
        expected_revision: invalid.p.book_revision,
        preview_digest: invalid.p.preview_digest,
      }),
      /csv_review_errors/,
    );
    assert.equal(
      (await f.db.query("SELECT * FROM accounting.statements")).rows.length,
      2,
    );
    assert.equal((await f.run("accounting.audit.verify")).events, 1);
  } finally {
    await f.db.close();
  }
});

test("reconciliation exposes ambiguity, residual matches, unresolved exceptions and period locks", async () => {
  const f = await fixture();
  try {
    const journal = await f.run("accounting.ledger.journal.post", f.journal());
    const file = f.csvFiles[0];
    const args = {
      bank_account: "bank",
      csv: file.csv,
      source: file.source,
      decisions: [],
    };
    const preview = await f.run(
      "accounting.banking.statements.csv.preview",
      args,
    );
    const imported = await f.run("accounting.banking.statements.csv.import", {
      ...args,
      expected_revision: preview.book_revision,
      preview_digest: preview.preview_digest,
    });
    const statement = imported.rows[0].statement_id;
    const review = () => f.run("accounting.intelligence.matches.propose");
    let proposed = await review();
    assert.equal(proposed.suggestions.length, 1);
    assert.equal(proposed.exceptions.length, 2);
    assert.equal((await f.run("accounting.audit.verify")).events, 2);
    const first = await f.run("accounting.banking.reconcile.apply", {
      statement_id: statement,
      journal_id: journal.journal_id,
      ordinal: 0,
      amount: "400.00",
    });
    proposed = await review();
    assert.equal(proposed.queue[0].status, "PARTIAL_MATCH");
    assert.equal(proposed.suggestions[0].amount, "600.00");
    const secondJournal = await f.run(
      "accounting.ledger.journal.post",
      f.journal("600.00"),
    );
    proposed = await review();
    assert.equal(proposed.queue[0].status, "AMBIGUOUS_MATCH");
    assert.equal(proposed.suggestions.length, 2);
    assert.ok(
      proposed.suggestions.every((r: any) =>
        r.ambiguous && r.approval_required
      ),
    );
    const matchArgs = {
      statement_id: statement,
      journal_id: secondJournal.journal_id,
      ordinal: 0,
      amount: "600.00",
    };
    const race = await Promise.allSettled([
      f.run("accounting.banking.reconcile.apply", matchArgs),
      f.run("accounting.banking.reconcile.apply", matchArgs),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.match(
      (race.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.message,
      /overmatched/,
    );
    const second = race.find((r) => r.status === "fulfilled")!.value;
    assert.equal(
      (await review()).queue.some((r: any) => r.statement_id === statement),
      false,
    );
    await f.run("accounting.banking.reconcile.reverse", {
      match_id: second.match_id,
      reason: "Synthetic wrong choice",
    });
    await f.run("accounting.banking.reconcile.reverse", {
      match_id: first.match_id,
      reason: "Synthetic review reset",
    });
    assert.equal((await review()).queue[0].remaining, "1000.00");
    const report = await f.run("accounting.reporting.run", {
      report: "bank_reconciliation",
      through: "2026-10-31",
      basis: "accrual",
    });
    assert.equal(report.rows[0].book, "1600.00");
    assert.equal(report.rows[0].statement, "1097.50");
    assert.equal(report.rows[0].difference, "-502.50");
    await f.run("accounting.organisations.period.lock", {
      through: "2026-10-01",
      expected_revision:
        (await f.run("accounting.workspace.get")).book.revision,
    });
    assert.equal((await review()).queue[0].status, "PERIOD_LOCKED");
    await assert.rejects(
      f.run("accounting.banking.reconcile.apply", {
        ...matchArgs,
        journal_id: journal.journal_id,
        amount: "1000.00",
      }),
      /period_locked/,
    );
    assert.equal(
      (await f.db.query("SELECT * FROM accounting.statements")).rows.length,
      3,
    );
    assert.equal((await f.run("accounting.audit.verify")).valid, true);
  } finally {
    await f.db.close();
  }
});
