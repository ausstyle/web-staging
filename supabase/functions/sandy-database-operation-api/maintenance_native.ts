/** Native maintenance never uses Management's transaction wrapper. There is no
 * HTTP/SQL relay, alternate address, certificate bypass or caller-routed host.
 * This connector is inert until the fixed-project URL is configured and the
 * runtime has ordinary authorized network access to that destination.
 */
import { databaseProject } from "./contracts.ts";
export type NativeQueryResult = {
  rows: Record<string, unknown>[];
  command?: string;
};
export type NativeMaintenanceConnection = {
  query(
    sql: string,
    parameters?: unknown[],
    simple?: boolean,
  ): Promise<NativeQueryResult>;
  close(): Promise<void>;
};
export class MaintenanceConfigurationError extends Error {
  constructor() {
    super("database_native_maintenance_configuration_required");
  }
}
export function validateMaintenanceUrl(value: unknown): string {
  try {
    if (typeof value !== "string" || !value || value.length > 4096) {
      throw Error();
    }
    const url = new URL(value);
    if (
      !new Set(["postgres:", "postgresql:"]).has(url.protocol) ||
      url.hostname !== `db.${databaseProject}.supabase.co` ||
      (url.port && url.port !== "5432") || url.pathname !== "/postgres" ||
      decodeURIComponent(url.username) !== "postgres" || !url.password ||
      url.hash ||
      [...url.searchParams.entries()].some(([key, mode]) =>
        key !== "sslmode" || mode !== "verify-full"
      ) ||
      url.searchParams.getAll("sslmode").length > 1
    ) throw Error();
    return value;
  } catch {
    throw new MaintenanceConfigurationError();
  }
}
export async function connectNativeMaintenance(
  value: string,
): Promise<NativeMaintenanceConnection> {
  const connectionString = validateMaintenanceUrl(value);
  // Exact upstream version; TLS hostname and certificate validation stay on.
  const { default: postgres } = await import("npm:postgres@3.4.5");
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    fetch_types: false,
    connect_timeout: 10,
    idle_timeout: 0,
    max_lifetime: 60,
    ssl: {
      rejectUnauthorized: true,
      servername: `db.${databaseProject}.supabase.co`,
    },
    connection: {
      application_name: "sandy-api-maintenance-v2",
      statement_timeout: 15000,
      lock_timeout: 3000,
      search_path: "pg_catalog",
      standard_conforming_strings: "on",
    },
    onnotice: () => {},
  });
  try {
    const session = await sql.reserve();
    return {
      async query(statement, parameters = [], simple = false) {
        const pending = session.unsafe(statement, parameters as never[]);
        const rows = await (simple ? pending.simple() : pending);
        return {
          rows: Array.from(rows) as Record<string, unknown>[],
          command: rows.command,
        };
      },
      async close() {
        session.release();
        await sql.end({ timeout: 5 });
      },
    };
  } catch {
    await sql.end({ timeout: 5 }).catch(() => {});
    throw new Error("database_native_connection_unavailable");
  }
}
function milliseconds(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return 0;
  const match = /^(\d+)(ms|s|min)?$/.exec(String(value));
  return match
    ? Number(match[1]) * ({ ms: 1, s: 1000, min: 60000 }[match[2] ?? "ms"] ?? 0)
    : 0;
}
export async function verifyNativeMaintenanceSession(
  connection: NativeMaintenanceConnection,
): Promise<void> {
  const result = await connection.query(
    "SELECT current_database() AS database,current_user AS role,current_setting('statement_timeout') AS statement_timeout,current_setting('lock_timeout') AS lock_timeout,current_setting('transaction_read_only') AS read_only,current_setting('search_path') AS search_path",
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 || !row || row.database !== "postgres" ||
    row.role !== "postgres" ||
    row.read_only !== "off" || row.search_path !== "pg_catalog" ||
    milliseconds(row.statement_timeout) < 1 ||
    milliseconds(row.statement_timeout) > 15000 ||
    milliseconds(row.lock_timeout) < 1 || milliseconds(row.lock_timeout) > 3000
  ) {
    throw new Error("database_native_session_scope_or_deadline_invalid");
  }
}
