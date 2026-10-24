import { date, decimal, digest, minor, roundRatio } from "./money.ts";
import { forecast } from "./forecast.ts";
import { allocate, type Component } from "./allocation.ts";

export type Row = Record<string, any>;
export interface Sql {
  query<T extends Row = Row>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}
export type Evidence = {
  file_id: string;
  revision: string;
  sha256: string;
  locator: string;
};
export type Actor = {
  actor_id: string;
  tenant_id: string;
  company_ids: string[];
  operations: string[];
  policy_ref: string;
  expires_at: string;
};
export type Request = {
  operation: string;
  contract_version: "1";
  company_id: string;
  idempotency_key?: string;
  arguments: Row;
};
export interface Boundary {
  /** Supplied by canonical Sandy API, never deserialised from customer arguments. */
  authorize(
    session: string,
    request: Request,
    inputDigest: string,
    tx: Sql,
  ): Promise<Actor>;
  evidence(
    actor: Actor,
    company: string,
    source: Evidence,
    tx: Sql,
  ): Promise<boolean>;
  now(): string;
}
export const operations = {
  "accounting.ledger.journal.post": "R2",
  "accounting.ledger.journal.reverse": "R2",
  "accounting.organisations.period.lock": "R2",
  "accounting.accounts.create": "R2",
  "accounting.accounts.archive": "R2",
  "accounting.sales.invoice.draft": "R1",
  "accounting.payables.bill.draft": "R1",
  "accounting.documents.approve": "R2",
  "accounting.documents.payment.record": "R2",
  "accounting.documents.payment.reverse": "R2",
  "accounting.documents.credit.record": "R2",
  "accounting.documents.credit.reverse": "R2",
  "accounting.documents.void": "R2",
  "accounting.banking.statements.import": "R2",
  "accounting.banking.reconcile.apply": "R2",
  "accounting.banking.reconcile.reverse": "R2",
  "accounting.reporting.run": "R0",
  "accounting.reporting.drilldown": "R0",
  "accounting.workspace.get": "R0",
  "accounting.intelligence.matches.propose": "R0",
  "accounting.intelligence.cashflow.forecast": "R0",
  "accounting.audit.verify": "R0",
} as const;

function check(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error(code);
}
function text(v: unknown, name: string, max = 300): string {
  check(
    typeof v === "string" && v.length > 0 && v.length <= max,
    "invalid_" + name,
  );
  return v;
}
function exact(a: Row, keys: string[], required = keys) {
  check(a && typeof a === "object" && !Array.isArray(a), "invalid_arguments");
  check(
    Object.keys(a).every((k) => keys.includes(k)) &&
      required.every((k) => Object.hasOwn(a, k)),
    "argument_fields",
  );
}
function integer(v: unknown, name: string, max = 1000000): number {
  check(
    Number.isInteger(v) && Number(v) >= 0 && Number(v) <= max,
    "invalid_" + name,
  );
  return Number(v);
}
const id = () => crypto.randomUUID();

