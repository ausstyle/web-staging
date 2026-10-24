import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
export const PROJECT = "zmqlyygzqoidkcwdysok";
export const REPOSITORY = "ausstyle/web-staging";
export const GCP_PROJECT = "elaborate-haven-511518-a5";
export const GCP_ZONE = "europe-west1-b";
export type Obj = Record<string, unknown>;
export type GapContract = {
  operation: string;
  kind: string;
  provider: "supabase" | "github" | "gcp";
  requirement_ids: number[];
  description: string;
  permission_scope: "infrastructure:read" | "infrastructure:write";
  is_mutation: boolean;
  requires_approval: boolean;
  requires_cost_approval?: boolean;
  api_key_delegable: boolean;
  input_schema: Obj;
  output_schema: Obj;
  contract_sha256: string;
  source: string;
  source_sha256: string;
  provider_operation_id: string;
};
const str = (maxLength = 200, minLength = 1): Obj => ({
  type: "string",
  minLength,
  maxLength,
});
const integer = (maximum = Number.MAX_SAFE_INTEGER, minimum = 1): Obj => ({
  type: "integer",
  minimum,
  maximum,
});
const enumeration = (...values: string[]): Obj => ({
  type: "string",
  enum: values,
});
const object = (
  properties: Obj,
  required: string[] = Object.keys(properties),
): Obj => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const array = (items: Obj, maxItems = 100): Obj => ({
  type: "array",
  items,
  maxItems,
});
const nilString = { type: ["string", "null"] };
const nilInteger = { type: ["integer", "null"], minimum: 0 };
const page = {
  first: integer(100),
  after: {
    type: "string",
    minLength: 1,
    maxLength: 1000,
    pattern: "^[A-Za-z0-9_+/=-]+$",
  },
};
const listPage = { page: integer(10000), per_page: integer(100) };
const packageType = enumeration(
  "npm",
  "maven",
  "rubygems",
  "docker",
  "nuget",
  "container",
);
const packageName = {
  type: "string",
  minLength: 1,
  maxLength: 214,
  pattern: "^[A-Za-z0-9@][A-Za-z0-9_.@/-]*$",
};
const packageInput = { package_type: packageType, package_name: packageName };
const environment = {
  type: "string",
  minLength: 1,
  maxLength: 100,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_. -]*$",
};
const secret = {
  type: "string",
  minLength: 1,
  maxLength: 100,
  pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
};
const nodeId = {
  type: "string",
  minLength: 4,
  maxLength: 200,
  pattern: "^[A-Za-z0-9_+=/-]+$",
};
const number = integer(2147483647);
const discussionInput = { number };
const commentInput = { number, comment_id: nodeId };
const orgResult = object({ id: str(), slug: str(), name: str() });
const packageResult = object({
  id: integer(),
  name: str(214),
  package_type: packageType,
  visibility: str(50),
  repository: { const: REPOSITORY },
  created_at: nilString,
  updated_at: nilString,
  version_count: nilInteger,
});
const versionResult = object({
  id: integer(),
  name: str(1000),
  package_id: integer(),
  package_type: packageType,
  tags: array(str(200), 100),
  created_at: nilString,
  updated_at: nilString,
});
const pageInfo = object({
  has_next_page: { type: "boolean" },
  end_cursor: nilString,
});
const discussionResult = object({
  id: nodeId,
  number,
  title: str(1000, 0),
  body_text: str(20000, 0),
  url: str(1000),
  category_slug: str(100),
  closed: { type: "boolean" },
  locked: { type: "boolean" },
  is_answered: { type: "boolean" },
  answer_id: nilString,
  created_at: str(100),
  updated_at: str(100),
  author: nilString,
  repository: { const: REPOSITORY },
  redaction_policy: { const: "known_patterns_v1" },
});
const commentResult = object({
  id: nodeId,
  body_text: str(20000, 0),
  author: nilString,
  created_at: str(100),
  updated_at: str(100),
  is_answer: { type: "boolean" },
  reply_to_id: nilString,
  discussion_number: number,
  repository: { const: REPOSITORY },
  redaction_policy: { const: "known_patterns_v1" },
});
const mutationResult = object({
  accepted: { const: true },
  effect_confirmed: { const: false },
  resource_id: nilString,
  client_mutation_id: nilString,
  readback_matched: { type: ["boolean", "null"] },
});
const sourceInfo = {
  supabase: [
    "https://raw.githubusercontent.com/supabase/supabase/f5b00a5237155603efc708b08ece7d8c6aacf763/apps/docs/spec/api_v1_openapi.json",
    "a322345cd8bcaab5f22dc615600b3ae1e1a1f37c9534b7a9839971a66cde9434",
  ],
  supabase_functions: [
    "https://registry.npmjs.org/@supabase/functions-js/-/functions-js-2.4.6.tgz#package/src/FunctionsClient.ts",
    "36458f0becec05f760137a4352b962270b2b5d7a2166c343ac39194c2f6380c6",
  ],
  github: [
    "https://raw.githubusercontent.com/github/rest-api-description/755ee33b4a81d51f6f07a902cce26cbec3b822f2/descriptions/api.github.com/api.github.com.json",
    "3177ad6a86ca04c57a9bef3fc24e28a339efb8eb040c6f950af3d3ed2fee7fa3",
  ],
  graphql: [
    "https://registry.npmjs.org/@octokit/graphql-schema/-/graphql-schema-15.26.1.tgz#package/schema.graphql",
    "3c62d0526d133cee53221c89de9b455ade24db78b9e7ad56d642c4c15bce2654",
  ],
  ghec: [
    "https://raw.githubusercontent.com/github/rest-api-description/755ee33b4a81d51f6f07a902cce26cbec3b822f2/descriptions/ghec/ghec.json",
    "998ae512e4cd85801b3d94bef91bd34e4a7281f7e2f8704f9841c2782536a7d2",
  ],
  logging: [
    "https://raw.githubusercontent.com/googleapis/google-api-go-client/795219d564a58d0ff44efde7b6be21544b4ff057/logging/v2/logging-api.json",
    "09ffd0099481c15e0e67a3407f57d70dc60b74eda29d6bf66f465e1b0525af1f",
  ],
  compute: [
    "https://raw.githubusercontent.com/googleapis/google-api-go-client/795219d564a58d0ff44efde7b6be21544b4ff057/compute/v1/compute-api.json",
    "cc007ff6a76526bbfe0a6868678ca2b5b3eec6ee7a3f6f453f627013287629d5",
  ],
};
// Source schema bytes are pinned separately from generated executable contracts.
const definitions: Record<string, Omit<GapContract, "contract_sha256">> = {};
function define(
  operation: string,
  kind: string,
  provider: GapContract["provider"],
  requirements: number[],
  input: Obj,
  result: Obj,
  mutation: boolean,
  sensitive: boolean,
  providerId: string,
  description: string,
  sourceKind: keyof typeof sourceInfo = provider === "gcp"
    ? "compute"
    : provider,
) {
  const [source, source_sha256] = sourceInfo[sourceKind];
  definitions[operation] = {
    operation,
    kind,
    provider,
    requirement_ids: requirements,
    description: description +
      " Contract v1.0.0; provider acceptance and observed metadata do not certify full lifecycle completion.",
    permission_scope: mutation || sensitive
      ? "infrastructure:write"
      : "infrastructure:read",
    is_mutation: mutation,
    requires_approval: mutation || sensitive,
    api_key_delegable: false,
    input_schema: input,
    output_schema: object({
      ok: { const: true },
      operation: { const: operation },
      contract_version: { const: "1.0.0" },
      provider: { const: provider },
      request_state: enumeration("observed", "accepted"),
      executed: { const: true },
      admission_id: { type: "string", format: "uuid" },
      provider_http_status: integer(599, 100),
      provider_request_id: nilString,
      result,
      possibly_truncated: { type: "boolean" },
    }),
    source,
    source_sha256,
    provider_operation_id: providerId,
  };
}
define(
  "supabase.projects.list",
  "project_list",
  "supabase",
  [76],
  object({}),
  object({
    projects: array(
      object({
        ref: str(20),
        name: str(256),
        region: str(100),
        status: str(100),
      }),
    ),
    project_ref: { const: PROJECT },
    complete_for_bound_project: { const: true },
    other_projects_disclosed: { const: false },
  }),
  false,
  false,
  "v1-list-all-projects",
  "List metadata only for the already authorised bound project; no account-wide inventory disclosure.",
);
define(
  "supabase.projects.create",
  "project_create",
  "supabase",
  [76],
  object({
    name: { type: "string", pattern: "^sandy-eng-[a-z0-9][a-z0-9-]{2,50}$" },
    region: enumeration(
      "eu-west-1",
      "eu-west-2",
      "eu-west-3",
      "eu-central-1",
      "eu-central-2",
      "eu-north-1",
      "us-east-1",
      "us-west-1",
      "us-west-2",
      "ap-southeast-2",
    ),
  }),
  object({
    accepted: { const: true },
    effect_confirmed: { const: false },
    project_ref: str(20),
    name: str(256),
    status: str(100),
    organization_relationship_verified: { const: true },
  }),
  true,
  true,
  "v1-create-a-project",
  "Create a separately authorised engineering project in the bound project's organisation. Existing custodied per-project database password and positive cost admission required; no secret input/output or automatic retry.",
);
definitions["supabase.projects.create"].requires_cost_approval = true;
define(
  "supabase.functions.invoke",
  "function_invoke",
  "supabase",
  [83],
  object({
    slug: { type: "string", pattern: "^[a-z][a-z0-9-]{2,90}$" },
    body: { type: "object", maxProperties: 100 },
  }),
  object({
    accepted: { const: true },
    effect_confirmed: { const: false },
    function_slug: str(91),
    response_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    response_content_disclosed: { const: false },
  }),
  true,
  true,
  "FunctionsClient.invoke",
  "Invoke an installed JWT-protected function using the same independently authenticated caller session. Return a bounded response digest, never provider or service credentials or arbitrary response content.",
  "supabase_functions",
);
define(
  "gcp.compute.instances.serial_output",
  "serial",
  "gcp",
  [33],
  object({
    instance: {
      type: "string",
      pattern: "^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$",
    },
    port: integer(4),
    start: { type: "string", pattern: "^-?[0-9]{1,20}$" },
    max_chars: integer(20000),
  }, ["instance"]),
  object({
    instance: str(63),
    port: integer(4),
    start: str(30, 0),
    next: str(30, 0),
    content_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    source_bytes: integer(2097152, 0),
    redacted_text: str(20000, 0),
    redaction_policy: { const: "known_patterns_v1" },
  }),
  false,
  true,
  "compute.instances.getSerialPortOutput",
  "Read bounded serial-port output from a fixed-project/zone VM, returning a digest and known-pattern-redacted text",
  "compute",
);
define(
  "supabase.orgs.list",
  "org_list",
  "supabase",
  [75],
  object({}),
  object({
    organizations: array(orgResult, 1),
    project_ref: { const: PROJECT },
    complete_for_bound_project: { const: true },
    other_memberships_disclosed: { const: false },
  }),
  false,
  false,
  "v1-list-all-organizations",
  "List only the organization whose relationship to the configured project is proved by project metadata",
);
define(
  "supabase.orgs.get",
  "org_get",
  "supabase",
  [75],
  object({}),
  object({ organization: orgResult, project_ref: { const: PROJECT } }),
  false,
  false,
  "v1-get-an-organization",
  "Read the configured project's organization after independent membership relationship checks",
);
for (
  const operation of ["supabase.project.logs.query", "supabase.logs.query"]
) {
  define(
    operation,
    "logs",
    "supabase",
    [85, 110],
    object({
      source: enumeration(
        "edge_logs",
        "postgres_logs",
        "auth_logs",
        "realtime_logs",
        "storage_logs",
        "function_logs",
      ),
      start: { type: "string", format: "date-time" },
      end: { type: "string", format: "date-time" },
      limit: integer(100),
    }, ["source", "start", "end"]),
    object({
      entries: array(
        object({
          id: nilString,
          timestamp: str(100, 0),
          source: str(40),
          message: str(2048, 0),
        }),
        100,
      ),
      project_ref: { const: PROJECT },
      next_query_before: nilString,
      redaction_policy: { const: "known_patterns_v1" },
      query_dialect: { const: "clickhouse_sql" },
    }),
    false,
    true,
    "v1-get-project-logs",
    "Query a bounded fixed-source/time/project log stream using a generated ClickHouse query, never caller SQL",
  );
}
for (
  const [suffix, kind, mutation] of [
    ["list", "secret_list", false],
    ["get", "secret_get", false],
    ["public_key.get", "secret_key", false],
    ["set", "secret_set", true],
    ["delete", "secret_delete", true],
  ] as const
) {
  const props: Obj = {
    environment,
    ...(kind === "secret_list" ? listPage : {}),
    ...(["secret_get", "secret_set", "secret_delete"].includes(kind)
      ? { secret_name: secret }
      : {}),
  };
  const required = [
    "environment",
    ...(["secret_get", "secret_set", "secret_delete"].includes(kind)
      ? ["secret_name"]
      : []),
  ];
  if (kind === "secret_set") {
    props.key_id = str(100);
    props.encrypted_value = {
      type: "string",
      minLength: 64,
      maxLength: 100000,
      pattern: "^[A-Za-z0-9+/]+={0,2}$",
    };
    required.push("key_id", "encrypted_value");
  }
  const secretMeta = object({
    name: str(100),
    created_at: str(100),
    updated_at: str(100),
  });
  const result = mutation ? mutationResult : kind === "secret_key"
    ? object({
      key_id: str(100),
      key: { type: "string", pattern: "^[A-Za-z0-9+/]+={0,2}$" },
      key_material: { const: "public_encryption_key" },
    })
    : kind === "secret_list"
    ? object({
      secrets: array(secretMeta),
      next_page: nilInteger,
      values_disclosed: { const: false },
    })
    : object({ secret: secretMeta, values_disclosed: { const: false } });
  define(
    "github.environment_secrets." + suffix,
    kind,
    "github",
    [136],
    object(props, required),
    result,
    mutation,
    false,
    "actions/" + ({
      secret_list: "list-environment-secrets",
      secret_get: "get-environment-secret",
      secret_key: "get-environment-public-key",
      secret_set: "create-or-update-environment-secret",
      secret_delete: "delete-environment-secret",
    }[kind]),
    "Manage environment-secret metadata or encrypted values for the fixed repository; plaintext is never returned",
  );
}
for (
  const [suffix, kind, mutation] of [
    ["list", "package_list", false],
    ["get", "package_get", false],
    ["versions.list", "version_list", false],
    ["versions.get", "version_get", false],
    ["delete", "package_delete", true],
    ["restore", "package_restore", true],
    ["versions.delete", "version_delete", true],
    ["versions.restore", "version_restore", true],
  ] as const
) {
  const props: Obj = kind === "package_list"
    ? { package_type: packageType, ...listPage }
    : { ...packageInput, ...(kind === "version_list" ? listPage : {}) };
  const required = kind === "package_list"
    ? ["package_type"]
    : ["package_type", "package_name"];
  if (["version_get", "version_delete", "version_restore"].includes(kind)) {
    props.version_id = integer();
    required.push("version_id");
  }
  if (mutation) {
    props.expected_package_id = integer();
    required.push("expected_package_id");
  }
  const result = mutation ? mutationResult : kind === "package_list"
    ? object({
      packages: array(packageResult),
      next_page: nilInteger,
      repository: { const: REPOSITORY },
      owner_page_filtered_to_repository: { const: true },
    })
    : kind === "version_list"
    ? object({ versions: array(versionResult), next_page: nilInteger })
    : kind === "version_get"
    ? versionResult
    : packageResult;
  define(
    "github.packages." + suffix,
    kind,
    "github",
    [126],
    object(props, required),
    result,
    mutation,
    false,
    "packages/" + ({
      package_list:
        "list-packages-for-organization|packages/list-packages-for-user",
      package_get: "get-package-for-organization|packages/get-package-for-user",
      version_list:
        "get-all-package-versions-for-package-owned-by-org|packages/get-all-package-versions-for-package-owned-by-user",
      version_get:
        "get-package-version-for-organization|packages/get-package-version-for-user",
      package_delete: "delete-package-for-org|packages/delete-package-for-user",
      package_restore:
        "restore-package-for-org|packages/restore-package-for-user",
      version_delete:
        "delete-package-version-for-org|packages/delete-package-version-for-user",
      version_restore:
        "restore-package-version-for-org|packages/restore-package-version-for-user",
    }[kind]),
    "Manage only packages with an authoritative association to the fixed repository; restoration requires stored identity proof and an expiring exclusive-namespace binding",
  );
}
const graphDefs: [string, string, Obj, Obj, boolean][] = [
  [
    "categories.list",
    "discussion_categories",
    object(page, []),
    object({
      categories: array(
        object({
          id: nodeId,
          slug: str(100),
          name: str(200),
          is_answerable: { type: "boolean" },
        }),
      ),
      page_info: pageInfo,
    }),
    false,
  ],
  [
    "list",
    "discussion_list",
    object(page, []),
    object({ discussions: array(discussionResult), page_info: pageInfo }),
    false,
  ],
  ["get", "discussion_get", object(discussionInput), discussionResult, false],
  [
    "create",
    "discussion_create",
    object({ title: str(256), body: str(20000), category_slug: str(100) }),
    mutationResult,
    true,
  ],
  [
    "update",
    "discussion_update",
    {
      ...object({
        ...discussionInput,
        title: str(256),
        body: str(20000),
        category_slug: str(100),
      }, ["number"]),
      minProperties: 2,
    },
    mutationResult,
    true,
  ],
  [
    "delete",
    "discussion_delete",
    object(discussionInput),
    mutationResult,
    true,
  ],
  [
    "close",
    "discussion_close",
    object({
      ...discussionInput,
      reason: enumeration("RESOLVED", "DUPLICATE", "OUTDATED"),
    }, ["number"]),
    mutationResult,
    true,
  ],
  [
    "reopen",
    "discussion_reopen",
    object(discussionInput),
    mutationResult,
    true,
  ],
  [
    "comments.list",
    "comment_list",
    object({ ...discussionInput, ...page }, ["number"]),
    object({ comments: array(commentResult), page_info: pageInfo }),
    false,
  ],
  ["comments.get", "comment_get", object(commentInput), commentResult, false],
  [
    "comments.create",
    "comment_create",
    object({
      ...discussionInput,
      body: str(20000),
      reply_to_comment_id: nodeId,
    }, ["number", "body"]),
    mutationResult,
    true,
  ],
  [
    "comments.update",
    "comment_update",
    object({ ...commentInput, body: str(20000) }),
    mutationResult,
    true,
  ],
  [
    "comments.delete",
    "comment_delete",
    object(commentInput),
    mutationResult,
    true,
  ],
  [
    "comments.mark_answer",
    "comment_mark_answer",
    object(commentInput),
    mutationResult,
    true,
  ],
  [
    "comments.unmark_answer",
    "comment_unmark_answer",
    object(commentInput),
    mutationResult,
    true,
  ],
  [
    "replies.list",
    "reply_list",
    object({ ...commentInput, ...page }, ["number", "comment_id"]),
    object({ replies: array(commentResult), page_info: pageInfo }),
    false,
  ],
];
for (const [suffix, kind, input, result, mutation] of graphDefs) {
  define(
    "github.discussions." + suffix,
    kind,
    "github",
    [123],
    input,
    result,
    mutation,
    !mutation && kind !== "discussion_categories",
    "GraphQL." + ({
      discussion_categories: "repository.discussionCategories",
      discussion_list: "repository.discussions",
      discussion_get: "repository.discussion",
      discussion_create: "createDiscussion",
      discussion_update: "updateDiscussion",
      discussion_delete: "deleteDiscussion",
      discussion_close: "closeDiscussion",
      discussion_reopen: "reopenDiscussion",
      comment_list: "repository.discussion.comments",
      comment_get: "node:DiscussionComment",
      comment_create: "addDiscussionComment",
      comment_update: "updateDiscussionComment",
      comment_delete: "deleteDiscussionComment",
      comment_mark_answer: "markDiscussionCommentAsAnswer",
      comment_unmark_answer: "unmarkDiscussionCommentAsAnswer",
      reply_list: "node:DiscussionComment.replies",
    }[kind]),
    "Use fixed GraphQL documents and server-resolved repository/discussion/comment identities; no caller query or unscoped node mutation",
    "graphql",
  );
}
define(
  "github.audit.list",
  "audit",
  "github",
  [140],
  object({
    start: { type: "string", format: "date" },
    end: { type: "string", format: "date" },
    after: page.after,
    per_page: integer(100),
    include: enumeration("web", "git", "all"),
  }, ["start", "end"]),
  object({
    events: array(
      object({
        action: str(200),
        actor: nilString,
        repository: { const: REPOSITORY },
        timestamp: str(100),
        operation_type: nilString,
      }),
    ),
    next_cursor: nilString,
    repository: { const: REPOSITORY },
  }),
  false,
  true,
  "orgs/get-audit-log",
  "Read repository-filtered organization audit events only after the current repository owner is proved to be an organization; provider plan requirements remain distinct",
  "ghec",
);
define(
  "gcp.logging.query",
  "logging_query",
  "gcp",
  [67],
  object({
    log_id: {
      type: "string",
      pattern: "^sandy-engineering-canary(?:[-_][a-z0-9_-]{1,64})?$",
    },
    start: { type: "string", format: "date-time" },
    end: { type: "string", format: "date-time" },
    limit: integer(100),
  }, ["log_id", "start", "end"]),
  object({
    project_id: { const: GCP_PROJECT },
    log_id: str(100),
    entries: array(object({
      timestamp: { type: "string", format: "date-time" },
      severity: enumeration(
        "DEFAULT",
        "DEBUG",
        "INFO",
        "NOTICE",
        "WARNING",
        "ERROR",
        "CRITICAL",
        "ALERT",
        "EMERGENCY",
      ),
      resource_type: str(100),
    })),
    payloads_disclosed: { const: false },
    continuation_available: { type: "boolean" },
  }),
  false,
  true,
  "logging.entries.list",
  "Query one bounded engineering canary log/time window in the fixed project; metadata only, no caller filter or payload disclosure, no automatic pagination",
  "logging",
);
export const gapContracts: Readonly<Record<string, GapContract>> = Object
  .freeze(
    Object.fromEntries(
      await Promise.all(
        Object.entries(definitions).map(async (
          [operation, contract],
        ) => [operation, {
          ...contract,
          contract_sha256: await argumentDigest({
            version: "1.0.0",
            ...contract,
          }),
        }]),
      ),
    ),
  );
export const isGapOperation = (operation: unknown): boolean =>
  typeof operation === "string" && Object.hasOwn(gapContracts, operation);
