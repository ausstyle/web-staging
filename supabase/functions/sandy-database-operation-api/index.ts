/** Fixed-project database control. A service identity is transport, never a user
 * session. Every invocation independently checks the owner/registry and consumes
 * the canonical API's exact one-use approval grant before provider execution.
 */
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  argumentDigest,
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  type DatabaseContract,
  databaseHandler,
  databaseOperations,
  databaseProject,
} from "./contracts.ts";
import { databaseCapability, databaseExecutionScope } from "./gateway.ts";
export { databaseExecutionScope } from "./gateway.ts";
import { compileDatabasePlan, type DatabasePlan } from "./plan.ts";
import { DatabaseCompileError, publicRelation } from "./sql.ts";
import {
  executeMaintenanceOperation,
  type MaintenanceDependencies,
} from "./maintenance.ts";
import {
  isMaintenanceOperation,
  type MaintenanceContract,
  maintenanceOperations,
} from "./maintenance_contracts.ts";
import {
  ConsumerCredentialError,
  createCredentialConsumer,
} from "../_shared/sandy_credential_consumer.ts";
export { databaseOperations } from "./gateway.ts";
export { databaseProject } from "./contracts.ts";
type Row = Record<string, any>;
export type DatabaseContext = {
  actor_id: string;
  tenant_id: null;
  request_id: string;
  grant_id: string;
  admission_id?: string;
  credential_id?: null;
};
export type DatabaseGrant = DatabaseContext & {
  operation: string;
  input_sha256: string;
  contract_sha256: string;
  scope_sha256: string;
};
export type DatabasePolicyResult = {
  allowed: boolean;
  reused?: boolean;
  admission_id?: string;
  error?: string;
  http_status?: number;
};
export type DatabaseFinish = {
  admission_id: string;
  outcome: "succeeded" | "accepted" | "failed" | "unknown";
  provider_http_status: number | null;
  provider_request_id: string | null;
  result_sha256: string;
};
export type DatabaseDependencies = {
  service: string;
  management?: string;
  maintenanceUrl?: string;
  fetch?: typeof fetch;
  connect?: MaintenanceDependencies["connect"];
  withManagementCredential?:
    MaintenanceDependencies["withManagementCredential"];
  reviewedTriggerFunctions?: Record<string, string>;
  authorizeContext(
    context: DatabaseContext,
    contract: DatabaseContract | MaintenanceContract,
  ): Promise<DatabasePolicyResult>;
  consumeGrant(request: DatabaseGrant): Promise<DatabasePolicyResult>;
  finishExecution(request: DatabaseFinish): Promise<DatabasePolicyResult>;
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
  Object.values(databaseOperations).map(
    (op) => [op.operation, {
      input: ajv.compile(op.input_schema),
      output: ajv.compile(op.output_schema),
    }],
  ),
);
export function validateDatabaseContracts() {
  return new Set([...validators.keys(), ...Object.keys(maintenanceOperations)])
    .size;
}

const reply = (status: number, body: Row) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const refuse = (status: number, error: string, extra: Row = {}) =>
  reply(status, { ok: false, error, executed: false, ...extra });
const endpoint =
  `https://api.supabase.com/v1/projects/${databaseProject}/database/query`;
