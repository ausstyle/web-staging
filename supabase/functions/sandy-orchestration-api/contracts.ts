const uuid = { type: "string", format: "uuid" };
const step = {
  type: "object",
  required: ["key", "operation"],
  properties: {
    key: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" },
    operation: { type: "string", pattern: "^[a-z][a-z0-9_.-]{2,100}$" },
    arguments: { type: "object" },
    depends_on: {
      type: "array",
      maxItems: 50,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" },
    },
  },
  additionalProperties: false,
};
const states = {
  type: "string",
  enum: [
    "queued",
    "leased",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "blocked",
    "needs_reconciliation",
    "dead_letter",
  ],
};
const key = { type: "string", pattern: "^[A-Za-z0-9:_-]{12,128}$" };
const input = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", required, properties, additionalProperties: false });
const jobId = input({ job_id: uuid });
const jobs = {
  type: "array",
  minItems: 1,
  maxItems: 50,
  items: input({ job_id: uuid, step_key: { type: "string" }, state: states }),
};
const admission = input({
  ok: { const: true },
  accepted: { const: true },
  executed: { const: false },
  request_state: { const: "recorded" },
  plan_id: uuid,
  reused: { type: "boolean" },
  dispatch_required: { type: "boolean" },
  jobs,
});
const validation = input({
  ok: { const: true },
  contract_version: { const: "1.0.0" },
  valid: { type: "boolean" },
  steps: {
    type: "array",
    maxItems: 50,
    items: input({
      key: { type: "string" },
      operation: { type: "string" },
      arguments: { type: "object" },
      depends_on: { type: "array", items: { type: "string" } },
      registry_revision: { type: "string", pattern: "^[a-f0-9]{64}$" },
      input_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    }),
  },
  blockers: {
    type: "array",
    items: input({ step_key: { type: "string" }, code: { type: "string" } }, [
      "code",
    ]),
  },
  provider_dry_run_performed: { const: false },
  execution_authorization_rechecked_at_dispatch: { const: true },
  tenant_execution_supported: { const: false },
  cost_estimate: input({
    monetary_total: { type: "null" },
    pricing_status: { const: "unavailable" },
    max_api_calls: { type: "integer", minimum: 0, maximum: 50 },
    model_calls: { const: 0 },
  }),
  blast_radius: input({
    effect: { const: "infrastructure_read_only" },
    provider_writes: { const: false },
    maximum_steps: { type: "integer", minimum: 0, maximum: 50 },
  }),
});
export const orchestrationContracts = [
  {
    operation: "orchestration.operations.enqueue",
    action: "operation_enqueue",
    is_mutation: true,
    description:
      "Durably record one delegated owner infrastructure read with principal-scoped idempotency and immutable contract/input snapshots; acceptance does not execute a provider; contract v1.0.0.",
    input_schema: input({
      operation: { type: "string", pattern: "^[a-z][a-z0-9_.-]{2,100}$" },
      arguments: { type: "object" },
      idempotency_key: key,
    }, ["operation", "idempotency_key"]),
    output_schema: admission,
  },
  {
    operation: "orchestration.plans.validate",
    action: "plan_validate",
    is_mutation: false,
    description:
      "Validate a bounded delegated-read DAG against current owner grants, registry schemas and dependency cycles. Reports absent provider pricing and no provider dry run truthfully; contract v1.0.0.",
    input_schema: input({
      steps: { type: "array", minItems: 1, maxItems: 50, items: step },
    }),
    output_schema: validation,
  },
  {
    operation: "orchestration.plans.execute",
    action: "plan_execute",
    is_mutation: true,
    description:
      "Transactionally record a validated delegated-read DAG and outbox; dependencies execute through Sandy API, without promising atomic multi-provider effects; contract v1.0.0.",
    input_schema: input({
      steps: { type: "array", minItems: 1, maxItems: 50, items: step },
      idempotency_key: key,
    }),
    output_schema: admission,
  },
  {
    operation: "orchestration.plans.get",
    action: "plan_get",
    is_mutation: false,
    description:
      "Read the authenticated owner's durable plan and derived job states; contract v1.0.0.",
    input_schema: input({ plan_id: uuid }),
    output_schema: input({
      ok: { const: true },
      plan_id: uuid,
      state: {
        type: "string",
        enum: [
          "recorded",
          "running",
          "succeeded",
          "failed",
          "cancelled",
          "needs_reconciliation",
        ],
      },
      jobs: {
        type: "array",
        maxItems: 50,
        items: input({
          job_id: uuid,
          step_key: { type: "string" },
          operation: { type: "string" },
          state: states,
        }),
      },
      atomic_provider_execution: { const: false },
    }),
  },
  {
    operation: "orchestration.jobs.get",
    action: "job_get",
    is_mutation: false,
    description:
      "Read one owned durable job, attempts and persisted result without exposing lease credentials; contract v1.0.0.",
    input_schema: jobId,
    output_schema: input({
      ok: { const: true },
      job: input({
        id: uuid,
        plan_id: uuid,
        step_key: { type: "string" },
        operation: { type: "string" },
        state: states,
        attempts: { type: "integer", minimum: 0, maximum: 5 },
        max_attempts: { type: "integer", minimum: 1, maximum: 5 },
        latest_attempt: {
          anyOf: [
            { type: "null" },
            input({
              attempt: { type: "integer", minimum: 1, maximum: 5 },
              dispatch_id: uuid,
              started_at: { type: "string", format: "date-time" },
              finished_at: { type: ["string", "null"], format: "date-time" },
              outcome: {
                type: ["string", "null"],
                enum: [
                  null,
                  "succeeded",
                  "failed",
                  "retryable",
                  "unknown",
                  "lease_expired_outcome_unknown",
                ],
              },
              provider_request_id: { type: ["string", "null"], maxLength: 200 },
              execution_admission_id: {
                type: ["string", "null"],
                format: "uuid",
              },
            }),
          ],
        },
        result: {},
        error_code: { type: ["string", "null"] },
        created_at: { type: "string", format: "date-time" },
        started_at: { type: ["string", "null"], format: "date-time" },
        finished_at: { type: ["string", "null"], format: "date-time" },
        provider_execution_completed: { type: "boolean" },
        rollback_available: { const: false },
      }),
    }),
  },
  {
    operation: "orchestration.jobs.events",
    action: "job_events",
    is_mutation: false,
    description:
      "Read ordered owned-job progress with an exclusive cursor and bounded page; no lease tokens or payloads; contract v1.0.0.",
    input_schema: input({
      job_id: uuid,
      after: { type: "integer", minimum: 0, maximum: 9007199254740991 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    }, ["job_id"]),
    output_schema: input({
      ok: { const: true },
      job_id: uuid,
      events: {
        type: "array",
        maxItems: 200,
        items: input({
          id: { type: "integer", minimum: 1 },
          event_type: { type: "string" },
          details: { type: "object" },
          created_at: { type: "string", format: "date-time" },
        }),
      },
      next_cursor: { type: ["integer", "null"], minimum: 1 },
    }),
  },
  {
    operation: "orchestration.jobs.cancel",
    action: "job_cancel",
    is_mutation: true,
    description:
      "Idempotently cancel owned queued/leased durable jobs before dispatch CAS; refuses running/terminal provider work; contract v1.0.0.",
    input_schema: jobId,
    output_schema: input({
      ok: { const: true },
      job_id: uuid,
      state: { const: "cancelled" },
      reused: { type: "boolean" },
      provider_cancellation: { const: false },
    }),
  },
  {
    operation: "orchestration.jobs.retry",
    action: "job_retry",
    is_mutation: true,
    description:
      "Requeue only an owned failed classified transient read within immutable contract and attempt budget; bounded exponential backoff with jitter, no mutation retry; contract v1.0.0.",
    input_schema: jobId,
    output_schema: input({
      ok: { const: true },
      accepted: { const: true },
      executed: { const: false },
      job_id: uuid,
      state: { const: "queued" },
      reused: { type: "boolean" },
    }),
  },
] as const;
