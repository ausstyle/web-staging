/** Reviewed, fixed-provider execution. Internal service identity and one-use policy grants only. */
import { Ajv, type ValidateFunction } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import rawCatalogue from "./contracts.json" with { type: "json" };
import {
  argumentDigest,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  createMachineAccessToken,
  type MachineAuth,
  machineScope,
} from "../_shared/sandy_machine_identity.ts";
import {
  allowedConfiguredReference,
  type BindingKind,
  parseProviderBindings,
  requireBinding,
  substituteBinding,
  type VerifiedProviderBindings,
} from "./configured_scopes.ts";
type JsonObject = Record<string, unknown>;
type Schema = Record<string, any>;
export type ProviderOperation = {
  operation: string;
  provider: "supabase" | "github" | "gcp";
  path: string;
  method: string;
  kind: string;
  fixed_bindings: Record<string, string>;
  fixed_query: Record<string, unknown>;
  input_schema: Schema;
  output_schema: Schema;
  response_schemas: Record<string, Schema>;
  $defs: Schema;
  result_schema: Schema;
  public_defs: Schema;
  is_mutation: boolean;
  requires_grant: boolean;
  requires_cost_approval: boolean;
  sensitive: boolean;
  contract_sha256: string;
  api_exposed: boolean;
  permission_scope: string;
  [key: string]: any;
};
const catalogue = rawCatalogue as unknown as {
  project_ref: string;
  repository: string;
  gcp_project_id: string;
  gcp_region: string;
  gcp_zone: string;
  operations: ProviderOperation[];
};
export { type ProviderConfig, providerExecutionScope } from "./gateway.ts";
import { type ProviderConfig, providerExecutionScope } from "./gateway.ts";
export const providerOperations: Readonly<Record<string, ProviderOperation>> =
  Object.freeze(
    Object.fromEntries(catalogue.operations.map((op) => [op.operation, op])),
  );
export interface ExecutionContext {
  actor_id: string;
  tenant_id: string | null;
  request_id: string;
  grant_id: string;
  admission_id?: string;
  credential_id?: string | null;
}
export interface GrantRequest extends ExecutionContext {
  operation: string;
  input_sha256: string;
  contract_sha256: string;
  scope_sha256: string;
}
export interface PolicyResult {
  ok?: boolean;
  allowed: boolean;
  reused?: boolean;
  admission_id?: string;
  error?: string;
  http_status?: number;
}
export interface FinishRequest {
  admission_id: string;
  outcome: "succeeded" | "accepted" | "failed" | "unknown";
  provider_http_status: number | null;
  provider_request_id: string | null;
  result_sha256: string;
}
/** SQL finish replies use ok/state rather than an admission permission flag. */
export function normalizeFinishReceipt(
  request: FinishRequest,
  value: unknown,
): PolicyResult {
  if (
    !object(value) || value.ok !== true ||
    value.admission_id !== request.admission_id ||
    value.state !== request.outcome || typeof value.reused !== "boolean"
  ) {
    return {
      allowed: false,
      error: "execution_receipt_state_unknown",
      http_status: 503,
    };
  }
  return {
    allowed: true,
    admission_id: request.admission_id,
    reused: value.reused,
  };
}
export function providerOutputSchema(operation: string): Schema {
  const op = providerOperations[operation];
  if (!op) throw new Error("operation_not_implemented");
  return op.output_schema;
}
export interface ProviderDependencies extends ProviderConfig {
  service: string;
  management?: string;
  github?: string;
  githubAppJwt?: string;
  getGcpAccessToken?: () => Promise<string>;
  fetch?: typeof fetch;
  authorizeContext: (
    context: ExecutionContext,
    operation: ProviderOperation,
  ) => Promise<PolicyResult>;
  consumeGrant: (request: GrantRequest) => Promise<PolicyResult>;
  finishExecution: (request: FinishRequest) => Promise<PolicyResult>;
}
const object = (v: unknown): v is JsonObject =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ajv = new Ajv({
  strict: true,
  strictTypes: false,
  strictRequired: false,
  allowUnionTypes: true,
  allErrors: false,
  validateFormats: true,
});
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const validators = new Map<string, ValidateFunction>();
function validator(key: string, schema: Schema): ValidateFunction {
  let fn = validators.get(key);
  if (!fn) {
    fn = ajv.compile(schema);
    validators.set(key, fn);
  }
  return fn;
}
export function validateAllContracts(): number {
  for (const op of catalogue.operations) {
    validator(op.operation + ":in", op.input_schema);
    validator(op.operation + ":out", {
      ...op.result_schema,
      $defs: op.public_defs,
    });
    for (const [status, schema] of Object.entries(op.response_schemas)) {
      validator(op.operation + ":" + status, { ...schema, $defs: op.$defs });
    }
  }
  return catalogue.operations.length;
}
function response(status: number, body: JsonObject): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
function refusal(
  status: number,
  error: string,
  extra: JsonObject = {},
): Response {
  return response(status, { ok: false, error, executed: false, ...extra });
}
const SENSITIVE =
  /(password|passwd|secret|credential|private.?key|access.?token|refresh.?token|authorization|connection.?string|encrypted.?value|cookie)/i;
