import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";

/** Installed compatibility executors. The live registry remains the catalogue.
 * These fixed requests call the existing application services, never MCP or a
 * caller-selected provider URL. The gateway must enforce registry exposure and
 * verification in addition to the owner check performed here.
 */
type ObjectValue = Record<string, unknown>;
export type LegacyOperationContract = {
  handler: string;
  action?: string;
  rpc?: string;
  authentication: "user" | "service" | "rpc";
  permission_scope:
    | "engineering:read"
    | "engineering:write"
    | "engineering:approve"
    | "engineering:execute"
    | "system:read"
    | "infrastructure:read"
    | "infrastructure:write"
    | "deployment:read"
    | "deployment:write";
  is_mutation: boolean;
  input_schema: ObjectValue;
  output_schema: ObjectValue;
  description: string;
  approved_operation_scope?: boolean;
  fixed?: ObjectValue;
};
const uuidSchema = { type: "string", format: "uuid" };
const text = (maxLength: number, minLength = 1): ObjectValue => ({
  type: "string",
  minLength,
  maxLength,
});
const enumeration = (...values: string[]): ObjectValue => ({
  type: "string",
  enum: values,
});
const objectSchema = (
  properties: ObjectValue = {},
  required: string[] = [],
): ObjectValue => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const jsonObject = { type: "object", maxProperties: 128 };
const stringArray = { type: "array", maxItems: 50, items: text(2000) };
const output = (
  properties: ObjectValue = {},
  required: string[] = [],
): ObjectValue => ({
  type: "object",
  required: ["ok", "contract_version", ...required],
  properties: {
    ok: { const: true },
    contract_version: { const: "1.0.0" },
    ...properties,
  },
  additionalProperties: true,
});
const record = { type: "object" };
const changeInput = (properties: ObjectValue = {}, required: string[] = []) =>
  objectSchema({ change_id: uuidSchema, ...properties }, [
    "change_id",
    ...required,
  ]);
const changeOutput = output({ change: record }, ["change"]);
const jobOutput = output({ job: record }, ["job"]);
const definitions: Record<string, LegacyOperationContract> = {};
function define(
  operation: string,
  handler: string,
  action: string,
  mutation: boolean,
  input: ObjectValue,
  result: ObjectValue,
  description: string,
  extra: Partial<LegacyOperationContract> = {},
) {
  const engineering = handler === "sandy-engineering-control" ||
    handler === "sandy-engineering-test-api";
  definitions[operation] = {
    handler,
    action,
    authentication: engineering ? "user" : "service",
    permission_scope: engineering
      ? mutation ? "engineering:write" : "engineering:read"
      : mutation
      ? "infrastructure:write"
      : "infrastructure:read",
    is_mutation: mutation,
    input_schema: input,
    output_schema: result,
    description: description +
      " Contract v1.0.0; existing backend authorization and provider restrictions remain authoritative.",
    ...extra,
  };
}
const eng = (
  operation: string,
  action: string,
  mutation: boolean,
  input: ObjectValue,
  result: ObjectValue,
  description: string,
) =>
  define(
    operation,
    "sandy-engineering-control",
    action,
    mutation,
    input,
    result,
    description,
  );

