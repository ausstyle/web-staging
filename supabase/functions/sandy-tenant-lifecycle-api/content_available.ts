/** Actual customer export discovery; no tenant/actor argument or admin substitution. */
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import contract from "./content_available_contract.json" with { type: "json" };
import type { UserExportDb } from "./download.ts";
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const contentExportAvailableOperation = Object.freeze(contract);
let validators: {
  input: ReturnType<Ajv["compile"]>;
  output: ReturnType<Ajv["compile"]>;
} | undefined;
function validation() {
  if (!validators) {
    const ajv = new Ajv({ strict: true });
    for (const [n, f] of Object.entries(fullFormats)) ajv.addFormat(n, f);
    validators = {
      input: ajv.compile(contract.input_schema),
      output: ajv.compile(contract.output_schema),
    };
  }
  return validators;
}
export async function executeContentExportAvailable(
  userDb: UserExportDb,
  args: unknown,
): Promise<Response> {
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
      "sandy_tenant_content_exports_available",
      { p_offset: args.offset, p_limit: args.limit },
    );
    if (error || !object(data)) {
      return fail(503, "tenant_content_discovery_unavailable");
    }
    if (data.ok === false && [403, 424].includes(Number(data.http_status))) {
      return fail(
        Number(data.http_status),
        Number(data.http_status) === 403
          ? "confirmed_portal_customer_session_required"
          : "verified_content_discovery_required",
      );
    }
    if (
      !validation().output(data) || data.offset !== args.offset ||
      data.limit !== args.limit || !Array.isArray(data.items) ||
      data.items.length !==
        Math.min(
          Number(args.limit),
          Math.max(Number(data.total_count) - Number(args.offset), 0),
        ) ||
      data.next_offset !==
        (Number(args.offset) + data.items.length < Number(data.total_count)
          ? Number(args.offset) + data.items.length
          : null)
    ) return fail(502, "tenant_content_discovery_projection_invalid");
    return Response.json(data, {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return fail(503, "tenant_content_discovery_unavailable");
  }
}