function payloadSql(
  fn:
    | "sandy_api_database_read"
    | "sandy_api_database_write"
    | "sandy_api_database_preflight",
  payload: Row,
): string {
  const source = JSON.stringify(payload);
  const hex = Array.from(
    new TextEncoder().encode(source),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const relations = [
    ...new Set(
      (fn === "sandy_api_database_read" ? payload.plan.statements ?? [] : [])
        .flatMap((statement: Row) => statement.passive_relations ?? [])
        .filter((ref: Row) => ref.schema === "public")
        .map((ref: Row) => publicRelation(ref.name)),
    ),
  ].sort();
  // Read functions are STABLE; lock their actual sources in this wrapper.
  // Writes lock each source inside their transaction after any earlier CREATE.
  const lock = relations.length
    ? `LOCK TABLE ${relations.join(",")} IN ACCESS SHARE MODE; `
    : "";
  return `${lock}SELECT public.${fn}(pg_catalog.convert_from(pg_catalog.decode('${hex}','hex'),'UTF8')::jsonb) AS result`;
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw Error("empty_provider_body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 2 * 1024 * 1024) {
        await reader.cancel();
        throw Error("provider_response_size_limit");
      }
      chunks.push(part.value);
    }
    const data = new Uint8Array(length);
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
function providerId(response: Response): string | null {
  const id = response.headers.get("x-request-id") ??
    response.headers.get("sb-request-id");
  return id && /^[A-Za-z0-9_.:-]{1,200}$/.test(id) ? id : null;
}
const SENSITIVE_RESULT_KEY =
  /(password|passwd|secret|credential|access.?token|refresh.?token|private.?key|api.?key|signing.?key|authorization|cookie|connection.?string|encrypted.?value|prosrc|probin|proconfig|subconninfo|rolpassword|srvoptions|umoptions|fdwoptions)/i;
function safeResult(value: unknown, depth = 0): boolean {
  if (depth > 40) return false;
  if (Array.isArray(value)) {
    return value.every((child) => safeResult(child, depth + 1));
  }
  if (object(value)) {
    return Object.entries(value).every(([key, child]) =>
      !SENSITIVE_RESULT_KEY.test(key) && safeResult(child, depth + 1)
    );
  }
  return true;
}
function projections(plan: DatabasePlan, result: Row): Row {
  const first = result.statements[0]?.rows[0];
  const snapshot = object(first?.snapshot) ? first.snapshot : null;
  if (plan.projection === "diff") {
    if (!snapshot || !Array.isArray(snapshot.objects)) {
      throw Error("snapshot_contract_mismatch");
    }
    const key = (o: Row) => JSON.stringify([o.kind, o.schema, o.name]);
    const before = new Map((plan.baseline ?? []).map((o) => [key(o), o]));
    const current = new Map(snapshot.objects.map((o: Row) => [key(o), o]));
    const added: Row[] = [], removed: Row[] = [], changed: Row[] = [];
    for (const [id, now] of current) {
      const previous = before.get(String(id));
      if (!previous) added.push(now as Row);
      else if (previous.sha256 !== (now as Row).sha256) {
        changed.push({ ...(now as Row), before_sha256: previous.sha256 });
      }
    }
    for (const [id, previous] of before) {
      if (!current.has(id)) removed.push(previous);
    }
    return {
      ...result,
      diff: {
        added: added.slice(0, 1000),
        removed: removed.slice(0, 1000),
        changed: changed.slice(0, 1000),
        current_sha256: snapshot.sha256,
        possibly_truncated: snapshot.possibly_truncated === true ||
          [added, removed, changed].some((a) => a.length > 1000),
      },
    };
  }
  if (plan.projection === "migration_plan") {
    if (!snapshot || typeof snapshot.sha256 !== "string") {
      throw Error("snapshot_contract_mismatch");
    }
    const entry = result.statements[1]?.rows[0] ?? null;
    return {
      ...result,
      plan: {
        ...plan.metadata,
        current_schema_sha256: snapshot.sha256,
        schema_complete: snapshot.possibly_truncated === false,
        before_matches:
          snapshot.sha256 === plan.metadata?.expected_before_sha256,
        existing: entry,
        checksum_conflict: !!entry &&
          entry.checksum !== plan.metadata?.checksum,
        migration_executed: false,
      },
    };
  }
  if (plan.projection === "migration_verify") {
    if (!snapshot || typeof snapshot.sha256 !== "string") {
      throw Error("snapshot_contract_mismatch");
    }
    const entry = result.statements[1]?.rows[0] ?? null;
    return {
      ...result,
      verification: {
        version: plan.metadata?.version,
        exists: !!entry,
        checksum_matches: !!entry && entry.checksum === plan.metadata?.checksum,
        schema_matches:
          snapshot.sha256 === plan.metadata?.expected_schema_sha256,
        schema_complete: snapshot.possibly_truncated === false,
        valid: !!entry && entry.state === "applied" &&
          entry.checksum === plan.metadata?.checksum &&
          snapshot.sha256 === plan.metadata?.expected_schema_sha256 &&
          snapshot.possibly_truncated === false,
        ledger: entry,
        current_schema_sha256: snapshot.sha256,
      },
    };
  }
  return result;
}
export function createDatabaseOperationHandler(deps: DatabaseDependencies) {
  const fetcher = deps.fetch ?? fetch;
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return refuse(405, "method_not_allowed");
    if (
      !deps.service ||
      request.headers.get("authorization") !== `Bearer ${deps.service}`
    ) return refuse(403, "service_authorization_required");
    let body: unknown;
    try {
      body = await requestJson(request);
    } catch (error) {
      return refuse(
        error instanceof JsonRequestError ? error.status : 400,
        error instanceof JsonRequestError ? error.code : "invalid_request",
      );
    }
    if (
      !object(body) || Object.keys(body).some((k) =>
        ![
          "operation",
          "arguments",
          "actor_id",
          "tenant_id",
          "request_id",
          "grant_id",
          "admission_id",
          "credential_id",
        ].includes(k)
      )
    ) return refuse(400, "invalid_request");
    if (isMaintenanceOperation(body.operation)) {
      return executeMaintenanceOperation(
        deps,
        body as DatabaseContext,
        body.operation,
        body.arguments,
      );
    }
    const op = typeof body.operation === "string"
      ? databaseOperations[body.operation]
      : undefined;
    if (!op) return refuse(404, "operation_not_implemented");
    if (
      !object(body.arguments) ||
      !validators.get(op.operation)!.input(body.arguments)
    ) return refuse(400, "invalid_operation_arguments");
    if (
      typeof body.actor_id !== "string" || !UUID.test(body.actor_id) ||
      body.tenant_id !== null || typeof body.request_id !== "string" ||
      !UUID.test(body.request_id) || typeof body.grant_id !== "string" ||
      !UUID.test(body.grant_id) ||
      body.admission_id !== undefined &&
        (typeof body.admission_id !== "string" ||
          !UUID.test(body.admission_id)) ||
      body.credential_id !== undefined && body.credential_id !== null
    ) return refuse(400, "normal_owner_execution_context_required");
    const context = body as DatabaseContext;
    let permission: DatabasePolicyResult;
    try {
      permission = await deps.authorizeContext(context, op);
    } catch {
      return refuse(503, "execution_policy_unavailable");
    }
    if (!permission.allowed || permission.reused) {
      return refuse(
        permission.http_status ?? 403,
        permission.error ?? "execution_policy_refused",
      );
    }
    if (!deps.management && !deps.withManagementCredential) {
      return refuse(424, "provider_credential_unavailable");
    }
    const capability = databaseCapability(op.operation);
    if (!capability.executable) {
      return refuse(424, capability.unavailable_reason!);
    }
    let plan: DatabasePlan;
    try {
      plan = await compileDatabasePlan(op.operation, body.arguments);
    } catch (error) {
      return refuse(
        400,
        error instanceof DatabaseCompileError
          ? error.message
          : "database_plan_invalid",
      );
    }
    if (op.kind === "receipt_get") {
      plan.statements[0].parameters.push(context.actor_id);
    }
    if (
      plan.metadata?.reviewed_trigger_function &&
      deps.reviewedTriggerFunctions
          ?.[plan.metadata.reviewed_trigger_function] !==
        plan.metadata.reviewed_trigger_sha256
    ) return refuse(424, "reviewed_database_trigger_function_binding_required");
    let args_canonical: string;
    let input_sha256: string;
    try {
      args_canonical = canonicalJson(body.arguments);
      input_sha256 = await argumentDigest(body.arguments);
    } catch {
      return refuse(400, "database_argument_complexity_limit");
    }
    const scope_sha256 = await argumentDigest(
      databaseExecutionScope(op.operation),
    );
    const estimatedPayload = {
      ...context,
      admission_id: context.admission_id ??
        "00000000-0000-4000-8000-000000000000",
      operation: op.operation,
      arguments: body.arguments,
      arguments_canonical: args_canonical,
      input_sha256,
      contract_sha256: op.contract_sha256,
      scope_sha256,
      plan,
    };
    // The fixed SQL wrapper hex-encodes its payload. Bound the expanded provider
    // request before consuming authorization; bulk callers can submit smaller
    // explicitly approved chunks instead of receiving an ambiguous dispatch.
    if (
      new TextEncoder().encode(JSON.stringify(estimatedPayload)).length >
        256 * 1024
    ) {
      return refuse(413, "database_provider_request_size_limit");
    }
    let grant: DatabasePolicyResult;
    try {
      grant = await deps.consumeGrant({
        ...context,
        operation: op.operation,
        input_sha256,
        contract_sha256: op.contract_sha256,
        scope_sha256,
      });
    } catch {
      return refuse(503, "execution_grant_state_unknown");
    }
    if (
      !grant.allowed || grant.reused || !grant.admission_id ||
      !UUID.test(grant.admission_id)
    ) {
      return refuse(
        grant.http_status ?? 409,
        grant.error ?? "execution_grant_refused",
      );
    }
    const admission_id = grant.admission_id;
    const payload = {
      ...context,
      admission_id,
      operation: op.operation,
      arguments: body.arguments,
      arguments_canonical: args_canonical,
      input_sha256,
      contract_sha256: op.contract_sha256,
      scope_sha256,
      plan,
    };
    const finish = async (
      outcome: DatabaseFinish["outcome"],
      status: number | null,
      id: string | null,
      result: unknown,
    ) => {
      try {
        return (await deps.finishExecution({
          admission_id,
          outcome,
          provider_http_status: status,
          provider_request_id: id,
          result_sha256: await argumentDigest(result),
        })).allowed;
      } catch {
        return false;
      }
    };
    let providerAttempted = false;
    const call = async (
      sql: string,
      read_only: boolean,
      topLevelVacuum = false,
    ) => {
      if (!topLevelVacuum) {
        sql =
          "SET LOCAL statement_timeout='15000'; SET LOCAL lock_timeout='3000'; SET LOCAL standard_conforming_strings=on; " +
          sql;
      }
      const use = async (token: string) => {
        if (!token) throw Error("provider_credential_unavailable");
        providerAttempted = true;
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ query: sql, read_only }),
          redirect: "error",
          signal: AbortSignal.timeout(25000),
        });
        const data = await boundedJson(response);
        return { response, data };
      };
      return deps.withManagementCredential
        ? await deps.withManagementCredential({
          actorId: context.actor_id,
          admissionId: admission_id,
          operation: op.operation,
        }, use)
        : await use(deps.management ?? "");
    };
    let provider: { response: Response; data: unknown };
    try {
      if (plan.mode === "nontransactional") {
        const preflight = await call(
          payloadSql("sandy_api_database_preflight", payload),
          true,
        );
        const permission =
          Array.isArray(preflight.data) && preflight.data.length === 1 &&
            object(preflight.data[0])
            ? preflight.data[0].result
            : null;
        if (
          !preflight.response.ok || !object(permission) ||
          permission.ok !== true
        ) {
          await finish(
            "failed",
            preflight.response.status,
            providerId(preflight.response),
            { error: "database_preflight_refused" },
          );
          return refuse(
            424,
            object(permission) && typeof permission.error === "string"
              ? permission.error
              : "database_preflight_refused",
            { operation: op.operation, admission_id },
          );
        }
        provider = await call(
          plan.statements[0].sql,
          false,
          op.kind === "maintenance_vacuum",
        );
        if (!provider.response.ok) {
          throw Error("nontransactional_provider_failure");
        }
        if (
          !Array.isArray(provider.data) || provider.data.some((v) => !object(v))
        ) throw Error("nontransactional_provider_shape");
        if (
          op.kind.startsWith("connection_") &&
          (provider.data.length !== 1 || provider.data[0].signal_sent !== true)
        ) {
          const recorded = await finish(
            "failed",
            provider.response.status,
            providerId(provider.response),
            { error: "database_backend_identity_or_signal_refused" },
          );
          return refuse(409, "database_backend_identity_or_signal_refused", {
            operation: op.operation,
            admission_id,
            executed: true,
            receipt_recorded: recorded,
          });
        }
        const rows = provider.data.slice(0, plan.result_limit);
        let readback: unknown = null;
        if (plan.verifications.length) {
          const observed = await call(
            payloadSql("sandy_api_database_read", {
              ...payload,
              plan: {
                ...plan,
                mode: "read",
                statements: plan.verifications.map((v) => ({
                  sql: v.sql,
                  parameters: v.parameters,
                  mode: "query",
                  passive_relations: v.passive_relations,
                })),
                verifications: [],
              },
            }),
            true,
          );
          const result =
            Array.isArray(observed.data) && observed.data.length === 1 &&
              object(observed.data[0])
              ? observed.data[0].result
              : null;
          if (
            !observed.response.ok || !object(result) || result.ok !== true ||
            result.read_only !== true || result.operation !== op.operation ||
            result.project_ref !== databaseProject ||
            !Array.isArray(result.statements)
          ) throw Error("maintenance_readback_unavailable");
          readback = result.statements;
        }
        provider.data = [{
          result: {
            ok: true,
            contract_version: "1.0.0",
            operation: op.operation,
            project_ref: databaseProject,
            read_only: false,
            transactional: false,
            mutation_committed: null,
            verification_passed: false,
            command_id: null,
            statements: [{
              row_count: provider.data.length,
              rows,
              possibly_truncated: provider.data.length > rows.length,
            }],
            result_limit: plan.result_limit,
            possibly_truncated: provider.data.length > rows.length,
            effect_confirmed: false,
            reconciliation_required: true,
            readback,
          },
        }];
      } else {provider = await call(
          payloadSql(
            plan.mode === "read"
              ? "sandy_api_database_read"
              : "sandy_api_database_write",
            payload,
          ),
          plan.mode === "read",
        );}
    } catch (error) {
      if (
        !providerAttempted && error instanceof ConsumerCredentialError &&
        !error.requestMayHaveExecuted
      ) {
        await finish("failed", error.providerHttpStatus, null, {
          error: error.code,
        });
        return refuse(error.status, error.code, {
          operation: op.operation,
          admission_id,
        });
      }
      await finish("unknown", null, null, {
        error: "database_execution_outcome_unknown",
      });
      return reply(502, {
        ok: false,
        operation: op.operation,
        error: "database_execution_outcome_unknown",
        executed: null,
        admission_id,
        reconciliation_required: true,
        automatic_retry: false,
      });
    }
    const status = provider.response.status, id = providerId(provider.response);
    if (!provider.response.ok) {
      const recorded = await finish(
        status >= 500 ? "unknown" : "failed",
        status,
        id,
        { error: "database_provider_request_failed" },
      );
      return reply(502, {
        ok: false,
        operation: op.operation,
        error: "database_provider_request_failed",
        executed: status >= 500 ? null : false,
        admission_id,
        provider_http_status: status,
        provider_request_id: id,
        receipt_recorded: recorded,
        ...(status >= 500 ? { reconciliation_required: true } : {}),
      });
    }
    let result = Array.isArray(provider.data) && provider.data.length === 1 &&
        object(provider.data[0])
      ? provider.data[0].result
      : null;
    if (
      object(result) && result.ok === false &&
      typeof result.error === "string" &&
      [400, 403, 404, 409, 424, 503].includes(result.http_status)
    ) {
      const unknown = result.reconciliation_required === true;
      const recorded = await finish(
        unknown ? "unknown" : "failed",
        status,
        id,
        { error: result.error },
      );
      return reply(result.http_status, {
        ok: false,
        operation: op.operation,
        error: result.error,
        executed: unknown ? null : false,
        admission_id,
        receipt_recorded: recorded,
        ...(unknown
          ? { reconciliation_required: true, automatic_retry: false }
          : {}),
      });
    }
    try {
      if (
        !object(result) || result.operation !== op.operation ||
        result.project_ref !== databaseProject ||
        result.read_only !== !op.is_mutation ||
        result.result_limit !== plan.result_limit
      ) throw Error("database_result_binding_mismatch");
      if (
        plan.mode === "transaction" &&
        (result.mutation_committed !== true ||
          result.verification_passed !== true ||
          typeof result.command_id !== "string" ||
          !UUID.test(result.command_id))
      ) throw Error("database_effect_unverified");
      if (!safeResult(result)) throw Error("sensitive_database_result");
      result = projections(plan, result);
      const envelope = {
        ok: true,
        operation: op.operation,
        contract_version: "1.0.0",
        provider: "supabase",
        project_ref: databaseProject,
        request_state: op.is_mutation ? "accepted" : "observed",
        executed: true,
        admission_id,
        provider_http_status: status,
        provider_request_id: id,
        result,
      };
      if (!validators.get(op.operation)!.output(envelope)) {
        throw Error("database_result_contract_mismatch");
      }
      const recorded = await finish(
        op.is_mutation ? "accepted" : "succeeded",
        status,
        id,
        result,
      );
      if (!recorded) {
        return reply(503, {
          ok: false,
          operation: op.operation,
          error: "execution_receipt_state_unknown",
          executed: true,
          admission_id,
          reconciliation_required: true,
        });
      }
      return reply(200, envelope);
    } catch {
      await finish(op.is_mutation ? "unknown" : "failed", status, id, {
        error: "database_result_unverified",
      });
      return reply(502, {
        ok: false,
        operation: op.operation,
        error: "database_result_unverified",
        executed: op.is_mutation ? null : true,
        admission_id,
        reconciliation_required: op.is_mutation,
        automatic_retry: false,
      });
    }
  };
}