eng(
  "engineering.change.register",
  "register",
  true,
  objectSchema({
    title: text(240, 5),
    problem: text(4000, 10),
    expected_behavior: text(4000, 10),
    change_purpose: text(4000, 10),
    feature_improvement: text(4000, 10),
    idempotency_key: text(160),
    risk: enumeration("low", "normal", "high", "critical"),
    scope: stringArray,
    acceptance_criteria: stringArray,
    regression_rules: stringArray,
  }, [
    "title",
    "problem",
    "expected_behavior",
    "change_purpose",
    "feature_improvement",
  ]),
  changeOutput,
  "Register an engineering change; delegated approval remains subject to the backend policy.",
);
eng(
  "engineering.change.status",
  "status",
  true,
  changeInput({
    status: enumeration(
      "approved",
      "cancelled",
      "implementing",
      "committed",
      "deployed",
      "verified",
      "failed",
      "rolled_back",
    ),
    reason: text(1000, 0),
  }, ["status"]),
  changeOutput,
  "Perform an allowed engineering change status transition with its existing owner and evidence gates.",
);
eng(
  "engineering.change.auto_approve",
  "auto_approve",
  true,
  changeInput({
    operation: text(80),
    rollback_plan: text(2000, 25),
    rollback_reference: text(500, 7),
  }, ["operation", "rollback_plan", "rollback_reference"]),
  changeOutput,
  "Apply the existing scoped standing delegation policy; never create a new approval policy.",
);
eng(
  "engineering.change.artifact",
  "artifact",
  true,
  changeInput({
    artifact_type: enumeration(
      "github_commit",
      "github_file",
      "supabase_migration",
      "edge_function",
      "deployment_job",
      "configuration",
      "other",
    ),
    target: text(500),
    before_ref: text(500, 0),
    after_ref: text(500, 0),
    rollback_strategy: enumeration(
      "git_revert",
      "redeploy_prior",
      "forward_migration",
      "manual_review",
    ),
    rollback_notes: text(2000, 0),
    metadata: jsonObject,
  }, ["artifact_type", "target"]),
  output({ artifact: record }, ["artifact"]),
  "Record an artifact and rollback metadata for an approved engineering change.",
);
eng(
  "engineering.change.test",
  "test",
  true,
  changeInput({
    test_name: text(300),
    outcome: enumeration("pending", "passed", "failed", "blocked"),
    evidence: jsonObject,
  }, ["test_name", "outcome"]),
  output({ test: record }, ["test"]),
  "Record caller-supplied test evidence; recording does not itself establish a successful test.",
);
eng(
  "engineering.implementation.request",
  "implementation_request",
  true,
  changeInput({
    provider: enumeration("github", "supabase"),
    operation: text(80),
    target: text(500),
    idempotency_key: text(160),
    payload: jsonObject,
  }, ["provider", "operation", "target", "idempotency_key"]),
  jobOutput,
  "Admit an implementation job through existing registry verification, scope, tests, rollback and delegation checks; admission is not execution.",
);
for (
  const [operation, action] of [["engineering.job.approve", "approve_job"], [
    "engineering.job.auto_approve",
    "auto_approve_job",
  ]]
) {
  eng(
    operation,
    action,
    true,
    changeInput({
      job_id: uuidSchema,
      rollback_plan: text(2000, 0),
      before_ref: text(500, 0),
    }, ["job_id"]),
    jobOutput,
    "Approve an existing job linked to this exact engineering change under the existing backend policy.",
  );
}
eng(
  "engineering.job.execute",
  "execute_job",
  true,
  changeInput({ job_id: uuidSchema }, ["job_id"]),
  output({
    job_id: uuidSchema,
    execution: enumeration(
      "completed",
      "deployed_unverified",
      "dispatched_unverified",
    ),
  }, ["job_id", "execution"]),
  "Invoke the existing approved and scoped engineering job executor; dispatch or deployment acceptance remains unverified.",
);
eng(
  "engineering.video.link_job",
  "link_video_job",
  true,
  changeInput({ job_id: uuidSchema }, ["job_id"]),
  jobOutput,
  "Link only the backend's eligible pending video job to the approved engineering change.",
);
eng(
  "engineering.rollback.request",
  "rollback_request",
  true,
  changeInput({ reason: text(3000, 4) }, ["reason"]),
  output({
    rollback: record,
    execution: { const: "not_started" },
    requires_approval: { const: true },
  }, ["rollback", "execution", "requires_approval"]),
  "Record a rollback request and plan without executing compensation.",
);
eng(
  "engineering.rollback.validate",
  "rollback_validate_smoke",
  false,
  changeInput(),
  output({
    eligible: { type: "boolean" },
    artifact_count: { type: "integer", minimum: 0 },
    execution: { const: "not_started" },
  }, ["eligible", "artifact_count", "execution"]),
  "Read eligibility of the existing isolated smoke rollback; no compensation is performed.",
);
eng(
  "engineering.rollback.prepare",
  "rollback_prepare_revert",
  false,
  changeInput(),
  output({
    eligible: { const: true },
    repository: { const: "ausstyle/web-staging" },
    commit_to_revert: text(64),
    execution: { const: "not_started" },
    approval_required: { const: true },
  }, [
    "eligible",
    "repository",
    "commit_to_revert",
    "execution",
    "approval_required",
  ]),
  "Read a proposed isolated smoke compensation target; no GitHub write or approval is performed.",
);
for (
  const [operation, action] of [
    ["engineering.rollback.approve", "rollback_approve"],
    ["engineering.rollback.create_pr", "rollback_create_revert_pr"],
    ["engineering.rollback.verify", "rollback_verify_revert_pr"],
  ]
) {
  eng(
    operation,
    action,
    true,
    changeInput({ rollback_request_id: uuidSchema }, ["rollback_request_id"]),
    output(),
    "Invoke the existing scoped rollback lifecycle service; verification may persist a terminal state and is therefore a mutation.",
  );
}
define(
  "engineering.models.readiness",
  "sandy-engineering-test-api",
  "readiness",
  false,
  objectSchema(),
  output({
    policy: record,
    routes: { type: "array", maxItems: 200, items: record },
    intelligence_readiness: { type: "array", maxItems: 200, items: record },
    result_limit: { const: 200 },
    possibly_truncated: { type: "boolean" },
  }, [
    "policy",
    "routes",
    "intelligence_readiness",
    "result_limit",
    "possibly_truncated",
  ]),
  "Read model-route and delegation readiness without a model invocation.",
);
define(
  "engineering.models.canary",
  "sandy-engineering-test-api",
  "model_canary",
  true,
  changeInput({
    model_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$" },
    case_key: enumeration(
      "simple_reasoning",
      "research_uncertainty",
      "document_summary",
      "tool_call",
      "routine_email",
    ),
  }, ["model_id", "case_key"]),
  output({ functional_pass: { const: true } }, ["functional_pass"]),
  "Run one bounded existing model canary; consumes provider resources and records audit evidence, so it is a mutation.",
  { approved_operation_scope: true },
);

