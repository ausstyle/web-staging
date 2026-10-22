/** PostgreSQL's pinned parser, not keyword/semicolon guesses, defines statements.
 * The scanner binds only real ParamRef tokens, including across Unicode/comments.
 * No user value is concatenated into executable SQL. All identifiers are quoted
 * from a closed public-schema contract; queries bind one JSONB value with USING.
 */
// @ts-types="./vendor/pg_query_runtime.d.ts"
import { parse, scan } from "./vendor/pg_query_runtime.js";

type Row = Record<string, unknown>;
const object = (v: unknown): v is Row =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const identifierPattern = "^[a-z_][a-z0-9_]{0,62}$";
export const scalarTypes = [
  "text",
  "int4",
  "int8",
  "numeric",
  "bool",
  "uuid",
  "timestamptz",
  "date",
  "jsonb",
] as const;
export type ScalarType = typeof scalarTypes[number];
export type SqlParameter = { type: ScalarType; value: unknown };
export type CompiledStatement = {
  sql: string;
  parameters: unknown[];
  mode: "query" | "dml" | "command";
  passive_relations?: { schema: string; name: string }[];
  index_targets?: string[];
};
export class DatabaseCompileError extends Error {}
const refusal = (code: string): never => {
  throw new DatabaseCompileError(code);
};
const IDENTIFIER = new RegExp(identifierPattern);
const REVIEWED_CUSTOMER_TABLES = new Set([
  "sandy_tasks",
  "sandy_calendar_events",
  "sandy_universal_files",
  "sandy_agenda_companies",
  "sandy_agenda_categories",
]);
const RESERVED =
  /(?:^|_)(?:secret|secrets|credential|credentials|token|tokens|password|passwords|api_key|apikey|signing_key)(?:_|$)|^(?:sandy_api_|sandy_operation_registry$|sandy_controller_admins$|sandy_database_|sandy_customer_mutation_receipts$)/;
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    return refusal("invalid_database_identifier");
  }
  return `"${value}"`;
}
export function publicRelation(value: unknown): string {
  if (
    typeof value !== "string" ||
    (RESERVED.test(value) ||
      value.startsWith("sandy_") && !REVIEWED_CUSTOMER_TABLES.has(value) ||
      ["email_customers", "email_customer_addresses"].includes(value))
  ) {
    return refusal("protected_database_object");
  }
  return `"public".${identifier(value)}`;
}
export function sqlString(value: string): string {
  if (value.includes("\0")) return refusal("invalid_sql_text");
  // The private engine sets standard_conforming_strings=on before EXECUTE.
  return `'${value.replace(/'/g, "''")}'`;
}
const PURE_FUNCTIONS = new Set([
  "abs",
  "array_agg",
  "array_length",
  "array_to_json",
  "ascii",
  "avg",
  "bit_length",
  "bool_and",
  "bool_or",
  "btrim",
  "cardinality",
  "ceil",
  "ceiling",
  "char_length",
  "chr",
  "coalesce",
  "concat",
  "concat_ws",
  "count",
  "current_database",
  "current_schema",
  "current_schemas",
  "date_part",
  "date_trunc",
  "decode",
  "digest",
  "encode",
  "extract",
  "floor",
  "format",
  "gen_random_uuid",
  "greatest",
  "initcap",
  "json_agg",
  "json_array_length",
  "json_build_array",
  "json_build_object",
  "json_object_agg",
  "json_typeof",
  "jsonb_agg",
  "jsonb_array_length",
  "jsonb_build_array",
  "jsonb_build_object",
  "jsonb_object_agg",
  "jsonb_typeof",
  "least",
  "left",
  "length",
  "lower",
  "lpad",
  "ltrim",
  "max",
  "md5",
  "min",
  "now",
  "nullif",
  "octet_length",
  "pg_column_size",
  "position",
  "quote_ident",
  "quote_literal",
  "regexp_match",
  "regexp_matches",
  "regexp_replace",
  "regexp_split_to_array",
  "replace",
  "reverse",
  "right",
  "round",
  "row_number",
  "row_to_json",
  "rpad",
  "rtrim",
  "split_part",
  "string_agg",
  "strpos",
  "substr",
  "substring",
  "sum",
  "to_char",
  "to_date",
  "to_json",
  "to_jsonb",
  "to_timestamp",
  "translate",
  "trim",
  "trunc",
  "upper",
  "width_bucket",
]);
const OPERATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "=",
  "<>",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "||",
  "~",
  "~*",
  "!~",
  "!~*",
  "@>",
  "<@",
  "?",
  "?|",
  "?&",
  "->",
  "->>",
  "#>",
  "#>>",
  "&&",
  "~~",
  "!~~",
  "~~*",
  "!~~*",
]);
const TYPES = new Set([
  ...scalarTypes,
  "int2",
  "integer",
  "bigint",
  "smallint",
  "decimal",
  "boolean",
  "float4",
  "float8",
  "real",
  "double precision",
  "varchar",
  "bpchar",
  "timestamp",
  "timestamptz",
  "interval",
  "oid",
  "name",
  "regclass",
  "regtype",
  "bytea",
  "json",
]);
const DML = new Set(["InsertStmt", "UpdateStmt", "DeleteStmt"]);
const PASSIVE_CATALOGUE: Record<string, Set<string>> = {
  pg_catalog: new Set([
    "pg_namespace",
    "pg_database",
    "pg_roles",
    "pg_locks",
    "pg_stat_database",
  ]),
  information_schema: new Set([
    "schemata",
    "tables",
    "table_constraints",
    "key_column_usage",
    "referential_constraints",
    "constraint_column_usage",
  ]),
};
function relationAllowed(value: Row) {
  if (
    value.catalogname || typeof value.relname !== "string" ||
    (RESERVED.test(value.relname) ||
      value.relname.startsWith("sandy_") &&
        !REVIEWED_CUSTOMER_TABLES.has(value.relname) ||
      ["email_customers", "email_customer_addresses"].includes(value.relname))
  ) return refusal("protected_database_object");
  const schema = String(value.schemaname ?? "public");
  if (schema !== "public" && !PASSIVE_CATALOGUE[schema]?.has(value.relname)) {
    return refusal("protected_database_object");
  }
}
const ALWAYS_FORBIDDEN = new Set([
  "TransactionStmt",
  "VariableSetStmt",
  "DoStmt",
  "CallStmt",
  "CopyStmt",
  "LoadStmt",
  "AlterSystemStmt",
  "CreateForeignTableStmt",
  "CreateForeignServerStmt",
  "CreateFdwStmt",
  "CreateUserMappingStmt",
  "ImportForeignSchemaStmt",
  "CreateSubscriptionStmt",
  "AlterSubscriptionStmt",
  "DropSubscriptionStmt",
  "CreateEventTrigStmt",
  "CreateTransformStmt",
  "CreateCastStmt",
  "CreateAmStmt",
  "CreatePLangStmt",
  "CreateConversionStmt",
  "CreateOpClassStmt",
  "CreateOpFamilyStmt",
  "AlterOpFamilyStmt",
  "CreateStatsStmt",
  "CreateSeqStmt",
  "AlterSeqStmt",
  "LockStmt",
  "ListenStmt",
  "UnlistenStmt",
  "NotifyStmt",
  "ExecuteStmt",
  "PrepareStmt",
  "DeallocateStmt",
  "CreateRoleStmt",
  "AlterRoleStmt",
  "GrantRoleStmt",
  "GrantStmt",
  "AlterDefaultPrivilegesStmt",
  "CreateFunctionStmt",
  "CreateTrigStmt",
  "RuleStmt",
  "CreateTableSpaceStmt",
  "AlterTableSpaceOptionsStmt",
]);
function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) =>
    object(v) && object(v.String) && typeof v.String.sval === "string"
      ? v.String.sval
      : ""
  );
}
export async function parsedStatement(
  sql: unknown,
  mode: "query" | "dml" | "definition" = "query",
  allowAuthHelpers = false,
): Promise<Row> {
  if (
    typeof sql !== "string" || !sql.trim() ||
    new TextEncoder().encode(sql).length > 65536 || sql.includes("\0")
  ) return refusal("invalid_sql_text");
  let tree: unknown;
  try {
    tree = await parse(sql);
  } catch {
    return refusal("invalid_postgresql_syntax");
  }
  if (
    !object(tree) || !Array.isArray(tree.stmts) || tree.stmts.length !== 1 ||
    !object(tree.stmts[0]) || !object(tree.stmts[0].stmt)
  ) return refusal("exactly_one_statement_required");
  const statement = tree.stmts[0].stmt;
  const root = Object.keys(statement)[0];
  if (mode === "query" && root !== "SelectStmt") {
    return refusal("read_only_select_required");
  }
  if (mode === "dml" && !DML.has(root)) {
    return refusal("parameterized_data_statement_required");
  }
  const target = object(statement[root])
    ? statement[root].relation ?? statement[root].view
    : null;
  if (
    mode !== "query" && object(target) &&
    target.schemaname !== "public"
  ) return refusal("public_mutation_target_required");
  const returning = object(statement[root])
    ? (object(statement[root].returningClause)
      ? statement[root].returningClause.exprs
      : statement[root].returningList)
    : null;
  if (mode === "dml" && (!Array.isArray(returning) || !returning.length)) {
    return refusal("returning_clause_required");
  }
  let count = 0;
  const walk = (value: unknown, depth: number): void => {
    if (++count > 20000 || depth > 100) return refusal("sql_complexity_limit");
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (!object(value)) return;
    // libpg_query represents RangeVar/TypeName both as tagged nodes in lists
    // and as inline typed fields (e.g. UPDATE.relation or TypeCast.typeName).
    if (
      typeof value.relname === "string" &&
      (Object.hasOwn(value, "schemaname") ||
        Object.hasOwn(value, "relpersistence") || Object.hasOwn(value, "inh"))
    ) {
      relationAllowed(value);
    }
    for (const [kind, node] of Object.entries(value)) {
      if (["TableLikeClause", "RangeTableSample"].includes(kind)) {
        return refusal("database_statement_not_allowed");
      }
      if (
        kind === "CreateStmt" && object(node) &&
        (node.inhRelations || node.partbound || node.partspec ||
          node.accessMethod || node.tablespacename || node.options)
      ) {
        return refusal("named_ddl_contract_required");
      }
      if (kind === "IndexStmt" && object(node)) {
        if (
          node.accessMethod &&
            !["btree", "hash", "gin", "gist", "brin"].includes(
              String(node.accessMethod),
            ) ||
          node.tableSpace || node.options || node.excludeOpNames
        ) return refusal("named_ddl_contract_required");
        const params = [
          ...(Array.isArray(node.indexParams) ? node.indexParams : []),
          ...(Array.isArray(node.indexIncludingParams)
            ? node.indexIncludingParams
            : []),
        ];
        if (
          params.some((entry) =>
            object(entry) && object(entry.IndexElem) &&
            (entry.IndexElem.opclass || entry.IndexElem.opclassopts ||
              entry.IndexElem.collation)
          )
        ) return refusal("named_ddl_contract_required");
      }
      if (ALWAYS_FORBIDDEN.has(kind)) {
        return refusal("database_statement_not_allowed");
      }
      if (mode === "query" && DML.has(kind)) {
        return refusal("read_only_select_required");
      }
      if (
        kind === "SelectStmt" && object(node) &&
        (node.intoClause || node.lockingClause)
      ) return refusal("read_only_select_required");
      if (kind === "FuncCall" && object(node)) {
        const fn = names(node.funcname);
        if (
          allowAuthHelpers && fn.length === 2 && fn[0] === "auth" &&
          ["uid", "role"].includes(fn[1]) &&
          !(node.args as unknown[] | undefined)?.length
        ) continue;
        if (
          !fn.length || fn.length > 2 ||
          (fn.length === 2 && !["pg_catalog", "extensions"].includes(fn[0])) ||
          !PURE_FUNCTIONS.has(fn.at(-1)!)
        ) return refusal("sql_function_not_allowed");
        if (fn[0] === "extensions" && fn.at(-1) !== "digest") {
          return refusal("sql_function_not_allowed");
        }
        if (mode === "definition" && fn.length === 1) {
          return refusal("qualified_builtin_required_in_raw_definition");
        }
      }
      if (kind === "RangeVar" && object(node)) {
        relationAllowed(node);
      }
      if (
        (kind === "TypeName" || kind === "typeName" || kind === "typename") &&
        object(node)
      ) {
        const type = names(node.names);
        if (
          !type.length || type.length > 2 ||
          (type.length === 2 && type[0] !== "pg_catalog") ||
          !TYPES.has(type.at(-1)!)
        ) return refusal("sql_type_not_allowed");
      }
      if (
        kind === "AlterTableCmd" && object(node) &&
        ![
          "AT_AddColumn",
          "AT_DropColumn",
          "AT_AlterColumnType",
          "AT_SetNotNull",
          "AT_DropNotNull",
          "AT_AddConstraint",
          "AT_DropConstraint",
          "AT_ValidateConstraint",
          "AT_ColumnDefault",
        ].includes(String(node.subtype))
      ) return refusal("named_ddl_contract_required");
      if (kind === "DropStmt" && object(node)) {
        if (
          ![
            "OBJECT_TABLE",
            "OBJECT_VIEW",
            "OBJECT_MATVIEW",
            "OBJECT_INDEX",
            "OBJECT_TYPE",
          ].includes(String(node.removeType)) ||
          node.behavior !== "DROP_RESTRICT" || !Array.isArray(node.objects)
        ) return refusal("named_ddl_contract_required");
        for (const target of node.objects) {
          const path = object(target) && object(target.List)
            ? names(target.List.items)
            : [];
          if (
            path.length !== 2 || path[0] !== "public"
          ) return refusal("protected_database_object");
          publicRelation(path.at(-1));
        }
      }
      if (kind === "A_Expr" && object(node) && Object.hasOwn(node, "name")) {
        const op = names(node.name);
        if (
          !["AEXPR_OP", "AEXPR_OP_ANY", "AEXPR_OP_ALL"].includes(
            String(node.kind),
          ) || ![1, 2].includes(op.length) ||
          op.length === 2 && op[0] !== "pg_catalog" ||
          !OPERATORS.has(op.at(-1)!)
        ) {
          return refusal("sql_operator_not_allowed");
        }
      }
      if (kind === "ColumnRef" && object(node)) {
        for (const field of names(node.fields)) {
          if (
            /(?:password|passwd|secret|credential|access.?token|refresh.?token|private.?key|api.?key|signing.?key|authorization|cookie)/i
              .test(field)
          ) return refusal("sensitive_sql_column_not_allowed");
        }
      }
      walk(node, depth + 1);
    }
  };
  walk(statement, 0);
  physicalRelations(statement, mode);
  return statement;
}
function validateParameter(
  parameter: unknown,
): asserts parameter is SqlParameter {
  if (
    !object(parameter) ||
    Object.keys(parameter).some((k) => !["type", "value"].includes(k)) ||
    !scalarTypes.includes(parameter.type as ScalarType) ||
    !Object.hasOwn(parameter, "value")
  ) return refusal("invalid_sql_parameter");
  const { type, value } = parameter;
  if (value === null) return;
  if (type === "jsonb") {
    try {
      if (JSON.stringify(value).length > 65536) {
        return refusal("sql_parameter_size_limit");
      }
    } catch {
      return refusal("invalid_sql_parameter");
    }
    return;
  }
  if (type === "bool" && typeof value === "boolean") return;
  if (
    ["int4", "int8", "numeric"].includes(String(type)) &&
    (typeof value === "number" && Number.isFinite(value) ||
      typeof value === "string" &&
        /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value))
  ) {
    if (type !== "numeric" && !/^-?[0-9]+$/.test(String(value))) {
      return refusal("invalid_sql_parameter");
    }
    if (
      typeof value === "number" && type !== "numeric" &&
      !Number.isSafeInteger(value)
    ) return refusal("invalid_sql_parameter");
    return;
  }
  if (
    typeof value !== "string" || value.includes("\0") || value.length > 65536
  ) return refusal("invalid_sql_parameter");
  if (
    type === "uuid" &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  ) return refusal("invalid_sql_parameter");
  if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return refusal("invalid_sql_parameter");
  }
  if (type === "timestamptz" && !Number.isFinite(Date.parse(value))) {
    return refusal("invalid_sql_parameter");
  }
  if (!["text", "uuid", "date", "timestamptz"].includes(String(type))) {
    return refusal("invalid_sql_parameter");
  }
}
export async function compileSql(
  sql: unknown,
  parameters: unknown = [],
  mode: "query" | "dml" = "query",
  persist = false,
  allowAuthHelpers = false,
): Promise<CompiledStatement> {
  const initial = await parsedStatement(sql, mode, allowAuthHelpers);
  const source = qualifyBuiltinFunctions(String(sql), initial);
  const parsed = source === sql
    ? initial
    : await parsedStatement(source, mode, allowAuthHelpers);
  if (!Array.isArray(parameters) || parameters.length > 32) {
    return refusal("invalid_sql_parameters");
  }
  parameters.forEach(validateParameter);
  const bytes = new TextEncoder().encode(source);
  const tokens = (await scan(source)).tokens;
  const parameterTokens = tokens.filter((token) => token.tokenName === "PARAM");
  const used = new Set<number>();
  const pieces: Uint8Array[] = [];
  let cursor = 0;
  for (const token of parameterTokens) {
    const number = Number(token.text.slice(1));
    if (
      !Number.isSafeInteger(number) || number < 1 || number > parameters.length
    ) return refusal("sql_parameter_binding_missing");
    used.add(number);
    const parameter = parameters[number - 1] as SqlParameter;
    const json = parameter.type === "jsonb";
    const replacement = persist
      ? parameterLiteral(parameter)
      : `(($1 ${json ? "->" : "->>"} ${
        number - 1
      })::pg_catalog.${parameter.type})`;
    pieces.push(
      bytes.slice(cursor, token.start),
      new TextEncoder().encode(replacement),
    );
    cursor = token.end;
  }
  if (used.size !== parameters.length) return refusal("unused_sql_parameter");
  pieces.push(bytes.slice(cursor));
  const length = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const piece of pieces) {
    output.set(piece, offset);
    offset += piece.length;
  }
  // The parser proved exactly one statement. Remove only a terminal lexical
  // semicolon; line/block comments and dollar-quoted strings remain untouched.
  let compiled = new TextDecoder().decode(output);
  const final = tokens.filter((token) =>
    !["SQL_COMMENT", "C_COMMENT"].includes(token.tokenName)
  ).at(-1);
  if (final?.tokenType === 59) {
    const suffix = new TextDecoder().decode(bytes.slice(final.end));
    const semicolon = compiled.length - suffix.length - 1;
    compiled = compiled.slice(0, semicolon) + compiled.slice(semicolon + 1);
  }
  return {
    sql: compiled,
    parameters: persist ? [] : parameters.map((p) => p.value),
    mode,
    passive_relations: physicalRelations(parsed, mode),
  };
}
/** Physical names must mean the exact relation checked at the private boundary.
 * Unqualified CTE references are lexical only; no public/catalogue search-path
 * fallback may silently reinterpret an absent schema. */
