import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
/** Fixed production adapters. Provider submissions never certify delivery/payment. */
import type { ProductOperation } from "./contracts.ts";
type Obj = Record<string, unknown>;
export type ProviderResult = {
  outcome: "succeeded" | "accepted" | "failed" | "unknown";
  httpStatus: number | null;
  result: Obj;
  privateContext?: Obj;
  error?: string;
  responseStatus?: number;
  executed?: boolean | null;
};
export type ProviderDependencies = {
  base: string;
  service: string;
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
};
export const GRAPH_MAILBOX = "ai@email.com.au";
export const WHATSAPP_PHONE = "1360367063825981";
const graphBase = "https://graph.microsoft.com/v1.0/users/" +
  encodeURIComponent(GRAPH_MAILBOX);
const metaBase = "https://graph.facebook.com/v25.0/";
const obj = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const enc = (v: unknown) => encodeURIComponent(String(v));
export function emptyResult(): Obj {
  return {
    item: null,
    items: [],
    changed: false,
    next_cursor: null,
    possibly_truncated: false,
    provider_id: null,
    provider_http_status: null,
    delivery_verified: false,
  };
}
export class ProviderFailure extends Error {
  constructor(
    public code: string,
    public status: number | null = null,
    public uncertain = false,
    public providerId: string | null = null,
  ) {
    super(code);
  }
}
async function bytes(response: Response, limit = 400000): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length") || 0) > limit) {
    await response.body?.cancel();
    throw new ProviderFailure("provider_response_limit", response.status, true);
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new ProviderFailure(
          "provider_response_limit",
          response.status,
          true,
        );
      }
      chunks.push(r.value);
    }
    const result = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      result.set(c, at);
      at += c.length;
    }
    return result;
  } finally {
    reader.releaseLock();
  }
}
async function call(
  deps: ProviderDependencies,
  url: string,
  token: string,
  method = "GET",
  body?: unknown,
  extra: Obj = {},
): Promise<{ status: number; data: Obj }> {
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method,
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ProviderFailure(
      "provider_transport_unknown",
      null,
      method !== "GET",
    );
  }
  const raw = await bytes(response);
  let data: unknown = {};
  try {
    if (raw.length) data = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ProviderFailure(
      "provider_invalid_response",
      response.status,
      method !== "GET",
    );
  }
  if (!response.ok) {
    throw new ProviderFailure(
      "provider_request_rejected",
      response.status,
      response.status >= 500 && method !== "GET",
    );
  }
  if (!obj(data)) {
    throw new ProviderFailure(
      "provider_invalid_response",
      response.status,
      method !== "GET",
    );
  }
  return { status: response.status, data };
}
export function missingProviderConfiguration(
  op: ProductOperation,
  deps: ProviderDependencies,
): string[] {
  const keys = op.executor === "graph"
    ? ["MS_GRAPH_TENANT_ID", "MS_GRAPH_CLIENT_ID", "MS_GRAPH_CLIENT_SECRET"]
    : op.executor === "whatsapp"
    ? [
      "WHATSAPP_ACCESS_TOKEN",
      ...((op.operation.startsWith("whatsapp.templates.") ||
          op.operation === "whatsapp.account.get")
        ? ["WHATSAPP_BUSINESS_ACCOUNT_ID"]
        : []),
    ]
    : op.executor === "legacy_invoice"
    ? [
      "EMAIL_AI_INTERNAL_KEY",
      "SANDY_INVOICE_FORWARD_CUSTOMER_ID",
      "MS_GRAPH_TENANT_ID",
      "MS_GRAPH_CLIENT_ID",
      "MS_GRAPH_CLIENT_SECRET",
    ]
    : [];
  return keys.filter((k) =>
    !deps.env(k) &&
    !(k === "WHATSAPP_BUSINESS_ACCOUNT_ID" && deps.env("WHATSAPP_WABA_ID"))
  );
}
async function graphToken(deps: ProviderDependencies): Promise<string> {
  const tenant = deps.env("MS_GRAPH_TENANT_ID") || "";
  if (!/^[a-zA-Z0-9.-]+$/.test(tenant)) {
    throw new ProviderFailure("provider_configuration_required");
  }
  let response: Response;
  try {
    response = await deps.fetch(
      "https://login.microsoftonline.com/" + enc(tenant) + "/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: deps.env("MS_GRAPH_CLIENT_ID") || "",
          client_secret: deps.env("MS_GRAPH_CLIENT_SECRET") || "",
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    throw new ProviderFailure("provider_authentication_unavailable");
  }
  let token: unknown;
  try {
    token = JSON.parse(new TextDecoder().decode(await bytes(response, 30000)));
  } catch {
    throw new ProviderFailure("provider_authentication_unavailable");
  }
  if (!response.ok || !obj(token) || typeof token.access_token !== "string") {
    throw new ProviderFailure(
      "provider_authentication_unavailable",
      response.status,
    );
  }
  return token.access_token;
}
const publicMessage = (m: Obj): Obj =>
  Object.fromEntries(
    [
      "id",
      "subject",
      "body",
      "bodyPreview",
      "isRead",
      "isDraft",
      "internetMessageId",
      "from",
      "sender",
      "replyTo",
      "toRecipients",
      "ccRecipients",
      "receivedDateTime",
      "sentDateTime",
      "categories",
      "parentFolderId",
    ].filter((k) => k in m).map((k) => [k, m[k]]),
  );
const assertMessage = (m: Obj, c: Obj) => {
  if (
    typeof m.id !== "string" ||
    c.internet_message_id && m.internetMessageId !== c.internet_message_id
  ) throw new ProviderFailure("provider_message_binding_mismatch");
};
const draftRecipients = (c: Obj): string[] =>
  Array.isArray(c.recipients) && c.recipients.length
    ? c.recipients.map(String)
    : [String(c.recipient)];
const recipientAddresses = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((v) =>
      obj(v) && obj(v.emailAddress)
        ? String(v.emailAddress.address || "").toLowerCase()
        : ""
    )
    : [];
const assertDraft = (m: Obj, c: Obj) => {
  const from = obj(m.from) && obj(m.from.emailAddress)
    ? String(m.from.emailAddress.address || "").toLowerCase()
    : "";
  const sender = obj(m.sender) && obj(m.sender.emailAddress)
    ? String(m.sender.emailAddress.address || "").toLowerCase()
    : from;
  if (
    from !== GRAPH_MAILBOX || sender !== GRAPH_MAILBOX ||
    recipientAddresses(m.replyTo).some((v) => v !== GRAPH_MAILBOX)
  ) throw new ProviderFailure("provider_draft_sender_binding_mismatch", 409);
  const expected = draftRecipients(c).map((v) => v.toLowerCase()).sort();
  const actual = [
    ...recipientAddresses(m.toRecipients),
    ...recipientAddresses(m.ccRecipients),
  ].sort();
  if (
    !Array.isArray(m.toRecipients) || expected.length < 1 ||
    expected.length > 21 || actual.some((v) => !v) ||
    new Set(actual).size !== actual.length ||
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    recipientAddresses(m.bccRecipients).length
  ) throw new ProviderFailure("provider_draft_recipient_binding_mismatch");
};
const draftAttachmentMetadata = (m: Obj): Obj[] =>
  Array.isArray(m.attachments)
    ? m.attachments.map((a) =>
      obj(a)
        ? Object.fromEntries(
          ["id", "name", "contentType", "size", "isInline", "@odata.type"]
            .filter((k) => k in a).map((k) => [k, a[k]]),
        )
        : {}
    ).sort((a, b) => String(a.id).localeCompare(String(b.id)))
    : [];
async function draftReviewHash(m: Obj): Promise<string> {
  if (
    typeof m.changeKey !== "string" || !m.changeKey ||
    !Array.isArray(m.attachments) || m.attachments.length > 100 ||
    m["attachments@odata.nextLink"] || m["@odata.nextLink"] ||
    m.attachments.some((a) =>
      !obj(a) || a["@odata.type"] !== "#microsoft.graph.fileAttachment" ||
      typeof a.id !== "string" || typeof a.name !== "string" ||
      typeof a.size !== "number"
    )
  ) throw new ProviderFailure("draft_review_unavailable", 424);
  return await argumentDigest({
    subject: m.subject ?? "",
    from: m.from ?? null,
    sender: m.sender ?? null,
    replyTo: recipientAddresses(m.replyTo).sort(),
    body: m.body ?? null,
    to: recipientAddresses(m.toRecipients).sort(),
    cc: recipientAddresses(m.ccRecipients).sort(),
    bcc: recipientAddresses(m.bccRecipients).sort(),
    attachments: draftAttachmentMetadata(m),
    changeKey: m.changeKey,
  });
}
export function validDeltaUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "graph.microsoft.com" &&
      !u.port && !u.username && !u.password && !u.hash &&
      decodeURIComponent(u.pathname) ===
        "/v1.0/users/" + GRAPH_MAILBOX + "/messages/delta";
  } catch {
    return false;
  }
}
function graphPageQuery(args: Obj): string {
  if (args.cursor === undefined) return "";
  let c: unknown;
  try {
    c = JSON.parse(atob(String(args.cursor)));
  } catch {
    throw new ProviderFailure("invalid_provider_cursor", 400);
  }
  if (
    !obj(c) || Object.keys(c).some((k) => !["skip", "skiptoken"].includes(k)) ||
    Object.keys(c).length !== 1
  ) throw new ProviderFailure("invalid_provider_cursor", 400);
  if (
    typeof c.skip === "number" && Number.isSafeInteger(c.skip) && c.skip >= 0 &&
    c.skip <= 1000000000
  ) return "&$skip=" + c.skip;
  if (
    typeof c.skiptoken === "string" && c.skiptoken.length > 0 &&
    c.skiptoken.length <= 2800
  ) return "&$skiptoken=" + enc(c.skiptoken);
  throw new ProviderFailure("invalid_provider_cursor", 400);
}
function graphCursor(data: Obj): string | null {
  const next = data["@odata.nextLink"];
  if (!next) return null;
  let url: URL;
  try {
    url = new URL(String(next));
  } catch {
    throw new ProviderFailure("provider_pagination_contract");
  }
  if (
    url.protocol !== "https:" || url.hostname !== "graph.microsoft.com" ||
    url.port || url.username || url.password
  ) throw new ProviderFailure("provider_pagination_contract");
  const skip = url.searchParams.get("$skip"),
    token = url.searchParams.get("$skiptoken");
  if (skip !== null && /^[0-9]{1,10}$/.test(skip)) {
    return btoa(JSON.stringify({ skip: Number(skip) }));
  }
  if (token && token.length <= 2800 && /^[\x20-\x7e]+$/.test(token)) {
    return btoa(JSON.stringify({ skiptoken: token }));
  }
  throw new ProviderFailure("provider_pagination_contract");
}
async function graph(
  op: ProductOperation,
  args: Obj,
  c: Obj,
  deps: ProviderDependencies,
): Promise<ProviderResult> {
  const token = await graphToken(deps);
  const get = (path: string, method = "GET", body?: unknown) =>
    call(deps, graphBase + path, token, method, body, {
      Prefer: 'IdType="ImmutableId"',
    });
  let response: { status: number; data: Obj };
  let result = emptyResult();
  const privateContext: Obj = {};
  const path = "/messages/" + enc(c.provider_message_id);
  let sourceMessage: Obj | undefined;
  if (
    op.binding === "message" || op.binding === "source_message" ||
    op.binding === "attachment"
  ) {
    const source = await get(
      path +
        "?$select=id,internetMessageId,isDraft,subject,isRead,categories,parentFolderId,from,toRecipients,ccRecipients",
    );
    assertMessage(source.data, c);
    sourceMessage = source.data;
    if (op.is_mutation) {
      privateContext.before_state = publicMessage(source.data);
    }
  }
  if (op.operation === "graph.messages.search") {
    response = await get(
      "/messages?$search=" + enc(JSON.stringify(args.query)) +
        "&$select=id,subject,from,internetMessageId,receivedDateTime&$top=100" +
        graphPageQuery(args),
    );
    result.items = Array.isArray(response.data.value)
      ? response.data.value.map((v) =>
        obj(v)
          ? Object.fromEntries(
            ["id", "subject", "from", "internetMessageId", "receivedDateTime"]
              .filter((k) => k in v).map((k) => [k, v[k]]),
          )
          : {}
      )
      : [];
    result.next_cursor = graphCursor(response.data);
    result.possibly_truncated = !!response.data["@odata.nextLink"];
  } else if (
    op.operation === "graph.drafts.create" ||
    op.operation === "graph.drafts.forward_create" ||
    op.operation === "graph.drafts.reply_all_create"
  ) {
    let recipients = [String(c.recipient)];
    if (op.operation === "graph.drafts.reply_all_create") {
      if (!sourceMessage) throw new ProviderFailure("source_message_required");
      const allowed = new Set([
        String(c.recipient).toLowerCase(),
        ...(Array.isArray(c.allowed_recipients)
          ? c.allowed_recipients.map((v) => String(v).toLowerCase())
          : []),
      ]);
      recipients = [
        ...new Set(
          [
            String(c.recipient).toLowerCase(),
            ...recipientAddresses(sourceMessage.toRecipients),
            ...recipientAddresses(sourceMessage.ccRecipients),
          ].filter((v) => v !== GRAPH_MAILBOX.toLowerCase()),
        ),
      ];
      if (
        !recipients.length || recipients.length > 21 ||
        recipients.some((v) => !allowed.has(v))
      ) throw new ProviderFailure("reply_all_recipient_policy_required", 424);
    }
    const toRecipients = recipients.map((address) => ({
      emailAddress: { address },
    }));
    response = op.operation === "graph.drafts.create"
      ? await get("/messages", "POST", {
        subject: args.subject,
        body: { contentType: "Text", content: args.body_text },
        toRecipients,
        ccRecipients: [],
        bccRecipients: [],
      })
      : await get(
        path +
          (op.operation === "graph.drafts.forward_create"
            ? "/createForward"
            : "/createReplyAll"),
        "POST",
        {
          comment: args.body_text,
          ...(op.operation === "graph.drafts.forward_create"
            ? { toRecipients }
            : {}),
        },
      );
    const id = response.data.id;
    if (typeof id !== "string") {
      throw new ProviderFailure(
        "provider_draft_outcome_unknown",
        response.status,
        true,
      );
    }
    privateContext.recipients = recipients;
    if (op.operation !== "graph.drafts.create") {
      try {
        await get("/messages/" + enc(id), "PATCH", {
          toRecipients,
          ccRecipients: [],
          bccRecipients: [],
        });
      } catch {
        throw new ProviderFailure(
          "provider_draft_created_update_unknown",
          null,
          true,
          id,
        );
      }
    }
    result.provider_id = id;
    result.item = { state: "draft", recipients };
    result.changed = true;
  } else if (op.operation === "graph.messages.get") {
    response = await get(
      path +
        "?$select=id,subject,body,bodyPreview,isRead,isDraft,internetMessageId,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,categories,parentFolderId",
    );
    assertMessage(response.data, c);
    result.item = publicMessage(response.data);
  } else if (op.operation === "graph.messages.set_categories") {
    response = await get(path, "PATCH", { categories: args.categories });
    result.item = publicMessage(response.data);
    result.changed = true;
  } else if (op.operation === "graph.messages.mark_read") {
    response = await get(path, "PATCH", { isRead: args.is_read });
    result.item = publicMessage(response.data);
    result.changed = true;
  } else if (op.operation === "graph.messages.delete") {
    response = await get(path, "DELETE");
    result.item = { id: args.message_id, state: "deleted" };
    result.changed = true;
  } else if (op.operation === "graph.messages.move") {
    response = await get(path + "/move", "POST", {
      destinationId: args.destination_folder_id,
    });
    result.item = publicMessage(response.data);
    result.changed = true;
  } else if (op.operation === "graph.attachments.get") {
    response = await get(
      path + "/attachments/" + enc(c.provider_attachment_id) +
        "?$select=id,name,contentType,size,isInline",
    );
    result.item = response.data;
  } else if (op.operation === "graph.attachments.download") {
    let r: Response;
    try {
      r = await deps.fetch(
        graphBase + path + "/attachments/" + enc(c.provider_attachment_id) +
          "/$value",
        {
          headers: {
            authorization: "Bearer " + token,
            Prefer: 'IdType="ImmutableId"',
          },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new ProviderFailure("provider_read_unavailable");
    }
    if (!r.ok) throw new ProviderFailure("provider_request_rejected", r.status);
    const data = await bytes(r, 200000);
    let binary = "";
    for (const byte of data) binary += String.fromCharCode(byte);
    response = { status: r.status, data: {} };
    result.item = {
      id: c.attachment_id,
      filename: c.filename,
      content_type: c.content_type,
      byte_size: data.length,
      data_base64: btoa(binary),
    };
  } else if (op.operation === "graph.drafts.reply_create") {
    response = await get(path + "/createReply", "POST", {
      comment: args.body_text,
    });
    const id = response.data.id;
    if (typeof id !== "string") {
      throw new ProviderFailure(
        "provider_draft_outcome_unknown",
        response.status,
        true,
      );
    }
    try {
      await get("/messages/" + enc(id), "PATCH", {
        body: { contentType: "Text", content: args.body_text },
        toRecipients: [{ emailAddress: { address: c.recipient } }],
        ccRecipients: [],
        bccRecipients: [],
      });
    } catch {
      throw new ProviderFailure(
        "provider_draft_created_update_unknown",
        null,
        true,
        id,
      );
    }
    result.provider_id = id;
    result.item = { state: "draft", recipient: c.recipient };
    result.changed = true;
  } else if (op.operation.startsWith("graph.drafts.attachments.")) {
    const draft = await get(
      path +
        "?$select=id,from,sender,replyTo,toRecipients,ccRecipients,bccRecipients,isDraft",
    );
    assertDraft(draft.data, c);
    if (op.is_mutation) privateContext.before_state = publicMessage(draft.data);
    if (op.is_mutation && draft.data.isDraft !== true) {
      throw new ProviderFailure("provider_draft_not_unsent", 409);
    }
    const action = op.operation.split(".").at(-1);
    let payload: Obj | undefined;
    if (action === "add") {
      try {
        atob(String(args.content_base64));
      } catch {
        throw new ProviderFailure("invalid_attachment_encoding", 400);
      }
      payload = {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: args.filename,
        contentType: args.content_type,
        contentBytes: args.content_base64,
      };
    }
    response = await get(
      path + "/attachments" +
        (args.attachment_id ? "/" + enc(args.attachment_id) : "") +
        (action === "list"
          ? "?$select=id,name,contentType,size,isInline&$top=100" +
            graphPageQuery(args)
          : action === "get"
          ? "?$select=id,name,contentType,size,isInline"
          : ""),
      action === "add" ? "POST" : action === "delete" ? "DELETE" : "GET",
      payload,
    );
    if (action === "list") {
      result.items = Array.isArray(response.data.value)
        ? response.data.value
        : [];
      result.possibly_truncated = !!response.data["@odata.nextLink"];
      result.next_cursor = graphCursor(response.data);
    } else {result.item = Object.fromEntries(
        ["id", "name", "contentType", "size", "isInline"].filter((k) =>
          k in response.data
        ).map((k) => [k, response.data[k]]),
      );}
    result.changed = op.is_mutation;
  } else if (op.operation.startsWith("graph.drafts.")) {
    response = await get(
      path +
        "?$select=id,subject,body,from,sender,replyTo,toRecipients,ccRecipients,bccRecipients,isDraft,sentDateTime,changeKey" +
        (["graph.drafts.get", "graph.drafts.confirm_send"].includes(
            op.operation,
          )
          ? "&$expand=attachments($select=id,name,contentType,size,isInline)"
          : ""),
    );
    assertDraft(response.data, c);
    if (op.is_mutation) {
      privateContext.before_state = publicMessage(response.data);
    }
    if (op.operation === "graph.drafts.get") {
      result.item = {
        ...publicMessage(response.data),
        id: args.draft_id,
        state: c.draft_state,
        version: c.version,
        reviewed_content_sha256: await draftReviewHash(response.data),
        attachments: draftAttachmentMetadata(response.data),
      };
    } else if (op.operation === "graph.drafts.verify_sent") {
      result.item = {
        id: args.draft_id,
        state: c.draft_state,
        sent_confirmed: response.data.isDraft === false &&
          typeof response.data.sentDateTime === "string",
        sent_at: response.data.sentDateTime || null,
      };
    } else {
      if (response.data.isDraft !== true) {
        throw new ProviderFailure("provider_draft_not_unsent", 409);
      }
      if (op.operation === "graph.drafts.update") {
        response = await get(path, "PATCH", {
          body: { contentType: "Text", content: args.body_text },
          toRecipients: draftRecipients(c).map((address) => ({
            emailAddress: { address },
          })),
          ccRecipients: [],
          bccRecipients: [],
        });
        result.item = { id: args.draft_id, ...publicMessage(response.data) };
      } else if (op.operation === "graph.drafts.delete") {
        response = await get(path, "DELETE");
        result.item = { id: args.draft_id, state: "deleted" };
      } else if (op.operation === "graph.drafts.confirm_send") {
        if (
          await draftReviewHash(response.data) !== args.reviewed_content_sha256
        ) throw new ProviderFailure("draft_review_content_changed", 409);
        response = await get(path + "/send", "POST");
        result.item = { id: args.draft_id, state: "submitted" };
      } else throw new ProviderFailure("unsupported_provider_operation");
      result.changed = true;
    }
    result.provider_id = String(c.provider_message_id);
  } else if (op.operation.startsWith("graph.mail_folders.")) {
    const action = op.operation.split(".").at(-1);
    const p = "/mailFolders" +
      (args.folder_id ? "/" + enc(args.folder_id) : "");
    response = await get(
      p +
        (action === "list"
          ? "?$select=id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount&$top=100" +
            graphPageQuery(args)
          : ""),
      action === "create"
        ? "POST"
        : action === "update"
        ? "PATCH"
        : action === "delete"
        ? "DELETE"
        : "GET",
      action === "create" || action === "update"
        ? { displayName: args.display_name }
        : undefined,
    );
    if (action === "list") {
      result.items = Array.isArray(response.data.value)
        ? response.data.value
        : [];
      result.possibly_truncated = !!response.data["@odata.nextLink"];
      result.next_cursor = graphCursor(response.data);
    } else result.item = response.data;
    result.changed = op.is_mutation;
  } else if (op.operation.startsWith("graph.mailboxes.")) {
    response = await call(
      deps,
      graphBase + "?$select=id,displayName,mail,userPrincipalName",
      token,
    );
    const mailbox = Object.fromEntries(
      ["id", "displayName", "mail", "userPrincipalName"].filter((k) =>
        k in response.data
      ).map((k) => [k, response.data[k]]),
    );
    if (op.operation.endsWith(".list")) result.items = [mailbox];
    else result.item = mailbox;
  } else if (op.operation.startsWith("graph.mail_rules.")) {
    const action = op.operation.split(".").at(-1);
    let payload: Obj | undefined;
    if (action === "create" || action === "update") {
      const archive = await get("/mailFolders/archive?$select=id");
      if (typeof archive.data.id !== "string") {
        throw new ProviderFailure("archive_folder_required", 424);
      }
      payload = {
        displayName: args.display_name,
        sequence: 1,
        isEnabled: args.enabled,
        conditions: { senderContains: [args.sender_email] },
        actions: { moveToFolder: archive.data.id, stopProcessingRules: false },
      };
    }
    response = await get(
      "/mailFolders/inbox/messageRules" +
        (args.rule_id ? "/" + enc(args.rule_id) : "") +
        (action === "list" ? "?$top=100" + graphPageQuery(args) : ""),
      action === "create"
        ? "POST"
        : action === "update"
        ? "PATCH"
        : action === "delete"
        ? "DELETE"
        : "GET",
      payload,
    );
    if (action === "list") {
      result.items = Array.isArray(response.data.value)
        ? response.data.value
        : [];
      result.possibly_truncated = !!response.data["@odata.nextLink"];
      result.next_cursor = graphCursor(response.data);
    } else result.item = response.data;
    result.changed = op.is_mutation;
  } else if (op.operation.startsWith("graph.delta.")) {
    const initial = graphBase +
      "/messages/delta?$select=id,subject,internetMessageId,receivedDateTime,isRead,categories&$top=100";
    const next = op.operation === "graph.delta.start" ? initial : c.next_url;
    if (typeof next !== "string" || !validDeltaUrl(next)) {
      throw new ProviderFailure("invalid_persisted_delta_cursor", 409);
    }
    response = await call(deps, next, token, "GET", undefined, {
      Prefer: 'IdType="ImmutableId"',
    });
    const values = response.data.value;
    if (!Array.isArray(values) || values.length > 100) {
      throw new ProviderFailure(
        "provider_delta_page_contract",
        response.status,
        true,
      );
    }
    const cursor = response.data["@odata.nextLink"] ||
      response.data["@odata.deltaLink"];
    if (typeof cursor !== "string" || !validDeltaUrl(cursor)) {
      throw new ProviderFailure(
        "provider_delta_cursor_contract",
        response.status,
        true,
      );
    }
    result.items = values.map((v) =>
      obj(v)
        ? Object.fromEntries(
          [
            "id",
            "subject",
            "internetMessageId",
            "receivedDateTime",
            "isRead",
            "categories",
            "@removed",
          ].filter((k) => k in v).map((k) => [k, v[k]]),
        )
        : {}
    );
    result.possibly_truncated = !!response.data["@odata.nextLink"];
    result.changed = true;
    result.provider_http_status = response.status;
    return {
      outcome: "accepted",
      httpStatus: response.status,
      result,
      privateContext: {
        next_url: cursor,
        complete: !response.data["@odata.nextLink"],
      },
    };
  } else if (op.operation.startsWith("graph.subscriptions.")) {
    const action = op.operation.split(".").at(-1),
      id = typeof c.subscription_id === "string" ? c.subscription_id : null;
    const url = "https://graph.microsoft.com/v1.0/subscriptions";
    if (action === "get") {
      if (!id) response = { status: 200, data: { configured: false } };
      else response = await call(deps, url + "/" + enc(id), token);
      result.item = Object.fromEntries(
        [
          "id",
          "resource",
          "expirationDateTime",
          "notificationUrl",
          "configured",
        ].filter((k) => k in response.data).map((k) => [k, response.data[k]]),
      );
    } else if (action === "delete") {
      if (id) response = await call(deps, url + "/" + enc(id), token, "DELETE");
      else response = { status: 204, data: {} };
      result.item = { state: "deleted" };
      result.changed = !!id;
    } else {
      const expiration = new Date(Date.now() + 6 * 86400000).toISOString();
      let privateContext: Obj = {};
      if (id) {
        try {
          response = await call(deps, url + "/" + enc(id), token, "PATCH", {
            expirationDateTime: expiration,
          });
        } catch (e) {
          if (
            !(e instanceof ProviderFailure) ||
            ![404, 410].includes(e.status || 0)
          ) throw e;
          response = { status: 404, data: {} };
        }
      } else response = { status: 404, data: {} };
      if (response.status === 404) {
        const clientState = crypto.randomUUID() + crypto.randomUUID();
        response = await call(deps, url, token, "POST", {
          changeType: "created",
          notificationUrl: deps.base + "/functions/v1/email-ai-graph-webhook",
          resource: "users/" + GRAPH_MAILBOX + "/mailFolders('Inbox')/messages",
          expirationDateTime: expiration,
          clientState,
        });
        privateContext = { client_state: clientState };
      }
      result.item = Object.fromEntries(
        ["id", "resource", "expirationDateTime"].filter((k) =>
          k in response.data
        ).map((k) => [k, response.data[k]]),
      );
      result.provider_id = response.data.id;
      result.changed = true;
      result.provider_http_status = response.status;
      return {
        outcome: "accepted",
        httpStatus: response.status,
        result,
        privateContext,
      };
    }
  } else throw new ProviderFailure("unsupported_provider_operation");
  result.provider_http_status = response!.status;
  return {
    outcome: op.is_mutation ? "accepted" : "succeeded",
    httpStatus: response!.status,
    result,
    privateContext,
  };
}
async function whatsapp(
  op: ProductOperation,
  args: Obj,
  c: Obj,
  tenant: string | null,
  actor: string,
  requestId: string,
  deps: ProviderDependencies,
): Promise<ProviderResult> {
  const token = deps.env("WHATSAPP_ACCESS_TOKEN") || "";
  const waba = deps.env("WHATSAPP_BUSINESS_ACCOUNT_ID") ||
    deps.env("WHATSAPP_WABA_ID") || "";
  let response: { status: number; data: Obj };
  const result = emptyResult();
  if (
    op.operation === "whatsapp.account.get" ||
    op.operation === "whatsapp.phone.get"
  ) {
    const account = op.operation === "whatsapp.account.get";
    if (account && !/^[0-9]+$/.test(waba)) {
      throw new ProviderFailure("provider_configuration_required");
    }
    response = await call(
      deps,
      metaBase +
        (account
          ? enc(waba) + "?fields=id,name,account_review_status"
          : WHATSAPP_PHONE +
            "?fields=id,verified_name,display_phone_number,quality_rating,code_verification_status"),
      token,
    );
    result.item = response.data;
  } else if (op.operation === "whatsapp.media.upload") {
    let raw: string;
    try {
      raw = atob(String(args.content_base64));
    } catch {
      throw new ProviderFailure("invalid_media_encoding", 400);
    }
    const data = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", String(args.content_type));
    form.set(
      "file",
      new Blob([data], { type: String(args.content_type) }),
      String(args.filename),
    );
    let r: Response;
    try {
      r = await deps.fetch(metaBase + WHATSAPP_PHONE + "/media", {
        method: "POST",
        headers: { authorization: "Bearer " + token },
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ProviderFailure("provider_upload_unknown", null, true);
    }
    if (!r.ok) {
      throw new ProviderFailure(
        "provider_request_rejected",
        r.status,
        r.status >= 500,
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(await bytes(r, 30000)));
    } catch {
      throw new ProviderFailure("provider_upload_unknown", r.status, true);
    }
    if (!obj(body) || typeof body.id !== "string") {
      throw new ProviderFailure("provider_upload_unknown", r.status, true);
    }
    response = { status: r.status, data: body };
    result.provider_id = body.id;
    result.changed = true;
    result.item = { filename: args.filename, content_type: args.content_type };
  } else if (
    op.operation === "whatsapp.media.get" ||
    op.operation === "whatsapp.media.download" ||
    op.operation.startsWith("whatsapp.messages.media.")
  ) {
    response = await call(deps, metaBase + enc(c.provider_media_id), token);
    const m = response.data;
    result.item = Object.fromEntries(
      ["id", "mime_type", "file_size", "sha256"].filter((k) => k in m).map(
        (k) => [k, m[k]],
      ),
    );
    if (op.operation.endsWith(".download")) {
      if (typeof m.url !== "string") {
        throw new ProviderFailure("provider_media_url_missing");
      }
      let url: URL;
      try {
        url = new URL(m.url);
      } catch {
        throw new ProviderFailure("provider_media_url_invalid");
      }
      if (
        url.protocol !== "https:" || url.hostname !== "lookaside.fbsbx.com" ||
        url.port || url.username || url.password ||
        !url.pathname.startsWith("/whatsapp_business/attachments/")
      ) throw new ProviderFailure("provider_media_url_invalid");
      let r: Response;
      try {
        r = await deps.fetch(url, {
          headers: { authorization: "Bearer " + token },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new ProviderFailure("provider_media_read_unavailable");
      }
      if (!r.ok) {
        throw new ProviderFailure("provider_request_rejected", r.status);
      }
      const data = await bytes(r, 200000);
      let binary = "";
      for (const byte of data) binary += String.fromCharCode(byte);
      result.item = {
        ...(result.item as Obj),
        data_base64: btoa(binary),
        byte_size: data.length,
      };
    }
  } else if (op.operation === "whatsapp.messages.send_text") {
    response = await call(
      deps,
      deps.base + "/functions/v1/sandy-whatsapp-send",
      deps.service,
      "POST",
      {
        customer_id: tenant,
        text: args.text,
        idempotency_key: "product:" + actor + ":" + requestId,
        requested_wa_id: c.recipient,
      },
    );
    if (
      response.data.ok !== true ||
      typeof response.data.meta_message_id !== "string"
    ) {
      throw new ProviderFailure(
        "whatsapp_submission_unknown",
        response.status,
        true,
      );
    }
    result.provider_id = response.data.meta_message_id;
    result.item = { status: "submitted", request_id: requestId };
    result.changed = true;
  } else if (op.operation === "whatsapp.messages.mark_read") {
    response = await call(
      deps,
      metaBase + WHATSAPP_PHONE + "/messages",
      token,
      "POST",
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: c.provider_message_id,
      },
    );
    result.item = { id: args.message_id, status: "read_requested" };
    result.changed = true;
  } else if (op.operation === "whatsapp.templates.list") {
    if (!/^[0-9]+$/.test(waba)) {
      throw new ProviderFailure("provider_configuration_required");
    }
    response = await call(
      deps,
      metaBase + enc(waba) +
        "/message_templates?fields=id,name,status,language,category&limit=100" +
        (args.after ? "&after=" + enc(args.after) : ""),
      token,
    );
    result.items = Array.isArray(response.data.data) ? response.data.data : [];
    result.possibly_truncated = obj(response.data.paging) &&
      !!response.data.paging.next;
    result.next_cursor =
      obj(response.data.paging) && obj(response.data.paging.cursors) &&
        typeof response.data.paging.cursors.after === "string" &&
        response.data.paging.next
        ? response.data.paging.cursors.after
        : null;
  } else if (op.operation === "whatsapp.templates.send") {
    if (!/^[0-9]+$/.test(waba)) {
      throw new ProviderFailure("provider_configuration_required");
    }
    const list = await call(
      deps,
      metaBase + enc(waba) + "/message_templates?name=" +
        enc(args.template_name) +
        "&fields=name,status,language,components&limit=100",
      token,
    );
    const t = Array.isArray(list.data.data)
      ? list.data.data.find((v) =>
        obj(v) && v.name === args.template_name &&
        v.language === args.language_code && v.status === "APPROVED"
      )
      : null;
    if (!obj(t)) throw new ProviderFailure("approved_template_required", 424);
    if (
      Array.isArray(t.components) && t.components.some((v) =>
        obj(v) &&
        (typeof v.text === "string" && v.text.includes("{{") ||
          v.type === "BUTTONS" || v.format === "IMAGE" ||
          v.format === "VIDEO" || v.format === "DOCUMENT")
      )
    ) throw new ProviderFailure("template_parameter_binding_required", 424);
    response = await call(
      deps,
      metaBase + WHATSAPP_PHONE + "/messages",
      token,
      "POST",
      {
        messaging_product: "whatsapp",
        to: c.recipient,
        type: "template",
        template: {
          name: args.template_name,
          language: { code: args.language_code },
        },
      },
    );
    const id =
      Array.isArray(response.data.messages) && obj(response.data.messages[0])
        ? response.data.messages[0].id
        : null;
    if (typeof id !== "string") {
      throw new ProviderFailure(
        "whatsapp_submission_unknown",
        response.status,
        true,
      );
    }
    result.provider_id = id;
    result.item = { status: "submitted", request_id: requestId };
    result.changed = true;
  } else throw new ProviderFailure("unsupported_provider_operation");
  result.provider_http_status = response.status;
  return {
    outcome: op.is_mutation ? "accepted" : "succeeded",
    httpStatus: response.status,
    result,
  };
}
export async function executeProductProvider(
  op: ProductOperation,
  args: Obj,
  context: Obj,
  identity: { tenant: string | null; actor: string; requestId: string },
  deps: ProviderDependencies,
): Promise<ProviderResult> {
  let providerAttempted = false, writeAttempted = false;
  const runtime: ProviderDependencies = {
    ...deps,
    fetch: async (input, init) => {
      if (!String(input).startsWith("https://login.microsoftonline.com/")) {
        providerAttempted = true;
        if ((init?.method || "GET") !== "GET") writeAttempted = true;
      }
      return await deps.fetch(input, init);
    },
  };
  const decorate = (r: ProviderResult): ProviderResult => {
    const executed = r.outcome === "unknown"
      ? null
      : op.is_mutation
      ? r.outcome === "accepted" || writeAttempted
      : providerAttempted;
    return {
      ...r,
      executed,
      privateContext: { ...r.privateContext, execution_attempted: executed },
    };
  };
  try {
    if (op.executor === "graph") {
      return decorate(await graph(op, args, context, runtime));
    }
    if (op.executor === "whatsapp") {
      return decorate(
        await whatsapp(
          op,
          args,
          context,
          identity.tenant,
          identity.actor,
          identity.requestId,
          runtime,
        ),
      );
    }
    if (op.executor === "legacy_invoice") {
      if (
        !identity.tenant ||
        deps.env("SANDY_INVOICE_FORWARD_CUSTOMER_ID") !== identity.tenant
      ) {
        throw new ProviderFailure(
          "invoice_forward_tenant_configuration_required",
          424,
        );
      }
      // The approved legacy adapter's fixed Wise inbox is not a payment processor.
      const response = await call(
        runtime,
        deps.base + "/functions/v1/sandy-execute-invoice-forward",
        deps.service,
        "POST",
        { source_message_id: args.source_message_id },
        { "x-email-ai-internal-key": deps.env("EMAIL_AI_INTERNAL_KEY") || "" },
      );
      if (response.data.success !== true) {
        throw new ProviderFailure(
          "invoice_forward_outcome_unknown",
          response.status,
          true,
        );
      }
      const result = {
        ...emptyResult(),
        item: {
          status: response.data.status || "submitted",
          payment_executed: false,
        },
        changed: true,
        provider_http_status: response.status,
      };
      return decorate({
        outcome: "accepted",
        httpStatus: response.status,
        result,
      });
    }
    throw new ProviderFailure("unsupported_provider_operation");
  } catch (error) {
    const e = error instanceof ProviderFailure
      ? error
      : new ProviderFailure("provider_outcome_unknown", null, op.is_mutation);
    const localStatus: Record<string, number> = {
      provider_configuration_required: 424,
      approved_template_required: 424,
      template_parameter_binding_required: 424,
      invoice_forward_tenant_configuration_required: 424,
      reply_all_recipient_policy_required: 424,
      invalid_provider_cursor: 400,
      invalid_attachment_encoding: 400,
      invalid_media_encoding: 400,
      provider_draft_not_unsent: 409,
      provider_draft_recipient_binding_mismatch: 409,
      provider_message_binding_mismatch: 409,
      invalid_persisted_delta_cursor: 409,
      source_message_required: 409,
      archive_folder_required: 424,
      draft_review_unavailable: 424,
      draft_review_content_changed: 409,
      provider_draft_sender_binding_mismatch: 409,
    };
    const status = localStatus[e.code] ? null : e.status;
    return decorate({
      outcome: e.uncertain ? "unknown" : "failed",
      httpStatus: status,
      responseStatus: localStatus[e.code] || 502,
      result: {
        ...emptyResult(),
        provider_id: e.providerId,
        provider_http_status: status,
        item: { state: e.uncertain ? "unknown" : "failed", error: e.code },
      },
      error: e.code,
    });
  }
}
