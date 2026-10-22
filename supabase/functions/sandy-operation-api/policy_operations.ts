import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import {
  getExecutionReceipt,
  issueScopedCredential,
  type PolicyDb,
  type PolicyError,
  revokeScopedCredential,
  type SessionVerifier,
} from "./access_policy.ts";

type ObjectValue = Record<string, unknown>;
export type PolicyOperationContext = {
  kind: "user" | "api_key" | "job_lease";
  actorId: string;
  userJWT?: string;
  credentialId?: string;
};
export type PolicyOperationDependencies = {
  db: PolicyDb;
  verifySession: SessionVerifier;
  /** In-process gateway proof plus fresh workload/session and receipt ownership. */
  ownsEngineeringReceipt?: (requestId: string) => Promise<boolean>;
};
const object = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && uuidPattern.test(value);
const isDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const uuid = { type: "string", format: "uuid" };
const nullableUuid = { type: ["string", "null"], format: "uuid" };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const nullableHash = { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" };
const sequence = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};
const operationId = { type: "string", pattern: "^[a-z][a-z0-9_.-]{2,100}$" };
const schema = (
  properties: ObjectValue,
  required = Object.keys(properties),
) => ({
  type: "object",
  required,
  properties,
  additionalProperties: false,
});
const output = (properties: ObjectValue) =>
  schema({
    ok: { const: true },
    contract_version: { const: "1.0.0" },
    ...properties,
  });
const eventSchema = schema({
  sequence,
  id: uuid,
  occurred_at: { type: "string", format: "date-time" },
  actor_id: nullableUuid,
  operation: { type: ["string", "null"] },
  request_id: nullableUuid,
  credential_id: nullableUuid,
  admission_id: nullableUuid,
  phase: { type: "string", minLength: 1, maxLength: 120 },
  outcome: { type: "string", minLength: 1, maxLength: 120 },
  input_sha256: nullableHash,
  result_sha256: nullableHash,
  provider_http_status: {
    type: ["integer", "null"],
    minimum: 100,
    maximum: 599,
  },
  provider_request_id_sha256: nullableHash,
  previous_sha256: hash,
  event_sha256: hash,
  format: { const: "pg_jsonb_v1" },
});
const receiptSchema = schema({
  ok: { const: true },
  admission_id: uuid,
  request_id: uuid,
  operation: { type: "string" },
  request_state: {
    enum: [
      "admitted",
      "consumed",
      "accepted",
      "succeeded",
      "failed",
      "unknown",
      "rejected",
    ],
  },
  accepted: { type: "boolean" },
  executed: { type: ["boolean", "null"] },
  completed: { type: "boolean" },
  outcome: {
    enum: ["pending", "accepted", "succeeded", "failed", "unknown", "rejected"],
  },
  provider_http_status: {
    type: ["integer", "null"],
    minimum: 100,
    maximum: 599,
  },
  provider_request_id_sha256: nullableHash,
  result_sha256: nullableHash,
  reconciliation_required: { type: "boolean" },
  redispatch_permitted: { const: false },
  created_at: { type: "string", format: "date-time" },
  finished_at: { type: ["string", "null"], format: "date-time" },
});
export type PolicyOperationContract = {
  is_mutation: boolean;
  permission_scope: "system:read" | "system:write";
  description: string;
  input_schema: ObjectValue;
  output_schema: ObjectValue;
  normal_user_session_required: boolean;
};
/** Fixed local executors, not a second catalogue. Registry exposure and exact
 * contract matching remain prerequisites enforced by the canonical gateway.
 */