/** Accounting application service. No network/provider executors, credentials or new identity store. */
export class Accounting {
  db: Database;
  boundary: Boundary;
  constructor(db: Database, boundary: Boundary) {
    this.db = db;
    this.boundary = boundary;
  }
  async execute(session: string, request: Request): Promise<Row> {
    request = structuredClone(request);
    exact(request, [
      "operation",
      "contract_version",
      "company_id",
      "idempotency_key",
      "arguments",
    ], ["operation", "contract_version", "company_id", "arguments"]);
    check(
      Object.hasOwn(operations, request.operation),
      "unsupported_operation",
    );
    check(request.contract_version === "1", "contract_version");
    text(request.company_id, "company");
    const read =
      operations[request.operation as keyof typeof operations] === "R0";
    if (!read) text(request.idempotency_key, "idempotency_key", 150);
    const hash = await digest({
      operation: request.operation,
      company_id: request.company_id,
      arguments: request.arguments,
      contract_version: request.contract_version,
    });
    return this.db.transaction(async (tx) => {
      // Re-evaluate after acquiring the transaction, including on idempotent retries.
      const actor = await this.boundary.authorize(session, request, hash, tx);
      check(
        actor && actor.company_ids.includes(request.company_id) &&
          actor.operations.includes(request.operation) &&
          Date.parse(actor.expires_at) > Date.parse(this.boundary.now()),
        "forbidden",
      );
      await tx.query("SET LOCAL ROLE accounting_fixture");
      await tx.query(
        "SELECT set_config('accounting.tenant',$1,true),set_config('accounting.company',$2,true)",
        [actor.tenant_id, request.company_id],
      );
      const scope = [actor.tenant_id, request.company_id];
      const book = (await tx.query(
        "SELECT * FROM accounting.books WHERE tenant_id=$1 AND company_id=$2 FOR UPDATE",
        scope,
      )).rows[0];
      check(book, "book_unavailable");
      const current = await this.boundary.authorize(session, request, hash, tx);
      check(
        current.actor_id === actor.actor_id &&
          current.tenant_id === actor.tenant_id &&
          current.company_ids.includes(request.company_id) &&
          current.operations.includes(request.operation) &&
          current.policy_ref === actor.policy_ref &&
          Date.parse(current.expires_at) > Date.parse(this.boundary.now()),
        "authority_changed",
      );
      const ctx = { tx, actor, scope, book };
      if (read) return this.read(ctx, request);
      const prior = (await tx.query(
        "SELECT input_digest,result FROM accounting.commands WHERE tenant_id=$1 AND company_id=$2 AND actor_id=$3 AND operation=$4 AND key=$5",
        [
          ...scope,
          actor.actor_id,
          request.operation,
          request.idempotency_key,
        ],
      )).rows[0];
      if (prior) {
        check(prior.input_digest === hash, "idempotency_conflict");
        return prior.result;
      }
      const result = await this.mutate(ctx, request);
      const previous = (await tx.query(
        "SELECT digest FROM accounting.events WHERE tenant_id=$1 AND company_id=$2 ORDER BY sequence DESC LIMIT 1",
        scope,
      )).rows[0]?.digest ?? "";
      const sequence = (BigInt(book.revision) + 1n).toString();
      const event = {
        tenant_id: actor.tenant_id,
        company_id: request.company_id,
        sequence,
        actor_id: actor.actor_id,
        operation: request.operation,
        input_digest: hash,
        result_digest: await digest(result),
        previous_digest: previous,
        policy_ref: actor.policy_ref,
        happened_at: this.boundary.now(),
      };
      const eventHash = await digest(event);
      await tx.query(
        "INSERT INTO accounting.events(tenant_id,company_id,sequence,actor_id,operation,input_digest,result_digest,previous_digest,digest,policy_ref,happened_at,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          ...scope,
          sequence,
          actor.actor_id,
          request.operation,
          hash,
          event.result_digest,
          previous,
          eventHash,
          actor.policy_ref,
          event.happened_at,
          JSON.stringify(result),
        ],
      );
      await tx.query(
        "UPDATE accounting.books SET revision=$3 WHERE tenant_id=$1 AND company_id=$2",
        [...scope, sequence],
      );
      const receipt = {
        ...result,
        receipt: {
          sequence,
          digest: eventHash,
          policy_ref: actor.policy_ref,
          financial_effect: "LOCAL_BOOK_RECORD",
          provider_verified: false,
        },
      };
      await tx.query(
        "INSERT INTO accounting.commands VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          ...scope,
          actor.actor_id,
          request.operation,
          request.idempotency_key,
          hash,
          JSON.stringify(receipt),
        ],
      );
      return receipt;
    });
  }
  async evidence(c: Context, sources: unknown): Promise<Evidence[]> {
    check(
      Array.isArray(sources) && sources.length > 0 && sources.length <= 30,
      "evidence_required",
    );
    for (const source of sources) {
      exact(source, ["file_id", "revision", "sha256", "locator"]);
      text(source.file_id, "file");
      text(source.revision, "revision");
      text(source.locator, "locator");
      check(
        typeof source.sha256 === "string" &&
          /^[a-f0-9]{64}$/.test(source.sha256),
        "evidence_digest",
      );
      check(
        await this.boundary.evidence(c.actor, c.scope[1], source, c.tx),
        "evidence_missing_or_revoked",
      );
    }
    return sources;
  }
  async account(c: Context, accountId: unknown, control?: string) {
    const a = (await c.tx.query(
      "SELECT * FROM accounting.accounts WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
      [...c.scope, text(accountId, "account")],
    )).rows[0];
    check(
      a?.active && (!control || a.control === control),
      "account_unavailable",
    );
    return a;
  }
  async post(
    c: Context,
    a: Row,
    source: string,
    reversalOf: string | null = null,
  ) {
    exact(a, [
      "effective_date",
      "narration",
      "currency",
      "precision",
      "fx",
      "cash_basis",
      "evidence",
      "lines",
    ], [
      "effective_date",
      "narration",
      "currency",
      "precision",
      "evidence",
      "lines",
    ]);
    date(a.effective_date);
    text(a.narration, "narration");
    check(/^[A-Z]{3}$/.test(a.currency), "currency");
    integer(a.precision, "precision", 6);
    await this.evidence(c, a.evidence);
    check(
      Array.isArray(a.lines) && a.lines.length >= 2 && a.lines.length <= 1000,
      "journal_lines",
    );
    let numerator = 1n, denominator = 1n;
    if (a.currency !== c.book.currency) {
      exact(a.fx, ["numerator", "denominator", "source", "date"]);
      date(a.fx.date);
      check(a.fx.date <= a.effective_date, "future_fx");
      check(
        /^[1-9]\d{0,17}$/.test(a.fx.numerator) &&
          /^[1-9]\d{0,17}$/.test(a.fx.denominator),
        "fx_ratio",
      );
      await this.evidence(c, [a.fx.source]);
      numerator = BigInt(a.fx.numerator) * 10n ** BigInt(c.book.precision);
      denominator = BigInt(a.fx.denominator) * 10n ** BigInt(a.precision);
    } else {check(
        a.precision === c.book.precision && a.fx === undefined,
        "invalid_base_currency",
      );}
    let total = 0n, base = 0n, hasBank = false;
    const lines = [];
    for (const l of a.lines) {
      exact(l, ["account_id", "amount"]);
      const account = await this.account(c, l.account_id);
      hasBank = hasBank || account.control === "bank";
      const amount = minor(l.amount, a.precision);
      check(amount !== 0n, "zero_line");
      const baseAmount = roundRatio(amount, numerator, denominator);
      total += amount;
      base += baseAmount;
      lines.push({
        account_id: l.account_id,
        amount: amount.toString(),
        base_amount: baseAmount.toString(),
      });
    }
    check(total === 0n && base === 0n, "journal_unbalanced_or_fx_rounding");
    check(
      a.cash_basis === undefined || typeof a.cash_basis === "boolean",
      "cash_basis_flag",
    );
    const cashBasis = a.cash_basis ?? (source === "manual" && hasBank);
    const journalId = id();
    await c.tx.query(
      "INSERT INTO accounting.journals(tenant_id,company_id,id,effective_date,narration,currency,precision,fx,evidence,actor_id,source,reversal_of,cash_basis) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        ...c.scope,
        journalId,
        a.effective_date,
        a.narration,
        a.currency,
        a.precision,
        a.fx ? JSON.stringify(a.fx) : null,
        JSON.stringify(a.evidence),
        c.actor.actor_id,
        source,
        reversalOf,
        cashBasis,
      ],
    );
    await c.tx.query(
      "INSERT INTO accounting.lines SELECT $1,$2,$3,(ordinality-1)::integer,l->>'account_id',(l->>'amount')::numeric,(l->>'base_amount')::numeric FROM jsonb_array_elements($4::jsonb) WITH ORDINALITY AS x(l,ordinality)",
      [...c.scope, journalId, JSON.stringify(lines)],
    );
    await c.tx.query(
      "UPDATE accounting.journals SET state='POSTED' WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
      [...c.scope, journalId],
    );
    return {
      journal_id: journalId,
      state: "POSTED",
      currency: a.currency,
      lines,
    };
  }
  async mutate(c: Context, r: Request): Promise<Row> {
    const a = r.arguments;
    switch (r.operation) {
      case "accounting.accounts.create": {
        exact(a, ["account_id", "name", "kind", "expected_revision"]);
        check(
          String(a.expected_revision) === String(c.book.revision),
          "version_conflict",
        );
        check(
          typeof a.account_id === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(a.account_id),
          "invalid_account_id",
        );
        text(a.name, "account_name", 120);
        check(a.name.trim() === a.name, "invalid_account_name");
        check(
          ["asset", "liability", "equity", "revenue", "expense"].includes(
            a.kind,
          ),
          "invalid_account_kind",
        );
        const account = (await c.tx.query(
          "INSERT INTO accounting.accounts(tenant_id,company_id,id,name,kind,control,active) VALUES($1,$2,$3,$4,$5,NULL,true) RETURNING *",
          [...c.scope, a.account_id, a.name, a.kind],
        )).rows[0];
        return { account, state: "ACTIVE" };
      }
      case "accounting.accounts.archive": {
        exact(a, ["account_id", "expected_revision", "reason"]);
        check(
          String(a.expected_revision) === String(c.book.revision),
          "version_conflict",
        );
        text(a.reason, "reason");
        await this.account(c, a.account_id);
        const account = (await c.tx.query(
          "UPDATE accounting.accounts SET active=false WHERE tenant_id=$1 AND company_id=$2 AND id=$3 RETURNING *",
          [...c.scope, a.account_id],
        )).rows[0];
        return { account, state: "ARCHIVED", reason: a.reason };
      }
      case "accounting.ledger.journal.post": {
        // Subledger control accounts only change through their owning service.
        check(Array.isArray(a.lines), "journal_lines");
        for (const l of a.lines) {
          check(
            !["ar", "ap"].includes(
              (await this.account(c, l.account_id)).control,
            ),
            "subledger_operation_required",
          );
        }
        return this.post(c, a, "manual");
      }
      case "accounting.ledger.journal.reverse": {
        exact(a, ["journal_id", "effective_date", "reason", "evidence"]);
        date(a.effective_date);
        text(a.reason, "reason");
        const j = (await c.tx.query(
          "SELECT * FROM accounting.journals WHERE tenant_id=$1 AND company_id=$2 AND id=$3 AND state='POSTED'",
          [...c.scope, a.journal_id],
        )).rows[0];
        check(
          j && j.source === "manual" && !j.reversal_of,
          "manual_journal_required",
        );
        return this.reverse(c, j, a, "reversal");
      }
      case "accounting.organisations.period.lock": {
        exact(a, ["through", "expected_revision"]);
        date(a.through);
        check(
          String(a.expected_revision) === String(c.book.revision),
          "version_conflict",
        );
        check(
          !c.book.locked_through ||
            a.through >= c.book.locked_through.toISOString().slice(0, 10),
          "reopen_not_supported",
        );
        await c.tx.query(
          "UPDATE accounting.books SET locked_through=$3 WHERE tenant_id=$1 AND company_id=$2",
          [...c.scope, a.through],
        );
        return { locked_through: a.through };
      }
      case "accounting.sales.invoice.draft":
      case "accounting.payables.bill.draft": {
        exact(a, [
          "contact",
          "number",
          "issued",
          "due",
          "currency",
          "control_account",
          "lines",
          "evidence",
        ]);
        date(a.issued);
        date(a.due);
        check(a.due >= a.issued, "due_before_issue");
        text(a.contact, "contact");
        text(a.number, "number");
        check(a.currency === c.book.currency, "document_fx_not_supported");
        const kind = r.operation.includes("invoice") ? "invoice" : "bill";
        await this.account(
          c,
          a.control_account,
          kind === "invoice" ? "ar" : "ap",
        );
        await this.evidence(c, a.evidence);
        check(
          Array.isArray(a.lines) && a.lines.length > 0 && a.lines.length <= 300,
          "document_lines",
        );
        let total = 0n;
        for (const l of a.lines) {
          exact(l, [
            "description",
            "account_id",
            "net",
            "tax",
            "tax_account",
            "tax_rule_ref",
          ]);
          text(l.description, "description");
          const account = await this.account(c, l.account_id);
          check(
            !account.control &&
              account.kind === (kind === "invoice" ? "revenue" : "expense"),
            "document_account_kind",
          );
          const net = minor(l.net, c.book.precision),
            tax = minor(l.tax, c.book.precision);
          check(net > 0n && tax >= 0n, "document_amount");
          if (tax > 0n) {
            await this.account(c, l.tax_account, "tax");
            await this.evidence(c, [l.tax_rule_ref]);
          } else {check(
              l.tax_account === null && l.tax_rule_ref === null,
              "zero_tax_fields",
            );}
          total += net + tax;
        }
        const documentId = id();
        await c.tx.query(
          "INSERT INTO accounting.documents(tenant_id,company_id,id,kind,contact,number,issued,due,currency,lines,total,control_account,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
          [
            ...c.scope,
            documentId,
            kind,
            a.contact,
            a.number,
            a.issued,
            a.due,
            a.currency,
            JSON.stringify(a.lines),
            total.toString(),
            a.control_account,
            JSON.stringify(a.evidence),
          ],
        );
        return {
          document_id: documentId,
          state: "DRAFT",
          total: decimal(total, c.book.precision),
          version: 1,
        };
      }
      case "accounting.documents.approve": {
        exact(a, ["document_id", "expected_version"]);
        const d = await this.document(c, a.document_id);
        check(d.version === a.expected_version, "version_conflict");
        check(!d.journal_id, "already_approved");
        const sign = d.kind === "invoice" ? 1n : -1n;
        const lines = [{
          account_id: d.control_account,
          amount: decimal(sign * BigInt(d.total), c.book.precision),
        }];
        for (const l of d.lines) {
          lines.push({
            account_id: l.account_id,
            amount: decimal(
              -sign * minor(l.net, c.book.precision),
              c.book.precision,
            ),
          });
          if (minor(l.tax, c.book.precision) > 0n) {
            await this.evidence(c, [l.tax_rule_ref]);
            lines.push({
              account_id: l.tax_account,
              amount: decimal(
                -sign * minor(l.tax, c.book.precision),
                c.book.precision,
              ),
            });
          }
        }
        const journal = await this.post(c, {
          effective_date: d.issued.toISOString().slice(0, 10),
          narration: d.kind + " " + d.number,
          currency: d.currency,
          precision: c.book.precision,
          evidence: d.evidence,
          lines,
        }, d.kind);
        await c.tx.query(
          "UPDATE accounting.documents SET journal_id=$4,version=version+1 WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, d.id, journal.journal_id],
        );
        return {
          document_id: d.id,
          state: "APPROVED",
          journal_id: journal.journal_id,
          version: d.version + 1,
        };
      }
      case "accounting.documents.payment.record": {
        exact(a, [
          "document_id",
          "expected_version",
          "amount",
          "effective_date",
          "bank_account",
          "evidence",
        ]);
        const d = await this.document(c, a.document_id);
        check(d.version === a.expected_version, "version_conflict");
        check(
          d.journal_id && !d.void_journal_id,
          "document_unapproved_or_void",
        );
        date(a.effective_date);
        check(
          a.effective_date >= d.issued.toISOString().slice(0, 10),
          "payment_before_issue",
        );
        await this.checkSettlementDate(
          c,
          d.id,
          a.effective_date,
          "payment_before_history",
        );
        await this.account(c, a.bank_account, "bank");
        const amount = minor(a.amount, c.book.precision);
        const paid = await this.paid(c, d.id) + await this.credited(c, d.id);
        check(amount > 0n && amount + paid <= BigInt(d.total), "overpayment");
        const components = allocate(
          amount,
          await this.remainingComponents(c, d),
        );
        const sign = d.kind === "invoice" ? 1n : -1n;
        const j = await this.post(c, {
          effective_date: a.effective_date,
          narration: "Recorded payment " + d.number,
          currency: d.currency,
          precision: c.book.precision,
          evidence: a.evidence,
          lines: [{
            account_id: a.bank_account,
            amount: decimal(sign * amount, c.book.precision),
          }, {
            account_id: d.control_account,
            amount: decimal(-sign * amount, c.book.precision),
          }],
        }, "payment");
        const allocationId = id();
        await c.tx.query(
          "INSERT INTO accounting.allocations VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            ...c.scope,
            allocationId,
            d.id,
            j.journal_id,
            amount.toString(),
            JSON.stringify(components),
          ],
        );
        await c.tx.query(
          "UPDATE accounting.documents SET version=version+1 WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, d.id],
        );
        return {
          document_id: d.id,
          allocation_id: allocationId,
          journal_id: j.journal_id,
          state: amount + paid === BigInt(d.total)
            ? "PAYMENT_RECORDED"
            : "PARTIAL_PAYMENT_RECORDED",
          remaining: decimal(BigInt(d.total) - amount - paid, c.book.precision),
          money_moved: false,
          version: d.version + 1,
        };
      }
      case "accounting.documents.payment.reverse": {
        exact(a, [
          "allocation_id",
          "expected_version",
          "effective_date",
          "reason",
          "evidence",
        ]);
        const allocation = (await c.tx.query(
          "SELECT * FROM accounting.allocations WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, text(a.allocation_id, "allocation")],
        )).rows[0];
        check(allocation, "allocation_unavailable");
        const d = await this.document(c, allocation.document_id);
        check(d.version === a.expected_version, "version_conflict");
        const j = (await c.tx.query(
          "SELECT * FROM accounting.journals WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, allocation.journal_id],
        )).rows[0];
        const reversal = await this.reverse(c, j, a, "payment_reversal");
        await c.tx.query(
          "INSERT INTO accounting.allocation_reversals VALUES($1,$2,$3,$4)",
          [...c.scope, allocation.id, reversal.journal_id],
        );
        await c.tx.query(
          "UPDATE accounting.documents SET version=version+1 WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, d.id],
        );
        return {
          document_id: d.id,
          journal_id: reversal.journal_id,
          state: "PAYMENT_RECORD_REVERSED",
          money_moved: false,
          version: d.version + 1,
        };
      }
      case "accounting.documents.credit.record": {
        exact(a, [
          "document_id",
          "expected_version",
          "number",
          "amount",
          "effective_date",
          "reason",
          "evidence",
        ]);
        const d = await this.document(c, a.document_id);
        check(d.version === a.expected_version, "version_conflict");
        check(
          d.journal_id && !d.void_journal_id,
          "document_unapproved_or_void",
        );
        text(a.number, "credit_number", 60);
        text(a.reason, "reason");
        date(a.effective_date);
        check(
          a.effective_date >= d.issued.toISOString().slice(0, 10),
          "credit_before_issue",
        );
        await this.checkSettlementDate(
          c,
          d.id,
          a.effective_date,
          "credit_before_history",
        );
        const amount = minor(a.amount, c.book.precision);
        const settled = await this.paid(c, d.id) + await this.credited(c, d.id);
        check(amount > 0n && amount + settled <= BigInt(d.total), "overcredit");
        const components = allocate(
          amount,
          await this.remainingComponents(c, d),
        );
        const sign = d.kind === "invoice" ? 1n : -1n;
        const j = await this.post(c, {
          effective_date: a.effective_date,
          narration: "Credit " + a.number + " for " + d.number,
          currency: d.currency,
          precision: c.book.precision,
          evidence: a.evidence,
          lines: [
            {
              account_id: d.control_account,
              amount: decimal(-sign * amount, c.book.precision),
            },
            ...components.map((v) => ({
              account_id: v.account_id,
              amount: decimal(sign * BigInt(v.amount), c.book.precision),
            })),
          ],
        }, "credit");
        const creditId = id();
        await c.tx.query(
          "INSERT INTO accounting.credits VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            ...c.scope,
            creditId,
            d.id,
            j.journal_id,
            a.number,
            amount.toString(),
            JSON.stringify(components),
            a.reason,
          ],
        );
        await c.tx.query(
          "UPDATE accounting.documents SET version=version+1 WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, d.id],
        );
        return {
          document_id: d.id,
          credit_id: creditId,
          journal_id: j.journal_id,
          state: "CREDIT_APPLIED",
          remaining: decimal(
            BigInt(d.total) - settled - amount,
            c.book.precision,
          ),
          version: d.version + 1,
          money_moved: false,
        };
      }
      case "accounting.documents.credit.reverse": {
        exact(a, [
          "credit_id",
          "expected_version",
          "effective_date",
          "reason",
          "evidence",
        ]);
        const credit = (await c.tx.query(
          "SELECT * FROM accounting.credits WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, text(a.credit_id, "credit")],
        )).rows[0];
        check(credit, "credit_unavailable");
        const d = await this.document(c, credit.document_id);
        check(d.version === a.expected_version, "version_conflict");
        const j = (await c.tx.query(
          "SELECT * FROM accounting.journals WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, credit.journal_id],
        )).rows[0];
        const reversal = await this.reverse(c, j, a, "credit_reversal");
        await c.tx.query(
          "INSERT INTO accounting.credit_reversals VALUES($1,$2,$3,$4)",
          [...c.scope, credit.id, reversal.journal_id],
        );
        await c.tx.query(
          "UPDATE accounting.documents SET version=version+1 WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, d.id],
        );
        return {
          document_id: d.id,
          credit_id: credit.id,
          journal_id: reversal.journal_id,
          state: "CREDIT_REVERSED",
          version: d.version + 1,
          money_moved: false,
        };
      }
      case "accounting.documents.void": {
        exact(a, [
          "document_id",
          "expected_version",
          "effective_date",
          "reason",
          "evidence",
        ]);
        const d = await this.document(c, a.document_id);
        check(d.version === a.expected_version, "version_conflict");
        check(
          d.journal_id && !d.void_journal_id,
          "document_unapproved_or_void",
        );
        check(await this.paid(c, d.id) === 0n, "reverse_payments_first");
        check(await this.credited(c, d.id) === 0n, "reverse_credits_first");
        await this.checkSettlementDate(
          c,
          d.id,
          date(a.effective_date),
          "void_before_payment_history",
        );
        const j = (await c.tx.query(
          "SELECT * FROM accounting.journals WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, d.journal_id],
        )).rows[0];
        const reversal = await this.reverse(c, j, a, "document_void");
        await c.tx.query(
          "UPDATE accounting.documents SET void_journal_id=$4,version=version+1 WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, d.id, reversal.journal_id],
        );
        return {
          document_id: d.id,
          journal_id: reversal.journal_id,
          state: "VOIDED",
          version: d.version + 1,
        };
      }
      case "accounting.banking.statements.import": {
        exact(a, ["bank_account", "lines"]);
        await this.account(c, a.bank_account, "bank");
        check(
          Array.isArray(a.lines) && a.lines.length > 0 &&
            a.lines.length <= 2000,
          "statement_lines",
        );
        const ids = [];
        for (const l of a.lines) {
          exact(l, [
            "source_key",
            "effective_date",
            "amount",
            "reference",
            "evidence",
          ]);
          text(l.source_key, "source_key");
          date(l.effective_date);
          text(l.reference, "reference");
          await this.evidence(c, l.evidence);
          const amount = minor(l.amount, c.book.precision);
          check(amount !== 0n, "zero_statement");
          const old = (await c.tx.query(
            "SELECT * FROM accounting.statements WHERE tenant_id=$1 AND company_id=$2 AND bank_account=$3 AND source_key=$4",
            [...c.scope, a.bank_account, l.source_key],
          )).rows[0];
          if (old) {
            check(
              old.amount === amount.toString() &&
                old.reference === l.reference &&
                old.effective_date.toISOString().slice(0, 10) ===
                  l.effective_date &&
                await digest(old.evidence) === await digest(l.evidence),
              "statement_source_conflict",
            );
            ids.push(old.id);
            continue;
          }
          const sid = id();
          await c.tx.query(
            "INSERT INTO accounting.statements VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              ...c.scope,
              sid,
              a.bank_account,
              l.source_key,
              l.effective_date,
              amount.toString(),
              l.reference,
              JSON.stringify(l.evidence),
            ],
          );
          ids.push(sid);
        }
        return { statement_ids: ids, state: "IMPORTED", reconciled: false };
      }
      case "accounting.banking.reconcile.apply": {
        exact(a, ["statement_id", "journal_id", "ordinal", "amount"]);
        integer(a.ordinal, "ordinal", 999);
        const s = (await c.tx.query(
          "SELECT * FROM accounting.statements WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
          [...c.scope, a.statement_id],
        )).rows[0];
        const l = (await c.tx.query(
          "SELECT l.*,j.currency,j.effective_date,j.evidence FROM accounting.lines l JOIN accounting.journals j ON j.tenant_id=l.tenant_id AND j.company_id=l.company_id AND j.id=l.journal_id WHERE l.tenant_id=$1 AND l.company_id=$2 AND l.journal_id=$3 AND l.ordinal=$4 AND j.state='POSTED'",
          [...c.scope, a.journal_id, a.ordinal],
        )).rows[0];
        check(
          s && l && s.bank_account === l.account_id &&
            l.currency === c.book.currency,
          "match_target",
        );
        check(
          !c.book.locked_through ||
            (s.effective_date > c.book.locked_through &&
              l.effective_date > c.book.locked_through),
          "period_locked",
        );
        await this.evidence(c, s.evidence);
        await this.evidence(c, l.evidence);
        const amount = minor(a.amount, c.book.precision);
        const active = await this.activeMatches(c);
        const usedS = active.filter((m) => m.statement_id === s.id).reduce(
            (n, m) => n + BigInt(m.amount),
            0n,
          ),
          usedL = active.filter((m) =>
            m.journal_id === a.journal_id && m.ordinal === a.ordinal
          ).reduce((n, m) => n + BigInt(m.amount), 0n);
        check(
          amount !== 0n && amount * BigInt(s.amount) > 0n &&
            amount * BigInt(l.amount) > 0n,
          "match_sign",
        );
        const abs = (n: bigint) => n < 0n ? -n : n;
        check(
          abs(amount + usedS) <= abs(BigInt(s.amount)) &&
            abs(amount + usedL) <= abs(BigInt(l.amount)),
          "overmatched",
        );
        const matchId = id();
        await c.tx.query(
          "INSERT INTO accounting.matches VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            ...c.scope,
            matchId,
            s.id,
            a.journal_id,
            a.ordinal,
            amount.toString(),
          ],
        );
        return {
          match_id: matchId,
          state: amount + usedS === BigInt(s.amount) ? "RECONCILED" : "PARTIAL",
          statement_id: s.id,
        };
      }
      case "accounting.banking.reconcile.reverse": {
        exact(a, ["match_id", "reason"]);
        text(a.reason, "reason");
        const m = (await this.activeMatches(c)).find((m) =>
          m.id === a.match_id
        );
        check(m, "match_unavailable");
        const dates = (await c.tx.query(
          "SELECT s.effective_date AS statement_date,j.effective_date AS journal_date FROM accounting.statements s JOIN accounting.journals j ON j.tenant_id=s.tenant_id AND j.company_id=s.company_id WHERE s.tenant_id=$1 AND s.company_id=$2 AND s.id=$3 AND j.id=$4",
          [...c.scope, m.statement_id, m.journal_id],
        )).rows[0];
        check(
          !c.book.locked_through ||
            (dates.statement_date > c.book.locked_through &&
              dates.journal_date > c.book.locked_through),
          "period_locked",
        );
        await c.tx.query(
          "INSERT INTO accounting.match_reversals VALUES($1,$2,$3,$4)",
          [...c.scope, a.match_id, a.reason],
        );
        return { match_id: a.match_id, state: "UNRECONCILED" };
      }
      default:
        throw Error("unsupported_operation");
    }
  }
  async reverse(c: Context, j: Row, a: Row, source: string) {
    date(a.effective_date);
    text(a.reason, "reason");
    check(
      a.effective_date >= j.effective_date.toISOString().slice(0, 10),
      "reversal_before_original",
    );
    check(
      !(await c.tx.query(
        "SELECT 1 FROM accounting.matches m LEFT JOIN accounting.match_reversals r ON r.tenant_id=m.tenant_id AND r.company_id=m.company_id AND r.match_id=m.id WHERE m.tenant_id=$1 AND m.company_id=$2 AND m.journal_id=$3 AND r.match_id IS NULL",
        [...c.scope, j.id],
      )).rows.length,
      "unreconcile_first",
    );
    const lines = (await c.tx.query(
      "SELECT account_id,amount::text FROM accounting.lines WHERE tenant_id=$1 AND company_id=$2 AND journal_id=$3 ORDER BY ordinal",
      [...c.scope, j.id],
    )).rows;
    return this.post(
      c,
      {
        effective_date: a.effective_date,
        narration: a.reason,
        currency: j.currency,
        precision: j.precision,
        cash_basis: j.cash_basis,
        ...(j.fx ? { fx: j.fx } : {}),
        evidence: a.evidence,
        lines: lines.map((l) => ({
          account_id: l.account_id,
          amount: decimal(-BigInt(l.amount), j.precision),
        })),
      },
      source,
      j.id,
    );
  }
  async document(c: Context, documentId: string) {
    const d = (await c.tx.query(
      "SELECT * FROM accounting.documents WHERE tenant_id=$1 AND company_id=$2 AND id=$3",
      [...c.scope, text(documentId, "document")],
    )).rows[0];
    check(d, "document_unavailable");
    return d;
  }
  async paid(c: Context, documentId: string) {
    return BigInt(
      (await c.tx.query(
        "SELECT coalesce(sum(a.amount),0)::text AS total FROM accounting.allocations a LEFT JOIN accounting.allocation_reversals r ON r.tenant_id=a.tenant_id AND r.company_id=a.company_id AND r.allocation_id=a.id WHERE a.tenant_id=$1 AND a.company_id=$2 AND a.document_id=$3 AND r.allocation_id IS NULL",
        [...c.scope, documentId],
      )).rows[0].total,
    );
  }
  async remainingComponents(c: Context, d: Row): Promise<Component[]> {
    const lines = (await c.tx.query(
      "SELECT ordinal,account_id,abs(amount)::text AS amount FROM accounting.lines WHERE tenant_id=$1 AND company_id=$2 AND journal_id=$3 AND ordinal>0 ORDER BY ordinal",
      [...c.scope, d.journal_id],
    )).rows as Component[];
    const used = (await c.tx.query(
      "SELECT p.components FROM accounting.allocations p LEFT JOIN accounting.allocation_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.allocation_id=p.id WHERE p.tenant_id=$1 AND p.company_id=$2 AND p.document_id=$3 AND r.allocation_id IS NULL UNION ALL SELECT p.components FROM accounting.credits p LEFT JOIN accounting.credit_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.credit_id=p.id WHERE p.tenant_id=$1 AND p.company_id=$2 AND p.document_id=$3 AND r.credit_id IS NULL",
      [...c.scope, d.id],
    )).rows;
    return lines.map((line) => ({
      ...line,
      amount: (BigInt(line.amount) -
        used.reduce(
          (total, payment) =>
            total +
            payment.components.filter((v: Component) =>
              v.ordinal === line.ordinal
            ).reduce((n: bigint, v: Component) => n + BigInt(v.amount), 0n),
          0n,
        )).toString(),
    }));
  }
  async credited(
    c: Context,
    documentId: string,
    through?: string,
  ): Promise<bigint> {
    const row = (await c.tx.query(
      "SELECT coalesce(sum(p.amount),0)::text AS total FROM accounting.credits p JOIN accounting.journals j ON j.tenant_id=p.tenant_id AND j.company_id=p.company_id AND j.id=p.journal_id LEFT JOIN accounting.credit_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.credit_id=p.id LEFT JOIN accounting.journals rj ON rj.tenant_id=r.tenant_id AND rj.company_id=r.company_id AND rj.id=r.journal_id WHERE p.tenant_id=$1 AND p.company_id=$2 AND p.document_id=$3 AND ($4::date IS NULL OR j.effective_date<=$4) AND (rj.id IS NULL OR ($4::date IS NOT NULL AND rj.effective_date>$4))",
      [...c.scope, documentId, through ?? null],
    )).rows[0];
    return BigInt(row.total);
  }
  async checkSettlementDate(
    c: Context,
    documentId: string,
    day: string,
    error: string,
  ) {
    const latest = (await c.tx.query(
      "SELECT accounting.latest_settlement_date($1,$2,$3) AS day",
      [...c.scope, documentId],
    )).rows[0].day;
    check(!latest || day >= latest.toISOString().slice(0, 10), error);
  }
  async activeMatches(c: Context) {
    return (await c.tx.query(
      "SELECT m.* FROM accounting.matches m LEFT JOIN accounting.match_reversals r ON r.tenant_id=m.tenant_id AND r.company_id=m.company_id AND r.match_id=m.id WHERE m.tenant_id=$1 AND m.company_id=$2 AND r.match_id IS NULL",
      c.scope,
    )).rows;
  }
  async cashEntries(c: Context, entries: Row[]): Promise<Row[]> {
    const allocations = (await c.tx.query(
      "SELECT p.*,d.kind,d.journal_id AS source_journal_id,r.journal_id AS reversal_journal_id FROM accounting.allocations p JOIN accounting.documents d ON d.tenant_id=p.tenant_id AND d.company_id=p.company_id AND d.id=p.document_id LEFT JOIN accounting.allocation_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.allocation_id=p.id WHERE p.tenant_id=$1 AND p.company_id=$2",
      c.scope,
    )).rows;
    const accounts = (await c.tx.query(
      "SELECT * FROM accounting.accounts WHERE tenant_id=$1 AND company_id=$2",
      c.scope,
    )).rows;
    const allocationByJournal = new Map<string, Row>();
    for (const allocation of allocations) {
      allocationByJournal.set(allocation.journal_id, allocation);
      if (allocation.reversal_journal_id) {
        allocationByJournal.set(allocation.reversal_journal_id, allocation);
      }
    }
    const accountById = new Map(
      accounts.map((account) => [account.id, account]),
    );
    const output: Row[] = [];
    for (const e of entries) {
      if (["manual", "reversal"].includes(e.source)) {
        if (e.cash_basis) output.push(e);
      } else if (["payment", "payment_reversal"].includes(e.source)) {
        const allocation = allocationByJournal.get(e.journal_id);
        check(allocation, "cash_allocation_missing");
        if (e.control === "bank") {
          output.push(e);
          continue;
        }
        check(["ar", "ap"].includes(e.control), "cash_payment_control");
        const sign = (allocation.kind === "invoice" ? -1n : 1n) *
          (e.source === "payment_reversal" ? -1n : 1n);
        for (const component of allocation.components as Component[]) {
          const account = accountById.get(component.account_id);
          check(account, "cash_component_account");
          output.push({
            ...e,
            account_id: account.id,
            name: account.name,
            kind: account.kind,
            control: account.control,
            base_amount: (sign * BigInt(component.amount)).toString(),
            derived: true,
            allocation_id: allocation.id,
            source_journal_id: allocation.source_journal_id,
            source_ordinal: component.ordinal,
          });
        }
      } else {check(
          ["invoice", "bill", "document_void", "credit", "credit_reversal"]
            .includes(e.source),
          "cash_source_unsupported",
        );}
    }
    return output;
  }
  async read(c: Context, r: Request): Promise<Row> {
    const a = r.arguments;
    if (r.operation === "accounting.intelligence.cashflow.forecast") {
      exact(a, ["as_of", "horizon", "collection_probability_bps"]);
      date(a.as_of);
      integer(a.collection_probability_bps, "probability", 10000);
      check(["13_weeks", "12_months"].includes(a.horizon), "forecast_horizon");
      const previous = new Date(a.as_of + "T00:00:00Z");
      previous.setUTCDate(previous.getUTCDate() - 1);
      const cutoff = previous.toISOString().slice(0, 10);
      const opening = (await c.tx.query(
        "SELECT coalesce(sum(l.base_amount),0)::text AS amount FROM accounting.lines l JOIN accounting.journals j ON j.tenant_id=l.tenant_id AND j.company_id=l.company_id AND j.id=l.journal_id JOIN accounting.accounts a ON a.tenant_id=l.tenant_id AND a.company_id=l.company_id AND a.id=l.account_id WHERE l.tenant_id=$1 AND l.company_id=$2 AND j.state='POSTED' AND j.effective_date<=$3 AND a.control='bank'",
        [...c.scope, cutoff],
      )).rows[0].amount;
      const receivables = await this.read(c, {
        ...r,
        operation: "accounting.reporting.run",
        arguments: {
          report: "aged_receivables",
          through: cutoff,
          basis: "accrual",
        },
      });
      const payables = await this.read(c, {
        ...r,
        operation: "accounting.reporting.run",
        arguments: {
          report: "aged_payables",
          through: cutoff,
          basis: "accrual",
        },
      });
      return {
        ...forecast({
          as_of: a.as_of,
          horizon: a.horizon,
          captured_at: this.boundary.now(),
          currency: c.book.currency,
          precision: c.book.precision,
          opening: decimal(BigInt(opening), c.book.precision),
          flows: [
            ...receivables.rows.map((d: Row) => ({
              source_id: d.document_id,
              due: d.due.toISOString().slice(0, 10),
              amount: d.amount,
              probability_bps: a.collection_probability_bps,
            })),
            ...payables.rows.map((d: Row) => ({
              source_id: d.document_id,
              due: d.due.toISOString().slice(0, 10),
              amount: decimal(
                -minor(d.amount, c.book.precision),
                c.book.precision,
              ),
              probability_bps: 10000,
            })),
          ],
        }),
        company_id: c.scope[1],
        revision: String(c.book.revision),
        coverage: "Posted bank, approved unpaid invoices/bills through " +
          cutoff + " only; not a complete treasury forecast.",
      };
    }
    if (r.operation === "accounting.audit.verify") {
      exact(a, []);
      const events = (await c.tx.query(
        "SELECT * FROM accounting.events WHERE tenant_id=$1 AND company_id=$2 ORDER BY sequence",
        c.scope,
      )).rows;
      let previous = "", sequence = 0n;
      for (const e of events) {
        const { result, digest: hash, ...payload } = e;
        payload.sequence = String(payload.sequence);
        payload.happened_at = payload.happened_at.toISOString();
        check(
          BigInt(payload.sequence) === ++sequence &&
            payload.previous_digest === previous &&
            payload.result_digest === await digest(result) &&
            hash === await digest(payload),
          "audit_chain_invalid",
        );
        previous = hash;
      }
      return {
        events: events.length,
        valid: true,
        last_digest: previous,
        limitation:
          "Hash chain does not protect against database administrator rewrite.",
      };
    }
    if (r.operation === "accounting.reporting.drilldown") {
      exact(a, ["journal_id"]);
      const j = (await c.tx.query(
        "SELECT * FROM accounting.journals WHERE tenant_id=$1 AND company_id=$2 AND id=$3 AND state='POSTED'",
        [...c.scope, a.journal_id],
      )).rows[0];
      check(j, "journal_unavailable");
      await this.evidence(c, j.evidence);
      return {
        journal: j,
        lines: (await c.tx.query(
          "SELECT * FROM accounting.lines WHERE tenant_id=$1 AND company_id=$2 AND journal_id=$3 ORDER BY ordinal",
          [...c.scope, a.journal_id],
        )).rows,
      };
    }
    if (r.operation === "accounting.workspace.get") {
      exact(a, []);
      const docs = (await c.tx.query(
        "SELECT * FROM accounting.documents WHERE tenant_id=$1 AND company_id=$2 ORDER BY issued,number",
        c.scope,
      )).rows;
      for (const d of docs) {
        d.remaining = d.void_journal_id ? "0.00" : decimal(
          BigInt(d.total) - await this.paid(c, d.id) -
            await this.credited(c, d.id),
          c.book.precision,
        );
        d.total = decimal(BigInt(d.total), c.book.precision);
        delete d.evidence;
      }
      return {
        book: c.book,
        documents: docs,
        credits: (await c.tx.query(
          "SELECT p.id,p.document_id,p.number,p.journal_id,p.amount::text,p.reason,j.effective_date,r.journal_id AS reversal_journal_id,rj.effective_date AS reversal_date FROM accounting.credits p JOIN accounting.journals j ON j.tenant_id=p.tenant_id AND j.company_id=p.company_id AND j.id=p.journal_id LEFT JOIN accounting.credit_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.credit_id=p.id LEFT JOIN accounting.journals rj ON rj.tenant_id=r.tenant_id AND rj.company_id=r.company_id AND rj.id=r.journal_id WHERE p.tenant_id=$1 AND p.company_id=$2 ORDER BY j.effective_date,p.id",
          c.scope,
        )).rows,
        payments: (await c.tx.query(
          "SELECT p.id,p.document_id,p.journal_id,p.amount::text,j.effective_date,r.journal_id AS reversal_journal_id,rj.effective_date AS reversal_date FROM accounting.allocations p JOIN accounting.journals j ON j.tenant_id=p.tenant_id AND j.company_id=p.company_id AND j.id=p.journal_id LEFT JOIN accounting.allocation_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.allocation_id=p.id LEFT JOIN accounting.journals rj ON rj.tenant_id=r.tenant_id AND rj.company_id=r.company_id AND rj.id=r.journal_id WHERE p.tenant_id=$1 AND p.company_id=$2 ORDER BY j.effective_date,p.id",
          c.scope,
        )).rows,
        accounts: (await c.tx.query(
          "SELECT * FROM accounting.accounts WHERE tenant_id=$1 AND company_id=$2 ORDER BY id",
          c.scope,
        )).rows,
        statements: (await c.tx.query(
          "SELECT id,bank_account,effective_date,amount,reference FROM accounting.statements WHERE tenant_id=$1 AND company_id=$2 ORDER BY effective_date",
          c.scope,
        )).rows,
        matches: await this.activeMatches(c),
        journals: (await c.tx.query(
          "SELECT id,narration,effective_date,reversal_of FROM accounting.journals WHERE tenant_id=$1 AND company_id=$2 AND state='POSTED' ORDER BY created_at",
          c.scope,
        )).rows,
      };
    }
    if (r.operation === "accounting.intelligence.matches.propose") {
      exact(a, []);
      const matches = await this.activeMatches(c);
      const statements = (await c.tx.query(
        "SELECT * FROM accounting.statements WHERE tenant_id=$1 AND company_id=$2",
        c.scope,
      )).rows;
      const lines = (await c.tx.query(
        "SELECT l.*,j.effective_date,j.currency FROM accounting.lines l JOIN accounting.journals j ON j.tenant_id=l.tenant_id AND j.company_id=l.company_id AND j.id=l.journal_id WHERE l.tenant_id=$1 AND l.company_id=$2 AND j.state='POSTED'",
        c.scope,
      )).rows;
      const suggestions = [];
      for (const s of statements) {
        for (const l of lines) {
          if (
            l.account_id === s.bank_account && l.currency === c.book.currency &&
            l.amount === s.amount &&
            l.effective_date.getTime() === s.effective_date.getTime() &&
            !matches.some((m) =>
              m.statement_id === s.id ||
              (m.journal_id === l.journal_id && m.ordinal === l.ordinal)
            )
          ) {
            suggestions.push({
              state: "SUGGESTION",
              rule: "exact_account_date_amount_v1",
              statement_id: s.id,
              journal_id: l.journal_id,
              ordinal: l.ordinal,
              amount: decimal(BigInt(s.amount), c.book.precision),
              approval_required: true,
            });
          }
        }
      }
      return {
        suggestions,
        ledger_mutated: false,
        model_used: false,
        limitation:
          "Exact matching only; duplicate candidates require reviewer choice.",
      };
    }
    exact(a, ["report", "from", "through", "basis"], [
      "report",
      "through",
      "basis",
    ]);
    date(a.through);
    if (a.from) {
      date(a.from);
      check(a.from <= a.through, "report_range");
    }
    check(["accrual", "cash"].includes(a.basis), "invalid_report_basis");
    check(
      a.basis !== "cash" ||
        ["trial_balance", "profit_and_loss", "balance_sheet", "general_ledger"]
          .includes(a.report),
      "report_requires_accrual",
    );
    const supported = [
      "trial_balance",
      "profit_and_loss",
      "balance_sheet",
      "general_ledger",
      "aged_receivables",
      "aged_payables",
      "bank_reconciliation",
    ];
    check(supported.includes(a.report), "report_not_implemented");
    let entries = (await c.tx.query(
      "SELECT l.journal_id,l.ordinal,l.account_id,l.base_amount::text,j.effective_date,j.source,j.cash_basis,a.name,a.kind,a.control FROM accounting.lines l JOIN accounting.journals j ON j.tenant_id=l.tenant_id AND j.company_id=l.company_id AND j.id=l.journal_id JOIN accounting.accounts a ON a.tenant_id=l.tenant_id AND a.company_id=l.company_id AND a.id=l.account_id WHERE l.tenant_id=$1 AND l.company_id=$2 AND j.state='POSTED' AND j.effective_date<=$3 ORDER BY j.effective_date,l.journal_id,l.ordinal",
      [...c.scope, a.through],
    )).rows;
    if (a.basis === "cash") entries = await this.cashEntries(c, entries);
    const meta = {
      company_id: c.scope[1],
      tenant_id: c.scope[0],
      report: a.report,
      from: a.from ?? null,
      through: a.through,
      basis: a.basis,
      ...(a.basis === "cash"
        ? {
          cash_policy:
            "Payment component snapshots and their dated reversals; manual journals use the reviewed cash_basis flag (defaults to bank-containing journals). Derived management view, not a GST/BAS determination.",
          ledger_mutated: false,
        }
        : {}),
      currency: c.book.currency,
      precision: c.book.precision,
      revision: String(c.book.revision),
      calculated_at: this.boundary.now(),
      limitation: "Local synthetic books; no provider verification.",
    };
    if (a.report.startsWith("aged_")) {
      const docs = (await c.tx.query(
        "SELECT * FROM accounting.documents WHERE tenant_id=$1 AND company_id=$2 AND kind=$3 AND journal_id IS NOT NULL AND issued<=$4 AND (void_journal_id IS NULL OR EXISTS(SELECT 1 FROM accounting.journals v WHERE v.tenant_id=documents.tenant_id AND v.company_id=documents.company_id AND v.id=documents.void_journal_id AND v.effective_date>$4))",
        [
          ...c.scope,
          a.report === "aged_receivables" ? "invoice" : "bill",
          a.through,
        ],
      )).rows;
      const rows = [];
      for (const d of docs) {
        const paid = BigInt(
          (await c.tx.query(
            "SELECT coalesce(sum(a.amount),0)::text AS total FROM accounting.allocations a JOIN accounting.journals j ON j.tenant_id=a.tenant_id AND j.company_id=a.company_id AND j.id=a.journal_id LEFT JOIN accounting.allocation_reversals rv ON rv.tenant_id=a.tenant_id AND rv.company_id=a.company_id AND rv.allocation_id=a.id LEFT JOIN accounting.journals rj ON rj.tenant_id=rv.tenant_id AND rj.company_id=rv.company_id AND rj.id=rv.journal_id WHERE a.tenant_id=$1 AND a.company_id=$2 AND a.document_id=$3 AND j.effective_date<=$4 AND (rj.id IS NULL OR rj.effective_date>$4)",
            [...c.scope, d.id, a.through],
          )).rows[0].total,
        );
        const remaining = BigInt(d.total) - paid -
          await this.credited(c, d.id, a.through);
        const days = Math.floor(
          (Date.parse(a.through) - d.due.getTime()) / 86400000,
        );
        rows.push({
          document_id: d.id,
          contact: d.contact,
          number: d.number,
          due: d.due,
          amount: decimal(remaining, c.book.precision),
          bucket: days <= 0
            ? "current"
            : days <= 30
            ? "1-30"
            : days <= 60
            ? "31-60"
            : days <= 90
            ? "61-90"
            : "90+",
          journal_id: d.journal_id,
        });
      }
      return { ...meta, rows };
    }
    if (a.report === "bank_reconciliation") {
      const statements = (await c.tx.query(
        "SELECT * FROM accounting.statements WHERE tenant_id=$1 AND company_id=$2 AND effective_date<=$3",
        [...c.scope, a.through],
      )).rows;
      const matches = await this.activeMatches(c),
        accounts = (await c.tx.query(
          "SELECT id FROM accounting.accounts WHERE tenant_id=$1 AND company_id=$2 AND control='bank'",
          c.scope,
        )).rows;
      return {
        ...meta,
        rows: accounts.map((acc) => {
          const book = entries.filter((e) => e.account_id === acc.id).reduce(
              (s, e) => s + BigInt(e.base_amount),
              0n,
            ),
            statement = statements.filter((s) => s.bank_account === acc.id)
              .reduce((n, s) => n + BigInt(s.amount), 0n);
          return {
            account_id: acc.id,
            book: decimal(book, c.book.precision),
            statement: decimal(statement, c.book.precision),
            difference: decimal(statement - book, c.book.precision),
            unmatched_statement_ids: statements.filter((s) =>
              s.bank_account === acc.id &&
              matches.filter((m) =>
                  m.statement_id === s.id &&
                  entries.some((e) =>
                    e.journal_id === m.journal_id && e.ordinal === m.ordinal
                  )
                ).reduce((n, m) => n + BigInt(m.amount), 0n) !==
                BigInt(s.amount)
            ).map((s) => s.id),
          };
        }),
      };
    }
    const filtered = entries.filter((e) =>
      !a.from || a.report === "balance_sheet" ||
      e.effective_date.toISOString().slice(0, 10) >= a.from
    );
    if (a.report === "general_ledger") {
      return {
        ...meta,
        rows: filtered.map((e) => ({
          ...e,
          amount: decimal(BigInt(e.base_amount), c.book.precision),
        })),
      };
    }
    const grouped = new Map<string, Row>();
    for (const e of filtered) {
      if (!grouped.has(e.account_id)) {
        grouped.set(e.account_id, {
          account_id: e.account_id,
          name: e.name,
          kind: e.kind,
          amount: 0n,
          contributors: [],
        });
      }
      const g = grouped.get(e.account_id)!;
      g.amount += BigInt(e.base_amount);
      g.contributors.push({
        journal_id: e.journal_id,
        ordinal: e.ordinal,
        amount: decimal(BigInt(e.base_amount), c.book.precision),
        ...(e.derived
          ? {
            derived: true,
            allocation_id: e.allocation_id,
            source_journal_id: e.source_journal_id,
            source_ordinal: e.source_ordinal,
          }
          : {}),
      });
    }
    const all = [...grouped.values()];
    const profit = -all.filter((g) => ["revenue", "expense"].includes(g.kind))
      .reduce((s, g) => s + g.amount, 0n);
    const rows = all.filter((g) =>
      a.report === "profit_and_loss"
        ? ["revenue", "expense"].includes(g.kind)
        : a.report === "balance_sheet"
        ? !["revenue", "expense"].includes(g.kind)
        : true
    ).map((g) => ({ ...g, amount: decimal(g.amount, c.book.precision) }));
    return {
      ...meta,
      rows,
      profit: decimal(profit, c.book.precision),
      debit_total: decimal(
        all.reduce((s, g) => s + (g.amount > 0n ? g.amount : 0n), 0n),
        c.book.precision,
      ),
      credit_total: decimal(
        all.reduce(
          (s, g) => s + (BigInt(g.amount) < 0n ? -BigInt(g.amount) : 0n),
          0n,
        ),
        c.book.precision,
      ),
    };
  }
}
type Context = { tx: Sql; actor: Actor; scope: string[]; book: Row };
