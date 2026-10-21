/** Dedicated transport/filter adapters. Every contract is closed until verified. */
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
export const PROJECT = "zmqlyygzqoidkcwdysok";
export const GCP_PROJECT = "elaborate-haven-511518-a5";
export const GCP_NUMBER = "1030223524306";
export const REGION = "europe-west1";
export const REPOSITORY = "ausstyle/web-staging";
export type Obj = Record<string, unknown>;
export type Contract = {
  operation: string;
  kind: string;
  provider: "gcp" | "github" | "supabase";
  requirement: number;
  provider_operation_id: string;
  source: string;
  source_sha256: string;
  is_mutation: boolean;
  permission_scope: string;
  requires_approval: true;
  api_key_delegable: false;
  input_schema: Obj;
  output_schema: Obj;
  contract_sha256: string;
};
export const objectSchema = (
  properties: Obj,
  required = Object.keys(properties),
): Obj => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const str = (maxLength = 200, minLength = 1): Obj => ({
  type: "string",
  minLength,
  maxLength,
});
export const int = (maximum: number, minimum = 1): Obj => ({
  type: "integer",
  minimum,
  maximum,
});
export const nullable = (schema: Obj): Obj => ({
  anyOf: [schema, { type: "null" }],
});
export const array = (items: Obj, maxItems = 100): Obj => ({
  type: "array",
  items,
  maxItems,
});
export const name = {
  ...str(63),
  pattern: "^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$",
};
export const uuid = { ...str(36), format: "uuid" };
export const digest = { ...str(64), pattern: "^[a-f0-9]{64}$" };
export const b64 = {
  ...str(1398104, 0),
  pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
};
export const mime = {
  ...str(100),
  pattern: "^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$",
};
export const relativePath = {
  ...str(240),
  pattern: "^[A-Za-z0-9_][A-Za-z0-9_./@+ -]*$",
};
const ns =
  "https://raw.githubusercontent.com/googleapis/google-api-go-client/795219d564a58d0ff44efde7b6be21544b4ff057/";