const deploy = (
  operation: string,
  action: string,
  mutation = false,
  input = objectSchema(),
  result = output(),
  extra: Partial<LegacyOperationContract> = {},
) =>
  define(
    operation,
    "sandy-deployment-api",
    action,
    mutation,
    input,
    result,
    "Invoke the fixed deployment application action " + action + ".",
    extra,
  );
deploy("cloud.video.target_status", "video_target_status");
deploy("deployment.video.provision_policy", "video_provision_policy");
deploy("deployment.management.preflight", "management_preflight");
deploy(
  "deployment.management.deploy_smoke",
  "management_deploy_smoke",
  true,
  changeInput(),
  output({
    notes: { type: "array", items: record },
    cleanup_required: { type: "boolean" },
  }, ["notes", "cleanup_required"]),
  { approved_operation_scope: true },
);
deploy(
  "deployment.management.release.preflight",
  "engineering_release_preflight",
  false,
  objectSchema({
    function_slug: { type: "string", pattern: "^[a-z][a-z0-9-]{2,90}$" },
  }, ["function_slug"]),
);
for (const action of ["ready", "capabilities", "policy", "preflight"]) {
  deploy("deployment.executor." + action, "executor_" + action);
}
deploy("github.write.preflight", "github_write_preflight");
deploy("github.management.verify", "verify_github_management");
deploy("supabase.management.verify", "verify_supabase_management");
deploy(
  "deployment.functions.register",
  "register_deployed_function",
  true,
  changeInput({
    function_slug: { type: "string", pattern: "^[a-z][a-z0-9-]{1,100}$" },
    deployment_verified: { const: true },
  }, ["function_slug", "deployment_verified"]),
  output({ entry: record, registered: { const: true } }, [
    "entry",
    "registered",
  ]),
  { approved_operation_scope: true },
);
deploy(
  "deployment.jobs.approve_read",
  "approve_read",
  true,
  objectSchema({ job_id: uuidSchema }, ["job_id"]),
  output({ approved: { const: true } }, ["approved"]),
  { permission_scope: "deployment:write" },
);
deploy(
  "deployment.jobs.execute",
  "execute",
  true,
  objectSchema({ job_id: uuidSchema }, ["job_id"]),
  output(),
  { permission_scope: "deployment:write" },
);
deploy(
  "github.job.reconcile",
  "execute",
  true,
  objectSchema({ job_id: uuidSchema }, ["job_id"]),
  output(),
  { permission_scope: "deployment:write", fixed: { reconcile_external: true } },
);

const provision = (
  operation: string,
  action: string,
  mutation = false,
  input = objectSchema(),
) =>
  define(
    operation,
    "sandy-deploy-provision",
    action,
    mutation,
    input,
    output(),
    "Invoke the existing fixed-project provision action " + action + ".",
    mutation ? { approved_operation_scope: true } : {},
  );
