# Sandy API engineering status

Updated 21 October 2026. **0 of the original 161 requirements are certified
complete.** The expanded API release is deployed and source-attested. Both Edge
MCP servers now contain API-only execution adapters; universal production routing
remains incomplete because the Cloud Run Node adapter is not yet deployed and
internal application migration is partial. Normal authenticated production
API/MCP tests remain deferred.

## Committed, published and deployed

[Release validation](release-validation-20261021.json) records the confirmed
commits, runtime source readbacks, regression results and registry evidence.
[Session evidence](session-release-evidence.json) retains the live snapshot and
all 2,247 source-attested deployed gateway IDs.

All changes below are committed locally. GitHub publication is confirmed through
`3b3491ba3547394609e4766a891576d5db39b576` on
`engineering/sandy-api-project-reads-20261020`. Subsequent pushes were rejected by
the existing GitHub credential; a standard credential-helper retry also failed.
Read-only remote inspection at 03:40 UTC still confirmed branch `3b3491b` and main
`350ede13e373fb2108d57748b20e44d57302135d`. **No new merge is established.**
Supabase deployments remain available independently of Git publishing.

Committed changes after `530007a`, through this report's source snapshot:

| Commit | Change |
| --- | --- |
| `b3e1a42` | Implement durable Sandy API orchestration with scoped lease dispatch |
| `a948905` | Add 595 scoped provider handlers and guarded credential custody |
| `f7eb112` | Add tenant API handlers, scoped credentials and atomic customer mutations |
| `e310a44` | Reduce generated provider catalogue upload size without changing contracts |
| `043e7b4` | Implement shared agent, database, guest and guarded lifecycle services |
| `d86df5d` | Route all Sandy MCP tools through the governed 1020-operation API |
| `02279e4` | Package provider contracts with verified gzip catalogue loader |
| `da5d587` | Connect provider credential consumers to verified managed custody |
| `b139a75` | Resolve scoped job routes and implement guarded native database maintenance |
| `6063a41` | Record production API v9 rollout and actual operation verification evidence |
| `7ce33be` | Add explicit tenant key principals and consumed provider credential proofs |
| `1b25fc7` | Implement managed Supabase services and scoped provider gap handlers |
| `6e0354f` | Consolidate fallback runtime actions through the shared governed agent service |
| `a1dd1d4` | Implement 1143 additional scoped provider constituent handlers with bounded lazy catalogues |
| `270fcf5` | Reconcile Supabase service consent and provider gap contract evidence |
| `65f331b` | Centralize task-bound fallback conversation inference with durable per-round receipts |
| `f38fb44` | Require immutable scoped approvals for sensitive Supabase services |
| `feada3e` | Route managed Supabase and provider gap operations through the bounded API gateway |
| `d020ab1` | Route active runtime conversation through the shared task-bound inference service |
| `121342a` | Record API v12 deployment registry evidence and remaining 161-scope acceptance gates |
| `1cbba6f` | Enforce source-required approval flags in the managed Supabase runtime |
| `3b3491b` | Implement consent-bound tenant export erasure and restore with encrypted snapshots |
| `d4f24a8` | Implement tenant-scoped protected resource metadata without exporting credentials |
| `1ae4dd7` | Implement tenant product services with scoped provider receipts and reviewed sends |
| `4e669f1` | Route all reviewed provider constituent handlers through Sandy API |
| `c90471a` | Centralize trusted runtime record actions with immutable audit claims |
| `6fe7147` | Include product and internal runtime contracts in scope evidence exports |
| `71749f6` | Forward scoped approval and request identifiers through every MCP adapter |
| `ea44e2c` | Centralize principal-bound runtime operational snapshots and inspection |

The live production snapshot was captured at **03:40 UTC on 21 October 2026**.
Function versions are platform deployment numbers, distinct from candidate labels.

