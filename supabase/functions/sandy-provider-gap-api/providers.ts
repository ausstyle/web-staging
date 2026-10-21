import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  type GapContract,
  GCP_PROJECT,
  GCP_ZONE,
  type Obj,
  PROJECT,
  REPOSITORY,
} from "./contracts.ts";
import {
  bool,
  Calls,
  type Context,
  type Dependencies,
  fail,
  list,
  nextPage,
  nullableText,
  numeric,
  obj,
  type PackageProof,
  type ProviderReply,
  redact,
  Refusal,
  restoreBinding,
  text,
} from "./runtime.ts";
import { fixedGraphQLDocuments, graphMutationFields } from "./graphql.ts";
export type Result = { result: Obj; truncated: boolean };
const url = (host: string, path: string, query: Obj = {}) => {
  const u = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u;
};
const management = (path: string, q: Obj = {}) =>
  url("api.supabase.com", path, q);
const github = (path: string, q: Obj = {}) => url("api.github.com", path, q);
const safe = (v: unknown, max = 200) => redact(text(v, max), max);
const acceptance = (
  id: string | null = null,
  client: string | null = null,
  readback: boolean | null = null,
): Result => ({
  result: {
    accepted: true,
    effect_confirmed: false,
    resource_id: id,
    client_mutation_id: client,
    readback_matched: readback,
  },
  truncated: false,
});
async function projectOrganization(
  calls: Calls,
): Promise<{ id: string | null; slug: string | null }> {
  const p = obj(
    (await calls.request(management(`/v1/projects/${PROJECT}`))).body,
  );
  if (p.ref !== PROJECT && p.id !== PROJECT) {
    fail("provider_project_scope_mismatch", 502);
  }
  const id = nullableText(p.organization_id),
    slug = nullableText(p.organization_slug);
  if (!id && !slug) {
    fail("provider_project_organization_relationship_missing", 424);
  }
  if (slug && !/^[\w-]+$/.test(slug)) {
    fail("provider_response_schema_mismatch", 502);
  }
  return { id, slug };
}
function organization(
  v: unknown,
  relation: { id: string | null; slug: string | null },
): Obj | null {
  const x = obj(v);
  if (
    relation.id && x.id !== relation.id ||
    relation.slug && x.slug !== relation.slug
  ) return null;
  return { id: text(x.id), slug: text(x.slug), name: safe(x.name) };
}
export async function executeSupabase(
  op: GapContract,
  args: Obj,
  calls: Calls,
  now: number,
): Promise<Result> {
  if (op.kind === "logs") {
    const start = Date.parse(String(args.start)),
      end = Date.parse(String(args.end));
    if (
      !Number.isFinite(start) || !Number.isFinite(end) || start >= end ||
      end - start > 86400000 || end > now + 300000 ||
      !String(args.start).endsWith("Z") || !String(args.end).endsWith("Z")
    ) fail("invalid_log_time_window", 400);
    const limit = Number(args.limit ?? 25), source = String(args.source);
    const sql =
      `SELECT id, timestamp, source, event_message FROM logs WHERE source = '${source}' ORDER BY timestamp DESC LIMIT ${limit}`;
    const reply = await calls.request(
      management(`/v1/projects/${PROJECT}/analytics/endpoints/logs`, {
        sql,
        iso_timestamp_start: new Date(start).toISOString(),
        iso_timestamp_end: new Date(end).toISOString(),
      }),
    );
    const body = obj(reply.body);
    if (body.error) {
      throw new Refusal(
        "provider_log_query_failed",
        424,
        reply.status,
        reply.id,
      );
    }
    const entries = list(body.result, limit).map((value) => {
      const row = obj(value);
      if (row.source !== source) {
        fail("provider_log_source_scope_mismatch", 502);
      }
      const timestamp = typeof row.timestamp === "number"
        ? new Date(row.timestamp > 1e14 ? row.timestamp / 1000 : row.timestamp)
          .toISOString()
        : text(row.timestamp, 100);
      const t = Date.parse(timestamp);
      if (!Number.isFinite(t) || t < start - 60000 || t > end + 60000) {
        fail("provider_log_time_scope_mismatch", 502);
      }
      return {
        id: nullableText(row.id),
        timestamp,
        source,
        message: redact(text(row.event_message, 1048576), 2048),
      };
    });
    return {
      result: {
        entries,
        project_ref: PROJECT,
        next_query_before: entries.length === limit
          ? entries.at(-1)!.timestamp
          : null,
        redaction_policy: "known_patterns_v1",
        query_dialect: "clickhouse_sql",
      },
      truncated: entries.length === limit,
    };
  }
  const relation = await projectOrganization(calls);
  const organizations = list(
    (await calls.request(management("/v1/organizations"))).body,
    10000,
  ).map((v) => organization(v, relation)).filter((v): v is Obj => v !== null);
  if (organizations.length > 1) {
    fail("provider_organization_relationship_ambiguous", 502);
  }
  if (op.kind === "org_list") {
    return {
      result: {
        organizations,
        project_ref: PROJECT,
        complete_for_bound_project: true,
        other_memberships_disclosed: false,
      },
      truncated: false,
    };
  }
  if (!organizations.length) {
    fail("bound_project_organization_membership_not_visible", 424);
  }
  const selected = organizations[0], slug = text(selected.slug);
  const detailed = obj(
    (await calls.request(
      management(`/v1/organizations/${encodeURIComponent(slug)}`),
    )).body,
  );
  if (detailed.id !== selected.id) {
    fail("provider_organization_scope_mismatch", 502);
  }
  return {
    result: {
      organization: { id: text(detailed.id), slug, name: safe(detailed.name) },
      project_ref: PROJECT,
    },
    truncated: false,
  };
}
export async function executeSerial(args: Obj, calls: Calls): Promise<Result> {
  if (args.start !== undefined) {
    const n = BigInt(String(args.start));
    if (n < -(2n ** 63n) || n > 2n ** 63n - 1n) {
      fail("invalid_serial_offset", 400);
    }
  }
  const reply = await calls.request(
    url(
      "compute.googleapis.com",
      `/compute/v1/projects/${GCP_PROJECT}/zones/${GCP_ZONE}/instances/${
        encodeURIComponent(String(args.instance))
      }/serialPort`,
      { port: args.port ?? 1, start: args.start ?? "-8192" },
    ),
  );
  const b = obj(reply.body),
    contents = text(b.contents, 2097152),
    bytes = new TextEncoder().encode(contents);
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  const max = Number(args.max_chars ?? 2000), redacted = redact(contents, max);
  for (const key of ["start", "next"]) {
    if (typeof b[key] !== "string" || !/^\d{1,20}$/.test(b[key] as string)) {
      fail("provider_response_schema_mismatch", 502);
    }
  }
  return {
    result: {
      instance: args.instance,
      port: args.port ?? 1,
      start: b.start,
      next: b.next,
      content_sha256: digest,
      source_bytes: bytes.length,
      redacted_text: redacted,
      redaction_policy: "known_patterns_v1",
    },
    truncated: redacted.length === max || contents.length > max,
  };
}
type Repo = { id: number; ownerType: "Organization" | "User" };
async function repository(calls: Calls): Promise<Repo> {
  const repo = obj((await calls.request(github(`/repos/${REPOSITORY}`))).body),
    owner = obj(repo.owner);
  if (
    String(repo.full_name).toLowerCase() !== REPOSITORY ||
    String(owner.login).toLowerCase() !== "ausstyle" ||
    !["Organization", "User"].includes(String(owner.type))
  ) fail("provider_repository_scope_mismatch", 502);
  return { id: numeric(repo.id), ownerType: owner.type as Repo["ownerType"] };
}
const secretMeta = (value: unknown): Obj => {
  const x = obj(value);
  return {
    name: text(x.name, 100),
    created_at: text(x.created_at, 100),
    updated_at: text(x.updated_at, 100),
  };
};
async function environmentSecrets(
  op: GapContract,
  args: Obj,
  calls: Calls,
): Promise<Result> {
  const path = `/repos/${REPOSITORY}/environments/${
    encodeURIComponent(String(args.environment))
  }/secrets`;
  if (
    typeof args.secret_name === "string" && /^GITHUB_/i.test(args.secret_name)
  ) fail("reserved_environment_secret_name", 400);
  if (op.kind === "secret_key") {
    const key = obj((await calls.request(github(path + "/public-key"))).body);
    return {
      result: {
        key_id: text(key.key_id, 100),
        key: text(key.key, 200),
        key_material: "public_encryption_key",
      },
      truncated: false,
    };
  }
  if (op.kind === "secret_list") {
    const reply = await calls.request(
        github(path, { page: args.page ?? 1, per_page: args.per_page ?? 30 }),
      ),
      body = obj(reply.body);
    const secrets = list(body.secrets, 100).map(secretMeta),
      next = nextPage(reply, path);
    return {
      result: { secrets, next_page: next, values_disclosed: false },
      truncated: next !== null,
    };
  }
  const endpoint = github(
    path + "/" + encodeURIComponent(String(args.secret_name)),
  );
  if (op.kind === "secret_get") {
    return {
      result: {
        secret: secretMeta((await calls.request(endpoint)).body),
        values_disclosed: false,
      },
      truncated: false,
    };
  }
  if (op.kind === "secret_set") {
    const key = obj((await calls.request(github(path + "/public-key"))).body);
    if (key.key_id !== args.key_id) {
      fail("environment_encryption_key_changed", 409);
    }
    let cipher: string;
    try {
      cipher = atob(String(args.encrypted_value));
    } catch {
      fail("invalid_encrypted_secret", 400);
    }
    if (cipher!.length < 48 || btoa(cipher!) !== args.encrypted_value) {
      fail("invalid_encrypted_secret", 400);
    }
    await calls.request(endpoint, "PUT", {
      key_id: args.key_id,
      encrypted_value: args.encrypted_value,
    });
  } else await calls.request(endpoint, "DELETE");
  return acceptance(String(args.secret_name));
}
function packageItem(value: unknown, type: string): Obj | null {
  const p = obj(value), repo = p.repository;
  if (!repo || String(obj(repo).full_name).toLowerCase() !== REPOSITORY) {
    return null;
  }
  if (p.package_type !== type) fail("provider_package_type_mismatch", 502);
  if (p.owner && String(obj(p.owner).login).toLowerCase() !== "ausstyle") {
    fail("provider_package_owner_scope_mismatch", 502);
  }
  if (
    p.version_count !== undefined && p.version_count !== null &&
    (!Number.isSafeInteger(p.version_count) || Number(p.version_count) < 0)
  ) fail("provider_response_schema_mismatch", 502);
  return {
    id: numeric(p.id),
    name: text(p.name, 214),
    package_type: type,
    visibility: text(p.visibility, 50),
    repository: REPOSITORY,
    created_at: nullableText(p.created_at, 100),
    updated_at: nullableText(p.updated_at, 100),
    version_count: p.version_count ?? null,
  };
}
function versionItem(value: unknown, type: string, packageId: number): Obj {
  const v = obj(value),
    metadata = v.metadata ? obj(v.metadata) : {},
    container = metadata.container ? obj(metadata.container) : {};
  return {
    id: numeric(v.id),
    name: text(v.name, 1000),
    package_id: packageId,
    package_type: type,
    tags: container.tags
      ? list(container.tags, 100).map((x) => text(x, 200))
      : [],
    created_at: nullableText(v.created_at, 100),
    updated_at: nullableText(v.updated_at, 100),
  };
}
async function packages(
  op: GapContract,
  args: Obj,
  calls: Calls,
  deps: Dependencies,
  context: Context,
  repo: Repo,
  admission: string,
): Promise<Result> {
  const root = `/${
      repo.ownerType === "Organization" ? "orgs" : "users"
    }/ausstyle/packages`,
    type = String(args.package_type),
    name = String(args.package_name ?? "");
  if (op.kind === "package_list") {
    const reply = await calls.request(
      github(root, {
        package_type: type,
        page: args.page ?? 1,
        per_page: args.per_page ?? 30,
      }),
    );
    const items = list(reply.body, 100).map((v) => packageItem(v, type)).filter(
        (p): p is Obj => p !== null,
      ),
      next = nextPage(reply, root);
    return {
      result: {
        packages: items,
        next_page: next,
        repository: REPOSITORY,
        owner_page_filtered_to_repository: true,
      },
      truncated: next !== null,
    };
  }
  const path = `${root}/${encodeURIComponent(type)}/${
      encodeURIComponent(name)
    }`,
    versionPath = path + `/versions/${args.version_id}`;
  const isRestore = op.kind.endsWith("restore");
  let p: Obj;
  let proof: PackageProof | null = null;
  if (isRestore) {
    restoreBinding(deps, args, repo.id);
    if (!deps.loadPackageProof) {
      fail("package_identity_evidence_store_required", 424);
    }
    proof = await deps.loadPackageProof!(admission, args);
    if (
      !proof || proof.repository_id !== repo.id ||
      proof.package_type !== type || proof.package_name !== name ||
      proof.package_id !== args.expected_package_id ||
      (op.kind === "version_restore" && proof.version_id !== args.version_id)
    ) fail("verified_package_identity_evidence_required", 424);
    p = { id: proof!.package_id, name, package_type: type };
  } else {
    const reply = await calls.request(github(path));
    p = packageItem(reply.body, type) ??
      fail("package_repository_association_required", 403);
    if (p.name !== name) fail("provider_package_identity_mismatch", 502);
    if (op.is_mutation && p.id !== args.expected_package_id) {
      fail("provider_package_identity_changed", 409);
    }
    proof = {
      repository_id: repo.id,
      package_id: Number(p.id),
      package_type: type,
      package_name: name,
      version_id: null,
      response_sha256: reply.sha256,
      observed_at: new Date((deps.now ?? Date.now)()).toISOString(),
      provider_request_id: reply.id,
    };
    if (op.kind === "package_get") return { result: p, truncated: false };
  }
  if (op.kind === "version_list") {
    const reply = await calls.request(
      github(path + "/versions", {
        page: args.page ?? 1,
        per_page: args.per_page ?? 30,
      }),
    );
    const versions = list(reply.body, 100).map((v) =>
        versionItem(v, type, Number(p.id))
      ),
      next = nextPage(reply, path + "/versions");
    return { result: { versions, next_page: next }, truncated: next !== null };
  }
  if (op.kind === "version_get" || op.kind === "version_delete") {
    const reply = await calls.request(github(versionPath)),
      version = versionItem(reply.body, type, Number(p.id));
    if (version.id !== args.version_id) {
      fail("provider_package_version_identity_mismatch", 502);
    }
    if (op.kind === "version_get") return { result: version, truncated: false };
    proof = {
      ...proof!,
      version_id: Number(args.version_id),
      response_sha256: reply.sha256,
      provider_request_id: reply.id,
    };
  }
  if (!isRestore) {
    if (!deps.savePackageProof) {
      fail("package_identity_evidence_store_required", 424);
    }
    await deps.savePackageProof!(admission, args, proof!);
  }
  const target = (op.kind.startsWith("version_") ? versionPath : path) +
    (isRestore ? "/restore" : "");
  await calls.request(github(target), isRestore ? "POST" : "DELETE");
  if (isRestore) {
    const check = packageItem((await calls.request(github(path))).body, type);
    if (
      !check || check.id !== args.expected_package_id || check.name !== name
    ) {
      throw new Refusal(
        "restored_package_identity_unknown",
        503,
        calls.last?.status ?? null,
        calls.last?.id ?? null,
        true,
      );
    }
    if (op.kind === "version_restore") {
      const v = versionItem(
        (await calls.request(github(versionPath))).body,
        type,
        Number(check.id),
      );
      if (v.id !== args.version_id) {
        throw new Refusal(
          "restored_package_version_identity_unknown",
          503,
          calls.last?.status ?? null,
          calls.last?.id ?? null,
          true,
        );
      }
    }
  }
  return acceptance(
    String(args.version_id ?? p.id),
    null,
    isRestore ? true : null,
  );
}
function graphRepository(value: unknown): Obj {
  const p = obj(value);
  if (
    String(p.nameWithOwner).toLowerCase() !== REPOSITORY ||
    String(obj(p.owner).login).toLowerCase() !== "ausstyle"
  ) fail("provider_repository_scope_mismatch", 502);
  return p;
}
function discussionNode(value: unknown, number?: unknown): Obj {
  const d = obj(value);
  if (
    String(obj(d.repository).nameWithOwner).toLowerCase() !== REPOSITORY ||
    number !== undefined && d.number !== number
  ) fail("provider_discussion_scope_mismatch", 502);
  return d;
}
function commentNode(value: unknown, number: unknown): Obj {
  const c = obj(value);
  if (c.__typename !== undefined && c.__typename !== "DiscussionComment") {
    fail("provider_comment_type_mismatch", 502);
  }
  discussionNode(c.discussion, number);
  return c;
}
function discussionProjection(value: unknown): Obj {
  const d = discussionNode(value), category = obj(d.category);
  return {
    id: text(d.id),
    number: numeric(d.number),
    title: safe(d.title, 1000),
    body_text: redact(text(d.bodyText, 1048576), 20000),
    url: text(d.url, 1000),
    category_slug: text(category.slug, 100),
    closed: bool(d.closed),
    locked: bool(d.locked),
    is_answered: d.isAnswered === null ? false : bool(d.isAnswered),
    answer_id: d.answer ? text(obj(d.answer).id) : null,
    created_at: text(d.createdAt, 100),
    updated_at: text(d.updatedAt, 100),
    author: d.author ? text(obj(d.author).login) : null,
    repository: REPOSITORY,
    redaction_policy: "known_patterns_v1",
  };
}
function commentProjection(value: unknown, number: unknown): Obj {
  const c = commentNode(value, number);
  return {
    id: text(c.id),
    body_text: redact(text(c.bodyText, 1048576), 20000),
    author: c.author ? text(obj(c.author).login) : null,
    created_at: text(c.createdAt, 100),
    updated_at: text(c.updatedAt, 100),
    is_answer: bool(c.isAnswer),
    reply_to_id: c.replyTo ? text(obj(c.replyTo).id) : null,
    discussion_number: number,
    repository: REPOSITORY,
    redaction_policy: "known_patterns_v1",
  };
}
const graphPage = (value: unknown): Obj => {
  const p = obj(value);
  return {
    has_next_page: bool(p.hasNextPage),
    end_cursor: nullableText(p.endCursor, 1000),
  };
};
async function graph(
  calls: Calls,
  document: keyof typeof fixedGraphQLDocuments,
  variables: Obj = {},
): Promise<Obj> {
  const r = await calls.request(github("/graphql"), "POST", {
    query: fixedGraphQLDocuments[document],
    variables,
  });
  const b = obj(r.body);
  if (b.errors) {
    throw new Refusal(
      "provider_graphql_errors",
      424,
      r.status,
      r.id,
      fixedGraphQLDocuments[document].startsWith("mutation"),
    );
  }
  return obj(b.data);
}
async function categoryId(calls: Calls, slug: string): Promise<string> {
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const repo = graphRepository(
        (await graph(calls, "categories", { first: 100, after })).repository,
      ),
      connection = obj(repo.discussionCategories);
    for (const v of list(connection.nodes, 100)) {
      const c = obj(v);
      if (c.slug === slug) return text(c.id);
    }
    const p = graphPage(connection.pageInfo);
    if (!p.has_next_page) fail("discussion_category_not_found", 404);
    after = text(p.end_cursor, 1000);
  }
  return fail("discussion_category_lookup_page_limit", 424);
}
async function discussions(
  op: GapContract,
  args: Obj,
  calls: Calls,
  context: Context,
): Promise<Result> {
  const paging = { first: args.first ?? 30, after: args.after ?? null },
    kind = op.kind;
  if (kind === "discussion_categories" || kind === "discussion_list") {
    const repo = graphRepository(
        (await graph(
          calls,
          kind === "discussion_categories" ? "categories" : "list",
          paging,
        )).repository,
      ),
      connection = obj(
        repo[
          kind === "discussion_categories"
            ? "discussionCategories"
            : "discussions"
        ],
      ),
      page = graphPage(connection.pageInfo);
    const values = list(connection.nodes, 100).map((v) => {
      if (kind !== "discussion_categories") return discussionProjection(v);
      const c = obj(v);
      return {
        id: text(c.id),
        slug: text(c.slug, 100),
        name: safe(c.name, 200),
        is_answerable: bool(c.isAnswerable),
      };
    });
    return {
      result: {
        [kind === "discussion_categories" ? "categories" : "discussions"]:
          values,
        page_info: page,
      },
      truncated: page.has_next_page === true,
    };
  }
  if (kind === "discussion_get" || kind === "comment_list") {
    const repo = graphRepository(
        (await graph(
          calls,
          kind === "discussion_get" ? "discussion" : "comments",
          { number: args.number, ...(kind === "comment_list" ? paging : {}) },
        )).repository,
      ),
      d = discussionNode(repo.discussion, args.number);
    if (kind === "discussion_get") {
      return { result: discussionProjection(d), truncated: false };
    }
    const c = obj(d.comments), page = graphPage(c.pageInfo);
    return {
      result: {
        comments: list(c.nodes, 100).map((v) =>
          commentProjection(v, args.number)
        ),
        page_info: page,
      },
      truncated: page.has_next_page === true,
    };
  }
  if (kind === "comment_get" || kind === "reply_list") {
    const c = commentNode(
      (await graph(calls, kind === "comment_get" ? "comment" : "replies", {
        id: args.comment_id,
        ...(kind === "reply_list" ? paging : {}),
      })).node,
      args.number,
    );
    if (c.id !== args.comment_id) {
      fail("provider_comment_identity_mismatch", 502);
    }
    if (kind === "comment_get") {
      return { result: commentProjection(c, args.number), truncated: false };
    }
    const connection = obj(c.replies), page = graphPage(connection.pageInfo);
    return {
      result: {
        replies: list(connection.nodes, 100).map((v) =>
          commentProjection(v, args.number)
        ),
        page_info: page,
      },
      truncated: page.has_next_page === true,
    };
  }
  let d: Obj | null = null, repo: Obj;
  if (kind === "discussion_create") {
    repo = graphRepository((await graph(calls, "repository")).repository);
  } else {
    repo = graphRepository(
      (await graph(calls, "discussion", { number: args.number })).repository,
    );
    d = discussionNode(repo.discussion, args.number);
  }
  const input: Obj = { clientMutationId: context.request_id };
  if (kind === "discussion_create") {
    input.repositoryId = text(repo.id);
    input.categoryId = await categoryId(calls, String(args.category_slug));
    input.title = args.title;
    input.body = args.body;
  } else if (kind.startsWith("discussion_")) {
    input[kind === "discussion_delete" ? "id" : "discussionId"] = text(d!.id);
    if (kind === "discussion_update") {
      if (args.title !== undefined) input.title = args.title;
      if (args.body !== undefined) input.body = args.body;
      if (args.category_slug !== undefined) {
        input.categoryId = await categoryId(calls, String(args.category_slug));
      }
    }
    if (kind === "discussion_close") input.reason = args.reason ?? "RESOLVED";
  } else if (kind === "comment_create") {
    input.discussionId = text(d!.id);
    input.body = args.body;
    if (args.reply_to_comment_id) {
      const c = commentNode(
        (await graph(calls, "comment", { id: args.reply_to_comment_id })).node,
        args.number,
      );
      if (c.id !== args.reply_to_comment_id) {
        fail("provider_comment_identity_mismatch", 502);
      }
      input.replyToId = c.id;
    }
  } else {
    const c = commentNode(
      (await graph(calls, "comment", { id: args.comment_id })).node,
      args.number,
    );
    if (c.id !== args.comment_id) {
      fail("provider_comment_identity_mismatch", 502);
    }
    input[kind === "comment_update" ? "commentId" : "id"] = c.id;
    if (kind === "comment_update") input.body = args.body;
  }
  const document = kind.startsWith("discussion_") ? kind.slice(11) : kind;
  const body = await graph(
      calls,
      document as keyof typeof fixedGraphQLDocuments,
      { input },
    ),
    payload = obj(body[graphMutationFields[kind]]);
  if (payload.clientMutationId !== context.request_id) {
    throw new Refusal(
      "provider_mutation_receipt_mismatch",
      503,
      calls.last?.status ?? null,
      calls.last?.id ?? null,
      true,
    );
  }
  let resourceId: string;
  if (payload.comment) {
    resourceId = text(commentNode(payload.comment, args.number).id);
  } else if (payload.discussion) {
    resourceId = text(
      discussionNode(
        payload.discussion,
        kind === "discussion_create" ? undefined : args.number,
      ).id,
    );
  } else if (kind === "discussion_delete" || kind === "comment_delete") {
    resourceId = text(input.id);
  } else {throw new Refusal(
      "provider_mutation_resource_receipt_missing",
      503,
      calls.last?.status ?? null,
      calls.last?.id ?? null,
      true,
    );}
  return acceptance(resourceId, context.request_id);
}
async function audit(args: Obj, calls: Calls, repo: Repo): Promise<Result> {
  if (repo.ownerType !== "Organization") {
    fail("repository_organization_owner_required", 424);
  }
  const start = Date.parse(String(args.start)),
    end = Date.parse(String(args.end));
  if (
    !Number.isFinite(start) || !Number.isFinite(end) || start > end ||
    end - start > 7 * 86400000
  ) fail("invalid_audit_time_window", 400);
  const path = "/orgs/ausstyle/audit-log",
    reply = await calls.request(
      github(path, {
        phrase: `repo:${REPOSITORY} created:${args.start}..${args.end}`,
        include: args.include ?? "web",
        order: "desc",
        per_page: args.per_page ?? 30,
        after: args.after,
      }),
    );
  const events = list(reply.body, 100).filter((v) => {
    const x = obj(v);
    return String(x.repo ?? x.repository).toLowerCase() === REPOSITORY;
  }).map((v) => {
    const x = obj(v), stamp = x["@timestamp"] ?? x.created_at ?? x.timestamp;
    return {
      action: safe(x.action),
      actor: nullableText(x.actor),
      repository: REPOSITORY,
      timestamp: typeof stamp === "number"
        ? new Date(stamp).toISOString()
        : text(stamp, 100),
      operation_type: nullableText(x.operation_type),
    };
  });
  let cursor: string | null = null;
  const link = reply.headers.get("link");
  if (link) {
    for (const part of link.split(",")) {
      const match = part.match(/^\s*<([^>]+)>;\s*rel="next"\s*$/);
      if (match) {
        const u = new URL(match[1]);
        if (
          u.protocol !== "https:" || u.host !== "api.github.com" ||
          u.pathname !== path
        ) fail("provider_pagination_scope_mismatch", 502);
        cursor = u.searchParams.get("after");
        if (!cursor || !/^[A-Za-z0-9_+/=-]{1,1000}$/.test(cursor)) {
          fail("provider_pagination_schema_mismatch", 502);
        }
      }
    }
  }
  return {
    result: { events, next_cursor: cursor, repository: REPOSITORY },
    truncated: cursor !== null,
  };
}
export async function executeGithub(
  op: GapContract,
  args: Obj,
  calls: Calls,
  deps: Dependencies,
  context: Context,
  admission: string,
): Promise<Result> {
  if (
    op.kind.startsWith("discussion_") || op.kind.startsWith("comment_") ||
    op.kind === "reply_list"
  ) return await discussions(op, args, calls, context);
  const repo = await repository(calls);
  if (op.kind.startsWith("secret_")) {
    return await environmentSecrets(op, args, calls);
  }
  if (op.kind === "audit") return await audit(args, calls, repo);
  return await packages(op, args, calls, deps, context, repo, admission);
}
