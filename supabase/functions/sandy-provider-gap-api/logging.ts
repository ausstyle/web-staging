/** Bounded metadata-only query for the existing engineering canary log namespace.
 * No caller filter/resource selector, log payload, identity or signed URL output.
 * This source contract does not grant access or provide general log export.
 */
import { GCP_PROJECT, type Obj } from "./contracts.ts";
import { Calls, fail, list, obj } from "./runtime.ts";
const severities = [
  "DEFAULT",
  "DEBUG",
  "INFO",
  "NOTICE",
  "WARNING",
  "ERROR",
  "CRITICAL",
  "ALERT",
  "EMERGENCY",
];
function instant(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) return fail("invalid_log_time_window", 400);
  const parsed = Date.parse(value);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !==
      (value.includes(".") ? value : value.replace("Z", ".000Z"))
  ) return fail("invalid_log_time_window", 400);
  return parsed;
}
export async function executeLogging(args: Obj, calls: Calls, now: number) {
  if (
    Object.keys(args).some((k) =>
      !["log_id", "start", "end", "limit"].includes(k)
    ) || typeof args.log_id !== "string" ||
    !/^sandy-engineering-canary(?:[-_][a-z0-9_-]{1,64})?$/.test(args.log_id)
  ) return fail("invalid_log_target", 400);
  const start = instant(args.start),
    end = instant(args.end),
    limit = args.limit ?? 25;
  if (
    !Number.isFinite(now) || start >= end || end - start > 900000 ||
    start < now - 7 * 86400000 || end > now || !Number.isInteger(limit) ||
    Number(limit) < 1 || Number(limit) > 100
  ) return fail("invalid_log_time_window", 400);
  const logName = `projects/${GCP_PROJECT}/logs/${args.log_id}`;
  const reply = await calls.request(
    new URL("https://logging.googleapis.com/v2/entries:list"),
    "POST",
    {
      resourceNames: [`projects/${GCP_PROJECT}`],
      filter: `logName="${logName}" AND timestamp >= "${
        new Date(start).toISOString()
      }" AND timestamp < "${new Date(end).toISOString()}"`,
      orderBy: "timestamp desc",
      pageSize: limit,
    },
  );
  const body = obj(reply.body);
  if (
    body.nextPageToken !== undefined &&
    (typeof body.nextPageToken !== "string" || body.nextPageToken.length > 4096)
  ) return fail("provider_response_schema_mismatch", 502);
  const entries = list(body.entries ?? [], Number(limit)).map((value) => {
    const e = obj(value), resource = obj(e.resource);
    if (
      e.logName !== logName || typeof e.timestamp !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(e.timestamp)
    ) return fail("provider_log_scope_mismatch", 502);
    const timestamp = Date.parse(e.timestamp);
    if (
      !Number.isFinite(timestamp) || timestamp < start || timestamp >= end ||
      !severities.includes(String(e.severity ?? "DEFAULT")) ||
      typeof resource.type !== "string" ||
      !/^[a-z][a-z0-9_]{0,99}$/.test(resource.type)
    ) return fail("provider_log_scope_mismatch", 502);
    if (resource.labels !== undefined) {
      const labels = obj(resource.labels);
      if (
        labels.project_id !== undefined && labels.project_id !== GCP_PROJECT
      ) return fail("provider_log_scope_mismatch", 502);
    }
    return {
      timestamp: e.timestamp,
      severity: e.severity ?? "DEFAULT",
      resource_type: resource.type,
    };
  });
  return {
    result: {
      project_id: GCP_PROJECT,
      log_id: args.log_id,
      entries,
      payloads_disclosed: false,
      continuation_available: !!body.nextPageToken,
    },
    truncated: !!body.nextPageToken,
  };
}
