import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  Accounting,
  type Boundary,
  operations,
  type Request,
} from "./service.ts";
import { PostgresDatabase } from "./postgres.ts";
import { contentHash } from "./money.ts";
import { SYNTHETIC_SOURCE } from "./fixture.ts";

const connectionString = process.env.ACCOUNTING_TEST_PG_URL;
test(
  "real PostgreSQL: concurrent connections, row locks, RLS, revocation while waiting and rollback",
  { skip: !connectionString, timeout: 120000 },
  async () => {
    const url = new URL(connectionString!);
    assert.equal(
      url.hostname,
      "127.0.0.1",
      "Only disposable loopback PostgreSQL is permitted",
    );
    assert.equal(
      url.pathname,
      "/sandy_accounting_test",
      "Never run against customer databases",
    );
    const admin = new pg.Pool({ connectionString, max: 3 });
    let pool: pg.Pool | undefined;
    try {
      // Fail if a schema already exists: no destructive reset and no unknown database reuse.
      assert.equal(
        (await admin.query(
          "SELECT 1 FROM pg_namespace WHERE nspname='accounting'",
        )).rowCount,
        0,
        "fresh fixture database required",
      );
      await admin.query(
        await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
      );
      await admin.query(
        "CREATE ROLE accounting_test_login NOINHERIT LOGIN PASSWORD 'synthetic-test-only'",
      );
      await admin.query("GRANT accounting_fixture TO accounting_test_login");
      await admin.query(
        "INSERT INTO accounting.books VALUES('t1','c1','Synthetic PG','AUD',2,NULL,0),('t2','c2','Other PG','AUD',2,NULL,0)",
      );
      await admin.query(
        "INSERT INTO accounting.accounts VALUES('t1','c1','bank','Bank','asset','bank',true),('t1','c1','capital','Capital','equity',NULL,true)",
      );
      await admin.query(
        "INSERT INTO accounting.accounts VALUES('t1','c1','ar','Receivables','asset','ar',true),('t1','c1','sales','Sales','revenue',NULL,true)",
      );
      const applicationUrl = new URL(url);
      applicationUrl.username = "accounting_test_login";
      applicationUrl.password = "synthetic-test-only";
      pool = new pg.Pool({
        connectionString: applicationUrl.toString(),
        max: 12,
      });
      const db = new PostgresDatabase(pool),
        source = {
          file_id: "synthetic",
          revision: "1",
          sha256: await contentHash(SYNTHETIC_SOURCE),
          locator: "rows 1-3",
        };
      let revoked = false, authorizationSeen: (() => void) | undefined;
      const boundary: Boundary = {
        now: () => "2026-10-24T02:00:00.000Z",
        async authorize() {
          authorizationSeen?.();
          if (revoked) throw Error("forbidden");
          return {
            actor_id: "a1",
            tenant_id: "t1",
            company_ids: ["c1"],
            operations: Object.keys(operations),
            policy_ref: "synthetic-policy",
            expires_at: "2026-10-25T00:00:00Z",
          };
        },
        async evidence(_actor, _company, e) {
          return e.file_id === source.file_id && e.sha256 === source.sha256 &&
            e.revision === source.revision && e.locator === source.locator;
        },
      };
      const app = new Accounting(db, boundary);
      const args = {
        effective_date: "2026-10-01",
        narration: "Synthetic concurrent opening",
        currency: "AUD",
        precision: 2,
        evidence: [source],
        lines: [{ account_id: "bank", amount: "1000.00" }, {
          account_id: "capital",
          amount: "-1000.00",
        }],
      };
      const request: Request = {
        operation: "accounting.ledger.journal.post",
        contract_version: "1",
        company_id: "c1",
        idempotency_key: "concurrent",
        arguments: args,
      };
      const results = await Promise.all(
        Array.from({ length: 100 }, () => app.execute("synthetic", request)),
      );
      assert.equal(new Set(results.map((r) => r.journal_id)).size, 1);
      assert.equal(
        (await admin.query("SELECT count(*)::int n FROM accounting.journals"))
          .rows[0].n,
        1,
      );
      assert.ok(
        pool.totalCount > 1,
        "test must use more than one physical connection",
      );
      await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          app.execute("synthetic", {
            ...request,
            idempotency_key: "unique-" + i,
            arguments: {
              ...args,
              lines: [{ account_id: "bank", amount: "0.01" }, {
                account_id: "capital",
                amount: "-0.01",
              }],
            },
          })),
      );
      const report = await app.execute("synthetic", {
        operation: "accounting.reporting.run",
        contract_version: "1",
        company_id: "c1",
        arguments: {
          report: "trial_balance",
          through: "2026-10-31",
          basis: "accrual",
        },
      });
      assert.equal(report.debit_total, "1001.00");
      assert.equal(report.credit_total, "1001.00");
      await db.transaction(async (tx) => {
        await tx.query("SET LOCAL ROLE accounting_fixture");
        await tx.query(
          "SELECT set_config('accounting.tenant','wrong',true),set_config('accounting.company','c1',true)",
        );
        assert.equal(
          (await tx.query("SELECT * FROM accounting.journals")).rows.length,
          0,
        );
      });
      const blocker = await admin.connect();
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT 1 FROM accounting.books WHERE tenant_id='t1' AND company_id='c1' FOR UPDATE",
      );
      let seen!: () => void;
      const started = new Promise<void>((resolve) => {
        seen = resolve;
      });
      authorizationSeen = seen;
      const pending = app.execute("synthetic", {
        ...request,
        idempotency_key: "revoked-while-waiting",
      });
      const denial = assert.rejects(pending, /forbidden/);
      await started;
      revoked = true;
      await blocker.query("COMMIT");
      blocker.release();
      await denial;
      revoked = false;
      authorizationSeen = undefined;
      assert.equal(
        (await admin.query("SELECT count(*)::int n FROM accounting.journals"))
          .rows[0].n,
        101,
      );
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.query("SET LOCAL ROLE accounting_fixture");
          await tx.query(
            "SELECT set_config('accounting.tenant','t1',true),set_config('accounting.company','c1',true)",
          );
          await tx.query(
            "INSERT INTO accounting.statements VALUES('t1','c1','failed','bank','failed','2026-10-02',1,'failed','[]')",
          );
          throw Error("crash_before_commit");
        }),
        /crash_before_commit/,
      );
      assert.equal(
        (await admin.query(
          "SELECT count(*)::int n FROM accounting.statements WHERE id='failed'",
        )).rows[0].n,
        0,
      );
      await assert.rejects(
        pool.query("SELECT * FROM accounting.journals"),
        /permission denied/,
      );
      const run = (
        operation: string,
        arguments_: Request["arguments"],
        key: string = crypto.randomUUID(),
      ) =>
        app.execute("synthetic", {
          operation,
          arguments: arguments_,
          company_id: "c1",
          contract_version: "1",
          idempotency_key: key,
        });
      const invoice = await run("accounting.sales.invoice.draft", {
        contact: "Synthetic customer",
        number: "CONCURRENT-1",
        issued: "2026-10-02",
        due: "2026-10-20",
        currency: "AUD",
        control_account: "ar",
        evidence: [source],
        lines: [{
          description: "Synthetic service",
          account_id: "sales",
          net: "100.00",
          tax: "0.00",
          tax_account: null,
          tax_rule_ref: null,
        }],
      });
      const approvals = await Promise.allSettled([
        run("accounting.documents.approve", {
          document_id: invoice.document_id,
          expected_version: 1,
        }),
        run("accounting.documents.approve", {
          document_id: invoice.document_id,
          expected_version: 1,
        }),
      ]);
      assert.equal(approvals.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(approvals.filter((r) => r.status === "rejected").length, 1);
      const paymentArgs = {
        document_id: invoice.document_id,
        expected_version: 2,
        amount: "60.00",
        effective_date: "2026-10-03",
        bank_account: "bank",
        evidence: [source],
      };
      const payments = await Promise.allSettled([
        run("accounting.documents.payment.record", paymentArgs),
        run("accounting.documents.payment.record", paymentArgs),
      ]);
      assert.equal(payments.filter((r) => r.status === "fulfilled").length, 1);
      const payment = payments.find((r) => r.status === "fulfilled")!.value;
      assert.equal(payment.remaining, "40.00");
      await assert.rejects(
        run("accounting.documents.payment.record", {
          ...paymentArgs,
          expected_version: 3,
        }),
        /overpayment/,
      );
      await run("accounting.documents.payment.reverse", {
        allocation_id: payment.allocation_id,
        expected_version: 3,
        effective_date: "2026-10-04",
        reason: "Synthetic correction",
        evidence: [source],
      });
      await run("accounting.documents.void", {
        document_id: invoice.document_id,
        expected_version: 4,
        effective_date: "2026-10-05",
        reason: "Synthetic void",
        evidence: [source],
      });
      assert.equal(
        (await run("accounting.reporting.run", {
          report: "aged_receivables",
          through: "2026-10-03",
          basis: "accrual",
        })).rows[0].amount,
        "40.00",
      );
      assert.equal(
        (await run("accounting.reporting.run", {
          report: "aged_receivables",
          through: "2026-10-05",
          basis: "accrual",
        })).rows.length,
        0,
      );
      // Commit actually succeeds; only its acknowledgement is lost. Reconcile using the same key.
      let loseAck = true;
      const lostAckPool = {
        connect: async () => {
          const client = await pool!.connect();
          return {
            query: async (sql: string | pg.QueryConfig, params?: unknown[]) => {
              const result = typeof sql === "string"
                ? await client.query(sql, params)
                : await client.query(sql);
              if (sql === "COMMIT" && loseAck) {
                loseAck = false;
                throw Error("synthetic_ack_loss");
              }
              return result;
            },
            release: (error?: Error) => client.release(error),
          };
        },
      } as unknown as pg.Pool;
      const uncertainApp = new Accounting(
        new PostgresDatabase(lostAckPool),
        boundary,
      );
      const uncertainRequest = { ...request, idempotency_key: "lost-ack" };
      await assert.rejects(
        uncertainApp.execute("synthetic", uncertainRequest),
        /commit_outcome_unknown_retry_same_key/,
      );
      const reconciled = await app.execute("synthetic", uncertainRequest);
      assert.equal(reconciled.state, "POSTED");
      assert.equal(
        (await admin.query(
          "SELECT count(*)::int n FROM accounting.commands WHERE key='lost-ack'",
        )).rows[0].n,
        1,
      );
      const chartRevision =
        (await run("accounting.workspace.get", {})).book.revision;
      const chartChanges = await Promise.allSettled(
        ["expense-a", "expense-b"].map((account_id) =>
          run("accounting.accounts.create", {
            account_id,
            name: "Synthetic expense",
            kind: "expense",
            expected_revision: chartRevision,
          })
        ),
      );
      assert.equal(
        chartChanges.filter((r) => r.status === "fulfilled").length,
        1,
      );
      assert.equal(
        chartChanges.filter((r) => r.status === "rejected").length,
        1,
      );
      const chartAccount = chartChanges.find((r) =>
        r.status === "fulfilled"
      )!.value.account;
      await run("accounting.accounts.archive", {
        account_id: chartAccount.id,
        expected_revision:
          (await run("accounting.workspace.get", {})).book.revision,
        reason: "Synthetic unused account",
      });
      await assert.rejects(
        run("accounting.accounts.archive", {
          account_id: "bank",
          expected_revision:
            (await run("accounting.workspace.get", {})).book.revision,
          reason: "Protected control test",
        }),
        /protected_account/,
      );
      const creditInvoice = await run("accounting.sales.invoice.draft", {
        contact: "Synthetic customer",
        number: "CONCURRENT-CREDIT",
        issued: "2026-10-02",
        due: "2026-10-20",
        currency: "AUD",
        control_account: "ar",
        evidence: [source],
        lines: [{
          description: "Synthetic service",
          account_id: "sales",
          net: "100.00",
          tax: "0.00",
          tax_account: null,
          tax_rule_ref: null,
        }],
      });
      await run("accounting.documents.approve", {
        document_id: creditInvoice.document_id,
        expected_version: 1,
      });
      const creditArgs = {
        document_id: creditInvoice.document_id,
        expected_version: 2,
        number: "PG-CREDIT",
        amount: "70.00",
        effective_date: "2026-10-03",
        reason: "Synthetic allowance",
        evidence: [source],
      };
      const creditRace = await Promise.allSettled([
        run("accounting.documents.credit.record", creditArgs),
        run("accounting.documents.payment.record", {
          document_id: creditInvoice.document_id,
          expected_version: 2,
          amount: "70.00",
          effective_date: "2026-10-03",
          bank_account: "bank",
          evidence: [source],
        }),
      ]);
      assert.equal(
        creditRace.filter((r) => r.status === "fulfilled").length,
        1,
      );
      const winner = creditRace.find((r) => r.status === "fulfilled")!.value;
      assert.equal(winner.remaining, "30.00");
      await assert.rejects(
        run("accounting.documents.credit.record", {
          ...creditArgs,
          expected_version: 3,
          number: "PG-OVER",
          amount: "30.01",
        }),
        /overcredit/,
      );
      const restArgs = {
        document_id: creditInvoice.document_id,
        expected_version: 3,
        amount: "30.00",
        effective_date: "2026-10-04",
        bank_account: "bank",
        evidence: [source],
      };
      const duplicates = await Promise.all(Array.from({ length: 20 }, () =>
        run(
          "accounting.documents.payment.record",
          restArgs,
          "cash-last-payment",
        )));
      assert.equal(
        new Set(duplicates.map((r) => r.journal_id)).size,
        1,
      );
      const cash = await run("accounting.reporting.run", {
        report: "profit_and_loss",
        through: "2026-10-04",
        basis: "cash",
      });
      assert.equal(cash.profit, winner.credit_id ? "30.00" : "100.00");
      if (winner.credit_id) {
        await run("accounting.documents.credit.reverse", {
          credit_id: winner.credit_id,
          expected_version: 4,
          effective_date: "2026-10-05",
          reason: "Synthetic correction",
          evidence: [source],
        });
      } else {await run("accounting.documents.payment.reverse", {
          allocation_id: winner.allocation_id,
          expected_version: 4,
          effective_date: "2026-10-05",
          reason: "Synthetic correction",
          evidence: [source],
        });}
      assert.equal(
        (await run("accounting.reporting.run", {
          report: "profit_and_loss",
          through: "2026-10-05",
          basis: "cash",
        })).profit,
        "30.00",
      );
      const editInput = {
        contact: "Synthetic draft customer",
        number: "PG-EDIT-RACE",
        issued: "2026-10-02",
        due: "2026-10-20",
        currency: "AUD",
        control_account: "ar",
        evidence: [source],
        lines: [{
          description: "Original service",
          account_id: "sales",
          net: "25.00",
          tax: "0.00",
          tax_account: null,
          tax_rule_ref: null,
        }],
      };
      const editable = await run("accounting.sales.invoice.draft", editInput);
      const editRace = await Promise.allSettled([
        run("accounting.documents.draft.update", {
          ...editInput,
          document_id: editable.document_id,
          expected_version: 1,
          lines: [{ ...editInput.lines[0], net: "40.00" }],
        }),
        run("accounting.documents.approve", {
          document_id: editable.document_id,
          expected_version: 1,
        }),
      ]);
      assert.equal(editRace.filter((r) => r.status === "fulfilled").length, 1);
      assert.match(
        (editRace.find((r) => r.status === "rejected") as PromiseRejectedResult)
          .reason.message,
        /version_conflict/,
      );
      const editWon = editRace.find((r) =>
        r.status === "fulfilled"
      )!.value.state === "DRAFT";
      if (editWon) {
        await run("accounting.documents.approve", {
          document_id: editable.document_id,
          expected_version: 2,
        });
      }
      const versions = (await run("accounting.documents.history", {
        document_id: editable.document_id,
      })).revisions;
      assert.equal(versions.length, editWon ? 3 : 2);
      assert.equal(versions[0].snapshot.lines[0].net, "25.00");
      assert.equal(
        versions.at(-1).snapshot.lines[0].net,
        editWon ? "40.00" : "25.00",
      );
      assert.ok(versions.every((r: any) => r.actor_id === "a1"));
      const posted = (await admin.query(
        "SELECT amount::text FROM accounting.lines WHERE journal_id=$1 AND ordinal=0",
        [versions.at(-1).snapshot.journal_id],
      )).rows;
      assert.equal(posted[0].amount, editWon ? "4000" : "2500");
      const audit = await app.execute("synthetic", {
        operation: "accounting.audit.verify",
        contract_version: "1",
        company_id: "c1",
        arguments: {},
      });
      assert.equal(audit.events, editWon ? 117 : 116);
      assert.equal(audit.valid, true);
    } finally {
      await pool?.end();
      await admin.end();
    }
  },
);
