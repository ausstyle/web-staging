# Sandy API engineering status

Updated 21 October 2026. **0/161 original requirements are certified complete.**
API **v17** is ACTIVE with **2,527 installed operation mappings**. Both production
Edge MCP adapters execute through Sandy API. Universal routing remains incomplete:
the Cloud Run Node adapter is source-only and internal application/UI migration is
partial. **New fully verified authenticated production operations: 0.**

## Committed, published and deployed

The [release record](release-validation-20261021.json) retains the full local
commit list after `530007a`, deployment evidence, regressions and prior releases.
The current gateway source is `74a4535`; the pinned contract export is `e2d49fd`.
Financial export/custody and consent, strict commerce outputs, private provider
artifact delivery, recorded Controller metadata and shared mission workers are
committed locally and deployed at the versions below. Uncommitted future adapters
are excluded from these counts.

Publication remains confirmed only through `3b3491b` on
`engineering/sandy-api-project-reads-20261020`; remote main remains `350ede13`.
The current credential rejects Git writes. **No new merge is established.**
Supabase deployments and database tests continued independently. The recovery
bundle preserves unpublished local commits and is not a published branch.

[Session evidence](session-release-evidence.json) was captured at
**2026-10-21T05:12:36.378686+00:00**. All listed functions are ACTIVE; JWT settings were
preserved. Versions are platform deployment numbers.

| Production function | Version | Actual boundary |
| --- | --- | --- |
| `sandy-agent-operation-api` | 2 | Eight public shared-service contracts |
| `sandy-agent-runtime` | 56 | Release router unchanged |
| `sandy-agent-runtime-v1-backup-r50` | 9 | Shared actions/inference/records/policy/preflight |
| `sandy-agent-runtime-v2` | 19 | Shared actions/inference/records/policy/preflight |
| `sandy-agent-runtime-v4` | 17 | Shared actions/inference/records/policy/preflight |
| `sandy-api-mcp` | 7 | Canonical API-only execution; identity and approval/request headers |
| `sandy-auto-improve` | 13 | Dedicated proposal-only diagnosis worker |
| `sandy-commerce-ledger-api` | 2 | 53 internal handlers; strict v1.1 outputs; no payment processor |
| `sandy-controller-api` | 36 | Existing authentication preserved; UUID fix |
| `sandy-credential-lifecycle-api` | 3 | Scoped credential custody/consumers |
| `sandy-credential-probe-api` | 2 | Guarded credential probe |
| `sandy-database-operation-api` | 3 | 79 guarded contracts; native maintenance configuration absent |
| `sandy-guest-operation-api` | 3 | Signer configured; approved enrollment/install still required |
| `sandy-mission-executor` | 9 | Shared draft work products; no external actions |
| `sandy-mission-runner` | 19 | Shared fixed planner/reviewer; atomic one-use records |
| `sandy-operation-api` | 17 | 2,527 mappings; all live contracts match |
| `sandy-operations-mcp` | 74 | Legacy API-only aliases; same caller identity |
| `sandy-orchestration-api` | 3 | Durable dispatch and provider-read DAG |
| `sandy-product-service-api` | 1 | 98 product handlers; current v1.0 contracts |
| `sandy-provider-artifact-api` | 1 | One-use owner-approved bytes from six download classes |
| `sandy-provider-bound-api` | 1 | 48 relationship-bound provider handlers mapped |
| `sandy-provider-gap-api` | 1 | 35 fixed provider gap contracts |
| `sandy-provider-operation-api` | 4 | 1,738 bounded provider contracts; new operations closed |
| `sandy-provider-read-api` | 6 | Consumed argument-bound admission proof |
| `sandy-provider-sensitive-api` | 1 | 18 private-result handlers mapped |
| `sandy-provider-supplement-api` | 2 | 28 adapters: 27 bounded, one policy/schema gap; five private downloads |
| `sandy-supabase-service-api` | 2 | 46 managed services; exact owner approval guards |
| `sandy-system-metadata-api` | 1 | Seven recorded Controller metadata handlers |
| `sandy-tenant-lifecycle-api` | 4 | 22 owner contracts; shared content/financial custody executor |

Pinned TypeScript source maps and JSON modules were read back against reviewed
git bytes. API17's first upload returned 413 and left API16 unchanged. JSON modules
were then minified with duplicate/nonfinite rejection and semantic equality;
raw and uploaded hashes are recorded separately, while TypeScript stayed exact.
The first strict-commerce upload also returned 201 with transient version 2 metadata,
but repeated metadata/body/inventory checks proved version 1 remained. Its corrected
retry was counted only after exact version 2 source readback. Upload status alone
never establishes deployment.

## Requirements and verification

The [original PDF](Sandy_Autonomous_Control_API_Specification.pdf),
[161-item scope](api-scope-161.md) and [reconciliation](scope-reconciliation.json)
define acceptance. **0/161 complete** remains the result: every broad requirement
has an unmet constituent or platform acceptance gate.

- The pinned export contains **2,483 typed records**, including **21 private
  internal operations**. API17 installs 2,527 distinct IDs, retaining earlier/SQL
  mappings. Closed, dependency-blocked and unsupported-transport contracts count
  as source mappings only. Typed records touch 160 requirements; prior mappings
  bring source coverage to all 161.
