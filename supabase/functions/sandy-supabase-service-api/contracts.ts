/** Declarative gateway metadata; provider SDK and credentials live only in index.ts. */
import catalogue from "./contracts.json" with { type: "json" };
export type JsonObject = Record<string, unknown>;
export type ServiceOperation = {
  operation: string;
  requirement: number;
  action: string;
  kind: string;
  is_mutation: boolean;
  requires_grant: boolean;
  requires_cost_approval: boolean;
  sensitive: boolean;
  permission_scope: string;
  input_schema: JsonObject;
  result_schema: JsonObject;
  output_schema: JsonObject;
  contract_sha256: string;
  description: string;
};
export const serviceHandler = "sandy-supabase-service-api";
export const serviceProject = "zmqlyygzqoidkcwdysok";
export const serviceScope = Object.freeze({
  provider: "supabase",
  project_ref: serviceProject,
  resource_namespace: "sandy-service-v1",
  resource_policy: "confirmed_tenant_consent_v1",
});
export const serviceOperations: Readonly<Record<string, ServiceOperation>> =
  Object.freeze(
    Object.fromEntries(
      catalogue.operations.map((op) => [op.operation, op as ServiceOperation]),
    ),
  );
export const serviceOperationNames = Object.freeze(
  Object.keys(serviceOperations),
);
