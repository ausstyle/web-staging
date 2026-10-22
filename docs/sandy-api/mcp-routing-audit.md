# MCP routing audit

Read-only production source and registry review, 2026-10-20. No provider operation,
job, deployment, user session or registry update was performed by this review.
Metadata and source retrieval used the Supabase Management API. This is source
evidence, not an authenticated end-to-end execution attestation.

## Current routing

`sandy-api-mcp` v3 delegates discovery and execution exclusively to
`sandy-operation-api` v7. The API authenticates the real user, checks enabled
Controller membership or independent customer access, validates registry schemas,
and chooses an installed handler. MCP execution supplies `channel: "mcp"`; the
API checks `ai_exposed` again. MCP discovery keeps only executable API entries
with both exposure flags and returns the caller-specific catalogue hash.

Universal routing is incomplete. Two additional transports still bypass this
gateway:

- `sandy-operations-mcp` v70 authenticates one fixed owner identity with Supabase
  `getUser`. It holds a service client, hardcodes its catalogue, invokes several
  handlers directly with service credentials, and writes jobs/events itself.
- `services/sandy-engineering-mcp/src/server.mjs` v0.1.0 authenticates against
  `sandy-engineering-test-api`, hardcodes five tools, then calls that handler,
  Engineering Control or the legacy MCP directly.

The legacy Edge MCP is a private owner operations transport. It includes customer
operations among its branches, but its top-level owner check prevents ordinary
tenant sessions from reaching those branches. The separate customer
`sandy-operations-api` v6 accepts scoped integration keys or real customer sessions
and scopes resources to the customer access directory. Do not remove that API or
broaden the legacy owner transport while migrating MCP.

The deployed v70 and customer API v6 bundles exactly matched the archived source
retrieved earlier in this task. Bundle SHA-256 values were respectively
`d88b7aa41784e0feea3faa6f649155c51af52c04a349cc2791254bd870f659ce` and
`968cc34bf0fea6e6221f25c62665cd9c06703f8cb1c4f7564b6f329c5a9549b8`.
The deployed provision handler v52 also matched its archive. Source archives and
selected registry readbacks remain outside the repository under
`/workspace/sandy-api-deliverables/` because those archives contain unrelated
production code. This document contains no credentials or user data.

## Legacy tool contracts

These are transport aliases; they are not themselves authoritative registry
operation names. All 16 are advertised statically by v70. `user` below means the
actual owner's supplied session; `internal` means the function's service identity.

| Legacy tool | Current destination and body/query | Canonical migration requirement |
| --- | --- | --- |
| `operations_list` | Internal SELECT registry metadata, optional domain and limit; also reads function catalogue | Translate API capability discovery; retain distinction between registered and executable metadata |
| `operations_describe` | Internal SELECT registry row by operation | API describe, with authorized metadata visibility |
| `operations_status` | Internal SELECT deployment job by `job_id` | `deployment.jobs.get`; preserve legacy selected fields |
| `operations_execute` | Branches below dispatch handlers, Cloud Run MCP or direct job inserts | Resolve registered operation, invoke API with `channel: "mcp"`; no executor in adapter |
| `deployment_status` | Internal SELECT job plus last `external_deployment_observed` event for Supabase deployment | Preserve reconciliation fields through a centralized API read contract |
| `cloud_vm_status` | Internal provision `{action:"linux_status"}` | Register/install fixed-target read handler, then alias to API |
| `cloud_run_status` | Internal provision `{action:"cloud_run_status"}` | Register/install fixed-service read handler, then alias to API |
| `deployment_approve_read` | Internal deployment API `{action:"approve_read",job_id}` | Central approval policy operation; retain existing approval gates |
| `deployment_execute` | Internal deployment API `{action:"execute",job_id}` | Central job execution operation; retain approved/read-only provider restrictions |
| `vm_bootstrap_status` | Internal provision `{action:"vm_metadata_status"}` | Register/install fixed-target read handler, then alias to API |
| `vm_service_status` | Internal provision `{action:"vm_service_status"}` | Register/install fixed-target read handler, then alias to API |
| `vm_install_worker` | Internal idempotency lookup, INSERT pending `google_cloud/install_worker/sandy-deploy` job and requested event | Central durable request contract; response must remain queued, not executed |
| `cloud_targets` | Internal SELECT target name/project/zone/protection/purpose | Owner-only registered target catalogue API operation |
| `engineering_change_register` | User Engineering Control `{...documented_fields,action:"register"}` | Central register contract with existing documentation/idempotency validation |
| `engineering_change_approve` | User Engineering Control `{action:"status",change_id,status:"approved",reason}` | Central approval contract, actual caller retained |
| `deployment_request` | Provider/operation validation; Engineering Control special cases or implementation request; otherwise internal INSERT pending job/event | Central request service with transaction, idempotency and identical target/approval checks |