| Production function | Confirmed version | Result |
| --- | --- | --- |
| `sandy-operation-api` | **13** | ACTIVE; 2,247 installed mappings; all reviewed provider constituents routed |
| `sandy-api-mcp` | **6** | ACTIVE; Canonical API-only MCP; scoped approval/request headers forwarded |
| `sandy-operations-mcp` | **73** | ACTIVE; Legacy aliases route to API; scoped approval/request headers forwarded |
| `sandy-provider-operation-api` | **4** | ACTIVE; 1,738 provider contracts; additions closed and unverified |
| `sandy-supabase-service-api` | **2** | ACTIVE; 46 managed Supabase services; immutable approval guards |
| `sandy-provider-gap-api` | **1** | ACTIVE; 35 fixed project/repository gap adapters |
| `sandy-product-service-api` | **1** | ACTIVE; 98 product handlers; gateway integration pending |
| `sandy-provider-read-api` | **6** | ACTIVE; Consumed, argument-bound admission required |
| `sandy-orchestration-api` | **3** | ACTIVE; Durable dispatch and provider-read DAG support |
| `sandy-guest-operation-api` | **3** | ACTIVE; Signer configured; approved enrollment/install still needed |
| `sandy-agent-operation-api` | **2** | ACTIVE; Public eight-operation shared service |
| `sandy-database-operation-api` | **3** | ACTIVE; 79 database contracts including guarded maintenance |
| `sandy-credential-lifecycle-api` | **3** | ACTIVE; Credential custody and managed consumers |
| `sandy-credential-probe-api` | **2** | ACTIVE; Guarded test-probe boundary |
| `sandy-controller-api` | **36** | ACTIVE; Exact-source UUID-helper fix; legacy auth preserved |
| `sandy-agent-runtime-v4` | **15** | ACTIVE; Shared actions, conversation and nine private record operations |
| `sandy-agent-runtime-v2` | **17** | ACTIVE; Shared actions, conversation and nine private record operations |
| `sandy-agent-runtime-v1-backup-r50` | **7** | ACTIVE; Shared actions, conversation and nine private record operations |
| `sandy-agent-runtime` | **56** | ACTIVE; Release router source unchanged |

Existing JWT verification settings were preserved, including the independent
legacy authentication of the Controller/runtime functions. Downloaded runtime
sources match the uploaded source or JSON module bytes. Compiler-elided type-only
imports are identified separately; they are not missing runtime dependencies.

The follow-up `da5d587` adds managed credential consumers, with confirmed
provider and custody v2 deployments. `b139a75` adds the job REST resolver and
database maintenance, deployed as API v9 and database v2. Migrations
`20261021003200`, `20261021005100` and `20261021006100` were read back with exact
source statements. The execution transport briefly disconnected; source/ledger
readback reconciled the in-flight result before any retry. No live credential
rotation, production schedule, native TLS maintenance, provider compensation or
normal authenticated customer test is inferred from these deployments.

The guest signing-secret configuration refreshed every existing function version
by one without changing source. Readback reconciled all fourteen relevant
functions before further uploads. The reviewed identity release then deployed as
API **v11**, provider-read **v6** and guest **v3** from `7ce33be`; the phase label
“API10” in component manifests names the candidate rather than its final platform
version. All new runtime source files were read back successfully. The original
router source remains byte-identical. Migrations `06200` and `07100` matched their
applied source statements. The key principal keeps its Auth user absent and only
allows eight scoped passive reads. Provider credentials require a consumed,
argument-bound admission; guest credential lookup follows consumption.

This follow-up passed 111 composed gateway/MCP tests, 38 reader/guest tests and
seven verifier regressions, plus 30 key, 29 unchanged-owner and 24 read-proof real
PostgreSQL rollback checks. Suites overlap and are not summed. The deployed test
again stopped at proxy reachability; no positive Controller or customer-key
request was asserted. Identity-release evidence was written/read back for all
1,021 mapped operations with the historical verification fields preserved.

