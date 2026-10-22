/** A normal confirmed portal Auth session releases its own bounded export. */
import { Ajv, type ValidateFunction } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import manifest from "./manifest.json" with { type: "json" };
import { scalarManifestPayloadSchema } from "./scalar_contracts.ts";
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = { type: "string", format: "uuid" },
  digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const obj = (properties: Obj) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const tables = Object.fromEntries(
  manifest.tables.map(
    (table) => [table.table, {
      type: "array",
      maxItems: 1000,
      items: obj(Object.fromEntries(table.columns.map((column) => {
        let schema: Obj = column.type === "uuid"
          ? { ...uuid }
          : column.type === "timestamp with time zone"
          ? { type: "string", format: "date-time" }
          : column.type === "integer"
          ? { type: "integer" }
          : { type: "string", maxLength: manifest.maximum_text_characters };
        if (column.nullable) schema = { anyOf: [schema, { type: "null" }] };
        return [column.name, schema];
      }))),
    }],
  ),
);
const payload = obj({
  format_version: { const: "1.0.0" },
  tenant_id: uuid,
  manifest: { const: manifest.id },
  manifest_sha256: { const: manifest.manifest_sha256 },
  schema_sha256: { const: manifest.schema_sha256 },
  complete_tenant_coverage: { const: false },
  external_provider_assets_included: { const: false },
  tables: obj(tables),
});
const input = obj({ snapshot_id: uuid });
const output = obj({
  ok: { const: true },
  snapshot_id: uuid,
  snapshot_sha256: digest,
  file_name: {
    type: "string",
    pattern: "^sandy-tenant-links-[a-f0-9-]{36}\\.json$",
  },
  export: { oneOf: [payload, scalarManifestPayloadSchema] },
});
export const tenantExportDownloadOperation = Object.freeze({
  operation: "supabase.tenant.exports.download",
  contract_sha256:
    "4c0e4b39c528fd070031269036968d6f1481233655cce47f8d6d7750b6fb9f8f",
  handler: "sandy-operation-api",
  permission_scope: "customer:read",
  is_mutation: false,
  input_schema: input,
  output_schema: output,
  requires_real_user_session: true,
  requirement_ids: [111],
  complete_tenant_coverage: false,
});
let validators:
  | { input: ValidateFunction; output: ValidateFunction }
  | undefined;
function deliveryValidators() {
  if (!validators) {
    // Catalogue discovery needs schemas, not a compiled private-data executor.
    const ajv = new Ajv({ strict: true });
    for (const [name, format] of Object.entries(fullFormats)) {
      ajv.addFormat(name, format);
    }
    validators = { input: ajv.compile(input), output: ajv.compile(output) };
  }
  return validators;
}
export type UserExportDb = {
  rpc(name: string, args: Obj): PromiseLike<{ data: unknown; error: unknown }>;
};
export async function executeTenantExportDownload(
  userDb: UserExportDb,
  args: unknown,
): Promise<Response> {
  const fail = (status: number, error: string) =>
    Response.json({ ok: false, error, executed: false }, {
      status,
      headers: { "cache-control": "no-store" },
    });
  if (!object(args) || !deliveryValidators().input(args)) {
    return fail(400, "invalid_arguments");
  }
  try {
    const { data, error } = await userDb.rpc("sandy_tenant_export_download", {
      p_snapshot: args.snapshot_id,
    });
    if (error || !object(data)) {
      return fail(503, "tenant_export_download_unavailable");
    }
    if (
      data.ok === false &&
      [403, 404, 410, 424].includes(Number(data.http_status))
    ) {
      return fail(
        Number(data.http_status),
        Number(data.http_status) === 403
          ? "confirmed_portal_customer_session_required"
          : Number(data.http_status) === 410
          ? "tenant_export_expired_or_purged"
          : Number(data.http_status) === 424
          ? "verified_tenant_export_download_required"
          : "tenant_export_not_found",
      );
    }
    if (
      !deliveryValidators().output(data) ||
      data.snapshot_id !== args.snapshot_id ||
      data.file_name !== "sandy-tenant-links-" + args.snapshot_id + ".json" ||
      JSON.stringify(data).length > 2200000
    ) {
      return fail(502, "tenant_export_download_projection_invalid");
    }
    return Response.json(data, {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": 'attachment; filename="' + data.file_name + '"',
      },
    });
  } catch {
    return fail(503, "tenant_export_download_unavailable");
  }
}
