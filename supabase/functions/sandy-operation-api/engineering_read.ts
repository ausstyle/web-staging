/**
 * Compatibility for three passive Engineering Control v35 read actions.
 * The gateway must authenticate and authorize an enabled owner and validate the
 * live registry contract before using this builder. The backend independently
 * authenticates the same user's JWT. No service credential is accepted here.
 *
 * Source audit: list/get/job_status perform only SELECTs and return before any
 * mutation or provider call. Their legacy success bodies lack `ok`; normalize
 * only complete, scoped success shapes rather than treating HTTP 200 as success.
 */
type JsonObject = Record<string, unknown>;
export const engineeringReadActions = Object.freeze({
  "engineering.change.get": "get",
  "engineering.change.list": "list",
  "engineering.job.status": "job_status",
});
export type EngineeringReadOperation = keyof typeof engineeringReadActions;

const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const sameId = (value: unknown, expected: unknown) =>
  uuid(value) && uuid(expected) &&
  value.toLowerCase() === expected.toLowerCase();
const timestamp = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));
const nullableText = (value: unknown) =>
  value === null || typeof value === "string";
const nullableTimestamp = (value: unknown) =>
  value === null || timestamp(value);
const textFields = (value: JsonObject, keys: string[]) =>
  keys.every((key) => typeof value[key] === "string");
const ownFields = (value: JsonObject, keys: string[]) =>
  keys.every((key) => Object.hasOwn(value, key));
const exactFields = (value: JsonObject, keys: string[]) =>
  Object.keys(value).length === keys.length && ownFields(value, keys);

export function isEngineeringReadOperation(
  operation: unknown,
): operation is EngineeringReadOperation {
  return typeof operation === "string" &&
    Object.hasOwn(engineeringReadActions, operation);
}

function validArguments(
  operation: EngineeringReadOperation,
  arguments_: unknown,
): arguments_ is JsonObject {
  if (!object(arguments_)) return false;
  if (operation === "engineering.change.list") {
    return exactFields(arguments_, []);
  }
  return exactFields(
    arguments_,
    operation === "engineering.job.status"
      ? ["change_id", "job_id"]
      : ["change_id"],
  ) && uuid(arguments_.change_id) &&
    (operation !== "engineering.job.status" || uuid(arguments_.job_id));
}

