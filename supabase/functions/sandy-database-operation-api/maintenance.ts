import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  argumentDigest,
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import { databaseProject, databaseScope } from "./contracts.ts";
import type {
  DatabaseContext,
  DatabaseFinish,
  DatabaseGrant,
  DatabasePolicyResult,
} from "./index.ts";
import {
  compileSql,
  DatabaseCompileError,
  identifier,
  parsedStatement,
} from "./sql.ts";
import {
  type MaintenanceContract,
  maintenanceOperations,
} from "./maintenance_contracts.ts";
import {
  connectNativeMaintenance,
  type NativeMaintenanceConnection,
  validateMaintenanceUrl,
  verifyNativeMaintenanceSession,
} from "./maintenance_native.ts";
import { ConsumerCredentialError } from "../_shared/sandy_credential_consumer.ts";
export { maintenanceOperations } from "./maintenance_contracts.ts";
type Row = Record<string, any>;
type ConsumerExecution = {
  actorId: string;
  admissionId: string;
  operation: string;
};
export type MaintenanceDependencies = {
  service: string;
  management?: string;
  maintenanceUrl?: string;
  fetch?: typeof fetch;
  connect?: (url: string) => Promise<NativeMaintenanceConnection>;
  withManagementCredential?: <T>(
    execution: ConsumerExecution,
    use: (token: string) => Promise<T>,
  ) => Promise<T>;
  authorizeContext(
    context: DatabaseContext,
    contract: MaintenanceContract,
  ): Promise<DatabasePolicyResult>;
  consumeGrant(grant: DatabaseGrant): Promise<DatabasePolicyResult>;
  finishExecution(receipt: DatabaseFinish): Promise<DatabasePolicyResult>;
  now?: () => number;
};
const object = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ajv = new Ajv({
  strict: true,
  strictTypes: false,
  strictRequired: false,
  allowUnionTypes: true,
  validateFormats: true,
});
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const validators = new Map(
  Object.values(maintenanceOperations).map((op) => [op.operation, {
    input: ajv.compile(op.input_schema),
    output: ajv.compile(op.output_schema),
  }]),
);
const response = (status: number, body: Row) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const refused = (status: number, error: string, extra: Row = {}) =>
  response(status, { ok: false, error, executed: false, ...extra });
