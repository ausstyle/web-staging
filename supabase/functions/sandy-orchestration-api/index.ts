import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";

/** Owner infrastructure-read orchestration. This service persists no user JWTs.
 * All actual dispatch passes through Sandy API's scoped-lease executor route.
 * Queue acceptance, backend response, receipt persistence and verification differ.
 */
export type ObjectValue = Record<string, unknown>;
export type RpcClient = {
  rpc(
    name: string,
    args: ObjectValue,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};
export type Dependencies = {
  db: RpcClient;
  base: string;
  service: string;
  anon?: string;
  fetch?: typeof fetch;
};
const object = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_.-]{2,100}$/.test(value);
const key = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exactKeys = (value: ObjectValue, allowed: string[]) =>
  Object.keys(value).every((name) => allowed.includes(name));
const response = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
function schemaValid(schema: unknown, input: unknown): boolean | null {
  if (
    !object(schema) || schema.type !== "object" || schema.$async !== undefined
  ) return null;
  try {
    const validator = ajv.compile(schema);
    const valid = validator(input);
    ajv.removeSchema(schema);
    return valid === true;
  } catch {
    return null;
  }
}
export type ValidatedStep = {
  key: string;
  operation: string;
  arguments: ObjectValue;
  depends_on: string[];
  registry_revision: string;
  input_sha256: string;
};
export type PlanValidation = {
  ok: true;
  contract_version: "1.0.0";
  valid: boolean;
  steps: ValidatedStep[];
  blockers: { step_key?: string; code: string }[];
  provider_dry_run_performed: false;
  execution_authorization_rechecked_at_dispatch: true;
  tenant_execution_supported: false;
  cost_estimate: {
    monetary_total: null;
    pricing_status: "unavailable";
    max_api_calls: number;
    model_calls: 0;
  };
  blast_radius: {
    effect: "infrastructure_read_only";
    provider_writes: false;
    maximum_steps: number;
  };
};
/** Validation is a real registry/schema/dependency check, not a provider dry run
 * or a fabricated monetary estimate. Current scope is explicit delegated reads.
 */
