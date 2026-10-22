import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import type { PolicyDb } from "./access_policy.ts";

type ObjectValue = Record<string, unknown>;
export type LifecycleContext = {
  actorId: string;
  kind: "user" | "api_key" | "job_lease";
  requestId: string;
  originalChannel: "api" | "mcp";
  scope?: { approvalId?: string };
  /** Set only from the gateway's verified engineering WeakMap proof. */
  engineering?: { userId: string; sessionId: string; epoch: number };
};
export type LifecycleDependencies = {
  db: PolicyDb;
  /** The same canonical registry/auth/schema/admission/executor pipeline. */
  executeCanonical: (
    context: LifecycleContext,
    operation: string,
    args: ObjectValue,
  ) => Promise<Response>;
};
const object = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const uuidSchema = { type: "string", format: "uuid" };
const schema = (
  properties: ObjectValue,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const resultSchema = (properties: ObjectValue) =>
  schema({
    ok: { const: true },
    contract_version: { const: "1.0.0" },
    ...properties,
  });
const sourceInput = { source_request_id: uuidSchema };
const nullableUuid = { type: ["string", "null"], format: "uuid" };
const resourceSchema = {
  oneOf: [
    schema({
      provider: { const: "github" },
      repository: { const: "ausstyle/web-staging" },
      branch: {
        type: "string",
        pattern: "^(main|engineering/[A-Za-z0-9_./-]+)$",
      },
      path: { type: "string", minLength: 1, maxLength: 1024 },
    }),
    schema({
      provider: { const: "gcp" },
      project_id: { const: "elaborate-haven-511518-a5" },
      zone: { const: "europe-west1-b" },
      instance_id: { type: "string", pattern: "^[1-9][0-9]{0,19}$" },
      instance_name: { type: "string" },
    }),
  ],
};
const verificationSchema = resultSchema({
  source_request_id: uuidSchema,
  phase: { enum: ["source", "compensation"] },
  observation_id: uuidSchema,
  read_admission_id: uuidSchema,
  effect_confirmed: { type: "boolean" },
  automatic_retry: { const: false },
});
const compensationSchema = resultSchema({
  source_request_id: uuidSchema,
  request_id: uuidSchema,
  request_state: {
    enum: ["reserved", "accepted", "failed", "unknown", "verified"],
  },
  executed: { type: ["boolean", "null"] },
  effect_confirmed: { type: "boolean" },
  reconciliation_required: { type: "boolean" },
  redispatch_permitted: { const: false },
  admission_id: nullableUuid,
});
export const providerLifecycleContracts: Record<
  string,
  {
    is_mutation: boolean;
    permission_scope: string;
    description: string;
    input_schema: ObjectValue;
    output_schema: ObjectValue;
  }
> = {
  "system.lifecycle.get": {
    is_mutation: false,
    permission_scope: "system:read",
    description:
      "Read an owned immutable provider lifecycle snapshot summary, verified readback and compensation receipt. Historical requests without a server-captured preimage fail closed; private file content and arguments are excluded. Contract v1.0.0.",
    input_schema: schema(sourceInput),
    output_schema: resultSchema({
      source_request_id: uuidSchema,
      snapshot_id: uuidSchema,
      source_operation: {
        enum: [
          "github.files.upsert",
          "github.files.create",
          "github.files.update",
          "github.files.delete",
          "github.update_file",
          "gcp.compute.instances.start",
          "gcp.compute.instances.stop",
        ],
      },
      source_state: { type: "string" },
      captured_at: { type: "string", format: "date-time" },
      resource: resourceSchema,
      compensation_operation: {
        enum: [
          "github.files.upsert",
          "github.files.create",
          "github.files.update",
          "github.files.delete",
          "gcp.compute.instances.start",
          "gcp.compute.instances.stop",
        ],
      },
      compensation_input_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      latest_source_effect_confirmed: { type: "boolean" },
      compensation_request_id: nullableUuid,
      compensation_state: {
        type: ["string", "null"],
        enum: [null, "reserved", "accepted", "failed", "unknown", "verified"],
      },
      provider_state_cas_available: { type: "boolean" },
      limitations: { type: "array", maxItems: 3, items: { type: "string" } },
    }),
  },
  "system.lifecycle.verify": {
    is_mutation: false,
    permission_scope: "system:read",
    description:
      "Read the real provider through canonical Sandy API and immutably record whether the approved source effect or conditional compensation is observed. This never retries a mutation or invents missing preimage evidence. Contract v1.0.0.",
    input_schema: schema({
      ...sourceInput,
      phase: { enum: ["source", "compensation"] },
    }, ["source_request_id"]),
    output_schema: verificationSchema,
  },
  "system.lifecycle.poll": {
    is_mutation: false,
    permission_scope: "infrastructure:read",
    description:
      "Poll one fixed-project GCP zone/global compute operation with a real canonical GET. DONE is distinct from successful effect verification; operation errors and pending states remain explicit. Contract v1.0.0.",
    input_schema: schema({
      scope: { enum: ["zone", "global"] },
      operation_name: {
        type: "string",
        pattern: "^[a-z][a-z0-9-]{0,100}$|^[1-9][0-9]{0,19}$",
      },
    }),
    output_schema: resultSchema({
      read_admission_id: uuidSchema,
      provider_operation: schema({
        name: { type: "string" },
        status: { enum: ["DONE", "PENDING", "RUNNING"] },
        target_id: { type: ["string", "null"] },
        target_link: { type: ["string", "null"] },
        operation_type: { type: ["string", "null"] },
      }),
      terminal: { type: "boolean" },
      provider_reported_error: { type: "boolean" },
      effect_confirmed: { const: false },
      automatic_retry: { const: false },
    }),
  },
  "system.lifecycle.compensate": {
    is_mutation: true,
    permission_scope: "system:write",
    description:
      "Execute one authorized inverse from an immutable provider preimage after exact-resource readback. Standing engineering recovery derives its baseline from verified Git history and reauthorizes the inverse under the current resource policy. Other callers retain separately approved compensation. Ambiguous dispatch is never replayed. Contract v1.0.0.",
    input_schema: schema({
      ...sourceInput,
      compensation_approval_id: uuidSchema,
    }, ["source_request_id"]),
    output_schema: compensationSchema,
  },
};
const ajv = new Ajv({ strict: true, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const inputs = new Map(
  Object.entries(providerLifecycleContracts).map((
    [name, contract],
  ) => [name, ajv.compile(contract.input_schema)]),
);
const outputs = new Map(
  Object.entries(providerLifecycleContracts).map((
    [name, contract],
  ) => [name, ajv.compile(contract.output_schema)]),
);
export const isProviderLifecycleOperation = (operation: string) =>
  Object.hasOwn(providerLifecycleContracts, operation);
export function providerLifecycleContractMatches(
  operation: string,
  entry: unknown,
): boolean {
  const c = providerLifecycleContracts[operation];
  if (!c || !object(entry)) return false;
  try {
    return entry.handler === "sandy-operation-api" &&
      entry.is_mutation === c.is_mutation &&
      entry.permission_scope === c.permission_scope &&
      canonicalJson(entry.input_schema) === canonicalJson(c.input_schema) &&
      canonicalJson(entry.output_schema) === canonicalJson(c.output_schema);
  } catch {
    return false;
  }
}
const response = (status: number, body: ObjectValue) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const failure = (status: number, error: string, unknown = false) =>
  response(status, {
    ok: false,
    error,
    ...(unknown
      ? { reconciliation_required: true, executed: null }
      : { executed: false }),
  });
const errors = new Map([
  ["owner_required", 403],
  ["recovery_source_not_owned", 404],
  ["verified_github_recovery_source_required", 424],
  ["immutable_recovery_proof_invalid", 409],
  ["compensation_resource_changed", 409],
  ["compensation_not_resumable", 409],
  ["engineering_request_conflict", 409],
  ["engineering_policy_blocked", 403],
  ["standing_delegation_inactive", 403],
  ["engineering_rate_limited", 429],
  ["verified_approved_preimage_scope_required", 424],
  ["invalid_preimage_record", 400],
  ["preimage_admission_proof_invalid", 409],
  ["unsupported_preimage_scope", 422],
  ["immutable_preimage_conflict", 409],
  ["immutable_provider_preimage_missing", 424],
  ["invalid_lifecycle_observation", 400],
  ["lifecycle_readback_proof_invalid", 409],
  ["immutable_observation_conflict", 409],
  ["verified_scoped_compensation_approval_required", 424],
  ["compensation_reservation_not_found", 404],
  ["compensation_admission_scope_mismatch", 409],
]);
async function rpc(
  deps: LifecycleDependencies,
  name: string,
  args: ObjectValue,
  mutation = false,
): Promise<ObjectValue | Response> {
  try {
    const reply = await deps.db.rpc(name, args);
    if (reply.error || !object(reply.data)) {
      return failure(
        503,
        mutation ? "lifecycle_record_outcome_unknown" : "lifecycle_unavailable",
        mutation,
      );
    }
    if (reply.data.ok === true) return reply.data;
    const status = typeof reply.data.error === "string"
      ? errors.get(reply.data.error)
      : undefined;
    return status && reply.data.http_status === status
      ? failure(status, String(reply.data.error))
      : failure(503, "lifecycle_response_invalid", mutation);
  } catch {
    return failure(
      503,
      mutation ? "lifecycle_record_outcome_unknown" : "lifecycle_unavailable",
      mutation,
    );
  }
}
type ReadObservation = {
  admissionId: string;
  absent: boolean;
  result: ObjectValue;
  canonical: string;
};
async function readProvider(
  deps: LifecycleDependencies,
  context: LifecycleContext,
  operation: string,
  args: ObjectValue,
  approvalId?: string,
): Promise<ReadObservation | Response> {
  try {
    const reply = await deps.executeCanonical(
      {
        ...context,
        requestId: crypto.randomUUID(),
        scope: approvalId ? { approvalId } : undefined,
      },
      operation,
      args,
    );
    const envelope: unknown = await reply.json();
    const body: unknown = object(envelope) && object(envelope.result) &&
        envelope.result.operation === operation &&
        envelope.result.admission_id === envelope.admission_id
      ? envelope.result
      : envelope;
    if (
      !object(body) || body.operation !== operation ||
      !uuid(body.admission_id) || body.executed !== true
    ) return failure(424, "canonical_provider_observation_unavailable");
    if (
      reply.status === 404 && body.error === "provider_resource_not_found" &&
      body.provider_http_status === 404 && body.request_state === "failed" &&
      body.receipt_recorded === true
    ) {
      const result = {
        error: "provider_resource_not_found",
        provider_http_status: 404,
      };
      return {
        admissionId: body.admission_id,
        absent: true,
        result,
        canonical: canonicalJson(result),
      };
    }
    if (
      !reply.ok || body.ok !== true || body.request_state !== "observed" ||
      !object(body.result)
    ) return failure(424, "canonical_provider_observation_unavailable");
    return {
      admissionId: body.admission_id,
      absent: false,
      result: body.result,
      canonical: canonicalJson(body.result),
    };
  } catch {
    return failure(424, "canonical_provider_observation_unavailable");
  }
}
const fixturePrefix = "docs/sandy-api/compensation-fixtures/";
const project = "elaborate-haven-511518-a5", zone = "europe-west1-b";
function filePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(fixturePrefix) &&
    value.length > fixturePrefix.length && value.length <= 1024 &&
    !/[\\%?#\u0000-\u001f\u007f]/.test(value) &&
    !value.split("/").some((part) => !part || part === "." || part === "..");
}
function decodeContent(value: unknown): Uint8Array | null {
  if (
    typeof value !== "string" || value.length > 90000 ||
    !/^[A-Za-z0-9+/=\r\n]*$/.test(value)
  ) return null;
  try {
    const decoded = Uint8Array.from(
      atob(value.replaceAll(/\s/g, "")),
      (c) => c.charCodeAt(0),
    );
    return decoded.length <= 65536 ? decoded : null;
  } catch {
    return null;
  }
}
export async function gitBlobSha(content: string): Promise<string | null> {
  const bytes = decodeContent(content);
  if (!bytes) return null;
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`),
    message = new Uint8Array(header.length + bytes.length);
  message.set(header);
  message.set(bytes, header.length);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-1", message)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
function vmIdentity(value: ObjectValue): ObjectValue | null {
  if (
    typeof value.id !== "string" || !/^[1-9][0-9]{0,19}$/.test(value.id) ||
    typeof value.name !== "string" ||
    !/^[a-z][-a-z0-9]{0,62}$/.test(value.name) ||
    typeof value.zone !== "string" ||
    !value.zone.endsWith(`/projects/${project}/zones/${zone}`) ||
    typeof value.selfLink !== "string" ||
    value.selfLink !==
      `https://www.googleapis.com/compute/v1/projects/${project}/zones/${zone}/instances/${value.name}` ||
    typeof value.creationTimestamp !== "string" ||
    !Number.isFinite(Date.parse(value.creationTimestamp)) ||
    !["RUNNING", "TERMINATED"].includes(String(value.status)) ||
    !Array.isArray(value.disks) ||
    value.disks.some((disk) => !object(disk) || disk.type !== "PERSISTENT")
  ) return null;
  return {
    id: value.id,
    name: value.name,
    zone: value.zone,
    selfLink: value.selfLink,
    creationTimestamp: value.creationTimestamp,
    status: value.status,
  };
}
/** Hook called by the canonical mutation pipeline after shared admission and
 * before its one-use grant is consumed. Never exposed as caller-supplied data.
 */
export async function captureLifecyclePreimage(
  deps: LifecycleDependencies,
  context: LifecycleContext,
  sourceAdmissionId: string,
  sourceOperation: string,
  sourceArguments: ObjectValue,
): Promise<Response> {
  if (
    context.kind !== "user" || !uuid(context.actorId) ||
    !uuid(sourceAdmissionId) || !uuid(context.requestId)
  ) return failure(403, "normal_owner_mutation_context_required");
  if (
    new TextEncoder().encode(canonicalJson(sourceArguments)).length > 120000
  ) return failure(400, "lifecycle_preimage_size_limit");
  if (
    ![
      "github.files.upsert",
      "gcp.compute.instances.start",
      "gcp.compute.instances.stop",
    ].includes(sourceOperation)
  ) return failure(422, "provider_compensation_not_supported");
  const guard = await rpc(deps, "sandy_lifecycle_source_guard", {
    p_actor_id: context.actorId,
    p_source_admission_id: sourceAdmissionId,
  });
  if (guard instanceof Response) return guard;
  if (
    guard.source_request_id !== context.requestId ||
    guard.source_operation !== sourceOperation ||
    guard.source_input_sha256 !== await argumentDigest(sourceArguments)
  ) return failure(409, "source_mutation_scope_mismatch");
  let readOperation: string,
    readArguments: ObjectValue,
    verifyOperation: string,
    verifyArguments: ObjectValue;
  let baseline: ObjectValue,
    expected: ObjectValue,
    compensationOperation: string,
    compensationArguments: ObjectValue,
    resource: ObjectValue;
  if (sourceOperation === "github.files.upsert") {
    const path = object(sourceArguments.path)
      ? sourceArguments.path.path
      : undefined;
    const body = object(sourceArguments.body)
      ? sourceArguments.body
      : undefined;
    if (
      !filePath(path) || !body || body.branch !== "main" ||
      typeof body.content !== "string" || !decodeContent(body.content)
    ) return failure(422, "fixed_repository_compensation_scope_required");
    if (!uuid(guard.preimage_read_approval_id)) {
      return failure(424, "approved_server_preimage_read_required");
    }
    readOperation = "github.files.content.get";
    readArguments = { path: { path }, query: { ref: "main" } };
    verifyOperation = "github.files.metadata.get";
    verifyArguments = readArguments;
    const observed = await readProvider(
      deps,
      context,
      readOperation,
      readArguments,
      guard.preimage_read_approval_id,
    );
    if (observed instanceof Response) return observed;
    const targetSha = await gitBlobSha(body.content);
    if (!targetSha) return failure(400, "invalid_file_content");
    if (observed.absent) {
      if (body.sha !== undefined) {
        return failure(409, "approved_file_precondition_not_observed");
      }
      baseline = { exists: false };
      compensationOperation = "github.files.delete";
      compensationArguments = {
        path: { path },
        body: {
          message: `Sandy compensation for ${context.requestId}`,
          sha: targetSha,
          branch: "main",
        },
      };
    } else {
      const before = observed.result;
      if (
        before.path !== path || before.type !== "file" ||
        before.encoding !== "base64" || !sha(before.sha) ||
        body.sha !== before.sha || typeof before.content !== "string" ||
        !decodeContent(before.content) ||
        await gitBlobSha(before.content) !== before.sha ||
        before.sha === targetSha
      ) return failure(409, "approved_file_precondition_not_observed");
      baseline = { exists: true, sha: before.sha };
      compensationOperation = "github.files.upsert";
      compensationArguments = {
        path: { path },
        body: {
          message: `Sandy compensation for ${context.requestId}`,
          content: before.content,
          sha: targetSha,
          branch: "main",
        },
      };
    }
    expected = { exists: true, sha: targetSha };
    resource = {
      provider: "github",
      repository: "ausstyle/web-staging",
      branch: "main",
      path,
    };
    return storePreimage(deps, context, sourceAdmissionId, sourceArguments, {
      readOperation,
      readArguments,
      verifyOperation,
      verifyArguments,
      observed,
      baseline,
      expected,
      compensationOperation,
      compensationArguments,
      resource,
    });
  }
  const path = object(sourceArguments.path)
    ? sourceArguments.path.instance
    : undefined;
  if (
    typeof path !== "string" ||
    !/^(?:[a-z][-a-z0-9]{0,62}|[1-9][0-9]{0,19})$/.test(path) ||
    (object(sourceArguments.query) &&
      Object.keys(sourceArguments.query).some((name) => name !== "requestId"))
  ) return failure(422, "noncompensatable_vm_options");
  readOperation = verifyOperation = "gcp.compute.instances.get";
  readArguments = { path: { instance: path } };
  const observed = await readProvider(
    deps,
    context,
    readOperation,
    readArguments,
  );
  if (observed instanceof Response) return observed;
  const identity = observed.absent ? null : vmIdentity(observed.result);
  if (
    !identity || (path !== identity.name && path !== identity.id) ||
    identity.status !==
      (sourceOperation.endsWith(".start") ? "TERMINATED" : "RUNNING")
  ) return failure(424, "stable_safe_vm_preimage_unavailable");
  baseline = identity;
  expected = {
    ...identity,
    status: sourceOperation.endsWith(".start") ? "RUNNING" : "TERMINATED",
  };
  compensationOperation = sourceOperation.endsWith(".start")
    ? "gcp.compute.instances.stop"
    : "gcp.compute.instances.start";
  compensationArguments = {
    path: { instance: identity.id },
    query: { requestId: crypto.randomUUID() },
  };
  verifyArguments = { path: { instance: identity.id } };
  resource = {
    provider: "gcp",
    project_id: project,
    zone,
    instance_id: identity.id,
    instance_name: identity.name,
  };
  return storePreimage(deps, context, sourceAdmissionId, sourceArguments, {
    readOperation,
    readArguments,
    verifyOperation,
    verifyArguments,
    observed,
    baseline,
    expected,
    compensationOperation,
    compensationArguments,
    resource,
  });
}
async function storePreimage(
  deps: LifecycleDependencies,
  context: LifecycleContext,
  sourceAdmissionId: string,
  sourceArguments: ObjectValue,
  values: {
    readOperation: string;
    readArguments: ObjectValue;
    verifyOperation: string;
    verifyArguments: ObjectValue;
    observed: ReadObservation;
    baseline: ObjectValue;
    expected: ObjectValue;
    compensationOperation: string;
    compensationArguments: ObjectValue;
    resource: ObjectValue;
  },
): Promise<Response> {
  const record = {
    source_arguments: sourceArguments,
    source_arguments_canonical: canonicalJson(sourceArguments),
    read_admission_id: values.observed.admissionId,
    read_operation: values.readOperation,
    read_arguments: values.readArguments,
    read_arguments_canonical: canonicalJson(values.readArguments),
    read_result: values.observed.result,
    read_result_canonical: values.observed.canonical,
    verify_operation: values.verifyOperation,
    verify_arguments: values.verifyArguments,
    verify_arguments_canonical: canonicalJson(values.verifyArguments),
    verify_input_sha256: await argumentDigest(values.verifyArguments),
    baseline: values.baseline,
    expected_effect: values.expected,
    compensation_operation: values.compensationOperation,
    compensation_arguments: values.compensationArguments,
    compensation_arguments_canonical: canonicalJson(
      values.compensationArguments,
    ),
    compensation_input_sha256: await argumentDigest(
      values.compensationArguments,
    ),
    resource: values.resource,
  };
  const stored = await rpc(deps, "sandy_lifecycle_capture", {
    p_actor_id: context.actorId,
    p_source_admission_id: sourceAdmissionId,
    p_record: record,
  }, true);
  if (stored instanceof Response) return stored;
  if (
    !uuid(stored.snapshot_id) || typeof stored.reused !== "boolean" ||
    stored.provider_dispatched !== false
  ) return failure(503, "preimage_record_outcome_unknown", true);
  return response(200, {
    ok: true,
    snapshot_id: stored.snapshot_id,
    reused: stored.reused,
    provider_dispatched: false,
  });
}
type Snapshot = {
  id: string;
  source_request_id: string;
  source_operation: string;
  captured_at: string;
  record: ObjectValue;
};
async function loadSnapshot(
  deps: LifecycleDependencies,
  context: LifecycleContext,
  sourceRequestId: string,
): Promise<{ snapshot: Snapshot; data: ObjectValue } | Response> {
  const value = await rpc(deps, "sandy_lifecycle_context", {
    p_actor_id: context.actorId,
    p_source_request_id: sourceRequestId,
  });
  if (value instanceof Response) return value;
  const s = value.snapshot;
  if (
    !object(s) || !uuid(s.id) || s.actor_id !== context.actorId ||
    s.source_request_id !== sourceRequestId ||
    typeof s.source_operation !== "string" ||
    typeof s.captured_at !== "string" || !object(s.record)
  ) return failure(503, "lifecycle_snapshot_invalid");
  const r = s.record;
  if (
    !object(r.compensation_arguments) || !object(r.verify_arguments) ||
    !object(r.baseline) || !object(r.expected_effect) || !object(r.resource) ||
    !hash(r.compensation_input_sha256) ||
    await argumentDigest(r.compensation_arguments) !==
      r.compensation_input_sha256 ||
    !hash(r.verify_input_sha256) ||
    await argumentDigest(r.verify_arguments) !== r.verify_input_sha256 ||
    typeof r.compensation_operation !== "string" ||
    typeof r.verify_operation !== "string"
  ) return failure(503, "lifecycle_snapshot_invalid");
  if (githubFileSource(s.source_operation)) {
    const path = object(r.verify_arguments.path)
      ? r.verify_arguments.path.path
      : undefined;
    if (
      !(context.engineering ? safeRepositoryPath(path) : filePath(path)) ||
      r.verify_operation !== "github.files.metadata.get" ||
      ![
        "github.files.upsert",
        "github.files.create",
        "github.files.update",
        "github.files.delete",
      ]
        .includes(
          r.compensation_operation,
        )
    ) return failure(503, "lifecycle_snapshot_invalid");
  } else if (
    !["gcp.compute.instances.start", "gcp.compute.instances.stop"].includes(
      s.source_operation,
    ) || r.verify_operation !== "gcp.compute.instances.get" ||
    !["gcp.compute.instances.start", "gcp.compute.instances.stop"].includes(
      r.compensation_operation,
    )
  ) return failure(503, "lifecycle_snapshot_invalid");
  return { snapshot: s as Snapshot, data: value };
}
function effectMatches(
  snapshot: Snapshot,
  observation: ReadObservation,
  phase: "source" | "compensation",
): boolean {
  const expected = snapshot
    .record[phase === "source" ? "expected_effect" : "baseline"] as ObjectValue;
  if (githubFileSource(snapshot.source_operation)) {
    if (expected.exists === false) return observation.absent;
    const path = (snapshot.record.resource as ObjectValue).path;
    return !observation.absent && observation.result.path === path &&
      observation.result.type === "file" &&
      observation.result.sha === expected.sha;
  }
  const actual = observation.absent ? null : vmIdentity(observation.result);
  return actual !== null &&
    ["id", "name", "zone", "selfLink", "creationTimestamp", "status"].every((
      name,
    ) => actual[name] === expected[name]);
}
async function observe(
  deps: LifecycleDependencies,
  context: LifecycleContext,
  snapshot: Snapshot,
  phase: "source" | "compensation",
): Promise<ObjectValue | Response> {
  const read = await readProvider(
    deps,
    context,
    String(snapshot.record.verify_operation),
    snapshot.record.verify_arguments as ObjectValue,
  );
  if (read instanceof Response) return read;
  const matched = effectMatches(snapshot, read, phase);
  const recorded = await rpc(deps, "sandy_lifecycle_observe", {
    p_actor_id: context.actorId,
    p_snapshot_id: snapshot.id,
    p_phase: phase,
    p_read_admission_id: read.admissionId,
    p_read_result: read.result,
    p_read_result_canonical: read.canonical,
    p_matched: matched,
  }, true);
  if (recorded instanceof Response) return recorded;
  if (
    !uuid(recorded.observation_id) || recorded.effect_confirmed !== matched ||
    recorded.phase !== phase || recorded.read_admission_id !== read.admissionId
  ) return failure(503, "lifecycle_observation_outcome_unknown", true);
  return {
    ok: true,
    contract_version: "1.0.0",
    source_request_id: snapshot.source_request_id,
    phase,
    observation_id: recorded.observation_id,
    read_admission_id: read.admissionId,
    effect_confirmed: matched,
    automatic_retry: false,
  };
}
export async function executeProviderLifecycle(
  deps: LifecycleDependencies,
  context: LifecycleContext,
  operation: string,
  args: unknown,
): Promise<Response> {
  if (!isProviderLifecycleOperation(operation)) {
    return failure(404, "provider_lifecycle_operation_not_found");
  }
  if (
    !uuid(context.actorId) || !uuid(context.requestId) ||
    !["api", "mcp"].includes(context.originalChannel)
  ) return failure(401, "invalid_identity");
  if (
    context.kind !== "user" &&
    !(context.kind === "job_lease" && operation === "system.lifecycle.poll")
  ) return failure(403, "normal_owner_session_required");
  if (!object(args) || inputs.get(operation)?.(args) !== true) {
    return failure(400, "invalid_operation_arguments");
  }
  let value: ObjectValue, status = 200;
  if (operation === "system.lifecycle.poll") {
    const providerOperation = args.scope === "zone"
      ? "gcp.compute.zone_operations.get"
      : "gcp.compute.global_operations.get";
    const observed = await readProvider(deps, context, providerOperation, {
      path: { operation: args.operation_name },
    });
    if (observed instanceof Response) return observed;
    const result = observed.result;
    if (
      observed.absent || result.name !== args.operation_name ||
      !["DONE", "PENDING", "RUNNING"].includes(String(result.status))
    ) return failure(424, "provider_operation_observation_incomplete");
    value = {
      ok: true,
      contract_version: "1.0.0",
      read_admission_id: observed.admissionId,
      provider_operation: {
        name: result.name,
        status: result.status,
        target_id: typeof result.targetId === "string" ? result.targetId : null,
        target_link: typeof result.targetLink === "string"
          ? result.targetLink
          : null,
        operation_type: typeof result.operationType === "string"
          ? result.operationType
          : null,
      },
      terminal: result.status === "DONE",
      provider_reported_error: Object.hasOwn(result, "error"),
      effect_confirmed: false,
      automatic_retry: false,
    };
  } else {
    if (context.engineering) {
      const prepared = await prepareStandingGithubRecovery(
        deps,
        context,
        String(args.source_request_id),
      );
      if (prepared instanceof Response) return prepared;
    } else if (
      operation === "system.lifecycle.compensate" &&
      !uuid(args.compensation_approval_id)
    ) {
      return failure(424, "verified_scoped_compensation_approval_required");
    }
    const loaded = await loadSnapshot(
      deps,
      context,
      String(args.source_request_id),
    );
    if (loaded instanceof Response) return loaded;
    const { snapshot, data } = loaded;
    if (operation === "system.lifecycle.get") {
      const c = object(data.compensation) ? data.compensation : undefined;
      const observations = Array.isArray(data.observations)
        ? data.observations.filter((v) =>
          object(v) && v.phase === "source"
        ) as ObjectValue[]
        : [];
      const vm = !githubFileSource(snapshot.source_operation);
      value = {
        ok: true,
        contract_version: "1.0.0",
        source_request_id: snapshot.source_request_id,
        snapshot_id: snapshot.id,
        source_operation: snapshot.source_operation,
        source_state: data.source_state,
        captured_at: snapshot.captured_at,
        resource: snapshot.record.resource,
        compensation_operation: snapshot.record.compensation_operation,
        compensation_input_sha256: snapshot.record.compensation_input_sha256,
        latest_source_effect_confirmed: observations.at(-1)?.matched === true,
        compensation_request_id: c?.request_id ?? null,
        compensation_state: c?.state ?? null,
        provider_state_cas_available: !vm,
        limitations: vm
          ? [
            "GCP start/stop has no provider state compare-and-swap; the inverse approval must acknowledge external state races",
            "Only exact numeric VM identity without scratch disks is eligible",
          ]
          : [
            "File compensation uses the provider's expected current SHA; repository branch and fixture path are fixed",
          ],
      };
    } else if (operation === "system.lifecycle.verify") {
      const observed = await observe(
        deps,
        context,
        snapshot,
        args.phase === "compensation" ? "compensation" : "source",
      );
      if (observed instanceof Response) return observed;
      value = observed;
    } else {
      if (
        context.engineering && object(data.compensation) &&
        ["reserved", "unknown"].includes(String(data.compensation.state)) &&
        !uuid(data.compensation.admission_id)
      ) {
        const synchronized = await rpc(
          deps,
          "sandy_lifecycle_finish_compensation",
          {
            p_actor_id: context.actorId,
            p_snapshot_id: snapshot.id,
            p_request_id: data.compensation.request_id,
          },
          true,
        );
        if (synchronized instanceof Response) return synchronized;
        data.compensation = { ...data.compensation, ...synchronized };
      }
      if (
        object(data.compensation) && !(context.engineering &&
          ["reserved", "unknown"].includes(String(data.compensation.state)) &&
          !uuid(data.compensation.admission_id))
      ) {
        const c = data.compensation;
        value = compensationReceipt(
          snapshot.source_request_id,
          c.request_id,
          c.state,
          c.admission_id,
        );
      } else {
        const observed = await observe(deps, context, snapshot, "source");
        if (observed instanceof Response) return observed;
        if (observed.effect_confirmed !== true) {
          return failure(409, "provider_effect_drift_compensation_refused");
        }
        const reserved = await rpc(
          deps,
          context.engineering
            ? "sandy_engineering_reserve_compensation"
            : "sandy_lifecycle_reserve_compensation",
          context.engineering
            ? {
              p_user_id: context.engineering.userId,
              p_session_id: context.engineering.sessionId,
              p_epoch: context.engineering.epoch,
              p_snapshot_id: snapshot.id,
              p_observation_id: observed.observation_id,
            }
            : {
              p_actor_id: context.actorId,
              p_snapshot_id: snapshot.id,
              p_approval_id: args.compensation_approval_id,
              p_observation_id: observed.observation_id,
            },
          true,
        );
        if (reserved instanceof Response) return reserved;
        if (
          !uuid(reserved.request_id) || typeof reserved.reused !== "boolean" ||
          reserved.redispatch_permitted !== !reserved.reused
        ) return failure(503, "compensation_reservation_outcome_unknown", true);
        if (
          reserved.reused === false ||
          context.engineering && reserved.attempt_delivery === true
        ) {
          try {
            await deps.executeCanonical(
              {
                ...context,
                requestId: reserved.request_id,
                scope: {
                  approvalId: String(
                    context.engineering
                      ? reserved.authorization_id
                      : args.compensation_approval_id,
                  ),
                },
              },
              String(snapshot.record.compensation_operation),
              snapshot.record.compensation_arguments as ObjectValue,
            );
          } catch {
            /* Finish reads the durable admission; never replay here. */
          }
        }
        const finished = await rpc(
          deps,
          "sandy_lifecycle_finish_compensation",
          {
            p_actor_id: context.actorId,
            p_snapshot_id: snapshot.id,
            p_request_id: reserved.request_id,
          },
          true,
        );
        if (finished instanceof Response) return finished;
        if (
          finished.request_id !== reserved.request_id ||
          finished.redispatch_permitted !== false
        ) return failure(503, "compensation_receipt_outcome_unknown", true);
        if (
          context.engineering &&
          ["accepted", "unknown"].includes(String(finished.state))
        ) {
          const verified = await observe(
            deps,
            context,
            snapshot,
            "compensation",
          );
          if (
            !(verified instanceof Response) &&
            verified.effect_confirmed === true
          ) finished.state = "verified";
        }
        value = compensationReceipt(
          snapshot.source_request_id,
          finished.request_id,
          finished.state,
          finished.admission_id,
        );
      }
      status =
        value.request_state === "verified" || value.request_state === "failed"
          ? 200
          : 202;
    }
  }
  if (outputs.get(operation)?.(value) !== true) {
    return failure(
      503,
      "lifecycle_response_invalid",
      operation === "system.lifecycle.compensate",
    );
  }
  return response(status, value);
}
function compensationReceipt(
  sourceRequestId: string,
  requestId: unknown,
  state: unknown,
  admissionId: unknown,
): ObjectValue {
  return {
    ok: true,
    contract_version: "1.0.0",
    source_request_id: sourceRequestId,
    request_id: requestId,
    request_state: state,
    executed: state === "verified" || state === "accepted" ? true : null,
    effect_confirmed: state === "verified",
    reconciliation_required: state !== "verified" && state !== "failed",
    redispatch_permitted: false,
    admission_id: admissionId ?? null,
  };
}

function githubFileSource(operation: string): boolean {
  return [
    "github.files.upsert",
    "github.files.create",
    "github.files.update",
    "github.files.delete",
    "github.update_file",
  ].includes(operation);
}
function safeRepositoryPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1024 &&
    /^(?!\.)(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/
      .test(value) &&
    !/(^|\/)(\.env[^/]*|\.git|\.github)(\/|$)|\.(pem|key|p12|pfx)$/i.test(
      value,
    );
}
async function prepareStandingGithubRecovery(
  deps: LifecycleDependencies,
  context: LifecycleContext,
  sourceRequestId: string,
): Promise<void | Response> {
  const engineering = context.engineering!;
  const identity = {
    p_user_id: engineering.userId,
    p_session_id: engineering.sessionId,
    p_epoch: engineering.epoch,
  };
  const source = await rpc(deps, "sandy_engineering_recovery_context", {
    ...identity,
    p_request_id: sourceRequestId,
  });
  if (source instanceof Response) return source;
  if (source.snapshot_exists === true) return;
  if (
    !sha(source.commit_sha) || !sha(source.blob_sha) ||
    !safeRepositoryPath(source.path) ||
    typeof source.branch !== "string" ||
    !source.branch.startsWith("engineering/") || !uuid(source.admission_id)
  ) {
    return failure(424, "verified_github_recovery_source_required");
  }
  const commitArgs = { path: { commit_sha: source.commit_sha } };
  const commit = await readProvider(
    deps,
    context,
    "github.git.commits.get",
    commitArgs,
  );
  if (commit instanceof Response) return commit;
  const parents = commit.result.parents;
  if (
    commit.absent || commit.result.sha !== source.commit_sha ||
    !Array.isArray(parents) ||
    !object(parents[0]) || !sha(parents[0].sha)
  ) return failure(424, "immutable_recovery_parent_unavailable");
  const readArgs = {
    path: { path: source.path },
    query: { ref: parents[0].sha },
  };
  const baseline = await readProvider(
    deps,
    context,
    "github.files.content.get",
    readArgs,
  );
  if (baseline instanceof Response) return baseline;
  const expectedOld = source.expected_blob_sha;
  if (
    baseline.absent
      ? expectedOld !== null
      : !sha(expectedOld) || baseline.result.sha !== expectedOld ||
        typeof baseline.result.content !== "string" ||
        await gitBlobSha(baseline.result.content) !== expectedOld
  ) {
    return failure(409, "immutable_recovery_baseline_mismatch");
  }
  const compensationOperation = source.effect_exists === false
    ? "github.files.create"
    : baseline.absent
    ? "github.files.delete"
    : "github.files.update";
  const compensationArguments = {
    path: { path: source.path },
    body: {
      branch: source.branch,
      ...(source.effect_exists === false ? {} : { sha: source.blob_sha }),
      message: `Sandy compensation for ${sourceRequestId}`,
      ...(baseline.absent ? {} : { content: baseline.result.content }),
    },
  };
  const verifyArguments = {
    path: { path: source.path },
    query: { ref: source.branch },
  };
  const record = {
    proof_version: 2,
    commit_read_admission_id: commit.admissionId,
    commit_read_result: commit.result,
    commit_read_result_canonical: commit.canonical,
    commit_read_arguments_canonical: canonicalJson(commitArgs),
    read_admission_id: baseline.admissionId,
    read_operation: "github.files.content.get",
    read_arguments: readArgs,
    read_arguments_canonical: canonicalJson(readArgs),
    read_result: baseline.result,
    read_result_canonical: baseline.canonical,
    baseline: baseline.absent
      ? { exists: false }
      : { exists: true, sha: expectedOld },
    expected_effect: source.effect_exists === false
      ? { exists: false }
      : { exists: true, sha: source.blob_sha },
    resource: {
      provider: "github",
      repository: "ausstyle/web-staging",
      branch: source.branch,
      path: source.path,
    },
    verify_operation: "github.files.metadata.get",
    verify_arguments: verifyArguments,
    verify_arguments_canonical: canonicalJson(verifyArguments),
    verify_input_sha256: await argumentDigest(verifyArguments),
    compensation_operation: compensationOperation,
    compensation_arguments: compensationArguments,
    compensation_arguments_canonical: canonicalJson(compensationArguments),
    compensation_input_sha256: await argumentDigest(compensationArguments),
  };
  const stored = await rpc(deps, "sandy_engineering_capture_recovery", {
    ...identity,
    p_request_id: sourceRequestId,
    p_record: record,
  }, true);
  if (stored instanceof Response) return stored;
  if (!uuid(stored.snapshot_id)) {
    return failure(503, "immutable_recovery_capture_unknown", true);
  }
}
