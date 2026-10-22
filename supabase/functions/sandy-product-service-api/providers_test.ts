import { strict as a } from "node:assert";
import {
  executeProductProvider,
  GRAPH_MAILBOX,
  type ProviderDependencies,
  WHATSAPP_PHONE,
} from "./providers.ts";
import { productOperations } from "./contracts.ts";
const identity = {
  tenant: "20000000-0000-4000-8000-000000000001",
  actor: "10000000-0000-4000-8000-000000000001",
  requestId: "30000000-0000-4000-8000-000000000001",
};
const base = "https://zmqlyygzqoidkcwdysok.supabase.co";
const msg = {
  provider_message_id: "persisted/provider?source",
  internet_message_id: "<owned-source@example.invalid>",
  source_message_id: "40000000-0000-4000-8000-000000000001",
  recipient: "bound-recipient@example.invalid",
};
function deps(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
): ProviderDependencies {
  return {
    base,
    service: "internal-service-key",
    env: (k) =>
      ({
        "MS_GRAPH_TENANT_ID": "configured-tenant",
        "MS_GRAPH_CLIENT_ID": "configured-client",
        "MS_GRAPH_CLIENT_SECRET": "never-expose-client-secret",
        "WHATSAPP_ACCESS_TOKEN": "never-expose-meta-token",
        "WHATSAPP_BUSINESS_ACCOUNT_ID": "123456",
        "EMAIL_AI_INTERNAL_KEY": "never-expose-internal-key",
        "SANDY_INVOICE_FORWARD_CUSTOMER_ID": identity.tenant,
      } as Record<string, string>)[k],
    fetch: async (input, init) =>
      String(input).includes("/oauth2/v2.0/token")
        ? Response.json({ access_token: "never-expose-provider-token" })
        : await (async () => {
          const r = await responder(String(input), init || {});
          if (
            String(input).startsWith("https://graph.microsoft.com/") && r.ok &&
            r.headers.get("content-type")?.includes("json")
          ) {
            const body = await r.clone().json();
            if (body && typeof body === "object" && "isDraft" in body) {
              return Response.json({
                from: { emailAddress: { address: GRAPH_MAILBOX } },
                sender: { emailAddress: { address: GRAPH_MAILBOX } },
                replyTo: [],
                changeKey: "fixture-change-1",
                attachments: [],
                ...body,
              }, { status: r.status });
            }
          }
          return r;
        })(),
  };
}
const run = async (
  operation: string,
  args: Record<string, unknown>,
  context: Record<string, unknown>,
  d: ProviderDependencies,
) => {
  if (
    operation === "graph.drafts.confirm_send" &&
    args.reviewed_content_sha256 === undefined
  ) {
    const preview = await executeProductProvider(
      productOperations["graph.drafts.get"],
      args,
      context,
      identity,
      d,
    );
    args = {
      ...args,
      expected_version: context.version || 1,
      reviewed_content_sha256: (preview.result.item as Record<string, unknown>)
        ?.reviewed_content_sha256 || "0".repeat(64),
    };
  }
  return await executeProductProvider(
    productOperations[operation],
    args,
    context,
    identity,
    d,
  );
};
Deno.test("Graph reads encode persisted provider IDs, use fixed mailbox and reject ownership mismatch", async () => {
  const urls: string[] = [];
  const d = deps((url) => {
    urls.push(url);
    return Response.json({
      id: "provider-owned-id",
      internetMessageId: msg.internet_message_id,
      subject: "owned",
      isRead: false,
    });
  });
  const r = await run("graph.messages.get", {}, msg, d);
  a.equal(r.outcome, "succeeded");
  a.ok(
    urls.every((u) =>
      u.startsWith(
        "https://graph.microsoft.com/v1.0/users/" +
          encodeURIComponent(GRAPH_MAILBOX) +
          "/messages/persisted%2Fprovider%3Fsource",
      )
    ),
  );
  a.equal(r.result.delivery_verified, false);
  let calls = 0;
  const mismatch = await run(
    "graph.messages.mark_read",
    { is_read: true },
    msg,
    deps(() => {
      calls++;
      return Response.json({
        id: "foreign",
        internetMessageId: "<foreign@example.invalid>",
      });
    }),
  );
  a.equal(mismatch.outcome, "failed");
  a.equal(calls, 1);
  a.equal(mismatch.error, "provider_message_binding_mismatch");
});
Deno.test("Graph read/mark/delete/move adapters call actual native methods with bound source", async () => {
  for (
    const [op, method, suffix] of [["graph.messages.mark_read", "PATCH", ""], [
      "graph.messages.delete",
      "DELETE",
      "",
    ], ["graph.messages.move", "POST", "/move"]] as const
  ) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const r = await run(
      op,
      {
        is_read: true,
        destination_folder_id: "archive",
        message_id: "local-id",
      },
      msg,
      deps((url, init) => {
        calls.push({
          url,
          method: init.method || "GET",
          body: init.body ? JSON.parse(String(init.body)) : null,
        });
        return init.method === "DELETE"
          ? new Response(null, { status: 204 })
          : Response.json({
            id: "provider-owned-id",
            internetMessageId: msg.internet_message_id,
          });
      }),
    );
    a.equal(r.outcome, "accepted");
    a.equal(calls.length, 2);
    a.equal(calls[1].method, method);
    a.ok(calls[1].url.endsWith(suffix));
    a.equal(r.result.delivery_verified, false);
  }
});
Deno.test("Graph attachment metadata and bounded binary download are actual bound attachment routes", async () => {
  const c = {
    ...msg,
    attachment_id: "attachment-local",
    provider_attachment_id: "attachment/provider",
    filename: "invoice.pdf",
    content_type: "application/pdf",
  };
  const d = deps((url) =>
    url.endsWith("/$value") ? new Response("%PDF-fixture") : Response.json(
      url.includes("/attachments/")
        ? { id: "attachment-provider", name: "invoice.pdf", size: 12 }
        : { id: "message", internetMessageId: msg.internet_message_id },
    )
  );
  const metadata = await run("graph.attachments.get", {}, c, d);
  a.equal(metadata.outcome, "succeeded");
  const download = await run("graph.attachments.download", {}, c, d);
  a.equal(download.outcome, "succeeded");
  a.equal(
    (download.result.item as Record<string, unknown>).data_base64,
    btoa("%PDF-fixture"),
  );
  const limited = await run(
    "graph.attachments.download",
    {},
    c,
    deps((url) =>
      url.endsWith("/$value")
        ? new Response(new Uint8Array(200001))
        : Response.json({
          id: "message",
          internetMessageId: msg.internet_message_id,
        })
    ),
  );
  a.equal(limited.error, "provider_response_limit");
});
Deno.test("Graph reply draft creation overwrites provider recipients with bound source sender", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const r = await run(
    "graph.drafts.reply_create",
    { body_text: "draft body" },
    msg,
    deps((url, init) => {
      calls.push({ url, init });
      return Response.json(
        init.method === "POST" ? { id: "immutable-draft" } : {
          id: "provider-owned-id",
          internetMessageId: msg.internet_message_id,
        },
      );
    }),
  );
  a.equal(r.outcome, "accepted");
  a.equal(r.result.provider_id, "immutable-draft");
  a.equal(calls.length, 3);
  a.ok(calls[1].url.endsWith("/createReply"));
  const patch = JSON.parse(String(calls[2].init.body));
  a.deepEqual(patch.toRecipients, [{
    emailAddress: { address: msg.recipient },
  }]);
  a.deepEqual(patch.ccRecipients, []);
  a.deepEqual(patch.bccRecipients, []);
});
Deno.test("partial Graph draft creation preserves provider ID and uncertain state for reconciliation", async () => {
  const r = await run(
    "graph.drafts.reply_create",
    { body_text: "draft body" },
    msg,
    deps((_url, init) => {
      if (init.method === "PATCH") throw Error("transport lost");
      return Response.json(
        init.method === "POST"
          ? { id: "created-draft" }
          : { id: "source", internetMessageId: msg.internet_message_id },
      );
    }),
  );
  a.equal(r.outcome, "unknown");
  a.equal(r.result.provider_id, "created-draft");
  a.ok(!JSON.stringify(r).includes("never-expose"));
});
Deno.test("Graph draft send verifies all recipients then submits once without claiming delivery", async () => {
  let sends = 0;
  const c = {
    provider_message_id: "draft",
    recipient: msg.recipient,
    draft_state: "draft",
  };
  const d = deps((_url, init) => {
    if (init.method === "POST") {
      sends++;
      return new Response(null, { status: 202 });
    }
    return Response.json({
      id: "draft",
      isDraft: true,
      toRecipients: [{ emailAddress: { address: msg.recipient } }],
      ccRecipients: [],
      bccRecipients: [],
    });
  });
  const r = await run(
    "graph.drafts.confirm_send",
    { draft_id: "local-draft" },
    c,
    d,
  );
  a.equal(r.outcome, "accepted");
  a.equal(r.httpStatus, 202);
  a.equal(sends, 1);
  a.equal(r.result.delivery_verified, false);
  const reject = await run(
    "graph.drafts.confirm_send",
    {},
    c,
    deps(() =>
      Response.json({
        id: "draft",
        isDraft: true,
        toRecipients: [{ emailAddress: { address: msg.recipient } }],
        ccRecipients: [{
          emailAddress: { address: "injected@example.invalid" },
        }],
      })
    ),
  );
  a.equal(reject.outcome, "failed");
  a.equal(reject.error, "provider_draft_recipient_binding_mismatch");
});
Deno.test("Graph draft send transport uncertainty is never retried inside adapter", async () => {
  let sends = 0;
  const r = await run(
    "graph.drafts.confirm_send",
    {},
    { provider_message_id: "draft", recipient: msg.recipient },
    deps((_url, init) => {
      if (init.method === "POST") {
        sends++;
        throw Error("timeout");
      }
      return Response.json({
        id: "draft",
        isDraft: true,
        toRecipients: [{ emailAddress: { address: msg.recipient } }],
      });
    }),
  );
  a.equal(r.outcome, "unknown");
  a.equal(sends, 1);
});
Deno.test("Graph draft get/update/delete/verify preserve tenant draft binding and truthful sent confirmation", async () => {
  for (
    const op of [
      "graph.drafts.get",
      "graph.drafts.update",
      "graph.drafts.delete",
      "graph.drafts.verify_sent",
    ]
  ) {
    let effects = 0;
    const r = await run(
      op,
      { draft_id: "local-draft", body_text: "changed" },
      {
        provider_message_id: "provider-draft",
        recipient: msg.recipient,
        draft_state: "draft",
      },
      deps((_url, init) => {
        if (init.method !== "GET") effects++;
        return init.method === "DELETE"
          ? new Response(null, { status: 204 })
          : Response.json({
            id: "provider-draft",
            isDraft: op !== "graph.drafts.verify_sent",
            sentDateTime: "2026-10-21T00:00:00Z",
            toRecipients: [{ emailAddress: { address: msg.recipient } }],
          });
      }),
    );
    a.equal(
      r.outcome,
      productOperations[op].is_mutation ? "accepted" : "succeeded",
    );
    a.equal(effects, productOperations[op].is_mutation ? 1 : 0);
    if (op.endsWith("verify_sent")) {
      a.equal((r.result.item as Record<string, unknown>).sent_confirmed, true);
    }
    a.equal(r.result.delivery_verified, false);
  }
});
Deno.test("Graph folders use fixed mailbox native CRUD and report incomplete pages", async () => {
  for (
    const [action, method] of [
      ["list", "GET"],
      ["get", "GET"],
      ["create", "POST"],
      ["update", "PATCH"],
      ["delete", "DELETE"],
    ] as const
  ) {
    let seen = "";
    const r = await run(
      "graph.mail_folders." + action,
      { folder_id: "folder/encoded", display_name: "Review" },
      {},
      deps((url, init) => {
        seen = init.method || "GET";
        a.ok(url.includes("/mailFolders"));
        return method === "DELETE"
          ? new Response(null, { status: 204 })
          : Response.json(
            action === "list"
              ? {
                value: [{ id: "f" }],
                "@odata.nextLink":
                  "https://graph.microsoft.com/v1.0/users/ai%40email.com.au/mailFolders?$skip=100",
              }
              : { id: "f" },
          );
      }),
    );
    a.equal(seen, method);
    a.equal(
      r.outcome,
      productOperations["graph.mail_folders." + action].is_mutation
        ? "accepted"
        : "succeeded",
    );
    if (action === "list") a.equal(r.result.possibly_truncated, true);
  }
});
Deno.test("Graph subscriptions create/renew/delete fixed resource and keep clientState private", async () => {
  const r = await run(
    "graph.subscriptions.ensure",
    {},
    {},
    deps((url, init) => {
      a.equal(url, "https://graph.microsoft.com/v1.0/subscriptions");
      const body = JSON.parse(String(init.body));
      a.equal(
        body.notificationUrl,
        base + "/functions/v1/email-ai-graph-webhook",
      );
      a.equal(
        body.resource,
        "users/ai@email.com.au/mailFolders('Inbox')/messages",
      );
      return Response.json({
        id: "sub",
        resource: body.resource,
        expirationDateTime: body.expirationDateTime,
        clientState: body.clientState,
      }, { status: 201 });
    }),
  );
  a.equal(r.outcome, "accepted");
  a.ok(typeof r.privateContext?.client_state === "string");
  a.ok(!JSON.stringify(r.result).includes("clientState"));
  a.ok(
    !JSON.stringify(r.result).includes(String(r.privateContext?.client_state)),
  );
  const renew = await run(
    "graph.subscriptions.ensure",
    {},
    { subscription_id: "old" },
    deps((_url, init) => {
      a.equal(init.method, "PATCH");
      return Response.json({
        id: "old",
        resource: "users/ai@email.com.au/mailFolders('Inbox')/messages",
        expirationDateTime: "2026-10-27T00:00:00Z",
      });
    }),
  );
  a.equal(renew.outcome, "accepted");
  const gone = await run(
    "graph.subscriptions.delete",
    {},
    { subscription_id: "old" },
    deps((_url, init) => {
      a.equal(init.method, "DELETE");
      return new Response(null, { status: 204 });
    }),
  );
  a.equal(gone.outcome, "accepted");
});
Deno.test("WhatsApp text delegates approved native send service with derived tenant/recipient/stable key", async () => {
  const r = await run(
    "whatsapp.messages.send_text",
    { text: "draft text", requested_wa_id: "999999" },
    { recipient: "61411111111" },
    deps((url, init) => {
      a.equal(url, base + "/functions/v1/sandy-whatsapp-send");
      const b = JSON.parse(String(init.body));
      a.equal(b.customer_id, identity.tenant);
      a.equal(b.requested_wa_id, "61411111111");
      a.equal(
        b.idempotency_key,
        "product:" + identity.actor + ":" + identity.requestId,
      );
      a.equal(
        new Headers(init.headers).get("authorization"),
        "Bearer internal-service-key",
      );
      return Response.json({ ok: true, meta_message_id: "wamid.actual" });
    }),
  );
  a.equal(r.outcome, "accepted");
  a.equal(r.result.provider_id, "wamid.actual");
  a.equal(r.result.delivery_verified, false);
});
Deno.test("WhatsApp mark_read uses actual Meta POST status with server-bound inbound message ID", async () => {
  const r = await run(
    "whatsapp.messages.mark_read",
    {},
    { provider_message_id: "wamid.persisted" },
    deps((url, init) => {
      a.equal(
        url,
        "https://graph.facebook.com/v25.0/" + WHATSAPP_PHONE + "/messages",
      );
      a.deepEqual(JSON.parse(String(init.body)), {
        messaging_product: "whatsapp",
        status: "read",
        message_id: "wamid.persisted",
      });
      return Response.json({ success: true });
    }),
  );
  a.equal(r.outcome, "accepted");
});
Deno.test("WhatsApp template listing/status and approved parameter-free sends are real native adapters", async () => {
  const list = await run(
    "whatsapp.templates.list",
    {},
    {},
    deps((url) => {
      a.ok(url.includes("/123456/message_templates?fields="));
      return Response.json({
        data: [{ name: "approved", status: "APPROVED" }],
        paging: { next: "private-next" },
      });
    }),
  );
  a.equal(list.outcome, "succeeded");
  a.equal(list.result.possibly_truncated, true);
  a.ok(!JSON.stringify(list.result).includes("private-next"));
  let sends = 0;
  const sent = await run(
    "whatsapp.templates.send",
    { template_name: "approved", language_code: "en" },
    { recipient: "61411111111" },
    deps((url, init) => {
      if (init.method === "POST") {
        sends++;
        a.equal(JSON.parse(String(init.body)).to, "61411111111");
        return Response.json({ messages: [{ id: "wamid.template" }] });
      }
      a.ok(url.includes("name=approved"));
      return Response.json({
        data: [{
          name: "approved",
          language: "en",
          status: "APPROVED",
          components: [{ type: "BODY", text: "Approved fixed text" }],
        }],
      });
    }),
  );
  a.equal(sent.outcome, "accepted");
  a.equal(sends, 1);
  a.equal(sent.result.delivery_verified, false);
});
Deno.test("WhatsApp template requiring approved parameter binding stays closed without a send", async () => {
  let sends = 0;
  const r = await run(
    "whatsapp.templates.send",
    { template_name: "approved", language_code: "en" },
    { recipient: "61411111111" },
    deps((_url, init) => {
      if (init.method === "POST") sends++;
      return Response.json({
        data: [{
          name: "approved",
          language: "en",
          status: "APPROVED",
          components: [{ type: "BODY", text: "Hi {{1}}" }],
        }],
      });
    }),
  );
  a.equal(r.error, "template_parameter_binding_required");
  a.equal(r.responseStatus, 424);
  a.equal(r.httpStatus, null);
  a.equal(r.executed, false);
  a.equal(sends, 0);
});
Deno.test("Invoice forwarding requires configured approved tenant and never claims a charged payment", async () => {
  let sends = 0;
  const d = deps((url, init) => {
    sends++;
    a.equal(url, base + "/functions/v1/sandy-execute-invoice-forward");
    a.equal(
      new Headers(init.headers).get("x-email-ai-internal-key"),
      "never-expose-internal-key",
    );
    a.deepEqual(JSON.parse(String(init.body)), { source_message_id: "source" });
    return Response.json({ success: true, status: "submitted" });
  });
  const r = await run(
    "commerce.invoice_forward.request",
    { source_message_id: "source" },
    msg,
    d,
  );
  a.equal(r.outcome, "accepted");
  a.equal((r.result.item as Record<string, unknown>).payment_executed, false);
  a.equal(sends, 1);
  a.ok(!JSON.stringify(r).includes("never-expose"));
  const denied = await executeProductProvider(
    productOperations["commerce.invoice_forward.request"],
    {},
    msg,
    { ...identity, tenant: "other-tenant" },
    d,
  );
  a.equal(denied.error, "invoice_forward_tenant_configuration_required");
  a.equal(sends, 1);
});
Deno.test("configured mailbox discovery and message categories have real fixed Graph handlers", async () => {
  for (const op of ["graph.mailboxes.list", "graph.mailboxes.get"]) {
    const r = await run(
      op,
      {},
      {},
      deps((url) => {
        a.equal(
          decodeURIComponent(new URL(url).pathname),
          "/v1.0/users/" + GRAPH_MAILBOX,
        );
        return Response.json({
          id: "mailbox",
          mail: GRAPH_MAILBOX,
          displayName: "Sandy",
        });
      }),
    );
    a.equal(r.outcome, "succeeded");
  }
  let patch: unknown;
  const r = await run(
    "graph.messages.set_categories",
    { categories: ["Reviewed"] },
    msg,
    deps((_url, init) => {
      if (init.method === "PATCH") patch = JSON.parse(String(init.body));
      return Response.json({
        id: "source",
        internetMessageId: msg.internet_message_id,
        categories: ["Reviewed"],
      });
    }),
  );
  a.equal(r.outcome, "accepted");
  a.deepEqual(patch, { categories: ["Reviewed"] });
});
Deno.test("draft attachment native list/read/add/delete never accepts another draft or recipient", async () => {
  for (
    const [action, method] of [
      ["list", "GET"],
      ["get", "GET"],
      ["add", "POST"],
      ["delete", "DELETE"],
    ] as const
  ) {
    const methods: string[] = [];
    const r = await run(
      "graph.drafts.attachments." + action,
      {
        attachment_id: "attachment/provider",
        filename: "tiny.txt",
        content_type: "text/plain",
        content_base64: btoa("small fixture"),
      },
      { provider_message_id: "persisted-draft", recipient: msg.recipient },
      deps((url, init) => {
        methods.push(init.method || "GET");
        if (url.includes("?$select=id,from,sender,replyTo,toRecipients")) {
          return Response.json({
            id: "draft",
            isDraft: true,
            toRecipients: [{ emailAddress: { address: msg.recipient } }],
          });
        }
        if (method === "DELETE") return new Response(null, { status: 204 });
        if (method === "POST") {
          const body = JSON.parse(String(init.body));
          a.equal(body["@odata.type"], "#microsoft.graph.fileAttachment");
          a.equal(body.contentBytes, btoa("small fixture"));
        }
        return Response.json(
          action === "list"
            ? { value: [{ id: "attached" }] }
            : { id: "attached", name: "tiny.txt" },
        );
      }),
    );
    a.equal(
      r.outcome,
      productOperations["graph.drafts.attachments." + action].is_mutation
        ? "accepted"
        : "succeeded",
    );
    a.equal(methods[1], method);
  }
});
Deno.test("mail rule CRUD uses actual native rules with a fixed archive action and approved owner scope", async () => {
  for (
    const [action, method] of [
      ["list", "GET"],
      ["get", "GET"],
      ["create", "POST"],
      ["update", "PATCH"],
      ["delete", "DELETE"],
    ] as const
  ) {
    let ruleMethod = "";
    const r = await run(
      "graph.mail_rules." + action,
      {
        rule_id: "rule/owned",
        display_name: "Review archived sender",
        sender_email: "sender@example.invalid",
        enabled: true,
      },
      {},
      deps((url, init) => {
        if (url.includes("/mailFolders/archive?")) {
          return Response.json({ id: "real-archive-folder" });
        }
        a.ok(url.includes("/mailFolders/inbox/messageRules"));
        ruleMethod = init.method || "GET";
        if (init.body) {
          const body = JSON.parse(String(init.body));
          a.equal(body.actions.moveToFolder, "real-archive-folder");
          a.deepEqual(body.conditions.senderContains, [
            "sender@example.invalid",
          ]);
        }
        return method === "DELETE"
          ? new Response(null, { status: 204 })
          : Response.json(
            action === "list" ? { value: [{ id: "rule" }] } : { id: "rule" },
          );
      }),
    );
    a.equal(
      r.outcome,
      productOperations["graph.mail_rules." + action].is_mutation
        ? "accepted"
        : "succeeded",
    );
    a.equal(ruleMethod, method);
  }
});
Deno.test("delta sync accepts only fixed mailbox provider cursors and keeps nextLink out of public results", async () => {
  const url = "https://graph.microsoft.com/v1.0/users/" +
    encodeURIComponent(GRAPH_MAILBOX) + "/messages/delta?$skiptoken=fixture";
  const d = deps((requested) => {
    a.ok(requested.startsWith("https://graph.microsoft.com/v1.0/users/"));
    return Response.json({
      value: [{
        id: "m",
        subject: "owned mailbox",
        "@removed": { reason: "deleted" },
      }],
      "@odata.nextLink": url,
    });
  });
  const r = await run("graph.delta.start", {}, {}, d);
  a.equal(r.outcome, "accepted");
  a.equal(r.privateContext?.next_url, url);
  a.ok(!JSON.stringify(r.result).includes("skiptoken"));
  const next = await run("graph.delta.next", {}, { next_url: url }, d);
  a.equal(next.outcome, "accepted");
  let calls = 0;
  const invalid = await run(
    "graph.delta.next",
    {},
    { next_url: "https://attacker.invalid/?token=stolen" },
    deps(() => {
      calls++;
      return Response.json({});
    }),
  );
  a.equal(invalid.error, "invalid_persisted_delta_cursor");
  a.equal(calls, 0);
});
Deno.test("WhatsApp account/phone status are actual fixed configured WABA and phone reads", async () => {
  for (const op of ["whatsapp.account.get", "whatsapp.phone.get"]) {
    const r = await run(
      op,
      {},
      {},
      deps((url) => {
        a.ok(
          url.startsWith(
            "https://graph.facebook.com/v25.0/" +
              (op === "whatsapp.account.get" ? "123456" : WHATSAPP_PHONE) +
              "?fields=",
          ),
        );
        return Response.json({ id: "configured", quality_rating: "GREEN" });
      }),
    );
    a.equal(r.outcome, "succeeded");
  }
});
Deno.test("WhatsApp media upload uses native multipart and download validates authenticated provider URL", async () => {
  const uploaded = await run(
    "whatsapp.media.upload",
    {
      filename: "tiny.pdf",
      content_type: "application/pdf",
      content_base64: btoa("%PDF-fixture"),
    },
    {},
    deps((url, init) => {
      a.equal(
        url,
        "https://graph.facebook.com/v25.0/" + WHATSAPP_PHONE + "/media",
      );
      a.ok(init.body instanceof FormData);
      a.equal((init.body as FormData).get("messaging_product"), "whatsapp");
      return Response.json({ id: "provider-media" });
    }),
  );
  a.equal(uploaded.outcome, "accepted");
  a.equal(uploaded.result.provider_id, "provider-media");
  for (
    const op of [
      "whatsapp.media.get",
      "whatsapp.messages.media.get",
      "whatsapp.media.download",
      "whatsapp.messages.media.download",
    ]
  ) {
    const r = await run(
      op,
      {},
      { provider_media_id: "persisted-media" },
      deps((url) =>
        url.startsWith("https://lookaside.fbsbx.com/")
          ? new Response("%PDF-fixture")
          : Response.json({
            id: "persisted-media",
            mime_type: "application/pdf",
            url:
              "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=fixture",
          })
      ),
    );
    a.equal(r.outcome, "succeeded");
    a.ok(!JSON.stringify(r.result).includes("lookaside"));
    if (op.endsWith(".download")) {
      a.equal(
        (r.result.item as Record<string, unknown>).data_base64,
        btoa("%PDF-fixture"),
      );
    }
  }
  const rejected = await run(
    "whatsapp.media.download",
    {},
    { provider_media_id: "persisted-media" },
    deps(() =>
      Response.json({
        id: "persisted-media",
        url: "https://attacker.invalid/metadata",
      })
    ),
  );
  a.equal(rejected.error, "provider_media_url_invalid");
});
Deno.test("provider list paging follows only opaque tokens on fixed Graph/Meta endpoints", async () => {
  const cursor = btoa(JSON.stringify({ skiptoken: "opaque/provider+cursor" }));
  let graphUrl = "";
  const listed = await run(
    "graph.mail_folders.list",
    { cursor },
    {},
    deps((url) => {
      graphUrl = url;
      return Response.json({
        value: [],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/users/ai%40email.com.au/mailFolders?$skiptoken=next%2Bopaque",
      });
    }),
  );
  a.equal(listed.outcome, "succeeded");
  a.ok(graphUrl.includes("$skiptoken=opaque%2Fprovider%2Bcursor"));
  a.deepEqual(JSON.parse(atob(String(listed.result.next_cursor))), {
    skiptoken: "next+opaque",
  });
  let calls = 0;
  const invalid = await run(
    "graph.mail_folders.list",
    { cursor: btoa(JSON.stringify({ url: "https://attacker.invalid" })) },
    {},
    deps(() => {
      calls++;
      return Response.json({ value: [] });
    }),
  );
  a.equal(invalid.error, "invalid_provider_cursor");
  a.equal(calls, 0);
  const meta = await run(
    "whatsapp.templates.list",
    { after: "opaque/meta+cursor" },
    {},
    deps((url) => {
      a.ok(url.endsWith("&after=opaque%2Fmeta%2Bcursor"));
      return Response.json({
        data: [],
        paging: {
          next: "https://graph.facebook.com/?access_token=never-expose",
          cursors: { after: "next-meta" },
        },
      });
    }),
  );
  a.equal(meta.outcome, "succeeded");
  a.equal(meta.result.next_cursor, "next-meta");
  a.ok(!JSON.stringify(meta.result).includes("access_token"));
});
Deno.test("new composition and forwarding create actual drafts bound to verified owned address", async () => {
  for (const op of ["graph.drafts.create", "graph.drafts.forward_create"]) {
    const calls: { url: string; init: RequestInit }[] = [];
    const r = await run(
      op,
      { subject: "Scoped draft", body_text: "Draft content" },
      msg,
      deps((url, init) => {
        calls.push({ url, init });
        return Response.json(
          init.method === "POST"
            ? { id: "new-private-draft" }
            : { id: "source", internetMessageId: msg.internet_message_id },
        );
      }),
    );
    a.equal(r.outcome, "accepted");
    a.equal(r.result.provider_id, "new-private-draft");
    const created = calls.find((v) => v.init.method === "POST")!;
    a.ok(
      created.url.endsWith(
        op.endsWith("forward_create") ? "/createForward" : "/messages",
      ),
    );
    a.deepEqual(JSON.parse(String(created.init.body)).toRecipients, [{
      emailAddress: { address: msg.recipient },
    }]);
    a.deepEqual(r.privateContext?.recipients, [msg.recipient]);
  }
});
Deno.test("replyAll preflight rejects unapproved participants and binds exactly the approved recipient set", async () => {
  const alias = "verified-alias@example.invalid";
  const c = { ...msg, allowed_recipients: [alias] };
  let writes = 0;
  const d = deps((_url, init) => {
    if (init.method === "POST") {
      writes++;
      return Response.json({ id: "reply-all-draft" });
    }
    return Response.json({
      id: "source",
      internetMessageId: msg.internet_message_id,
      toRecipients: [{ emailAddress: { address: GRAPH_MAILBOX } }],
      ccRecipients: [{ emailAddress: { address: alias } }],
    });
  });
  const r = await run(
    "graph.drafts.reply_all_create",
    { body_text: "Scoped reply all" },
    c,
    d,
  );
  a.equal(r.outcome, "accepted");
  a.equal(writes, 1);
  a.deepEqual(r.privateContext?.recipients, [msg.recipient, alias]);
  const blocked = await run(
    "graph.drafts.reply_all_create",
    { body_text: "Blocked" },
    c,
    deps((_url, init) => {
      if (init.method === "POST") writes++;
      return Response.json({
        id: "source",
        internetMessageId: msg.internet_message_id,
        ccRecipients: [{
          emailAddress: { address: "unapproved@example.invalid" },
        }],
      });
    }),
  );
  a.equal(blocked.error, "reply_all_recipient_policy_required");
  a.equal(blocked.responseStatus, 424);
  a.equal(blocked.httpStatus, null);
  a.equal(blocked.executed, false);
  a.equal(writes, 1);
});
Deno.test("multi-recipient send checks exact persisted set and never trusts additional cc/bcc", async () => {
  const alias = "verified-alias@example.invalid";
  let sends = 0;
  const c = {
    provider_message_id: "approved-draft",
    recipient: msg.recipient,
    recipients: [msg.recipient, alias],
  };
  const r = await run(
    "graph.drafts.confirm_send",
    {},
    c,
    deps((_url, init) => {
      if (init.method === "POST") {
        sends++;
        return new Response(null, { status: 202 });
      }
      return Response.json({
        id: "draft",
        isDraft: true,
        toRecipients: [{ emailAddress: { address: msg.recipient } }],
        ccRecipients: [{ emailAddress: { address: alias } }],
      });
    }),
  );
  a.equal(r.outcome, "accepted");
  a.equal(sends, 1);
  const rejected = await run(
    "graph.drafts.confirm_send",
    {},
    c,
    deps(() =>
      Response.json({
        id: "draft",
        isDraft: true,
        toRecipients: [{ emailAddress: { address: msg.recipient } }],
        ccRecipients: [{ emailAddress: { address: alias } }],
        bccRecipients: [{
          emailAddress: { address: "injected@example.invalid" },
        }],
      })
    ),
  );
  a.equal(rejected.error, "provider_draft_recipient_binding_mismatch");
  a.equal(rejected.executed, false);
});
Deno.test("owner message search uses fixed mailbox encoded query and projected provider results", async () => {
  const r = await run(
    "graph.messages.search",
    { query: "quoted search" },
    {},
    deps((url) => {
      a.ok(
        url.startsWith(
          "https://graph.microsoft.com/v1.0/users/ai%40email.com.au/messages?$search=",
        ),
      );
      a.equal(
        new URL(url).searchParams.get("$search"),
        JSON.stringify("quoted search"),
      );
      return Response.json({
        value: [{
          id: "source",
          subject: "matches",
          body: { content: "must not return extra body" },
        }],
      });
    }),
  );
  a.equal(r.outcome, "succeeded");
  a.equal((r.result.items as Record<string, unknown>[]).length, 1);
  a.equal((r.result.items as Record<string, unknown>[])[0].body, undefined);
});
Deno.test("send confirmation refuses body/attachment/changeKey changes after explicit preview", async () => {
  const c = {
    provider_message_id: "draft",
    recipient: msg.recipient,
    version: 3,
  };
  let body = "Reviewed body", changeKey = "reviewed-version", sends = 0;
  const d = deps((_url, init) => {
    if (init.method === "POST") {
      sends++;
      return new Response(null, { status: 202 });
    }
    return Response.json({
      id: "draft",
      subject: "Reviewed subject",
      body: { contentType: "Text", content: body },
      changeKey,
      isDraft: true,
      toRecipients: [{ emailAddress: { address: msg.recipient } }],
      attachments: [],
    });
  });
  const preview = await run("graph.drafts.get", {}, c, d);
  a.equal(preview.outcome, "succeeded");
  const digest =
    (preview.result.item as Record<string, unknown>).reviewed_content_sha256;
  a.equal((preview.result.item as Record<string, unknown>).version, 3);
  body = "Changed after review";
  changeKey = "changed-version";
  const r = await run(
    "graph.drafts.confirm_send",
    { expected_version: 3, reviewed_content_sha256: digest },
    c,
    d,
  );
  a.equal(r.error, "draft_review_content_changed");
  a.equal(r.responseStatus, 409);
  a.equal(r.executed, false);
  a.equal(sends, 0);
});
Deno.test("draft review rejects unsupported/incomplete attachments and sender changes before sending", async () => {
  for (
    const extra of [{
      attachments: [{
        id: "nested-item",
        "@odata.type": "#microsoft.graph.itemAttachment",
        name: "nested",
        size: 100,
      }],
    }, {
      attachments: [],
      "attachments@odata.nextLink": "https://graph.microsoft.com/remaining",
    }, {
      from: { emailAddress: { address: "different-sender@example.invalid" } },
    }]
  ) {
    let sends = 0;
    const c = {
      provider_message_id: "draft",
      recipient: msg.recipient,
      version: 1,
    };
    const d = deps((_url, init) => {
      if (init.method === "POST") sends++;
      return Response.json({
        id: "draft",
        isDraft: true,
        toRecipients: [{ emailAddress: { address: msg.recipient } }],
        ...extra,
      });
    });
    const r = await run(
      "graph.drafts.confirm_send",
      { expected_version: 1, reviewed_content_sha256: "0".repeat(64) },
      c,
      d,
    );
    a.equal(r.outcome, "failed");
    a.equal(r.executed, false);
    a.equal(sends, 0);
  }
  const c = {
    provider_message_id: "draft",
    recipient: msg.recipient,
    version: 1,
  };
  const preview = await run(
    "graph.drafts.get",
    {},
    c,
    deps(() =>
      Response.json({
        id: "draft",
        isDraft: true,
        toRecipients: [{ emailAddress: { address: msg.recipient } }],
      })
    ),
  );
  const item = preview.result.item as Record<string, unknown>;
  a.ok(item.sender);
  a.deepEqual(item.replyTo, []);
});
