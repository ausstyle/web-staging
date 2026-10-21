/** Additive v2 maintenance contracts. The original 78-contract release remains
 * frozen until this module and its private SQL boundary are separately wired.
 */
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  databaseHandler,
  databaseProject,
  databaseScope,
} from "./contracts.ts";

type Schema = Record<string, unknown>;
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const identifier = { type: "string", pattern: "^[a-z_][a-z0-9_]{0,62}$" };
const uuid = { type: "string", format: "uuid" };
const parameter = object({
  type: {
    enum: [
      "text",
      "int4",
      "int8",
      "numeric",
      "bool",
      "uuid",
      "timestamptz",
      "date",
      "jsonb",
    ],
  },
  value: {},
});
const query = object({
  sql: { type: "string", minLength: 1, maxLength: 4096 },
  parameters: { type: "array", maxItems: 32, items: parameter },
}, ["sql"]);
const verification = object({
  ...(query.properties as Record<string, Schema>),
  expected_rows: {
    type: "array",
    maxItems: 100,
    items: { type: "object", maxProperties: 100 },
  },
}, ["sql", "expected_rows"]);
const command = object({
  ...(query.properties as Record<string, Schema>),
  max_affected_rows: { type: "integer", minimum: 1, maximum: 100 },
  verifications: {
    type: "array",
    minItems: 1,
    maxItems: 5,
    items: verification,
  },
}, ["sql", "max_affected_rows", "verifications"]);
const standing = object({
  expires_at: { type: "string", format: "date-time" },
  max_runs: { type: "integer", minimum: 1, maximum: 100 },
  min_interval_seconds: { type: "integer", minimum: 60, maximum: 86400 },
});
const schedule = {
  type: "string",
  minLength: 9,
  maxLength: 100,
  pattern: "^[0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+$",
};
const name = { type: "string", minLength: 1, maxLength: 120 };
const output = (operation: string) =>
  object({
    ok: { const: true },
    operation: { const: operation },
    contract_version: { const: "2.0.0" },
    provider: { const: "supabase" },
    project_ref: { const: databaseProject },
    provider_protocol: { enum: ["postgres", "management_https"] },
    provider_http_status: {
      type: ["integer", "null"],
      minimum: 100,
      maximum: 599,
    },
    admission_id: uuid,
    request_state: { enum: ["accepted", "observed"] },
    executed: { const: true },
    result: { type: "object", maxProperties: 50 },
  });
export type MaintenanceKind =
  | "vacuum_native"
  | "cron_guarded_create"
  | "cron_guarded_update"
  | "maintenance_receipt";
export type MaintenanceContract = {
  operation: string;
  kind: MaintenanceKind;
  requirement: number;
  is_mutation: boolean;
  permission_scope: string;
  handler: string;
  description: string;
  input_schema: Schema;
  output_schema: Schema;
  contract_sha256: string;
  requires_grant: true;
  requires_approval: true;
  api_key_delegable: false;
};
const descriptors: Omit<
  MaintenanceContract,
  | "handler"
  | "output_schema"
  | "contract_sha256"
  | "requires_grant"
  | "requires_approval"
  | "api_key_delegable"
>[] = [
  {
    operation: "supabase.database.vacuum",
    kind: "vacuum_native",
    requirement: 98,
    is_mutation: true,
    permission_scope: "infrastructure:write",
    description:
      "Run one table VACUUM outside a transaction over an explicitly configured, certificate-verified direct project PostgreSQL session with server deadlines. Record command completion separately from pg_stat readback; no automatic retry or invented HTTP status. Contract v2.0.0.",
    input_schema: object({
      table: identifier,
      analyze: { type: "boolean" },
      freeze: { type: "boolean" },
    }, ["table"]),
  },
  {
    operation: "supabase.database.cron.jobs.create",
    kind: "cron_guarded_create",
    requirement: 101,
    is_mutation: true,
    permission_scope: "infrastructure:write",
    description:
      "Create a guarded pg_cron wrapper with exact approved command and finite revocable standing authorization. Every run rechecks owner, contract, approval, schema and shared rate limits, with atomic postconditions and no retry after failure. Contract v2.0.0.",
    input_schema: object({ name, schedule, command, standing }),
  },
  {
    operation: "supabase.database.cron.jobs.update",
    kind: "cron_guarded_update",
    requirement: 101,
    is_mutation: true,
    permission_scope: "infrastructure:write",
    description:
      "Replace an owned guarded schedule at its expected revision using a fresh exact approval and complete finite standing policy. Ordinary or foreign pg_cron jobs cannot be adopted. Contract v2.0.0.",
    input_schema: object({
      schedule_id: uuid,
      expected_revision: { type: "integer", minimum: 1 },
      name,
      schedule,
      command,
      standing,
      active: { type: "boolean" },
    }, ["schedule_id", "expected_revision", "schedule", "command", "standing"]),
  },
  {
    operation: "supabase.database.maintenance.receipt.get",
    kind: "maintenance_receipt",
    requirement: 98,
    is_mutation: false,
    permission_scope: "infrastructure:read",
    description:
      "Read an owned maintenance receipt under a fresh verified owner read approval, without repeating an expired or unknown native command or exposing private leases, connection credentials or SQL. Contract v2.0.0.",
    input_schema: object({ request_id: uuid }),
  },
];
export const maintenanceOperations: Readonly<
  Record<string, MaintenanceContract>
> = Object.freeze(Object.fromEntries(
  await Promise.all(descriptors.map(async (descriptor) => {
    const source = {
      ...descriptor,
      handler: databaseHandler,
      output_schema: output(descriptor.operation),
      requires_grant: true as const,
      requires_approval: true as const,
      api_key_delegable: false as const,
    };
    return [descriptor.operation, {
      ...source,
      contract_sha256: await argumentDigest(source),
    }];
  })),
));
export const maintenanceExecutionScope = (operation: string) => {
  if (!Object.hasOwn(maintenanceOperations, operation)) {
    throw new Error("unknown_maintenance_operation");
  }
  return databaseScope;
};
export const isMaintenanceOperation = (operation: unknown): boolean =>
  typeof operation === "string" &&
  Object.hasOwn(maintenanceOperations, operation);