for (
  const [operation, action] of [
    ["google_cloud.vm.status", "linux_status"],
    ["google_cloud.vm.bootstrap_status", "vm_metadata_status"],
    ["google_cloud.vm.service_status", "vm_service_status"],
    ["google_cloud.vm.bootstrap_probe", "vm_bootstrap_probe"],
    ["google_cloud.cloud_run.status", "cloud_run_status"],
    ["google_cloud.cloud_run.permissions", "cloud_run_permissions"],
    ["google_cloud.iam.project_policy_read", "iam_project_policy_read"],
    ["google_cloud.mcp.build_permissions", "mcp_build_permissions"],
    ["google_cloud.mcp.build_preflight", "mcp_build_preflight"],
    ["google_cloud.mcp.endpoint_probe", "mcp_endpoint_probe"],
    ["video.ssh.preflight", "video_ssh_preflight"],
    ["video.osconfig.permissions", "video_osconfig_permissions"],
    ["video.osconfig.agent_status", "video_osconfig_agent_status"],
    ["video.osconfig.policy_preflight", "video_osconfig_policy_preflight"],
    ["video.osconfig.access", "video_osconfig_access"],
    ["video.network.preflight", "video_network_preflight"],
  ]
) provision(operation, action);
provision(
  "google_cloud.mcp.build_status",
  "mcp_build_status",
  false,
  changeInput({
    build_id: { type: "string", pattern: "^[A-Za-z0-9-]{12,80}$" },
  }, ["build_id"]),
);
for (
  const [operation, action] of [
    ["google_cloud.iam.runtime_create", "runtime_service_account_create"],
    ["google_cloud.iam.runtime_prepare", "runtime_service_account_prepare"],
    ["google_cloud.iam.grant_deployment", "iam_deployment_grant"],
    ["google_cloud.mcp.build_bootstrap", "mcp_build_bootstrap"],
    ["google_cloud.mcp.builder_project_grant", "mcp_builder_project_grant"],
    ["google_cloud.mcp.registry_writer_grant", "mcp_registry_writer_grant"],
    ["google_cloud.mcp.release_temp_iam", "mcp_release_temp_iam"],
    ["google_cloud.mcp.public_ingress", "mcp_public_ingress"],
    ["google_cloud.mcp.cloud_run_deploy", "mcp_cloud_run_deploy"],
    ["google_cloud.mcp.container_build", "mcp_container_build"],
    ["video.ssh.iam_grant", "video_ssh_iam_grant"],
    ["video.osconfig.enable", "video_enable_osconfig"],
    ["video.osconfig.vm_prepare", "video_vm_osconfig_prepare"],
  ]
) provision(operation, action, true, changeInput());

definitions["cloud.targets.list"] = {
  handler: "sandy-operation-api",
  rpc: "sandy_api_legacy_cloud_targets",
  authentication: "rpc",
  permission_scope: "infrastructure:read",
  is_mutation: false,
  input_schema: objectSchema(),
  output_schema: output({
    targets: { type: "array", maxItems: 200, items: record },
    result_limit: { const: 200 },
    possibly_truncated: { type: "boolean" },
  }, ["targets", "result_limit", "possibly_truncated"]),
  description:
    "Read up to 200 registered cloud targets with explicit truncation; owner-only contract v1.0.0.",
};
definitions["deployment.jobs.status"] = {
  handler: "sandy-operation-api",
  rpc: "sandy_api_legacy_deployment_status",
  authentication: "rpc",
  permission_scope: "deployment:read",
  is_mutation: false,
  input_schema: objectSchema({ job_id: uuidSchema }, ["job_id"]),
  output_schema: jobOutput,
  description:
    "Read one deployment job plus separately identified external deployment evidence; never claim worker completion from an external observation; contract v1.0.0.",
};