/** Apply only the published projection, including nested provider maps. */
export function projectValue(
  raw: unknown,
  schema: Schema,
  defs: Schema,
  depth = 0,
): unknown {
  if (depth > 40) throw new Error("provider_projection_depth");
  if (schema.$ref) {
    return projectValue(
      raw,
      defs[schema.$ref.split("/").pop()],
      defs,
      depth + 1,
    );
  }
  if (schema.anyOf || schema.oneOf) {
    for (const branch of schema.anyOf ?? schema.oneOf) {
      try {
        const projected = projectValue(raw, branch, defs, depth + 1);
        if (
          ajv.validate({ ...branch, $defs: defs }, projected)
        ) return projected;
      } catch { /* next typed alternative */ }
    }
    throw new Error("provider_projection_mismatch");
  }
  if (raw === null) return null;
  if (Array.isArray(raw)) {
    if (schema.type !== "array") {
      throw new Error("provider_projection_mismatch");
    }
    return raw.slice(0, Math.min(schema.maxItems ?? 100, 100)).map((v) =>
      projectValue(v, schema.items ?? {}, defs, depth + 1)
    );
  }
  if (object(raw)) {
    if (
      schema.type !== "object" &&
      !(Array.isArray(schema.type) && schema.type.includes("object"))
    ) throw new Error("provider_projection_mismatch");
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(raw, key)) {
        result[key] = projectValue(raw[key], child as Schema, defs, depth + 1);
      }
    }
    if (object(schema.additionalProperties)) {
      for (const key of Object.keys(raw).slice(0, 100)) {
        if (
          !Object.hasOwn(result, key) && !SENSITIVE.test(key) &&
          !(["value", "content", "payload", "command", "body", "text", "output"]
            .includes(key))
        ) {
          result[key] = projectValue(
            raw[key],
            schema.additionalProperties,
            defs,
            depth + 1,
          );
        }
      }
    }
    return result;
  }
  return raw;
}
function scalarPath(value: unknown, reserved: boolean): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("invalid_provider_path");
  }
  const s = String(value);
  if (
    !s || s.length > 1024 || /[\\%?#\u0000-\u001f\u007f]/.test(s) ||
    s.split("/").some((p) => p === "." || p === ".." || !p)
  ) throw new Error("invalid_provider_path");
  if (
    reserved && s.split("/").some((part) => !/^[-A-Za-z0-9_.@+]+$/.test(part))
  ) throw new Error("invalid_provider_path");
  return reserved
    ? s.split("/").map(encodeURIComponent).join("/")
    : encodeURIComponent(s);
}
function verifyGcpResource(value: unknown): void {
  if (typeof value !== "string") return;
  // Resource references anywhere in the request cannot escape the configured project.
  const project = value.match(/(?:^|\/)projects\/([^/]+)/);
  if (
    project && ![catalogue.gcp_project_id, "1030223524306"].includes(project[1])
  ) throw new Error("provider_project_scope_mismatch");
  if (
    /^https?:\/\//i.test(value) &&
    !/^https:\/\/[a-z0-9-]+\.googleapis\.com\//.test(value) &&
    value !== "https://zmqlyygzqoidkcwdysok.supabase.co/auth/v1"
  ) throw new Error("provider_external_resource_reference");
  const location = value.match(/(?:^|\/)locations\/([^/]+)/);
  if (
    location && !([catalogue.gcp_region, "global", "-"].includes(location[1]))
  ) throw new Error("provider_region_scope_mismatch");
  const zone = value.match(/(?:^|\/)zones\/([^/]+)/);
  if (zone && zone[1] !== catalogue.gcp_zone) {
    throw new Error("provider_zone_scope_mismatch");
  }
  const region = value.match(/(?:^|\/)regions\/([^/]+)/);
  if (region && region[1] !== catalogue.gcp_region) {
    throw new Error("provider_region_scope_mismatch");
  }
  if (
    value.includes("@") && value.endsWith(".iam.gserviceaccount.com") &&
    !value.endsWith(`@${catalogue.gcp_project_id}.iam.gserviceaccount.com`)
  ) throw new Error("provider_service_account_scope_mismatch");
}
function inspectGcpReferences(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error("provider_request_depth");
  if (Array.isArray(value)) {
    for (const child of value) inspectGcpReferences(child, depth + 1);
  } else if (object(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (
        ["project", "projectId", "project_id", "userProject"].includes(key) &&
        typeof child === "string" &&
        ![
          catalogue.gcp_project_id,
          `projects/${catalogue.gcp_project_id}`,
          "1030223524306",
        ].includes(child)
      ) throw new Error("provider_project_scope_mismatch");
      if (
        ["region", "location"].includes(key) && typeof child === "string" &&
        !child.includes("/") &&
        ![catalogue.gcp_region, "global"].includes(child)
      ) throw new Error("provider_region_scope_mismatch");
      if (
        key === "zone" && typeof child === "string" && !child.includes("/") &&
        child !== catalogue.gcp_zone
      ) throw new Error("provider_zone_scope_mismatch");
      if (
        ["zones", "locations"].includes(key) && Array.isArray(child) &&
        child.some((v) =>
          typeof v === "string" && !v.includes("/") &&
          ![catalogue.gcp_region, catalogue.gcp_zone, "global"].includes(v)
        )
      ) throw new Error("provider_region_scope_mismatch");
      inspectGcpReferences(child, depth + 1);
    }
  } else verifyGcpResource(value);
}
export function bindProviderRequest(
  op: ProviderOperation,
  args: JsonObject,
  config: ProviderConfig = {},
): URL {
  const host = op.provider === "supabase"
    ? "https://api.supabase.com"
    : op.provider === "github"
    ? "https://api.github.com"
    : (op as any).service_host;
  if (
    op.provider === "gcp" &&
    !/^https:\/\/[a-z0-9-]+\.googleapis\.com$/.test(host)
  ) throw new Error("provider_host_not_allowed");
  if (op.provider === "gcp") inspectGcpReferences(args);
  const supplied = object(args.path) ? args.path : {};
  const path = op.path.replace(/\{(\+?)([^}]+)\}/g, (_, reserved, name) => {
    const fixed = (op.fixed_bindings as JsonObject)[name];
    const value = typeof fixed === "string"
      ? substituteBinding(fixed, config.verifiedBindings)
      : fixed ?? supplied[name];
    if (
      op.provider === "gcp" && fixed === undefined &&
      ["name", "parent", "resource"].includes(name) && typeof value === "string"
    ) {
      const kind = (op as any).binding_kind as BindingKind | undefined;
      const prefix = kind
        ? requireBinding(kind, config.verifiedBindings)
        : `projects/${catalogue.gcp_project_id}`;
      if (value !== prefix && !value.startsWith(prefix + "/")) {
        throw new Error("provider_project_scope_mismatch");
      }
    }
    return scalarPath(value, !!reserved);
  });
  const url = new URL(host + path);
  if (url.origin !== host) throw new Error("provider_host_not_allowed");
  const query = {
    ...(object(args.query) ? args.query : {}),
    ...op.fixed_query,
  };
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        for (const child of value) {
          url.searchParams.append(key, String(child));
        }
      } else {url.searchParams.set(
          key,
          typeof value === "string"
            ? substituteBinding(value, config.verifiedBindings)
            : String(value),
        );}
    }
  }
  return url;
}
async function boundedText(resp: Response): Promise<string> {
  if (!resp.body) return "";
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("provider_response_size_limit");
      }
      chunks.push(part.value);
    }
    const data = new Uint8Array(length);
    let i = 0;
    for (const chunk of chunks) {
      data.set(chunk, i);
      i += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } finally {
    reader.releaseLock();
  }
}
function requestId(resp: Response): string | null {
  const value = resp.headers.get("x-request-id") ??
    resp.headers.get("sb-request-id") ??
    resp.headers.get("x-github-request-id");
  return value && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : null;
}
function domainProjection(raw: unknown): JsonObject {
  if (!object(raw)) throw new Error("provider_projection_mismatch");
  const data = object(raw.data) && object(raw.data.result)
    ? raw.data.result
    : {};
  const ssl = object(data.ssl) ? data.ssl : {};
  const ownership = object(data.ownership_verification)
    ? data.ownership_verification
    : null;
  return {
    status: typeof raw.status === "string" ? raw.status : "unknown",
    custom_hostname: typeof raw.custom_hostname === "string"
      ? raw.custom_hostname
      : null,
    ownership_verification: ownership
      ? Object.fromEntries(
        ["type", "name", "value"].filter((k) =>
          typeof ownership[k] === "string"
        ).map((k) => [k, ownership[k]]),
      )
      : null,
    ssl_validation_records: Array.isArray(ssl.validation_records)
      ? ssl.validation_records.slice(0, 100).map((v) =>
        object(v)
          ? Object.fromEntries(
            ["txt_name", "txt_value"].filter((k) => typeof v[k] === "string")
              .map((k) => [k, v[k]]),
          )
          : {}
      )
      : [],
    validation_error_count: Array.isArray(ssl.validation_errors)
      ? ssl.validation_errors.length
      : 0,
  };
}
function acceptedProjection(raw: unknown): JsonObject {
  const result: JsonObject = { accepted: true, effect_confirmed: false };
  if (object(raw)) {
    for (
      const key of [
        "id",
        "number",
        "name",
        "ref",
        "sha",
        "state",
        "status",
        "url",
      ]
    ) {
      const value = raw[key];
      if (
        typeof value === "string" || typeof value === "number" ||
        typeof value === "boolean"
      ) result[key] = value;
    }
  }
  if (object(raw) && object(raw.content)) {
    if (typeof raw.content.sha === "string") {
      result.content_sha = raw.content.sha;
    }
    if (typeof raw.content.path === "string") result.path = raw.content.path;
  }
  if (object(raw) && object(raw.commit) && typeof raw.commit.sha === "string") {
    result.commit_sha = raw.commit.sha;
  }
  return result;
}
function isTruncated(value: unknown, depth = 0): boolean {
  if (depth > 40) return true;
  if (Array.isArray(value)) {
    return value.length >= 100 || value.some((v) => isTruncated(v, depth + 1));
  }
  return object(value) &&
    Object.values(value).some((v) => isTruncated(v, depth + 1));
}
function entitlementMissing(status: number, text: string): boolean {
  return [400, 402, 403].includes(status) &&
    /(entitlement_required|custom[ _-]?(?:domain|hostname).*(?:not enabled|add.?on|subscription)|(?:add.?on|subscription).*custom[ _-]?domain)/i
      .test(text);
}
export function createProviderOperationHandler(
  deps: ProviderDependencies,
): (req: Request) => Promise<Response> {
  const fetcher = deps.fetch ?? fetch;
  return async (req: Request) => {
    if (req.method !== "POST") return refusal(405, "method_not_allowed");
    if (
      !deps.service ||
      req.headers.get("authorization") !== `Bearer ${deps.service}`
    ) return refusal(403, "service_authorization_required");
    let body: unknown;
    try {
      body = await requestJson(req);
    } catch (error) {
      return refusal(
        error instanceof JsonRequestError ? error.status : 400,
        error instanceof JsonRequestError ? error.code : "invalid_request",
      );
    }
    if (
      !object(body) || Object.keys(body).some((k) =>
        ![
          "operation",
          "arguments",
          "actor_id",
          "tenant_id",
          "request_id",
          "grant_id",
          "admission_id",
          "credential_id",
        ].includes(k)
      )
    ) return refusal(400, "invalid_request");
    const op = typeof body.operation === "string"
      ? providerOperations[body.operation]
      : undefined;
    if (!op) return refusal(404, "operation_not_implemented");
    const args = body.arguments ?? {};
    if (
      !object(args) || !validator(op.operation + ":in", op.input_schema)(args)
    ) return refusal(400, "invalid_operation_arguments");
    if (
      typeof body.actor_id !== "string" || !UUID.test(body.actor_id) ||
      typeof body.request_id !== "string" || !UUID.test(body.request_id) ||
      typeof body.grant_id !== "string" || !UUID.test(body.grant_id) ||
      (body.tenant_id !== null &&
        (typeof body.tenant_id !== "string" || !UUID.test(body.tenant_id))) ||
      (body.admission_id !== undefined &&
        (typeof body.admission_id !== "string" ||
          !UUID.test(body.admission_id))) ||
      (body.credential_id !== undefined && body.credential_id !== null &&
        (typeof body.credential_id !== "string" ||
          !UUID.test(body.credential_id)))
    ) return refusal(400, "invalid_execution_context");
    const context = body as unknown as ExecutionContext;
    let url: URL;
    let scope: JsonObject;
    try {
      scope = providerExecutionScope(op.operation, deps);
      url = bindProviderRequest(op, args, deps);
    } catch (error) {
      return refusal(
        error instanceof Error &&
          /^verified_[a-z_]+_scope_binding_required$/.test(error.message)
          ? 424
          : 400,
        error instanceof Error ? error.message : "invalid_provider_binding",
      );
    }
    let permission: PolicyResult;
    try {
      permission = await deps.authorizeContext(context, op);
    } catch {
      return refusal(503, "execution_policy_unavailable");
    }
    if (!permission.allowed || permission.reused) {
      return refusal(
        permission.http_status ?? 403,
        permission.error ?? "execution_policy_refused",
      );
    }
    let token: string;
    try {
      token = op.provider === "supabase"
        ? deps.management ?? ""
        : op.provider === "github"
        ? ((op as any).credential_kind === "github_app_jwt"
          ? deps.githubAppJwt ?? ""
          : deps.github ?? "")
        : await deps.getGcpAccessToken?.() ?? "";
    } catch (error) {
      return refusal(
        424,
        error instanceof Error &&
          /^machine_[a-z_]+(?:_\d{3})?$/.test(error.message)
          ? error.message
          : "provider_identity_unavailable",
      );
    }
    if (!token) return refusal(424, "provider_credential_unavailable");
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: op.provider === "github"
        ? "application/vnd.github+json"
        : "application/json",
    };
    if (op.provider === "github") {
      headers["x-github-api-version"] = "2022-11-28";
    }
    // Check existing entitlement before grant consumption; never buy/upgrade add-ons.
    if (op.operation.startsWith("supabase.domains.") && op.is_mutation) {
      try {
        const check = await fetcher(
          `https://api.supabase.com/v1/projects/${catalogue.project_ref}/custom-hostname`,
          {
            method: "GET",
            headers,
            redirect: "error",
            signal: AbortSignal.timeout(20000),
          },
        );
        const text = await boundedText(check);
        if (!check.ok) {
          return refusal(
            entitlementMissing(check.status, text) ? 424 : 502,
            entitlementMissing(check.status, text)
              ? "provider_entitlement_required"
              : "provider_entitlement_unconfirmed",
            {
              provider_http_status: check.status,
              provider_request_id: requestId(check),
            },
          );
        }
      } catch {
        return refusal(502, "provider_entitlement_unconfirmed");
      }
    }
    const input_sha256 = await argumentDigest(args),
      scope_sha256 = await argumentDigest(scope);
    const providerBody: JsonObject = {
      ...(object(args.body) ? args.body : {}),
    };
    try {
      for (const [key, value] of Object.entries((op as any).fixed_body ?? {})) {
        providerBody[key] = typeof value === "string"
          ? substituteBinding(value, deps.verifiedBindings)
          : value;
      }
      if (op.provider === "gcp") {
        const check = (value: unknown): void => {
          if (
            typeof value === "string" &&
            !allowedConfiguredReference(value, deps.verifiedBindings)
          ) throw new Error("provider_configured_scope_mismatch");
          if (Array.isArray(value)) value.forEach(check);
          else if (object(value)) Object.values(value).forEach(check);
        };
        check(providerBody);
        inspectGcpReferences(providerBody);
      }
    } catch (error) {
      return refusal(
        error instanceof Error &&
          /^verified_[a-z_]+_scope_binding_required$/.test(error.message)
          ? 424
          : 400,
        error instanceof Error ? error.message : "invalid_provider_binding",
      );
    }
    let grant: PolicyResult;
    try {
      grant = await deps.consumeGrant({
        ...context,
        operation: op.operation,
        input_sha256,
        scope_sha256,
        contract_sha256: op.contract_sha256,
      });
    } catch {
      return refusal(503, "execution_grant_state_unknown");
    }
    if (
      !grant.allowed || grant.reused || !grant.admission_id ||
      !UUID.test(grant.admission_id)
    ) {
      return refusal(
        grant.http_status ?? 409,
        grant.error ?? "execution_grant_refused",
      );
    }
    const admission_id = grant.admission_id;
    const finish = async (
      outcome: FinishRequest["outcome"],
      status: number | null,
      id: string | null,
      result: unknown,
    ): Promise<boolean> => {
      try {
        const recorded = await deps.finishExecution({
          admission_id,
          outcome,
          provider_http_status: status,
          provider_request_id: id,
          result_sha256: await argumentDigest(result),
        });
        return recorded.allowed;
      } catch {
        return false;
      }
    };
    if ((op as any).bucket_scope_check) {
      const bucket = object(args.path) ? args.path.bucket : undefined;
      try {
        const check = await fetcher(
          `https://storage.googleapis.com/storage/v1/b/${
            scalarPath(bucket, false)
          }?fields=projectNumber`,
          {
            method: "GET",
            headers,
            redirect: "error",
            signal: AbortSignal.timeout(20000),
          },
        );
        const data = JSON.parse(await boundedText(check));
        if (
          !check.ok || !object(data) ||
          String(data.projectNumber) !== "1030223524306"
        ) {
          await finish("failed", check.status, requestId(check), {
            error: "provider_bucket_project_unconfirmed",
          });
          return response(403, {
            ok: false,
            error: "provider_bucket_project_unconfirmed",
            executed: true,
            admission_id,
            provider_http_status: check.status,
            provider_request_id: requestId(check),
            request_state: "failed",
          });
        }
      } catch {
        await finish("unknown", null, null, {
          error: "provider_bucket_project_unconfirmed",
        });
        return response(502, {
          ok: false,
          error: "provider_bucket_project_unconfirmed",
          executed: true,
          admission_id,
          request_state: "unknown",
        });
      }
    }
    let upstream: Response;
    let text: string;
    try {
      if (Object.hasOwn(args, "body") || (op as any).fixed_body) {
        headers["content-type"] = "application/json";
      }
      upstream = await fetcher(url, {
        method: op.method,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(22000),
        ...(Object.hasOwn(args, "body") || (op as any).fixed_body
          ? { body: JSON.stringify(providerBody) }
          : {}),
      });
      text = await boundedText(upstream);
    } catch {
      await finish("unknown", null, null, {
        error: "provider_response_unavailable",
      });
      return response(502, {
        ok: false,
        error: "provider_response_unavailable",
        executed: true,
        admission_id,
        request_state: "unknown",
      });
    }
    const provider_request_id = requestId(upstream), status = upstream.status;
    if (!upstream.ok) {
      const error = entitlementMissing(status, text)
        ? "provider_entitlement_required"
        : status === 401 || status === 403
        ? "provider_authorization_refused"
        : status === 404
        ? "provider_resource_not_found"
        : status === 429
        ? "provider_rate_limited"
        : "provider_request_failed";
      const state = op.is_mutation && status >= 500 ? "unknown" : "failed";
      const recorded = await finish(state, status, provider_request_id, {
        error,
        provider_http_status: status,
      });
      return response(
        error === "provider_entitlement_required"
          ? 424
          : status === 404
          ? 404
          : status === 429
          ? 429
          : 502,
        {
          ok: false,
          error,
          operation: op.operation,
          executed: true,
          admission_id,
          provider_http_status: status,
          provider_request_id,
          request_state: state,
          receipt_recorded: recorded,
        },
      );
    }
    let raw: unknown;
    let result: unknown;
    try {
      raw = text ? JSON.parse(text) : null;
      const schema = (op.response_schemas as Schema)[String(status)];
      if (Object.keys(op.response_schemas).length && !schema) {
        throw new Error("provider_response_contract_mismatch");
      }
      if (
        schema &&
        !validator(op.operation + ":" + status, { ...schema, $defs: op.$defs })(
          raw,
        )
      ) throw new Error("provider_response_contract_mismatch");
      if (op.kind === "domain") result = domainProjection(raw);
      else if (op.kind === "file_content") {
        if (
          !object(raw) || raw.type !== "file" || raw.encoding !== "base64" ||
          typeof raw.size !== "number" || raw.size > 65536 ||
          typeof raw.content !== "string"
        ) throw new Error("provider_projection_mismatch");
        result = {
          path: raw.path,
          sha: raw.sha,
          size: raw.size,
          type: "file",
          encoding: "base64",
          content: raw.content.replace(/\s/g, ""),
        };
      } else if (["mutation_metadata", "empty"].includes(op.kind)) {
        result = acceptedProjection(raw);
      } else if (op.kind === "openapi") {
        if (!object(raw) || !object(raw.paths)) {
          throw new Error("provider_projection_mismatch");
        }
        result = {
          version: object(raw.info) && typeof raw.info.version === "string"
            ? raw.info.version
            : null,
          path_names: Object.keys(raw.paths).slice(0, 100),
        };
      } else if (op.kind === "scoped_list") {
        result = [
          projectValue(raw, (op.result_schema as Schema).items, op.public_defs),
        ];
      } else result = projectValue(raw, op.result_schema, op.public_defs);
      if (
        !validator(op.operation + ":out", {
          ...op.result_schema,
          $defs: op.public_defs,
        })(result)
      ) throw new Error("provider_projection_mismatch");
    } catch {
      await finish(
        op.is_mutation ? "unknown" : "failed",
        status,
        provider_request_id,
        { error: "provider_response_contract_mismatch" },
      );
      return response(502, {
        ok: false,
        error: "provider_response_contract_mismatch",
        operation: op.operation,
        executed: true,
        admission_id,
        provider_http_status: status,
        provider_request_id,
        request_state: op.is_mutation ? "unknown" : "failed",
      });
    }
    const state = op.is_mutation ? "accepted" : "observed";
    const recorded = await finish(
      op.is_mutation ? "accepted" : "succeeded",
      status,
      provider_request_id,
      result,
    );
    if (!recorded) {
      return response(503, {
        ok: false,
        error: "execution_receipt_state_unknown",
        executed: true,
        operation: op.operation,
        admission_id,
        provider_http_status: status,
        provider_request_id,
        request_state: state,
      });
    }
    let next_page: number | null = null;
    const link = upstream.headers.get("link");
    const page = object(args.query) && typeof args.query.page === "number"
      ? args.query.page
      : 1;
    if (
      link && /;\s*rel="next"/.test(link) && Number.isSafeInteger(page) &&
      page < 100000
    ) next_page = page + 1;
    return response(200, {
      ok: true,
      operation: op.operation,
      contract_version: "1.0.0",
      provider: op.provider,
      request_state: state,
      executed: true,
      admission_id,
      provider_http_status: status,
      provider_request_id,
      result,
      possibly_truncated: isTruncated(result) || !!next_page,
      result_limit: 100,
      next_page,
    });
  };
}

