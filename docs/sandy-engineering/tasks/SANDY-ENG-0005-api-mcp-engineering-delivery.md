# SANDY-ENG-0005 — Sandy API, MCP and Engineering Delivery Completion

Version: 1.0 · 21 October 2026  
Status: DRAFT — target architecture and acceptance contract  
Priority: P1 overall; runtime-critical and safe release foundations are P0 dependencies  
Owner: Sandy Platform/API Engineering / Codex  
Master: §§3–5, 10, 12–15, 17–20; AC-06, AC-08, AC-10–12  
API scope: all original requirements 1–161; no assumption that 161 equals endpoint count  
Shared contracts: [architecture-contracts.md](../architecture-contracts.md), especially SC-01, SC-04, SC-05 and SC-08

## 1. Outcome and boundaries

Every supported Sandy business or engineering operation must have a typed, authorized, versioned application contract and a real executable implementation. Sandy uses Sandy API directly. External MCP clients use Sandy MCP, which discovers and invokes the same API. Provider integrations and execution policy live behind this boundary, not in a second MCP implementation.

The outcome is a dependable engineering path: inspect source → create change → test → commit → migrate/deploy → verify → recover if necessary. Registry names, wildcard expansion, green mocked tests and HTTP 200 acknowledgements are not completion. This scope does not own conversational planning, calendar sync conflict policy, mission scheduling or customer UI. Do not expand provider mappings while the critical engineering path remains unusable.

## 2. Baseline and reconciliation

Inspect the deployed API gateway, MCP adapters, registry, provider handlers, legacy compatibility routes, engineering controls, credentials metadata and GitHub release paths. Do not assume historical versions or exposure counts are current. `sandy_operation_registry`, execution admission/audit, provider admission proof, product contract and operational tool relations were observed in the live schema; inspect how they actually interact.

Create a machine-readable 161-row requirement map. Each family expands into concrete actions with a stable canonical operation ID, alias disposition, implemented handler, deployed revision, caller eligibility, provider prerequisites, verification method and remaining gap. Duplicated legacy names reference one canonical implementation and have compatibility/deprecation rules. Distinguish `implemented`, `deployed`, `reachable`, `authorized_for_fixture`, `functional_test_passed`, `rollback_tested`, `MCP_exercised` and `blocked_external`; do not collapse them into one misleading count.

## 3. Architecture

`MCP client → protocol/auth adapter → Sandy API admission/policy → versioned handler manifest → domain/provider adapter → receipt`

`Sandy runtime / portal / workers → same Sandy API service boundary → same policy/handler/receipt`

The operation registry is authoritative for published metadata and evidence. It is reconciled against a compiled or signed deployed-handler manifest. Admission requires a known handler, compatible schema, correct identity/target, current connection/entitlement and applicable policy. A registry edit cannot load arbitrary code, call an arbitrary URL or grant a new scope. Internal application-service invocation is permitted only with the same checks and audit interceptors as HTTP.

### Exposure and discovery

Return caller-specific eligible contracts with explicit reasons for unavailable operations: missing connection, missing scope, provider entitlement, undeployed handler, suspended policy, stale verification or unhealthy target. Keep capability knowledge distinct from executable tool discovery. Models receive a task-relevant subset, not thousands of tool schemas on every turn. Cache by identity/grant revision, tenant, operation catalogue version and health freshness; invalidate on revoke, deployment and contract change.

MCP implements negotiated initialization, paginated `tools/list`, `tools/call`, supported schema/result conventions and errors. Emit tools-list changes only where the negotiated protocol supports them; otherwise use version-aware discovery on the next request. Provider outcome and Sandy job state remain intact in structured results. Accepted asynchronous work returns a job handle and progress access, not a completed result. Refuse malformed notifications that would execute without the required request semantics.

## 4. Identity and delegated execution

Human requests use normal authenticated sessions with current server-side Controller/customer authorization. Service actors use a renewable, narrowly delegated workload identity or supported credential broker. Never fix a failed test by substituting the project service key for a customer session or copying a personal owner bearer token indefinitely.

Implement token audience/issuer/expiry checks, resource/account binding, least-privilege delegation, revocation and session-renewal tests. If MCP and Sandy API use different token audiences, exchange or mint a narrowly scoped internal assertion using supported trust, or validate a deliberately shared resource boundary; do not blindly pass an MCP bearer token to third-party providers. OAuth grants and provider secrets remain in an encrypted server-side broker. OIDC may be used where supported, with repository ID, workflow/ref, environment and audience restrictions.

