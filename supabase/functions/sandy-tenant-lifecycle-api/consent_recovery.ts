/** Versioned customer-only wire adapter; the existing normal-Auth SQL ledger
 * remains the single consent policy and persistence authority. */
import { Ajv, type ValidateFunction } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import revised from "./consent_recovery_contract.json" with { type: "json" };
import type { TenantConsentDb } from "../sandy-supabase-service-api/tenant_consent.ts";
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const recoveryConsentOverrides = Object.freeze(
  Object.fromEntries(
    Object.values(revised.operations).map((op) => [op.operation, op]),
  ),
);
let validators:
  | Record<string, { input: ValidateFunction; output: ValidateFunction }>
  | undefined;
function validation() {
  if (!validators) {
    const ajv = new Ajv({ strict: true, allowUnionTypes: true });
    for (const [n, f] of Object.entries(fullFormats)) ajv.addFormat(n, f);
    validators = Object.fromEntries(
      Object.values(revised.operations).map(
        (op) => [op.operation, {
          input: ajv.compile(op.input_schema),
          output: ajv.compile(op.output_schema),
        }],
      ),
    );
  }
  return validators;
}
export async function executeRecoveryConsent(
  userDb: TenantConsentDb,
  operation: string,
  args: unknown,
): Promise<Response> {
  const fail = (status: number, error: string) =>
    Response.json({ ok: false, error, executed: false }, {
      status,
      headers: { "cache-control": "no-store" },
    });
  const validators = validation()[operation];
  if (!validators) return fail(404, "operation_not_implemented");
  if (!object(args) || !validators.input(args)) {
    return fail(400, "invalid_arguments");
  }
  try {
    const { data, error } = await userDb.rpc(
      operation === "supabase.tenant.consent.set"
        ? "sandy_supabase_tenant_consent_set"
        : "sandy_supabase_tenant_consent_get",
      operation === "supabase.tenant.consent.set"
        ? {
          p_operations: args.operations,
          p_approved_emails: args.approved_emails,
          p_allow_erasure: args.allow_erasure,
          p_expires_at: args.expires_at,
        }
        : {},
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
    if (!validators.output(data)) {
      return fail(502, "tenant_consent_projection_invalid");
    }
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch {
    return fail(503, "tenant_consent_outcome_unknown");
  }
}