export function physicalRelations(
  parsed: Row,
  mode: "query" | "dml" | "definition",
): { schema: string; name: string }[] {
  const ctes = new Set<string>();
  const top = parsed[Object.keys(parsed)[0]] as Row;
  const topWith = object(top?.withClause) ? top.withClause : null;
  if (topWith?.recursive || mode === "dml" && topWith) {
    return refusal("nested_or_recursive_cte_not_supported");
  }
  if (Array.isArray(topWith?.ctes)) {
    for (const cte of topWith.ctes) {
      if (
        object(cte) && object(cte.CommonTableExpr) &&
        typeof cte.CommonTableExpr.ctename === "string"
      ) ctes.add(cte.CommonTableExpr.ctename);
    }
  }
  const references = new Map<string, { schema: string; name: string }>();
  const visit = (value: unknown, collect: boolean) => {
    if (Array.isArray(value)) value.forEach((v) => visit(v, collect));
    else if (object(value)) {
      if (object(value.withClause) && value.withClause !== topWith) {
        return refusal("nested_or_recursive_cte_not_supported");
      }
      if (object(value.CommonTableExpr)) {
        const check = (entry: unknown): void => {
          if (Array.isArray(entry)) entry.forEach(check);
          else if (object(entry)) {
            if (
              object(entry.RangeVar) && !entry.RangeVar.schemaname &&
              ctes.has(String(entry.RangeVar.relname))
            ) return refusal("cte_dependency_shadowing_not_supported");
            Object.values(entry).forEach(check);
          }
        };
        check(value.CommonTableExpr.ctequery);
      }
      if (
        collect && typeof value.relname === "string" &&
        (Object.hasOwn(value, "inh") || Object.hasOwn(value, "relpersistence"))
      ) {
        const schema = String(value.schemaname ?? "");
        if (!schema && !ctes.has(value.relname)) {
          return refusal("explicit_physical_relation_schema_required");
        }
        if (schema || !ctes.has(value.relname)) {
          references.set(`${schema}.${value.relname}`, {
            schema,
            name: value.relname,
          });
        }
      }
      if (collect && object(value.RangeVar)) {
        const ref = value.RangeVar;
        if (
          typeof ref.relname === "string" &&
          (ref.schemaname || !ctes.has(ref.relname))
        ) {
          const schema = typeof ref.schemaname === "string"
            ? ref.schemaname
            : refusal("explicit_physical_relation_schema_required");
          references.set(`${schema}.${ref.relname}`, {
            schema,
            name: ref.relname,
          });
        }
      }
      Object.values(value).forEach((v) => visit(v, collect));
    }
  };
  visit(parsed, false);
  visit(parsed, true);
  return [...references.values()];
}
/** Qualify builtin calls without changing operator precedence. Operators resolve
 * only in pg_catalog because every executor and persisted routine fixes its
 * search_path to pg_catalog,pg_temp and all physical relations are explicit. */
