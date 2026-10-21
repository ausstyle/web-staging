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
all 1,021 source-attested deployed gateway IDs.

The release and its validated follow-ups are committed and published on
`engineering/sandy-api-project-reads-20261020` through
`b139a759489d87a1479f19776579b86d81160f5b`. Commits after `530007a` are:

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

Main remains `350ede13e373fb2108d57748b20e44d57302135d`; **no new merge is
established**. The latest live metadata snapshot was captured at 02:19 UTC
(04:19 CEST). Initial and follow-up validation boundaries remain separate.

| Production function | Confirmed version | Result |
| --- | --- | --- |
| `sandy-operation-api` | **9** | ACTIVE; 1,021 mappings and unified durable/legacy job REST routes |
| `sandy-api-mcp` | **4** | ACTIVE; canonical API-only MCP adapter |
| `sandy-operations-mcp` | **71** | ACTIVE; replaces legacy direct execution with API routing |
| `sandy-orchestration-api` | **2** | ACTIVE; durable dispatch and reviewed provider-read DAG support |
| `sandy-provider-operation-api` | **2** | ACTIVE; provider v1 release plus managed credential-consumer follow-up |
| `sandy-guest-operation-api` | **1** | ACTIVE; agent enrollment/configuration still required |
| `sandy-agent-operation-api` | **1** | ACTIVE; shared customer/runtime services |
| `sandy-database-operation-api` | **2** | ACTIVE; 79 database contracts including guarded maintenance |
| `sandy-credential-lifecycle-api` | **2** | ACTIVE; custody v1 release plus consumer follow-up |
| `sandy-credential-probe-api` | **1** | ACTIVE; guarded test-probe implementation |
| `sandy-controller-api` | **35** | ACTIVE; fixes the missing UUID helper against the exact v34 source |
| `sandy-agent-runtime-v4` | **12** | ACTIVE; shared eight-operation execution service |
| `sandy-agent-runtime` | **55** | Existing release router unchanged |
| `sandy-provider-read-api` | **4** | Existing read handler unchanged |

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

## Requirements and operation status

[The committed original PDF](Sandy_Autonomous_Control_API_Specification.pdf) and
[161-item scope](api-scope-161.md) remain the acceptance sources.
[scope-reconciliation.json](scope-reconciliation.json) retains every requirement.

- The deployed v9 gateway has **1,021 installed IDs**, including closed mutations,
  prerequisite-blocked handlers and explicitly unsupported transport contracts.
  An installed mapping is not proof of successful execution.
- The release contains **956 additional distinct typed contract records** beyond
  the earlier 64 mappings: 595 provider, 79 database, 66 legacy application,
  57 customer services, 38 workspace/Composio, 25 Agenda, 21 memory, 21 guest,
  14 credential custody, 10 atomic customer mutations, 8 agent, 8 orchestration,
  6 policy, 4 lifecycle, 3 customer keys and 1 MCP diagnostic. The remaining
  mapping is the strict SQL-defined `deployment.jobs.request` contract.
- These contracts touch **140 of 161 requirements**, each partially. Broad
  wildcard members, cross-application adoption and functional acceptance gates
  remain outstanding. **Completed requirements: 0/161.**
- The live registry has **1,042 rows**. At the snapshot, 427 had API exposure and
  412 had AI exposure metadata. These flags do not establish executability or
  override authorization, verification or provider prerequisites.
- Registry evidence was written and read back for **1,021 gateway operations**
  (Management write/readback HTTP 201), preserving prior evidence and verification
  fields. Deployment, component-test and local-provider evidence are labelled
  separately.
- Exactly **three historical `verified=true` flags** remain:
  `video.status`, `video.install.preflight`, `video.execution.preflight`.
  No new operation has been declared fully verified through the deployed
  authenticated session path. Historical flags are not a fresh attestation.

The official-schema inventory still contains 3,793 review candidates separately
from callable contracts. Cloud Quotas has six deployed typed handler contracts
from pinned protobuf HTTP bindings; Discovery access and positive IAM/provider
checks remain distinct dependencies.

## Routing and authorization

The production Edge MCP servers v4/v71 use Sandy API for discovery, schemas and
execution. The v71 adapter preserves its 16 legacy aliases and sends canonical
execution with `channel:"mcp"`; it has no direct provider fallback. The Node
Engineering MCP source preserves its five aliases and passes 13 tests, but its
Cloud Run deployment has not been attested. Thus **universal Sandy MCP → Sandy
API routing is not yet operational across every production transport**.

The shared active v4 runtime and the public agent API now call the same extracted
application service for the eight reviewed actions. The exact release router,
feature flags and existing worker/QA authentication are preserved. Other v4
conversation/model branches, older runtime fallbacks, UI clients and additional
workers still need migration. The [routing audit](universal-routing-source-audit.md)
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

The three historical video flags are the only fully verified registry entries.
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
Independent work continues on Auth/Storage, remaining customer/provider families
and broader shared-service adoption.
Those changes are reported separately until committed release validation,
guarded deployment, source readback and registry evidence are complete. Broad
wildcard completion, all application routing, full pagination and verified
compensation are not inferred from the 1,021 mappings.

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