// Typed stable response fields, while provider-specific optional metadata remains
// extensible. New fields cannot make a missing or failed stable result successful.
const strings = { type: "array", items: { type: "string" } };
const boolean = { type: "boolean" };
const integer = { type: "integer" };
const nullableObject = { type: ["object", "null"] };
const nullableString = { type: ["string", "null"] };
const resultContracts: Record<string, [ObjectValue, string[]]> = {
  "deployment.video.provision_policy": [{
    target: record,
    operation: { const: "create_vm" },
    allowed_machine_types: strings,
    approval_required: { const: true },
    execution_enabled: { const: false },
    existing_sip_protected: { const: true },
  }, [
    "target",
    "operation",
    "allowed_machine_types",
    "approval_required",
    "execution_enabled",
    "existing_sip_protected",
  ]],
  "cloud.video.target_status": [{
    target: record,
    provisioning: text(80),
    provisioning_job_id: { type: ["string", "null"], format: "uuid" },
    livekit_status: { const: "not_verified" },
    service_operational: { const: false },
  }, [
    "target",
    "provisioning",
    "provisioning_job_id",
    "livekit_status",
    "service_operational",
  ]],
  "deployment.management.preflight": [{
    providers: record,
    production_ready: { const: false },
    smoke_deployment_and_cleanup_verified: boolean,
    full_supabase_executor_ready: { const: false },
    general_rollback_executor_ready: { const: false },
  }, [
    "providers",
    "production_ready",
    "smoke_deployment_and_cleanup_verified",
    "full_supabase_executor_ready",
    "general_rollback_executor_ready",
  ]],
  "deployment.management.release.preflight": [{
    source: record,
    production: record,
    execution: { const: "read_only_preflight" },
    release_ready: boolean,
  }, ["source", "production", "execution", "release_ready"]],
  "deployment.executor.ready": [{
    configured: record,
    execution_enabled: { const: false },
  }, ["configured", "execution_enabled"]],
  "deployment.executor.capabilities": [{
    google_cloud_read: boolean,
    supabase_write: boolean,
    github_update_file_implemented: boolean,
    github_push_files_implemented: boolean,
    github_write_live_tested: boolean,
    executor_ready: boolean,
    management_credentials: record,
  }, [
    "google_cloud_read",
    "supabase_write",
    "github_update_file_implemented",
    "github_push_files_implemented",
    "github_write_live_tested",
    "executor_ready",
    "management_credentials",
  ]],
  "deployment.executor.policy": [{
    production_writes_enabled: { const: false },
    require_approval: { const: true },
    require_idempotency: { const: true },
    require_verification: { const: true },
    rollback_required: { const: true },
  }, [
    "production_writes_enabled",
    "require_approval",
    "require_idempotency",
    "require_verification",
    "rollback_required",
  ]],
  "deployment.executor.preflight": [{
    github_credential_present: boolean,
    supabase_credential_present: boolean,
    github_write_ready: { const: false },
    supabase_write_ready: { const: false },
  }, [
    "github_credential_present",
    "supabase_credential_present",
    "github_write_ready",
    "supabase_write_ready",
  ]],
  "github.write.preflight": [{
    github_http: integer,
    repository: { const: "ausstyle/web-staging" },
    permissions: nullableObject,
    write_capable: boolean,
    credential_present: { const: true },
  }, [
    "github_http",
    "repository",
    "permissions",
    "write_capable",
    "credential_present",
  ]],
  "github.management.verify": [{
    configured: boolean,
    verification: { const: "credential_presence_only" },
  }, ["configured", "verification"]],
  "supabase.management.verify": [{
    configured: { const: true },
    http_status: integer,
    function_count: { type: ["integer", "null"] },
  }, ["configured", "http_status", "function_count"]],
  "google_cloud.vm.status": [{
    exists: boolean,
    name: { const: "sandy-deploy" },
    zone: text(80),
    status: text(80),
    machine_type: text(300),
    instance_id: text(80),
    network: { type: "array", items: record },
  }, ["exists", "name", "zone"]],
  "google_cloud.vm.bootstrap_status": [{
    status: text(80),
    metadata_keys: strings,
    http: integer,
  }, ["status", "metadata_keys", "http"]],
  "google_cloud.vm.service_status": [{
    google_http: integer,
    guest_attributes: nullableObject,
    verified_running: { const: false },
  }, ["google_http", "guest_attributes", "verified_running"]],
  "google_cloud.vm.bootstrap_probe": [{
    vm_status: text(80),
    startup_script_staged: boolean,
    guest_attributes_enabled: boolean,
    worker_installed: { const: false },
  }, [
    "vm_status",
    "startup_script_staged",
    "guest_attributes_enabled",
    "worker_installed",
  ]],
  "google_cloud.cloud_run.status": [{
    service_exists: boolean,
    name: text(300),
    uri: nullableString,
    conditions: { type: "array", items: record },
    latest_ready_revision: nullableString,
  }, ["service_exists"]],
  "google_cloud.cloud_run.permissions": [{
    project: text(120),
    granted: strings,
    missing: strings,
  }, ["project", "granted", "missing"]],
  "google_cloud.iam.project_policy_read": [{
    project: text(120),
    subject: text(200),
    required_roles: strings,
    granted_roles: strings,
    missing_roles: strings,
    policy_etag_present: boolean,
  }, [
    "project",
    "subject",
    "required_roles",
    "granted_roles",
    "missing_roles",
    "policy_etag_present",
  ]],
  "google_cloud.mcp.build_permissions": [
    { granted: strings, missing: strings },
    ["granted", "missing"],
  ],
  "google_cloud.mcp.build_preflight": [{
    project: text(120),
    region: text(80),
    checks: { type: "array", items: record },
  }, ["project", "region", "checks"]],
  "google_cloud.mcp.build_status": [{
    http_status: integer,
    id: text(120),
    status: nullableString,
    images: strings,
    log_url: nullableString,
    steps: { type: "array", maxItems: 6, items: record },
  }, ["http_status", "id", "status", "images", "log_url", "steps"]],
  "google_cloud.mcp.endpoint_probe": [{
    checks: { type: "array", items: record },
    cloud_run_iam_permissions: strings,
    iam_probe_http: integer,
  }, ["checks", "cloud_run_iam_permissions", "iam_probe_http"]],
  "video.osconfig.permissions": [{
    http_status: integer,
    granted: strings,
    missing: strings,
  }, ["http_status", "granted", "missing"]],
  "video.osconfig.access": [{ granted: strings, missing: strings }, [
    "granted",
    "missing",
  ]],
  "video.osconfig.agent_status": [{
    http_status: integer,
    inventory_available: boolean,
    os_info: nullableObject,
    error_status: nullableString,
    error_message: { type: "string" },
  }, [
    "http_status",
    "inventory_available",
    "os_info",
    "error_status",
    "error_message",
  ]],
  "video.osconfig.policy_preflight": [{
    http_status: integer,
    assignments: strings,
    error_status: nullableString,
    error_message: { type: "string" },
  }, ["http_status", "assignments", "error_status", "error_message"]],
};
for (
  const [operation, [properties, required]] of Object.entries(resultContracts)
) definitions[operation].output_schema = output(properties, required);
// Preserve the existing stronger approval/execution scopes. Verification of a
// rollback can persist completion and must not retain its historical read label.
for (
  const operation of [
    "engineering.change.auto_approve",
    "engineering.job.approve",
    "engineering.job.auto_approve",
    "engineering.rollback.approve",
  ]
) definitions[operation].permission_scope = "engineering:approve";
for (
  const operation of [
    "engineering.job.execute",
    "engineering.rollback.create_pr",
    "engineering.rollback.verify",
  ]
) definitions[operation].permission_scope = "engineering:execute";
definitions["cloud.video.target_status"].permission_scope = "system:read";

