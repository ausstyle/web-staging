/** Canonical job URL adapter. Classification is a scoped database read;
 * cancellation, retry and compensation execute only existing Sandy API handlers. */
import {
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import type { PolicyDb } from "./access_policy.ts";
import { operationRequestPath } from "./request_path.ts";

type Obj = Record<string, unknown>;
export type ApiJobAction = "get" | "events" | "cancel" | "retry" | "rollback";
export type ApiJobRoute = {
  jobId: string;
  action: ApiJobAction;
  after?: number;
  limit?: number;
  compensationApprovalId?: string;
};
export type ApiJobIdentity = {
  kind: "user" | "api_key" | "job_lease";
  actorId: string;
  channel: "api" | "mcp";
  tenantId?: string | null;
  credentialId?: string;
  allowedOperations?: readonly string[];
};
export type ResolvedApiJobRoute = {
  operation: string;
  arguments: Obj;
  jobId: string;
  jobKind: "durable" | "legacy";
};
export type JobRouteFailure = { ok: false; status: number; error: string };
export type JobRouteResult<T> = { ok: true; value: T } | JobRouteFailure;
const obj = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const op = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z][a-z0-9_.-]{2,100}$/.test(v);
const fail = (status: number, error: string): JobRouteFailure => ({
  ok: false,
  status,
  error,
});
const exact = (v: Obj, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));

/** Does not authenticate or access data. The caller must authenticate before
 * resolveApiJobRoute(), and must forward its trusted identity, never HTTP actor fields. */
export async function parseApiJobRoute(
  request: Request,
): Promise<JobRouteResult<ApiJobRoute | null>> {
  const url = new URL(request.url);
  const path = operationRequestPath(url.pathname);
  const match = path.match(
    /^\/v1\/jobs\/([^/:]+)(\/events|:(cancel|retry|rollback))?$/,
  );
  if (!match) return { ok: true, value: null };
  if (!uuid(match[1])) return fail(400, "invalid_job_id");
  const action: ApiJobAction = match[2] === "/events"
    ? "events"
    : (match[3] as ApiJobAction | undefined) ?? "get";
  const read = action === "get" || action === "events";
  if (request.method !== (read ? "GET" : "POST")) {
    return fail(405, "method_not_allowed");
  }
  const route: ApiJobRoute = { jobId: match[1].toLowerCase(), action };
  if (read) {
    if (
      [...url.searchParams.keys()].some((k) =>
        action !== "events" || !["after", "limit"].includes(k)
      )
    ) return fail(400, "invalid_job_query");
    for (const key of ["after", "limit"] as const) {
      const values = url.searchParams.getAll(key);
      if (values.length > 1) return fail(400, "invalid_job_query");
      if (values.length) {
        if (!/^[0-9]{1,16}$/.test(values[0])) {
          return fail(400, "invalid_event_cursor");
        }
        const value = Number(values[0]);
        if (
          !Number.isSafeInteger(value) || value < (key === "limit" ? 1 : 0) ||
          (key === "limit" && value > 200)
        ) return fail(400, "invalid_event_cursor");
        route[key] = value;
      }
    }
    return { ok: true, value: route };
  }
  if ([...url.searchParams.keys()].length) {
    return fail(400, "invalid_job_query");
  }
  let body: unknown;
  try {
    body = request.body === null
      ? {}
      : await requestJson(request.clone(), 8192);
  } catch (error) {
    return fail(
      error instanceof JsonRequestError ? error.status : 400,
      error instanceof JsonRequestError ? error.code : "invalid_job_request",
    );
  }
  if (
    !obj(body) ||
    !exact(body, action === "rollback" ? ["compensation_approval_id"] : [])
  ) return fail(400, "invalid_job_arguments");
  if (action === "rollback") {
    if (!uuid(body.compensation_approval_id)) {
      return fail(400, "compensation_approval_required");
    }
    route.compensationApprovalId = body.compensation_approval_id.toLowerCase();
  }
  return { ok: true, value: route };
}