Standing owner grants can authorize routine engineering changes within named projects/repositories and bounded risk. Preserve separation from customer grants and high-impact exceptions. A provider-denied permission is an external blocker, not authority to grant oneself administrator access.

## 5. Functional requirements

| ID | Requirement |
| --- | --- |
| API-01 | Reconcile all 161 requirement families to canonical operations and actual handlers |
| API-02 | Version and validate input/output contracts, including pagination and binary artifact references |
| API-03 | Filter discovery by live identity, target, connection, health and policy |
| API-04 | Route every applicable MCP invocation through Sandy API without independent provider execution |
| API-05 | Enforce idempotency, version conflicts, timeout, structured errors and unknown-outcome reconciliation |
| API-06 | Implement authorized GitHub source read/write/commit/PR/merge/workflow delivery |
| API-07 | Implement Supabase migrations, function deployment, configuration/secrets, logs and recovery |
| API-08 | Implement required GCP infrastructure and authenticated VM execution pathways |
| API-09 | Preserve customer-service contracts and real provider execution, not schema-only stubs |
| API-10 | Provide immutable source-to-release evidence and controlled rollback/forward repair |
| API-11 | Provide renewable test/workload identity without privileged impersonation |
| API-12 | Reconcile registry evidence with deployed versions and invalidate stale certifications |
| API-13 | Audit every direct/legacy execution path and migrate without breaking clients |
| API-14 | Protect egress, credentials, tenant boundaries, artifact handling and budget limits |

## 6. Engineering commands and workflows

Use existing canonical IDs when available; the names below denote required behavior, not new aliases to add blindly.

| Operation family | Required semantics |
| --- | --- |
| `github.files.*`, `github.git.*`, commits/PRs | read revision; update with expected blob/head; atomic multi-file tree where needed; verify resulting commit; never force-push shared history as recovery |
| `supabase.db.migrations.*` | plan/apply/list/repair/verify with immutable checksum, lock, history and postcondition checks; destructive changes need backup/recovery and explicit policy |
| `supabase.functions.*` | source/config read, immutable multi-file bundle, deploy, invoke/log inspection, version/digest readback and functional test |
| `supabase.functions.secrets.*` | securely set/rotate/delete references; never expose values in logs, catalogue, model context or CI output |
| engineering release/verification/recovery | scoped release manifest; staged execution; provider evidence; revert compatible code or forward repair schema; truthful failed/unknown state |
| GCP guest commands | target-bound workload identity, SSH/OS Login/IAP or enrolled agent, command artifact digest, timeout, output limits, cancellation and exit/health receipts |

**Source delivery:** validate repository/ref and change scope; capture current source and checksums; commit to an isolated branch; run tests and authorized review/merge; read back exact Git SHA. If write credentials fail, retain the artifact and precise error but do not deploy uncommitted source as the normal process. A tightly governed emergency release must preserve an immutable recovery artifact and an explicit source-reconciliation incident.

**Migration:** verify expected schema/history, acquire a project migration lock, classify transactional/non-transactional statements and rollback feasibility, execute once, record checksums and validate data invariants. SQL capability is administrative and project-bound, not exposed as unrestricted customer SQL. No OS command or server-file access via SQL. Expand/migrate/contract is the default.

**Function release:** preserve all files/import maps/configuration and existing authentication behavior; pin dependencies, scan secrets, build an immutable bundle and record its hash. Capture previous recovery artifact, apply release, confirm provider version/source/config, then exercise the authenticated function and expected downstream effect. An ACTIVE status is deployment metadata, not functional verification. Failed health checks route to a compatible previous artifact; failed DB migrations use forward repair where reversal is unsafe.

**VM access:** first exercise a harmless authorized command on a named disposable/test target; prove output/exit code and guest identity. Agent enrollment needs signed identity, generation and fresh heartbeat. No public unrestricted SSH, embedded permanent keys, disabled host verification or blanket metadata bootstrap. Broad command execution is limited to engineering grants and auditable signed artifacts. Video-specific installation belongs to 0008.

## 7. Data and contract changes