export const policyOperationContracts: Record<string, PolicyOperationContract> =
  {
    "system.credentials.issue": {
      is_mutation: true,
      permission_scope: "system:write",
      normal_user_session_required: true,
      description:
        "Issue one short-lived, operation-scoped owner read API credential using a normal Auth session. The secret is displayed once; declared units are not money. Contract v1.0.0.",
      input_schema: schema({
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 32,
          uniqueItems: true,
          items: operationId,
        },
        ttl_seconds: { type: "integer", minimum: 60, maximum: 3600 },
        requests_per_minute: { type: "integer", minimum: 1, maximum: 60 },
        declared_unit_budget: { type: "integer", minimum: 0, maximum: 1000000 },
      }),
      output_schema: output({
        credential_id: uuid,
        principal_id: uuid,
        tenant_id: { type: "null" },
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 32,
          uniqueItems: true,
          items: operationId,
        },
        expires_at: { type: "string", format: "date-time" },
        requests_per_minute: { type: "integer", minimum: 1, maximum: 60 },
        declared_unit_budget: { type: "integer", minimum: 0, maximum: 1000000 },
        unit_kind: { const: "caller_declared_units_not_money" },
        api_key: {
          type: "string",
          pattern: "^sandy_api_[a-f0-9-]{36}\\.[A-Za-z0-9_-]{43}$",
        },
        display_once: { const: true },
        transport: schema({
          authorization: { const: "Bearer <public anon JWT>" },
          key_header: { const: "x-sandy-api-key" },
        }),
      }),
    },
    "system.credentials.revoke": {
      is_mutation: true,
      permission_scope: "system:write",
      normal_user_session_required: true,
      description:
        "Idempotently revoke an owned scoped Sandy API credential using a normal Auth session. Never accepts an API key or a worker lease as an administrative identity. Contract v1.0.0.",
      input_schema: schema({ credential_id: uuid }),
      output_schema: output({
        credential_id: uuid,
        revoked: { const: true },
        already_revoked: { type: "boolean" },
      }),
    },
    "system.audit.list": {
      is_mutation: false,
      permission_scope: "system:read",
      normal_user_session_required: true,
      description:
        "Read the owner audit hash chain with an exclusive sequence cursor and optional exact operation filter. Returns digests rather than arguments, results, grants or secrets; external retention is still required for independent trust. Contract v1.0.0.",
      input_schema: schema({
        after_sequence: sequence,
        limit: { type: "integer", minimum: 1, maximum: 500 },
        operation: operationId,
      }, []),
      output_schema: output({
        events: { type: "array", maxItems: 500, items: eventSchema },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        next_sequence: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        possibly_truncated: { type: "boolean" },
        external_anchor_established: { const: false },
      }),
    },
    "system.audit.checkpoint": {
      is_mutation: true,
      permission_scope: "system:write",
      normal_user_session_required: true,
      description:
        "Record a database audit checkpoint for an authenticated owner. Return the digest for separately authorized external retention; no external anchor is claimed or written. Contract v1.0.0.",
      input_schema: schema({}),
      output_schema: output({
        checkpoint: schema({
          id: uuid,
          sequence,
          event_sha256: hash,
          recorded_at: { type: "string", format: "date-time" },
          recorded_by: uuid,
        }),
        external_anchor_established: { const: false },
        limitation: {
          const:
            "Database administrators can rewrite both chain and checkpoints; retain checkpoint externally for independent trust",
        },
      }),
    },
    "system.audit.verify": {
      is_mutation: false,
      permission_scope: "system:read",
      normal_user_session_required: true,
      description:
        "Verify a bounded audit-chain range against the stored head and optional caller-retained preceding digest. Reports incomplete verification and invalid hashes truthfully; a database checkpoint alone is not independent trust. Contract v1.0.0.",
      input_schema: schema({
        after_sequence: sequence,
        expected_previous_sha256: hash,
        limit: { type: "integer", minimum: 1, maximum: 5000 },
      }, []),
      output_schema: output({
        valid: { type: "boolean" },
        checked_events: { type: "integer", minimum: 0, maximum: 5000 },
        last_sequence: {
          type: ["integer", "null"],
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        last_sha256: nullableHash,
        complete: { type: "boolean" },
        failed_sequence: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        reason: { enum: [null, "audit_head_mismatch", "chain_hash_mismatch"] },
        caller_supplied_anchor: { type: "boolean" },
        external_anchor_established: { const: false },
      }),
    },
    "system.execution.get": {
      is_mutation: false,
      permission_scope: "system:read",
      normal_user_session_required: false,
      description:
        "Read an owned execution receipt without redispatch; API keys see only receipts admitted under that exact active key. Unknown dispatch and asynchronous acceptance require reconciliation.",
      input_schema: schema({ request_id: uuid }),
      output_schema: receiptSchema,
    },
  };
const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const inputValidators = new Map(
  Object.entries(policyOperationContracts).map((
    [id, contract],
  ) => [id, ajv.compile(contract.input_schema)]),
);
const outputValidators = new Map(
  Object.entries(policyOperationContracts).map((
    [id, contract],
  ) => [id, ajv.compile(contract.output_schema)]),
);
export const isPolicyOperation = (operation: string): boolean =>
  Object.hasOwn(policyOperationContracts, operation);
export const requiresPolicyUserJWT = (operation: string): boolean =>
  policyOperationContracts[operation]?.normal_user_session_required === true;
export function policyContractMatches(
  operation: string,
  entry: unknown,
): boolean {
  const contract = policyOperationContracts[operation];
  if (!contract || !object(entry)) return false;
  try {
    return entry.handler === "sandy-operation-api" &&
      entry.is_mutation === contract.is_mutation &&
      entry.permission_scope === contract.permission_scope &&
      canonicalJson(entry.input_schema) ===
        canonicalJson(contract.input_schema) &&
      canonicalJson(entry.output_schema) ===
        canonicalJson(contract.output_schema);
  } catch {
    return false;
  }
}
const reply = (status: number, value: ObjectValue) =>
  Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const fail = (
  status: number,
  error: string,
  reconciliationRequired = false,
  credentialId?: string,
) =>
  reply(status, {
    ok: false,
    error,
    ...(reconciliationRequired ? { reconciliation_required: true } : {}),
    ...(credentialId ? { credential_id: credentialId } : {}),
  });