Existing status reads are installed in canonical API but their registry rows have
`ai_exposed=false`. A compatibility adapter must not override that flag to expose
them. The old transport's unfiltered visibility is not evidence of permission to
change the canonical policy.

### `operations_execute` destinations

| Branch | Current execution | Registry/canonical state observed |
| --- | --- | --- |
| `tasks.*`, `calendar.*`, `files.*` | User `sandy-operations-api` `{operation,arguments}` after handler/exposure lookup | 18 existing backend handlers; canonical API installs 8 reads. Ten mutations remain unverified and outside its installed map |
| `memory.overview/search/ask/tree/evidence/biography/life_brief/life_spaces/life_search` | User `sandy-memory-centre?op=<mapped_action>` with arguments body after handler/exposure lookup | Nine legacy read-labelled rows exposed, all unverified; canonical API v7 installs five passive reads. Four model/task actions remain excluded. `memory.tree` maps to `memory_tree` |
| `engineering.*` | User Engineering Control `{action:<mapped_action>,...arguments}` | Most existing rows exposed but unverified; canonical API v7 installs `engineering.preflight`, `engineering.change.get`, `engineering.change.list` and `engineering.job.status`; the other direct branches remain |
| `video.status`, `video.install.preflight`, `video.execution.preflight` | Internal provision fixed actions below | Three existing verified registry rows; canonical fixed read maps deployed in API v7. Legacy MCP still bypasses API |
| `cloud.video.target_status` | Internal deployment API `{action:"video_target_status"}` | Exposed, unverified, missing canonical map |
| `github.repository.update`, `supabase.function.deploy`, `supabase.migration.apply` | Validate approved engineering change; internal idempotency lookup and pending job/event inserts | These exact aliases have no registry rows; no canonical map |
| `google_cloud.mcp.tool_call`, `.model_canary_e2e`, `.readiness_e2e`, `.authenticated_discovery` | Direct user HTTP calls to existing Cloud Run MCP endpoint | Exact aliases have no registry rows; no canonical map. Centralize the underlying operations without an API-to-MCP execution loop |
| Remaining fixed deployment/provision aliases | Internal direct handler calls listed below | Exact aliases have no registry rows; no canonical map |

The Engineering Control map has 20 entries:
`engineering.change.register→register`, `change.get→get`, `change.list→list`,
`preflight→preflight`, `change.status→status`, `change.auto_approve→auto_approve`,
`change.artifact→artifact`, `change.test→test`,
`implementation.request→implementation_request`, `job.status→job_status`,
`job.approve→approve_job`, `job.auto_approve→auto_approve_job`,
`job.execute→execute_job`, `video.link_job→link_video_job`,
`rollback.request→rollback_request`, `rollback.validate→rollback_validate_smoke`,
`rollback.prepare→rollback_prepare_revert`, `rollback.approve→rollback_approve`,
`rollback.create_pr→rollback_create_revert_pr`,
`rollback.verify→rollback_verify_revert_pr` (all identifiers have the
`engineering.` prefix). The argument spread follows `action` in v70; a central
fixed-action service must reject action overrides instead of copying that pattern.