The next reviewed gateway is now **v12**, from `feada3e`, with **1,104**
installed mappings. Its 83 new IDs cover 46 managed Supabase service operations,
two real-user tenant-consent operations and 35 provider-gap adapters. Both new
backend functions are ACTIVE v1. All 1,104 registry contracts match the exact
deployed gateway predicate. Registry evidence write/readback returned HTTP 201;
verification and exposure fields were preserved. Validation passed **155 composed
tests**, strict typecheck and all 2,208 live input/output schema checks. The local
full-catalogue memory sweep passed at 96 MiB old-space with 196.4 MiB peak RSS.
Oversized synthetic unique-schema churn still fails at 128 MiB; this is an explicit
limit, not a production load guarantee.

Provider **v4** from `a1dd1d4` adds **1,143** separately reviewed handlers to the
original 595. All 49 runtime files match source; migration `08200` matched its
ledger. Validation passed 86 composed Deno tests, 14 Python tests, 5,158 offline
schema checks and a fully rolled-back database check preserving every original
595 row. The new handlers are closed/unverified and **not yet gateway-mapped** in
v12. Their central evidence is labelled backend deployed / gateway pending.

Fallback runtime **v2 v16** and **backup v6**, from `65f331b`, share both the eight
application actions and task-bound conversation inference. Forty-six regressions
and 19 real PostgreSQL rollback assertions passed; all runtime source files were
read back. Migration `10000` creates private one-claim-per-round receipts. Nullable
customer identity never becomes a tenant or Auth principal; no paid model request
was made by validation. The conversation operation remains internal and closed.
Migration `07010` separately hardens immutable owner-approval proofs, with six
real PostgreSQL rollback checks and exact applied-source readback.

The latest gateway is **v13**, from `4e669f1`, with **2,247 mappings**. All mapped
contracts matched the live registry, with zero mismatches. The 1,143 added provider
operations are now gateway-mapped and remain closed/unverified. Evidence write and
readback returned HTTP 201 for all 2,247 operations. The closed candidate passed
127 composed regressions and all 4,494 schema checks. Current exposed catalogue
discovery passed at 129.3 MiB local peak RSS. A forced streamed full-catalogue sweep
needed 128 MiB old-space and peaked at 244.8 MiB RSS; whole-resident and 96 MiB
runs failed. Future broad activation/concurrent load remains unverified.

MCP **v6/v73**, from `71749f6`, forwards validated approval/request UUIDs while
retaining the original caller identity. All runtime source files match. Thirty-eight
Edge regressions passed again from the exact pinned commit; 16 Node tests passed.
The Node Cloud Run image remains undeployed. The newest deployed probe was blocked
by proxy before Auth, so no real-session success is inferred.

The active runtime **v4 v15**, fallback **v2 v17** and **backup v7**, from `c90471a`,
also share nine internal record operations. Sixty-four regressions and 16 real
PostgreSQL rollback checks passed; all three bundles were source-attested. New
private operations are not public API readiness. Supabase service **v2** carries
the source-required approval guard. Product service **v1** has 98 handlers and
41 local/90 real PostgreSQL rollback checks; its gateway integration is pending.

The tenant lifecycle foundation `3b3491b` and protected metadata `d4f24a8` are
committed. Their migrations and gateway integration are being validated together
because consent schema/hash must change coherently. The six private operational
inspection contracts in `ea44e2c` are committed and awaiting the combined runtime
snapshot rollout. Full tenant erasure/restore and other constituent gaps remain
implementation work, separately from unavailable credentials or entitlements.

## Requirements and operation status

[The committed original PDF](Sandy_Autonomous_Control_API_Specification.pdf) and
[161-item scope](api-scope-161.md) remain the acceptance sources.
[scope-reconciliation.json](scope-reconciliation.json) retains every requirement.

- Production API v13 has **2,247 installed IDs**: 2,182 newer typed records,
  64 earlier mappings and the SQL-defined job-request mapping. Closed mutations,
  dependency-blocked and unsupported transport contracts are included.
- The pinned `6fe7147` source export contains **2,290 typed records**: 2,182 mapped
  records, 98 product-backend contracts awaiting gateway integration, and ten
  private runtime contracts. Later pending work is excluded from this count.
