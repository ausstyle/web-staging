import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";

test("history keeps exact large totals and rechecks superseded tax-source access", async () => {
  const f = await fixture();
  try {
    const oldRule = { ...f.source, file_id: "synthetic-superseded-rule" };
    const originalEvidence = f.boundary.evidence;
    let ruleRevoked = false;
    f.boundary.evidence = async (actor, company, evidence, tx) =>
      evidence.file_id === oldRule.file_id
        ? !ruleRevoked && evidence.sha256 === oldRule.sha256
        : originalEvidence(actor, company, evidence, tx);
    const original = f.document("invoice", "90071992547409.92");
    const d = await f.run("accounting.sales.invoice.draft", {
      ...original,
      lines: [{
        ...original.lines[0],
        tax: "0.01",
        tax_account: "tax",
        tax_rule_ref: oldRule,
      }],
    });
    await f.run("accounting.documents.draft.update", {
      ...f.document("invoice", "100.00"),
      document_id: d.document_id,
      expected_version: 1,
    });
    const history = () =>
      f.run("accounting.documents.history", { document_id: d.document_id });
    assert.equal(
      (await history()).revisions[0].snapshot.total,
      "9007199254740993",
    );
    ruleRevoked = true;
    await assert.rejects(history(), /evidence_missing_or_revoked/);
  } finally {
    await f.db.close();
  }
});

for (const kind of ["invoice", "bill"]) {
  test(`${kind}: editable drafts preserve immutable revisions and approved facts`, async () => {
    const f = await fixture();
    try {
      const original = f.document(kind);
      const d = await f.run(
        kind === "invoice"
          ? "accounting.sales.invoice.draft"
          : "accounting.payables.bill.draft",
        original,
      );
      const changed = {
        ...original,
        document_id: d.document_id,
        expected_version: 1,
        contact: "Corrected synthetic contact",
        due: "2026-10-25",
        lines: [{ ...original.lines[0], net: "125.00" }, {
          ...original.lines[0],
          description: "Second service",
          net: "0.01",
        }],
      };
      const edits = await Promise.all(
        Array.from(
          { length: 8 },
          () =>
            f.run("accounting.documents.draft.update", changed, "same-edit"),
        ),
      );
      assert.ok(edits.every((r) => r.version === 2 && r.total === "125.01"));
      assert.equal(
        (await f.db.query("SELECT * FROM accounting.journals")).rows.length,
        0,
      );
      await assert.rejects(
        f.run("accounting.documents.draft.update", changed),
        /version_conflict/,
      );
      await assert.rejects(
        f.run("accounting.documents.draft.update", {
          ...changed,
          expected_version: 2,
          due: "2026-10-01",
        }),
        /due_before_issue/,
      );
      await assert.rejects(
        f.run("accounting.documents.draft.update", {
          ...changed,
          expected_version: 2,
          lines: [{ ...original.lines[0], net: "-1.00" }],
        }),
        /document_amount/,
      );
      const history = () =>
        f.run("accounting.documents.history", { document_id: d.document_id });
      assert.equal((await history()).revisions.length, 2);
      await f.run("accounting.documents.approve", {
        document_id: d.document_id,
        expected_version: 2,
      });
      await assert.rejects(
        f.run("accounting.documents.draft.update", {
          ...changed,
          expected_version: 3,
        }),
        /draft_required/,
      );
      const revisions = (await history()).revisions;
      assert.deepEqual(revisions.map((r: any) => r.version), [1, 2, 3]);
      assert.equal(revisions[0].snapshot.contact, original.contact);
      assert.equal(revisions[0].snapshot.lines[0].net, "100.00");
      assert.equal(revisions[1].snapshot.lines.length, 2);
      assert.equal(revisions[1].snapshot.lines[1].net, "0.01");
      assert.equal(revisions[1].snapshot.journal_id, null);
      assert.ok(revisions[2].snapshot.journal_id);
      assert.ok(
        revisions.every((r: any) =>
          r.actor_id === "synthetic-actor" && r.recorded_at
        ),
      );
      const profit = await f.run("accounting.reporting.run", {
        report: "profit_and_loss",
        through: "2026-10-31",
        basis: "accrual",
      });
      assert.equal(profit.profit, kind === "invoice" ? "125.01" : "-125.01");
      await assert.rejects(
        f.db.query("UPDATE accounting.document_versions SET actor_id='other'"),
        /record_immutable/,
      );
      await assert.rejects(
        f.db.query("DELETE FROM accounting.document_versions"),
        /record_immutable/,
      );
      await assert.rejects(
        f.db.query(
          "UPDATE accounting.documents SET contact='tampered',version=version+1 WHERE id=$1",
          [d.document_id],
        ),
        /document_immutable/,
      );
      await f.db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE accounting_fixture");
        await tx.query(
          "SELECT set_config('accounting.tenant','synthetic-tenant',true),set_config('accounting.company','other-company',true)",
        );
        assert.equal(
          (await tx.query("SELECT * FROM accounting.document_versions")).rows
            .length,
          0,
        );
        await tx.query(
          "SELECT set_config('accounting.tenant','other-tenant',true),set_config('accounting.company','synthetic-company',true)",
        );
        assert.equal(
          (await tx.query("SELECT * FROM accounting.document_versions")).rows
            .length,
          0,
        );
      });
      await assert.rejects(
        f.run(
          "accounting.documents.history",
          { document_id: d.document_id },
          "foreign",
          "other-company",
        ),
        /forbidden/,
      );
      assert.equal((await f.run("accounting.audit.verify")).valid, true);
      f.revokeEvidence();
      await assert.rejects(history(), /evidence_missing_or_revoked/);
    } finally {
      await f.db.close();
    }
  });
}

test("draft edit/approve race has one winner; duplicate numbers roll back revision and command", async () => {
  const f = await fixture();
  try {
    const original = f.document();
    const d = await f.run("accounting.sales.invoice.draft", original);
    await f.run("accounting.sales.invoice.draft", {
      ...original,
      number: "TAKEN",
    });
    await assert.rejects(
      f.run("accounting.documents.draft.update", {
        ...original,
        document_id: d.document_id,
        expected_version: 1,
        number: "TAKEN",
      }),
      /duplicate key/,
    );
    const race = await Promise.allSettled([
      f.run("accounting.documents.draft.update", {
        ...f.document("invoice", "80.00"),
        document_id: d.document_id,
        expected_version: 1,
      }),
      f.run("accounting.documents.approve", {
        document_id: d.document_id,
        expected_version: 1,
      }),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.match(
      (race.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.message,
      /version_conflict/,
    );
    const winner = race.find((r) => r.status === "fulfilled")!.value;
    if (winner.state === "DRAFT") {
      await f.run("accounting.documents.approve", {
        document_id: d.document_id,
        expected_version: 2,
      });
    }
    const history = await f.run("accounting.documents.history", {
      document_id: d.document_id,
    });
    assert.equal(history.revisions.length, winner.state === "DRAFT" ? 3 : 2);
    const profit = await f.run("accounting.reporting.run", {
      report: "profit_and_loss",
      through: "2026-10-31",
      basis: "accrual",
    });
    assert.equal(profit.profit, winner.state === "DRAFT" ? "80.00" : "100.00");
    assert.equal(
      (await f.run("accounting.audit.verify")).events,
      winner.state === "DRAFT" ? 4 : 3,
    );
  } finally {
    await f.db.close();
  }
});
