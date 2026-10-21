import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import { requireBinding } from "../sandy-provider-operation-api/configured_scopes.ts";
import {
  type Contract,
  GCP_NUMBER,
  GCP_PROJECT,
  type Obj,
  PROJECT,
  REPOSITORY,
} from "./contracts.ts";
import {
  argumentDigest,
  bytesDigest,
  Calls,
  type Context,
  decode64,
  type Dependencies,
  encode64,
  fail,
  integer,
  json,
  object,
  type OpaqueBinding,
  optionalText,
  record,
  Refusal,
  type Reply,
  text,
} from "./runtime.ts";
import { supplementExecutionScope } from "./scope.ts";
import { executeMedia } from "./media.ts";
export async function bindingFor(
  op: Contract,
  args: Obj,
  deps: Dependencies,
  context: Context,
  admission: string,
  target: string,
  kind: OpaqueBinding["kind"],
  stableArgs: Obj = args,
): Promise<OpaqueBinding> {
  return {
    actor: context.actor_id,
    admission,
    operation: op.operation,
    target,
    kind,
    input_sha256: await argumentDigest(args),
    binding_sha256: await argumentDigest(stableArgs),
    scope_sha256: await argumentDigest(
      supplementExecutionScope(op.operation, deps.bindings),
    ),
  };
}
export async function capture(
  reply: Reply,
  binding: OpaqueBinding,
  deps: Dependencies,
): Promise<Obj> {
  const rawType =
    (reply.headers.get("content-type") ?? "application/octet-stream").split(
      ";",
    )[0].trim();
  const mediaType =
    /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(rawType)
      ? rawType
      : "application/octet-stream";
  const value = await deps.saveOpaque({
    ...binding,
    payload_base64: encode64(reply.bytes),
    payload_sha256: reply.sha256,
    byte_length: reply.bytes.length,
    media_type: mediaType,
  });
  if (
    !object(value) || !/^[a-f0-9-]{36}$/i.test(value.custody_id) ||
    value.sha256 !== reply.sha256 || value.byte_length !== reply.bytes.length ||
    value.media_type !== mediaType ||
    !Number.isFinite(Date.parse(value.expires_at)) ||
    Date.parse(value.expires_at) <= (deps.now ?? Date.now)() ||
    Date.parse(value.expires_at) > (deps.now ?? Date.now)() + 11 * 60 * 1000
  ) fail("media_custody_receipt_invalid", 503);
  return {
    ...value,
    content_returned: false,
    transfer_state: "captured_private",
  };
}
async function filtered(
  op: Contract,
  args: Obj,
  calls: Calls,
  deps: Dependencies,
  context: Context,
  admission: string,
): Promise<Obj> {
  let url: URL, field: string, expected: string;
  if (op.kind === "billing_list") {
    url = new URL("https://cloudbilling.googleapis.com/v1/billingAccounts");
    field = "billingAccounts";
    expected = requireBinding("billing_account", deps.bindings);
  } else {
    const resource = op.kind === "organization_search"
      ? "organizations"
      : op.kind === "folder_search"
      ? "folders"
      : "projects";
    url = new URL(
      `https://cloudresourcemanager.googleapis.com/v3/${resource}${
        op.kind.endsWith("search") ? ":search" : ""
      }`,
    );
    field = resource;
    expected = resource === "organizations"
      ? requireBinding("organization", deps.bindings)
      : resource === "folders"
      ? requireBinding("folder", deps.bindings)
      : `projects/${GCP_NUMBER}`;
    if (op.kind === "project_list") {
      const parent = requireBinding(
        deps.bindings?.folder ? "folder" : "organization",
        deps.bindings,
      );
      // Fresh relationship proof before a parent-wide request; never reveal siblings.
      const project = json(
        await calls.request(
          new URL(
            `https://cloudresourcemanager.googleapis.com/v3/projects/${GCP_PROJECT}`,
          ),
        ),
      );
      if (
        project.name !== `projects/${GCP_NUMBER}` ||
        project.projectId !== GCP_PROJECT || project.parent !== parent
      ) fail("verified_project_parent_relationship_required", 424);
      url.searchParams.set("parent", parent);
    } else if (op.kind === "project_search") {
      url.searchParams.set("query", `projectId:${GCP_PROJECT}`);
    } else if (op.kind === "folder_search") {
      // No caller filter or OR term; exact verified folder filtering occurs below.
      url.searchParams.set("query", "state=ACTIVE");
    }
  }
  const pageSize = typeof args.page_size === "number" ? args.page_size : 100;
  url.searchParams.set("pageSize", String(pageSize));
  const binding = await bindingFor(
    op,
    args,
    deps,
    context,
    admission,
    url.toString(),
    "cursor",
    { page_size: pageSize },
  );
  if (typeof args.cursor_id === "string") {
    let raw: Uint8Array;
    try {
      raw = await deps.takeOpaque(binding, args.cursor_id);
    } catch {
      return fail("provider_cursor_invalid_expired_or_used", 409);
    }
    let token: string;
    try {
      token = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      return fail("provider_cursor_integrity_failed", 503);
    }
    if (!token || token.length > 8192 || /[\r\n]/.test(token)) {
      fail("provider_cursor_integrity_failed", 503);
    }
    url.searchParams.set("pageToken", token);
  }
  const data = json(await calls.request(url));
  const items = data[field] ?? [];
  if (!Array.isArray(items) || items.length > 1000) {
    fail("provider_response_schema_mismatch", 502);
  }
  const resources: Obj[] = [];
  for (const value of items) {
    const item = record(value);
    // Foreign records are neither projected nor hashed into a public result.
    if (item.name !== expected) continue;
    if (field === "projects" && item.projectId !== GCP_PROJECT) {
      fail("provider_resource_identity_mismatch", 502);
    }
    resources.push({
      name: expected,
      display_name: optionalText(item.displayName),
      state: optionalText(item.state, 100),
    });
  }
  if (resources.length > 1) fail("provider_duplicate_resource_identity", 502);
  const token = data.nextPageToken;
  let next: string | null = null;
  if (token !== undefined && token !== "") {
    const bytes = new TextEncoder().encode(text(token, 8192));
    const receipt = await deps.saveOpaque({
      ...binding,
      payload_base64: encode64(bytes),
      payload_sha256: await bytesDigest(bytes),
      byte_length: bytes.length,
      media_type: "application/x-sandy-provider-cursor",
    });
    if (!/^[a-f0-9-]{36}$/i.test(receipt.custody_id)) {
      fail("provider_cursor_receipt_invalid", 503);
    }
    next = receipt.custody_id;
  }
  return {
    resources,
    next_cursor_id: next,
    scan_complete: next === null,
    scope_filter: "exact_verified_resource",
  };
}
function safeFilePath(value: unknown): string {
  const path = text(value, 240);
  if (
    !/^[A-Za-z0-9_][A-Za-z0-9_./@+ -]*$/.test(path) ||
    path.split("/").some((s) => !s || s === "." || s === "..") ||
    path.includes("\\")
  ) fail("invalid_source_file_path", 400);
  return path;
}
async function deploy(args: Obj, calls: Calls): Promise<Obj> {
  const files = args.files as Obj[];
  if (!Array.isArray(files) || files.length < 1 || files.length > 32) {
    fail("source_files_required", 400);
  }
  const prepared: { path: string; bytes: Uint8Array; sha256: string }[] = [],
    seen = new Set<string>();
  let total = 0;
  for (const item of files) {
    const path = safeFilePath(item.path),
      bytes = decode64(item.content_base64, 524288);
    if (seen.has(path)) fail("duplicate_source_file_path", 400);
    seen.add(path);
    total += bytes.length;
    if (total > 1048576) fail("source_size_limit", 413);
    const sha256 = await bytesDigest(bytes);
    if (sha256 !== item.sha256) fail("source_content_digest_mismatch", 400);
    prepared.push({ path, bytes, sha256 });
  }
  const entrypoint = safeFilePath(args.entrypoint_path),
    importMap = args.import_map_path === undefined
      ? undefined
      : safeFilePath(args.import_map_path);
  if (!seen.has(entrypoint) || importMap && !seen.has(importMap)) {
    fail("source_entrypoint_or_import_map_missing", 400);
  }
  // Transport cannot disable the project JWT verification boundary.
  if (args.verify_jwt !== true) fail("function_jwt_verification_required", 403);
  const metadata = {
    entrypoint_path: entrypoint,
    verify_jwt: true,
    ...(importMap ? { import_map_path: importMap } : {}),
    ...(args.name ? { name: args.name } : {}),
  };
  const body = new FormData();
  body.append("metadata", JSON.stringify(metadata));
  for (const file of prepared) {
    body.append("file", new Blob([new Uint8Array(file.bytes)]), file.path);
  }
  const url = new URL(
    `https://api.supabase.com/v1/projects/${PROJECT}/functions/deploy`,
  );
  url.searchParams.set("slug", text(args.slug, 63));
  const sourceSha = await argumentDigest(
    prepared.map((file) => ({ path: file.path, sha256: file.sha256 })).sort((
      a,
      b,
    ) => a.path.localeCompare(b.path)),
  );
  const reply = await calls.request(url, "POST", body, undefined, [200, 201]);
  const value = json(reply);
  if (
    value.slug !== args.slug ||
    value.verify_jwt !== undefined && value.verify_jwt !== true ||
    !["ACTIVE", "REMOVED", "THROTTLED"].includes(String(value.status))
  ) {
    throw new Refusal(
      "provider_deployment_readback_mismatch",
      503,
      reply.status,
      reply.id,
      true,
    );
  }
  const observed = json(
    await calls.request(
      new URL(
        `https://api.supabase.com/v1/projects/${PROJECT}/functions/${
          encodeURIComponent(String(args.slug))
        }`,
      ),
    ),
  );
  const matches = observed.id === value.id && observed.slug === args.slug &&
    observed.version === value.version && observed.verify_jwt === true;
  if (!matches) {
    throw new Refusal(
      "provider_deployment_readback_mismatch",
      503,
      calls.last?.status ?? null,
      calls.last?.id ?? null,
      true,
    );
  }
  return {
    id: text(value.id),
    slug: text(value.slug, 63),
    name: text(value.name, 100),
    status: value.status,
    version: integer(value.version, 2147483647),
    verify_jwt: true,
    source_sha256: sourceSha,
    readback_matched: true,
    transfer_state: "accepted",
  };
}
export async function execute(
  op: Contract,
  args: Obj,
  calls: Calls,
  deps: Dependencies,
  context: Context,
  admission: string,
): Promise<Obj> {
  if (
    [
      "organization_search",
      "folder_search",
      "project_list",
      "project_search",
      "billing_list",
    ].includes(op.kind)
  ) return await filtered(op, args, calls, deps, context, admission);
  if (op.kind === "function_deploy") return await deploy(args, calls);
  if (op.kind === "function_body" || op.kind === "effective_security") {
    const target = op.kind === "function_body"
      ? new URL(
        `https://api.supabase.com/v1/projects/${PROJECT}/functions/${
          encodeURIComponent(String(args.function_slug))
        }/body`,
      )
      : new URL(
        `https://compute.googleapis.com/compute/v1/projects/${GCP_PROJECT}/global/backendServices/${
          encodeURIComponent(String(args.backend_service))
        }/getEffectiveSecurityPolicies`,
      );
    const reply = await calls.request(target);
    const artifact = await capture(
      reply,
      await bindingFor(
        op,
        args,
        deps,
        context,
        admission,
        target.toString(),
        "artifact",
      ),
      deps,
    );
    return op.kind === "function_body" ? artifact : {
      artifact,
      provider_response_contract: "undocumented",
      effective_policy_semantics_verified: false,
    };
  }
  if (op.kind.startsWith("github_")) {
    let path: string;
    if (op.kind === "github_merged") path = `pulls/${args.pull_number}/merge`;
    else if (op.kind === "github_assignee") {
      path = `assignees/${encodeURIComponent(String(args.assignee))}`;
    } else if (op.kind === "github_issue_assignee") {
      path = `issues/${args.issue_number}/assignees/${
        encodeURIComponent(String(args.assignee))
      }`;
    } else if (op.kind === "github_collaborator") {
      path = `collaborators/${encodeURIComponent(String(args.username))}`;
    } else if (op.kind === "github_vulnerability") {
      path = "vulnerability-alerts";
    } else return fail("operation_not_implemented", 404);
    // 404 can also mean missing visibility. The contract reports that ambiguity.
    const reply = await calls.request(
      new URL(`https://api.github.com/repos/${REPOSITORY}/${path}`),
      "GET",
      undefined,
      undefined,
      [204, 404],
    );
    if (reply.status === 204 && reply.bytes.length) {
      fail("provider_response_schema_mismatch", 502);
    }
    return {
      condition: reply.status === 204,
      repository: REPOSITORY,
      not_found_semantics: "provider_condition_or_visibility",
    };
  }
  return await executeMedia(op, args, calls, deps, context, admission);
}