- Typed records touch **160 requirements**. Including the prior gateway handlers,
  **all 161 have some source-mapped coverage**. Every broad requirement still has
  an unmet acceptance gate or constituent: **certified complete: 0/161**.
- The live registry contains **2,376 rows** and **2,357 evidence-bearing rows**.
  Its 437 API and 422 AI exposure flags do not prove executable/verified behavior.
- Current gateway evidence covers **2,247 operations**; separate product-backend,
  internal runtime, provider and MCP transport evidence states its actual boundary.
  Test suites overlap and are not added together into a unique test total.
- Exactly **three historical verification flags** remain: `video.status`,
  `video.install.preflight`, `video.execution.preflight`. **New fully verified
  deployed authenticated operations: 0.** Source-complete bounded handlers with
  pending integration tests are distinguished from genuinely missing/partial
  protocols in the constituent inventories.

The official-schema inventory still contains 3,793 review candidates separately
from callable contracts. Cloud Quotas has six deployed typed handler contracts
from pinned protobuf HTTP bindings; Discovery access and positive IAM/provider
checks remain distinct dependencies.

## Routing and authorization

The production Edge MCP servers v6/v73 use Sandy API for discovery, schemas and
execution. The legacy adapter preserves its 16 legacy aliases and sends canonical
execution with `channel:"mcp"`; it has no direct provider fallback. The Node
Engineering MCP source preserves its five aliases and passes 16 tests, but its
Cloud Run deployment has not been attested. Thus **universal Sandy MCP → Sandy
API routing is not yet operational across every production transport**.

The shared active v4 runtime and the public agent API now call the same extracted
application service for the eight reviewed actions. The exact release router,
feature flags and existing worker/QA authentication are preserved. The fallback conversation paths are also shared. All three runtime conversation paths and nine record operations now share
central services. Other runtime branches, UI clients and additional workers
still need migration. The [routing audit](universal-routing-source-audit.md)
records those source-based gaps.

Normal user sessions, scoped API keys, portal grants, Agenda grants, Controller
owners and trusted worker/VM identities remain distinct. Management credentials
are never customer sessions. New customer mutation RPCs provide atomic receipts
and tenant checks; unchanged legacy customer write endpoints retain their native
semantics until migrated. Unverified public mutations and sensitive/model-cost
operations remain closed.

## Actual validation

The frozen committed release `02279e4` was validated, rather than an evolving
working tree:

- **351 TypeScript Deno tests passed**, across 31 files. The initial recursive
  command also selected Node `.mjs` worker tests, producing nine sandbox-write
  permission failures. The supported Node runner then passed **all 10 guest
  worker tests**, without code changes. This runner correction is retained in
  the evidence instead of presenting the first command as a clean pass.
- **246 Python tests passed.**
- **13 Node MCP adapter tests passed.** This validates source behavior, not the
  currently deployed Cloud Run image.
- Follow-up validation passed **98 composed API/MCP/job-route tests**. Credential
  consumer validation passed **80 composed tests** plus a seven-test helper
  suite that overlaps that group. Database-maintenance validation passed **30
  service tests**, **78 ephemeral PostgreSQL/WASM component assertions** and
  **six real Supabase database boundary checks**, all production fixtures rolled
  back. These overlap the initial regression and are not summed into a larger
  unique-test total. Local VACUUM was real; native TLS maintenance, real pg_cron
  scheduling and wall-clock provider cancellation were not tested.
- The refreshed local-provider sweep made **18 real Supabase Management API
  calls**: **14 observations, two entitlement refusals and two other provider
  refusals**. It used local handlers with synthetic policy callbacks. It does
  not certify deployed gateway Auth, real approval admission or customer sessions.
- Real PostgreSQL component suites passed in fully rolled-back transactions for
  policy/audit, tenant mutation receipts, Agenda pins, durable queues/leases,
  lifecycle proof binding, guest records, credential custody and provider-read
  delegation. Synthetic identities/claims in database fixtures do not constitute
  Auth sessions or authenticated HTTP tests. No fixture email/model/VM/provider
  mutation was triggered.
