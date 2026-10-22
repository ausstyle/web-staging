/** Normal Auth workload identity + explicit, narrow owner delegation.
 * No global Controller membership, personal JWT, provider implementation or
 * alternative authentication endpoint is introduced here. */
import policy from "./engineering_identity_policy.json" with { type: "json" };
import vmReadPolicy from "./engineering_vm_read_policy.json" with {
  type: "json",
};
import {
  recognizableRepositoryCredential,
  repositoryText,
} from "../_shared/sandy_repository_text.ts";
export const engineeringVmReadPolicy = Object.freeze(vmReadPolicy);
import {
  argumentDigest,
  canonicalJson,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
export const engineeringPolicy = Object.freeze(policy);
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const sha = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
const fail = (status: number, error: string) =>
  Response.json({ ok: false, error, executed: false }, { status });
export const engineeringTagged = (user: unknown) =>
  object(user) && object(user.app_metadata) &&
  user.app_metadata.sandy_engineering_test === true;
export type EngineeringProof = {
  machineUserId: string;
  ownerId: string;
  sessionId: string;
  epoch: number;
  policySha256: string;
  vmReadScopeSha256?: string;
  standingOperations?: string[];
};
const proofs = new WeakMap<object, EngineeringProof>();
export const engineeringProofFor = (credential: unknown) =>
  object(credential) ? proofs.get(credential) : undefined;
export function engineeringFixtureArguments(
  operation: string,
  args: unknown,
): boolean {
  if (!object(args)) return false;
  if (operation === "github.files.update") {
    return object(args.path) && args.path.path === policy.github_path &&
      object(args.body) && args.body.branch === policy.github_branch;
  }
  if (operation === "github.commit") {
    return object(args.body) && sha(args.body.tree) &&
      Array.isArray(args.body.parents) && args.body.parents.length === 1 &&
      sha(args.body.parents[0]);
  }
  if (operation === "supabase.functions.secrets.set") {
    return Array.isArray(args.body) && args.body.length === 1 &&
      object(args.body[0]) && args.body[0].name === policy.secret_name &&
      typeof args.body[0].value === "string" &&
      /^isolated-noncredential-[A-Za-z0-9_-]{1,100}$/.test(args.body[0].value);
  }
  if (operation === "supabase.db.migrations.apply") {
    return object(args.body) && typeof args.body.query === "string" &&
      policy.migration_queries.includes(args.body.query) &&
      (args.body.rollback === undefined ||
        typeof args.body.rollback === "string" &&
          policy.migration_queries.includes(args.body.rollback)) &&
      (args.body.name === undefined ||
        typeof args.body.name === "string" &&
          /^sandy_(?:mcp_execution|engineering_identity)_fixture_[A-Za-z0-9_]{1,80}$/
            .test(args.body.name));
  }
  if (operation === "supabase.deploy_edge_function") {
    return args.project_id === policy.project_ref &&
      args.slug === policy.function_slug &&
      args.name === policy.function_slug &&
      args.verify_jwt === true && args.entrypoint_path === "index.ts" &&
      args.import_map_path === undefined &&
      Array.isArray(args.files) && args.files.length === 1 &&
      object(args.files[0]) && args.files[0].path === "index.ts" &&
      typeof args.files[0].sha256 === "string" &&
      policy.function_source_sha256.includes(args.files[0].sha256);
  }
  if (operation === "supabase.logs.query") {
    const start = Date.parse(String(args.start)),
      end = Date.parse(String(args.end));
    return args.source === "function_logs" && Number.isFinite(start) &&
      Number.isFinite(end) && start < end && end - start <= 900000;
  }
  return false;
}
function claims(token: string): Obj | null {
  try {
    const value = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return object(value) ? value : null;
  } catch {
    return null;
  }
}
export type EngineeringDb = {
  rpc(name: string, args: Obj): PromiseLike<{ data: unknown; error: unknown }>;
};
export type EngineeringDependencies = {
  db: EngineeringDb;
  entry(operation: string): Promise<Obj | null>;
  contractMatches(entry: Obj): boolean;
  argumentsValid(schema: unknown, args: unknown): boolean;
  executionScope?(operation: string, args: Obj): Obj | Promise<Obj>;
  delegate(request: Request, credential: Obj): Promise<Response>;
};
async function rpc(
  db: EngineeringDb,
  name: string,
  args: Obj,
): Promise<Obj | null> {
  try {
    const r = await db.rpc(name, args);
    return !r.error && object(r.data) ? r.data : null;
  } catch {
    return null;
  }
}
/** All JWT claims below are used only after the caller passed Auth.getUser. */
export async function engineeringRequest(
  deps: EngineeringDependencies,
  request: Request,
  user: Obj,
  verifiedJwt: string,
): Promise<Response> {
  if (request.method !== "POST" || request.headers.has("x-sandy-api-key")) {
    return fail(403, "normal_engineering_auth_session_required");
  }
  const jwt = claims(verifiedJwt), metadata = jwt?.app_metadata;
  if (
    !uuid(user.id) || !engineeringTagged(user) || !jwt || jwt.sub !== user.id ||
    jwt.aud !== "authenticated" || jwt.role !== "authenticated" ||
    !uuid(jwt.session_id) || !object(metadata) ||
    metadata.sandy_engineering_test !== true ||
    !Number.isSafeInteger(metadata.sandy_engineering_epoch) ||
    Number(metadata.sandy_engineering_epoch) < 1 ||
    typeof jwt.exp !== "number" || jwt.exp <= Date.now() / 1000 ||
    !object(user.app_metadata) ||
    user.app_metadata.sandy_engineering_epoch !==
      metadata.sandy_engineering_epoch
  ) return fail(401, "invalid_engineering_auth_session");
  const resolved = await rpc(deps.db, "sandy_engineering_resolve_identity", {
    p_user_id: user.id,
    p_session_id: jwt.session_id,
    p_epoch: metadata.sandy_engineering_epoch,
  });
  if (!resolved) return fail(503, "engineering_authorization_unavailable");
  if (
    resolved.ok !== true || !uuid(resolved.owner_authority_id) ||
    resolved.identity_user_id !== user.id ||
    resolved.session_id !== jwt.session_id ||
    resolved.policy_sha256 !== await argumentDigest(policy) ||
    resolved.credential_epoch !== metadata.sandy_engineering_epoch ||
    JSON.stringify(resolved.operations) !== JSON.stringify(policy.operations)
  ) return fail(403, "engineering_identity_not_authorized");
  let body: unknown;
  try {
    body = await requestJson(request.clone(), 1550000);
  } catch {
    return fail(400, "invalid_engineering_request");
  }
  if (
    !object(body) ||
    !["list", "describe", "execute"].includes(String(body.action))
  ) return fail(400, "invalid_engineering_request");
  const operation = body.operation;
  const deny = async (status: number, error: string): Promise<Response> => {
    if (
      [400, 403, 404, 409, 424, 429].includes(status) &&
      typeof operation === "string"
    ) {
      const headerId = request.headers.get("x-sandy-request-id");
      await rpc(deps.db, "sandy_engineering_record_policy_denial", {
        p_user_id: user.id,
        p_session_id: jwt.session_id,
        p_epoch: metadata.sandy_engineering_epoch,
        p_request_id: uuid(headerId) ? headerId : crypto.randomUUID(),
        p_operation: operation,
        p_input_sha256: await argumentDigest(body.arguments ?? {}),
        p_error: error,
      });
    }
    return fail(status, error);
  };

  // The separate administrative policy is read only after ordinary Auth and
  // workload/session verification. Missing policy preserves the legacy grant.
  const standing = deps.executionScope
    ? await rpc(deps.db, "sandy_engineering_resolve_standing", {
      p_user_id: user.id,
      p_session_id: jwt.session_id,
      p_epoch: metadata.sandy_engineering_epoch,
    })
    : null;
  const standingAuthorized = standing?.ok === true &&
    standing.identity_user_id === user.id &&
    standing.owner_authority_id === resolved.owner_authority_id &&
    standing.session_id === jwt.session_id &&
    uuid(standing.delegation_id) && Number.isSafeInteger(standing.version) &&
    typeof standing.expires_at === "string" &&
    Date.parse(standing.expires_at) > Date.now() &&
    Array.isArray(standing.operations) && standing.operations.length <= 3000 &&
    standing.operations.every((op) =>
      typeof op === "string" &&
      (/^(github|gcp|supabase)\.[a-z0-9_.]+$/.test(op) ||
        op === "system.execution.get" ||
        /^system\.lifecycle\.(get|verify|compensate)$/.test(op))
    );
  if (deps.executionScope && standing === null) {
    return deny(503, "engineering_policy_unavailable");
  }
  if (standing?.policy_present === true && !standingAuthorized) {
    return deny(
      403,
      [
          "standing_delegation_revoked",
          "standing_delegation_expired",
          "standing_delegation_authority_mismatch",
        ].includes(String(standing.error))
        ? String(standing.error)
        : "engineering_operation_scope_denied",
    );
  }
  const vmScope = resolved.vm_read_scope;
  const vmAuthorized = object(vmScope) &&
    vmScope.policy_sha256 === await argumentDigest(vmReadPolicy) &&
    vmScope.owner_authority_id === resolved.owner_authority_id &&
    uuid(vmScope.source_change_id) && typeof vmScope.expires_at === "string" &&
    Date.parse(vmScope.expires_at) > Date.now() &&
    JSON.stringify(vmScope.operations) ===
      JSON.stringify(vmReadPolicy.operations);
  const allowedOperations = [
    ...new Set([
      ...policy.operations,
      ...(vmAuthorized ? vmReadPolicy.operations : []),
      ...(standingAuthorized ? standing!.operations as string[] : []),
    ]),
  ];
  if (
    body.action !== "list" &&
    (typeof operation !== "string" || !allowedOperations.includes(operation))
  ) return deny(403, "engineering_operation_scope_denied");
  const headers = new Headers(request.headers);
  let boundExecution: Obj | undefined;
  if (body.action === "execute") {
    const args = body.arguments ?? {},
      entry = await deps.entry(String(operation));
    const vmRead = vmAuthorized && typeof operation === "string" &&
      vmReadPolicy.operations.includes(operation);
    const standingExecution = standingAuthorized &&
      (standing!.operations as string[]).includes(String(operation));
    if (
      standingExecution &&
      (operation === "system.execution.get" ||
        /^system\.lifecycle\.(get|verify|compensate)$/.test(String(operation)))
    ) {
      if (
        !entry || !deps.contractMatches(entry) || entry.api_exposed !== true ||
        entry.ai_exposed !== true ||
        !object(args) || !deps.argumentsValid(entry.input_schema, args) ||
        !uuid(
          operation === "system.execution.get"
            ? args.request_id
            : args.source_request_id,
        ) ||
        args.compensation_approval_id !== undefined
      ) return deny(400, "invalid_execution_receipt_request");
      const owned = await rpc(deps.db, "sandy_engineering_owns_execution", {
        p_user_id: user.id,
        p_session_id: jwt.session_id,
        p_epoch: metadata.sandy_engineering_epoch,
        p_request_id: operation === "system.execution.get"
          ? args.request_id
          : args.source_request_id,
      });
      if (owned?.ok !== true || owned.owned !== true) {
        return deny(404, "execution_receipt_not_found");
      }
      const requestId = headers.get("x-sandy-request-id") ??
        crypto.randomUUID();
      if (!uuid(requestId)) return deny(400, "invalid_execution_request_id");
      headers.delete("x-sandy-approval-id");
      boundExecution = {
        operation,
        arguments: args,
        inputDigest: await argumentDigest(args),
        channel: body.channel === "mcp" ? "mcp" : "api",
        registryContract: entry,
        dispatchId: requestId,
      };
    } else if (standingExecution) {
      if (
        !entry || !deps.contractMatches(entry) || entry.api_exposed !== true ||
        entry.ai_exposed !== true ||
        !object(entry.error_contract) ||
        typeof entry.error_contract.contract_sha256 !== "string"
      ) {
        return deny(424, "engineering_execution_contract_unavailable");
      }
      if (!object(args) || !deps.argumentsValid(entry.input_schema, args)) {
        return deny(400, "invalid_operation_arguments");
      }
      if (String(operation).startsWith("github.")) {
        try {
          if (recognizableRepositoryCredential(JSON.stringify(args))) {
            throw Error();
          }
          const inputBody = object(args.body) ? args.body : {};
          if (typeof inputBody.content === "string") {
            repositoryText(
              inputBody.content,
              inputBody.encoding === "utf-8" ||
                String(operation).includes(".blobs.") &&
                  inputBody.encoding === undefined
                ? "utf-8"
                : "base64",
            );
          }
        } catch {
          return deny(403, "repository_source_material_refused");
        }
      }
      if (
        request.headers.has("x-sandy-declared-units") &&
        request.headers.get("x-sandy-declared-units") !== "0"
      ) return deny(403, "engineering_cost_scope_denied");
      const requestId = headers.get("x-sandy-request-id") ??
        crypto.randomUUID();
      if (!uuid(requestId)) return deny(400, "invalid_execution_request_id");
      let scope: Obj;
      try {
        scope = await deps.executionScope!(String(operation), args);
      } catch {
        return deny(424, "provider_scope_configuration_required");
      }
      const prepared = await rpc(
        deps.db,
        "sandy_engineering_prepare_delegated",
        {
          p_user_id: user.id,
          p_session_id: jwt.session_id,
          p_epoch: metadata.sandy_engineering_epoch,
          p_request_id: requestId,
          p_operation: operation,
          p_canonical_arguments: canonicalJson(args),
          p_contract_sha256: entry.error_contract.contract_sha256,
          p_canonical_scope: canonicalJson(scope),
        },
      );
      if (!prepared) return deny(503, "engineering_policy_unavailable");
      if (
        prepared.ok !== true || !uuid(prepared.authorization_id) ||
        prepared.authorization_state !== "authorized_by_policy"
      ) {
        return deny(
          [400, 403, 409, 424, 429].includes(Number(prepared.http_status))
            ? Number(prepared.http_status)
            : 403,
          typeof prepared.error === "string" &&
            /^[a-z][a-z0-9_]{2,80}$/.test(prepared.error)
            ? prepared.error
            : "engineering_policy_blocked",
        );
      }
      // Compatibility transport field carries the existing job/admission ID.
      // Its record has authorized_by_policy, never fabricated owner sign-off.
      headers.set("x-sandy-approval-id", prepared.authorization_id);
      headers.set("x-sandy-request-id", requestId);
      boundExecution = {
        operation,
        arguments: args,
        inputDigest: await argumentDigest(args),
        channel: body.channel === "mcp" ? "mcp" : "api",
        registryContract: entry,
        dispatchId: requestId,
      };
    } else if (vmRead) {
      if (
        !entry || !deps.contractMatches(entry) || entry.api_exposed !== true ||
        entry.ai_exposed !== true || entry.is_mutation !== false ||
        object(entry.error_contract) &&
          entry.error_contract.requires_approval === true
      ) return deny(424, "engineering_vm_read_contract_unavailable");
      // The canonical provider read reuses its reviewed handler and grant path.
      // Its path cannot widen the existing diagnostic delegation to another VM,
      // project, zone or caller-selected query. Legacy diagnostics stay compatible.
      const exactTarget = operation === "gcp.compute.instances.get"
        ? object(args) && Object.keys(args).length === 1 && object(args.path) &&
          Object.keys(args.path).length === 1 &&
          args.path.instance === vmReadPolicy.instance_name
        : object(args) && Object.keys(args).every((key) => key === "target") &&
          (args.target === undefined ||
            args.target === vmReadPolicy.instance_name);
      if (!exactTarget || !deps.argumentsValid(entry.input_schema, args)) {
        return deny(403, "engineering_vm_read_target_denied");
      }
      if (
        request.headers.has("x-sandy-declared-units") &&
        request.headers.get("x-sandy-declared-units") !== "0"
      ) return deny(403, "engineering_cost_scope_denied");
      const requestId = headers.get("x-sandy-request-id") ??
        crypto.randomUUID();
      if (!uuid(requestId)) return deny(400, "invalid_execution_request_id");
      const recorded = await rpc(deps.db, "sandy_engineering_record_vm_read", {
        p_user_id: user.id,
        p_session_id: jwt.session_id,
        p_epoch: metadata.sandy_engineering_epoch,
        p_operation: operation,
        p_request_id: requestId,
      });
      if (!recorded) {
        return deny(503, "engineering_vm_read_authorization_unavailable");
      }
      if (recorded.ok !== true) {
        return deny(
          recorded.http_status === 429 ? 429 : 403,
          "engineering_vm_read_not_authorized",
        );
      }
      headers.set("x-sandy-request-id", requestId);
      boundExecution = {
        operation,
        arguments: args,
        inputDigest: await argumentDigest(args),
        channel: body.channel === "mcp" ? "mcp" : "api",
        registryContract: entry,
        dispatchId: requestId,
      };
    } else {
      if (
        !entry || !deps.contractMatches(entry) || entry.api_exposed !== true ||
        entry.ai_exposed !== true || entry.verified !== true ||
        !object(entry.error_contract) ||
        typeof entry.error_contract.contract_sha256 !== "string"
      ) return deny(424, "engineering_execution_contract_unavailable");
      if (
        !deps.argumentsValid(entry.input_schema, args) ||
        !engineeringFixtureArguments(String(operation), args)
      ) return deny(403, "engineering_fixture_scope_denied");
      if (
        request.headers.has("x-sandy-declared-units") &&
        request.headers.get("x-sandy-declared-units") !== "0"
      ) return deny(403, "engineering_cost_scope_denied");
      const requestId = headers.get("x-sandy-request-id") ??
        crypto.randomUUID();
      if (!uuid(requestId)) return deny(400, "invalid_execution_request_id");
      const inputDigest = await argumentDigest(args),
        scope = String(operation).startsWith("github.")
          ? { provider: "github", repository: policy.repository }
          : { provider: "supabase", project_ref: policy.project_ref };
      const prepared = await rpc(
        deps.db,
        "sandy_engineering_prepare_execution",
        {
          p_user_id: user.id,
          p_session_id: jwt.session_id,
          p_epoch: metadata.sandy_engineering_epoch,
          p_request_id: requestId,
          p_operation: operation,
          p_input_sha256: inputDigest,
          p_contract_sha256: entry.error_contract.contract_sha256,
          p_scope_sha256: await argumentDigest(scope),
        },
      );
      if (!prepared) return deny(503, "engineering_approval_unavailable");
      if (prepared.ok !== true || !uuid(prepared.approval_id)) {
        return deny(
          [403, 409, 424, 429].includes(Number(prepared.http_status))
            ? Number(prepared.http_status)
            : 403,
          typeof prepared.error === "string" &&
            /^[a-z][a-z0-9_]{2,80}$/.test(prepared.error)
            ? prepared.error
            : "engineering_approval_denied",
        );
      }
      headers.set("x-sandy-approval-id", prepared.approval_id);
      headers.set("x-sandy-request-id", requestId);
      boundExecution = {
        operation,
        arguments: args,
        inputDigest,
        channel: body.channel === "mcp" ? "mcp" : "api",
        registryContract: entry,
        dispatchId: requestId,
      };
    }
  }
  const credential: Obj = {
    kind: "job_lease",
    principalId: resolved.owner_authority_id,
    allowedOperations,
    ...(boundExecution ? { boundExecution } : {}),
  };
  proofs.set(credential, {
    machineUserId: user.id,
    ownerId: resolved.owner_authority_id,
    sessionId: jwt.session_id,
    epoch: Number(metadata.sandy_engineering_epoch),
    policySha256: String(resolved.policy_sha256),
    ...(standingAuthorized
      ? { standingOperations: standing!.operations as string[] }
      : {}),
    ...(vmAuthorized
      ? { vmReadScopeSha256: String((vmScope as Obj).policy_sha256) }
      : {}),
  });
  const response = await deps.delegate(
    new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    credential,
  );
  if (operation === "video.install.preflight" && vmAuthorized && response.ok) {
    const value: unknown = await response.json().catch(() => null);
    if (!object(value) || !object(value.result)) {
      return deny(502, "engineering_vm_read_projection_invalid");
    }
    const reporting = value.result.guest_reporting;
    value.result.guest_reporting = {
      available: reporting != null,
      item_count: object(reporting) && Array.isArray(reporting.items)
        ? reporting.items.length
        : 0,
      values_redacted: true,
    };
    return Response.json(value, {
      status: response.status,
      headers: response.headers,
    });
  }
  if (
    body.action !== "execute" || operation !== "supabase.logs.query" ||
    !response.ok
  ) return response;
  // Authorization projection: this workload may see only the two pinned fixture
  // console markers. Provider execution stays in the canonical log handler.
  const output: unknown = await response.json().catch(() => null);
  if (
    !object(output) || !object(output.result) ||
    !object(output.result.result) ||
    !Array.isArray(output.result.result.entries)
  ) return deny(502, "engineering_log_projection_invalid");
  const result = output.result.result;
  result.entries = (result.entries as unknown[]).filter((value: unknown) =>
    object(value) && typeof value.message === "string" &&
    policy.function_console_markers.includes(value.message.trim())
  );
  result.next_query_before = null;
  // Preserve the handler's possibly_truncated flag: filtering private rows
  // cannot prove that the provider returned the complete log window.
  return Response.json(output, {
    status: response.status,
    headers: response.headers,
  });
}
