/** Reuse the existing voice session, link and private-verification records.
 * Long-running Executive turns must recheck revocation before each operation
 * and before handing private results back to the audio adapter.
 */
export async function currentVoiceSource(db: any, sessionId: string, customerId: string, now = Date.now()): Promise<boolean> {
  const session = await db.from("sandy_voice_call_sessions").select("id,owner_customer_id,link_id,created_at,ended_at,state")
    .eq("id", sessionId).eq("owner_customer_id", customerId).maybeSingle();
  const row = session.data;
  if (session.error || !row || row.ended_at || ["ended", "failed"].includes(row.state) ||
      !Number.isFinite(Date.parse(row.created_at)) || now - Date.parse(row.created_at) > 35 * 60000 || Date.parse(row.created_at) > now + 60000) return false;
  const [link, auth] = await Promise.all([
    db.from("sandy_voice_call_links").select("id,owner_customer_id,revoked_at").eq("id", row.link_id).eq("owner_customer_id", customerId).maybeSingle(),
    db.from("sandy_voice_private_auth").select("verified_at").eq("session_id", sessionId).eq("owner_customer_id", customerId).maybeSingle(),
  ]);
  return !link.error && !!link.data && !link.data.revoked_at && !auth.error && !!auth.data?.verified_at;
}
