import { type Contract, type Obj } from "./contracts.ts";
import { boundExecutionScope } from "./scope.ts";
import { BoundCalls } from "./transport.ts";
import {
  requireBinding,
  substituteBinding,
  type VerifiedProviderBindings,
} from "../sandy-provider-operation-api/configured_scopes.ts";
import {
  argumentDigest,
  bytesDigest,
  type Context,
  decode64,
  type Dependencies,
  encode64,
  fail,
  json,
  object,
  type OpaqueBinding,
  Refusal,
  type Reply,
  validate,
} from "../sandy-provider-supplement-api/runtime.ts";
const PROJECT = "elaborate-haven-511518-a5",
  NUMBER = "1030223524306",
  REGION = "europe-west1",
  SB = "zmqlyygzqoidkcwdysok";
type Proof = { kind: string; resource: string; response_sha256: string };
const obj = (v: unknown): Obj =>
  object(v) ? v : fail("provider_response_schema_mismatch", 502);
const safe = (v: unknown): string =>
  typeof v === "string" && v.length > 0 && v.length <= 1500 &&
    !/[\x00-\x1f?#%\\]/.test(v) && !v.split("/").some((s) =>
      s === ".." || s === "."
    )
    ? v
    : fail("invalid_provider_resource_path", 400);
const parent = (bindings?: VerifiedProviderBindings) =>
  requireBinding(bindings?.folder ? "folder" : "organization", bindings);
const allowedParents = (bindings?: VerifiedProviderBindings) =>
  ["organization", "folder", "destination_folder"].flatMap((kind) => {
    try {
      return [requireBinding(kind as "organization", bindings)];
    } catch {
      return [];
    }
  });
const opStorageReference = (value: string, project: string) =>
  project === "_" && /^projects\/_\/buckets\/[a-z0-9._-]+(?:\/|$)/.test(value);