if (import.meta.main) {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = async (name: string, args: JsonObject): Promise<PolicyResult> => {
    const { data, error } = await db.rpc(name, args);
    if (error) {
      return {
        allowed: false,
        error: "execution_policy_unavailable",
        http_status: 503,
      };
    }
    return data as PolicyResult;
  };
  Deno.serve(createProviderOperationHandler({
    service,
    verifiedBindings: parseProviderBindings(
      Deno.env.get("SANDY_GCP_SCOPE_BINDINGS_JSON"),
    ),
    management: Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN") ?? "",
    githubAppJwt: Deno.env.get("SANDY_GITHUB_APP_JWT") ?? "",
    github: Deno.env.get("SANDY_GITHUB_APP_INSTALLATION_TOKEN") ??
      Deno.env.get("SANDY_ENGINEERING_GITHUB_TOKEN") ?? "",
    getGcpAccessToken: createMachineAccessToken(
      db.auth as unknown as MachineAuth,
    ),
    authorizeContext: async (context, op) => {
      const [owner, registry] = await Promise.all([
        db.from("sandy_controller_admins").select("auth_user_id,role,enabled")
          .eq("auth_user_id", context.actor_id).eq("role", "owner").eq(
            "enabled",
            true,
          ).maybeSingle(),
        db.from("sandy_operation_registry").select(
          "handler,api_exposed,verified,is_mutation,error_contract",
        ).eq("operation", op.operation).maybeSingle(),
      ]);
      if (owner.error || registry.error) {
        return {
          allowed: false,
          error: "execution_policy_unavailable",
          http_status: 503,
        };
      }
      const row = registry.data;
      if (
        !owner.data || !row || row.handler !== "sandy-provider-operation-api" ||
        row.api_exposed !== true || row.is_mutation !== op.is_mutation ||
        row.error_contract?.contract_sha256 !== op.contract_sha256
      ) {
        return {
          allowed: false,
          error: "execution_contract_not_enabled",
          http_status: 403,
        };
      }
      if (op.requires_grant && !row.verified) {
        return {
          allowed: false,
          error: "verified_execution_contract_required",
          http_status: 403,
        };
      }
      if (
        context.credential_id &&
        (row.error_contract?.api_key_delegable !== true || op.requires_grant ||
          op.requires_cost_approval)
      ) {
        return {
          allowed: false,
          error: "api_key_operation_not_delegable",
          http_status: 403,
        };
      }
      return { allowed: true };
    },
    consumeGrant: (r) =>
      rpc("sandy_api_consume_execution_grant", {
        p_grant_id: r.grant_id,
        p_actor_id: r.actor_id,
        p_tenant_id: r.tenant_id,
        p_operation: r.operation,
        p_input_sha256: r.input_sha256,
        p_request_id: r.request_id,
        p_contract_sha256: r.contract_sha256,
        p_scope_sha256: r.scope_sha256,
      }),
    finishExecution: async (r) => {
      const { data, error } = await db.rpc("sandy_api_finish_execution", {
        p_admission_id: r.admission_id,
        p_outcome: r.outcome,
        p_provider_http_status: r.provider_http_status,
        p_provider_request_id: r.provider_request_id,
        p_result_sha256: r.result_sha256,
      });
      return error
        ? {
          allowed: false,
          error: "execution_receipt_state_unknown",
          http_status: 503,
        }
        : normalizeFinishReceipt(r, data);
    },
  }));
}
