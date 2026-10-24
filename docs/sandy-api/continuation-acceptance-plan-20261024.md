# API continuation: verified cases and bounded decisions

This continues SANDY-ENG-0005 and the existing 161-family scope. It creates no grant, exposure change or acceptance certification. Runtime retains guest/shared-infrastructure work; Hosting retains PR203/issue226 and the sandy.chat pilot.

## Completed unaffected work

Six new normal-Auth MCP → API → Google operations succeeded: global and zonal operation list/get/wait. Four are required constituents of family 34; the two lists support fixture selection. Independent Google readback, current output schemas, durable result/contract hashes, audit-chain links and exactly one admission per request passed. All 24 duplicate, changed-input, foreign-project and own-receipt checks passed. A pre-admission policy-availability failure recovered once under the same request ID after confirming no admission existed. These were observations of existing completed operations, with no infrastructure mutation. [Durable acceptance evidence](operation-status-acceptance-20261024.json).

The live current-contract success count is **63**, up from 57. Whole-family acceptance remains **0/161**: regional get/wait are still closed, so family 34 cannot be promoted. Historical accepted executions were not replayed.

Two observed handler defects have source fixes and tests: credential acquisition failure now reports `executed:false`, and upstream HTTP 400 returns `provider_request_invalid`/400 instead of 502. These fixes are not deployed. Unit tests are source validation, not live acceptance of the repaired behavior. Existing v31 remains the production baseline.

## All-family grouped work matrix

[The 161-row machine-readable matrix](delegation-acceptance-plan-20261024.json) lists every family, reviewed versus candidate constituents, current-contract successes, and each operation's disposition. Groups overlap; their counts must not be added. Class eligibility only identifies a candidate for further target, identity, contract, fixture and provider checks. It is not authority to execute every wildcard candidate.

| Disposition | Families affected | Next action |
| --- | ---: | --- |
| Existing API or MCP exposure closed | 149 | Finish constituent review and scoped implementation/tests; preserve flags until an exact reviewed exposure decision. |
| Exposed operation class potentially matches active delegation | 72 | Continue bounded authorized cases with existing fixtures; do not repeat accepted positives. These families are not globally blocked. |
| Separate authority or mapping review | 47 | Resolve canonical handler/identity; use the existing tenant or Controller path where authorized. |
| Exact legacy fixture only | 7 | Preserve existing narrow fixture evidence; do not generalize it into provider authority. |
| Outside current standing classes | 7 | Prepare operation/target-specific decisions only when needed for a reviewed constituent. |
| Own receipt or conditional recovery | 2 | Verify only owned admissions; compensation still requires its original conditions. |
| Missing registry constituent | 2 | Reconcile family 76 projects list/create and family 83 functions invoke with existing handlers; do not add aliases merely to inflate coverage. |

Near-term source work remains available: family 117 binary/large-artifact custody and complete lifecycle evidence, family 118 immutable blob/tree effect settlement, and canonical mapping review. Family 115 ref deletion is restricted. Broader log-query acceptance for families 85/110 exceeds the legacy fixture. Families 143–161 require actual tenant fixtures and relevant provider consent, not fabricated credentials. Guest and native-execution cases stay with Runtime. No claim is made that every remaining provider execution is blocked.

## Exact bounded Owner proposals — not approvals

The parent can present these as separate selectable decisions in one request. Each expires 24 hours after genuine approval, permits at most one positive invocation per named operation plus one own-receipt lookup, and excludes IAM, credentials, grants, paid resources, customer changes and unrelated targets. A pre-dispatch availability failure may resume the same nonce only after proving no admission exists; denied operations are not retried by this continuation. Approval must be recorded through the existing genuinely authenticated Owner/Controller process. This document and the workload cannot issue an approval or create a delegation.

| Subset / status | Exact action and target | Allowed effect and required path | Recovery |
| --- | --- | --- | --- |
| Families 75/86: **denied** | `supabase.orgs.list`, `supabase.project.health`; current project `zmqlyygzqoidkcwdysok` and its owning organization | Existing authenticated Owner performs these read-only calls under normal policy. Organization listing can reveal the Owner's organization memberships; do not grant cross-organization workload access. Record only scoped evidence. Prior workload denials remain final. | Read-only; no rollback. Retire any temporary session through the existing flow. |
| Family 34: **pending exposure decision** | Existing `gcp.region_operations.get` and `.wait`; `elaborate-haven-511518-a5`, one existing DONE operation in a verified region | Review a separate exact exposure/source proposal first; an Owner login alone cannot bypass closed handlers. No new operations or IAM. Optional bounded regional list requires explicit inclusion if needed to select a fixture. | Revert only the separately approved exposure change; provider reads require no rollback. |
| Family 113: **credential unavailable**, admitted 424 | `github.apps.installations.list` and `.verify` descriptors target GET `/repos/ausstyle/web-staging/installation` | Existing GitHub App authentication must be available through the trusted credential service. Have the existing App administrator diagnose the missing binding. No new key, persistent binding, App installation or permission is authorized here. | No provider dispatch occurred; preserve failed receipts. Any future credential change requires its own exact proposal. |
| Family 72: **provider refused**, HTTP 403 | `gcp.security.findings.list`, `projects/elaborate-haven-511518-a5/sources/-`, page size 1 | Existing authorized security administrator diagnoses entitlement/provider access. Runtime owns infrastructure remediation. Do not change IAM or retry with a different identity to evade the refusal. | Read-only; no rollback. Any permission change requires a separate reviewed decision. |
| Handler repair: **pending protected release** | Only `sandy-provider-operation-api` in the current Supabase project, based on v31; exact new source and module manifest required | Existing protected release path with fresh genuine Owner audit for the exact immutable candidate; all original modules/JWT preserved, independent CI, private full rollback bytes and serialized release required. PR222 approval is not reusable for this new source. | Restore captured v31 modules only if deployed modules still match the candidate; verify every module and JWT. Do not overwrite a later release. |

The smallest immediate Owner action is the two existing read-only Controller calls for 75/86. It does not unblock the regional exposure, App authentication, Security Command Center entitlement or new provider release. Those are distinct decisions with distinct effects, not a blanket grant request. Meanwhile API code, contract review and eligible scoped acceptance can continue.
