type Row = Record<string, any>;
const object = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
const correctionsSignature = (rows: Row[]) => JSON.stringify(rows.map(row => [row.id, row.rejected_value, row.corrected_value, row.rejected_at]));

/** The existing narrow, current-memory lookup. Historical search remains a
 * separate operation. Never infer consent from a customer binding or a prompt.
 * Read-time checks keep forgotten/rejected snippets out even while indexes lag.
 * Literal rejection matching is conservative, not semantic contradiction proof. */
export async function loadRuntimeMemory(customerId: string, query: unknown, db: any, at = Date.now()): Promise<Row> {
  if (!uuid(customerId) || typeof query !== "string" || query.trim().length < 3 || query.length > 180 || !Number.isFinite(at)) return { error: "memory_lookup_input_invalid" };
  const settings = () => db.from("sandy_memory_settings").select("enabled,consent_at,updated_at").eq("customer_id", customerId).maybeSingle();
  const corrections = () => db.from("sandy_memory_rejected_facts").select("id,rejected_value,corrected_value,rejected_at").eq("customer_id", customerId).order("id", { ascending: true }).limit(201);
  try {
    const before = await settings();
    if (before.error || !object(before.data)) return { error: "memory_settings_unavailable" };
    if (before.data.enabled === false) return { error: "memory_disabled" };
    if (before.data.enabled !== true || !(Date.parse(before.data.consent_at) <= at) || !(Date.parse(before.data.updated_at) <= at)) return { error: "memory_consent_unverified" };
    const rejected = await corrections();
    if (rejected.error || !Array.isArray(rejected.data) || rejected.data.length > 200 || rejected.data.some((r: any) => !object(r) || !uuid(r.id) || typeof r.rejected_value !== "string" || !(Date.parse(r.rejected_at) <= at))) return { error: "memory_correction_coverage_unavailable" };
    // Escape SQL LIKE metacharacters instead of removing identifier characters:
    // a request for "___" must not silently become an unrestricted "%%" query.
    const literal = query.trim().replace(/[\\%_]/g, "\\$&");
    const found = await db.from("sandy_memory_archive").select("id,owner_customer_id,state,channel,content,occurred_at").eq("owner_customer_id", customerId).eq("state", "active").ilike("content", "%" + literal + "%").order("occurred_at", { ascending: false }).limit(5);
    if (found.error || !Array.isArray(found.data)) return { error: "memory_lookup_unavailable" };
    if (found.data.some((r: any) => !object(r) || !uuid(r.id) || r.owner_customer_id !== customerId || r.state !== "active" || typeof r.channel !== "string" || !r.channel || r.channel.length > 100 || typeof r.content !== "string")) return { error: "memory_lookup_unscoped_response" };
    const ids = found.data.map((r: Row) => r.id);
    // Verify current base rows, not an old search response, immediately before
    // returning excerpts. Forgetting or source edits during lookup fail closed.
    const current = ids.length ? await db.from("sandy_memory_archive").select("id,owner_customer_id,state,channel,content,occurred_at").eq("owner_customer_id", customerId).eq("state", "active").in("id", ids).limit(5) : { data: [], error: null };
    if (current.error || !Array.isArray(current.data) || current.data.length !== ids.length || found.data.some((row: Row) => !current.data.some((r: Row) => ["id", "owner_customer_id", "state", "channel", "content", "occurred_at"].every(key => r[key] === row[key])))) return { error: "memory_source_changed" };
    const afterRejected = await corrections();
    if (afterRejected.error || !Array.isArray(afterRejected.data) || correctionsSignature(afterRejected.data) !== correctionsSignature(rejected.data)) return { error: "memory_corrections_changed" };
    const after = await settings();
    if (after.error || after.data?.enabled !== true || after.data?.consent_at !== before.data.consent_at || after.data?.updated_at !== before.data.updated_at) return { error: "memory_settings_changed" };
    const prohibited = rejected.data.map((r: Row) => normalize(r.rejected_value)).filter(Boolean);
    return { records: found.data.filter((r: Row) => !prohibited.some((value: string) => normalize(r.content).includes(value))).map((r: Row) => ({ id: r.id, channel: r.channel, content: r.content.slice(0, 900), occurred_at: r.occurred_at })) };
  } catch { return { error: "memory_lookup_unavailable" }; }
}
