import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import {
  Accounting,
  type Actor,
  type Boundary,
  type Database,
  type Evidence,
  operations,
  type Request,
  type Row,
} from "./service.ts";
import { contentHash, digest } from "./money.ts";

export const SYNTHETIC_SOURCE =
  "Synthetic accountant worksheet: opening cash 1000; sales 100; supplier cost 30. Not a customer document or independent professional acceptance.";
export async function fixture(dataDir?: string) {
  const db = new PGlite(dataDir);
  await db.waitReady;
  const schema = await readFile(
    new URL("./schema.sql", import.meta.url),
    "utf8",
  );
  const schemaDigest = await digest(schema);
  if (
    !(await db.query("SELECT 1 FROM pg_namespace WHERE nspname='accounting'"))
      .rows.length
  ) {
    await db.exec(schema);
    await db.exec(
      "CREATE TABLE accounting.fixture_schema_metadata (digest text NOT NULL)",
    );
    await db.query(
      "INSERT INTO accounting.fixture_schema_metadata VALUES($1)",
      [schemaDigest],
    );
    for (const company of ["synthetic-company", "other-company"]) {
      await db.query(
        "INSERT INTO accounting.books VALUES('synthetic-tenant',$1,$2,'AUD',2,NULL,0)",
        [
          company,
          company === "synthetic-company"
            ? "Sandy Demo • synthetic books"
            : "Other synthetic company",
        ],
      );
      for (
        const [aid, name, kind, control] of [
          ["bank", "Demo bank", "asset", "bank"],
          ["ar", "Accounts receivable", "asset", "ar"],
          ["ap", "Accounts payable", "liability", "ap"],
          ["capital", "Opening capital", "equity", null],
          ["sales", "Sales", "revenue", null],
          ["expense", "Operating expenses", "expense", null],
          ["tax", "Tax control", "liability", "tax"],
        ]
      ) {
        await db.query(
          "INSERT INTO accounting.accounts VALUES($1,$2,$3,$4,$5,$6,true)",
          ["synthetic-tenant", company, aid, name, kind, control],
        );
      }
    }
  } else {
    const metadata = await db.query<{ digest: string }>(
      "SELECT digest FROM accounting.fixture_schema_metadata",
    ).catch(() => ({ rows: [] }));
    if (metadata.rows[0]?.digest !== schemaDigest) {
      await db.close();
      throw Error("fixture_schema_changed_use_new_directory");
    }
  }
  const source: Evidence = {
    file_id: "synthetic-worksheet",
    revision: "1",
    sha256: await contentHash(SYNTHETIC_SOURCE),
    locator: "rows 1–3",
  };
  let revoked = false, evidenceRevoked = false;
  const boundary: Boundary = {
    now: () => new Date("2026-10-24T02:00:00.000Z").toISOString(),
    async authorize(session: string, r: Request) {
      if (revoked || session !== "local-synthetic-session") {
        throw Error("forbidden");
      }
      // Deliberately impossible to use as a production identity adapter.
      return {
        actor_id: "synthetic-actor",
        tenant_id: "synthetic-tenant",
        company_ids: ["synthetic-company"],
        operations: Object.keys(operations),
        policy_ref: "synthetic-fixture-policy-only",
        expires_at: "2026-10-25T00:00:00.000Z",
      };
    },
    async evidence(actor: Actor, company: string, e: Evidence) {
      return !evidenceRevoked && actor.tenant_id === "synthetic-tenant" &&
        company === "synthetic-company" && e.file_id === source.file_id &&
        e.revision === source.revision && e.sha256 === source.sha256 &&
        e.locator === source.locator;
    },
  };
  const app = new Accounting(db as unknown as Database, boundary);
  const run = (
    operation: string,
    args: Row = {},
    key: string = crypto.randomUUID(),
    company = "synthetic-company",
  ) =>
    app.execute("local-synthetic-session", {
      operation,
      arguments: args,
      contract_version: "1",
      company_id: company,
      idempotency_key: key,
    });
  const journal = (amount = "1000.00", effective_date = "2026-10-01") => ({
    effective_date,
    narration: "Synthetic opening balance",
    currency: "AUD",
    precision: 2,
    evidence: [source],
    lines: [{ account_id: "bank", amount }, {
      account_id: "capital",
      amount: "-" + amount,
    }],
  });
  const document = (kind = "invoice", net = "100.00") => ({
    contact: kind === "invoice" ? "Synthetic customer" : "Synthetic supplier",
    number: kind === "invoice" ? "DEMO-INV-1" : "DEMO-BILL-1",
    issued: "2026-10-02",
    due: "2026-10-20",
    currency: "AUD",
    control_account: kind === "invoice" ? "ar" : "ap",
    evidence: [source],
    lines: [{
      description: "Synthetic service",
      account_id: kind === "invoice" ? "sales" : "expense",
      net,
      tax: "0.00",
      tax_account: null,
      tax_rule_ref: null,
    }],
  });
  return {
    db,
    app,
    boundary,
    run,
    source,
    journal,
    document,
    revoke: () => {
      revoked = true;
    },
    revokeEvidence: () => {
      evidenceRevoked = true;
    },
  };
}
