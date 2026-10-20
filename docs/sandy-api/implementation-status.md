# Sandy API engineering status

Status date: 20 October 2026. **The 161-requirement scope is not complete.**
Development resumed after merged PR #135. Implementation, Management API
deployments, database migrations and independent tests continued while only
network-dependent and authenticated-user tests were deferred.

## Canonical specification and reconciliation

The owner's original [specification PDF](Sandy_Autonomous_Control_API_Specification.pdf)
is committed alongside [the 161-item scope](api-scope-161.md). Its completeness
rule requires provider-supported operations and actual deployed handlers.

[scope-reconciliation.json](scope-reconciliation.json) retains every requirement.
It links 3,793 provider-schema candidates and 118 runtime registry records: 3,911
candidates across 122 requirements. Nine legacy registry identifiers still need
an explicit scope mapping and are listed separately rather than discarded.
Candidates are review evidence, not executable contracts. **No requirement is
certified complete.** The source assessments are 59 partial, 86 without a local
handler, 9 workflow-only, 2 partial delegation, 3 queue-only and 2 preflight-only.
These are source assessments, not assertions of production absence.

Pinned schema sources cover 21 Google services, GitHub and Supabase OpenAPI.
Cloud Quotas Discovery is still proxy-blocked. Two official commit-pinned
protobufs now restore reproducibly with verified hashes and byte counts. Their
six RPCs and 18 HTTP bindings are parsed and mapped to requirement 16; all remain
nonexecutable candidates. Discovery absence no longer means there is no quota
contract source. Full provider-family implementation and IAM attestation remain.

## Implemented and deployed

- `sandy-operation-api` **v7**, `sandy-api-mcp` **v3** and
  `sandy-provider-read-api` **v4** are active. JWT verification settings were
  retained. Downloaded deployment source maps match the exact committed source,
  including both API helper modules.
- The gateway serves canonical capabilities, describe, execute, job and event
  reads, with caller-specific catalogue digests, JSON Schema validation, fixed
  handlers and truthful failure envelopes. API and AI exposure flags are
  independent; MCP discovery and execution enforce AI exposure.
- Twenty-six project-scoped provider reads cover identity/health, branches,
  restrictions, domain status, secret names, backups, migrations and bounded
  PostgreSQL metadata. The latest twelve add views, materialized views, triggers,
  constraints, types, extensions, roles, visible grants, default privileges,
  policy identities, aggregate locks and cron metadata. Fixed SQL uses provider
  `read_only:true`. Definitions, passwords, customer rows, query text, policy
  expressions and cron commands are excluded. New bounded lists explicitly
  report their limit and possible truncation; this is not full pagination.
- Fifteen existing infrastructure reads and eight Agenda tasks/calendar/files
  reads have canonical dispatch. Customer reads forward the actual user JWT and
  retain independent tenant directory checks in both gateway and backend.
- The three historically verified video status/preflight operations now route
  through canonical API with exact fixed actions and owner authorization. Their
  backend and historical verification flags were preserved. This release does
  not claim a new live user-path attestation for those routes.
- Five passive Memory Portal reads use confirmed Auth identity, an unrevoked
  portal account and matching primary email. Agenda access and Controller
  membership confer no memory access. Their typed contracts and fixed backend
  action/body shapes are installed. `memory.ask` can create tasks; search,
  life_search and biography invoke models or embeddings. Those four are omitted
  until mutation, consent and cost contracts are implemented.
- Three passive Engineering Control reads now have typed API handlers: change
  get/list and job status. The real owner's JWT reaches the independent backend.
  Legacy responses lacking `ok` become success only after complete shape and
  change/job identifier checks. Null resources become explicit 404s.
- Pending/approved job cancellation is an owner-only transactional RPC. It locks
  against claim, is idempotent and refuses running jobs. Safe GCP read retry
  admission preserves immutable approval snapshots, pins the approved target,
  creates one child per parent, limits depth to three and refuses ambiguous
  outcomes or legacy approvals without snapshots. Its `202 recorded` receipt
  explicitly reports `executed:false`; the RPC does not dispatch the child.
  Independent consumers are not established by this work. **Both mutation
  contracts remain unexposed and unverified** pending authenticated attestation.
- The existing GCP worker's log-completion defect is fixed: its completion RPC
  now accepts `get_logs` alongside the existing VM reads. Source/ACL drift guards
  preserve worker-only access, state gates and single-completion semantics.
- Nine migrations were applied and their exact source statements read back from
  `supabase_migrations.schema_migrations`. Before-source bundles were archived.

There are **64 installed gateway mappings**, including disabled cancellation and
retry. This is not 64 completed requirements. Existing legacy transports remain
active: `sandy-operations-mcp` and the Node engineering MCP still have direct
execution paths. **Universal API routing is not achieved.** See the exact
[legacy routing audit](mcp-routing-audit.md) before changing those transports.

## Actual validation and registry evidence

[project-read-release-evidence.json](project-read-release-evidence.json) records
source commits/hashes, deployment versions, migration checksums and test layers.

- **98 Deno tests passed**, including API/MCP composition, separate portal/Agenda/
  owner grants, fixed backend actions, credential forwarding, scope checks,
  strict contracts, provider projections and ambiguous mutation outcomes.
  Auth/database/backend dependencies in these tests use fixtures.
