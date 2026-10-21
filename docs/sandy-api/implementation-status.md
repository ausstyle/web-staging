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
all 1,104 source-attested deployed gateway IDs.

The release and its validated follow-ups are committed and published on
`engineering/sandy-api-project-reads-20261020` through
`feada3e22c8439f3b1289ad0d483750a53a5b837`. Commits after `530007a` are:

| Commit | Change |
| --- | --- |
| `b3e1a42` | Durable orchestration, scoped lease dispatch and protocol/component tests |
| `a948905` | 595 scoped provider handlers and guarded credential custody |
| `f7eb112` | Tenant API handlers, scoped credentials and atomic customer mutations |
| `e310a44` | Compact provider catalogue upload |
| `043e7b4` | Shared agent, database, guest and guarded lifecycle services |
| `d86df5d` | Governed 1,020-operation gateway and API-only MCP adapters |
| `02279e4` | Verified gzip catalogue packaging |
| `da5d587` | Managed credential consumers and exact private resolver cutover |
| `b139a75` | Unified job REST routing and guarded database maintenance |
| `6063a41` | Production rollout and verification evidence |
| `7ce33be` | Explicit customer-key principal and consumed provider-read/guest credential proofs |
| `1b25fc7` | Managed Supabase services and scoped provider-gap handlers |
| `6e0354f` | Shared governed fallback runtime actions |
| `a1dd1d4` | 1,143 additional provider constituent handlers and bounded lazy catalogues |
| `270fcf5` | New service and gap contract evidence export |
| `65f331b` | Task-bound fallback conversation inference and durable round receipts |
| `f38fb44` | Immutable approval proof for sensitive Supabase services |
| `feada3e` | 1,104-operation gateway with bounded schema validation |

Main remains `350ede13e373fb2108d57748b20e44d57302135d`; **no new merge is
established**. The latest live metadata snapshot was captured at 03:13 UTC
(05:13 CEST). Initial and follow-up validation boundaries remain separate.

| Production function | Confirmed version | Result |
| --- | --- | --- |
| `sandy-operation-api` | **12** | ACTIVE; 1,104 mappings and unified durable/legacy job REST routes |
| `sandy-api-mcp` | **5** | ACTIVE; canonical API-only MCP adapter |
| `sandy-operations-mcp` | **72** | ACTIVE; replaces legacy direct execution with API routing |
| `sandy-orchestration-api` | **3** | ACTIVE; durable dispatch and reviewed provider-read DAG support |
| `sandy-provider-operation-api` | **4** | ACTIVE; 595 original and 1,143 additional provider handlers; additions closed |
| `sandy-guest-operation-api` | **3** | ACTIVE; signer configured; approved agent enrollment and installation still required |
| `sandy-agent-operation-api` | **2** | ACTIVE; shared customer/runtime services |
| `sandy-database-operation-api` | **3** | ACTIVE; 79 database contracts including guarded maintenance |
| `sandy-credential-lifecycle-api` | **3** | ACTIVE; custody v1 release plus consumer follow-up |
| `sandy-credential-probe-api` | **2** | ACTIVE; guarded test-probe implementation |
| `sandy-controller-api` | **36** | ACTIVE; fixes the missing UUID helper against the exact v34 source |
| `sandy-agent-runtime-v4` | **13** | ACTIVE; shared eight-operation execution service |
| `sandy-agent-runtime` | **56** | Existing release router unchanged |
| `sandy-provider-read-api` | **6** | ACTIVE; consumed, argument-bound admission required |
| `sandy-supabase-service-api` | **1** | ACTIVE; 46 managed Auth/Storage/Realtime/Vault/compliance operations, closed |
| `sandy-provider-gap-api` | **1** | ACTIVE; 35 fixed project/repository gap adapters |
| `sandy-agent-runtime-v2` | **16** | ACTIVE; shared actions and private task-bound conversation inference |
| `sandy-agent-runtime-v1-backup-r50` | **6** | ACTIVE; shared actions and private task-bound conversation inference |

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

## Requirements and operation status

[The committed original PDF](Sandy_Autonomous_Control_API_Specification.pdf) and
[161-item scope](api-scope-161.md) remain the acceptance sources.
[scope-reconciliation.json](scope-reconciliation.json) retains every requirement.

- The deployed v12 gateway has **1,104 installed IDs**, including closed mutations,
  prerequisite-blocked handlers and explicitly unsupported transport contracts.
  An installed mapping is not proof of successful execution.
- **1,039 distinct typed records** support the newer installed mappings, beyond
  the earlier 64 mappings and the SQL-defined `deployment.jobs.request` mapping.
  A further **1,143 typed provider contracts** have deployed backend handlers and
  pending gateway registration: **2,182** typed source records in this snapshot.
  The internal conversation operation is tracked separately.
- Typed source records touch **154 of 161 requirements**; including prior gateway
  contracts, **155 of 161** have some mapped source. All remain partial under the
  original acceptance gates. **Certified complete: 0/161.**
- The live registry has **2,269 rows**, with 437 API and 422 AI exposure flags.
  These flags do not establish executability or override authorization,
  verification or provider prerequisites.
- Current v12 evidence covers **1,104 gateway operations**. Separate backend
  evidence covers the 1,143 pending provider additions. Deployment, component and
  local-provider evidence are labelled independently.
- Exactly **three historical `verified=true` flags** remain: `video.status`,
  `video.install.preflight`, `video.execution.preflight`. No new operation has a
  successful deployed authenticated-session test. Historical flags are not a
  fresh end-to-end attestation.

The official-schema inventory still contains 3,793 review candidates separately
from callable contracts. Cloud Quotas has six deployed typed handler contracts
from pinned protobuf HTTP bindings; Discovery access and positive IAM/provider
checks remain distinct dependencies.

## Routing and authorization

The production Edge MCP servers v5/v72 use Sandy API for discovery, schemas and
execution. The v72 adapter preserves its 16 legacy aliases and sends canonical
execution with `channel:"mcp"`; it has no direct provider fallback. The Node
Engineering MCP source preserves its five aliases and passes 13 tests, but its
Cloud Run deployment has not been attested. Thus **universal Sandy MCP → Sandy
API routing is not yet operational across every production transport**.

The shared active v4 runtime and the public agent API now call the same extracted
application service for the eight reviewed actions. The exact release router,
feature flags and existing worker/QA authentication are preserved. The fallback conversation paths are also shared. The active v4 conversation
path, other runtime branches, UI clients and additional workers still need migration. The [routing audit](universal-routing-source-audit.md)
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
5. **Specific provider scopes and fixtures:** verified organization/folder/billing
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
compensation are not inferred from the 1,104 mappings.

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
