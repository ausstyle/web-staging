import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { type DatabaseContract, databaseOperations } from "./contracts.ts";
import {
  type CompiledStatement,
  compileSql,
  DatabaseCompileError,
  identifier,
  parameterLiteral,
  parsedStatement,
  physicalRelations,
  publicRelation,
  qualifyBuiltinFunctions,
  type ScalarType,
  scalarTypes,
  type SqlParameter,
  sqlString,
  trustedCommand,
  trustedQuery,
} from "./sql.ts";
type Row = Record<string, any>;
export type Verification = {
  sql: string;
  parameters: unknown[];
  expected_rows: Row[];
  passive_relations?: { schema: string; name: string }[];
};
export type DatabasePlan = {
  mode: "read" | "transaction" | "nontransactional";
  statements: CompiledStatement[];
  verifications: Verification[];
  result_limit: number;
  max_affected_rows: number;
  migration?: {
    version: string;
    name: string;
    checksum: string;
    expected_before_sha256: string;
  };
  repair?: Row;
  projection?: string;
  baseline?: Row[];
  metadata?: Row;
};
const bad = (code: string): never => {
  throw new DatabaseCompileError(code);
};
const type = (value: unknown) => {
  if (!scalarTypes.includes(value as ScalarType)) {
    return bad("invalid_database_type");
  }
  return `pg_catalog.${value}`;
};
const role = (value: string) => {
  if (
    !["authenticated", "anon"].includes(value) &&
    !/^sandy_customer_[a-z][a-z0-9_]{0,45}$/.test(value)
  ) return bad("protected_database_role");
  return identifier(value);
};
const check = (sql: string): Verification => ({
  sql,
  parameters: [],
  expected_rows: [{ ok: true }],
});
const base = (op: DatabaseContract, args: Row): DatabasePlan => ({
  mode: op.is_mutation ? "transaction" : "read",
  statements: [],
  verifications: [],
  result_limit: args.limit ?? 100,
  max_affected_rows: args.max_affected_rows ?? 1000,
});
const existsRelation = (name: string, kind?: string, absent = false) =>
  check(
    `SELECT ${
      absent ? "NOT " : ""
    }EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=${
      sqlString(name)
    }${kind ? ` AND c.relkind=${sqlString(kind)}` : ""}) AS ok`,
  );