const sources: Record<string, [string, string]> = {
  resource: [
    ns + "cloudresourcemanager/v3/cloudresourcemanager-api.json",
    "b2c4dbd4e5e1287622355a2231af349763cf336921bad81938086942cb319c68",
  ],
  billing: [
    ns + "cloudbilling/v1/cloudbilling-api.json",
    "41a8986db205f5c23fdff576d88a1fff9ef6c49ac0465b11fc88bdddef95766e",
  ],
  compute: [
    ns + "compute/v1/compute-api.json",
    "cc007ff6a76526bbfe0a6868678ca2b5b3eec6ee7a3f6f453f627013287629d5",
  ],
  artifactregistry: [
    ns + "artifactregistry/v1/artifactregistry-api.json",
    "e45d694a7b3a0cc65076f74a719a56ace3329057e47ad5cabccf3012b2c31a7c",
  ],
  storage: [
    ns + "storage/v1/storage-api.json",
    "f006fcfde7c604fe516a57429e14f56fe20ee3095c8d61f3fe4df26122f0e3cb",
  ],
  supabase: [
    "https://raw.githubusercontent.com/supabase/supabase/f5b00a5237155603efc708b08ece7d8c6aacf763/apps/docs/spec/api_v1_openapi.json",
    "a322345cd8bcaab5f22dc615600b3ae1e1a1f37c9534b7a9839971a66cde9434",
  ],
  github: [
    "https://raw.githubusercontent.com/github/rest-api-description/755ee33b4a81d51f6f07a902cce26cbec3b822f2/descriptions/api.github.com/api.github.com.json",
    "3177ad6a86ca04c57a9bef3fc24e28a339efb8eb040c6f950af3d3ed2fee7fa3",
  ],
};
const definitions: Record<string, Omit<Contract, "contract_sha256">> = {};
export function define(
  operation: string,
  kind: string,
  provider: Contract["provider"],
  requirement: number,
  provider_operation_id: string,
  sourceKey: string,
  input: Obj,
  result: Obj,
  mutation = false,
) {
  const [source, source_sha256] = sources[sourceKey];
  definitions[operation] = {
    operation,
    kind,
    provider,
    requirement,
    provider_operation_id,
    source,
    source_sha256,
    is_mutation: mutation,
    permission_scope: "infrastructure:write",
    requires_approval: true,
    api_key_delegable: false,
    input_schema: input,
    output_schema: objectSchema({
      ok: { const: true },
      operation: { const: operation },
      contract_version: { const: "1.0.0" },
      provider: { const: provider },
      request_state: { enum: ["observed", "accepted"] },
      executed: { const: true },
      admission_id: uuid,
      provider_http_status: int(599, 200),
      provider_request_id: nullable(str()),
      result,
    }),
  };
}
const pageInput = objectSchema({ cursor_id: uuid, page_size: int(100) }, []);
const resourceResult = objectSchema({
  resources: array(
    objectSchema({
      name: str(),
      display_name: nullable(str(2000)),
      state: nullable(str(100)),
    }),
  ),
  next_cursor_id: nullable(uuid),
  scan_complete: { type: "boolean" },
  scope_filter: { const: "exact_verified_resource" },
});
for (
  const [operation, kind, req, id, source] of [
    [
      "gcp.organizations.search_filtered",
      "organization_search",
      12,
      "cloudresourcemanager.organizations.search",
      "resource",
    ],
    [
      "gcp.folders.search_filtered",
      "folder_search",
      13,
      "cloudresourcemanager.folders.search",
      "resource",
    ],
    [
      "gcp.projects.list_filtered",
      "project_list",
      14,
      "cloudresourcemanager.projects.list",
      "resource",
    ],
    [
      "gcp.projects.search_filtered",
      "project_search",
      14,
      "cloudresourcemanager.projects.search",
      "resource",
    ],
    [
      "gcp.billing.accounts.list_filtered",
      "billing_list",
      23,
      "cloudbilling.billingAccounts.list",
      "billing",
    ],
  ] as const
) define(operation, kind, "gcp", req, id, source, pageInput, resourceResult);
export const artifactResult = objectSchema({
  custody_id: uuid,
  byte_length: int(1048576, 0),
  sha256: digest,
  media_type: str(100),
  expires_at: { ...str(40), format: "date-time" },
  content_returned: { const: false },
  transfer_state: { const: "captured_private" },
});
define(
  "supabase.functions.body.capture",
  "function_body",
  "supabase",
  83,
  "v1-get-a-function-body",
  "supabase",
  objectSchema({ function_slug: name }),
  artifactResult,
);
define(
  "supabase.functions.deploy.multipart",
  "function_deploy",
  "supabase",
  83,
  "v1-deploy-a-function",
  "supabase",
  objectSchema({
    slug: name,
    entrypoint_path: relativePath,
    import_map_path: relativePath,
    verify_jwt: { const: true },
    name: str(100),
    files: array(
      objectSchema({ path: relativePath, content_base64: b64, sha256: digest }),
      32,
    ),
  }, ["slug", "entrypoint_path", "verify_jwt", "files"]),
  objectSchema({
    id: str(),
    slug: name,
    name: str(100),
    status: { enum: ["ACTIVE", "REMOVED", "THROTTLED"] },
    version: int(2147483647),
    verify_jwt: { const: true },
    source_sha256: digest,
    readback_matched: { type: "boolean" },
    transfer_state: { const: "accepted" },
  }),
  true,
);
// Discovery supplies no response contract for this method. Capture bytes privately;
// this does not invent or certify a typed effective-policy response.
define(
  "gcp.load_balancers.backends.effective_security_policies.capture",
  "effective_security",
  "gcp",
  57,
  "compute.backendServices.getEffectiveSecurityPolicies",
  "compute",
  objectSchema({ backend_service: name }),
  objectSchema({
    artifact: artifactResult,
    provider_response_contract: { const: "undocumented" },
    effective_policy_semantics_verified: { const: false },
  }),
);
const username = {
  ...str(39),
  pattern: "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$",
};
for (
  const [operation, kind, req, id, input] of [
    [
      "github.pulls.merged.check",
      "github_merged",
      119,
      "pulls/check-if-merged",
      objectSchema({ pull_number: int(2147483647) }),
    ],
    [
      "github.issues.assignee.check",
      "github_assignee",
      120,
      "issues/check-user-can-be-assigned",
      objectSchema({ assignee: username }),
    ],
    [
      "github.issues.assignee_on_issue.check",
      "github_issue_assignee",
      120,
      "issues/check-user-can-be-assigned-to-issue",
      objectSchema({ assignee: username, issue_number: int(2147483647) }),
    ],
    [
      "github.collaborators.check",
      "github_collaborator",
      138,
      "repos/check-collaborator",
      objectSchema({ username }),
    ],
    [
      "github.security.vulnerability_alerts.check",
      "github_vulnerability",
      141,
      "repos/check-vulnerability-alerts",
      objectSchema({}),
    ],
  ] as const
) {
  define(
    operation,
    kind,
    "github",
    req,
    id,
    "github",
    input,
    objectSchema({
      condition: { type: "boolean" },
      repository: { const: REPOSITORY },
      not_found_semantics: { const: "provider_condition_or_visibility" },
    }),
  );
}
const payload = { content_base64: b64, sha256: digest, media_type: mime };
const artifactParent = { repository: name };
export const acceptedMedia = objectSchema({
  source_sha256: digest,
  source_bytes: int(1048576, 0),
  target_sha256: nullable(digest),
  target: str(1000),
  provider_response_sha256: digest,
  operation_name: nullable(str(1000)),
  operation_done: nullable({ type: "boolean" }),
  effect_confirmed: { const: false },
  transfer_state: { const: "accepted" },
});
const fileId = { ...str(240), pattern: "^[A-Za-z0-9_][A-Za-z0-9_.~@:+-]*$" };
for (
  const [category, kind, providerId, metadata] of [
    ["apt", "artifact_apt", "aptArtifacts", objectSchema({})],
    [
      "files",
      "artifact_file",
      "files",
      objectSchema(
        { fileId, fileType: { enum: ["ATTACHMENT", "ARTIFACT"] } },
        [],
      ),
    ],
    [
      "generic",
      "artifact_generic",
      "genericArtifacts",
      objectSchema({
        filename: { ...str(200), pattern: "^[A-Za-z0-9_.~@-]+$" },
        packageId: {
          ...str(256),
          pattern: "^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$",
        },
        versionId: {
          ...str(128),
          pattern: "^[a-z0-9](?:[a-z0-9.+~:-]*[a-z0-9])?$",
          not: { const: "latest" },
        },
        versionAnnotations: {
          type: "object",
          maxProperties: 20,
          propertyNames: { ...str(63), pattern: "^[a-zA-Z0-9_.-]+$" },
          additionalProperties: str(2000, 0),
        },
      }, ["filename", "packageId", "versionId"]),
    ],
    ["go", "artifact_go", "goModules", objectSchema({})],
    ["googet", "artifact_googet", "googetArtifacts", objectSchema({})],
    [
      "kfp",
      "artifact_kfp",
      "kfpArtifacts",
      objectSchema({ description: str(2000, 0), tags: array(name, 20) }, []),
    ],
    ["yum", "artifact_yum", "yumArtifacts", objectSchema({})],
  ] as const
) {
  define(
    `gcp.artifacts.repositories.${category}.upload.media`,
    kind,
    "gcp",
    63,
    `artifactregistry.projects.locations.repositories.${providerId}.upload`,
    "artifactregistry",
    objectSchema({ ...artifactParent, ...payload, metadata }),
    acceptedMedia,
    true,
  );
}
define(
  "gcp.artifacts.files.download.capture",
  "artifact_download",
  "gcp",
  63,
  "artifactregistry.projects.locations.repositories.files.download",
  "artifactregistry",
  objectSchema({
    ...artifactParent,
    file_id: { ...str(1000), pattern: "^[A-Za-z0-9][A-Za-z0-9_.~@:/+-]*$" },
  }),
  artifactResult,
);
const bucket = { ...str(222, 3), pattern: "^[a-z0-9][a-z0-9._-]*[a-z0-9]$" };
const objectName = {
  ...str(1000),
  pattern: "^[A-Za-z0-9_][A-Za-z0-9_.@/ +:-]*$",
};
define(
  "gcp.storage.objects.upload.media",
  "storage_upload",
  "gcp",
  65,
  "storage.objects.insert",
  "storage",
  objectSchema({
    bucket,
    object_name: objectName,
    if_generation_match: { ...str(20), pattern: "^[0-9]{1,20}$" },
    ...payload,
  }),
  acceptedMedia,
  true,
);
define(
  "gcp.artifacts.repositories.export.bound",
  "artifact_export",
  "gcp",
  63,
  "artifactregistry.projects.locations.repositories.exportArtifact",
  "artifactregistry",
  objectSchema({
    repository: name,
    package: fileId,
    source_type: { enum: ["tags", "versions"] },
    source_id: fileId,
    destination_bucket: bucket,
    destination_prefix: {
      ...str(300),
      pattern: "^[A-Za-z0-9_][A-Za-z0-9_./-]*$",
    },
    overwrite_existing: { const: true },
  }),
  objectSchema({
    target: str(1000),
    operation_name: str(1000),
    operation_done: nullable({ type: "boolean" }),
    effect_confirmed: { const: false },
    transfer_state: { const: "accepted" },
  }),
  true,
);
const redirectResult = objectSchema({
  custody_id: uuid,
  source_response_sha256: digest,
  signed_url_returned: { const: false },
  content_returned: { const: false },
  transfer_state: { const: "redirect_initiated_private" },
  expires_at: { ...str(40), format: "date-time" },
  payload_transfer_complete: { const: false },
});
for (
  const [operation, kind, providerId, input, requirement] of [
    [
      "github.actions.jobs.logs.capture",
      "download_job",
      "actions/download-job-logs-for-workflow-run",
      objectSchema({ job_id: int(Number.MAX_SAFE_INTEGER) }),
      128,
    ],
    [
      "github.actions.jobs.steps.logs.capture",
      "download_step",
      "actions/download-step-logs-for-workflow-run-job",
      objectSchema({
        job_id: int(Number.MAX_SAFE_INTEGER),
        step_number: int(1000),
      }),
      128,
    ],
    [
      "github.actions.runs.attempts.logs.capture",
      "download_attempt",
      "actions/download-workflow-run-attempt-logs",
      objectSchema({
        run_id: int(Number.MAX_SAFE_INTEGER),
        attempt_number: int(10000),
      }),
      128,
    ],
    [
      "github.actions.runs.logs.capture",
      "download_run",
      "actions/download-workflow-run-logs",
      objectSchema({ run_id: int(Number.MAX_SAFE_INTEGER) }),
      128,
    ],
    [
      "github.actions.artifacts.download.capture",
      "download_artifact",
      "actions/download-artifact",
      objectSchema({ artifact_id: int(Number.MAX_SAFE_INTEGER) }),
      129,
    ],
  ] as const
) {
  define(operation, kind, "github", requirement, providerId, "github", input, {
    anyOf: [artifactResult, redirectResult],
  });
}
export const supplementContracts: Readonly<Record<string, Contract>> = Object
  .freeze(
    Object.fromEntries(
      await Promise.all(
        Object.entries(definitions).map(async (
          [id, value],
        ) => [
          id,
          Object.freeze({
            ...value,
            contract_sha256: await argumentDigest(value),
          }),
        ]),
      ),
    ),
  );
