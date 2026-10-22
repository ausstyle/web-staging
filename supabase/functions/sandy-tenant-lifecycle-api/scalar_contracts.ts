/** Additional reviewed manifest data; execution stays in the shared lifecycle boundary. */
import catalogue from "./scalar_contracts.json" with { type: "json" };
import manifest from "./scalar_manifest.json" with { type: "json" };
type Obj = Record<string, unknown>;
const obj = (properties: Obj): Obj => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const scalarManifestScope = Object.freeze({
  provider: "supabase",
  project_ref: "zmqlyygzqoidkcwdysok",
  manifest: manifest.id,
  complete_tenant_coverage: false,
});
export const scalarManifestOperations = Object.freeze(
  Object.fromEntries(catalogue.operations.map((op) => [op.operation, op])),
);
export const scalarManifestOperationNames = Object.freeze(
  Object.keys(scalarManifestOperations),
);
export function scalarManifestExecutionScope(operation: string): Obj {
  if (!scalarManifestOperations[operation]) {
    throw Error("operation_not_implemented");
  }
  return scalarManifestScope;
}
function columnSchema(
  column: typeof manifest.tables[number]["columns"][number],
): Obj {
  let schema: Obj;
  if (column.type === "uuid") schema = { type: "string", format: "uuid" };
  else if (column.type === "timestamp with time zone") {
    schema = { type: "string", format: "date-time" };
  } else if (column.type === "integer") {
    schema = { type: "integer", minimum: -2147483648, maximum: 2147483647 };
  } else if (column.type === "numeric") {
    schema = {
      type: "string",
      maxLength: manifest.maximum_text_characters,
      pattern: "^-?[0-9]+(\\.[0-9]+)?$",
    };
  } else {schema = {
      type: "string",
      maxLength: manifest.maximum_text_characters,
    };}
  return column.nullable ? { anyOf: [schema, { type: "null" }] } : schema;
}
export const scalarManifestPayloadSchema = obj({
  format_version: { const: "1.0.0" },
  tenant_id: { type: "string", format: "uuid" },
  manifest: { const: manifest.id },
  manifest_sha256: { const: manifest.manifest_sha256 },
  schema_sha256: { const: manifest.schema_sha256 },
  complete_tenant_coverage: { const: false },
  external_provider_assets_included: { const: false },
  tables: obj(Object.fromEntries(manifest.tables.map((table) => [table.table, {
    type: "array",
    maxItems: manifest.row_limit_per_table,
    items: obj(
      Object.fromEntries(
        table.columns.map((column) => [column.name, columnSchema(column)]),
      ),
    ),
  }]))),
});