- The deployed endpoint probe on 21 October returned **blocked by proxy**, before
  provider HTTP or Auth verification. Internal-handler and authenticated
  API/MCP checks were deferred, not passed or silently skipped.
- All **1,021 installed IDs matched the real registry against the exact deployed
  v9 contract predicate**, with zero mismatches. That audit was recorded in the
  central registry. It is a metadata/installed-contract check, not an Auth or
  provider invocation.

The three historical video flags remain the only registry entries marked verified.
The new release has source/deployment and component evidence, plus 14 independently
observed provider reads; its full authenticated end-to-end verification is partial.

## Separate dependencies and continuing work

1. **Runtime egress:** required domains are published, but the execution machine
   still receives proxy CONNECT 403 for the project host; GitHub API and Cloud
   Quotas were also denied at the last destination checks. Management access
   works. Re-saving identical settings is not the missing step.
2. **Controller Auth:** no normal owner session token is available. Supported
   login/refresh and synthetic tenant test requirements are documented in
   [auth-test-requirements.md](auth-test-requirements.md). Only those specific
   authenticated tests are deferred.
3. **Custom Domain entitlement:** implemented handlers encounter the project's
   missing paid add-on. No plan purchase or upgrade was made. Backup scheduling
   has a separate observed entitlement refusal; an unclassified restore-point
   refusal is not labelled as a proven entitlement issue.
4. **Guest execution:** a dedicated Ed25519 signer is now configured: Management
   secret creation returned HTTP 201, names-only readback returned HTTP 200, and
   local sign/verify passed. No existing bindings were replaced or private material
   saved or logged. Runtime key loading remains untested; approved enrollment,
   an installed managed agent, runtime egress and a Controller session fixture
   remain prerequisites. No VM enrollment, installation or operation was enabled.
   SSH and WinRM transports remain unsupported. VM-reported completion is
   distinct from independent provider readback.
5. **Git publishing:** writes reject the current GitHub credential. The last
   confirmed pushed commit is `3b3491b`; later commits remain local. Read-only
   remote inspection still works. Refreshing this credential is needed only for
   publishing, not source engineering, Supabase deployment or database tests.
6. **Specific provider scopes and fixtures:** verified organization/folder/billing
   bindings, exact mutation approvals, disposable targets and credential rotation
   fixtures remain operation-specific prerequisites. Unassessed IAM is not
   described as unavailable permission. Names-only Management readback confirmed
   the native TLS database-maintenance URL and GCP scope bindings absent; those
   configuration dependencies remain separate from implemented handlers.

Job REST routing, guarded maintenance and credential consumers are now deployed.
Managed Auth/Storage and provider-gap backends are deployed and gateway-mapped.
Independent work continues on full tenant lifecycle, product services, remaining
provider constituents and broader shared-service adoption.
Those changes are reported separately until committed release validation,
guarded deployment, source readback and registry evidence are complete. Broad
wildcard completion, all application routing, full pagination and verified
compensation are not inferred from the 2,247 mappings.

## Reproduction

Use the existing checkout, installed Deno and writable cache. To reproduce a
release count, run its committed source archive rather than later pending work.

```sh
export PATH=/workspace/.cloud-setup/toolchain/node_modules/.bin:$PATH
export DENO_DIR=/workspace/.cloud-setup/deno-cache
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/sandy -p 'test_*.py'
node --test supabase/functions/sandy-guest-operation-api/worker_test.mjs
node --test services/sandy-engineering-mcp/test/api-adapter.test.mjs
deno run --allow-env scripts/sandy/export_api_contract_evidence.ts --include-gateway > /tmp/sandy-source-contracts.json
```

Run Deno against `.ts` test files and the Node worker under Node. The reconciliation
tool combines source exports with an actual live snapshot and explicit deployed
ID attestation; it never marks a broad requirement complete from those inputs.
Provider tests require authorized scoped credentials and must never print them.
