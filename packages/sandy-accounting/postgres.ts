import type { Pool, PoolClient } from "pg";
import type { Database, Row, Sql } from "./service.ts";

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
    return this.pool.query<T>(sql, params);
  }
  async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    let commitAttempted = false, releaseError: Error | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='30s'");
      await client.query("SET LOCAL lock_timeout='15s'");
      const result = await fn(client);
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