export async function validatePlan(
  input: unknown,
  entries: unknown,
  channel: "api" | "mcp",
): Promise<PlanValidation> {
  const blockers: PlanValidation["blockers"] = [];
  const steps: ValidatedStep[] = [];
  const report = (): PlanValidation => ({
    ok: true,
    contract_version: "1.0.0",
    valid: blockers.length === 0,
    steps,
    blockers,
    provider_dry_run_performed: false,
    execution_authorization_rechecked_at_dispatch: true,
    tenant_execution_supported: false,
    cost_estimate: {
      monetary_total: null,
      pricing_status: "unavailable",
      max_api_calls: steps.length,
      model_calls: 0,
    },
    blast_radius: {
      effect: "infrastructure_read_only",
      provider_writes: false,
      maximum_steps: steps.length,
    },
  });
  if (
    !object(input) || !exactKeys(input, ["steps"]) ||
    !Array.isArray(input.steps) || input.steps.length < 1 ||
    input.steps.length > 50 ||
    new TextEncoder().encode(JSON.stringify(input)).length > 262144
  ) {
    blockers.push({ code: "invalid_plan" });
    return report();
  }
  if (!Array.isArray(entries)) {
    blockers.push({ code: "operation_catalogue_unavailable" });
    return report();
  }
  const catalogue = new Map<string, ObjectValue>();
  for (const entry of entries) {
    if (
      !object(entry) || !identifier(entry.operation) ||
      catalogue.has(entry.operation) || !digest(entry.registry_revision)
    ) {
      blockers.push({ code: "operation_catalogue_invalid" });
      return report();
    }
    catalogue.set(entry.operation, entry);
  }
  const seen = new Set<string>();
  for (const value of input.steps) {
    if (
      !object(value) ||
      !exactKeys(value, ["key", "operation", "arguments", "depends_on"]) ||
      !key(value.key) || !identifier(value.operation) ||
      (value.arguments !== undefined && !object(value.arguments)) ||
      (value.depends_on !== undefined && !Array.isArray(value.depends_on))
    ) {
      blockers.push({ code: "invalid_plan_step" });
      continue;
    }
    const stepKey = value.key;
    if (seen.has(stepKey)) {
      blockers.push({ step_key: stepKey, code: "duplicate_step_key" });
      continue;
    }
    seen.add(stepKey);
    const dependencies = value.depends_on ?? [];
    if (
      !(dependencies as unknown[]).every(key) ||
      new Set(dependencies as unknown[]).size !==
        (dependencies as unknown[]).length
    ) {
      blockers.push({ step_key: stepKey, code: "invalid_dependencies" });
      continue;
    }
    const entry = catalogue.get(value.operation);
    if (
      !entry || entry.is_mutation !== false || entry.api_exposed !== true ||
      (channel === "mcp" && entry.ai_exposed !== true) ||
      !["sandy-provider-read-api", "sandy-infrastructure-read"].includes(
        String(entry.handler),
      ) ||
      ![
        "infrastructure:read",
        "deployment:read",
        "engineering:read",
        "system:read",
      ].includes(String(entry.permission_scope))
    ) {
      blockers.push({ step_key: stepKey, code: "operation_not_delegated" });
      continue;
    }
    const arguments_ = value.arguments ?? {};
    const valid = schemaValid(entry.input_schema, arguments_);
    if (valid !== true || schemaValid(entry.output_schema, {}) === null) {
      blockers.push({
        step_key: stepKey,
        code: valid === false
          ? "invalid_operation_arguments"
          : "operation_contract_unavailable",
      });
      continue;
    }
    steps.push({
      key: stepKey,
      operation: value.operation,
      arguments: arguments_ as ObjectValue,
      depends_on: [...dependencies as string[]].sort(),
      registry_revision: entry.registry_revision as string,
      input_sha256: await argumentDigest(arguments_),
    });
  }
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(step: ValidatedStep) {
    if (visiting.has(step.key)) {
      blockers.push({ step_key: step.key, code: "plan_cycle" });
      return;
    }
    if (visited.has(step.key)) return;
    visiting.add(step.key);
    for (const dependency of step.depends_on) {
      const prerequisite = byKey.get(dependency);
      if (!prerequisite) {
        blockers.push({ step_key: step.key, code: "missing_dependency" });
      } else visit(prerequisite);
    }
    visiting.delete(step.key);
    visited.add(step.key);
  }
  for (const step of steps) visit(step);
  steps.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return report();
}
async function rpc(
  db: RpcClient,
  name: string,
  args: ObjectValue,
  mutation = false,
): Promise<{ status: number; body: ObjectValue }> {
  let raw: unknown;
  try {
    raw = await db.rpc(name, args);
  } catch {
    raw = null;
  }
  if (
    !object(raw) || raw.error || !object(raw.data) ||
    typeof raw.data.ok !== "boolean"
  ) {
    return {
      status: 503,
      body: {
        ok: false,
        error: mutation
          ? "orchestration_outcome_unknown"
          : "orchestration_unavailable",
        executed: mutation ? null : false,
        ...(mutation ? { accepted: null, reconciliation_required: true } : {}),
      },
    };
  }
  const body = raw.data;
  if (body.ok === false) {
    const status = [400, 401, 403, 404, 409, 422, 429, 503].includes(
        Number(body.http_status),
      )
      ? Number(body.http_status)
      : 503;
    return {
      status,
      body: {
        ok: false,
        error: typeof body.error === "string" &&
            /^[a-z][a-z0-9_]{1,120}$/.test(body.error)
          ? body.error
          : "orchestration_unavailable",
        executed: false,
      },
    };
  }
  return { status: 200, body };
}
export const orchestrationActions = Object.freeze({
  "orchestration.operations.enqueue": "operation_enqueue",
  "orchestration.plans.validate": "plan_validate",
  "orchestration.plans.execute": "plan_execute",
  "orchestration.plans.get": "plan_get",
  "orchestration.jobs.get": "job_get",
  "orchestration.jobs.events": "job_events",
  "orchestration.jobs.cancel": "job_cancel",
  "orchestration.jobs.retry": "job_retry",
});
export function isOrchestrationOperation(
  operation: unknown,
): operation is keyof typeof orchestrationActions {
  return typeof operation === "string" &&
    Object.hasOwn(orchestrationActions, operation);
}
export async function handleOrchestrationAction(
  db: RpcClient,
  actorId: string,
  action: string,
  args: unknown,
  channel: "api" | "mcp" = "api",
) {
  if (!uuid(actorId)) {
    return response(401, {
      ok: false,
      error: "invalid_identity",
      executed: false,
    });
  }
  if (!object(args)) {
    return response(400, {
      ok: false,
      error: "invalid_orchestration_arguments",
      executed: false,
    });
  }
  if (["plan_validate", "plan_execute", "operation_enqueue"].includes(action)) {
    const enqueue = action === "operation_enqueue",
      execute = action !== "plan_validate";
    const allowed = enqueue
      ? ["operation", "arguments", "idempotency_key"]
      : execute
      ? ["steps", "idempotency_key"]
      : ["steps"];
    if (
      !exactKeys(args, allowed) ||
      (execute &&
        (typeof args.idempotency_key !== "string" ||
          !/^[A-Za-z0-9:_-]{12,128}$/.test(args.idempotency_key)))
    ) {
      return response(400, {
        ok: false,
        error: "invalid_orchestration_arguments",
        executed: false,
      });
    }
    const catalogue = await rpc(db, "sandy_orch_catalogue", {
      p_actor_id: actorId,
      p_channel: channel,
    });
    if (catalogue.body.ok !== true) {
      return response(catalogue.status, catalogue.body);
    }
    const plan = enqueue
      ? {
        steps: [{
          key: "operation",
          operation: args.operation,
          arguments: args.arguments ?? {},
          depends_on: [],
        }],
      }
      : { steps: args.steps };
    const validation = await validatePlan(
      plan,
      catalogue.body.operations,
      channel,
    );
    if (!execute) return response(200, validation);
    if (!validation.valid) {
      return response(422, {
        ok: false,
        error: "plan_validation_failed",
        executed: false,
        validation,
      });
    }
    const admission = await rpc(db, "sandy_orch_admit", {
      p_actor_id: actorId,
      p_channel: channel,
      p_kind: enqueue ? "operation" : "plan",
      p_idempotency_key: args.idempotency_key,
      p_steps: validation.steps,
    }, true);
    if (admission.body.ok !== true) {
      return response(admission.status, admission.body);
    }
    if (
      admission.body.accepted !== true || admission.body.executed !== false ||
      admission.body.request_state !== "recorded" ||
      !uuid(admission.body.plan_id) ||
      !Array.isArray(admission.body.jobs) ||
      admission.body.jobs.length !== validation.steps.length ||
      typeof admission.body.reused !== "boolean"
    ) {
      return response(503, {
        ok: false,
        error: "orchestration_outcome_unknown",
        accepted: null,
        executed: null,
        reconciliation_required: true,
      });
    }
    return response(202, admission.body);
  }
  const names: Record<string, string> = {
    job_get: "sandy_orch_job",
    job_events: "sandy_orch_events_page",
    job_cancel: "sandy_orch_cancel",
    job_retry: "sandy_orch_retry",
    plan_get: "sandy_orch_plan",
  };
  if (!Object.hasOwn(names, action)) {
    return response(400, {
      ok: false,
      error: "unknown_orchestration_action",
      executed: false,
    });
  }
  const idField = action === "plan_get" ? "plan_id" : "job_id";
  if (
    !uuid(args[idField]) ||
    !exactKeys(
      args,
      action === "job_events" ? ["job_id", "after", "limit"] : [idField],
    ) ||
    (action === "job_events" &&
      ((args.after !== undefined &&
        (!Number.isSafeInteger(args.after) || Number(args.after) < 0)) ||
        (args.limit !== undefined &&
          (!Number.isInteger(args.limit) || Number(args.limit) < 1 ||
            Number(args.limit) > 200))))
  ) {
    return response(400, {
      ok: false,
      error: "invalid_orchestration_arguments",
      executed: false,
    });
  }
  const result = await rpc(db, names[action], {
    p_actor_id: actorId,
    [action === "plan_get" ? "p_plan_id" : "p_job_id"]: args[idField],
    ...(action === "job_events"
      ? { p_after: args.after ?? 0, p_limit: args.limit ?? 100 }
      : {}),
  }, ["job_cancel", "job_retry"].includes(action));
  return response(
    result.body.ok === true && action === "job_retry" ? 202 : result.status,
    result.body,
  );
}
export async function requestLegacyDeploymentJob(
  db: RpcClient,
  actorId: string,
  args: unknown,
) {
  if (!uuid(actorId)) {
    return response(401, {
      ok: false,
      error: "invalid_identity",
      executed: false,
    });
  }
  if (
    !object(args) ||
    !exactKeys(args, [
      "provider",
      "operation",
      "target",
      "payload",
      "idempotency_key",
    ]) ||
    !["google_cloud", "github", "supabase"].includes(String(args.provider)) ||
    typeof args.operation !== "string" ||
    typeof args.target !== "string" || args.target.length < 2 ||
    args.target.length > 200 ||
    typeof args.idempotency_key !== "string" ||
    !/^[A-Za-z0-9:_-]{12,128}$/.test(args.idempotency_key) ||
    (args.payload !== undefined && !object(args.payload)) ||
    new TextEncoder().encode(JSON.stringify(args.payload ?? {})).length > 12000
  ) {
    return response(400, {
      ok: false,
      error: "invalid_deployment_request",
      executed: false,
    });
  }
  const result = await rpc(db, "sandy_api_request_legacy_deployment_job", {
    p_actor_id: actorId,
    p_request: { ...args, payload: args.payload ?? {} },
  }, true);
  if (
    result.body.ok === true &&
    (result.body.accepted !== true || result.body.executed !== false ||
      !uuid(result.body.job_id) ||
      typeof result.body.state !== "string" ||
      typeof result.body.reused !== "boolean" ||
      typeof result.body.dispatch_required !== "boolean")
  ) {
    return response(503, {
      ok: false,
      error: "orchestration_outcome_unknown",
      accepted: null,
      executed: null,
      reconciliation_required: true,
    });
  }
  return response(result.body.ok === true ? 202 : result.status, result.body);
}
/** Claims are private workload credentials. They never appear in the worker's
 * public summary; the canonical API atomically consumes dispatch exactly once.
 */