if (import.meta.main) {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = async (
    name: string,
    args: Row,
  ): Promise<DatabasePolicyResult> => {
    const { data, error } = await db.rpc(name, args);
    return error || !object(data)
      ? {
        allowed: false,
        error: "execution_policy_unavailable",
        http_status: 503,
      }
      : data as DatabasePolicyResult;
  };
  let reviewedTriggerFunctions: Record<string, string> = {};
  try {
    const configured = JSON.parse(
      Deno.env.get("SANDY_DATABASE_REVIEWED_TRIGGER_FUNCTIONS_JSON") ?? "{}",
    );
    if (
      object(configured) &&
      Object.entries(configured).every(([name, hash]) =>
        /^[a-z_][a-z0-9_]{0,62}$/.test(name) && typeof hash === "string" &&
        /^[a-f0-9]{64}$/.test(hash)
      )
    ) reviewedTriggerFunctions = configured;
  } catch { /* fail closed, no inferred routine approval */ }
  const credentialConsumer = createCredentialConsumer({
    db,
    legacy: {
      supabase_management: () =>
        Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN") ?? "",
      github_api: () => {
        throw new Error("credential_consumer_not_configured");
      },
      gcp_access_token: () => {
        throw new Error("credential_consumer_not_configured");
      },
    },
  });
  Deno.serve(
    createDatabaseOperationHandler({
      service,
      maintenanceUrl: Deno.env.get("SANDY_DATABASE_MAINTENANCE_URL") ?? "",
      withManagementCredential: (execution, use) =>
        credentialConsumer("supabase_management", execution, use),
      reviewedTriggerFunctions,
      authorizeContext: async (context, op) => {
        const [owner, registry] = await Promise.all([
          db.from("sandy_controller_admins").select("auth_user_id,role,enabled")
            .eq("auth_user_id", context.actor_id).eq("role", "owner").eq(
              "enabled",
              true,
            ).maybeSingle(),
          db.from("sandy_operation_registry").select(
            "handler,api_exposed,verified,is_mutation,error_contract",
          ).eq("operation", op.operation).maybeSingle(),
        ]);
        if (owner.error || registry.error) {
          return {
            allowed: false,
            error: "execution_policy_unavailable",
            http_status: 503,
          };
        }
        const row = registry.data;
        if (
          !owner.data || !row || row.handler !== databaseHandler ||
          row.api_exposed !== true || row.verified !== true ||
          row.is_mutation !== op.is_mutation ||
          row.error_contract?.contract_sha256 !== op.contract_sha256 ||
          row.error_contract?.requires_approval !== true ||
          row.error_contract?.requires_grant !== true
        ) {
          return {
            allowed: false,
            error: "verified_database_execution_contract_required",
            http_status: 424,
          };
        }
        return { allowed: true };
      },
      consumeGrant: (request) =>
        rpc("sandy_api_consume_execution_grant", {
          p_grant_id: request.grant_id,
          p_actor_id: request.actor_id,
          p_tenant_id: request.tenant_id,
          p_operation: request.operation,
          p_input_sha256: request.input_sha256,
          p_request_id: request.request_id,
          p_contract_sha256: request.contract_sha256,
          p_scope_sha256: request.scope_sha256,
        }),
      finishExecution: async (request) => {
        const { data, error } = await db.rpc("sandy_api_finish_execution", {
          p_admission_id: request.admission_id,
          p_outcome: request.outcome,
          p_provider_http_status: request.provider_http_status,
          p_provider_request_id: request.provider_request_id,
          p_result_sha256: request.result_sha256,
        });
        return error || !object(data) || data.ok !== true ||
            data.admission_id !== request.admission_id ||
            data.state !== request.outcome || typeof data.reused !== "boolean"
          ? {
            allowed: false,
            error: "execution_receipt_state_unknown",
            http_status: 503,
          }
          : { allowed: true };
      },
    }),
  );
}
