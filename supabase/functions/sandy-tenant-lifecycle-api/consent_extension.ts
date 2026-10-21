/** Versioned schema extension; the existing SQL consent ledger remains the authority. */
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import revised from "./consent_content_contract.json" with { type: "json" };
import {
  executeTenantConsent,
  type TenantConsentDb,
  tenantConsentOperations,
} from "../sandy-supabase-service-api/tenant_consent.ts";
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const tenantLifecycleConsentOverride = revised.operation;
const ajv = new Ajv({ strict: true, allowUnionTypes: true });
for (const [n, f] of Object.entries(fullFormats)) ajv.addFormat(n, f);
const input = ajv.compile(revised.operation.input_schema),
  output = ajv.compile(
    tenantConsentOperations["supabase.tenant.consent.get"].output_schema,
  );
export async function executeLifecycleConsent(
  userDb: TenantConsentDb,
  operation: string,
  args: unknown,
): Promise<Response> {
  if (operation !== "supabase.tenant.consent.set") {
    return executeTenantConsent(userDb, operation, args);
  }
  const fail = (status: number, error: string) =>
    Response.json({ ok: false, error, executed: false }, {
      status,
      headers: { "cache-control": "no-store" },
    });
  if (!object(args) || !input(args)) return fail(400, "invalid_arguments");
  try {
    const { data, error } = await userDb.rpc(
      "sandy_supabase_tenant_consent_set",
      {
        p_operations: args.operations,
        p_approved_emails: args.approved_emails,
        p_allow_erasure: args.allow_erasure,
        p_expires_at: args.expires_at,
      },
    );
    if (error || !object(data)) {
      return fail(503, "tenant_consent_outcome_unknown");
    }
    if (data.ok === false && [403, 424].includes(Number(data.http_status))) {
      return fail(
        Number(data.http_status),
        Number(data.http_status) === 403
          ? "confirmed_portal_customer_session_required"
          : "verified_tenant_consent_contract_required",
      );
    }
    if (!output(data)) return fail(502, "tenant_consent_projection_invalid");
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch {
    return fail(503, "tenant_consent_outcome_unknown");
  }
}
