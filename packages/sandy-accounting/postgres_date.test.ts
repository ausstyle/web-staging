import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgresDatabase } from "./postgres.ts";

const connectionString = process.env.ACCOUNTING_TEST_PG_URL;
test(
  "PostgreSQL accounting dates are independent of process timezone and pool defaults",
  { skip: !connectionString },
  async () => {
    const url = new URL(connectionString!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/sandy_accounting_test");
    const priorTZ = process.env.TZ;
    const pool = new pg.Pool({ connectionString });
    try {
      const db = new PostgresDatabase(pool);
      for (
        const timezone of ["Australia/Sydney", "America/Los_Angeles", "UTC"]
      ) {
        process.env.TZ = timezone;
        for (const day of ["2026-01-01", "2026-10-04", "2024-02-29"]) {
          const sql =
            "SELECT $1::date AS day, 9007199254740993.27::numeric AS exact_amount";
          for (
            const row of [
              (await db.query(sql, [day])).rows[0],
              await db.transaction(async (tx) =>
                (await tx.query(sql, [day])).rows[0]
              ),
            ]
          ) {
            assert.equal(
              row.day.toISOString(),
              day + "T00:00:00.000Z",
              timezone,
            );
            assert.equal(row.exact_amount, "9007199254740993.27");
          }
        }
      }
    } finally {
      if (priorTZ === undefined) delete process.env.TZ;
      else process.env.TZ = priorTZ;
      await pool.end();
    }
  },
);
