// Customer-scoped Gmail drafts and exactly-once send attempts. Provider reads may
// be retried; a send that was attempted is never automatically repeated.
export const isGmailAction = (text: string) => /\b(send|draft|compose|reply|forward|write)\b/i.test(text) || /^(?:(?:please|can you|could you|would you)\s+)?email\b/i.test(text);
export const validGmailDraft = (to: string, subject: string, body: string) =>
  to.length <= 254 && /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/.test(to) &&
  !!subject && subject.length <= 300 && !/[\r\n]/.test(subject) && !!body && body.length <= 12000;
const personal = (workspace: string) => ["", "personal", "private", "personal (private)"].includes(workspace.trim().toLowerCase());
const unpack = (body: any) => body?.data?.response_data || body?.data?.data || body?.data || {};
const messageId = (data: any) => {
  const id = data?.messageId || data?.id || data?.message_id;
  return typeof id === "string" && /^[a-f0-9]{8,64}$/i.test(id) ? id : null;
};
const stamp = () => new Date().toISOString();
const result = (text: string, details: any = {}) => ({text, ...details});
const uncertain = (details: any = {}) => result("Gmail's send result is not yet independently verified. I will not send this draft again. Check Gmail Sent Mail; confirming this draft again only checks an existing receipt.", {state: "unknown", ...details});

export async function prepareConnectedGmail(db: any, customerId: string, args: any) {
  const to = String(args.to || "").trim(), subject = String(args.subject || "").trim(), body = String(args.body || "").trim();
  const workspace = String(args.workspace || "").trim().toLowerCase(), accountId = String(args.account_id || "").trim();
  if (!validGmailDraft(to, subject, body)) return {error: "invalid_email_draft", detail: "Use one email address, a single-line subject and a non-empty body."};
  const enabled = await db.from("sandy_ai_integrations").select("enabled").eq("integration_key", "composio_connector").maybeSingle();
  if (enabled.error || !enabled.data?.enabled) return {error: enabled.error ? "gmail_configuration_lookup_failed" : "gmail_connector_disabled"};
  const accounts = await db.from("sandy_composio_connections").select("connected_account_id,company_id").eq("customer_id", customerId).eq("toolkit_slug", "gmail").in("status", ["ACTIVE", "active"]).limit(100);
  if (accounts.error) return {error: "gmail_connection_lookup_failed"};
  let companyId: string | null = null;
  if (!personal(workspace)) {
    const companies = await db.from("sandy_agenda_companies").select("id,name").eq("customer_id", customerId);
    if (companies.error) return {error: "workspace_lookup_failed"};
    const selected = (companies.data || []).filter((x: any) => String(x.name).trim().toLowerCase() === workspace);
    if (selected.length !== 1) return {error: selected.length ? "ambiguous_workspace" : "workspace_not_found"};
    companyId = selected[0].id;
  }
  let candidates = (accounts.data || []).filter((x: any) => (x.company_id || null) === companyId);
  if (accountId) candidates = candidates.filter((x: any) => x.connected_account_id === accountId);
  if (candidates.length !== 1) return {error: candidates.length ? "multiple_gmail_accounts_select_account" : "gmail_account_not_connected_for_workspace", account_ids: candidates.map((x: any) => x.connected_account_id)};
  const saved = await db.from("sandy_connected_gmail_outbox").insert({customer_id: customerId, connected_account_id: candidates[0].connected_account_id, workspace_company_id: companyId, recipient: to, subject, body_text: body}).select("id").single();
  return saved.error || !saved.data ? {error: "draft_save_failed"} : {ok: true, awaiting_confirmation: true, draft_id: saved.data.id, to, subject, body, workspace: companyId ? workspace : "Personal", account_id: candidates[0].connected_account_id, instruction: "To send this exact email, reply: Confirm send " + saved.data.id};
}