export async function runWorker(
  dependencies: Dependencies,
  options: { worker_id?: string; limit?: number; lease_seconds?: number } = {},
) {
  const workerId = options.worker_id ?? crypto.randomUUID(),
    limit = options.limit ?? 1,
    leaseSeconds = options.lease_seconds ?? 90;
  if (
    !uuid(workerId) || !Number.isInteger(limit) || limit < 1 || limit > 3 ||
    !Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 300
  ) {
    return { ok: false, error: "invalid_worker_options", executed: false };
  }
  let base: URL;
  try {
    base = new URL(dependencies.base);
  } catch {
    return {
      ok: false,
      error: "worker_configuration_missing",
      executed: false,
    };
  }
  if (
    base.protocol !== "https:" || base.pathname !== "/" || base.search ||
    base.hash || base.username || base.password || !dependencies.service
  ) {
    return {
      ok: false,
      error: "worker_configuration_missing",
      executed: false,
    };
  }
  const claimed = await rpc(dependencies.db, "sandy_orch_claim", {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  }, true);
  if (claimed.body.ok !== true || !Array.isArray(claimed.body.claims)) {
    return claimed.body;
  }
  const claims = claimed.body.claims;
  const claimIds = new Set<string>();
  if (
    claims.length > limit || claims.some((claim: unknown) => {
      if (
        !object(claim) || !uuid(claim.job_id) || !uuid(claim.lease_token) ||
        claim.worker_id !== workerId || claimIds.has(claim.job_id)
      ) return true;
      claimIds.add(claim.job_id);
      return false;
    })
  ) return { ok: false, error: "invalid_worker_claim_batch", executed: false };
  const results = await Promise.all(
    claims.map(async (claim: unknown) => {
      if (
        !object(claim) || !uuid(claim.job_id) || !uuid(claim.lease_token) ||
        claim.worker_id !== workerId
      ) return { state: "invalid_claim", persisted: false };
      let body: ObjectValue | undefined, httpStatus: number | null = null;
      try {
        const reply = await (dependencies.fetch ?? fetch)(
          `${base.origin}/functions/v1/sandy-operation-api/v1/internal/execute`,
          {
            method: "POST",
            redirect: "error",
            headers: {
              authorization: `Bearer ${dependencies.service}`,
              apikey: dependencies.anon ?? "",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              job_id: claim.job_id,
              lease_token: claim.lease_token,
              worker_id: workerId,
            }),
            signal: AbortSignal.timeout(20000),
          },
        );
        httpStatus = reply.status;
        const parsed = await reply.json();
        if (object(parsed)) body = parsed;
      } catch {
        /* Reconcile via the private receipt lookup, never redispatch here. */
      }
      const receipt = await rpc(dependencies.db, "sandy_orch_attempt_receipt", {
        p_job_id: claim.job_id,
        p_lease_token: claim.lease_token,
        p_worker_id: workerId,
      });
      if (
        receipt.body.ok !== true || receipt.body.started !== true ||
        !uuid(receipt.body.dispatch_id)
      ) {
        return {
          job_id: claim.job_id,
          state: "dispatch_not_confirmed",
          persisted: false,
          reconciliation_required: true,
        };
      }
      let outcome = "unknown", errorCode = "read_transport_outcome_unknown";
      if (
        httpStatus !== null && httpStatus >= 200 && httpStatus < 300 &&
        body?.ok === true && body.executed === true && object(body.result) &&
        body.result.ok === true
      ) {
        outcome = "succeeded";
        errorCode = "";
      } else if (httpStatus !== null && body && body.executed !== null) {
        outcome = httpStatus === 429 || httpStatus >= 500
          ? "retryable"
          : "failed";
        errorCode = outcome === "retryable"
          ? "transient_provider_failure"
          : "canonical_executor_refused";
      }
      const finished = await rpc(dependencies.db, "sandy_orch_finish", {
        p_job_id: claim.job_id,
        p_lease_token: claim.lease_token,
        p_worker_id: workerId,
        p_dispatch_id: receipt.body.dispatch_id,
        p_outcome: outcome,
        p_result: outcome === "succeeded" ? body : null,
        p_error_code: errorCode || null,
        p_provider_request_id: typeof body?.provider_request_id === "string"
          ? body.provider_request_id
          : null,
        p_execution_admission_id: uuid(body?.admission_id)
          ? body.admission_id
          : null,
      }, true);
      const persisted = finished.body.ok === true &&
        finished.body.job_id === claim.job_id &&
        finished.body.receipt_outcome === outcome &&
        typeof finished.body.reused === "boolean" &&
        typeof finished.body.state === "string" &&
        ["queued", "succeeded", "failed", "needs_reconciliation", "dead_letter"]
          .includes(finished.body.state) &&
        (outcome !== "succeeded" || finished.body.state === "succeeded");
      return {
        job_id: claim.job_id,
        state: persisted ? finished.body.state : "receipt_persistence_unknown",
        persisted,
        ...(persisted ? {} : { reconciliation_required: true }),
      };
    }),
  );
  return {
    ok: results.every((result) => result.persisted),
    worker_id: workerId,
    claimed: results.length,
    results,
  };
}
export function createOrchestrationHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (!dependencies.service) {
      return response(503, {
        ok: false,
        error: "orchestration_configuration_missing",
      });
    }
    if (request.method !== "POST") {
      return response(405, { ok: false, error: "method_not_allowed" });
    }
    if (
      request.headers.get("authorization") !== `Bearer ${dependencies.service}`
    ) {
      return response(401, {
        ok: false,
        error: "internal_service_identity_required",
      });
    }
    let body: unknown;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 270000) throw Error();
      body = JSON.parse(text);
    } catch {
      return response(400, { ok: false, error: "invalid_request" });
    }
    if (
      !object(body) ||
      !exactKeys(body, ["action", "actor_id", "channel", "arguments"]) ||
      typeof body.action !== "string"
    ) return response(400, { ok: false, error: "invalid_request" });
    if (body.action === "worker_run") {
      if (
        !object(body.arguments) ||
        !exactKeys(body.arguments, ["worker_id", "limit", "lease_seconds"])
      ) return response(400, { ok: false, error: "invalid_worker_options" });
      const result = await runWorker(dependencies, body.arguments);
      return response(result.ok === true ? 200 : 503, result);
    }
    if (
      !uuid(body.actor_id) ||
      (body.channel !== undefined &&
        !["api", "mcp"].includes(String(body.channel)))
    ) return response(400, { ok: false, error: "invalid_request" });
    if (body.action === "legacy_request") {
      return requestLegacyDeploymentJob(
        dependencies.db,
        body.actor_id,
        body.arguments,
      );
    }
    return handleOrchestrationAction(
      dependencies.db,
      body.actor_id,
      body.action,
      body.arguments,
      body.channel === "mcp" ? "mcp" : "api",
    );
  };
}
if (import.meta.main) {
  const base = Deno.env.get("SUPABASE_URL") ?? "",
    service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const db = createClient(
    base || "https://invalid.invalid",
    service || "missing",
    { auth: { persistSession: false } },
  );
  Deno.serve(createOrchestrationHandler({ db, base, service, anon }));
}
