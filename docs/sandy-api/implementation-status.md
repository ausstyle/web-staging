# Sandy API engineering status

Status date: 20 October 2026. **The 161-requirement scope is not complete.**
Management access, deployment and independent integration work resumed after PR
#135. Missing Controller authentication was deferred only for tests that require
that user session; it did not block implementation, deployment or database tests.

## Canonical specification and reconciliation

The owner's original [specification PDF](Sandy_Autonomous_Control_API_Specification.pdf)
is now committed alongside [the 161-item scope](api-scope-161.md).
Its final completeness rule requires current provider schemas and deployed Sandy
contracts, not a guessed fixed CRUD list.

[scope-reconciliation.json](scope-reconciliation.json) accounts for every numbered
requirement. It reconciles 3,787 provider-schema candidates and 105 live registry
records: 3,892 candidates across 117 requirements, with all 161 requirements
retained. Candidate mappings are evidence to review, not proof of semantic
completeness or executability. No requirement is certified complete.

The schema inventory covers 21 Google services, GitHub OpenAPI and Supabase
OpenAPI with commit-pinned sources and SHA-256 checksums. Cloud Quotas discovery
remains unresolved: attempted official snapshot paths returned 404, and the
authoritative discovery hostname is blocked by the cloud proxy. This is not
evidence that the provider capability is unsupported. No candidates are
registered or exposed automatically. The runtime registry still decides contracts
and exposure; installed handlers and actual tests are separate gates.

Current local-source assessments: 57 partial source, 88 without a local handler,
9 workflow-only, 2 partial delegation, 3 queue-only and 2 preflight-only. These are
source assessments, not assertions of production absence.

## Implemented and deployed

- `sandy-operation-api` **v5**: canonical capabilities/describe/execute/job-read
  routes, caller-specific catalogue digest, registry JSON Schema validation,
  backend output validation, fixed executor mappings and failure propagation.
  Lost mutation responses require reconciliation rather than claim no execution.
- `sandy-api-mcp` **v3**: registry-backed API discovery and execution. The adapter
  identifies MCP calls so API rejects operations with AI exposure disabled, and
  exposes the API catalogue digest in discovery metadata for revision detection.
- `sandy-provider-read-api` **v3**: fourteen project-scoped reads: project identity,
  health, branch list/get, network restrictions, domain status, secret names,
  backup metadata, migration list, schema list, public table/routine/index metadata
  and aggregate connection states. SQL is fixed and provider-enforced read-only.
  Secrets, SQL bodies, query text, customer rows and connection credentials are
  excluded from these results.
- Fifteen existing infrastructure reads now have API dispatch. Their existing
  AI-exposure flags remain authoritative. Eight existing tasks/calendar/files
  reads route through API using the caller's JWT and tenant access directory.
  Controller membership alone does not confer tenant access. Existing customer
  backends independently verify identity and scope resource queries to the tenant.
- Pending/approved deployment-job cancellation has an owner-only transactional
  RPC and canonical API route. It locks against worker claim, records one event,
  is idempotent and refuses running jobs. Its registry exposure is **disabled**
  pending authenticated API/MCP attestation, as required for an unverified mutation.
- Four additive migrations were applied and read back in
  `supabase_migrations.schema_migrations` with their exact source statements.
  Before-source bundles and function metadata are preserved outside the checkout.

There are 40 installed executor mappings, including disabled cancellation.
That count is not 40 completed requirements. Existing legacy MCP and
provider/customer handlers were not replaced. **The active legacy
`sandy-operations-mcp` still has direct execution paths and must be migrated;
platform-wide universal API routing has not been achieved.**

## Actual validation and registry evidence

[project-read-release-evidence.json](project-read-release-evidence.json) records
exact source commits, source hashes, deployment versions, migration IDs and test
layers. All deployed JWT verification settings were retained. Downloaded deployed source
maps match the exact committed source bytes for all three released functions.

- **66 Deno tests passed**, including API/MCP composition, tenant/owner separation,
  schema rejection, credential forwarding, provider projections and mutation
  ambiguity. These use fixtures for user/database/backend dependencies.
- **221 Python tests passed**, including provider-schema ingestion and checksum
  verification. These are offline tests, not production provider attestations.
