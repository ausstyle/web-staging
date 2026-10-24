# Prepared API release requests — 24 October 2026 reconciliation

SANDY-ENG-0005. These are bounded candidate descriptions, **not approved dispatch requests**. No deployment, configuration, grant, exposure or approval mutation was made. PR270's draft-to-ready denial remains paused independently; this work neither retries nor works around it.

## Current shared baseline and regional candidate

Read-only metadata first observed gateway v62, then source capture observed v63, demonstrating active shared releases. The stable bracketed capture is gateway v63, ACTIVE, JWT true, 128 modules, bundle SHA-256 `3cb377480b0fe8f236a60fd50ecf45620b80204e8c4c52ca8473a83066459b82`. Provider remains v31, JWT true, 57 modules, bundle `17f8d544c0ebe5df2aa31b411074f5285aed6739c4128c8e56eda99ec9e081df`. This is a point-in-time baseline, not permission to overwrite later releases.

The new regional read candidate is:

- Source: `4be0ba5950d110d6cb0bbd8434f9ddbf63e7b3b3` (PR258); updated read-only preparation script captures v63.
- Manifest: `26ecefde0c6fddc9dc3d8b64f2fab95113a733625324f26567bb2e87235e6d39`.
- Targets: existing `sandy-provider-operation-api` v31 and `sandy-operation-api` v63 in `zmqlyygzqoidkcwdysok`; candidate totals 58 and 129 modules.
- Effects: existing Cloud Run services list/get accept explicitly scoped `europe-west8`; migration `20261024002500_sandy_cloud_run_region_contracts.sql` revises exactly those two contracts while preserving flags/history. Includes PR246's response classification correction; excludes blob settlement and Storage exposure.
- Preservation: all v63 IAP and cancellation modules remain unchanged; gateway entry changes only the three reversible region argument-flow snippets. No repository-wide gateway replacement.
- Recovery: full private prior bundles and prior two contract rows captured. Persist them through the authorized protected artifact path before any dispatch. Restore only matching candidate source/contracts, preserve JWT/history, refuse to overwrite later versions; unknown dispatch requires readback first.
- Configuration request, separate from artifact: merge only `SANDY_GCP_SCOPE_BINDINGS_JSON.cloud_run_read_region` with `id=europe-west8`, `project_id=elaborate-haven-511518-a5`, `verified=true`, exact activation expiry at most 24h, preserving every existing entry. It covers only services list/get. Remove only this entry on expiry/withdrawal. No IAM or credential changes. A concrete expiry must be selected at authorized activation, not silently refreshed by retries.

The earlier regional manifest `92f42f3c88c81f16f89698976152def247da4bab99bedbd281940c82628aea42` is historical and no longer deployable because it pins gateway v61. The updated preparer also brackets each body download with metadata reads and refuses concurrent version/status/JWT/import-map change without automatic retry. Six guard tests pass. Offline checks loaded both exact candidate graphs, compiled 595 contracts and checked two regional bindings with zero provider/database calls.

The source change `b26705ca-0dad-46df-9966-446a9cf402aa` is still `proposed` and scoped only to its GitHub branch. Its source/test receipts are evidence, not function deployment authority. A separate applicable release record or reviewed pre-established policy must cover both function targets, migration and exact source/manifest before dispatch. Configuration activation requires its own exact coverage. An Owner status transition of this source-only record does not add missing targets.

## Other prepared provider requests

| Candidate | Existing evidence | Disposition |
| --- | --- | --- |
| PR246 response failure classification | Source `f331a036a278056e79fc1d64a4b028a3d6cdd2b2`, standalone manifest `97e3d140c271bb83de8b32c57297ddcbbd6e8deeaa41ee07fd77b590b5737eff`, source record `1a6b4419-bb71-4de5-a91f-818471e52e99` proposed | Included in regional candidate; avoid redundant independent rollout |
| PR251 Git blob settlement | Source `8be8a2b87d5e2c2f8cf141de4356fafb47fa6ce0`, historical manifest `38d9ed949012fdfa074f8c0740969cd82acf6a6ba982b480b20b403e170bcd78`, source record `8c5e710d-8ab2-43c4-a61b-0be7dd7d98fe` proposed | Pins gateway v61; stale, requires separate source/module/migration reconciliation and a new manifest; do not approve old manifest |
| PR270 Cloud adapters | Source `cbfe1653798e25e2b88f93196b34947406a946f1`, test `ba56b0b1-356d-4d66-b984-a626204818ef` | Draft transition denied and paused; no deployed handler/registration or release artifact. Source tests do not authorize activation |
| Storage inventory | Existing `gcp.storage.buckets.list` typed contract | Closed/unverified; no exposure mutation packaged in these candidates |

## Owner route: what is verified and what is still missing

The historical route has actual evidence: change event **131** was re-read and still joins an enabled genuine non-test Controller Owner; event is `status_changed` to `approved`. The exact PR222 release completed in [run 40039377923](https://github.com/ausstyle/web-staging/actions/runs/40039377923). That release is already accepted and must not be replayed.

The existing Owner API route in `sandy-engineering-control` is authenticated `action=status`, `change_id=<exact release record>`, `status=approved`, `reason=<source and manifest pins plus bounded effects>`. It checks current Owner role and calls `sandy_engineering_record_owner_approval` transactionally; the acting workload cannot create this audit by writing status fields. The release record must first be registered with the exact function targets and reviewed expected behavior. Normal existing Owner authentication must be used; no token or identity is requested from the user. This documents the historically proven route, not a new Owner request executed in this session.

**There is no verified end-to-end dispatch route for the new regional candidate yet.** The existing `sandy-provider-response-fix-release.yml` / `release_provider_response_fix.py` is pinned to PR222's source, provider v30 and single function. It cannot deploy the two-function v31/v63 candidate or its database/configuration changes. Do not put the new manifest into that old workflow, reuse audit131, weaken its guards, or describe source preparation as ready deployment. The new candidate still needs a reviewed source-preserving protected executor/lease covering the two functions and guarded migration, with independent CI, recovery persistence, genuine applicable policy/Owner authority and source readback. No ready Owner UI link or new approved record exists for that release at this checkpoint.

The smallest parent decision is therefore sequencing/ownership: keep one shared release owner, reconcile that owner's current gateway baseline, and finish the protected executor before asking for an exact activation approval. Already-authorized source/guard implementation may proceed. Broad setup permissions are unnecessary and would not fix the missing execution implementation. Production rollback remains unexercised.