const compileFailure = (code: string): never => {
  throw new DatabaseCompileError(code);
};
function validCronField(
  source: string,
  minimum: number,
  maximum: number,
): boolean {
  return source.split(",").every((part) => {
    const split = part.split("/");
    if (
      split.length > 2 ||
      split[1] !== undefined &&
        (!/^\d{1,2}$/.test(split[1]) || Number(split[1]) < 1 ||
          Number(split[1]) > maximum + 1)
    ) return false;
    if (split[0] === "*") return true;
    const range = split[0].split("-");
    return range.length <= 2 && range.every((v) =>
      /^\d{1,2}$/.test(v) && Number(v) >= minimum && Number(v) <= maximum
    ) &&
      (range.length === 1 || Number(range[0]) <= Number(range[1]));
  });
}
export function validateGuardedSchedule(source: unknown): boolean {
  if (typeof source !== "string" || source.length > 100) return false;
  const parts = source.split(" ");
  return parts.length === 5 &&
    [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]].every(([min, max], i) =>
      validCronField(parts[i], min, max)
    );
}
function mutationCount(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + mutationCount(item), 0);
  }
  if (!object(value)) return 0;
  return Object.entries(value).reduce(
    (sum, [key, child]) =>
      sum +
      (["InsertStmt", "UpdateStmt", "DeleteStmt", "MergeStmt"].includes(key)
        ? 1
        : 0) +
      mutationCount(child),
    0,
  );
}
export async function compileGuardedSchedule(args: Row, now = Date.now()) {
  if (!validateGuardedSchedule(args.schedule)) {
    return compileFailure("guarded_schedule_invalid");
  }
  const expiry = Date.parse(args.standing.expires_at);
  if (
    !Number.isFinite(expiry) || expiry <= now + 60000 || expiry > now + 86400000
  ) return compileFailure("guarded_schedule_lifetime_invalid");
  const tree = await parsedStatement(args.command.sql, "definition");
  const mode = Object.hasOwn(tree, "SelectStmt") ? "query" : "dml";
  if (mutationCount(tree) !== (mode === "dml" ? 1 : 0)) {
    return compileFailure("guarded_schedule_single_effect_required");
  }
  const statement = await compileSql(
    args.command.sql,
    args.command.parameters ?? [],
    mode,
  );
  const verifications = await Promise.all(
    args.command.verifications.map(async (entry: Row) => ({
      ...(await compileSql(entry.sql, entry.parameters ?? [], "query")),
      expected_rows: entry.expected_rows,
    })),
  );
  const base = { statement, verifications };
  return {
    plan: {
      ...base,
      canonical: canonicalJson(base),
      sha256: await argumentDigest(base),
    },
    standing: {
      ...args.standing,
      max_affected_rows: args.command.max_affected_rows,
    },
  };
}
export function nativeVacuumSql(args: Row): string {
  const table = identifier(args.table);
  return `VACUUM (ANALYZE ${args.analyze === true ? "true" : "false"}, FREEZE ${
    args.freeze === true ? "true" : "false"
  }, TRUNCATE false, SKIP_LOCKED true) "public".${table}`;
}
const resultKeys = new Set([
  "command_id",
  "request_id",
  "operation",
  "state",
  "target_table",
  "table_oid",
  "provider_protocol",
  "provider_command_tag",
  "command_completed",
  "verification_passed",
  "readback",
  "reconciliation_required",
  "automatic_retry",
  "created_at",
  "started_at",
  "finished_at",
  "schedule_id",
  "cron_job_id",
  "revision",
  "active",
  "runs",
  "attempts",
  "expires_at",
  "command_sha256",
  "standing_authorization",
  "last_outcome",
  "max_runs",
  "min_interval_seconds",
  "max_affected_rows",
  "pending_readback",
  "minimum_interval_seconds",
  "project_ref",
  "request_state",
  "transactional",
  "independently_observed",
]);
const sensitiveKey =
  /password|secret|credential|token|^authorization$|^cookie$|connection.?string|lease|backend_pid|sql|parameters/i;
function sensitive(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (Array.isArray(value)) {
    return value.some((item) => sensitive(item, depth + 1));
  }
  return object(value) &&
    Object.entries(value).some(([key, child]) =>
      sensitiveKey.test(key) || sensitive(child, depth + 1)
    );
}
function safeResult(value: unknown): Row {
  if (!object(value) || sensitive(value)) {
    throw Error("maintenance_result_invalid");
  }
  const clean = Object.fromEntries(
    Object.entries(value).filter(([key]) => resultKeys.has(key)),
  );
  if (!Object.keys(clean).length || JSON.stringify(clean).length > 16000) {
    throw Error("maintenance_result_invalid");
  }
  return clean;
}
function scalarResult(value: unknown): Row {
  if (
    !Array.isArray(value) || value.length !== 1 || !object(value[0]) ||
    !object(value[0].result)
  ) throw Error("maintenance_response_invalid");
  return value[0].result;
}
type RpcName =
  | "sandy_api_maintenance_reserve"
  | "sandy_api_maintenance_start"
  | "sandy_api_maintenance_finish"
  | "sandy_api_maintenance_mark_unknown"
  | "sandy_api_maintenance_finish_native"
  | "sandy_api_maintenance_receipt"
  | "sandy_api_maintenance_cron_upsert";
