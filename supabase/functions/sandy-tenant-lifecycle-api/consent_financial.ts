/** The original SQL ledger owns consent; this revision adds only three explicit
 * financial read-export choices to its bounded real-customer wire contract. */
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import contracts from "./consent_financial_contract.json" with { type: "json" };
import { executeRecoveryConsent } from "./consent_recovery.ts";
import type { TenantConsentDb } from "../sandy-supabase-service-api/tenant_consent.ts";
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const financialConsentOverrides = Object.freeze(
  Object.fromEntries(
    Object.values(contracts.operations).map((op) => [op.operation, op]),
  ),
);
let validators: {
  input: ReturnType<Ajv["compile"]>;
  output: ReturnType<Ajv["compile"]>;
} | undefined;
function validation() {
  if (!validators) {
    const ajv = new Ajv({ strict: true, allowUnionTypes: true });
    for (const [name, format] of Object.entries(fullFormats)) {
      ajv.addFormat(name, format);
    }
    validators = {
      input: ajv.compile(contracts.operations.set.input_schema),
      output: ajv.compile(contracts.operations.set.output_schema),
    };
  }
  return validators;
}
export async function executeFinancialConsent(
  userDb: TenantConsentDb,
  operation: string,
  args: unknown,
): Promise<Response> {
  if (operation !== contracts.operations.set.operation) {
    return executeRecoveryConsent(userDb, operation, args);
  }
  const fail = (status: number, error: string) =>
    Response.json({ ok: false, error, executed: false }, {
      status,
      headers: { "cache-control": "no-store" },
    });
  if (!object(args) || !validation().input(args)) {
    return fail(400, "invalid_arguments");
  }
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
    if (!validation().output(data)) {
      return fail(502, "tenant_consent_projection_invalid");
    }
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch {
    return fail(503, "tenant_consent_outcome_unknown");
  }
}