- The versioned provider handler ran locally against real Management API
  responses: **12 successful positive reads**, **1 passing missing-branch negative
  test**, and **1 blocked domain read**. The latter returns a precise entitlement
  prerequisite: the project lacks the paid Custom Domain add-on. A successful
  branch-get against an existing branch remains untested; there were no branches.
- A real database test ran as `service_role` in a rolled-back transaction: owner
  checks, direct customer RPC denial, missing job, persisted pending cancellation,
  idempotency, one audit event and refusal of running jobs all passed. Fixture rows
  were rolled back. This was a database-component test, not a customer session.
- Registry `last_test_result.api_development_20261020` was updated and read back
  for the fourteen new reads and cancellation. Evidence explicitly records local
  real-provider versus deployed/user-session tests. **All fifteen remain
  `verified=false`; the prior three verified registry records were preserved.**

The health integration initially exposed a provider defect: documented
`timeout_ms` is rejected as a string query parameter. The unnecessary optional
parameter was removed and the real health read then passed.

## Confirmed external blockers and deferred tests

1. The cloud proxy currently denies `zmqlyygzqoidkcwdysok.supabase.co`. Management
   calls to `api.supabase.com` work. Consequently deployed endpoint smoke tests,
   customer-session tests and authenticated MCP paths have not run. Required
   project, GitHub API and Cloud Quotas discovery hostname additions are saved in the environment draft;
   the user must review/save and publish the settings so runtime access applies.
2. No `SANDY_CONTROLLER_ACCESS_TOKEN` is present. The supported Controller path is
   normal Supabase user authentication followed by enabled Controller membership.
   Email-link login uses `signInWithOtp(shouldCreateUser:false)`; an existing
   session may refresh. Access tokens are configured for one hour. A real enabled
   owner session is needed for owner-path tests. No owner session was fabricated,
   no user was impersonated and no service key was substituted for a user session.
3. Custom-domain positive tests need the provider's paid add-on. No purchase or
   entitlement change was made. Other operations are independent of this limit.

Git read and branch push work. GitHub API-specific grants and wider GCP IAM are
**unassessed**, not established missing credentials. Do not treat these unknowns
as proven access denials or ask for redundant tokens.

## Remaining engineering

The reconciliation lists missing work for all 161 requirements. Major unfinished
areas include durable orchestration/outbox/leases, retry and verified compensation,
tamper-evident audit, plan validation/execution, complete provider adapters and
wildcard expansion, scoped policy/cost controls, guest execution, provider writes,
customer-domain lifecycle/provider integrations, API-key support in the new
gateway, pagination/streaming and migration of all legacy callers. These are
engineering gaps, not problems solved by adding a Controller token. Provider and
tenant acceptance/rollback suites are not complete. A bulk registry insertion or
compatibility wrapper is not an implementation of these capabilities.

## Reproduction

Use the existing isolated checkout; no worktree is needed. Activate Deno with
`export PATH=/workspace/.cloud-setup/toolchain/node_modules/.bin:$PATH` and set
`DENO_DIR=/workspace/.cloud-setup/deno-cache` for the writable cache.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/sandy -p 'test_*.py'
deno test supabase/functions/sandy-operation-api/ supabase/functions/sandy-api-mcp/ supabase/functions/sandy-deployment-api/ supabase/functions/sandy-provider-read-api/
deno run --allow-env=SANDY_SUPABASE_MANAGEMENT_TOKEN --allow-net=api.supabase.com --allow-write=/workspace/sandy-api-deliverables/provider-integration-results.json scripts/sandy/verify_project_reads.ts /workspace/sandy-api-deliverables/provider-integration-results.json
python3 scripts/sandy/fetch_provider_contracts.py --output /workspace/sandy-api-deliverables/provider-schemas
python3 scripts/sandy/provider_contract_inventory.py --schemas /workspace/sandy-api-deliverables/provider-schemas --registry-report /workspace/sandy-api-deliverables/production-inspection-after.json --output /workspace/sandy-api-deliverables/provider-contract-inventory.json
```

The provider integration exits nonzero while domain entitlement is blocked; the
schema restore exits nonzero for the explicitly unavailable Cloud Quotas source.
Other successful checks remain distinct. The SQL component integration is
`scripts/sandy/test_cancel_pending_deployment_job.sql`; execute through authorized
Management database access and retain its assertion result. Never print tokens.