export async function confirmConnectedGmail(db: any, customerId: string, draftId: string, apiKey: string, fetcher: typeof fetch = fetch) {
  const existing = await db.from("sandy_connected_gmail_outbox").select("id,status,connected_account_id,workspace_company_id,recipient,subject,body_text,provider_result").eq("id", draftId).eq("customer_id", customerId).maybeSingle();
  if (existing.error || !existing.data) return result("I could not find an available Gmail draft belonging to you. No email was sent.", {state: "unavailable"});
  let draft = existing.data;
  if (draft.status === "sent") {
    const id = messageId({id: draft.provider_result?.message_id});
    if (!id || draft.provider_result?.sent_mail_verified !== true) return result("This draft is recorded as sent, but its receipt was not independently verified. I have not sent it again. Check the connected Gmail account's Sent Mail.", {state: "recorded_sent_unverified", duplicate_prevented: true, message_id: id, sent_mail_verified: false});
    return result("This email was already sent to " + draft.recipient + " with subject \"" + draft.subject + "\". I have not sent it again.", {state: "sent", success: true, duplicate_prevented: true, message_id: id, sent_mail_verified: true});
  }
  if (!["awaiting_confirmation", "sending"].includes(draft.status)) return result("This draft is " + draft.status + " and cannot be sent again. No new send was attempted.", {state: draft.status});
  if (!validGmailDraft(draft.recipient, draft.subject, draft.body_text)) return result("The saved draft contains an invalid recipient, subject or body. No email was sent.", {state: "invalid_draft"});
  const enabled = await db.from("sandy_ai_integrations").select("enabled").eq("integration_key", "composio_connector").maybeSingle();
  if (enabled.error || !enabled.data?.enabled || !apiKey) return result("Gmail sending is currently unavailable because its connector configuration could not be verified. No new send was attempted.", {state: "unavailable"});
  const account = await db.from("sandy_composio_connections").select("connected_account_id,company_id").eq("customer_id", customerId).eq("connected_account_id", draft.connected_account_id).eq("toolkit_slug", "gmail").in("status", ["ACTIVE", "active"]).maybeSingle();
  if (account.error || !account.data || (account.data.company_id || null) !== (draft.workspace_company_id || null)) return result("The draft's Gmail account is no longer verified as active in the same workspace. No new send was attempted. Reconnect or prepare a new draft in the correct workspace.", {state: "connection_unavailable"});
  const save = async (status: string, receipt: any) => {
    const saved = await db.from("sandy_connected_gmail_outbox").update({status, provider_result: receipt, updated_at: stamp()}).eq("id", draftId).eq("customer_id", customerId).eq("status", "sending").select("id").maybeSingle();
    return !saved.error && !!saved.data;
  };
  const execute = async (slug: string, args: any) => {
    const response = await fetcher("https://backend.composio.dev/api/v3/tools/execute/" + slug, {method: "POST", headers: {"x-api-key": apiKey, "content-type": "application/json"}, body: JSON.stringify({connected_account_id: draft.connected_account_id, user_id: "sandy_customer_" + customerId, version: "20261015_00", arguments: {user_id: "me", ...args}}), signal: AbortSignal.timeout(35000)});
    return {response, body: await response.json().catch(() => ({}))};
  };
  let receipt = draft.provider_result || {};
  if (draft.status === "awaiting_confirmation") {
    const claim = await db.from("sandy_connected_gmail_outbox").update({status: "sending", provider_result: {state: "unknown", send_started_at: stamp()}, updated_at: stamp()}).eq("id", draftId).eq("customer_id", customerId).eq("status", "awaiting_confirmation").select("id,status,connected_account_id,workspace_company_id,recipient,subject,body_text").maybeSingle();
    if (claim.error || !claim.data) return result("This draft is already being processed or is no longer available. I have not initiated another send.", {state: "sending", duplicate_prevented: true});
    draft = claim.data;
    try {
      const sent = await execute("GMAIL_SEND_EMAIL", {recipient_email: draft.recipient, subject: draft.subject, body: draft.body_text, is_html: false, include_signature: false});
      const id = messageId(unpack(sent.body));
      if (!sent.response.ok || sent.body.successful !== true || sent.body.error != null || !id) {
        const rejected = [400, 401, 403, 404, 422].includes(sent.response.status) && sent.body.successful !== true && !id;
        const providerError = String(sent.body.error || "provider_receipt_not_verified").slice(0, 500);
        await save(rejected ? "failed" : "sending", {state: rejected ? "rejected" : "unknown", provider_status: sent.response.status, error: providerError, message_id: id, checked_at: stamp()});
        if (rejected) return result("Gmail rejected the send request. The email has not been marked sent. Check the connected account's Gmail sending permissions before preparing a new draft.", {state: "failed", provider_status: sent.response.status});
        return uncertain({message_id: id, provider_status: sent.response.status});
      }
      receipt = {state: "awaiting_sent_verification", successful: true, message_id: id, connected_account_id: draft.connected_account_id, provider_accepted_at: stamp()};
      if (!await save("sending", receipt)) return uncertain({message_id: id, receipt_save_failed: true});
    } catch {
      await save("sending", {state: "unknown", error: "send_response_interrupted", checked_at: stamp()});
      return uncertain();
    }
  }
  const id = messageId({id: receipt.message_id});
  if (!id) return uncertain({duplicate_prevented: true});
  try {
    const readback = await execute("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {message_id: id, format: "metadata"});
    const message = unpack(readback.body), headers = Array.isArray(message.payload?.headers) ? message.payload.headers : Array.isArray(message.headers) ? message.headers : [];
    const header = (name: string) => headers.filter((x: any) => String(x.name).toLowerCase() === name).map((x: any) => String(x.value || "")).join(", ");
    const labels = message.labelIds || message.label_ids || message.labels || [];
    const subject = message.subject ?? header("subject");
    const to = header("to") || (Array.isArray(message.to) ? message.to.map((x: any) => typeof x === "string" ? x : x.email || x.address || "").join(", ") : String(message.to || ""));
    const addresses = (to.match(/[^\s<>,;]+@[^\s<>,;]+/g) || []).map((x: string) => x.toLowerCase());
    const verified = readback.response.ok && readback.body.successful === true && readback.body.error == null && messageId(message) === id && Array.isArray(labels) && labels.includes("SENT") && subject === draft.subject && addresses.includes(draft.recipient.toLowerCase());
    if (!verified) {
      await save("sending", {...receipt, state: "unknown", sent_mail_verified: false, verification_status: readback.response.status, checked_at: stamp()});
      return uncertain({message_id: id});
    }
    const persisted = await save("sent", {...receipt, state: "sent", sent_mail_verified: true, verification_tool: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", verified_at: stamp()});
    if (!persisted) return uncertain({message_id: id, receipt_save_failed: true});
    return result("Sent from your connected Gmail account to " + draft.recipient + ". Subject: " + draft.subject + ". I verified the message in that account's Sent Mail.", {state: "sent", success: true, message_id: id, sent_mail_verified: true});
  } catch {
    await save("sending", {...receipt, state: "unknown", sent_mail_verified: false, error: "sent_verification_interrupted", checked_at: stamp()});
    return uncertain({message_id: id});
  }
}