Additional exact aliases absent from the registry:

- `github.job.reconcile` → deployment `execute` with `reconcile_external:true`.
- `deployment.management.deploy_smoke/preflight` → deployment
  `management_deploy_smoke/management_preflight`.
- `deployment.executor.ready/capabilities` → deployment
  `executor_ready/executor_capabilities`.
- `github.management.verify`, `supabase.management.verify` → deployment
  `verify_github_management/verify_supabase_management`.
- `google_cloud.vm.status/bootstrap_probe` → provision
  `linux_status/vm_bootstrap_probe`.
- `google_cloud.cloud_run.permissions/status` → provision
  `cloud_run_permissions/cloud_run_status`.
- `google_cloud.iam.runtime_create/runtime_prepare/project_policy_read/grant_deployment`
  → provision
  `runtime_service_account_create/runtime_service_account_prepare/iam_project_policy_read/iam_deployment_grant`.
- `google_cloud.mcp.build_bootstrap/build_permissions/build_preflight/build_status`
  → provision `mcp_build_bootstrap/mcp_build_permissions/mcp_build_preflight/mcp_build_status`.
- `google_cloud.mcp.builder_project_grant/registry_writer_grant/release_temp_iam/public_ingress/endpoint_probe/cloud_run_deploy/container_build`
  → provision corresponding `mcp_` actions. Mutations retain approved change
  validation in the existing handler; some legacy branches additionally restrict
  one historical change identifier. Do not generalize those permissions silently.

## Three verified video reads

All three live rows have `handler=sandy-deploy-provision`,
`permission_scope=infrastructure:read`, `is_mutation=false`, `api_exposed=true`,
`ai_exposed=true`, and `verified=true`. Their prior verification is preserved;
this review does not extend it to a new API route. `video.execution.preflight`
has a null `last_verified_at` despite the flag, so its historical evidence needs
reconciliation rather than fabrication.

| Operation | Fixed backend body | Current input schema |
| --- | --- | --- |
| `video.status` | `{action:"video_status"}` | Object, optional `target` const `sandy-video` |
| `video.install.preflight` | `{action:"video_install_preflight"}` | Empty object, additional properties forbidden |
| `video.execution.preflight` | `{action:"video_execution_preflight"}` | Empty object, additional properties forbidden |

The provision handler accepts its service identity or existing worker token. It
uses the existing workload identity exchange and Google service account to perform
these fixed reads. API v7 requires enabled owner membership, asserts the
expected handler/scope/mutation contract, and sends only the fixed body with an
internal credential. A Controller session must not be treated as provider auth.

Important compatibility detail: the archived, unchanged
`sandy-operations-mcp` v70 source contains two `else if` branches for
`op === "video.execution.preflight"`, at lines 1174 and 1215. The first calls
the provision handler once with `{action:"video_execution_preflight"}`. The
later branch would aggregate four OS Config actions, but is unreachable. The
`sandy-deploy-provision` v52 source has one implementation of that action, at
line 417: it reads the OS Config service state and returns `osconfig_http`,
`osconfig_enabled` and `installation_executed:false`. API v7 calls this same
single action; it does not activate the unreachable aggregate branch. Neither
preflight installs software or authorizes installation.

## Node engineering transport

| Existing tool name | Current destination/body | API follow-up |
| --- | --- | --- |
| `sandy_model_route_readiness` | User engineering test API `{action:"readiness"}` | Register read operation and installed handler; use API discovery for auth and schemas |
| `sandy_run_model_canary` | User engineering test API `{action:"model_canary",change_id,model_id,case_key}` | Register bounded canary operation, retain engineering change policy and real provider test evidence |
| `sandy_video_install_preflight` | Legacy MCP `operations_execute` for `video.install.preflight` | Fixed API video read, retain alias name if clients depend on it |
| `sandy_video_execution_preflight` | Legacy MCP `operations_execute` for `video.execution.preflight` | Fixed API video read, retain effective current output |
| `sandy_engineering_change_details` | User Engineering Control `{action:"get",change_id}` | `engineering.change.get` contract; do not silently replace with the differently shaped `engineering.change.detail` infrastructure read |