- The current registry has **2,562 rows**,
  **2,549 evidence-bearing rows**,
  431 API flags and
  416 AI flags. Flags alone do not prove readiness.
  `cloud.vm.exec` remains an explicit unassigned operation; missing SSH/WinRM
  transport is implementation work, not a verified refusal-based implementation.
- Exactly three historical verified flags remain: `video.status`,
  `video.install.preflight`, `video.execution.preflight`. They were preserved,
  not freshly attested. **New fully verified deployed authenticated operations: 0.**
- Provider supplements now have 27 bounded source adapters and one remaining
  policy/schema gap. The official Compute discovery document was rechecked
  successfully (revision20261007) and still omits a response schema for effective
  security policies; that is documentation evidence, not provider execution.
  Five Actions downloads can capture bounded private bytes;
  the separate approved delivery handler accepts only six download classes.
  Neither proves arbitrary archives secret-free, larger transfer support or real
  provider success. Sensitive credential/identity/function-source classes remain
  unavailable for public byte delivery.
- Tenant lifecycle covers six leaf tables, four scalar tables, guarded support
  recovery, 20 content projections and 10 financial export-only projections.
  Whole-tenant/parent/control-copy recovery and financial history erasure/restore
  remain incomplete. Commerce 53 now requires strict resource outputs, but no
  payment processor, charge/refund/payout or provider settlement is configured.

## Actual validation and central evidence

The exact API17 archive passed **379 Deno tests**: 374 unconditional and five
separate PostgreSQL-output-dependent tests. API16's 353-test result remains
historical; these overlapping suites are not added together. Relevant Node MCP
source regressions remain 17 passed. Financial source/custody passed 175 actual
PostgreSQL rollback assertions; strict commerce passed 126, including 81 output
variants across 53 operations. Component tests use synthetic transaction-local
Auth/approval rows, not genuine HTTP customer sessions. Shared mission planning
passed 30 real PostgreSQL rollback checks and 58 overlapping composed tests;
work-product and reliability claims retain their separate evidence.

Every one of the **2,527 installed gateway contracts matches the live registry**;
zero mismatches. Registry evidence writes/readbacks returned 201 while preserving
then-current exposure, last-verification fields and the three historical flags. Earlier phase evidence
remains history; API17 records current mapping/deployment, not live-user execution.

The deployed interpreter preserves strict schema/format checks with bounded
isolated state. Against API17's 5,054 live schemas, the exact pinned archive passed
sequential streaming under 64MiB V8 old-space with peak RSS 137,097,216 bytes; 32×1MiB
payloads plus one invalid case peaked 228,950,016 bytes. These are exact-child
`os.wait4` plus sampled-RSS local observations with zero provider/RPC calls.
Earlier aggregate-child memory figures were confounded by process history and
cannot establish a Deno peak, failure or production margin. Edge concurrency,
provider-success paths and future broad activation remain unmeasured.

The earlier real-provider sweep made 18 Management requests: 14 observations,
two entitlement refusals and two other refusals. A later single fixed-project
branch-membership GET returned 200 with no branches; the actual
`supabase.branches.get_config.bound` handler then refused the missing target 403
before requesting configuration. Attribution was corrected in the registry;
no new call or full operation verification was claimed.

The latest API17/MCP7/74 authenticated probe remains blocked by managed proxy
rejection of the project hostname before Auth/provider execution. Management API
project access and SQL components work. No administrative key replaced a customer
session; no provider purchase, customer message, payment, VM action or paid-model
verification was performed.

## Routing and remaining work

Canonical MCP v7 and legacy MCP v74 route discovery/execution through Sandy API with
original caller credentials, scoped approval/request headers and existing aliases.
The Node replacement is source-only. Three runtimes, reliability diagnosis and
mission draft/planning workers now share named services, but other workers and UI
callers remain on the [routing inventory](internal-execution-source-inventory.json).
**Universal production routing remains incomplete.**

1. **Runtime egress:** the Codex machine still faces project-host proxy denial.
   Management works; Edge provider-runtime egress is not proven by that machine
   refusal and remains separately unverified. No bypass relay was introduced.
2. **Controller authentication:** a genuine existing-owner login/refresh session
   is unavailable. Only those specific integration tests are deferred; the
   supported flow is in [auth-test-requirements.md](auth-test-requirements.md).
   Machine workload identity is separate and cannot impersonate that session.
3. **Custom Domain entitlement:** Sandy handlers exist but the provider add-on is
   unavailable. No purchase/upgrade occurred. Backup scheduling has its own
   observed entitlement refusal; unrelated refusals are not relabelled entitlement.
4. **Git publication:** current credentials reject pushes; later commits are
   local and no new merge is claimed. This does not block Supabase deployments.
5. **Operation-specific implementation/configuration:** native maintenance TLS,
   guest enrollment, approved disposable provider targets, verified scope bindings,
   remaining wildcard constituents, tenant retention/redaction and internal/UI
   routing continue independently. The remaining scope is not all externally blocked.