Extend, do not replace, the registry. Minimum evidence dimensions: canonical ID, aliases, contract/handler digest, provider release, source commit, exact fixture scope, tests/evidence, verification time/expiry, available channels and blocker classification. Store requirements in the scope catalogue and implementation evidence in the operation registry; document sync must not certify code.

Require the centralized schema validator and deterministic dispatcher; provider adapters translate target resources and errors. Generated provider schemas may reduce maintenance but must be pinned to upstream versions, reviewed for permissions and tested. Unsupported provider operations return explicit unsupported/blocked status rather than fake implementation.

## 8. Tests and certification

API-T01: authenticated MCP initialize/list/call across pagination and catalogue changes. API-T02: direct API and MCP return equivalent outcomes and failures. API-T03: negative tenant/account/audience/scope tests, including a grant revoked after discovery. API-T04: duplicate and changed-input idempotency keys, timeout/reconciliation and concurrent writes. API-T05: reversible GitHub fixture file commit and removal, with real SHA evidence. API-T06: isolated Supabase fixture migration and restore/forward repair. API-T07: disposable function multi-file deploy, invoke, logs, replacement and recovery. API-T08: secret rotation using disposable secret fixtures without value disclosure. API-T09: harmless guest command with real exit/output evidence. API-T10: failed Git/Management/API egress or entitlement returns the actual blocker. API-T11: source-to-production mismatch detection. API-T12: expired credential renewal and revoked delegation refusal. API-T13: audit legacy entrypoints so none bypass policy. API-T14: SSRF, artifact path traversal, injection and over-budget attempts rejected.

Per-operation certification needs appropriate real target/fixture evidence. Tests requiring purchases, data destruction, financial movement or external messages use authorized fixtures and explicit policy. Mark entitlement-blocked or no-fixture work separately; do not silently reduce the original scope or mark exclusions as passed. The full 161-family claim is allowed only when every constituent requirement is mapped and accepted or a product-owner-approved exception is recorded transparently.

## 9. Delivery order and dependency avoidance

API-M1 (P0 dependency slice): reliable identity, discovery, read/write admission, receipts, Git source delivery and Supabase release/migration/recovery. API-M2: MCP parity and renewable test identity; prove ChatGPT can invoke the engineering cycle through Sandy MCP. API-M3: GCP guest path needed by video/computer workers. API-M4: remaining provider/customer family coverage with exact traceability. API-M5: deprecate duplicate routes after consumer migration.

Do not block 0001/0003 runtime fixes until every GCP or GitHub administrative action is live-certified. Deliver the small required shared interfaces first, and keep unrelated provider gaps in the mapped backlog. 0004 provides job durability; use its contract rather than another release queue. 0010 owns entitlement facts; API policy evaluates them.

## 10. Rollout, rollback and handover

Use schema-compatible canaries, caller-specific feature flags, one release lock per affected component and monotonic contract revisions. Preserve existing API clients while introducing explicit versioning. Rollback restores handler manifests and safe exposure policy together; do not leave a new catalogue pointing to old incompatible handlers. Invalidate verification when code, schema, grants or provider behavior changes materially.

Deliver OpenAPI/JSON schemas, MCP contract tests, 161-row reconciliation, credential/egress matrix without values, deployed-source parity report, end-to-end release receipts, rollback exercise, operation readiness dashboard and incident playbook. The pending status of an operation must remain visible; API capability count is not the success metric.

Primary protocol/security references are in the shared architecture document. Pin implementation versions and recheck upstream provider documentation before adding a new adapter.


## Amendment — Remove repetitive manual engineering approvals (22 October 2026)

Implement Master amendment B: eliminate per-change and per-deployment manual owner-approval waits **for operations already inside a standing, revocable engineering grant**. Admission must evaluate legitimate workload identity, precise resource, operation, risk, budget, source artifact, tests and rollback policy. Record `authorized_by_policy` and its grant/version, then execute and verify without a human click. Policy misses are explicit `policy_blocked` outcomes, never automatic elevation. Preserve the external provider's own protections, sensitive-change restrictions and all historical owner-approval records. Update the Controller to display authorization and execution evidence rather than require an Approve button for routine delegated actions. Add end-to-end tests for two unattended routine releases, revocation, expiry, cross-target denial, high-risk refusal and source/manifest mismatch. This is a target engineering requirement; do not mark implemented before a production canary.
