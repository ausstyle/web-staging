/** Deterministic descriptors over shared existing deployment and atomic batch executors. */
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  array,
  b64,
  digest,
  name,
  objectSchema as object,
  str,
  supplementContracts,
} from "../sandy-provider-supplement-api/contracts.ts";
import schemaSource from "./github_batch_schema.source.json" with {
  type: "json",
};
const deploy = structuredClone(
  supplementContracts["supabase.functions.deploy.multipart"],
) as Record<string, any>;
delete deploy.contract_sha256;
deploy.operation = "supabase.deploy_edge_function";
deploy.canonical_target = "supabase.functions.deploy.multipart";
deploy.handler = "sandy-legacy-compatibility-api";
deploy.permission_scope = "infrastructure:deploy";
deploy.maximum_input_bytes = 1550000;
deploy.input_schema.properties.project_id = { const: "zmqlyygzqoidkcwdysok" };
deploy.input_schema.properties.artifact_ref = digest;
deploy.input_schema.properties.name = name;
deploy.input_schema.required.push("project_id", "artifact_ref", "name");
deploy.output_schema.properties.operation = { const: deploy.operation };
const result = object({
  repository: { const: "ausstyle/web-staging" },
  branch: str(200),
  previous_head_oid: { ...str(40), pattern: "^[a-f0-9]{40}$" },
  commit_oid: { ...str(40), pattern: "^[a-f0-9]{40}$" },
  tree_oid: { ...str(40), pattern: "^[a-f0-9]{40}$" },
  files_changed: { type: "integer", minimum: 1, maximum: 32 },
  native_precondition: { const: "expectedHeadOid" },
  branch_head_observed_match: { const: true },
  transfer_state: { const: "accepted" },
  effect_confirmed: { const: false },
});
const push: Record<string, any> = {
  operation: "github.push_files",
  canonical_target: "GitHub.GraphQL.createCommitOnBranch",
  handler: "sandy-legacy-compatibility-api",
  kind: "github_push_files",
  provider: "github",
  requirement: 115,
  provider_operation_id: "Mutation.createCommitOnBranch",
  source: schemaSource.source_url,
  source_sha256: schemaSource.source_sha256,
  is_mutation: true,
  permission_scope: "engineering:write",
  requires_approval: true,
  api_key_delegable: false,
  maximum_input_bytes: 1550000,
  input_schema: object({
    repository: { const: "ausstyle/web-staging" },
    branch: { ...str(200), pattern: "^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$" },
    expected_head_oid: { ...str(40), pattern: "^[a-f0-9]{40}$" },
    headline: str(200),
    message_body: str(10000, 0),
    files: {
      ...array(
        object({
          path: {
            ...str(240),
            pattern: "^[A-Za-z0-9_.@+-]+(?:/[A-Za-z0-9_.@+-]+)*$",
          },
          content_base64: { ...b64, maxLength: 87384 },
          sha256: digest,
        }),
        32,
      ),
      minItems: 1,
    },
    files_sha256: digest,
  }, [
    "repository",
    "branch",
    "expected_head_oid",
    "headline",
    "files",
    "files_sha256",
  ]),
  output_schema: object({
    ok: { const: true },
    operation: { const: "github.push_files" },
    contract_version: { const: "1.0.0" },
    provider: { const: "github" },
    request_state: { const: "accepted" },
    executed: { const: true },
    admission_id: { type: "string", format: "uuid" },
    provider_http_status: { type: "integer", minimum: 200, maximum: 299 },
    provider_request_id: { anyOf: [str(200), { type: "null" }] },
    result,
  }),
};
const operations = [];
for (const value of [deploy, push]) {
  Object.assign(value, {
    requires_grant: true,
    requires_real_user_session: true,
    owner_only: true,
    api_exposed: false,
  });
  operations.push({ ...value, contract_sha256: await argumentDigest(value) });
}
await Deno.writeTextFile(
  new URL("./workflow_contracts.json", import.meta.url),
  JSON.stringify(operations, null, 2) + "\n",
);
console.log(JSON.stringify({ operations: operations.length }));