function references(v: unknown, depth = 0): void {
  if (depth > 35) fail("provider_argument_depth_limit", 400);
  if (Array.isArray(v)) {
    for (const x of v) references(x, depth + 1);
    return;
  }
  if (object(v)) {
    for (const [key, child] of Object.entries(v)) {
      if (
        ["project", "project_id", "projectId", "projectNumber", "userProject"]
          .includes(key) &&
        typeof child === "string" &&
        ![PROJECT, NUMBER, `projects/${PROJECT}`].includes(child)
      ) fail("provider_project_scope_mismatch", 403);
      if (
        ["location", "region", "streamLocation", "destinationLocation"]
          .includes(key) &&
        typeof child === "string" && !child.includes("/") &&
        ![REGION, "global"].includes(child)
      ) fail("provider_region_scope_mismatch", 403);
      if (
        ["locations", "dataLocations"].includes(key) && Array.isArray(child) &&
        child.some((value) =>
          typeof value !== "string" ||
          ![REGION, "global"].includes(value.toLowerCase())
        )
      ) fail("provider_region_scope_mismatch", 403);
      references(child, depth + 1);
    }
    return;
  }
  if (typeof v === "string") {
    for (const match of v.matchAll(/(?:^|[/:])projects\/([^/\s]+)/g)) {
      if (
        ![PROJECT, NUMBER].includes(match[1]) &&
        !(opStorageReference(v, match[1]))
      ) fail("provider_project_scope_mismatch", 403);
    }
    if (
      /^https?:\/\//.test(v) &&
      !/^https:\/\/(?:www\.googleapis\.com|[a-z0-9-]+\.googleapis\.com)\//.test(
        v,
      )
    ) fail("provider_external_reference_refused", 403);
  }
}
function providerUrl(op: Contract, args: Obj, deps: Dependencies): URL {
  const pathArgs = object(args.path) ? args.path : {};
  const host = op.provider === "supabase"
    ? "https://api.supabase.com"
    : op.service_host!;
  const path = op.path.replace(/\{(\+?)([^}]+)\}/g, (_, reserved, name) => {
    const fixed = op.fixed_bindings[name];
    const raw = typeof fixed === "string"
      ? substituteBinding(fixed, deps.bindings)
      : fixed ?? pathArgs[name];
    const value = safe(typeof raw === "number" ? String(raw) : raw);
    return reserved
      ? value.split("/").map(encodeURIComponent).join("/")
      : encodeURIComponent(value);
  });
  if (/[{}]/.test(path)) fail("provider_resource_binding_required", 403);
  const url = new URL(host + path);
  const query = {
    ...(object(args.query) ? args.query : {}),
    ...op.fixed_query,
  };
  delete query.cursor_id;
  if (op.opaque_pagination) {
    const properties = object(op.input_schema.properties)
      ? op.input_schema.properties
      : {};
    const publicQuery = object(properties.query) ? properties.query : {};
    const fields = object(publicQuery.properties) ? publicQuery.properties : {};
    if (Object.hasOwn(fields, "maxResults") && query.maxResults === undefined) {
      query.maxResults = 100;
    }
    if (Object.hasOwn(fields, "pageSize") && query.pageSize === undefined) {
      query.pageSize = 100;
    }
  }
  if (op.service === "compute") {
    if (["insert", "list", "move"].includes(op.method_name)) {
      query.parentId = op.method_name === "move"
        ? requireBinding("destination_folder", deps.bindings)
        : parent(deps.bindings);
    }
    if (op.method_name === "listAssociations") {
      query.targetResource = parent(deps.bindings);
      query.includeInheritedPolicies = false;
    }
  }
  for (
    const [key, value] of Object.entries(query).sort(([a], [b]) =>
      a < b ? -1 : 1
    )
  ) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const x of value) url.searchParams.append(key, String(x));
    } else url.searchParams.set(key, String(value));
  }
  if (new TextEncoder().encode(url.toString()).length > 3000) {
    fail("provider_request_url_size_limit", 400);
  }
  return url;
}
async function proveBucket(
  bucket: string,
  calls: BoundCalls,
  proofs: Proof[],
  generation?: unknown,
): Promise<void> {
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket)) {
    fail("invalid_bucket_scope", 400);
  }
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}`,
  );
  url.searchParams.set("fields", "name,projectNumber,generation");
  url.searchParams.set("userProject", PROJECT);
  if (generation !== undefined) {
    if (typeof generation !== "string" || !/^\d{1,20}$/.test(generation)) {
      fail("invalid_soft_deleted_generation", 400);
    }
    url.searchParams.set("generation", generation);
    url.searchParams.set("softDeleted", "true");
  }
  const reply = await calls.request(url), data = json(reply);
  if (
    data.name !== bucket || String(data.projectNumber) !== NUMBER ||
    generation !== undefined && data.generation !== generation
  ) fail("bucket_project_relationship_required", 403);
  proofs.push({
    kind: "bucket_project",
    resource: bucket,
    response_sha256: reply.sha256,
  });
}
function policyId(value: unknown): string {
  if (typeof value !== "string") {
    return fail("invalid_firewall_policy_identity", 400);
  }
  const normalized = value.replace(
    /^https:\/\/www\.googleapis\.com\/compute\/v1\//,
    "",
  ).replace(/^(?:locations\/global\/)?firewallPolicies\//, "");
  return /^[1-9][0-9]{0,19}$/.test(normalized)
    ? normalized
    : fail("invalid_firewall_policy_identity", 400);
}
async function provePolicy(
  id: string,
  calls: BoundCalls,
  deps: Dependencies,
  proofs: Proof[],
): Promise<Obj> {
  const reply = await calls.request(
      new URL(
        `https://compute.googleapis.com/compute/v1/locations/global/firewallPolicies/${id}`,
      ),
    ),
    data = json(reply);
  if (
    String(data.id) !== id || typeof data.parent !== "string" ||
    !allowedParents(deps.bindings).includes(data.parent)
  ) fail("verified_firewall_parent_relationship_required", 403);
  proofs.push({
    kind: "firewall_parent",
    resource: `firewallPolicies/${id}`,
    response_sha256: reply.sha256,
  });
  return data;
}
async function guard(
  op: Contract,
  args: Obj,
  calls: BoundCalls,
  deps: Dependencies,
  proofs: Proof[],
): Promise<Obj | undefined> {
  const path = object(args.path) ? args.path : {},
    query = object(args.query) ? args.query : {},
    body = object(args.body) ? args.body : {};
  if (op.provider === "supabase") {
    const reply = await calls.request(
        new URL(`https://api.supabase.com/v1/projects/${SB}/branches`),
      ),
      bytes = reply.bytes;
    let list: unknown;
    try {
      list = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      return fail("provider_response_schema_mismatch", 502);
    }
    if (!Array.isArray(list) || list.length > 1000) {
      fail("provider_branch_membership_response_invalid", 502);
    }
    const matches = list.filter((item) =>
      object(item) &&
      (item.id === path.branch_id_or_ref ||
        item.project_ref === path.branch_id_or_ref) &&
      item.parent_project_ref === SB
    );
    if (matches.length !== 1) {
      fail("branch_fixed_project_relationship_required", 403);
    }
    const branch = obj(matches[0]);
    if (branch.project_ref === SB) fail("primary_project_is_not_a_branch", 403);
    if (body.notify_url !== undefined) {
      fail("verified_branch_notification_target_required", 424);
    }
    proofs.push({
      kind: "branch_parent",
      resource: String(branch.id),
      response_sha256: reply.sha256,
    });
    return branch;
  }
  references(args);
  if (op.service === "storage") {
    const buckets = new Set<string>();
    for (const [key, value] of Object.entries(path)) {
      if (/bucket/i.test(key)) buckets.add(String(value));
    }
    const scan = (value: unknown, depth = 0): void => {
      if (depth > 30) fail("provider_argument_depth_limit", 400);
      if (Array.isArray(value)) {
        for (const item of value) scan(item, depth + 1);
        return;
      }
      if (object(value)) {
        for (const [key, child] of Object.entries(value)) {
          if (/bucket$/i.test(key) && typeof child === "string") {
            buckets.add(child);
          }
          scan(child, depth + 1);
        }
        return;
      }
      if (typeof value === "string") {
        const match = value.match(
          /^(?:gs:\/\/|projects\/_\/buckets\/|https:\/\/storage\.googleapis\.com\/)([a-z0-9._-]+)(?:\/|$)/,
        );
        if (match) buckets.add(match[1]);
      }
    };
    scan(body);
    if (buckets.size > 8) fail("too_many_distinct_bucket_relationships", 400);
    if (!buckets.size) fail("bucket_scope_binding_required", 424);
    for (const bucket of buckets) {
      await proveBucket(
        bucket,
        calls,
        proofs,
        op.method_name === "restore" && op.resource_chain === "buckets"
          ? query.generation
          : undefined,
      );
    }
    if (op.method_name === "compose") {
      if (
        !Array.isArray(body.sourceObjects) || body.sourceObjects.length < 1 ||
        body.sourceObjects.length > 32
      ) fail("compose_source_objects_required", 400);
      for (const item of body.sourceObjects) {
        const value = obj(item);
        safe(value.name);
        if (
          value.generation !== undefined &&
          !/^\d{1,20}$/.test(String(value.generation))
        ) fail("invalid_source_generation", 400);
      }
    }
    if (
      op.method_name === "copy" || op.method_name === "rewrite" ||
      op.method_name === "move"
    ) {
      if (
        query.ifGenerationMatch === undefined ||
        query.ifSourceGenerationMatch === undefined
      ) fail("source_and_destination_generation_preconditions_required", 400);
    }
    if (op.method_name === "compose" && query.ifGenerationMatch === undefined) {
      fail("destination_generation_precondition_required", 400);
    }
    if (
      op.resource_chain === "buckets" && op.method_name === "update" &&
      query.ifMetagenerationMatch === undefined
    ) fail("bucket_metageneration_precondition_required", 400);
    if (
      op.resource_chain === "objects" && op.method_name === "update" &&
      query.ifGenerationMatch === undefined
    ) fail("object_generation_precondition_required", 400);
  }
  if (op.service === "compute") {
    if (path.firewallPolicy !== undefined) {
      await provePolicy(policyId(path.firewallPolicy), calls, deps, proofs);
    }
    if (op.method_name === "cloneRules") {
      await provePolicy(
        policyId(query.sourceFirewallPolicy),
        calls,
        deps,
        proofs,
      );
    }
    if (
      body.attachmentTarget !== undefined &&
      !allowedParents(deps.bindings).includes(String(body.attachmentTarget))
    ) fail("verified_firewall_attachment_target_required", 403);
    if (
      body.parent !== undefined &&
      !allowedParents(deps.bindings).includes(String(body.parent))
    ) fail("verified_firewall_parent_required", 403);
    if (
      body.firewallPolicyId !== undefined &&
      policyId(body.firewallPolicyId) !== String(path.firewallPolicy)
    ) fail("firewall_policy_identity_mismatch", 403);
  }
  if (op.service === "artifactregistry") {
    const repository = String(path.repository),
      prefix = repository + "/packages/";
    if ((body.tag === undefined) === (body.version === undefined)) {
      fail("exactly_one_artifact_tag_or_version_required", 400);
    }
    const value = String(body.tag ?? body.version);
    if (
      !value.startsWith(prefix) ||
      !value.includes(body.tag !== undefined ? "/tags/" : "/versions/")
    ) fail("artifact_repository_relationship_required", 403);
    const reply = await calls.request(
        new URL(
          `https://artifactregistry.googleapis.com/v1/${safe(repository)}`,
        ),
      ),
      data = json(reply);
    if (data.name !== repository) {
      fail("artifact_repository_relationship_required", 403);
    }
    proofs.push({
      kind: "repository_project",
      resource: repository,
      response_sha256: reply.sha256,
    });
  }
  if (op.service === "backupdr") {
    const dataSource = String(path.dataSource);
    const reply = await calls.request(
        new URL(`https://backupdr.googleapis.com/v1/${safe(dataSource)}`),
      ),
      data = json(reply);
    if (data.name !== dataSource) {
      fail("backup_data_source_relationship_required", 403);
    }
    for (const [key, value] of Object.entries(body)) {
      if (
        /backup$/i.test(key) && typeof value === "string" &&
        !value.startsWith(dataSource + "/backups/")
      ) fail("backup_target_relationship_required", 403);
    }
    proofs.push({
      kind: "backup_data_source",
      resource: dataSource,
      response_sha256: reply.sha256,
    });
  }
  if (op.service === "logging") {
    const sink = String(path.sinkName),
      current = await calls.request(
        new URL(`https://logging.googleapis.com/v2/${safe(sink)}`),
      ),
      metadata = json(current);
    if (metadata.name !== sink && metadata.name !== sink.split("/").pop()) {
      fail("log_sink_project_relationship_required", 403);
    }
    proofs.push({
      kind: "log_sink_project",
      resource: sink,
      response_sha256: current.sha256,
    });
    if (query.customWriterIdentity !== undefined) {
      fail("cross_project_log_writer_refused", 403);
    }
    if (typeof query.updateMask !== "string" || !query.updateMask.length) {
      fail("explicit_log_sink_update_mask_required", 400);
    }
    if (body.destination !== undefined) {
      const destination = String(body.destination),
        bucket = destination.match(
          /^storage\.googleapis\.com\/([a-z0-9._-]+)$/,
        );
      if (bucket) await proveBucket(bucket[1], calls, proofs);
      else {
        let url: URL, resource: string, kind: string;
        const topic = destination.match(
          new RegExp(
            `^pubsub\\.googleapis\\.com/(projects/${PROJECT}/topics/[A-Za-z0-9_.~+-]{3,255})$`,
          ),
        );
        const dataset = destination.match(
          new RegExp(
            `^bigquery\\.googleapis\\.com/projects/${PROJECT}/datasets/([A-Za-z0-9_]{1,1000})$`,
          ),
        );
        const log = destination.match(
          new RegExp(
            `^logging\\.googleapis\\.com/(projects/${PROJECT}/locations/(?:${REGION}|global)/buckets/[A-Za-z0-9_-]{1,100})$`,
          ),
        );
        if (topic) {
          resource = topic[1];
          kind = "log_pubsub_destination";
          url = new URL(`https://pubsub.googleapis.com/v1/${resource}`);
        } else if (dataset) {
          resource = `projects/${PROJECT}/datasets/${dataset[1]}`;
          kind = "log_bigquery_destination";
          url = new URL(
            `https://bigquery.googleapis.com/bigquery/v2/${resource}`,
          );
        } else if (log) {
          resource = log[1];
          kind = "log_bucket_destination";
          url = new URL(`https://logging.googleapis.com/v2/${resource}`);
        } else {return fail(
            "log_destination_fixed_project_binding_required",
            403,
          );}
        const reply = await calls.request(url), data = json(reply);
        if (dataset) {
          const reference = obj(data.datasetReference);
          if (
            reference.projectId !== PROJECT ||
            reference.datasetId !== dataset[1]
          ) fail("log_destination_relationship_required", 403);
        } else if (data.name !== resource) {
          fail("log_destination_relationship_required", 403);
        }
        proofs.push({ kind, resource, response_sha256: reply.sha256 });
      }
    }
  }
  return undefined;
}
const sensitive =
  /(?:password|passwd|db_pass|secret|credential|private.?key|access.?token|refresh.?token|authorization|signed.?url|^db_user$|^notify_url$)/i;