async function nativeRpc(
  connection: NativeMaintenanceConnection,
  name: RpcName,
  parameters: unknown[],
): Promise<Row> {
  const values = parameters.map((_, index) =>
    `$${index + 1}${
      name === "sandy_api_maintenance_reserve" ||
        name === "sandy_api_maintenance_receipt" ||
        name === "sandy_api_maintenance_cron_upsert"
        ? "::jsonb"
        : ""
    }`
  ).join(",");
  const result = await connection.query(
    `SELECT public.${name}(${values}) AS result`,
    parameters,
  );
  return scalarResult(result.rows);
}
async function boundedJson(reply: Response): Promise<unknown> {
  if (!reply.body) throw Error("maintenance_provider_response_invalid");
  const reader = reply.body.getReader();
  let count = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      count += next.value.length;
      if (count > 65536) {
        await reader.cancel();
        throw Error("maintenance_provider_response_too_large");
      }
      chunks.push(next.value);
    }
    const data = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } finally {
    reader.releaseLock();
  }
}
async function managementRpc(
  deps: MaintenanceDependencies,
  context: DatabaseContext,
  name: RpcName,
  payload: Row,
) {
  const raw = JSON.stringify(payload);
  const hex = Array.from(
    new TextEncoder().encode(raw),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const use = async (token: string) => {
    if (!token) throw Error("maintenance_provider_credential_unavailable");
    const query =
      `SET LOCAL statement_timeout='15000'; SET LOCAL lock_timeout='3000'; SELECT public.${name}(pg_catalog.convert_from(pg_catalog.decode('${hex}','hex'),'UTF8')::jsonb) AS result`;
    const reply = await (deps.fetch ?? fetch)(
      `https://api.supabase.com/v1/projects/${databaseProject}/database/query`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          read_only: name === "sandy_api_maintenance_receipt",
        }),
        signal: AbortSignal.timeout(25000),
      },
    );
    const body = await boundedJson(reply);
    if (!reply.ok) throw Error("maintenance_provider_request_failed");
    return { status: reply.status, body: scalarResult(body) };
  };
  return deps.withManagementCredential
    ? await deps.withManagementCredential({
      actorId: context.actor_id,
      admissionId: context.admission_id!,
      operation: payload.operation,
    }, use)
    : await use(deps.management ?? "");
}
function classifiedRefusal(value: Row, operation: string): Response | null {
  if (value.ok === true) return null;
  const status =
    [400, 401, 403, 404, 409, 424, 429, 503].includes(value.http_status)
      ? value.http_status
      : 503;
  const error = typeof value.error === "string" &&
      /^[a-z][a-z0-9_]{2,100}$/.test(value.error)
    ? value.error
    : "maintenance_private_boundary_refused";
  return refused(status, error, { operation });
}
export async function executeMaintenanceOperation(
  deps: MaintenanceDependencies,
  context: DatabaseContext,
  operation: string,
  args: unknown,
): Promise<Response> {
  const op = maintenanceOperations[operation];
  if (!op || !object(args) || validators.get(operation)!.input(args) !== true) {
    return refused(400, "invalid_maintenance_arguments");
  }
  if (
    !UUID.test(context.actor_id) || !UUID.test(context.request_id) ||
    !UUID.test(context.grant_id) ||
    context.tenant_id !== null || context.credential_id != null ||
    context.admission_id !== undefined && !UUID.test(context.admission_id)
  ) return refused(400, "normal_owner_execution_context_required");
  let compiled: Awaited<ReturnType<typeof compileGuardedSchedule>> | undefined;
  try {
    if (op.kind === "vacuum_native") {
      validateMaintenanceUrl(deps.maintenanceUrl);
    } else if (!deps.management && !deps.withManagementCredential) {
      return refused(424, "provider_credential_unavailable");
    }
    if (op.kind.startsWith("cron_guarded_")) {
      compiled = await compileGuardedSchedule(args, (deps.now ?? Date.now)());
    }
  } catch (error) {
    return refused(
      error instanceof DatabaseCompileError ? 400 : 424,
      error instanceof DatabaseCompileError
        ? error.message
        : "database_native_maintenance_configuration_required",
    );
  }
  const permission: DatabasePolicyResult = await deps.authorizeContext(
    context,
    op,
  ).catch(() => ({
    allowed: false,
    error: "execution_policy_unavailable",
    http_status: 503,
  }));
  if (!permission.allowed || permission.reused) {
    return refused(
      permission.http_status ?? 403,
      permission.error ?? "verified_maintenance_execution_contract_required",
    );
  }
  const proof = {
    ...context,
    operation,
    input_sha256: await argumentDigest(args),
    contract_sha256: op.contract_sha256,
    scope_sha256: await argumentDigest(databaseScope),
  };
  const grant: DatabasePolicyResult = await deps.consumeGrant(proof).catch(
    () => ({
      allowed: false,
      error: "execution_grant_state_unknown",
      http_status: 503,
    }),
  );
  if (
    !grant.allowed || grant.reused || !grant.admission_id ||
    !UUID.test(grant.admission_id) ||
    context.admission_id && grant.admission_id !== context.admission_id
  ) {
    return refused(
      grant.http_status ?? 409,
      grant.error ?? "execution_grant_refused",
    );
  }
  const admitted = { ...context, admission_id: grant.admission_id };
  const payload = {
    ...proof,
    admission_id: grant.admission_id,
    arguments: args,
    arguments_canonical: canonicalJson(args),
    ...(op.kind === "vacuum_native" ? { target_table: args.table } : {}),
    ...compiled,
  };
  const finish = async (
    outcome: DatabaseFinish["outcome"],
    status: number | null,
    result: Row,
  ) => {
    try {
      return (await deps.finishExecution({
        admission_id: grant.admission_id!,
        outcome,
        provider_http_status: status,
        provider_request_id: null,
        result_sha256: await argumentDigest(result),
      })).allowed;
    } catch {
      return false;
    }
  };
  const envelope = (
    result: Row,
    protocol: "postgres" | "management_https",
    status: number | null,
  ) => ({
    ok: true,
    operation,
    contract_version: "2.0.0",
    provider: "supabase",
    project_ref: databaseProject,
    provider_protocol: protocol,
    provider_http_status: status,
    admission_id: grant.admission_id!,
    request_state: op.is_mutation ? "accepted" : "observed",
    executed: true,
    result,
  });
  if (op.kind !== "vacuum_native") {
    try {
      const provider = await managementRpc(
        deps,
        admitted,
        op.kind === "maintenance_receipt"
          ? "sandy_api_maintenance_receipt"
          : "sandy_api_maintenance_cron_upsert",
        payload,
      );
      const refusal = classifiedRefusal(provider.body, operation);
      if (refusal) {
        await finish("failed", provider.status, {
          error: "maintenance_private_boundary_refused",
        });
        return refusal;
      }
      if (op.kind === "maintenance_receipt" && provider.body.result === null) {
        await finish("failed", provider.status, {
          error: "maintenance_receipt_not_found",
        });
        return refused(404, "maintenance_receipt_not_found", { operation });
      }
      const result = safeResult(provider.body.result);
      const body = envelope(result, "management_https", provider.status);
      if (!validators.get(operation)!.output(body)) {
        throw Error("maintenance_result_contract_invalid");
      }
      if (
        !await finish(
          op.is_mutation ? "accepted" : "succeeded",
          provider.status,
          result,
        )
      ) {
        return response(503, {
          ...body,
          ok: false,
          error: "execution_receipt_state_unknown",
          reconciliation_required: true,
        });
      }
      return response(200, body);
    } catch (error) {
      if (
        error instanceof ConsumerCredentialError &&
        !error.requestMayHaveExecuted
      ) {
        await finish("failed", error.providerHttpStatus, { error: error.code });
        return refused(error.status, error.code, {
          operation,
          admission_id: grant.admission_id,
        });
      }
      await finish(op.is_mutation ? "unknown" : "failed", null, {
        error: "maintenance_provider_outcome_unknown",
      });
      return response(502, {
        ok: false,
        operation,
        admission_id: grant.admission_id,
        executed: op.is_mutation ? null : false,
        error: "maintenance_provider_outcome_unknown",
        reconciliation_required: op.is_mutation,
        automatic_retry: false,
      });
    }
  }
  let connection: NativeMaintenanceConnection | undefined;
  let command: Row | undefined;
  let attempted = false;
  try {
    connection = await (deps.connect ?? connectNativeMaintenance)(
      deps.maintenanceUrl!,
    );
    await verifyNativeMaintenanceSession(connection);
    command = await nativeRpc(connection, "sandy_api_maintenance_reserve", [
      JSON.stringify(payload),
    ]);
    const refusal = classifiedRefusal(command, operation);
    if (refusal) {
      await finish("failed", null, {
        error: "maintenance_reservation_refused",
      });
      return refusal;
    }
    if (
      !UUID.test(command.command_id) || !UUID.test(command.lease_token) ||
      command.reused === true
    ) throw Error("maintenance_reservation_invalid");
    const start = await nativeRpc(connection, "sandy_api_maintenance_start", [
      command.command_id,
      command.lease_token,
    ]);
    const startRefusal = classifiedRefusal(start, operation);
    if (startRefusal) {
      await finish("failed", null, { error: "maintenance_start_refused" });
      return startRefusal;
    }
    attempted = true;
    const completed = await connection.query(nativeVacuumSql(args), [], true);
    if (completed.command !== "VACUUM") {
      throw Error("maintenance_native_completion_unconfirmed");
    }
    const evidence = {
      provider_protocol: "postgres",
      provider_command_tag: completed.command,
      command_completed: true,
    };
    const finished = await nativeRpc(
      connection,
      "sandy_api_maintenance_finish",
      [
        command.command_id,
        command.lease_token,
        "accepted",
        JSON.stringify(evidence),
      ],
    );
    if (classifiedRefusal(finished, operation)) {
      throw Error("maintenance_command_receipt_invalid");
    }
    const stored = finished.result;
    const result = safeResult(stored);
    const recorded = await nativeRpc(
      connection,
      "sandy_api_maintenance_finish_native",
      [grant.admission_id, canonicalJson(stored)],
    );
    if (
      recorded.ok !== true || recorded.admission_id !== grant.admission_id ||
      recorded.state !== "accepted"
    ) throw Error("maintenance_native_receipt_unconfirmed");
    const body = envelope(result, "postgres", null);
    if (!validators.get(operation)!.output(body)) {
      throw Error("maintenance_result_contract_invalid");
    }
    return response(200, body);
  } catch {
    if (command && connection) {
      try {
        await nativeRpc(connection, "sandy_api_maintenance_mark_unknown", [
          grant.admission_id,
          "native_command_response_unavailable",
        ]);
      } catch {
        /* the durable started/reserved receipt still forbids replay */
      }
    }
    await finish(attempted ? "unknown" : "failed", null, {
      error: attempted
        ? "database_native_maintenance_outcome_unknown"
        : "database_native_maintenance_unavailable",
    });
    return response(attempted ? 502 : 424, {
      ok: false,
      operation,
      admission_id: grant.admission_id,
      error: attempted
        ? "database_native_maintenance_outcome_unknown"
        : "database_native_maintenance_unavailable",
      executed: attempted ? null : false,
      reconciliation_required: attempted,
      automatic_retry: false,
    });
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
}
export function createMaintenanceOperationHandler(
  deps: MaintenanceDependencies,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return refused(405, "method_not_allowed");
    if (
      !deps.service ||
      request.headers.get("authorization") !== `Bearer ${deps.service}` ||
      request.headers.has("x-sandy-api-key")
    ) return refused(403, "service_transport_required");
    let body: unknown;
    try {
      body = await requestJson(request, 65536);
    } catch (error) {
      return refused(
        error instanceof JsonRequestError ? error.status : 400,
        error instanceof JsonRequestError ? error.code : "invalid_request",
      );
    }
    if (
      !object(body) || Object.keys(body).some((key) =>
        ![
          "operation",
          "arguments",
          "actor_id",
          "tenant_id",
          "request_id",
          "grant_id",
          "admission_id",
          "credential_id",
        ].includes(key)
      ) || typeof body.operation !== "string"
    ) return refused(400, "invalid_request");
    return executeMaintenanceOperation(
      deps,
      body as DatabaseContext,
      body.operation,
      body.arguments,
    );
  };
}
