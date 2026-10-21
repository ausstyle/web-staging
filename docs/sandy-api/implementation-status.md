# Sandy API engineering status

Updated 21 October 2026. **0/161 original requirements are certified complete.**
API **v15** is ACTIVE with **2,390 installed operation mappings**. Both production
Edge MCP adapters execute through Sandy API. Universal routing remains incomplete:
the Cloud Run Node adapter is source-only and internal application migration is
partial. New authenticated production operations fully verified: **0**.

## Committed, published and deployed

The [release record](release-validation-20261021.json) lists every local commit
after `530007a`, exact runtime source evidence, migrations and tests.
[Session evidence](session-release-evidence.json) retains the live snapshot and
all 2,390 source-attested gateway IDs.

Publication is confirmed through `3b3491b` on
`engineering/sandy-api-project-reads-20261020`. Later changes are committed locally;
Git pushes reject the current GitHub credential, including the normal credential
helper attempt. Read-only remote inspection still confirms main `350ede13` and
the branch at `3b3491b`. **No new merge is established.** Supabase deployment and
database testing continue independently. A verified local recovery bundle retains
the unpublished commits; it is not a published branch or merge.

Latest deployed source changes include `2032b81` (tenant/product gateway),
`f1e4906` (provider supplement), `6876c99` (shared runtime facts/model policy),
`24aa4bc` (integrity-checked private provider protocols), `771e9bb` (governed
connection preflight), `718f9a8` (durable reliability diagnosis), and `b8a9e8f`
(scalar recovery, content export, provider supplement and MCP transport capacity).
`ad46abc` records its peer validation and `78293d1` exports the reviewed contracts.

The production snapshot below was captured at **2026-10-21T04:12:50.674507+00:00**. Versions are platform
deployment numbers. Every listed function is ACTIVE; JWT settings were preserved.

| Production function | Version | Actual boundary |
| --- | --- | --- |
| `sandy-agent-operation-api` | **2** | Eight public shared-service operations |
| `sandy-agent-runtime` | **56** | Release router source unchanged |
| `sandy-agent-runtime-v1-backup-r50` | **9** | Shared actions, inference, records, operational reads and preflight |
| `sandy-agent-runtime-v2` | **19** | Shared actions, inference, records, operational reads and preflight |
| `sandy-agent-runtime-v4` | **17** | Shared actions, inference, records, operational reads and preflight |
| `sandy-api-mcp` | **7** | Canonical API-only adapter; bounded media transport |
| `sandy-auto-improve` | **13** | Dedicated automation identity; shared proposal-only diagnosis |
| `sandy-controller-api` | **36** | Legacy authentication preserved; UUID fix |
| `sandy-credential-lifecycle-api` | **3** | Scoped credential custody/consumers |
| `sandy-credential-probe-api` | **2** | Guarded credential probe |
| `sandy-database-operation-api` | **3** | 79 contracts; native maintenance configuration absent |
| `sandy-guest-operation-api` | **3** | Signer configured; no approved agent enrollment/install |
| `sandy-operation-api` | **15** | 2,390 mappings; exact live contract audit passed |
| `sandy-operations-mcp` | **74** | Legacy API-only aliases; bounded media transport |
| `sandy-orchestration-api` | **3** | Durable dispatch and provider-read DAG |
| `sandy-product-service-api` | **1** | 98 handlers mapped in API v15 |
| `sandy-provider-gap-api` | **1** | 35 fixed provider gap contracts |
| `sandy-provider-operation-api` | **4** | 1,738 provider contracts; new operations closed/unverified |
| `sandy-provider-read-api` | **6** | Consumed argument-bound admission required |
| `sandy-provider-sensitive-api` | **1** | 18 private-result handlers; gateway integration pending |
| `sandy-provider-supplement-api` | **1** | 28 mapped adapters: 22 bounded, six explicitly partial |
| `sandy-supabase-service-api` | **2** | 46 managed services with immutable approval guards |
| `sandy-tenant-lifecycle-api` | **2** | 14 owner handlers; actual-user delivery runs in gateway |

Downloaded ESZIP original-source maps/JSON modules match the pinned reviewed
commits. Compiler-elided type-only imports require the matching version's Deno
runtime graph. API v15 accounts for all 79 uploaded local sources. The first
canonical MCP capacity upload returned HTTP201 while retaining v6/old source;
metadata and original-source-map reconciliation proved that unchanged state
before a retry installed and source-attested v7. No attempted upload is counted
as a successful release without that evidence.

## Requirements and operation status

The [committed original PDF](Sandy_Autonomous_Control_API_Specification.pdf),
[161-item scope](api-scope-161.md) and [reconciliation](scope-reconciliation.json)
define acceptance. A function family is larger than one callable endpoint.

- The pinned `78293d1` export has **2,361 typed records**: 2,325 gateway-mapped
  records, 18 private internal operations and 18 sensitive backend contracts
  awaiting gateway integration. The gateway additionally retains 65 earlier/SQL
  mappings. These counts include closed, dependency-blocked and unsupported
  transport contracts; they are not completed requirements.
- Typed records touch 160 requirements; prior gateway coverage brings some source
  mapping to all 161. Every broad requirement still has an unmet constituent or
  platform acceptance gate. **Certified complete: 0/161.**
