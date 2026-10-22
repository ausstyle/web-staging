/** Source-owned read-only parent/content projection metadata. */
import catalogue from "./content_contracts.json" with { type: "json" };
import manifest from "./content_manifest.json" with { type: "json" };
export const contentExportScope = Object.freeze(catalogue.scope);
export const contentExportOperations = Object.freeze(
  Object.fromEntries(catalogue.operations.map((op) => [op.operation, op])),
);
export const contentExportOperationNames = Object.freeze(
  Object.keys(contentExportOperations),
);
export const contentExportRpcName = "sandy_tenant_content_execute";
export function contentExportExecutionScope(operation: string) {
  if (!contentExportOperations[operation]) {
    throw Error("operation_not_implemented");
  }
  return contentExportScope;
}
type Obj = Record<string, unknown>;
// PostgreSQL text[] permits NULL elements and at most six dimensions.
function textArray(depth = 6): Obj {
  return {
    type: "array",
    items: {
      anyOf: [
        { type: "string" },
        { type: "null" },
        ...(depth > 1 ? [textArray(depth - 1)] : []),
      ],
    },
  };
}
export const contentRowSchemas = Object.freeze(
  Object.fromEntries(manifest.tables.map((table) => [table.table, {
    type: "object",
    properties: Object.fromEntries(table.columns.map((column) => {
      let schema: Obj = column.type === "uuid"
        ? { type: "string", format: "uuid" }
        : column.type === "timestamp with time zone"
        ? { type: "string", format: "date-time" }
        : column.type === "boolean"
        ? { type: "boolean" }
        : column.type === "integer"
        ? { type: "integer", minimum: -2147483648, maximum: 2147483647 }
        : column.type === "jsonb"
        ? {
          type: "array",
          maxItems: 21,
          items: { type: "string", maxLength: 254 },
        }
        : column.type === "text[]"
        ? textArray()
        : { type: "string" };
      if (column.nullable) schema = { anyOf: [schema, { type: "null" }] };
      return [column.name, schema];
    })),
    required: table.columns.map((c) => c.name),
    additionalProperties: false,
  }])),
);
