/** Customer's actual Auth context only. The RPC derives customer; no tenant/actor override exists. */
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { type JsonObject, serviceOperationNames } from "./contracts.ts";
const object = (v: unknown): v is JsonObject =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const ajv = new Ajv({ strict: true, allowUnionTypes: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const policySchema = {
  type: "object",
  properties: {
    ok: { const: true },
    tenant_id: { type: "string", format: "uuid" },
    operations: { type: "array", items: { type: "string" }, maxItems: 64 },
    approved_emails: {
      type: "array",
      items: { type: "string", format: "email" },
      maxItems: 8,
    },
    allow_erasure: { type: "boolean" },
    expires_at: { type: ["string", "null"], format: "date-time" },
    revision: { type: "integer", minimum: 0 },
    legal_hold: { type: "boolean" },
    retention_until: { type: ["string", "null"], format: "date-time" },
  },
  required: [
    "ok",
    "tenant_id",
    "operations",
    "approved_emails",
    "allow_erasure",
    "expires_at",
    "revision",
    "legal_hold",
    "retention_until",
  ],
  additionalProperties: false,
};
const getInput = {
  type: "object",
  properties: {},
  additionalProperties: false,
};
const setInput = {
  type: "object",
  properties: {
    operations: {
      type: "array",
      items: { enum: serviceOperationNames },
      uniqueItems: true,
      maxItems: 64,
    },
    approved_emails: {
      type: "array",
      items: { type: "string", format: "email", maxLength: 254 },
      uniqueItems: true,
      maxItems: 8,
    },
    allow_erasure: { type: "boolean" },
    expires_at: { type: "string", format: "date-time" },
  },
  required: ["operations", "approved_emails", "allow_erasure", "expires_at"],
  additionalProperties: false,
};
export const tenantConsentOperations = Object.freeze({
  "supabase.tenant.consent.get": {
    operation: "supabase.tenant.consent.get",
    contract_sha256:
      "2f2a003bee3c98db079fe0d1fd109b6f4c0155a58ed1aab848e2356eb2ea2bfd",
    handler: "sandy-operation-api",
    permission_scope: "customer:read",
    is_mutation: false,
    input_schema: getInput,
    output_schema: policySchema,
    requires_real_user_session: true,
    requirement_ids: [111, 112],
  },
  "supabase.tenant.consent.set": {
    operation: "supabase.tenant.consent.set",
    contract_sha256:
      "4648bc11150d8f7127c42347ed55087f19bbfcbabb24ef4643231996f37be4fe",
    handler: "sandy-operation-api",
    permission_scope: "customer:write",
    is_mutation: true,
    input_schema: setInput,
    output_schema: policySchema,
    requires_real_user_session: true,
    requirement_ids: [111, 112],
  },
});
const validateOutput = ajv.compile(policySchema),
  validateGet = ajv.compile(getInput),
  validateSet = ajv.compile(setInput);
export type TenantConsentDb = {
  rpc(
    name: string,
    args: JsonObject,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};
export async function executeTenantConsent(
  userDb: TenantConsentDb,
  operation: string,
  args: unknown,
): Promise<Response> {
  const fail = (status: number, error: string) =>
    Response.json({ ok: false, error, executed: false }, {
      status,
      headers: { "cache-control": "no-store" },
    });
  if (!Object.hasOwn(tenantConsentOperations, operation)) {
    return fail(404, "operation_not_implemented");
  }
  const isSet = operation.endsWith(".set");
  if (!object(args) || !(isSet ? validateSet : validateGet)(args)) {
    return fail(400, "invalid_arguments");
  }
  const params = isSet
    ? {
      p_operations: args.operations,
      p_approved_emails: args.approved_emails,
      p_allow_erasure: args.allow_erasure,
      p_expires_at: args.expires_at,
    }
    : {};
  try {
    const { data, error } = await userDb.rpc(
      isSet
        ? "sandy_supabase_tenant_consent_set"
        : "sandy_supabase_tenant_consent_get",
      params,
    );
    if (error || !object(data)) {
      return fail(
        503,
        isSet ? "tenant_consent_outcome_unknown" : "tenant_consent_unavailable",
      );
    }
    if (data.ok === false && [403, 424].includes(Number(data.http_status))) {
      return fail(
        Number(data.http_status),
        data.error === "verified_tenant_consent_contract_required"
          ? "verified_tenant_consent_contract_required"
          : "confirmed_portal_customer_session_required",
      );
    }
    if (!validateOutput(data)) {
      return fail(502, "tenant_consent_projection_invalid");
    }
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch {
    return fail(
      503,
      isSet ? "tenant_consent_outcome_unknown" : "tenant_consent_unavailable",
    );
  }
}
