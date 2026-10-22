/** Tenant-consented server-internal administration. Service credentials never become a customer session. */
import { approvedOwnerContract } from "../_shared/sandy_approval_contract.ts";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "npm:@supabase/supabase-js@2.57.4";
import {
  argumentDigest,
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  type JsonObject,
  serviceHandler,
  type ServiceOperation,
  serviceOperations,
  serviceProject,
  serviceScope,
} from "./contracts.ts";
export type Context = {
  actor_id: string;
  tenant_id: null;
  request_id: string;
  grant_id: string;
  admission_id?: string;
  credential_id?: null;
};
type Policy = {
  allowed: boolean;
  reused?: boolean;
  admission_id?: string;
  error?: string;
  http_status?: number;
};
type Grant = Context & {
  operation: string;
  input_sha256: string;
  contract_sha256: string;
  scope_sha256: string;
};
type Finish = {
  admission_id: string;
  outcome: "succeeded" | "accepted" | "failed" | "unknown";
  provider_http_status: number | null;
  provider_request_id: string | null;
  result_sha256: string;
};
type Client = SupabaseClient;
export type Dependencies = {
  service: string;
  projectUrl: string;
  client: Client;
  authorizeContext(context: Context, op: ServiceOperation): Promise<Policy>;
  consumeGrant(request: Grant): Promise<Policy>;
  finishExecution(request: Finish): Promise<Policy>;
  providerHttpMetadata?: () => {
    status: number | null;
    request_id: string | null;
    mutation_status?: number | null;
    mutation_request_id?: string | null;
  };
  resetProviderHttpMetadata?: () => void;
  rpc(
    name: string,
    args: JsonObject,
  ): Promise<{ data: unknown; error: unknown }>;
};
const object = (v: unknown): v is JsonObject =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const ajv = new Ajv({
  strict: true,
  strictTypes: false,
  allowUnionTypes: true,
});
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const validators = new Map(
  Object.values(serviceOperations).map(
    (op) => [op.operation, {
      input: ajv.compile(op.input_schema),
      result: ajv.compile(op.result_schema),
    }],
  ),
);
export function validateServiceContracts() {
  return validators.size;
}
const response = (status: number, body: JsonObject) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const refusal = (status: number, error: string) =>
  response(status, { ok: false, error, executed: false });
class ServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status = 502,
    readonly uncertain = false,
  ) {
    super(code);
  }
}
const text = (v: unknown): string | null => typeof v === "string" ? v : null;
export function projectUser(user: User | JsonObject): JsonObject {
  return Object.fromEntries(
    [
      "id",
      "email",
      "created_at",
      "updated_at",
      "email_confirmed_at",
      "last_sign_in_at",
      "banned_until",
      "deleted_at",
    ].map((key) => [key, text((user as unknown as JsonObject)[key])]),
  );
}
function bucketProjection(value: unknown): JsonObject {
  if (!object(value)) throw new ServiceError("provider_projection_invalid");
  return {
    id: value.id,
    name: value.name,
    public: value.public,
    created_at: text(value.created_at),
    updated_at: text(value.updated_at),
    file_size_limit: typeof value.file_size_limit === "number"
      ? value.file_size_limit
      : null,
    allowed_mime_types: Array.isArray(value.allowed_mime_types)
      ? value.allowed_mime_types
      : null,
  };
}
function fileProjection(value: unknown): JsonObject {
  if (!object(value)) throw new ServiceError("provider_projection_invalid");
  const metadata = object(value.metadata) ? value.metadata : {};
  return {
    id: text(value.id),
    name: value.name,
    created_at: text(value.created_at) ?? text(value.createdAt),
    updated_at: text(value.updated_at) ?? text(value.updatedAt),
    size: typeof metadata.size === "number"
      ? metadata.size
      : typeof value.size === "number"
      ? value.size
      : null,
    mimetype: text(metadata.mimetype) ?? text(value.content_type) ??
      text(value.contentType),
  };
}
function factorProjection(value: unknown): JsonObject {
  if (!object(value)) throw new ServiceError("provider_projection_invalid");
  return {
    id: value.id,
    factor_type: value.factor_type,
    status: value.status,
    created_at: text(value.created_at),
    updated_at: text(value.updated_at),
  };
}
async function unwrap<R extends { data: unknown; error: unknown }>(
  promise: PromiseLike<R>,
): Promise<NonNullable<R["data"]>> {
  const { data, error } = await promise;
  if (error) throw new ServiceError("provider_request_failed");
  if (data === null || data === undefined) {
    throw new ServiceError("provider_data_missing");
  }
  return data as NonNullable<R["data"]>;
}
function decode(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length > 87384) {
    throw new ServiceError("invalid_object_content", 400);
  }
  let raw: string;
  try {
    raw = atob(value);
  } catch {
    throw new ServiceError("invalid_object_content", 400);
  }
  if (raw.length > 65536 || btoa(raw) !== value) {
    throw new ServiceError("invalid_object_content", 400);
  }
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function digestBytes(value: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", value as BufferSource),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function receipt(
  resource: string,
  before: unknown,
  after: unknown,
  verified: boolean,
): Promise<JsonObject> {
  return {
    resource_id: resource,
    before_sha256: before === null ? null : await argumentDigest(before),
    after_sha256: after === null ? null : await argumentDigest(after),
    readback_verified: verified,
  };
}
async function sdkExecute(
  deps: Dependencies,
  op: ServiceOperation,
  args: JsonObject,
  guard: JsonObject,
  context: Context,
  admission: string,
): Promise<JsonObject> {
  const admin = deps.client.auth.admin;
  const id = String(args.user_id ?? "");
  const action = op.action;
  if (action === "auth_users_list") {
    const ids = Array.isArray(guard.user_ids) ? guard.user_ids as string[] : [];
    const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 20);
    const users = await Promise.all(
      ids.slice(offset, offset + limit).map(async (target) => {
        const data = await unwrap(admin.getUserById(target));
        if (!data.user) throw new ServiceError("provider_user_missing", 404);
        return projectUser(data.user);
      }),
    );
    return {
      users,
      next_offset: offset + limit < ids.length ? offset + limit : null,
    };
  }
  if (action === "auth_users_create") {
    // Admin creation sends no email and does not mint a login link/session. Random
    // password remains in memory; normal customer recovery is a separate policy.
    const password = Array.from(
      crypto.getRandomValues(new Uint8Array(48)),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
    const data = await unwrap(
      admin.createUser({
        email: String(args.email),
        password,
        email_confirm: false,
        user_metadata: {
          display_name: args.display_name ?? "",
          sandy_creation_admission: admission,
        },
      }),
    );
    if (!data.user) throw new ServiceError("provider_user_missing", 502, true);
    const bound = await deps.rpc("sandy_supabase_service_bind_user", {
      p_actor: context.actor_id,
      p_admission: admission,
      p_user: data.user.id,
    });
    if (bound.error || !object(bound.data) || bound.data.ok !== true) {
      throw new ServiceError("created_user_binding_unknown", 503, true);
    }
    const observed = await unwrap(admin.getUserById(data.user.id));
    if (!observed.user) {
      throw new ServiceError("provider_readback_failed", 502, true);
    }
    return {
      user: projectUser(observed.user),
      readback_verified: observed.user.id === data.user.id &&
        observed.user.email === args.email,
    };
  }
  if (action.startsWith("auth_users_")) {
    const before = await unwrap(admin.getUserById(id));
    if (!before.user) throw new ServiceError("provider_user_missing", 404);
    if (action === "auth_users_get") return { user: projectUser(before.user) };
    if (action === "auth_users_delete") {
      await unwrap(admin.deleteUser(id, false));
      const after = await admin.getUserById(id);
      const missing = !!after.error && Number(after.error.status) === 404;
      if (!missing) {
        throw new ServiceError("provider_deletion_readback_unknown", 502, true);
      }
      return receipt(id, projectUser(before.user), null, true);
    }
    const update = action === "auth_users_disable"
      ? { ban_duration: String(args.duration_hours) + "h" }
      : {
        user_metadata: {
          ...before.user.user_metadata,
          display_name: args.display_name,
        },
      };
    await unwrap(admin.updateUserById(id, update));
    const after = await unwrap(admin.getUserById(id));
    if (!after.user) {
      throw new ServiceError("provider_readback_failed", 502, true);
    }
    const observed = projectUser(after.user);
    const verified = action === "auth_users_disable"
      ? Date.parse(String(observed.banned_until)) > Date.now()
      : after.user.user_metadata?.display_name === args.display_name;
    return {
      user: observed,
      before_sha256: await argumentDigest(projectUser(before.user)),
      after_sha256: await argumentDigest(observed),
      readback_verified: verified,
    };
  }
  if (action.startsWith("auth_mfa_")) {
    const before = await unwrap(admin.mfa.listFactors({ userId: id }));
    if (action === "auth_mfa_list") {
      return { factors: before.factors.map(factorProjection) };
    }
    if (!before.factors.some((f) => f.id === args.factor_id)) {
      throw new ServiceError("mfa_factor_not_found", 404);
    }
    await unwrap(
      admin.mfa.deleteFactor({ userId: id, id: String(args.factor_id) }),
    );
    const after = await unwrap(admin.mfa.listFactors({ userId: id }));
    return receipt(
      String(args.factor_id),
      before.factors.map(factorProjection),
      after.factors.map(factorProjection),
      !after.factors.some((f) => f.id === args.factor_id),
    );
  }
  const bucket = String(guard.bucket_id);
  if (action.startsWith("storage_bucket_")) {
    if (action === "storage_bucket_list") {
      const buckets = await unwrap(deps.client.storage.listBuckets());
      return {
        buckets: buckets.filter((b) => b.id === bucket).map(bucketProjection),
      };
    }
    if (action === "storage_bucket_get") {
      return {
        bucket: bucketProjection(
          await unwrap(deps.client.storage.getBucket(bucket)),
        ),
      };
    }
    if (
      action === "storage_bucket_create" || action === "storage_bucket_update"
    ) {
      const options = {
        public: false,
        fileSizeLimit: args.file_size_limit as number | undefined,
        allowedMimeTypes: args.allowed_mime_types as string[] | undefined,
      };
      if (action.endsWith("create")) {
        await unwrap(deps.client.storage.createBucket(bucket, options));
        const bound = await deps.rpc("sandy_supabase_service_bind_bucket", {
          p_actor: context.actor_id,
          p_admission: admission,
        });
        if (bound.error || !object(bound.data) || bound.data.ok !== true) {
          throw new ServiceError("created_bucket_binding_unknown", 503, true);
        }
      } else await unwrap(deps.client.storage.updateBucket(bucket, options));
      const observed = bucketProjection(
        await unwrap(deps.client.storage.getBucket(bucket)),
      );
      return {
        bucket: observed,
        readback_verified: observed.public === false &&
          (args.file_size_limit === undefined ||
            observed.file_size_limit === args.file_size_limit) &&
          (args.allowed_mime_types === undefined ||
            canonicalJson(observed.allowed_mime_types) ===
              canonicalJson(args.allowed_mime_types)),
      };
    }
    const before = bucketProjection(
      await unwrap(deps.client.storage.getBucket(bucket)),
    );
    if (action === "storage_bucket_empty") {
      await unwrap(deps.client.storage.emptyBucket(bucket));
      const files = await unwrap(
        deps.client.storage.from(bucket).list("", { limit: 1 }),
      );
      return receipt(
        bucket,
        before,
        { remaining_root_entries: files.length },
        files.length === 0,
      );
    }
    await unwrap(deps.client.storage.deleteBucket(bucket));
    const after = await deps.client.storage.getBucket(bucket);
    if (
      after.error && object(after.error) &&
      String(after.error.statusCode) === "404"
    ) {
      const released = await deps.rpc("sandy_supabase_service_release_bucket", {
        p_actor: context.actor_id,
        p_admission: admission,
        p_canonical: canonicalJson(args),
      });
      if (
        released.error || !object(released.data) || released.data.ok !== true
      ) throw new ServiceError("deleted_bucket_binding_unknown", 503, true);
    }
    return receipt(
      bucket,
      before,
      null,
      !!after.error && object(after.error) &&
        String(after.error.statusCode) === "404",
    );
  }
  if (action.startsWith("storage_object_")) {
    const storage = deps.client.storage.from(bucket),
      path = String(args.path ?? "");
    if (action === "storage_object_list") {
      const limit = Number(args.limit ?? 100),
        offset = Number(args.offset ?? 0);
      const data = await unwrap(
        storage.list(String(args.prefix ?? ""), {
          limit,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      );
      return {
        objects: data.map(fileProjection),
        next_offset: data.length === limit ? offset + limit : null,
      };
    }
    if (action === "storage_object_get") {
      return { object: fileProjection(await unwrap(storage.info(path))) };
    }
    if (action === "storage_object_exists") {
      const data = await unwrap(storage.exists(path));
      return { exists: data };
    }
    if (action === "storage_object_download") {
      const info = await unwrap(storage.info(path));
      const projected = fileProjection(info);
      if (typeof projected.size !== "number" || projected.size > 65536) {
        throw new ServiceError("bounded_download_required", 413);
      }
      const blob = await unwrap(storage.download(path));
      if (blob.size > 65536) {
        throw new ServiceError("bounded_download_required", 413);
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return {
        content_base64: btoa(String.fromCharCode(...bytes)),
        content_type: blob.type || "application/octet-stream",
        size: bytes.length,
        sha256: await digestBytes(bytes),
      };
    }
    let before: unknown = null;
    if (!["storage_object_upload", "storage_object_copy"].includes(action)) {
      before = fileProjection(await unwrap(storage.info(path)));
    }
    if (
      action === "storage_object_upload" || action === "storage_object_update"
    ) {
      const bytes = decode(args.content_base64);
      const options = {
        contentType: String(args.content_type),
        upsert: false,
        cacheControl: "0",
      };
      if (action.endsWith("upload")) {
        await unwrap(storage.upload(path, bytes, options));
      } else await unwrap(storage.update(path, bytes, options));
      const observed = await unwrap(storage.download(path));
      if (observed.size > 65536) {
        throw new ServiceError("provider_readback_failed", 502, true);
      }
      const readback = new Uint8Array(await observed.arrayBuffer());
      return receipt(path, before, {
        size: readback.length,
        sha256: await digestBytes(readback),
      }, await digestBytes(bytes) === await digestBytes(readback));
    }
    if (action === "storage_object_delete") {
      await unwrap(storage.remove([path]));
      const exists = await unwrap(storage.exists(path));
      return receipt(path, before, null, exists === false);
    }
    const destination = String(args.destination);
    if (await unwrap(storage.exists(destination))) {
      throw new ServiceError("destination_exists", 409);
    }
    if (action === "storage_object_move") {
      await unwrap(storage.move(path, destination));
    } else await unwrap(storage.copy(path, destination));
    const after = fileProjection(await unwrap(storage.info(destination)));
    const sourcePresent = await unwrap(storage.exists(path));
    return receipt(
      destination,
      before,
      after,
      action === "storage_object_move"
        ? sourcePresent === false
        : sourcePresent === true,
    );
  }
  if (action === "realtime_channel_subscribe") {
    const topic = "sandy-service-v1:" + String(args.tenant_id) + ":" +
      String(args.name);
    const channel = deps.client.channel(topic, { config: { private: true } });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new ServiceError("realtime_subscription_timeout", 504)),
          8000,
        );
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timer);
            resolve();
          } else if (
            ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)
          ) {
            clearTimeout(timer);
            reject(new ServiceError("realtime_subscription_failed"));
          }
        });
      });
    } finally {
      await deps.client.removeChannel(channel);
    }
    return {
      topic,
      subscribed: true,
      connection_closed: true,
      scope: "single_ephemeral_private_channel",
    };
  }
  throw new ServiceError("operation_not_implemented", 404);
}
export function createServiceHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return refusal(405, "method_not_allowed");
    if (
      !deps.service ||
      req.headers.get("authorization") !== "Bearer " + deps.service
    ) return refusal(401, "internal_service_identity_required");
    if (deps.projectUrl !== "https://" + serviceProject + ".supabase.co") {
      return refusal(503, "fixed_project_configuration_mismatch");
    }
    let body: unknown;
    try {
      body = await requestJson(req, 196608);
    } catch (e) {
      return refusal(
        e instanceof JsonRequestError ? e.status : 400,
        "invalid_request",
      );
    }
    if (
      !object(body) || !Object.keys(body).every((k) =>
        [
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
    ) return refusal(400, "invalid_execution_context");
    const op = typeof body.operation === "string"
      ? serviceOperations[body.operation]
      : undefined;
    if (!op) return refusal(404, "operation_not_implemented");
    if (
      !uuid(body.actor_id) || body.tenant_id !== null ||
      !uuid(body.request_id) || !uuid(body.grant_id) ||
      (body.admission_id !== undefined && !uuid(body.admission_id)) ||
      (body.credential_id !== undefined && body.credential_id !== null)
    ) return refusal(400, "invalid_execution_context");
    const args = body.arguments;
    if (!object(args) || !validators.get(op.operation)!.input(args)) {
      return refusal(400, "invalid_arguments");
    }
    const context = body as unknown as Context;
    let policy: Policy;
    try {
      policy = await deps.authorizeContext(context, op);
    } catch {
      return refusal(503, "execution_policy_unavailable");
    }
    if (!policy.allowed) {
      return refusal(
        policy.http_status ?? 403,
        policy.error ?? "execution_scope_denied",
      );
    }
    let consumed: Policy;
    try {
      consumed = await deps.consumeGrant({
        ...context,
        operation: op.operation,
        input_sha256: await argumentDigest(args),
        contract_sha256: op.contract_sha256,
        scope_sha256: await argumentDigest(serviceScope),
      });
    } catch {
      return refusal(503, "execution_policy_unavailable");
    }
    if (!consumed.allowed || consumed.reused || !uuid(consumed.admission_id)) {
      return refusal(
        consumed.http_status ?? 409,
        consumed.error ?? "execution_grant_used_or_expired",
      );
    }
    const admission = consumed.admission_id;
    if (context.admission_id && context.admission_id !== admission) {
      return refusal(409, "execution_admission_mismatch");
    }
    let result: JsonObject;
    let executed = false;
    const finish = async (outcome: Finish["outcome"], value: unknown) => {
      try {
        return (await deps.finishExecution({
          admission_id: admission,
          outcome,
          provider_http_status: outcome === "accepted"
            ? deps.providerHttpMetadata?.().mutation_status ??
              deps.providerHttpMetadata?.().status ?? null
            : deps.providerHttpMetadata?.().status ?? null,
          provider_request_id: outcome === "accepted"
            ? deps.providerHttpMetadata?.().mutation_request_id ??
              deps.providerHttpMetadata?.().request_id ?? null
            : deps.providerHttpMetadata?.().request_id ?? null,
          result_sha256: await argumentDigest(value),
        })).allowed;
      } catch {
        return false;
      }
    };
    try {
      const argsCanonical = canonicalJson(args);
      const authorized = await deps.rpc("sandy_supabase_service_authorize", {
        p_actor: context.actor_id,
        p_admission: admission,
        p_canonical: argsCanonical,
      });
      if (
        authorized.error || !object(authorized.data) ||
        authorized.data.ok !== true
      ) throw new ServiceError("tenant_policy_or_resource_scope_denied", 403);
      executed = true;
      deps.resetProviderHttpMetadata?.();
      if (op.kind === "sql") {
        const reply = await deps.rpc("sandy_supabase_service_execute", {
          p_actor: context.actor_id,
          p_admission: admission,
          p_canonical: argsCanonical,
        });
        if (
          reply.error || !object(reply.data) || reply.data.ok !== true ||
          !object(reply.data.result)
        ) {
          throw new ServiceError(
            "scoped_database_execution_failed",
            502,
            op.is_mutation,
          );
        }
        result = reply.data.result;
      } else {result = await sdkExecute(
          deps,
          op,
          args,
          authorized.data,
          context,
          admission,
        );}
      if (!validators.get(op.operation)!.result(result)) {
        throw new ServiceError(
          "provider_projection_invalid",
          502,
          op.is_mutation,
        );
      }
    } catch (e) {
      const failure = e instanceof ServiceError ? e : new ServiceError(
        "provider_execution_outcome_unknown",
        502,
        executed && op.is_mutation,
      );
      const unknown = failure.uncertain || (executed && op.is_mutation);
      const recorded = await finish(unknown ? "unknown" : "failed", {
        error: failure.code,
      });
      return response(recorded ? failure.status : 503, {
        ok: false,
        error: recorded ? failure.code : "execution_receipt_state_unknown",
        executed,
        operation: op.operation,
        admission_id: admission,
        request_state: unknown ? "unknown" : "failed",
        reconciliation_required: unknown || !recorded,
      });
    }
    const recorded = await finish(
      op.is_mutation ? "accepted" : "succeeded",
      result,
    );
    if (!recorded) {
      return response(503, {
        ok: false,
        error: "execution_receipt_state_unknown",
        executed: true,
        operation: op.operation,
        admission_id: admission,
        reconciliation_required: true,
      });
    }
    return response(200, {
      ok: true,
      operation: op.operation,
      contract_version: "1.0.0",
      executed: true,
      request_state: op.is_mutation ? "accepted" : "observed",
      admission_id: admission,
      result,
    });
  };
}
export function runtimeHandler(req: Request) {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!service || projectUrl !== "https://" + serviceProject + ".supabase.co") {
    return Promise.resolve(
      refusal(503, "fixed_project_configuration_mismatch"),
    );
  }
  let metadata: {
    status: number | null;
    request_id: string | null;
    mutation_status?: number | null;
    mutation_request_id?: string | null;
  } = {
    status: null,
    request_id: null,
  };
  const client = createClient(projectUrl, service, {
    global: {
      fetch: async (input, init) => {
        const upstream = await fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(12000),
        });
        const method = String(
          init?.method ?? (input instanceof Request ? input.method : "GET"),
        ).toUpperCase();
        const mutation = !["GET", "HEAD", "OPTIONS"].includes(method) &&
          upstream.ok && metadata.mutation_status === undefined;
        metadata = {
          ...metadata,
          ...(mutation
            ? {
              mutation_status: upstream.status,
              mutation_request_id: upstream.headers.get("x-request-id") ??
                upstream.headers.get("sb-request-id"),
            }
            : {}),
          status: upstream.status,
          request_id: upstream.headers.get("x-request-id") ??
            upstream.headers.get("sb-request-id"),
        };
        return upstream;
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = async (name: string, args: JsonObject) => {
    const { data, error } = await client.rpc(name, args);
    return { data, error };
  };
  return createServiceHandler({
    service,
    projectUrl,
    client,
    rpc,
    providerHttpMetadata: () => metadata,
    resetProviderHttpMetadata: () => {
      metadata = { status: null, request_id: null };
    },
    authorizeContext: async (context, op) => {
      const [owner, registry] = await Promise.all([
        client.from("sandy_controller_admins").select("auth_user_id").eq(
          "auth_user_id",
          context.actor_id,
        ).eq("role", "owner").eq("enabled", true).maybeSingle(),
        client.from("sandy_operation_registry").select(
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
      return owner.data && approvedOwnerContract(row, {
          handler: serviceHandler,
          is_mutation: op.is_mutation,
          contract_sha256: op.contract_sha256,
        })
        ? { allowed: true }
        : {
          allowed: false,
          error: "verified_execution_contract_required",
          http_status: 424,
        };
    },
    consumeGrant: async (r) => {
      const { data, error } = await rpc("sandy_api_consume_execution_grant", {
        p_grant_id: r.grant_id,
        p_actor_id: r.actor_id,
        p_tenant_id: r.tenant_id,
        p_operation: r.operation,
        p_input_sha256: r.input_sha256,
        p_request_id: r.request_id,
        p_contract_sha256: r.contract_sha256,
        p_scope_sha256: r.scope_sha256,
      });
      return error
        ? {
          allowed: false,
          error: "execution_policy_unavailable",
          http_status: 503,
        }
        : data as Policy;
    },
    finishExecution: async (r) => {
      const { data, error } = await rpc("sandy_api_finish_execution", {
        p_admission_id: r.admission_id,
        p_outcome: r.outcome,
        p_provider_http_status: r.provider_http_status,
        p_provider_request_id: r.provider_request_id,
        p_result_sha256: r.result_sha256,
      });
      return {
        allowed: !error && object(data) && data.ok === true &&
          data.admission_id === r.admission_id && data.state === r.outcome &&
          typeof data.reused === "boolean",
      };
    },
  })(req);
}
if (import.meta.main) Deno.serve(runtimeHandler);