export function buildEngineeringReadRequest(
  base: string,
  anon: string,
  userJwt: string,
  operation: unknown,
  arguments_: unknown,
): { url: string; init: RequestInit } | null {
  if (
    !isEngineeringReadOperation(operation) ||
    !validArguments(operation, arguments_) ||
    !/^[A-Za-z0-9._~-]+$/.test(userJwt)
  ) return null;
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return null;
  }
  if (
    origin.protocol !== "https:" || origin.username || origin.password ||
    origin.pathname !== "/" || origin.search || origin.hash
  ) return null;
  return {
    url: `${origin.origin}/functions/v1/sandy-engineering-control`,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${userJwt}`,
        apikey: anon,
        "content-type": "application/json",
      },
      // Arguments cannot override the fixed action, endpoint, change or job scope.
      body: JSON.stringify({
        action: engineeringReadActions[operation],
        ...arguments_,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    },
  };
}

function changeSummary(value: unknown): value is JsonObject {
  return object(value) && uuid(value.id) &&
    textFields(value, ["title", "status", "risk"]) &&
    timestamp(value.created_at) && timestamp(value.updated_at) &&
    nullableTimestamp(value.verified_at);
}

function changeRecord(value: unknown): value is JsonObject {
  return changeSummary(value) &&
    textFields(value, ["problem", "expected_behavior"]) &&
    uuid(value.requested_by) && nullableText(value.idempotency_key) &&
    nullableText(value.change_purpose) &&
    nullableText(value.feature_improvement) &&
    ownFields(value, ["scope", "regression_rules", "acceptance_criteria"]);
}

function eventRecord(value: unknown, changeId: unknown) {
  return object(value) && sameId(value.change_id, changeId) &&
    Number.isSafeInteger(value.id) && Number(value.id) > 0 &&
    typeof value.event_type === "string" &&
    (value.actor === null || uuid(value.actor)) &&
    Object.hasOwn(value, "detail") && timestamp(value.occurred_at);
}

function artifactRecord(value: unknown, changeId: unknown) {
  return object(value) && uuid(value.id) && sameId(value.change_id, changeId) &&
    textFields(value, ["artifact_type", "target", "rollback_strategy"]) &&
    ["before_ref", "after_ref", "rollback_notes"].every((key) =>
      nullableText(value[key])
    ) &&
    Object.hasOwn(value, "metadata") && timestamp(value.created_at);
}

function testRecord(value: unknown, changeId: unknown) {
  return object(value) && uuid(value.id) && sameId(value.change_id, changeId) &&
    textFields(value, ["test_name", "outcome"]) &&
    Object.hasOwn(value, "evidence") && nullableTimestamp(value.checked_at) &&
    timestamp(value.created_at);
}

function rollbackRecord(value: unknown, changeId: unknown) {
  return object(value) && uuid(value.id) && sameId(value.change_id, changeId) &&
    uuid(value.requested_by) && textFields(value, ["reason", "status"]) &&
    Object.hasOwn(value, "plan") && timestamp(value.created_at) &&
    timestamp(value.updated_at);
}

function jobRecord(value: unknown, changeId: unknown, jobId: unknown) {
  return object(value) && sameId(value.id, jobId) &&
    sameId(value.engineering_change_id, changeId) &&
    textFields(value, [
      "requested_by",
      "provider",
      "operation",
      "target",
      "idempotency_key",
      "status",
    ]) &&
    ownFields(value, ["payload", "result"]) &&
    nullableText(value.approved_by) &&
    nullableText(value.error) && timestamp(value.created_at) &&
    timestamp(value.updated_at) &&
    ["approved_at", "started_at", "finished_at"].every((key) =>
      nullableTimestamp(value[key])
    );
}

const error = (status: number, name: string) =>
  Response.json({ ok: false, error: name }, {
    status,
    headers: { "cache-control": "no-store" },
  });
const missing = (operation: EngineeringReadOperation) =>
  operation === "engineering.job.status"
    ? "engineering_job_not_found"
    : "engineering_change_not_found";

/**
 * A returned HTTP response confirms a backend response, not a provider effect.
 * A thrown request/timeout must be handled by the gateway as executed:null;
 * it cannot know whether the passive SELECT ran. Do not retry a write here.
 */
export const engineeringReadTransportFailure = () => ({
  ok: false,
  error: "engineering_read_outcome_unknown",
  executed: null,
});

export async function normalizeEngineeringReadResponse(
  operation: EngineeringReadOperation,
  arguments_: unknown,
  response: Response,
): Promise<Response> {
  if (
    !isEngineeringReadOperation(operation) ||
    !validArguments(operation, arguments_)
  ) {
    return error(400, "invalid_engineering_read_arguments");
  }
  if (!response.ok) {
    // Never echo an upstream body or exception: it can contain private details.
    const status = response.status;
    if (status === 404) {
      let name = missing(operation);
      try {
        const rejected: unknown = await response.json();
        if (object(rejected) && rejected.error === "Change not found") {
          name = "engineering_change_not_found";
        }
      } catch {
        // Keep the fixed operation-specific classification; never echo a body.
      }
      return error(404, name);
    }
    if (status === 401) {
      return error(401, "engineering_control_authentication_failed");
    }
    if (status === 403) {
      return error(403, "engineering_control_authorisation_failed");
    }
    if (status === 400) {
      return error(400, "engineering_read_arguments_rejected");
    }
    if (status === 429) return error(429, "engineering_read_rate_limited");
    return error(
      status >= 400 && status <= 599 ? status : 502,
      "engineering_read_upstream_failed",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return error(502, "engineering_read_invalid_json");
  }
  if (!object(payload) || payload.ok === false || payload.error != null) {
    return error(502, "engineering_read_upstream_failed");
  }
  if (
    (operation === "engineering.change.get" && payload.change === null) ||
    (operation === "engineering.job.status" && payload.job === null)
  ) return error(404, missing(operation));
  let valid = false;
  if (operation === "engineering.change.list") {
    valid = exactFields(payload, ["changes"]) &&
      Array.isArray(payload.changes) &&
      payload.changes.length <= 100 && payload.changes.every(changeSummary);
  } else if (operation === "engineering.job.status") {
    valid = exactFields(payload, ["job"]) &&
      jobRecord(payload.job, arguments_.change_id, arguments_.job_id);
  } else {
    valid = exactFields(payload, [
      "change",
      "events",
      "artifacts",
      "tests",
      "rollbacks",
    ]) &&
      changeRecord(payload.change) &&
      sameId(payload.change.id, arguments_.change_id) &&
      Array.isArray(payload.events) && payload.events.length <= 200 &&
      payload.events.every((row) => eventRecord(row, arguments_.change_id)) &&
      Array.isArray(payload.artifacts) &&
      payload.artifacts.every((row) =>
        artifactRecord(row, arguments_.change_id)
      ) &&
      Array.isArray(payload.tests) &&
      payload.tests.every((row) => testRecord(row, arguments_.change_id)) &&
      Array.isArray(payload.rollbacks) &&
      payload.rollbacks.every((row) =>
        rollbackRecord(row, arguments_.change_id)
      );
  }
  if (!valid) {
    return error(502, "engineering_read_invalid_or_unscoped_response");
  }
  return Response.json({ ok: true, contract_version: "1.0.0", ...payload }, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
