/**
 * Durable retry admission for approved, classified read failures only.
 * This component never calls a provider or dispatches the recorded child job.
 * An independent consumer may advance the child. executed:false describes only
 * this admission call; the observed child status is reported separately.
 * The API must authenticate its caller before supplying the actor ID here.
 */
export type RetryRpcClient = {
  rpc(name: string, arguments_: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
};
export type RetryAdmission = {
  status: number;
  body: Record<string, unknown>;
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const errors = new Map<string, number>([
  ["owner_required", 403],
  ["job_not_found", 404],
  ["only_failed_jobs_can_retry", 409],
  ["retry_operation_not_supported", 422],
  ["retry_requires_outcome_reconciliation", 409],
  ["failure_not_classified_retryable", 409],
  ["original_approval_not_current", 403],
  ["retry_limit_reached", 429],
  ["approved_target_snapshot_missing", 409],
  ["registered_target_required", 409],
  ["approved_target_scope_changed", 409],
  ["approved_job_scope_changed", 409],
  ["retry_idempotency_collision", 409],
]);
const unknownOutcome = (): RetryAdmission => ({
  status: 503,
  body: {
    ok: false,
    error: "retry_outcome_unknown",
    accepted: null,
    executed: null,
    reconciliation_required: true,
  },
});

export async function requestReadJobRetry(
  db: RetryRpcClient,
  authenticatedActorId: string,
  arguments_: unknown,
): Promise<RetryAdmission> {
  if (!uuid(authenticatedActorId)) {
    return {
      status: 401,
      body: { ok: false, error: "invalid_identity", executed: false },
    };
  }
  if (
    !object(arguments_) || !uuid(arguments_.job_id) ||
    Object.keys(arguments_).some((key) => key !== "job_id")
  ) {
    return {
      status: 400,
      body: { ok: false, error: "invalid_retry_arguments", executed: false },
    };
  }
  const jobId = arguments_.job_id.toLowerCase();
  let response: unknown;
  try {
    response = await db.rpc("sandy_api_retry_read_deployment_job", {
      p_job_id: jobId,
      p_actor_id: authenticatedActorId.toLowerCase(),
    });
  } catch {
    return unknownOutcome();
  }
  if (!object(response) || response.error || !object(response.data)) {
    return unknownOutcome();
  }
  const result = response.data;
  if (result.ok !== true) {
    const status = typeof result.error === "string"
      ? errors.get(result.error)
      : undefined;
    if (!status || result.http_status !== status) return unknownOutcome();
    return {
      status,
      body: {
        ok: false,
        error: result.error,
        accepted: false,
        executed: false,
      },
    };
  }
  const jobStatuses = [
    "pending_approval",
    "approved",
    "running",
    "succeeded",
    "failed",
    "cancelled",
  ];
  if (
    result.accepted !== true || result.executed !== false ||
    result.request_state !== "recorded" || result.source_job_id !== jobId ||
    !uuid(result.retry_job_id) || result.retry_job_id === jobId ||
    typeof result.reused !== "boolean" ||
    typeof result.retry_depth !== "number" ||
    !Number.isInteger(result.retry_depth) ||
    result.retry_depth < 1 || result.retry_depth > 3 ||
    typeof result.retry_job_status !== "string" ||
    !jobStatuses.includes(result.retry_job_status) ||
    result.dispatch_required !== (result.retry_job_status === "approved")
  ) {
    return unknownOutcome();
  }
  // Project only the verified receipt fields; never expose unexpected SQL bodies.
  return {
    status: 202,
    body: {
      ok: true,
      accepted: true,
      executed: false,
      request_state: "recorded",
      source_job_id: result.source_job_id,
      retry_job_id: result.retry_job_id,
      retry_job_status: result.retry_job_status,
      reused: result.reused,
      retry_depth: result.retry_depth,
      dispatch_required: result.dispatch_required,
    },
  };
}
