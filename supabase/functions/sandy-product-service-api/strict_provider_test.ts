import { strict as a } from "node:assert";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import catalogue from "./strict_contracts.json" with { type: "json" };
import { productStrictOperations } from "./strict_gateway.ts";
import { executeStrictProductProvider } from "./strict_providers.ts";
import {
  GRAPH_MAILBOX,
  type ProviderDependencies,
  WHATSAPP_PHONE,
} from "./providers.ts";
import { createInterpretedRegistryValidator } from "../sandy-operation-api/registry_schema_interpreter.ts";
type Obj = Record<string, any>;
const uuid = "40000000-0000-4000-8000-000000000001";
const identity = {
  actor: "10000000-0000-4000-8000-000000000001",
  tenant: "20000000-0000-4000-8000-000000000001",
  requestId: "30000000-0000-4000-8000-000000000001",
};
const base = "https://zmqlyygzqoidkcwdysok.supabase.co";
const stamp = "2026-10-21T00:00:00Z";
const context = {
  provider_message_id: "provider-message",
  internet_message_id: "<fixture@example.invalid>",
  recipient: "customer@example.invalid",
  recipients: ["customer@example.invalid"],
  allowed_recipients: ["customer@example.invalid"],
  source_message_id: uuid,
  draft_id: uuid,
  draft_state: "draft",
  version: 2,
  provider_attachment_id: "provider-attachment",
  attachment_id: uuid,
  filename: "fixture.txt",
  content_type: "text/plain",
  provider_media_id: "media-fixture",
  media_id: uuid,
  sync_id: uuid,
  next_url:
    "https://graph.microsoft.com/v1.0/users/ai@email.com.au/messages/delta?$deltatoken=fixture",
  subscription_id: "subscription-fixture",
};
const address = {
  emailAddress: { address: GRAPH_MAILBOX, name: "Shared mailbox" },
};
const customer = {
  emailAddress: { address: "customer@example.invalid", name: "Customer" },
};
const attachment = {
  "@odata.type": "#microsoft.graph.fileAttachment",
  id: "provider-attachment",
  name: "fixture.txt",
  contentType: "text/plain",
  size: 7,
  isInline: false,
};
const message = {
  id: "provider-message",
  subject: "Fixture subject",
  body: { contentType: "text", content: "Fixture body" },
  bodyPreview: "Fixture body",
  isRead: true,
  isDraft: true,
  internetMessageId: "<fixture@example.invalid>",
  from: address,
  sender: address,
  replyTo: [],
  toRecipients: [customer],
  ccRecipients: [],
  bccRecipients: [],
  receivedDateTime: stamp,
  sentDateTime: null,
  categories: ["Review"],
  parentFolderId: "archive",
  changeKey: "fixture-change-1",
  attachments: [attachment],
  "@odata.context": "annotation-not-public",
  unselected_internal_field: "must-not-escape",
};
const folder = {
  id: "archive",
  displayName: "Archive",
  parentFolderId: "root",
  childFolderCount: 0,
  totalItemCount: 1,
  unreadItemCount: 0,
  unselected_internal_field: "must-not-escape",
};
const rule = {
  id: "rule-fixture",
  displayName: "Fixture rule",
  sequence: 1,
  isEnabled: true,
  hasError: false,
  isReadOnly: false,
  conditions: { senderContains: ["customer@example.invalid"] },
  actions: { moveToFolder: "archive", stopProcessingRules: false },
  exceptions: {},
  "@odata.context": "annotation-not-public",
};
const subscription = {
  id: "subscription-fixture",
  resource: "users/ai@email.com.au/mailFolders('Inbox')/messages",
  expirationDateTime: "2026-10-27T00:00:00Z",
  notificationUrl: base + "/functions/v1/email-ai-graph-webhook",
  clientState: "must-not-escape",
};
const parameters: Obj = {
  message_id: uuid,
  source_message_id: uuid,
  attachment_id: "provider-attachment",
  draft_id: uuid,
  recipient_address_id: uuid,
  folder_id: "folder-fixture",
  rule_id: "rule-fixture",
  media_id: uuid,
  sync_id: uuid,
  query: "Fixture",
  subject: "Fixture subject",
  body_text: "Fixture body",
  is_read: true,
  categories: ["Review"],
  destination_folder_id: "archive",
  filename: "fixture.txt",
  content_type: "image/png",
  content_base64: "Zml4dHVyZQ==",
  display_name: "Fixture folder",
  sender_email: "customer@example.invalid",
  enabled: true,
  expected_version: 2,
  reviewed_content_sha256: "0".repeat(64),
  text: "Fixture text",
  template_name: "fixture_template",
  language_code: "en",
  confirm: true,
  confirm_send: true,
  confirm_forward: true,
  max_provider_units: 1,
  idempotency_key: identity.requestId,
};
const resources = catalogue.provider_resources as unknown as Record<
  string,
  { item: Obj; items: Obj | null }