- The registry has **2447 rows**, **2428 evidence-bearing rows**, 437 API
  flags and 422 AI flags. Exposure flags alone do not prove execution readiness.
- Exactly three historical verification flags remain: `video.status`,
  `video.install.preflight`, `video.execution.preflight`. They were preserved,
  not freshly attested. **New fully verified deployed authenticated operations: 0.**
- The supplemental provider group explicitly distinguishes 22 source-complete
  bounded adapters from six partial protocols. GitHub signed downloads, private
  byte delivery and undocumented/provider-specific protocols are not claimed
  complete. SSH/WinRM execution remains unsupported; a refusal contract is not
  an implementation of its transport.
- Tenant lifecycle now has six-table leaf recovery, four-table scalar recovery,
  20 explicit content projections and protected-resource metadata. Full parent
  erasure/restore, all retained control copies and every ownership candidate
  remain implementation work. Content projections do not establish full erasure.

## Actual validation and central evidence

API v15 passed **274 composed Deno tests**, **17 Node tests**, strict typechecks,
and **95 actual PostgreSQL assertions** in a fully rolled-back transaction.
Independent tenant review passed **139 overlapping Deno tests**. Every one of
the 2,390 installed contracts matches the live registry; zero mismatches.
Current exposed discovery passed a local96MiB heap fixture at about133MiB peak
RSS. Future broad activation/concurrency is not attested. The lower-memory schema
interpreter is still a reviewed prototype; production retains bounded AJV.

Recent component suites also passed 73 runtime fact/policy regressions and12
database assertions; 82 composed preflight regressions and8 database assertions;
eight reliability worker tests and24 database assertions; eight sensitive-provider
tests and18 database assertions. Source/custody tests include local synthetic
provider HTTP, not real provider success. Suites overlap and are not summed.

Registry evidence write and readback returned **HTTP201 for all2,390 gateway
operations**, with separate sensitive-backend, internal-runtime and worker
records. Exposure, historical verification and last-verification fields stayed
unchanged. Earlier source-only/backend-pending phase evidence remains historical;
the newer API15 evidence records current routing.

The real-provider sweep made18 Supabase Management requests:14 observations,
two entitlement refusals and two other refusals. Those exercised local handlers
with synthetic policy callbacks; they do not certify deployed owner sessions,
approval admission or MCP execution. Auth/Storage and provider-gap read evidence
separately records actual provider response boundaries. Unchanged calls were not
repeated merely to inflate a test total.

The newest deployed API15/MCP7/74 probe has **0 pass,0 fail,1 blocked**: the
managed proxy rejects the project hostname before Auth/provider requests. No
service-role credential substituted for a customer session. The Management API
continues to authenticate to project `zmqlyygzqoidkcwdysok` without credential
disclosure. Its SQL component tests are real PostgreSQL tests, not Auth sessions.

Migrations07230/35/40/50/55,08400,08500,10030/40/50 and the earlier installed
chain were read back with exact source statements.08400 installed an active
once-per-minute private opaque-custody expiry cleanup. Read-only cron inspection
confirmed its sole command is the private cleanup function. This is not a
customer/provider job or native maintenance test. No provider purchase, email,
WhatsApp message, payment, VM operation or paid-model test was performed.

## Routing and separate dependencies

Canonical MCPv7 and legacy MCPv74 use API discovery and execution, preserve
caller identity and validated approval/request headers, and have no independent
provider fallback. The legacy16 aliases remain. The Node adapter has matching
source behavior but no attested Cloud Run deployment. Three runtimes and the
reliability worker now share governed services. Other workers and UI callers
remain on the [routing inventory](internal-execution-source-inventory.json).

1. **Runtime egress:** required destinations are published, yet the managed
   proxy still denies the project host. GitHub API and Cloud Quotas were also
   denied at the latest destination checks. Management access works. Re-saving
   identical network settings is not the missing action; no bypass relay was used.
2. **Controller authentication:** a normal existing-owner login/refresh session
   is unavailable. Only tests requiring that session are deferred. The supported
   flow and isolated synthetic-tenant fixture are in
   [auth-test-requirements.md](auth-test-requirements.md). The separate existing
   machine workload-identity flow can support Cloud Run deployment once its Auth
   hostname is reachable; it is not a human Controller session.
3. **Custom Domain entitlement:** Sandy handlers exist; the project's provider
   add-on is unavailable. No purchase or upgrade was made. Backup scheduling has
   its own observed entitlement refusal; unclassified restore-point refusal is
   not labelled a proven entitlement issue.
4. **Git publication:** the current credential rejects writes. Later committed
   changes are not claimed pushed or merged. This does not block Supabase deploys.
5. **Operation-specific fixtures/configuration:** verified organization/billing
   bindings, exact mutation approvals, disposable provider targets, native TLS
   maintenance configuration and managed-guest enrollment remain separate needs.
   Unassessed IAM is not described as a proven permission denial.

Independent engineering continues on typed finance outputs and byte pagination,
seven legacy metadata handlers, provider relationship protocols, tenant recovery,
shared mission work and UI migration. Uncommitted candidates and source-only
experiments are excluded from production counts. The current status is not a
claim that the remaining scope is externally blocked.