async function expression(value: Row, policy = false): Promise<string> {
  const parsed = await parsedStatement(`SELECT ${value.sql}`, "query", policy);
  const query = parsed.SelectStmt as Row;
  const containsSubquery = (value: unknown): boolean =>
    Array.isArray(value)
      ? value.some(containsSubquery)
      : value !== null && typeof value === "object" &&
        (Object.hasOwn(value, "SubLink") ||
          Object.values(value).some(containsSubquery));
  if (containsSubquery(query)) return bad("scalar_subquery_not_supported");
  if (
    query.fromClause || query.withClause || query.intoClause ||
    query.sortClause || query.limitCount || query.valuesLists ||
    !Array.isArray(query.targetList) || query.targetList.length !== 1 ||
    query.targetList[0].ResTarget.name
  ) return bad("one_scalar_expression_required");
  return (await compileSql(
    `SELECT ${value.sql}`,
    value.parameters ?? [],
    "query",
    true,
    policy,
  )).sql.slice(7);
}
async function verification(value: Row): Promise<Verification> {
  const compiled = await compileSql(value.sql, value.parameters ?? [], "query");
  return {
    sql: compiled.sql,
    parameters: compiled.parameters,
    passive_relations: compiled.passive_relations,
    expected_rows: value.expected_rows,
  };
}
async function column(value: Row): Promise<string> {
  return `${identifier(value.name)} ${type(value.type)}${
    value.nullable ? "" : " NOT NULL"
  }${value.default ? ` DEFAULT (${await expression(value.default)})` : ""}`;
}
function unique(items: string[], code = "duplicate_database_identifiers") {
  if (new Set(items).size !== items.length) return bad(code);
}
function bound(parameter: SqlParameter, parameters: unknown[]): string {
  parameterLiteral(parameter); // shared closed type/value validator; no value interpolation.
  const index = parameters.push(parameter.value) - 1;
  return `(($1 ${parameter.type === "jsonb" ? "->" : "->>"} ${index})::${
    type(parameter.type)
  })`;
}
function filterSql(filters: Row[], parameters: unknown[]): string {
  if (!filters.length) return bad("nonempty_bound_filter_required");
  return filters.map((filter) => {
    const target = `target.${identifier(filter.column)}`;
    if (filter.operator === "is_null" || filter.operator === "not_null") {
      if (Object.hasOwn(filter, "value") || Object.hasOwn(filter, "values")) {
        return bad("invalid_database_filter");
      }
      return `${target} IS ${filter.operator === "not_null" ? "NOT " : ""}NULL`;
    }
    if (filter.operator === "in") {
      if (
        !Array.isArray(filter.values) || !filter.values.length ||
        Object.hasOwn(filter, "value")
      ) return bad("invalid_database_filter");
      return `(${
        filter.values.map((p: SqlParameter) =>
          `${target} OPERATOR(pg_catalog.=) ${bound(p, parameters)}`
        ).join(" OR ")
      })`;
    }
    const operators: Record<string, string> = {
      eq: "=",
      ne: "<>",
      lt: "<",
      lte: "<=",
      gt: ">",
      gte: ">=",
    };
    if (
      !operators[filter.operator] || !filter.value ||
      Object.hasOwn(filter, "values")
    ) return bad("invalid_database_filter");
    return `${target} OPERATOR(pg_catalog.${operators[filter.operator]}) ${
      bound(filter.value, parameters)
    }`;
  }).join(" AND ");
}
const snapshot = trustedQuery(
  "SELECT public.sandy_api_database_schema_snapshot() AS snapshot",
);
async function ddlPlan(op: DatabaseContract, args: Row): Promise<DatabasePlan> {
  const plan = base(op, args);
  const action = op.operation.split(".").at(-1)!;
  const family = op.operation.split(".").slice(0, -1).join(".");
  const name = args.name as string;
  let sql: string;
  let after: Verification;
  let sourceRelations: { schema: string; name: string }[] | undefined;
  const table = args.table ? publicRelation(args.table) : "";
  if (family === "supabase.schema.tables") {
    if (action === "create") {
      unique(args.columns.map((c: Row) => c.name));
      const names = new Set(args.columns.map((c: Row) => c.name));
      if (args.primary_key?.some((key: string) => !names.has(key))) {
        return bad("primary_key_column_missing");
      }
      if (args.primary_key) unique(args.primary_key);
      sql = `CREATE TABLE ${publicRelation(name)} (${
        (await Promise.all(args.columns.map(column))).join(",")
      }${
        args.primary_key
          ? `,PRIMARY KEY(${args.primary_key.map(identifier).join(",")})`
          : ""
      })`;
      after = existsRelation(name, "r");
    } else if (action === "add_column") {
      sql = `ALTER TABLE ${table} ADD COLUMN ${await column(args.column)}`;
      after = check(
        `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=${
          sqlString(`public.${args.table}`)
        }::regclass AND attname=${
          sqlString(args.column.name)
        } AND NOT attisdropped) AS ok`,
      );
    } else if (action === "alter_column") {
      const clauses: string[] = [];
      if (args.type) {
        clauses.push(
          `ALTER COLUMN ${identifier(args.column)} TYPE ${type(args.type)}`,
        );
      }
      if (Object.hasOwn(args, "nullable")) {
        clauses.push(
          `ALTER COLUMN ${identifier(args.column)} ${
            args.nullable ? "DROP" : "SET"
          } NOT NULL`,
        );
      }
      if (args.default && args.drop_default) {
        return bad("conflicting_column_default");
      }
      if (args.default) {
        clauses.push(
          `ALTER COLUMN ${
            identifier(args.column)
          } SET DEFAULT (${await expression(args.default)})`,
        );
      }
      if (args.drop_default) {
        clauses.push(`ALTER COLUMN ${identifier(args.column)} DROP DEFAULT`);
      }
      if (!clauses.length) return bad("column_change_required");
      sql = `ALTER TABLE ${table} ${clauses.join(",")}`;
      after = check(
        `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=${
          sqlString(`public.${args.table}`)
        }::regclass AND attname=${sqlString(args.column)} AND NOT attisdropped${
          args.type ? ` AND atttypid=${sqlString(args.type)}::regtype` : ""
        }${
          Object.hasOwn(args, "nullable")
            ? ` AND attnotnull=${args.nullable ? "false" : "true"}`
            : ""
        }${
          args.default || args.drop_default
            ? ` AND atthasdef=${args.drop_default ? "false" : "true"}`
            : ""
        }) AS ok`,
      );
    } else if (action === "drop_column") {
      sql = `ALTER TABLE ${table} DROP COLUMN ${
        identifier(args.column)
      } RESTRICT`;
      after = check(
        `SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=${
          sqlString(`public.${args.table}`)
        }::regclass AND attname=${
          sqlString(args.column)
        } AND NOT attisdropped) AS ok`,
      );
    } else if (action === "rename") {
      sql = `ALTER TABLE ${publicRelation(name)} RENAME TO ${
        identifier(args.new_name)
      }`;
      publicRelation(args.new_name);
      after = existsRelation(args.new_name, "r");
    } else {
      sql = `DROP TABLE ${publicRelation(name)} RESTRICT`;
      after = existsRelation(name, undefined, true);
    }
  } else if (
    ["supabase.schema.views", "supabase.schema.materialized_views"].includes(
      family,
    )
  ) {
    const materialized = family.includes("materialized");
    const subject = materialized ? "MATERIALIZED VIEW" : "VIEW";
    if (action === "drop") {
      sql = `DROP ${subject} ${publicRelation(name)} RESTRICT`;
      after = existsRelation(name, undefined, true);
    } else if (action === "refresh") {
      const definition = await compileSql(
        args.definition_sql,
        [],
        "query",
        true,
      );
      sourceRelations = definition.passive_relations ?? [];
      plan.metadata = {
        reviewed_materialized_view: {
          name,
          definition_sql: args.definition_sql,
        },
      };
      sql = `REFRESH MATERIALIZED VIEW ${publicRelation(name)}`;
      after = check(
        `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=${
          sqlString(name)
        } AND c.relkind='m' AND c.relispopulated) AS ok`,
      );
    } else {
      const query = await compileSql(
        args.query.sql,
        args.query.parameters ?? [],
        "query",
        true,
      );
      sourceRelations = query.passive_relations;
      sql = `CREATE ${action === "replace" ? "OR REPLACE " : ""}${subject} ${
        publicRelation(name)
      }${materialized ? "" : " WITH(security_invoker=true)"} AS ${query.sql}\n`;
      after = existsRelation(name, materialized ? "m" : "v");
    }
  } else if (
    ["supabase.schema.functions", "supabase.schema.procedures"].includes(family)
  ) {
    const procedure = family.includes("procedures");
    const subject = procedure ? "PROCEDURE" : "FUNCTION";
    publicRelation(name);
    if (action === "drop") {
      const identity = args.argument_types.map(type).join(",");
      sql = `DROP ${subject} ${publicRelation(name)}(${identity}) RESTRICT`;
      after = check(
        `SELECT pg_catalog.to_regprocedure(${
          sqlString(`public.${name}(${args.argument_types.join(",")})`)
        }) IS NULL AS ok`,
      );
    } else {
      unique(args.arguments.map((a: Row) => a.name));
      const body = await parsedStatement(
        args.body,
        procedure ? "definition" : "query",
      );
      if (
        procedure &&
        !["SelectStmt", "InsertStmt", "UpdateStmt", "DeleteStmt"].includes(
          Object.keys(body)[0],
        )
      ) return bad("sql_routine_body_not_allowed");
      sourceRelations = physicalRelations(
        body,
        procedure ? "definition" : "query",
      );
      const paramNumbers: number[] = [];
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") {
          for (const [k, child] of Object.entries(v)) {
            if (k === "ParamRef") {
              paramNumbers.push(Number((child as Row).number));
            }
            walk(child);
          }
        }
      };
      walk(body);
      if (
        paramNumbers.some((n) =>
          !Number.isInteger(n) || n < 1 || n > args.arguments.length
        )
      ) return bad("routine_argument_binding_missing");
      sql = `CREATE ${action === "replace" ? "OR REPLACE " : ""}${subject} ${
        publicRelation(name)
      }(${
        args.arguments.map((a: Row) => `${identifier(a.name)} ${type(a.type)}`)
          .join(",")
      }) ${
        procedure
          ? ""
          : `RETURNS ${type(args.returns)} ${
            String(args.volatility ?? "volatile").toUpperCase()
          } `
      }LANGUAGE SQL SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS ${
        sqlString(qualifyBuiltinFunctions(args.body, body))
      }`;
      after = check(
        `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=${
          sqlString(name)
        } AND p.prokind=${
          sqlString(procedure ? "p" : "f")
        } AND NOT p.prosecdef AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql')) AS ok`,
      );
    }
  } else if (family === "supabase.schema.triggers") {
    if (action === "create") {
      unique(args.events);
      publicRelation(args.function);
      // Existing trigger functions must be separately reviewed: bindings are checked
      // by the private engine before EXECUTE, never inferred from a caller alias.
      plan.metadata = {
        reviewed_trigger_function: args.function,
        reviewed_trigger_sha256: args.function_sha256,
      };
      sql = `CREATE TRIGGER ${identifier(name)} ${args.timing} ${
        args.events.join(" OR ")
      } ON ${table} FOR EACH ROW EXECUTE FUNCTION ${
        publicRelation(args.function)
      }()`;
    } else if (action === "drop") {
      sql = `DROP TRIGGER ${identifier(name)} ON ${table} RESTRICT`;
    } else {sql = `ALTER TABLE ${table} ${action.toUpperCase()} TRIGGER ${
        identifier(name)
      }`;}
    after = check(
      `SELECT ${
        action === "drop" ? "NOT " : ""
      }EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=${
        sqlString(`public.${args.table}`)
      }::regclass AND t.tgname=${sqlString(name)} AND NOT t.tgisinternal${
        ["enable", "disable"].includes(action)
          ? ` AND t.tgenabled=${sqlString(action === "disable" ? "D" : "O")}`
          : ""
      }) AS ok`,
    );
  } else if (family === "supabase.schema.indexes") {
    if (action === "drop") {
      sql = `DROP INDEX ${publicRelation(name)} RESTRICT`;
      after = existsRelation(name, undefined, true);
    } else {
      sourceRelations = [{ schema: "public", name: args.table }];
      unique(args.columns);
      sql = `CREATE ${args.unique ? "UNIQUE " : ""}INDEX ${
        identifier(name)
      } ON ${table} USING ${args.method ?? "btree"} (${
        args.columns.map(identifier).join(",")
      })${
        args.predicate ? ` WHERE (${await expression(args.predicate)})` : ""
      }`;
      after = check(
        `SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid=${
          sqlString(`public.${name}`)
        }::regclass AND i.indrelid=${
          sqlString(`public.${args.table}`)
        }::regclass AND i.indisvalid AND i.indisunique=${
          args.unique ? "true" : "false"
        }) AS ok`,
      );
    }
  } else if (family === "supabase.schema.constraints") {
    if (action === "drop") {
      sql = `ALTER TABLE ${table} DROP CONSTRAINT ${identifier(name)} RESTRICT`;
    } else if (action === "validate") {
      sql = `ALTER TABLE ${table} VALIDATE CONSTRAINT ${identifier(name)}`;
    } else {
      if (args.kind === "check") {
        if (
          !args.expression || args.columns || args.references_table ||
          args.references_columns || args.on_delete
        ) return bad("invalid_check_constraint");
        sql = `ALTER TABLE ${table} ADD CONSTRAINT ${
          identifier(name)
        } CHECK (${await expression(args.expression)})${
          args.not_valid ? " NOT VALID" : ""
        }`;
      } else {
        if (!args.columns?.length || args.expression) {
          return bad("invalid_column_constraint");
        }
        unique(args.columns);
        if (args.kind === "unique") {
          if (
            args.not_valid || args.references_table ||
            args.references_columns || args.on_delete
          ) return bad("invalid_unique_constraint");
          sql = `ALTER TABLE ${table} ADD CONSTRAINT ${
            identifier(name)
          } UNIQUE(${args.columns.map(identifier).join(",")})`;
        } else {
          if (
            !args.references_table || !args.references_columns ||
            args.references_columns.length !== args.columns.length
          ) return bad("foreign_key_columns_required");
          unique(args.references_columns);
          sql = `ALTER TABLE ${table} ADD CONSTRAINT ${
            identifier(name)
          } FOREIGN KEY(${args.columns.map(identifier).join(",")}) REFERENCES ${
            publicRelation(args.references_table)
          }(${args.references_columns.map(identifier).join(",")}) ON DELETE ${
            args.on_delete ?? "NO ACTION"
          }${args.not_valid ? " NOT VALID" : ""}`;
        }
      }
    }
    after = check(
      `SELECT ${
        action === "drop" ? "NOT " : ""
      }EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=${
        sqlString(`public.${args.table}`)
      }::regclass AND conname=${sqlString(name)}${
        action === "validate" || action === "add"
          ? ` AND convalidated=${args.not_valid ? "false" : "true"}`
          : ""
      }) AS ok`,
    );
  } else if (
    family === "supabase.schema.types" ||
    family === "supabase.schema.types.enum"
  ) {
    if (action === "create") {
      unique(args.labels, "duplicate_enum_labels");
      sql = `CREATE TYPE ${publicRelation(name)} AS ENUM(${
        args.labels.map(sqlString).join(",")
      })`;
    } else if (action === "add_value") {
      sql = `ALTER TYPE ${publicRelation(name)} ADD VALUE ${
        sqlString(args.value)
      }`;
    } else if (action === "rename_value") {
      sql = `ALTER TYPE ${publicRelation(name)} RENAME VALUE ${
        sqlString(args.value)
      } TO ${sqlString(args.new_value)}`;
    } else sql = `DROP TYPE ${publicRelation(name)} RESTRICT`;
    after = check(
      `SELECT ${
        action === "drop" ? "NOT " : ""
      }EXISTS(SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname=${
        sqlString(name)
      }${
        action === "add_value" || action === "rename_value"
          ? ` AND EXISTS(SELECT 1 FROM pg_catalog.pg_enum e WHERE e.enumtypid=t.oid AND e.enumlabel=${
            sqlString(args.new_value ?? args.value)
          })`
          : ""
      }) AS ok`,
    );
  } else if (family === "supabase.schema.extensions") {
    const extension = name === "uuid-ossp" ? '"uuid-ossp"' : identifier(name);
    sql = action === "create"
      ? `CREATE EXTENSION ${extension} WITH SCHEMA public${
        args.version ? ` VERSION ${sqlString(args.version)}` : ""
      }`
      : action === "update"
      ? `ALTER EXTENSION ${extension} UPDATE${
        args.version ? ` TO ${sqlString(args.version)}` : ""
      }`
      : `DROP EXTENSION ${extension} RESTRICT`;
    after = check(
      `SELECT ${
        action === "drop" ? "NOT " : ""
      }EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname=${
        sqlString(name)
      }${
        args.version && action !== "drop"
          ? ` AND extversion=${sqlString(args.version)}`
          : ""
      }) AS ok`,
    );
  } else if (family === "supabase.database.roles") {
    role(name);
    if (!["create", "alter", "drop"].includes(action)) {
      return bad("invalid_role_action");
    }
    sql = action === "drop"
      ? `DROP ROLE ${identifier(name)}`
      : `${action === "create" ? "CREATE" : "ALTER"} ROLE ${
        identifier(name)
      } NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS ${
        args.inherit === false ? "NOINHERIT" : "INHERIT"
      } CONNECTION LIMIT ${args.connection_limit ?? 0}`;
    after = check(
      `SELECT ${
        action === "drop" ? "NOT " : ""
      }EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=${
        sqlString(name)
      }${
        action !== "drop"
          ? " AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls"
          : ""
      }) AS ok`,
    );
  } else if (
    family === "supabase.database.grants" ||
    family === "supabase.database.default_privileges"
  ) {
    unique(args.privileges);
    const targetRole = role(args.role);
    const grant = action === "grant";
    sql = family.endsWith("default_privileges")
      ? `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public ${
        grant ? "GRANT" : "REVOKE"
      } ${args.privileges.join(",")} ON TABLES ${
        grant ? "TO" : "FROM"
      } ${targetRole}`
      : `${grant ? "GRANT" : "REVOKE"} ${
        args.privileges.join(",")
      } ON TABLE ${table} ${grant ? "TO" : "FROM"} ${targetRole}`;
    after = family.endsWith("default_privileges")
      ? check(
        `SELECT ${
          args.privileges.map((p: string) =>
            `${
              grant ? "" : "NOT "
            }EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles owner ON owner.oid=d.defaclrole JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE owner.rolname='postgres' AND n.nspname='public' AND r.rolname=${
              sqlString(args.role)
            } AND a.privilege_type=${sqlString(p)})`
          ).join(" AND ")
        } AS ok`,
      )
      : check(
        `SELECT ${
          args.privileges.map((p: string) =>
            `${grant ? "" : "NOT "}pg_catalog.has_table_privilege(${
              sqlString(args.role)
            },${sqlString(`public.${args.table}`)},${sqlString(p)})`
          ).join(" AND ")
        } AS ok`,
      );
  } else if (family === "supabase.database.rls") {
    sql = `ALTER TABLE ${table} ${action.toUpperCase()} ROW LEVEL SECURITY`;
    after = check(
      `SELECT relrowsecurity=${
        action === "enable" ? "true" : "false"
      } AS ok FROM pg_catalog.pg_class WHERE oid=${
        sqlString(`public.${args.table}`)
      }::regclass`,
    );
  } else if (family === "supabase.database.rls.policies") {
    if (action === "drop") sql = `DROP POLICY ${identifier(name)} ON ${table}`;
    else {
      if (action === "alter" && !args.roles && !args.using && !args.check) {
        return bad("policy_change_required");
      }
      if (args.roles) unique(args.roles);
      if (
        action === "create" &&
        (args.command === "INSERT" && args.using ||
          ["SELECT", "DELETE"].includes(args.command) && args.check)
      ) return bad("policy_expression_not_applicable");
      sql = `${action === "create" ? "CREATE" : "ALTER"} POLICY ${
        identifier(name)
      } ON ${table}${
        action === "create"
          ? ` AS ${
            args.permissive === false ? "RESTRICTIVE" : "PERMISSIVE"
          } FOR ${args.command}`
          : ""
      }${args.roles ? ` TO ${args.roles.map(role).join(",")}` : ""}${
        args.using ? ` USING (${await expression(args.using, true)})` : ""
      }${
        args.check ? ` WITH CHECK (${await expression(args.check, true)})` : ""
      }`;
    }
    after = check(
      `SELECT ${
        action === "drop" ? "NOT " : ""
      }EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=${
        sqlString(`public.${args.table}`)
      }::regclass AND polname=${sqlString(name)}) AS ok`,
    );
  } else if (family === "supabase.database.replication.publications") {
    if (args.tables) unique(args.tables);
    if (action === "create") {
      if (args.publish) unique(args.publish);
      sql = `CREATE PUBLICATION ${identifier(name)} FOR TABLE ${
        args.tables.map(publicRelation).join(",")
      }${
        args.publish
          ? ` WITH (publish=${sqlString(args.publish.join(","))})`
          : ""
      }`;
    } else if (action === "alter") {
      sql = `ALTER PUBLICATION ${identifier(name)} SET TABLE ${
        args.tables.map(publicRelation).join(",")
      }`;
    } else sql = `DROP PUBLICATION ${identifier(name)} RESTRICT`;
    after = check(
      `SELECT ${
        action === "drop" ? "NOT " : ""
      }EXISTS(SELECT 1 FROM pg_catalog.pg_publication WHERE pubname=${
        sqlString(name)
      } AND NOT puballtables) AS ok`,
    );
  } else return bad("concrete_database_operation_missing");
  plan.statements = [{
    ...trustedCommand(sql),
    passive_relations: sourceRelations ?? [],
    ...(family === "supabase.schema.indexes" && action === "drop"
      ? { index_targets: [name] }
      : {}),
  }];
  plan.verifications = [after];
  const checksum = await argumentDigest({
    operation: op.operation,
    statements: plan.statements,
    verifications: plan.verifications,
  });
  plan.migration = { ...args.migration, checksum };
  return plan;
}
export async function compileDatabasePlan(
  operation: string,
  args: Row,
): Promise<DatabasePlan> {
  const op = databaseOperations[operation];
  if (!op) return bad("operation_not_implemented");
  if (op.kind === "ddl") return ddlPlan(op, args);
  const plan = base(op, args);
  if (op.kind === "receipt_get") {
    plan.statements = [
      trustedQuery(
        "SELECT a.request_id,a.operation,a.state AS admission_state,r.command_id,r.input_sha256,r.recorded_at,r.result AS receipt FROM public.sandy_database_execution_receipts r JOIN public.sandy_api_execution_admissions a ON a.id=r.admission_id WHERE a.request_id=($1->>0)::uuid AND a.actor_id=($1->>1)::uuid",
        [args.source_request_id],
      ),
    ];
    return plan;
  }
  if (["query", "dml", "transaction", "explain"].includes(op.kind)) {
    if (op.kind === "transaction") {
      plan.statements = await Promise.all(
        args.statements.map((s: Row) =>
          compileSql(s.sql, s.parameters ?? [], "dml")
        ),
      );
    } else {
      const sql = await compileSql(
        args.sql,
        args.parameters ?? [],
        op.kind === "dml" ? "dml" : "query",
      );
      if (op.kind === "explain") {
        sql.sql =
          `EXPLAIN(FORMAT JSON,ANALYZE FALSE,VERBOSE FALSE,COSTS TRUE) ${sql.sql}\n`;
      }
      plan.statements = [sql];
    }
    if (args.verification) {
      plan.verifications = [await verification(args.verification)];
    }
    return plan;
  }
  if (["migration_plan", "migration_apply"].includes(op.kind)) {
    // Explicit migration statements may be safe data statements or parsed DDL.
    // Broader DDL needs its concrete named operation; no DO/dynamic language body.
    plan.statements = await Promise.all(args.statements.map(async (s: Row) => {
      const ast = await parsedStatement(s.sql, "definition");
      const root = Object.keys(ast)[0];
      if (
        ![
          "SelectStmt",
          "InsertStmt",
          "UpdateStmt",
          "DeleteStmt",
          "CreateStmt",
          "AlterTableStmt",
          "IndexStmt",
          "DropStmt",
        ].includes(root)
      ) return bad("migration_statement_not_allowed");
      if (root === "SelectStmt") {
        return compileSql(s.sql, s.parameters ?? [], "query");
      }
      if (["InsertStmt", "UpdateStmt", "DeleteStmt"].includes(root)) {
        return compileSql(s.sql, s.parameters ?? [], "dml");
      }
      if ((s.parameters ?? []).length) {
        return bad("ddl_parameters_require_named_contract");
      }
      // The parsed DDL has no unbound ParamRef. Commands cannot access protected
      // schema objects, functions, roles, network extensions or dynamic execution.
      const encoded = JSON.stringify(ast);
      if (encoded.includes('"ParamRef"')) {
        return bad("sql_parameter_binding_missing");
      }
      const statement = { ...trustedCommand(s.sql) };
      if (root === "IndexStmt") {
        statement.passive_relations = physicalRelations(ast, "definition");
      }
      if (
        root === "DropStmt" &&
        (ast.DropStmt as Row).removeType === "OBJECT_INDEX"
      ) {
        statement.index_targets = (ast.DropStmt as Row).objects.map((
          entry: Row,
        ) => entry.List.items.at(-1).String.sval);
      }
      return statement;
    }));
    plan.verifications = await Promise.all(args.smoke_tests.map(verification));
    plan.migration = {
      ...args.migration,
      checksum: await argumentDigest({
        statements: plan.statements,
        verifications: plan.verifications,
      }),
    };
    if (op.kind === "migration_plan") {
      plan.mode = "read";
      plan.metadata = {
        proposed_statement_count: plan.statements.length,
        checksum: plan.migration!.checksum,
        version: plan.migration!.version,
        expected_before_sha256: plan.migration!.expected_before_sha256,
      };
      plan.statements = [
        snapshot,
        trustedQuery(
          "SELECT version,checksum,state FROM public.sandy_database_migration_ledger WHERE version=($1->>0)",
          [plan.migration!.version],
        ),
      ];
      plan.projection = "migration_plan";
    }
    return plan;
  }
  if (op.kind === "migration_repair") {
    plan.verifications = await Promise.all(args.smoke_tests.map(verification));
    plan.repair = { ...args };
    delete plan.repair.smoke_tests;
    return plan;
  }
  if (op.kind === "migration_verify") {
    plan.projection = "migration_verify";
    plan.metadata = args;
    plan.statements = [
      snapshot,
      trustedQuery(
        "SELECT version,checksum,state,after_sha256,revision FROM public.sandy_database_migration_ledger WHERE version=($1->>0)",
        [args.version],
      ),
    ];
    return plan;
  }
  if (op.kind === "migration_list") {
    plan.statements = [
      trustedQuery(
        "SELECT version,name,checksum,state,before_sha256,after_sha256,revision,applied_at FROM public.sandy_database_migration_ledger ORDER BY version DESC",
      ),
    ];
    return plan;
  }
  if (op.kind === "diff") {
    unique(
      args.baseline.map((o: Row) => JSON.stringify([o.kind, o.schema, o.name])),
      "duplicate_schema_baseline_identity",
    );
    plan.statements = [snapshot];
    plan.projection = "diff";
    plan.baseline = args.baseline;
    return plan;
  }
  if (op.kind === "routine_get") {
    plan.statements = [
      trustedQuery(
        "SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,p.prosecdef AS security_definer,l.lanname AS language,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex') AS function_sha256 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure($1->>0) AND p.prokind='f'",
        [`public.${args.name}(${args.argument_types.join(",")})`],
      ),
    ];
    publicRelation(args.name);
    args.argument_types.forEach(type);
    return plan;
  }
  if (op.kind === "publication_list") {
    plan.statements = [
      trustedQuery(
        "SELECT p.pubname AS name,p.pubinsert AS inserts,p.pubupdate AS updates,p.pubdelete AS deletes,p.pubtruncate AS truncates,p.puballtables AS all_tables,coalesce((SELECT jsonb_agg(jsonb_build_object('schema',t.schemaname,'table',t.tablename) ORDER BY t.schemaname,t.tablename) FROM pg_catalog.pg_publication_tables t WHERE t.pubname=p.pubname AND t.schemaname='public'),'[]'::jsonb) AS public_tables FROM pg_catalog.pg_publication p ORDER BY p.pubname",
      ),
    ];
    return plan;
  }
  if (op.kind.startsWith("data_")) {
    const relation = publicRelation(args.table);
    if (op.kind === "data_export") {
      unique(args.columns);
      unique(args.order_by);
      for (const name of args.columns) {
        if (
          /(password|passwd|secret|credential|access.?token|refresh.?token|private.?key|api.?key|signing.?key|authorization|cookie)/i
            .test(name)
        ) return bad("sensitive_sql_column_not_allowed");
      }
      const parameters: unknown[] = [];
      plan.statements = [
        trustedQuery(
          `SELECT ${
            args.columns.map((name: string) => `target.${identifier(name)}`)
              .join(",")
          } FROM ${relation} target${
            args.filters ? ` WHERE ${filterSql(args.filters, parameters)}` : ""
          } ORDER BY ${
            args.order_by.map((name: string) => `target.${identifier(name)}`)
              .join(",")
          } OFFSET ${args.offset ?? 0}`,
          parameters,
        ),
      ];
      plan.statements[0].passive_relations = [{
        schema: "public",
        name: args.table,
      }];
      plan.metadata = {
        snapshot_isolation: "per_call",
        offset: args.offset ?? 0,
      };
      return plan;
    }
    const parameters: unknown[] = [];
    let sql: string;
    if (["data_insert", "data_upsert", "data_bulk_import"].includes(op.kind)) {
      const names = Object.keys(args.rows[0]).sort();
      if (!names.length) return bad("database_rows_required");
      if (
        args.rows.some((row: Row) =>
          JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(names)
        )
      ) return bad("database_row_columns_must_match");
      for (const name of names) identifier(name);
      parameters.push(args.rows);
      const cols = names.map(identifier).join(",");
      sql =
        `INSERT INTO ${relation} AS target(${cols}) SELECT ${cols} FROM jsonb_populate_recordset(NULL::${relation},$1->0) incoming`;
      if (op.kind === "data_upsert") {
        unique(args.conflict_columns);
        if (
          args.conflict_columns.some((name: string) => !names.includes(name))
        ) return bad("conflict_column_missing");
        const update = names.filter((name) =>
          !args.conflict_columns.includes(name)
        );
        sql += ` ON CONFLICT(${
          args.conflict_columns.map(identifier).join(",")
        }) DO ${
          update.length
            ? `UPDATE SET ${
              update.map((name) =>
                `${identifier(name)}=excluded.${identifier(name)}`
              ).join(",")
            }`
            : "NOTHING"
        }`;
      } else if (args.conflict_columns) {
        return bad("unexpected_conflict_columns");
      }
    } else if (op.kind === "data_update") {
      const names = Object.keys(args.values).sort();
      names.forEach(identifier);
      parameters.push(args.values);
      sql = `UPDATE ${relation} target SET ${
        names.map((name) => `${identifier(name)}=incoming.${identifier(name)}`)
          .join(",")
      } FROM jsonb_populate_record(NULL::${relation},$1->0) incoming WHERE ${
        filterSql(args.filters, parameters)
      }`;
    } else {sql = `DELETE FROM ${relation} target WHERE ${
        filterSql(args.filters, parameters)
      }`;}
    plan.statements = [{
      sql: `${sql} RETURNING target.*`,
      parameters,
      mode: "dml",
      passive_relations: [{ schema: "public", name: args.table }],
    }];
    plan.verifications = [await verification(args.verification)];
    return plan;
  }
  if (op.kind.startsWith("maintenance_")) {
    const action = op.kind.slice("maintenance_".length);
    const relation = publicRelation(args.table);
    plan.mode = "nontransactional";
    plan.statements = [
      trustedCommand(
        action === "vacuum"
          ? `VACUUM(ANALYZE TRUE) ${relation}`
          : action === "analyze"
          ? `ANALYZE ${relation}`
          : `REINDEX TABLE ${relation}`,
      ),
    ];
    plan.verifications = [{
      sql:
        "SELECT schemaname,relname,last_analyze,last_autoanalyze,n_live_tup,n_dead_tup FROM pg_catalog.pg_stat_user_tables WHERE schemaname='public' AND relname=($1->>0)",
      parameters: [args.table],
      expected_rows: [],
    }];
    return plan;
  }
  if (op.kind === "slow_queries") {
    plan.statements = [
      trustedQuery(
        "SELECT queryid::text AS query_id,calls,total_exec_time,mean_exec_time,rows FROM extensions.pg_stat_statements ORDER BY total_exec_time DESC",
      ),
    ];
    plan.metadata = { required_extension: "pg_stat_statements" };
    return plan;
  }
  if (op.kind.startsWith("connection_")) {
    plan.mode = "nontransactional";
    const fn = op.kind === "connection_cancel"
      ? "pg_cancel_backend"
      : "pg_terminate_backend";
    // Match identity atomically in the same statement which sends the signal.
    plan.statements = [
      trustedQuery(
        `SELECT pid,backend_start,pg_catalog.${fn}(pid) AS signal_sent FROM pg_catalog.pg_stat_activity WHERE pid=${args.pid} AND backend_start=${
          parameterLiteral({
            type: "timestamptz",
            value: args.expected_backend_start,
          })
        } AND pid<>pg_catalog.pg_backend_pid() AND datname=pg_catalog.current_database() AND backend_type='client backend' AND usename NOT IN('postgres','supabase_admin','authenticator','supabase_auth_admin','supabase_storage_admin','pgbouncer')`,
        [],
      ),
    ];
    return plan;
  }
  if (op.kind.startsWith("cron_")) {
    plan.metadata = { required_extension: "pg_cron" };
    if (op.kind === "cron_create") {
      const ast = await parsedStatement(args.command.sql, "definition");
      const mode = Object.keys(ast)[0] === "SelectStmt" ? "query" : "dml";
      const command = await compileSql(
        args.command.sql,
        args.command.parameters ?? [],
        mode,
        true,
      );
      plan.statements = [
        trustedCommand(
          `SELECT cron.schedule(${sqlString(args.name)},${
            sqlString(args.schedule)
          },${sqlString(command.sql)})`,
        ),
      ];
      plan.verifications = [
        check(
          `SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname=${
            sqlString(args.name)
          } AND schedule=${sqlString(args.schedule)} AND command=${
            sqlString(command.sql)
          } AND active) AS ok`,
        ),
      ];
    } else if (op.kind === "cron_delete") {
      if (
        args.name || args.schedule || args.command ||
        Object.hasOwn(args, "active")
      ) return bad("unexpected_cron_delete_arguments");
      plan.statements = [
        trustedCommand(`SELECT cron.unschedule(${args.job_id})`),
      ];
      plan.verifications = [
        check(
          `SELECT NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=${args.job_id}) AS ok`,
        ),
      ];
    } else {
      if (
        args.name ||
        !(args.schedule || args.command || Object.hasOwn(args, "active"))
      ) return bad("cron_update_fields_required");
      let command: string | undefined;
      if (args.command) {
        const ast = await parsedStatement(args.command.sql, "definition");
        command = (await compileSql(
          args.command.sql,
          args.command.parameters ?? [],
          Object.keys(ast)[0] === "SelectStmt" ? "query" : "dml",
          true,
        )).sql;
      }
      plan.statements = [
        trustedCommand(
          `SELECT cron.alter_job(${args.job_id},schedule:=${
            args.schedule ? sqlString(args.schedule) : "NULL"
          },command:=${command ? sqlString(command) : "NULL"},active:=${
            Object.hasOwn(args, "active") ? String(args.active) : "NULL"
          })`,
        ),
      ];
      plan.verifications = [
        check(
          `SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobid=${args.job_id}${
            args.schedule ? ` AND schedule=${sqlString(args.schedule)}` : ""
          }${command ? ` AND command=${sqlString(command)}` : ""}${
            Object.hasOwn(args, "active") ? ` AND active=${args.active}` : ""
          }) AS ok`,
        ),
      ];
    }
    return plan;
  }
  if (op.kind === "webhook_list") {
    plan.statements = [
      trustedQuery(
        "SELECT n.nspname AS schema,c.relname AS table_name,t.tgname AS name,t.tgenabled::text AS enabled FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace fn ON fn.oid=p.pronamespace WHERE n.nspname='public' AND fn.nspname='supabase_functions' AND p.proname='http_request' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
      ),
    ];
    return plan;
  }
  return bad("concrete_database_operation_missing");
}