const wrappers = new WeakMap<Obj, WeakMap<Obj, Obj>>();
function withDefinitions(schema: Obj, defs: Obj): Obj {
  let entries = wrappers.get(schema);
  if (!entries) {
    entries = new WeakMap();
    wrappers.set(schema, entries);
  }
  let value = entries.get(defs);
  if (!value) {
    value = { ...schema, $defs: defs };
    entries.set(defs, value);
  }
  return value;
}
function projection(
  value: unknown,
  schema: Obj,
  defs: Obj,
  depth = 0,
): unknown {
  if (depth > 35) fail("provider_projection_depth_limit", 502);
  if (typeof schema.$ref === "string") {
    return projection(
      value,
      obj(defs[schema.$ref.split("/").pop()!]),
      defs,
      depth + 1,
    );
  }
  const choices = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(choices)) {
    for (const branch of choices) {
      try {
        const result = projection(value, obj(branch), defs, depth + 1);
        if (validate(withDefinitions(obj(branch), defs), result)) return result;
      } catch { /* next exact alternative */ }
    }
  }
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (!object(schema.items)) fail("provider_projection_mismatch", 502);
    return value.slice(0, 100).map((item) =>
      projection(item, schema.items as Obj, defs, depth + 1)
    );
  }
  if (object(value)) {
    const output: Obj = {};
    for (
      const [key, child] of Object.entries(
        object(schema.properties) ? schema.properties : {},
      )
    ) {
      if (
        Object.hasOwn(value, key) && !sensitive.test(key) &&
        !["description", "filter", "nextPageToken", "url", "uri"].includes(key)
      ) output[key] = projection(value[key], obj(child), defs, depth + 1);
    }
    return output;
  }
  if (
    typeof value === "string" &&
    /(?:\bBearer\s+\S+|\b(?:gh[pousr]_|github_pat_|sbp_|sb_secret_)[A-Za-z0-9_-]{20,}|-----BEGIN .*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/
      .test(value)
  ) return "[REDACTED]";
  return value;
}
function truncated(value: unknown, depth = 0): boolean {
  if (depth > 35) return true;
  if (Array.isArray(value)) {
    return value.length > 100 || value.some((v) => truncated(v, depth + 1));
  }
  return object(value) &&
    Object.values(value).some((v) => truncated(v, depth + 1));
}
export async function execute(
  op: Contract,
  args: Obj,
  calls: BoundCalls,
  deps: Dependencies,
  context: Context,
  admission: string,
): Promise<
  {
    result: unknown;
    scope_proofs: Proof[];
    next_cursor_id: string | null;
    possibly_truncated: boolean;
  }