const helperError = (error: PolicyError) =>
  fail(
    error.status,
    error.error,
    error.reconciliationRequired,
    error.credentialId,
  );
const checkpointLimitation =
  "Database administrators can rewrite both chain and checkpoints; retain checkpoint externally for independent trust";
const auditRefusals = new Map([
  ["owner_required", 403],
  ["invalid_audit_query", 400],
  ["invalid_audit_verification", 400],
  ["audit_anchor_not_found", 404],
  ["audit_anchor_mismatch", 409],
]);
async function auditRpc(
  deps: PolicyOperationDependencies,
  name: string,
  args: ObjectValue,
  mutation = false,
): Promise<ObjectValue | Response> {
  try {
    const result = await deps.db.rpc(name, args);
    if (result.error || !object(result.data)) {
      return fail(
        503,
        mutation ? "policy_outcome_unknown" : "policy_unavailable",
        mutation,
      );
    }
    if (result.data.ok === true) return result.data;
    const status = typeof result.data.error === "string"
      ? auditRefusals.get(result.data.error)
      : undefined;
    if (status && result.data.http_status === status) {
      return fail(status, String(result.data.error));
    }
    return fail(503, "policy_response_invalid", mutation);
  } catch {
    return fail(
      503,
      mutation ? "policy_outcome_unknown" : "policy_unavailable",
      mutation,
    );
  }
}
function projectEvent(value: unknown): ObjectValue | null {
  if (!object(value)) return null;
  const projected: ObjectValue = {};
  for (const field of Object.keys(eventSchema.properties)) {
    projected[field] = value[field];
  }
  if (
    !ajv.validate(eventSchema, projected) || !integer(projected.sequence, 1) ||
    !(projected.operation === null ||
      (typeof projected.operation === "string" &&
        /^[a-z][a-z0-9_.-]{2,100}$/.test(projected.operation)))
  ) return null;
  return projected;
}
/** Called only after the canonical gateway verifies identity, registry exposure
 * and contract. Session-only operations additionally verify the original JWT
 * and bind its subject here; an API key cannot administer itself or audit.
 */
