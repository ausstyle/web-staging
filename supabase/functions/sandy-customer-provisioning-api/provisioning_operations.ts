/** Compact source manifest; registry schemas are fully materialized contracts. */
import manifest from "./provisioning_manifest.json" with { type: "json" };
type Obj = Record<string, unknown>;
export type CustomerOperation = {
  operation: string;
  contract_version: string;
  handler: string;
  permission_scope: string;
  is_mutation: boolean;
  requires_portal?: boolean;
  input_schema: Obj;
  output_schema: Obj;
  description: string;
  contract_sha256: string;
};
export const provisioningOperations: Readonly<
  Record<string, CustomerOperation>
> = Object.freeze(Object.fromEntries(manifest.operations.map((entry) => {
  const { result_schema, ...contract } = entry;
  return [entry.operation, {
    ...contract,
    output_schema: {
      ...manifest.output_base,
      properties: {
        ...manifest.output_base.properties,
        result: manifest
          .result_schemas[
            result_schema as keyof typeof manifest.result_schemas
          ],
      },
    },
  }];
})));
