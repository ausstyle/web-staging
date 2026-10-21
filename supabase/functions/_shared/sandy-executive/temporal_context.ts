type Row = Record<string, any>;
type Status = "available" | "partial" | "disabled" | "unavailable";
type Bundle = {
  status: Status;
  coverage: "bounded_current_temporal_projection";
  read_limit: number;
  facts: Row[];
  omitted: number;
  reason: string | null;
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): value is Row =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= limit;
const timestamp = (value: unknown) =>
  typeof value === "string" ? Date.parse(value) : NaN;
const envelope = (status: Status, reason: string | null): Bundle => ({
  status,
  coverage: "bounded_current_temporal_projection",
  read_limit: 40,
  facts: [],
  omitted: 0,
  reason,
});

/** Format only the already authorized existing temporal projection. No search
 * index, memory writer, inferred identity or correction ledger is created here.
 * The RPC remains authoritative for current/superseded assertions. Whole facts
 * retain their subject and source; a size limit never cuts JSON or provenance. */
export function temporalContextBundle(
  customerId: string,
  rows: unknown,
  at: number,
  maxChars = 9500,
): Bundle {
  if (
    !uuid(customerId) || !Number.isFinite(at) || !Number.isInteger(maxChars) ||
    maxChars < 512 || maxChars > 9500 || !Array.isArray(rows)
  ) {
    return envelope("unavailable", "temporal_projection_invalid");
  }
  const result = envelope("available", null);
  // Mirror the inspected RPC's supersession semantics defensively, including a
  // recorded rejection. A foreign row cannot suppress this customer's facts.
  const superseded = new Set(
    rows.filter((r) =>
      object(r) && r.customer_id === customerId &&
      timestamp(r.recorded_at) <= at && uuid(r.supersedes_id)
    ).map((r) => r.supersedes_id),
  );
  for (const row of rows.slice(0, 40)) {
    if (
      !object(row) || row.customer_id !== customerId || !uuid(row.id) ||
      superseded.has(row.id) ||
      !["confirmed", "observed", "inferred"].includes(row.state) ||
      !["none", "approved"].includes(row.review_status) ||
      row.sensitivity !== "normal" ||
      !["private", "shared"].includes(row.access_scope) ||
      !text(row.subject_type, 60) || !text(row.subject_id, 180) ||
      !text(row.predicate, 140) ||
      !text(row.source_channel, 48) || !text(row.source_ref, 320) ||
      typeof row.confidence !== "number" || !Number.isFinite(row.confidence) ||
      row.confidence < 0 || row.confidence > 1 ||
      !(timestamp(row.recorded_at) <= at) ||
      !(timestamp(row.observed_at) <= at) ||
      (row.valid_from != null && !(timestamp(row.valid_from) <= at)) ||
      (row.valid_until != null && !(timestamp(row.valid_until) > at)) ||
      (row.expires_at != null && !(timestamp(row.expires_at) > at))
    ) {
      result.omitted++;
      continue;
    }
    const fact = {
      id: row.id,
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      predicate: row.predicate,
      value: row.value,
      state: row.state,
      confidence: row.confidence,
      access_scope: row.access_scope,
      observed_at: row.observed_at,
      recorded_at: row.recorded_at,
      valid_from: row.valid_from ?? null,
      valid_until: row.valid_until ?? null,
      expires_at: row.expires_at ?? null,
      supersedes_id: row.supersedes_id ?? null,
      source_channel: row.source_channel,
      source_ref: row.source_ref,
    };
    try {
      if (
        row.value === undefined ||
        JSON.stringify(fact).length > maxChars - 256 ||
        JSON.stringify({
            ...result,
            status: "partial",
            reason: "context_policy_or_budget_omissions",
            facts: [...result.facts, fact],
            omitted: rows.length,
          }).length > maxChars
      ) {
        result.omitted++;
        continue;
      }
      result.facts.push(fact);
    } catch {
      result.omitted++;
    }
  }
  result.omitted += Math.max(0, rows.length - 40);
  if (result.omitted || rows.length >= 40) {
    result.status = "partial";
    result.reason = "context_policy_or_budget_omissions";
  }
  return result;
}

/** Web canary only. The caller supplies its existing bound customer, never an
 * identity extracted from a prompt. Check current memory consent before reading
 * and again before returning; failures disclose unavailable coverage, not zero
 * stored memories. Learning permission is separate from reading existing facts. */
export async function loadTemporalContext(
  customerId: string,
  db: any,
  at = Date.now(),
): Promise<Bundle> {
  if (!uuid(customerId) || !Number.isFinite(at)) {
    return envelope("unavailable", "memory_customer_binding_invalid");
  }
  const settings = () =>
    db.from("sandy_memory_settings").select("enabled,consent_at,updated_at").eq(
      "customer_id",
      customerId,
    ).maybeSingle();
  try {
    const before = await settings();
    if (before.error || !object(before.data)) {
      return envelope("unavailable", "memory_settings_unavailable");
    }
    if (before.data.enabled === false) {
      return envelope("disabled", "memory_disabled");
    }
    if (
      before.data.enabled !== true ||
      !(timestamp(before.data.consent_at) <= at) ||
      !(timestamp(before.data.updated_at) <= at)
    ) return envelope("unavailable", "memory_consent_unverified");
    const projection = await db.rpc("sandy_temporal_current", {
      p_customer_id: customerId,
      p_at: new Date(at).toISOString(),
      p_limit: 40,
    });
    if (projection.error || !Array.isArray(projection.data)) {
      return envelope("unavailable", "temporal_projection_unavailable");
    }
    const after = await settings();
    if (
      after.error || after.data?.enabled !== true ||
      after.data?.consent_at !== before.data.consent_at ||
      after.data?.updated_at !== before.data.updated_at
    ) return envelope("unavailable", "memory_settings_changed");
    return temporalContextBundle(customerId, projection.data, at);
  } catch {
    return envelope("unavailable", "temporal_context_unavailable");
  }
}
