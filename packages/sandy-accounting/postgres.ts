import pg, { type Pool, type PoolClient } from "pg";
import type { Database, Row, Sql } from "./service.ts";
import { date } from "./money.ts";

// SQL DATE is a civil accounting date, not local midnight in the host timezone.
// Set parsers per query, without changing another product's global pg settings.
const accountingTypes = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    return oid === 1082 && format !== "binary"
      ? (value: string) => new Date(date(value) + "T00:00:00.000Z")
      : pg.types.getTypeParser(oid, format);
  },
};

/** One physical connection per transaction; credentials/pool are supplied by the owner. */
export class PostgresDatabase implements Database {
  pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }
  async query<T extends Row = Row>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    return this.pool.query<T>({
      text: sql,
      values: params,
      types: accountingTypes,
    });
  }
  async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    let commitAttempted = false, releaseError: Error | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='30s'");
      await client.query("SET LOCAL lock_timeout='15s'");
      await client.query("SET LOCAL DateStyle='ISO, YMD'");
      const tx: Sql = {
        query: <R extends Row = Row>(sql: string, params: unknown[] = []) =>
          client.query<R>({
            text: sql,
            values: params,
            types: accountingTypes,
          }),
      };
      const result = await fn(tx);
      commitAttempted = true;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        releaseError = new Error("database_connection_unusable");
      }
      if (commitAttempted) throw Error("commit_outcome_unknown_retry_same_key");
      throw error;
    } finally {
      client.release(releaseError);
    }
  }
}