const routes = {
  durable: {
    get: "orchestration.jobs.get",
    events: "orchestration.jobs.events",
    cancel: "orchestration.jobs.cancel",
    retry: "orchestration.jobs.retry",
    rollback: "system.lifecycle.compensate",
  },
  legacy: {
    get: "deployment.jobs.get",
    events: "deployment.jobs.events",
    cancel: "deployment.jobs.cancel",
    retry: "deployment.jobs.retry",
    rollback: "system.lifecycle.compensate",
  },
} as const;
const refusals: Record<string, number> = {
  job_not_found: 404,
  invalid_job_route: 400,
  ambiguous_job_id: 409,
  job_rollback_snapshot_required: 424,
  ambiguous_job_rollback_source: 409,
};
export async function resolveApiJobRoute(
  db: PolicyDb,
  identity: ApiJobIdentity,
  route: ApiJobRoute,
): Promise<JobRouteResult<ResolvedApiJobRoute>> {
  if (
    !uuid(identity.actorId) ||
    !["user", "api_key", "job_lease"].includes(identity.kind) ||
    !["api", "mcp"].includes(identity.channel) || identity.tenantId != null
  ) return fail(404, "job_not_found");
  if (
    !uuid(route.jobId) || !Object.hasOwn(routes.durable, route.action) ||
    (route.action === "rollback" && !uuid(route.compensationApprovalId)) ||
    (route.after !== undefined &&
      (!Number.isSafeInteger(route.after) || route.after < 0)) ||
    (route.limit !== undefined &&
      (!Number.isSafeInteger(route.limit) || route.limit < 1 ||
        route.limit > 200))
  ) return fail(400, "invalid_job_route");
  if (
    identity.kind !== "user" &&
    (!Array.isArray(identity.allowedOperations) ||
      !identity.allowedOperations.length ||
      identity.allowedOperations.length > 4096 ||
      !identity.allowedOperations.every(op))
  ) return fail(404, "job_not_found");
  if (
    identity.kind === "api_key" &&
    (!uuid(identity.credentialId) || !["get", "events"].includes(route.action))
  ) return fail(404, "job_not_found");
  let response;
  try {
    response = await db.rpc("sandy_api_resolve_job_route", {
      p_actor_id: identity.actorId,
      p_job_id: route.jobId.toLowerCase(),
      p_action: route.action,
      p_channel: identity.channel,
      p_credential_id: identity.kind === "api_key"
        ? identity.credentialId
        : null,
      p_allowed_operations: identity.kind === "user"
        ? null
        : identity.allowedOperations,
    });
  } catch {
    return fail(503, "job_routing_unavailable");
  }
  if (response.error || !obj(response.data)) {
    return fail(503, "job_routing_unavailable");
  }
  const data = response.data;
  if (data.ok !== true) {
    const status = typeof data.error === "string"
      ? refusals[data.error]
      : undefined;
    return status && data.http_status === status
      ? fail(status, String(data.error))
      : fail(503, "job_routing_response_invalid");
  }
  if (
    !exact(data, [
      "ok",
      "job_id",
      "job_kind",
      "operation",
      "source_request_id",
    ]) || data.job_id !== route.jobId.toLowerCase() ||
    !["durable", "legacy"].includes(String(data.job_kind))
  ) return fail(503, "job_routing_response_invalid");
  const kind = data.job_kind as "durable" | "legacy";
  const expected = routes[kind][route.action];
  if (
    data.operation !== expected ||
    (identity.kind !== "user" &&
      !identity.allowedOperations!.includes(expected))
  ) return fail(404, "job_not_found");
  const args: Obj = { job_id: route.jobId.toLowerCase() };
  if (route.action === "events") {
    if (kind === "legacy" && (route.after ?? 0) > 0) {
      return fail(422, "legacy_event_cursor_unavailable");
    }
    if (kind === "legacy" && route.limit !== undefined && route.limit > 100) {
      return fail(400, "legacy_event_limit_exceeded");
    }
    if (kind === "durable" && route.after !== undefined) {
      args.after = route.after;
    }
    if (route.limit !== undefined) args.limit = route.limit;
  }
  if (route.action === "rollback") {
    if (!uuid(data.source_request_id)) {
      return fail(503, "job_routing_response_invalid");
    }
    delete args.job_id;
    args.source_request_id = data.source_request_id;
    args.compensation_approval_id = route.compensationApprovalId;
  } else if (data.source_request_id !== undefined) {
    return fail(503, "job_routing_response_invalid");
  }
  return {
    ok: true,
    value: {
      operation: expected,
      arguments: args,
      jobId: route.jobId.toLowerCase(),
      jobKind: kind,
    },
  };
}

/** The callback must be the same authenticated catalogue/schema/admission/API
 * executor. This adapter never inserts jobs, dispatches providers or retries. */
export async function executeApiJobRoute(
  db: PolicyDb,
  identity: ApiJobIdentity,
  route: ApiJobRoute,
  executeCanonical: (operation: string, args: Obj) => Promise<Response>,
): Promise<Response> {
  const resolved = await resolveApiJobRoute(db, identity, route);
  if (!resolved.ok) {
    return Response.json(
      { ok: false, error: resolved.error, executed: false },
      { status: resolved.status, headers: { "cache-control": "no-store" } },
    );
  }
  // A lost callback reply is not permission to dispatch again.
  try {
    return await executeCanonical(
      resolved.value.operation,
      resolved.value.arguments,
    );
  } catch {
    return Response.json({
      ok: false,
      error: "canonical_job_outcome_unknown",
      executed: null,
      reconciliation_required: true,
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