- **237 Python tests passed**, including reproducible pinned-schema restoration,
  safe protobuf HTTP annotation parsing and requirement mappings.
- The versioned provider handler ran locally against real Management API data:
  **24 positive reads and one missing-branch negative test passed**, with actual
  output schemas loaded from the live registry. The domain check returned 424
  because the project lacks the paid Custom Domain add-on. Existing-branch get
  remains untested because no branch existed. The materialized-view catalogue
  was empty; no positive existing-object fixture is claimed.
- Real database tests passed for cancellation, log completion and retry. They
  covered actual service-role invocation, customer-role denial, state gates,
  duplicate safety, preserved approval/failure evidence, policy-approved retry,
  scope tampering, active target pins, terminal release and bounded retry chains.
  Fixture jobs, targets and membership rows were rolled back. No fixture provider
  or worker was invoked. Concurrent scheduling behavior was not exercised.
- Registry evidence was updated and read back for **39 operations**, preserving
  prior evidence. The 36 unverified rows remain `verified=false`; the previous
  three video flags remain unchanged. No new operation was declared verified
  from source, deployment metadata or fixture tests alone.

The earlier health test found the optional documented `timeout_ms` parameter was
rejected by the provider. Removing that unnecessary parameter restored the real
health read. The latest read tests pass without it.

## Confirmed external blockers

1. The saved network draft contains the project, GitHub API and Cloud Quotas
   hosts, but this machine still receives proxy CONNECT 403 for them. These
   requests do not reach the providers. The project Management API works and
   authenticates project `zmqlyygzqoidkcwdysok` (Email AI, ACTIVE_HEALTHY).
   Applying/publishing the saved policy to a runtime is still required for
   deployed endpoint, Auth, GitHub API and Discovery checks. No additional token
   is inferred to be missing from a proxy denial.
2. No `SANDY_CONTROLLER_ACCESS_TOKEN` is present. The supported owner credential
   is an unexpired session from normal Supabase login/refresh of an already
   enabled Controller owner; configured lifetime is one hour. No owner was
   impersonated, no owner membership was fabricated and no service key was used
   as a positive customer session. Separate synthetic tenant test identities can
   use normal password grants once the project host is reachable. See
   [authentication and fixture requirements](auth-test-requirements.md).
3. A positive custom-domain test requires the provider's paid add-on. No purchase
   or entitlement change was made.

Native Git reads and branch pushes work. GitHub API-specific grants and broader
GCP IAM are **unassessed**, not proven missing credentials. Provider-specific
mutations need scoped disposable fixtures and appropriate grants. The existing
production MCP transports were not replaced without their authenticated
regression tests.

## Remaining engineering

All 161 rows retain their missing capabilities. Major gaps include durable
orchestration/outbox/leases and dispatch, general retry/backoff and verified
compensation, tamper-evident audit, plan graphs, all remaining provider adapters
and writes, wildcard lifecycle members, scoped policy/cost controls, guest
execution, customer-domain integrations, API-key support in the new gateway,
pagination/streaming and migration of every legacy caller. The four side-effecting
memory operations need corrected contracts before canonical exposure. These are
engineering gaps; adding a Controller token does not implement them. Bulk registry
insertion and provider-schema candidates are not substitutes for handlers or
acceptance tests.

## Reproduction

Use the existing checkout. Activate Deno with
`export PATH=/workspace/.cloud-setup/toolchain/node_modules/.bin:$PATH` and set
`DENO_DIR=/workspace/.cloud-setup/deno-cache` for the writable cache.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/sandy -p 'test_*.py'
deno test supabase/functions/sandy-operation-api/ supabase/functions/sandy-api-mcp/ supabase/functions/sandy-deployment-api/ supabase/functions/sandy-provider-read-api/
deno run --allow-env=SANDY_SUPABASE_MANAGEMENT_TOKEN --allow-net=api.supabase.com --allow-write=/workspace/sandy-api-deliverables/provider-integration-results.json scripts/sandy/verify_project_reads.ts /workspace/sandy-api-deliverables/provider-integration-results.json
PYTHONDONTWRITEBYTECODE=1 python3 scripts/sandy/verify_deployed_api.py --output /workspace/sandy-api-deliverables/deployed-api-checks.json
python3 scripts/sandy/fetch_provider_contracts.py --output /workspace/sandy-api-deliverables/provider-schemas
python3 scripts/sandy/provider_contract_inventory.py --schemas /workspace/sandy-api-deliverables/provider-schemas --registry-report /workspace/sandy-api-deliverables/production-inspection-final.json --output /workspace/sandy-api-deliverables/provider-contract-inventory.json
```

Provider integration exits nonzero for the domain entitlement block; schema
restore retains the explicitly unavailable Discovery source; deployed checks exit
nonzero for actual network/auth/component failures. SQL suites are
`scripts/sandy/test_cancel_pending_deployment_job.sql`,
`scripts/sandy/test_cloud_read_completion.sql` and
`scripts/sandy/test_retry_approved_read_job.sql`; use authorized Management
access and retain assertion results. Never print credentials.
