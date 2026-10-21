/** Concrete database contracts. Wildcard requirements remain families, not one generic SQL claim. */
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
export const databaseProject = "zmqlyygzqoidkcwdysok";
export const databaseHandler = "sandy-database-operation-api";
export const databaseScope = Object.freeze({
  provider: "supabase",
  project_ref: databaseProject,
  database: "postgres",
  schema: "public",
});
type Schema = Record<string, unknown>;
const text = { type: "string" };
const ident = { type: "string", pattern: "^[a-z_][a-z0-9_]{0,62}$" };
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const version = { type: "string", pattern: "^[0-9]{14}_[a-z][a-z0-9_]{0,80}$" };
const scalar = {
  type: "string",
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
};
const role = {
  type: "string",
  pattern: "^sandy_customer_[a-z][a-z0-9_]{0,45}$",
};
const grantee = { anyOf: [{ enum: ["authenticated", "anon"] }, role] };
const arr = (items: Schema, maxItems = 100, minItems = 1): Schema => ({
  type: "array",
  items,
  minItems,
  maxItems,
});
const obj = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
  extra: Schema = {},
): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
  ...extra,
});
const parameter = obj({ type: scalar, value: {} });
const statement = obj({
  sql: { type: "string", minLength: 1, maxLength: 65536 },
  parameters: arr(parameter, 32, 0),
}, ["sql"]);
const verification = obj({
  ...statement.properties as Record<string, Schema>,
  expected_rows: arr({ type: "object", additionalProperties: true }, 100, 0),
}, ["sql", "expected_rows"]);
const migration = obj({
  version,
  name: { type: "string", minLength: 1, maxLength: 160 },
  expected_before_sha256: digest,
});
const commonDdl = { migration };
const limit = { type: "integer", minimum: 1, maximum: 1000 };
const maxAffected = { type: "integer", minimum: 1, maximum: 1000 };
const expression = statement;
const filter = obj({
  column: ident,
  operator: {
    enum: ["eq", "ne", "lt", "lte", "gt", "gte", "is_null", "not_null", "in"],
  },
  value: parameter,
  values: arr(parameter, 32),
}, ["column", "operator"]);
const filters = arr(filter, 20);
const values = {
  type: "object",
  minProperties: 1,
  maxProperties: 100,
  propertyNames: ident,
  additionalProperties: true,
};
const columns = arr(ident, 100);
const column = obj({
  name: ident,
  type: scalar,
  nullable: { type: "boolean" },
  default: expression,
}, ["name", "type", "nullable"]);
const args = arr(obj({ name: ident, type: scalar }), 32, 0);
const functionFields = {
  name: ident,
  arguments: args,
  returns: scalar,
  body: { type: "string", minLength: 1, maxLength: 65536 },
  volatility: { enum: ["immutable", "stable", "volatile"] },
};
const procedureFields = {
  name: ident,
  arguments: args,
  body: functionFields.body,
};
const typeIdentity = obj({ name: ident, argument_types: arr(scalar, 32, 0) });
const policyFields = {
  table: ident,
  name: ident,
  roles: arr(grantee, 20),
  command: { enum: ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"] },
  permissive: { type: "boolean" },
  using: expression,
  check: expression,
};
const tablePrivileges = {
  enum: ["SELECT", "INSERT", "UPDATE", "DELETE", "REFERENCES", "TRIGGER"],
};
export type DatabaseContract = {
  operation: string;
  requirement: number;
  is_mutation: boolean;
  permission_scope: string;
  kind: string;
  description: string;
  input_schema: Schema;
  output_schema: Schema;
  requires_grant: true;
  requires_approval: true;
  api_key_delegable: false;
  contract_sha256: string;
};
const descriptors: Omit<
  DatabaseContract,
  | "output_schema"
  | "contract_sha256"
  | "permission_scope"
  | "requires_grant"
  | "requires_approval"
  | "api_key_delegable"
>[] = [];
function add(
  operation: string,
  requirement: number,
  mutation: boolean,
  kind: string,
  schema: Schema,
  detail: string,
) {
  descriptors.push({
    operation,
    requirement,
    is_mutation: mutation,
    kind,
    input_schema: schema,
    description:
      `${detail} Fixed project/public-schema database service; contract v1.0.0. Requires enabled owner, exact one-use scoped approval and live verification; no delegated key.`,
  });
}
function ddl(
  operation: string,
  requirement: number,
  fields: Record<string, Schema>,
  required = Object.keys(fields),
  detail =
    "Execute this concrete schema change inside the versioned transaction and verify its catalogue postcondition.",
) {
  add(
    operation,
    requirement,
    true,
    "ddl",
    obj({ ...commonDdl, ...fields }, ["migration", ...required]),
    detail,
  );
}
add(
  "supabase.sql.query",
  88,
  false,
  "query",
  obj({ ...statement.properties as Record<string, Schema>, limit }, ["sql"]),
  "Run one parameterized, passive SELECT with actual read_only enforcement, bounded rows and a pure-function/object policy.",
);
add(
  "supabase.sql.receipt.get",
  89,
  false,
  "receipt_get",
  obj({ source_request_id: { type: "string", format: "uuid" } }),
  "Reconcile one original database command using the same actual owner's request ID and a fresh read grant; this reads the durable receipt without re-dispatching SQL or depending on the original expired/unknown admission.",
);
add(
  "supabase.sql.execute",
  89,
  true,
  "dml",
  obj({
    ...statement.properties as Record<string, Schema>,
    max_affected_rows: maxAffected,
    verification,
  }, ["sql", "max_affected_rows", "verification"]),
  "Run one parameterized INSERT/UPDATE/DELETE RETURNING, cap affected rows, verify the explicit postcondition and record an atomic receipt.",
);
add(
  "supabase.sql.transaction",
  90,
  true,
  "transaction",
  obj({
    statements: arr(statement, 20),
    max_affected_rows: maxAffected,
    verification,
  }),
  "Execute parameterized data statements and postcondition in one all-or-nothing database transaction; DDL uses the migration engine.",
);
add(
  "supabase.db.diff",
  81,
  false,
  "diff",
  obj({
    baseline: arr(
      obj({
        kind: text,
        schema: { const: "public" },
        name: text,
        sha256: digest,
      }),
      2000,
      0,
    ),
  }),
  "Compare a public schema object manifest with current catalogue digests; return bounded added/removed/changed identities, not invented migration SQL.",
);
add(
  "supabase.db.migrations.plan",
  82,
  false,
  "migration_plan",
  obj({
    migration,
    statements: arr(statement, 100),
    smoke_tests: arr(verification, 20),
  }),
  "Parse a versioned transaction, bind values, compute checksum, inspect current schema and ledger, and report drift/conflict without executing the migration.",
);
add(
  "supabase.db.migrations.verify",
  82,
  false,
  "migration_verify",
  obj({ version, checksum: digest, expected_schema_sha256: digest }),
  "Verify the Sandy transaction ledger checksum against the current catalogue snapshot; distinct from the provider migration ledger.",
);
add(
  "supabase.db.migrations.transactional_apply",
  82,
  true,
  "migration_apply",
  obj({
    migration,
    statements: arr(statement, 100),
    smoke_tests: arr(verification, 20),
  }),
  "Apply a checksum-bound Sandy migration under a transaction advisory lock, execute smoke tests, record before/after schema digests and an atomic receipt; identical version/checksum replays without executing statements.",
);
add(
  "supabase.db.migrations.ledger.list",
  82,
  false,
  "migration_list",
  obj({ limit }, []),
  "List private Sandy transaction-ledger metadata without SQL bodies or customer result data; existing provider migrations.list is unchanged.",
);
add(
  "supabase.db.migrations.ledger.repair",
  82,
  true,
  "migration_repair",
  obj({
    version,
    expected_checksum: digest,
    replacement_checksum: digest,
    expected_schema_sha256: digest,
    reason: { type: "string", minLength: 12, maxLength: 2000 },
    smoke_tests: arr(verification, 20),
  }),
  "Append a checksum reconciliation revision only after current schema and smoke-test checks; never silently replay, undo or erase applied migration history.",
);

ddl("supabase.schema.tables.create", 91, {
  name: ident,
  columns: arr(column, 100),
  primary_key: columns,
}, ["name", "columns"]);
ddl("supabase.schema.tables.add_column", 91, { table: ident, column });
ddl("supabase.schema.tables.alter_column", 91, {
  table: ident,
  column: ident,
  type: scalar,
  nullable: { type: "boolean" },
  default: expression,
  drop_default: { const: true },
}, ["table", "column"]);
ddl("supabase.schema.tables.drop_column", 91, { table: ident, column: ident });
ddl("supabase.schema.tables.rename", 91, { name: ident, new_name: ident });
ddl("supabase.schema.tables.drop", 91, { name: ident });
for (
  const [family, materialized] of [["views", false], [
    "materialized_views",
    true,
  ]] as const
) {
  ddl(`supabase.schema.${family}.create`, 91, {
    name: ident,
    query: statement,
  });
  if (!materialized) {
    ddl("supabase.schema.views.replace", 91, { name: ident, query: statement });
  }
  if (materialized) {
    ddl("supabase.schema.materialized_views.refresh", 91, {
      name: ident,
      definition_sql: { type: "string", minLength: 1, maxLength: 65536 },
    });
  }
  ddl(`supabase.schema.${family}.drop`, 91, { name: ident });
}
add(
  "supabase.schema.functions.get",
  92,
  false,
  "routine_get",
  typeIdentity,
  "Read exact function identity, owner execution mode, language and body SHA without returning its potentially sensitive source.",
);
for (const action of ["create", "replace"]) {
  ddl(`supabase.schema.functions.${action}`, 92, functionFields, [
    "name",
    "arguments",
    "returns",
    "body",
  ]);
  ddl(`supabase.schema.procedures.${action}`, 92, procedureFields);
}
ddl(
  "supabase.schema.functions.drop",
  92,
  typeIdentity.properties as Record<string, Schema>,
);
ddl(
  "supabase.schema.procedures.drop",
  92,
  typeIdentity.properties as Record<string, Schema>,
);
ddl("supabase.schema.triggers.create", 92, {
  table: ident,
  name: ident,
  timing: { enum: ["BEFORE", "AFTER"] },
  events: arr({ enum: ["INSERT", "UPDATE", "DELETE"] }, 3),
  function: ident,
  function_sha256: digest,
});
for (const action of ["drop", "enable", "disable"]) {
  ddl(`supabase.schema.triggers.${action}`, 92, { table: ident, name: ident });
}
ddl("supabase.schema.indexes.create", 93, {
  table: ident,
  name: ident,
  columns,
  unique: { type: "boolean" },
  method: { enum: ["btree", "hash", "gin", "gist", "spgist", "brin"] },
  predicate: expression,
}, ["table", "name", "columns"]);
ddl("supabase.schema.indexes.drop", 93, { name: ident });
ddl("supabase.schema.constraints.add", 93, {
  table: ident,
  name: ident,
  kind: { enum: ["check", "unique", "foreign_key"] },
  columns,
  expression,
  references_table: ident,
  references_columns: columns,
  on_delete: { enum: ["RESTRICT", "CASCADE", "SET NULL", "NO ACTION"] },
  not_valid: { type: "boolean" },
}, ["table", "name", "kind"]);
for (const action of ["drop", "validate"]) {
  ddl(`supabase.schema.constraints.${action}`, 93, {
    table: ident,
    name: ident,
  });
}
ddl("supabase.schema.types.create", 93, {
  name: ident,
  labels: arr({ type: "string", minLength: 1, maxLength: 63 }, 100),
});
ddl("supabase.schema.types.enum.add_value", 93, {
  name: ident,
  value: { type: "string", minLength: 1, maxLength: 63 },
});
ddl("supabase.schema.types.enum.rename_value", 93, {
  name: ident,
  value: { type: "string", minLength: 1, maxLength: 63 },
  new_value: { type: "string", minLength: 1, maxLength: 63 },
});
ddl("supabase.schema.types.drop", 93, { name: ident });
for (const action of ["create", "update", "drop"]) {
  ddl(
    `supabase.schema.extensions.${action}`,
    93,
    {
      name: {
        type: "string",
        enum: [
          "pg_trgm",
          "btree_gin",
          "btree_gist",
          "citext",
          "unaccent",
          "uuid-ossp",
          "vector",
          "pg_stat_statements",
        ],
      },
      version: { type: "string", pattern: "^[0-9]+(?:[.][0-9]+){0,3}$" },
    },
    ["name"],
    "Manage only reviewed non-network extensions; provider availability and privileges remain real preconditions. Existing pg_net/http/FDW/dblink/network extensions cannot be installed through SQL.",
  );
}
for (const action of ["create", "alter", "drop"]) {
  ddl(
    `supabase.database.roles.${action}`,
    94,
    {
      name: role,
      inherit: { type: "boolean" },
      connection_limit: { type: "integer", minimum: 0, maximum: 100 },
    },
    ["name"],
    "Manage a dedicated sandy_customer_* NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS role; no password or role-membership escalation.",
  );
}
for (const action of ["grant", "revoke"]) {
  ddl(`supabase.database.grants.${action}`, 94, {
    table: ident,
    role: grantee,
    privileges: arr(tablePrivileges, 6),
  });
  ddl(`supabase.database.default_privileges.${action}`, 94, {
    role: grantee,
    privileges: arr(tablePrivileges, 6),
  });
}
ddl("supabase.database.rls.policies.create", 95, policyFields, [
  "table",
  "name",
  "roles",
  "command",
]);
ddl("supabase.database.rls.policies.alter", 95, {
  table: ident,
  name: ident,
  roles: arr(grantee, 20),
  using: expression,
  check: expression,
}, ["table", "name"]);
ddl("supabase.database.rls.policies.drop", 95, { table: ident, name: ident });
for (const action of ["enable", "disable"]) {
  ddl(`supabase.database.rls.${action}`, 95, { table: ident });
}
ddl("supabase.database.replication.publications.create", 96, {
  name: ident,
  tables: arr(ident, 100),
  publish: arr({ enum: ["insert", "update", "delete", "truncate"] }, 4),
}, ["name", "tables"]);
ddl("supabase.database.replication.publications.alter", 96, {
  name: ident,
  tables: arr(ident, 100),
});
ddl("supabase.database.replication.publications.drop", 96, { name: ident });
add(
  "supabase.database.replication.publications.list",
  96,
  false,
  "publication_list",
  obj({}),
  "List publication identities, flags and explicitly published public tables; subscription credentials and connection strings are excluded.",
);
for (const action of ["insert", "upsert", "bulk_import"]) {
  add(
    `supabase.data.${action}`,
    97,
    true,
    `data_${action}`,
    obj(
      {
        table: ident,
        rows: arr(values, action === "bulk_import" ? 1000 : 100),
        conflict_columns: columns,
        max_affected_rows: maxAffected,
        verification,
      },
      action === "upsert"
        ? [
          "table",
          "rows",
          "conflict_columns",
          "max_affected_rows",
          "verification",
        ]
        : ["table", "rows", "max_affected_rows", "verification"],
    ),
    "Bind typed JSON rows into the fixed public relation, cap affected rows, enforce constraints/triggers and verify the caller-approved database postcondition atomically.",
  );
}
add(
  "supabase.data.update",
  97,
  true,
  "data_update",
  obj({
    table: ident,
    values,
    filters,
    max_affected_rows: maxAffected,
    verification,
  }),
  "Update only rows selected by nonempty bound filters; reject identity/provider/routing overrides and protect policy/credential tables.",
);
add(
  "supabase.data.delete",
  97,
  true,
  "data_delete",
  obj({ table: ident, filters, max_affected_rows: maxAffected, verification }),
  "Delete only rows selected by nonempty bound filters inside the receipt transaction; no unbounded delete or implicit CASCADE flag.",
);
add(
  "supabase.data.bulk_export",
  97,
  false,
  "data_export",
  obj({
    table: ident,
    columns,
    filters,
    order_by: columns,
    limit,
    offset: { type: "integer", minimum: 0, maximum: 1000000 },
  }, ["table", "columns", "order_by", "limit"]),
  "Export explicitly selected columns with deterministic ordering and bounded offset/rows under actual read_only; each call has its own database snapshot.",
);
add(
  "supabase.database.explain",
  98,
  false,
  "explain",
  obj({ ...statement.properties as Record<string, Schema> }, ["sql"]),
  "EXPLAIN FORMAT JSON for a passive SELECT; ANALYZE and executable expressions outside the pure read policy are refused.",
);
for (const action of ["analyze", "vacuum", "reindex"]) {
  add(
    `supabase.database.${action}`,
    98,
    true,
    `maintenance_${action}`,
    obj({ table: ident }),
    "Run a fixed quoted maintenance command after exact one-use approval; report acceptance and actual catalogue/statistics readback, not a fabricated provider lifecycle result.",
  );
}
add(
  "supabase.database.slow_queries.list",
  99,
  false,
  "slow_queries",
  obj({ limit }, []),
  "Read bounded pg_stat_statements fingerprints/timing/call counts without SQL text, parameters, user identity or credentials; extension presence is required.",
);
for (const action of ["cancel", "terminate"]) {
  add(
    `supabase.database.connections.${action}`,
    99,
    true,
    `connection_${action}`,
    obj({
      pid: { type: "integer", minimum: 1, maximum: 2147483647 },
      expected_backend_start: { type: "string", format: "date-time" },
    }),
    "Target one non-system client backend only after binding its PID and start time; refuse the current backend, replication, internal workers and protected roles.",
  );
}
for (const action of ["create", "update", "delete"]) {
  add(
    `supabase.database.cron.jobs.${action}`,
    101,
    true,
    `cron_${action}`,
    obj(
      {
        job_id: { type: "integer", minimum: 1, maximum: 2147483647 },
        name: ident,
        schedule: { type: "string", minLength: 1, maxLength: 128 },
        command: statement,
        active: { type: "boolean" },
      },
      action === "create"
        ? ["name", "schedule", "command"]
        : action === "delete"
        ? ["job_id"]
        : ["job_id"],
    ),
    "Manage one pg_cron job using reviewed parameter-bound SQL only; no network functions, protected objects or arbitrary external URLs; persistent scheduling requires separately approved intent.",
  );
}
add(
  "supabase.database.webhooks.list",
  102,
  false,
  "webhook_list",
  obj({}),
  "List public webhook trigger identities without target URLs, headers, secrets or trigger arguments.",
);
// Physical backup/restore integrity is a provider operation. SQL does not pretend
// to create or verify a recoverable physical backup; those family gaps stay explicit.
function output(operation: string): Schema {
  return obj({
    ok: { const: true },
    operation: { const: operation },
    contract_version: { const: "1.0.0" },
    provider: { const: "supabase" },
    project_ref: { const: databaseProject },
    request_state: { enum: ["observed", "accepted"] },
    executed: { const: true },
    admission_id: { type: "string", format: "uuid" },
    provider_http_status: { type: "integer", minimum: 200, maximum: 299 },
    provider_request_id: { type: ["string", "null"] },
    result: {
      type: "object",
      required: [
        "ok",
        "contract_version",
        "operation",
        "project_ref",
        "read_only",
        "transactional",
        "mutation_committed",
        "verification_passed",
        "command_id",
        "statements",
        "result_limit",
        "possibly_truncated",
      ],
      properties: {
        ok: { const: true },
        contract_version: { const: "1.0.0" },
        operation: { const: operation },
        project_ref: { const: databaseProject },
        read_only: { type: "boolean" },
        transactional: { type: "boolean" },
        mutation_committed: { type: ["boolean", "null"] },
        verification_passed: { type: "boolean" },
        command_id: { type: ["string", "null"], format: "uuid" },
        statements: {
          type: "array",
          maxItems: 100,
          items: obj({
            row_count: { type: "integer", minimum: 0 },
            rows: {
              type: "array",
              maxItems: 1000,
              items: { type: "object", additionalProperties: true },
            },
            possibly_truncated: { type: "boolean" },
          }),
        },
        result_limit: limit,
        possibly_truncated: { type: "boolean" },
      },
      additionalProperties: true,
    },
  });
}
const records = await Promise.all(descriptors.map(async (descriptor) => {
  const contract = {
    ...descriptor,
    permission_scope: descriptor.is_mutation
      ? "infrastructure:write"
      : "infrastructure:read",
    requires_grant: true as const,
    requires_approval: true as const,
    api_key_delegable: false as const,
    output_schema: output(descriptor.operation),
  };
  return { ...contract, contract_sha256: await argumentDigest(contract) };
}));
export const databaseOperations: Readonly<Record<string, DatabaseContract>> =
  Object.freeze(
    Object.fromEntries(
      records.map((contract) => [contract.operation, contract]),
    ),
  );
export const databaseOperationNames = Object.freeze(
  records.map((contract) => contract.operation),
);