> {
  const proofs: Proof[] = [],
    branch = await guard(op, args, calls, deps, proofs),
    url = providerUrl(op, args, deps);
  const stable = {
    path: object(args.path) ? args.path : {},
    body: args.body ?? null,
    query: Array.from(url.searchParams.entries()),
  };
  const binding: OpaqueBinding = {
    actor: context.actor_id,
    admission,
    operation: op.operation,
    kind: "cursor",
    scope_sha256: await argumentDigest(
      boundExecutionScope(op.operation, deps.bindings),
    ),
    input_sha256: await argumentDigest(args),
    binding_sha256: await argumentDigest(stable),
    target: url.toString(),
  };
  if (
    op.opaque_pagination && object(args.query) &&
    typeof args.query.cursor_id === "string"
  ) {
    let bytes: Uint8Array;
    try {
      bytes = await deps.takeOpaque(binding, args.query.cursor_id);
    } catch {
      return fail("provider_cursor_invalid_expired_or_used", 409);
    }
    let token: string;
    try {
      token = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return fail("provider_cursor_integrity_failed", 503);
    }
    if (!token || token.length > 8192 || /[\r\n]/.test(token)) {
      fail("provider_cursor_integrity_failed", 503);
    }
    url.searchParams.set("pageToken", token);
  }
  const reply = await calls.request(
    url,
    op.method,
    args.body === undefined ? undefined : JSON.stringify(args.body),
    args.body === undefined ? undefined : "application/json",
    [200, 201, 202, 204],
  );
  const data = op.private_diff_capture
      ? {}
      : reply.bytes.length
      ? json(reply)
      : {},
    schema = op.response_schemas[String(reply.status)];
  if (schema && !validate(withDefinitions(schema, op.$defs), data)) {
    throw new Refusal(
      "provider_response_contract_mismatch",
      502,
      reply.status,
      reply.id,
      calls.mutationDispatched,
    );
  }
  if (branch && data.ref !== undefined && data.ref !== branch.project_ref) {
    throw new Refusal(
      "provider_branch_identity_mismatch",
      502,
      reply.status,
      reply.id,
      calls.mutationDispatched,
    );
  }
  if (
    branch && data.project_ref !== undefined &&
    data.project_ref !== branch.project_ref
  ) {
    throw new Refusal(
      "provider_branch_identity_mismatch",
      502,
      reply.status,
      reply.id,
      calls.mutationDispatched,
    );
  }
  if (
    branch && data.parent_project_ref !== undefined &&
    data.parent_project_ref !== SB
  ) {
    throw new Refusal(
      "provider_branch_identity_mismatch",
      502,
      reply.status,
      reply.id,
      calls.mutationDispatched,
    );
  }
  if (
    op.service === "compute" && typeof data.parent === "string" &&
    !allowedParents(deps.bindings).includes(data.parent)
  ) fail("firewall_response_parent_scope_mismatch", 502);
  if (op.service === "storage" && typeof data.bucket === "string") {
    const path = object(args.path) ? args.path : {};
    const expected = path.destinationBucket ?? path.bucket;
    if (data.bucket !== expected) {
      fail("storage_response_bucket_scope_mismatch", 502);
    }
  }
  if (
    op.service === "compute" && op.method_name === "list" &&
    Array.isArray(data.items) &&
    data.items.some((item) =>
      !object(item) || item.parent !== parent(deps.bindings)
    )
  ) fail("firewall_list_parent_scope_mismatch", 502);
  if (
    op.service === "pubsub" && Array.isArray(data.snapshots) &&
    data.snapshots.some((item) =>
      !object(item) || typeof item.name !== "string" ||
      !item.name.startsWith(`projects/${PROJECT}/snapshots/`)
    )
  ) fail("snapshot_list_project_scope_mismatch", 502);
  let result: unknown, next: string | null = null;
  if (op.private_diff_capture) {
    if (
      (reply.headers.get("content-type") ?? "").split(";")[0].trim()
        .toLowerCase() !== "text/plain"
    ) fail("provider_branch_diff_media_type_mismatch", 502);
    const stored = await deps.saveOpaque({
      ...binding,
      kind: "artifact",
      target: url.toString(),
      payload_base64: encode64(reply.bytes),
      payload_sha256: reply.sha256,
      byte_length: reply.bytes.length,
      media_type: "text/plain",
    });
    result = {
      ...stored,
      content_returned: false,
      transfer_state: "captured_private",
    };
  } else if (op.is_mutation) {
    const metadata: Obj = { accepted: true, effect_confirmed: false };
    for (
      const key of [
        "id",
        "name",
        "ref",
        "sha",
        "state",
        "status",
        "number",
        "version",
        "generation",
      ]
    ) {
      if (
        ["string", "number", "boolean"].includes(typeof data[key]) &&
        !sensitive.test(key)
      ) metadata[key] = data[key];
    }
    result = projection(metadata, op.result_schema, op.public_defs);
  } else result = projection(data, op.result_schema, op.public_defs);
  if (
    op.opaque_pagination && typeof data.nextPageToken === "string" &&
    data.nextPageToken
  ) {
    const bytes = new TextEncoder().encode(data.nextPageToken);
    if (bytes.length > 8192) fail("provider_cursor_size_limit", 502);
    const stored = await deps.saveOpaque({
      ...binding,
      payload_base64: encode64(bytes),
      payload_sha256: await bytesDigest(bytes),
      byte_length: bytes.length,
      media_type: "application/x-sandy-provider-cursor",
    });
    next = stored.custody_id;
  }
  return {
    result,
    scope_proofs: proofs,
    next_cursor_id: next,
    possibly_truncated: truncated(data),
  };
}