export const legacyOperationContracts: Readonly<
  Record<string, LegacyOperationContract>
> = Object.freeze(definitions);
export function isLegacyOperation(operation: unknown): boolean {
  return typeof operation === "string" &&
    Object.hasOwn(legacyOperationContracts, operation);
}
export const requiresLegacyUserJWT = (operation: string) =>
  legacyOperationContracts[operation]?.authentication === "user";
const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const inputs = new Map(
  Object.entries(definitions).map((
    [name, contract],
  ) => [name, ajv.compile(contract.input_schema)]),
);
const outputs = new Map(
  Object.entries(definitions).map((
    [name, contract],
  ) => [name, ajv.compile(contract.output_schema)]),
);
const object = (v: unknown): v is ObjectValue =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const sameId = (a: unknown, b: unknown) =>
  uuid(a) && uuid(b) && a.toLowerCase() === b.toLowerCase();
const reply = (status: number, data: ObjectValue) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
export type LegacyOperationDependencies = {
  base: string;
  anon: string;
  service: string;
  principal: { id: string; role: string; enabled: boolean };
  rpc: (
    name: string,
    args: ObjectValue,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  fetch?: typeof fetch;
};

function argumentValid(
  operation: string,
  arguments_: unknown,
): arguments_ is ObjectValue {
  return isLegacyOperation(operation) && object(arguments_) &&
    JSON.stringify(arguments_).length <= 20000 &&
    inputs.get(operation)?.(arguments_) === true;
}
export function legacyContractMatches(operation: string, entry: ObjectValue) {
  const c = legacyOperationContracts[operation];
  return !!c && entry.handler === c.handler &&
    entry.is_mutation === c.is_mutation &&
    entry.permission_scope === c.permission_scope;
}

export function buildLegacyOperationRequest(
  dependencies: LegacyOperationDependencies,
  userToken: string,
  operation: string,
  arguments_: unknown,
): { url: string; init: RequestInit } | null {
  if (!argumentValid(operation, arguments_)) return null;
  const c = legacyOperationContracts[operation];
  if (c.authentication === "rpc") return null;
  let base: URL;
  try {
    base = new URL(dependencies.base);
  } catch {
    return null;
  }
  if (
    base.protocol !== "https:" || base.username || base.password ||
    base.pathname !== "/" || base.search || base.hash
  ) return null;
  const token = c.authentication === "user" ? userToken : dependencies.service;
  if (
    !token || !/^[A-Za-z0-9._~-]+$/.test(token) ||
    (c.authentication === "user" &&
      [dependencies.service, dependencies.anon].includes(token))
  ) return null;
  return {
    url: base.origin + "/functions/v1/" + c.handler,
    init: {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(c.is_mutation ? 55000 : 35000),
      headers: {
        authorization: `Bearer ${token}`,
        apikey: c.authentication === "user"
          ? dependencies.anon
          : dependencies.service,
        "content-type": "application/json",
      },
      // A fixed action and fixed reconciliation marker are written last.
      body: JSON.stringify({ ...arguments_, ...c.fixed, action: c.action }),
    },
  };
}

const sensitiveKey =
  /authorization|cookie|password|private.?key|access.?token|refresh.?token|api.?key|credential.?value|secret.?value|(?:^|_)(?:token|secret|credentials)(?:_|$)/i;
function scrub(value: unknown, credentials: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, credentials));
  }
  if (object(value)) {
    return Object.fromEntries(
      Object.entries(value).map((
        [key, item],
      ) => [
        key,
        sensitiveKey.test(key) && typeof item !== "boolean" &&
          !(object(item) &&
            Object.values(item).every((v) => typeof v === "boolean"))
          ? "[REDACTED]"
          : scrub(item, credentials),
      ]),
    );
  }
  if (typeof value === "string") {
    let clean = value.replace(
      /Bearer\s+[A-Za-z0-9._~-]+/gi,
      "Bearer [REDACTED]",
    );
    for (const credential of credentials) {
      if (credential) clean = clean.replaceAll(credential, "[REDACTED]");
    }
    return clean;
  }
  return value;
}
/** Preserve bounded provider diagnostics without exposing credential bodies. */
function upstreamError(value: unknown, credentials: string[]): ObjectValue {
  if (!object(value)) return {};
  const result: ObjectValue = {};
  for (
    const key of [
      "error",
      "error_status",
      "error_message",
      "message",
      "google_http",
      "http_status",
      "google_error_status",
      "google_error_message",
      "osconfig_http",
    ]
  ) {
    const field = value[key];
    if (
      typeof field === "number" && Number.isInteger(field) && field >= 100 &&
      field <= 599
    ) {
      result[key] = field;
      continue;
    }
    if (typeof field !== "string") continue;
    let text = String(scrub(field, credentials));
    text = text.replace(/eyJ[A-Za-z0-9._-]{15,}/g, "[REDACTED]").replace(
      /(?:ya29\.|gh[pousr]_|sk-)[A-Za-z0-9._-]{8,}/g,
      "[REDACTED]",
    ).replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, "[REDACTED]")
      .replace(
        /((?:access_token|refresh_token|api_key|apikey|token)=)[^&\s]+/gi,
        "$1[REDACTED]",
      );
    result[key] = text.slice(0, 700);
  }
  return result;
}
function scopedRecord(
  value: unknown,
  args: ObjectValue,
  idField: string,
  changeField = "change_id",
) {
  return object(value) && uuid(value.id) &&
    (!args[idField] || sameId(value.id, args[idField])) &&
    (!value[changeField] || sameId(value[changeField], args.change_id));
}
function successShape(
  operation: string,
  arguments_: ObjectValue,
  payload: ObjectValue,
  actorId: string,
): boolean {
  if (operation === "engineering.change.register") {
    return scopedRecord(payload.change, arguments_, "none") &&
      object(payload.change) && sameId(payload.change.requested_by, actorId);
  }
  if (
    ["engineering.change.status", "engineering.change.auto_approve"].includes(
      operation,
    )
  ) return scopedRecord(payload.change, arguments_, "change_id");
  if (operation === "engineering.change.artifact") {
    return scopedRecord(payload.artifact, arguments_, "none") &&
      object(payload.artifact) &&
      sameId(payload.artifact.change_id, arguments_.change_id);
  }
  if (operation === "engineering.change.test") {
    return scopedRecord(payload.test, arguments_, "none") &&
      object(payload.test) &&
      sameId(payload.test.change_id, arguments_.change_id);
  }
  if (
    [
      "engineering.implementation.request",
      "engineering.job.approve",
      "engineering.video.link_job",
    ].includes(operation)
  ) {
    return scopedRecord(
      payload.job,
      arguments_,
      "job_id",
      "engineering_change_id",
    ) && object(payload.job) &&
      sameId(payload.job.engineering_change_id, arguments_.change_id);
  }
  if (operation === "engineering.job.auto_approve") {
    return scopedRecord(
      payload.job,
      arguments_,
      "job_id",
      "engineering_change_id",
    );
  }
  if (operation === "engineering.job.execute") {
    return sameId(payload.job_id, arguments_.job_id) &&
      ["completed", "deployed_unverified", "dispatched_unverified"].includes(
        String(payload.execution),
      );
  }
  if (operation === "engineering.rollback.request") {
    return scopedRecord(payload.rollback, arguments_, "rollback_request_id") &&
      object(payload.rollback) &&
      sameId(payload.rollback.change_id, arguments_.change_id) &&
      payload.execution === "not_started";
  }
  if (operation === "engineering.rollback.approve") {
    return payload.ok === true &&
      scopedRecord(payload.rollback, arguments_, "rollback_request_id");
  }
  if (operation === "engineering.rollback.create_pr") {
    return payload.ok === true &&
      sameId(payload.rollback_request_id, arguments_.rollback_request_id) &&
      Number.isInteger(payload.pr_number) &&
      payload.verified_rolled_back === false;
  }
  if (operation === "engineering.rollback.verify") {
    return payload.ok === true && typeof payload.completed === "boolean" &&
      (payload.completed === false ||
        sameId(payload.rollback_request_id, arguments_.rollback_request_id));
  }
  if (operation === "engineering.models.readiness") {
    return object(payload.policy) && Array.isArray(payload.routes) &&
      payload.routes.every(object) &&
      Array.isArray(payload.intelligence_readiness) &&
      payload.intelligence_readiness.every(object);
  }
  if (operation === "engineering.models.canary") {
    return payload.functional_pass === true &&
      payload.model_id === arguments_.model_id &&
      payload.case_key === arguments_.case_key;
  }
  if (operation === "deployment.jobs.status") {
    return scopedRecord(payload.job, arguments_, "job_id");
  }
  return payload.ok === true;
}