## Safe implementation and verification sequence

1. Capture source/metadata before each changed transport. Add bounded API handlers
   for existing operations with exact registry contracts and central authorization.
   Distinguish shared application services from transport wrappers. Unknown,
   disabled or unimplemented registry entries continue to fail closed.
2. Retain old tool names and JSON-RPC result envelopes in a compatibility adapter.
   The adapter can translate aliases and shapes, but must discover contracts from
   API and invoke only API. Move provider dispatch and durable job logic out of the
   transport. Replace direct Cloud Run MCP recursion with the corresponding
   registered application operation.
3. Cover alias translation, actual user-token forwarding, schema/mutation/exposure
   enforcement, fixed backend actions, conflicting action inputs, owner/tenant
   separation, queued versus executed results, ambiguous writes, and idempotent
   retries in composed handler tests. A static hardcoded alias table is permissible
   for backward-compatible names; it must not become a second operation catalogue.
4. Run authenticated deployed regression tests with the actual owner's supported
   short-lived session, comparing old and new read results and status shapes.
   Exercise each mutation against isolated authorized fixtures and verify persisted
   effects before changing exposure or verification evidence. Customer integration
   keys require their own hash/scope/revocation tests; the canonical gateway
   currently accepts only Supabase user sessions.
5. Deploy the compatibility adapter only after coverage of the full existing tool
   surface. Preserve the customer API, previous source archives, exposure policy,
   provider IAM and approval restrictions. Record exact versions and real evidence.

The current local API/MCP composition tests validate transport and authorization
with fixture responses. The Node transport's test covers health and negative
authentication only. Neither substitutes for an owner-session production
regression. Project-host egress is still rejected by the execution proxy and an
authorized Controller session is absent, so that regression is presently blocked.
These blockers do not prevent implementing the independent API handlers and
adapter tests, but they prevent claiming universal production routing is verified.

## Released follow-up

The earlier API v6 release installed the three video reads at the exact fixed provision
actions above. It requires an enabled owner, original handler/read scope/nonmutation
contract, preserves registry exposure flags and provider payloads, and forbids caller
action/target overrides independently of a loosened registry schema. It keeps the
effective single OS Config check. The API's user authentication and internal
service-to-service identity remain separate. No legacy transport was changed.

Four added gateway tests cover those contracts, including tenant/administrator
denial, exposure changes, schema/handler conflicts and provider failures. Including
the retry follow-up, all 37 gateway tests and the complete 83-test Deno suite passed
locally. The release also deployed `sandy-provider-read-api` v4 and installed its
12 additional metadata read IDs in the gateway. Downloaded deployment bundles
contain exact matches for the committed API entrypoint, retry helper, provider
handler and unchanged MCP v3 source.

The release recorded deployment and test evidence on 31 registry rows while
preserving the three existing video verification flags and exposure policy. It did
not extend their earlier verification to authenticated execution through the new
API routes. That end-to-end attestation remains blocked by project-host proxy
egress and the missing authorized Controller session. Global MCP routing remains
incomplete: legacy Edge MCP v70 and the Node engineering transport retain the
direct paths documented above.

## Subsequent passive-read release

API v7 is deployed with five passive Memory Portal reads and three passive
Engineering Control reads in addition to the video mappings. Portal authorization
uses its own account and primary-email directory. The engineering adapter validates
complete legacy response shapes and all change/job scope IDs before adding success
metadata. The source bundles for both unchanged backends were rechecked before
release. Four memory operations with model calls or task creation remain outside
the canonical installed map. The final Deno suite has 98 passing tests; registry
evidence for 39 operations distinguishes fixtures, real database/provider checks,
and the still-blocked deployed user paths. Neither legacy transport was changed.