export function qualifyBuiltinFunctions(source: string, parsed: Row): string {
  const bytes = new TextEncoder().encode(source);
  const edits = new Map<number, { end: number; text: string }>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (object(value)) {
      if (
        object(value.FuncCall) && names(value.FuncCall.funcname).length === 1 &&
        Number.isSafeInteger(value.FuncCall.location) &&
        Number(value.FuncCall.location) >= 0
      ) {
        edits.set(Number(value.FuncCall.location), {
          end: Number(value.FuncCall.location),
          text: "pg_catalog.",
        });
      }
      Object.values(value).forEach(walk);
    }
  };
  walk(parsed);
  if (!edits.size) return source;
  const pieces: Uint8Array[] = [];
  let cursor = 0;
  for (const [start, edit] of [...edits].sort(([a], [b]) => a - b)) {
    pieces.push(
      bytes.slice(cursor, start),
      new TextEncoder().encode(edit.text),
    );
    cursor = edit.end;
  }
  pieces.push(bytes.slice(cursor));
  const output = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  cursor = 0;
  for (const p of pieces) {
    output.set(p, cursor);
    cursor += p.length;
  }
  return new TextDecoder().decode(output);
}

export function parameterLiteral(parameter: SqlParameter): string {
  validateParameter(parameter);
  if (parameter.value === null) return `NULL::pg_catalog.${parameter.type}`;
  const source = parameter.type === "jsonb"
    ? JSON.stringify(parameter.value)
    : String(parameter.value);
  const hex = Array.from(
    new TextEncoder().encode(source),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  return `(pg_catalog.convert_from(pg_catalog.decode('${hex}','hex'),'UTF8')::pg_catalog.${parameter.type})`;
}
export function trustedQuery(
  sql: string,
  parameters: unknown[] = [],
): CompiledStatement {
  return { sql, parameters, mode: "query" };
}
export function trustedCommand(sql: string): CompiledStatement {
  return { sql, parameters: [], mode: "command" };
}