>;
function fixture(operation: string, unknownRule = false) {
  const calls: { url: string; method: string }[] = [];
  const d: ProviderDependencies = {
    base,
    service: "synthetic-internal-key",
    env: (key) =>
      ({
        MS_GRAPH_TENANT_ID: "fixture-tenant",
        MS_GRAPH_CLIENT_ID: "fixture-client",
        MS_GRAPH_CLIENT_SECRET: "synthetic-client-secret",
        WHATSAPP_ACCESS_TOKEN: "synthetic-meta-token",
        WHATSAPP_BUSINESS_ACCOUNT_ID: "123456",
        EMAIL_AI_INTERNAL_KEY: "synthetic-internal-key",
        SANDY_INVOICE_FORWARD_CUSTOMER_ID: identity.tenant,
      })[key],
    fetch: async (input, init) => {
      const url = String(input), method = init?.method || "GET";
      calls.push({ url, method });
      if (url.startsWith("https://login.microsoftonline.com/")) {
        return Response.json({ access_token: "synthetic-provider-token" });
      }
      a.ok(
        url.startsWith("https://graph.microsoft.com/v1.0/") ||
          url.startsWith("https://graph.facebook.com/v25.0/") ||
          url.startsWith(base + "/functions/v1/") ||
          url.startsWith(
            "https://lookaside.fbsbx.com/whatsapp_business/attachments/",
          ),
      );
      if (url.includes("/sandy-execute-invoice-forward")) {
        return Response.json({ success: true, status: "submitted" });
      }
      if (url.includes("/sandy-whatsapp-send")) {
        return Response.json({ ok: true, meta_message_id: "wamid-fixture" });
      }
      if (url.startsWith("https://lookaside.fbsbx.com/")) {
        return new Response("fixture", {
          headers: { "content-type": "image/png" },
        });
      }
      if (url.startsWith("https://graph.facebook.com/")) {
        if (url.includes("/message_templates")) {
          return Response.json({
            data: [{
              id: "template-fixture",
              name: "fixture_template",
              status: "APPROVED",
              language: "en",
              category: "UTILITY",
              components: [],
              unselected_internal_field: "must-not-escape",
            }],
          });
        }
        if (url.includes("/messages")) {
          return Response.json({
            success: true,
            messages: [{ id: "wamid-fixture" }],
          });
        }
        if (url.endsWith("/media") && method === "POST") {
          return Response.json({ id: "media-fixture" });
        }
        if (url.includes("/media-fixture")) {
          return Response.json({
            id: "media-fixture",
            mime_type: "image/png",
            file_size: 7,
            sha256: "a".repeat(64),
            url:
              "https://lookaside.fbsbx.com/whatsapp_business/attachments/fixture",
            unselected_internal_field: "must-not-escape",
          });
        }
        if (url.includes("/123456?")) {
          return Response.json({
            id: "123456",
            name: "Fixture business",
            account_review_status: "APPROVED",
            unselected_internal_field: "must-not-escape",
          });
        }
        a.ok(url.includes("/" + WHATSAPP_PHONE + "?"));
        return Response.json({
          id: WHATSAPP_PHONE,
          verified_name: "Fixture business",
          display_phone_number: "+10000000000",
          quality_rating: "GREEN",
          code_verification_status: "VERIFIED",
          unselected_internal_field: "must-not-escape",
        });
      }
      if (method === "DELETE" || url.endsWith("/send")) {
        return new Response(null, { status: method === "DELETE" ? 204 : 202 });
      }
      if (url.includes("/subscriptions")) return Response.json(subscription);
      if (url.includes("/messages/delta")) {
        return Response.json({
          value: [{
            id: "delta-message",
            subject: "Fixture delta",
            internetMessageId: "<delta@example.invalid>",
            receivedDateTime: stamp,
            isRead: true,
            categories: [],
            unselected_internal_field: "must-not-escape",
          }],
          "@odata.deltaLink": context.next_url,
        });
      }
      if (url.includes("/messageRules")) {
        if (method === "PATCH") return new Response(null, { status: 204 });
        const value = unknownRule
          ? {
            ...rule,
            conditions: { ...rule.conditions, futureUnknownPredicate: true },
          }
          : rule;
        return Response.json(
          url.includes("/messageRules?") ? { value: [value] } : value,
        );
      }
      if (url.includes("/mailFolders")) {
        return Response.json(
          url.includes("/mailFolders?") ? { value: [folder] } : folder,
        );
      }
      if (url.includes("/attachments/")) {
        return url.endsWith("/$value")
          ? new Response("fixture")
          : Response.json(attachment);
      }
      if (url.includes("/attachments")) {
        return Response.json(
          method === "GET" ? { value: [attachment] } : attachment,
        );
      }
      if (url.includes("?$select=id,displayName,mail,userPrincipalName")) {
        return Response.json({
          id: "mailbox-fixture",
          displayName: "Shared mailbox",
          mail: GRAPH_MAILBOX,
          userPrincipalName: GRAPH_MAILBOX,
          unselected_internal_field: "must-not-escape",
        });
      }
      if (url.includes("/messages?$search=")) {
        return Response.json({ value: [message] });
      }
      return Response.json(message);
    },
  };
  return { deps: d, calls };
}
Deno.test("all50 provider constituent handlers execute fixed mocked adapters and explicit typed public projections", async () => {
  const ajs = new Ajv({ strict: false, formats: fullFormats });
  const gate = createInterpretedRegistryValidator();
  let seen = 0;
  for (
    const op of Object.values(productStrictOperations).filter((o) =>
      !["db", "receipt"].includes(o.executor)
    )
  ) {
    const args: Obj = {};
    for (const key of op.input_schema.required as string[]) {
      args[key] = (op.input_schema.properties as Obj)[key].format === "uuid"
        ? (key === "idempotency_key" ? identity.requestId : uuid)
        : parameters[key];
    }
    if (
      op.operation.startsWith("whatsapp.messages.") &&
      Object.hasOwn(args, "message_id")
    ) args.message_id = "9007199254740993";
    const f = fixture(op.operation);
    if (op.operation === "graph.drafts.confirm_send") {
      const preview = await executeStrictProductProvider(
        productStrictOperations["graph.drafts.get"],
        { draft_id: uuid },
        context,
        identity,
        f.deps,
      );
      a.equal(preview.error, undefined);
      args.reviewed_content_sha256 =
        (preview.result.item as Obj).reviewed_content_sha256;
    }
    a.equal(
      gate.isValid(op.input_schema, args),
      true,
      op.operation + " input " + JSON.stringify(args),
    );
    const response = await executeStrictProductProvider(
      op,
      args,
      context,
      identity,
      f.deps,
    );
    a.equal(response.error, undefined, op.operation + " " + response.error);
    a.equal(response.outcome, op.is_mutation ? "accepted" : "succeeded");
    const shape = resources[op.operation];
    const validate = ajs.compile({
      type: "object",
      properties: {
        item: shape.item,
        items: {
          type: "array",
          items: shape.items || {},
          maxItems: shape.items ? 100 : 0,
        },
      },
      required: ["item", "items"],
    });
    a.equal(
      validate(response.result),
      true,
      JSON.stringify({
        operation: op.operation,
        errors: validate.errors,
        result: response.result,
      }),
    );
    a.equal(response.result.delivery_verified, false);
    a.ok(
      !JSON.stringify(response.result).includes("must-not-escape"),
      op.operation,
    );
    a.ok(!JSON.stringify(response.result).includes("synthetic-client-secret"));
    a.ok(f.calls.length > 0);
    seen++;
  }
  a.equal(seen, 50);
});
Deno.test("unknown Graph rule policy remains explicitly partial instead of leaking an arbitrary predicate", async () => {
  const f = fixture("graph.mail_rules.get", true);
  const r = await executeStrictProductProvider(
    productStrictOperations["graph.mail_rules.get"],
    { rule_id: "rule-fixture" },
    context,
    identity,
    f.deps,
  );
  a.equal(r.error, undefined);
  a.equal((r.result.item as Obj).unrepresented_rule_fields, true);
  a.ok(!JSON.stringify(r.result).includes("futureUnknownPredicate"));
});