export async function executePolicyOperation(
  deps: PolicyOperationDependencies,
  context: PolicyOperationContext,
  operation: string,
  args: unknown,
): Promise<Response> {
  const contract = policyOperationContracts[operation];
  if (!contract) return fail(404, "policy_operation_not_found");
  if (!isUuid(context.actorId)) return fail(401, "invalid_identity");
  if (!object(args) || inputValidators.get(operation)?.(args) !== true) {
    return fail(400, "invalid_operation_arguments");
  }
  if (
    context.kind === "job_lease" &&
    (operation !== "system.execution.get" ||
      !await deps.ownsEngineeringReceipt?.(String(args.request_id)))
  ) {
    return fail(403, "normal_user_session_required");
  }
  if (operation === "system.execution.get") {
    if (context.kind === "api_key" && !isUuid(context.credentialId)) {
      return fail(401, "invalid_api_credential");
    }
    const result = await getExecutionReceipt(
      deps.db,
      context.actorId,
      args.request_id,
      context.kind === "api_key" ? context.credentialId : null,
    );
    return result.ok ? reply(200, result.value) : helperError(result);
  }
  if (
    context.kind !== "user" || typeof context.userJWT !== "string" ||
    !/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(context.userJWT)
  ) return fail(401, "authenticated_user_session_required");
  const verifyBoundSession: SessionVerifier = async (token) => {
    const user = await deps.verifySession(token);
    return user?.id === context.actorId ? user : null;
  };
  let value: ObjectValue;
  let status = 200;
  if (operation === "system.credentials.issue") {
    const result = await issueScopedCredential(
      deps.db,
      verifyBoundSession,
      context.userJWT,
      {
        operations: args.operations,
        ttlSeconds: args.ttl_seconds,
        requestsPerMinute: args.requests_per_minute,
        declaredUnitBudget: args.declared_unit_budget,
      },
    );
    if (!result.ok) return helperError(result);
    value = { ok: true, contract_version: "1.0.0", ...result.value };
    status = 201;
  } else if (operation === "system.credentials.revoke") {
    const result = await revokeScopedCredential(
      deps.db,
      verifyBoundSession,
      context.userJWT,
      args.credential_id,
    );
    if (!result.ok) return helperError(result);
    value = { ok: true, contract_version: "1.0.0", ...result.value };
  } else {
    let user: { id: string } | null;
    try {
      user = await verifyBoundSession(context.userJWT);
    } catch {
      return fail(503, "identity_verification_unavailable");
    }
    if (!user) return fail(401, "invalid_identity");
    if (operation === "system.audit.list") {
      const limit = Number(args.limit ?? 100),
        after = Number(args.after_sequence ?? 0);
      const result = await auditRpc(deps, "sandy_api_read_audit", {
        p_actor_id: context.actorId,
        p_after_sequence: after,
        p_limit: limit,
        p_operation: args.operation ?? null,
      });
      if (result instanceof Response) return result;
      if (
        !Array.isArray(result.events) || result.events.length > limit ||
        result.limit !== limit ||
        result.possibly_truncated !== (result.events.length === limit) ||
        result.external_anchor_established !== false
      ) return fail(503, "policy_response_invalid");
      const events: ObjectValue[] = [];
      let previous = after;
      for (const raw of result.events) {
        const event = projectEvent(raw);
        if (
          !event || Number(event.sequence) <= previous ||
          (args.operation !== undefined && event.operation !== args.operation)
        ) return fail(503, "policy_response_invalid");
        previous = Number(event.sequence);
        events.push(event);
      }
      value = {
        ok: true,
        contract_version: "1.0.0",
        events,
        limit,
        next_sequence: result.possibly_truncated ? previous : null,
        possibly_truncated: result.possibly_truncated,
        external_anchor_established: false,
      };
    } else if (operation === "system.audit.checkpoint") {
      const result = await auditRpc(deps, "sandy_api_checkpoint_audit", {
        p_actor_id: context.actorId,
      }, true);
      if (result instanceof Response) return result;
      const c = result.checkpoint;
      if (
        !object(c) || !isUuid(c.id) || !integer(c.sequence) ||
        !isDigest(c.event_sha256) || !timestamp(c.recorded_at) ||
        c.recorded_by !== context.actorId ||
        result.external_anchor_established !== false ||
        result.limitation !== checkpointLimitation
      ) return fail(503, "policy_response_invalid", true);
      value = {
        ok: true,
        contract_version: "1.0.0",
        checkpoint: {
          id: c.id,
          sequence: c.sequence,
          event_sha256: c.event_sha256,
          recorded_at: c.recorded_at,
          recorded_by: c.recorded_by,
        },
        external_anchor_established: false,
        limitation: checkpointLimitation,
      };
    } else {
      const after = Number(args.after_sequence ?? 0),
        limit = Number(args.limit ?? 1000);
      const result = await auditRpc(deps, "sandy_api_verify_audit", {
        p_actor_id: context.actorId,
        p_after_sequence: after,
        p_expected_previous_sha256: args.expected_previous_sha256 ?? null,
        p_limit: limit,
      });
      if (result instanceof Response) return result;
      if (
        typeof result.valid !== "boolean" ||
        result.external_anchor_established !== false
      ) return fail(503, "policy_response_invalid");
      if (result.valid) {
        if (
          !integer(result.checked_events, 0, limit) ||
          !integer(result.last_sequence, after) ||
          !isDigest(result.last_sha256) ||
          typeof result.complete !== "boolean" ||
          result.caller_supplied_anchor !==
            (args.expected_previous_sha256 !== undefined)
        ) return fail(503, "policy_response_invalid");
        value = {
          ok: true,
          contract_version: "1.0.0",
          valid: true,
          checked_events: result.checked_events,
          last_sequence: result.last_sequence,
          last_sha256: result.last_sha256,
          complete: result.complete,
          failed_sequence: null,
          reason: null,
          caller_supplied_anchor: result.caller_supplied_anchor,
          external_anchor_established: false,
        };
      } else {
        if (
          !(result.error === "audit_head_mismatch" ||
            integer(result.failed_sequence, 1)) ||
          !integer(result.checked_events ?? 0, 0, limit)
        ) return fail(503, "policy_response_invalid");
        value = {
          ok: true,
          contract_version: "1.0.0",
          valid: false,
          checked_events: result.checked_events ?? 0,
          last_sequence: null,
          last_sha256: null,
          complete: false,
          failed_sequence: result.failed_sequence ?? null,
          reason: result.error === "audit_head_mismatch"
            ? "audit_head_mismatch"
            : "chain_hash_mismatch",
          caller_supplied_anchor: args.expected_previous_sha256 !== undefined,
          external_anchor_established: false,
        };
      }
    }
  }
  if (outputValidators.get(operation)?.(value) !== true) {
    return fail(503, "policy_response_invalid", contract.is_mutation);
  }
  return reply(status, value);
}