export async function executeLegacyOperation(
  dependencies: LegacyOperationDependencies,
  userToken: string,
  operation: string,
  arguments_: unknown,
): Promise<Response> {
  const { principal } = dependencies;
  if (
    !uuid(principal.id) || principal.enabled !== true ||
    principal.role !== "owner"
  ) return reply(403, { ok: false, error: "owner_required", executed: false });
  if (!argumentValid(operation, arguments_)) {
    return reply(400, {
      ok: false,
      error: "invalid_operation_arguments",
      executed: false,
    });
  }
  const c = legacyOperationContracts[operation];
  if (c.approved_operation_scope) {
    let assertion: { data: unknown; error: unknown };
    try {
      assertion = await dependencies.rpc("sandy_api_legacy_operation_scope", {
        p_actor_id: principal.id,
        p_change_id: arguments_.change_id,
        p_operation: operation,
      });
    } catch {
      return reply(503, {
        ok: false,
        error: "approved_operation_scope_unavailable",
        executed: false,
      });
    }
    if (assertion.error) {
      return reply(503, {
        ok: false,
        error: "approved_operation_scope_unavailable",
        executed: false,
      });
    }
    if (assertion.data !== true) {
      return reply(403, {
        ok: false,
        error: "approved_operation_scope_required",
        executed: false,
      });
    }
  }
  let status: number;
  let payload: unknown;
  try {
    if (c.authentication === "rpc") {
      const response = await dependencies.rpc(c.rpc!, {
        p_actor_id: principal.id,
        ...(operation === "deployment.jobs.status"
          ? { p_job_id: arguments_.job_id }
          : {}),
      });
      if (response.error) {
        return reply(503, {
          ok: false,
          error: "legacy_read_unavailable",
          executed: null,
        });
      }
      payload = response.data;
      status = object(payload) && Number.isInteger(payload.http_status)
        ? Number(payload.http_status)
        : 200;
    } else {
      const request = buildLegacyOperationRequest(
        dependencies,
        userToken,
        operation,
        arguments_,
      );
      if (!request) {
        return reply(503, {
          ok: false,
          error: "legacy_handler_configuration_invalid",
          executed: false,
        });
      }
      const response = await (dependencies.fetch ?? fetch)(
        request.url,
        request.init,
      );
      status = response.status;
      try {
        payload = await response.json();
      } catch {
        return reply(502, {
          ok: false,
          error: "legacy_backend_invalid_json",
          executed: true,
          reconciliation_required: c.is_mutation,
        });
      }
    }
  } catch {
    return reply(502, {
      ok: false,
      error: "legacy_backend_outcome_unknown",
      executed: null,
      reconciliation_required: c.is_mutation,
    });
  }
  if (
    status < 200 || status >= 300 || !object(payload) || payload.ok === false ||
    payload.error != null
  ) {
    return reply(status >= 400 && status <= 599 ? status : 502, {
      ok: false,
      error: "legacy_backend_rejected",
      upstream_status: status,
      upstream_error: upstreamError(payload, [
        dependencies.service,
        dependencies.anon,
        userToken,
      ]),
      executed: true,
      reconciliation_required: c.is_mutation && status >= 500,
    });
  }
  if (
    operation === "engineering.models.canary" &&
    payload.functional_pass === false &&
    payload.model_id === arguments_.model_id &&
    payload.case_key === arguments_.case_key
  ) {
    return reply(422, {
      ok: false,
      error: "model_canary_failed",
      functional_pass: false,
      executed: true,
      model_id: arguments_.model_id,
      case_key: arguments_.case_key,
      provider_http_status: Number.isInteger(payload.provider_http_status)
        ? payload.provider_http_status
        : null,
      ...(uuid(payload.test_id) ? { test_id: payload.test_id } : {}),
    });
  }
  if (!successShape(operation, arguments_, payload, principal.id)) {
    return reply(502, {
      ok: false,
      error: "legacy_backend_invalid_or_unscoped_response",
      executed: true,
      reconciliation_required: c.is_mutation,
    });
  }
  if (operation === "engineering.models.readiness") {
    const routes = payload.routes as unknown[];
    const intelligence = payload.intelligence_readiness as unknown[];
    payload = {
      ...payload,
      routes: routes.slice(0, 200),
      intelligence_readiness: intelligence.slice(0, 200),
      result_limit: 200,
      possibly_truncated: routes.length > 200 || intelligence.length > 200,
    };
  }
  const normalized = {
    ...(scrub(payload, [
      dependencies.service,
      dependencies.anon,
      userToken,
    ]) as ObjectValue),
    ok: true,
    contract_version: "1.0.0",
  };
  if (outputs.get(operation)?.(normalized) !== true) {
    return reply(502, {
      ok: false,
      error: "legacy_backend_output_contract_mismatch",
      executed: true,
      reconciliation_required: c.is_mutation,
    });
  }
  return reply(status, normalized);
}
