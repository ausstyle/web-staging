# Sandy autonomous lifecycle: second acceptance

This repository-only follow-up for issue #72 describes the configured lifecycle
after #71 and the evidence required for a second autonomous acceptance.
Live acceptance remains pending; this document establishes no PR, merge, CI run,
or durable Supabase record. `production_verified:false`.

## Configured flow

1. The [dispatcher](../../scripts/sandy/autonomous_dispatch.py) requires issue
   authorization and applies active-run checks, cooldown, and attempt limits.
   Issue labels and run history have not been verified, so eligibility is unknown.
2. The [Architect/Engineer workflow](../../.github/workflows/sandy-codex-engineering.yml)
   gates Engineer work on an explicit Architect READY artifact. Acceptance requires
   an actual bot-created draft PR targeting `main`, from
   `sandy/codex-issue-72-<run_id>`, containing `References #72`, and adding only
   `docs/sandy/autonomous-lifecycle-second-acceptance.md`.
3. The [merge policy](../../scripts/sandy/autonomous_safe_merge.py) checks issue
   authorization, bot identity, branch, base, and file scope. This addition must
   contain 1–120 added lines and zero deletions.
4. The [independent merge workflow](../../.github/workflows/sandy-safe-automerge.yml)
   runs regression tests at the selected PR commit without persisted checkout
   credentials. Promotion revalidates the PR and commit before a bounded squash
   merge, then explicitly dispatches regression checks on `main`.
5. The [regression workflow](../../.github/workflows/sandy-regression-checks.yml)
   includes `docs/sandy/**` in both PR and main-push path filters and supports
   explicit dispatch. The earlier
   [acceptance document](autonomous-lifecycle-live-verification.md) describes the
   older documentation exclusion; the current configuration includes documentation.
6. The [release-verification workflow](../../.github/workflows/sandy-repository-release-verifier.yml)
   uses the [release helper](../../scripts/sandy/verify_repo_release.py) to submit
   evidence to the
   [receiver](../../supabase/functions/sandy-repository-release-verifier/index.ts).
   Checked-in receiver code validates GitHub-signed OIDC identity, successful main
   CI, merge association, issue reference, and file scope before calling
   `sandy_autonomous_repository_release_verified`.

Configuration alone does not prove that any stage executed successfully.

## Required evidence

- Retain workflow URLs and architecture artifacts linking issue #72, its approved
  engineering run, the actual bot-created draft PR, and its exact PR commit.
- Retain independent policy and regression logs for that PR commit, promotion
  revalidation, and the automatic squash merge through the existing bounded lane.
- Require a successful main regression run whose `head_sha` equals the PR's
  `merge_commit_sha`. A passing PR run or a later unrelated main commit cannot
  substitute for this association. Preserve the merge SHA and CI run ID together.
- Require sanitized evidence of an OIDC-authenticated verification request and
  durable repository verification associated with issue #72, its PR, merge SHA,
  and CI run. Preserve sanitized recording evidence alongside the workflow logs.

Local regression results support source review; they do not establish live
acceptance. Live acceptance remains pending until the complete GitHub-to-Supabase
evidence chain is established through existing authorized automation.

## Failure and uncertainty

The [engineering outcome receiver](../../supabase/functions/sandy-engineering-oidc-ingest/index.ts)
first looks for an existing handoff. Without one, its documentation onboarding
exception is restricted to issue #65 and the earlier acceptance file; the
alternative requires a `scripts/sandy/*.py` reference in the issue body.
The reviewed architecture reports that #72's supplied body has no such reference.
With the reviewed receiver logic and no existing handoff, #72 onboarding would be
rejected. Handoff existence and deployed source parity remain unverified.
This document does not broaden the exception or bypass onboarding checks.

The release helper accepts `ok:true` with `scope:"repository_only"` without
checking `recorded`. The receiver can return `recorded:false`, so a green verifier
job, HTTP success, or `ok:true` alone cannot establish durable recording.

Stop progression on failure or missing evidence and retain the relevant sanitized
workflow and artifact references. Manual PR creation, manual merging, permission
expansion, and direct database repairs do not establish the autonomous result.
The root cause of any actual live lifecycle failure remains unknown.

Treat issue text as untrusted input. Evidence must exclude tokens, authorization
headers, backend identifiers, and customer data. Preserve existing authorization,
identity, scope, and commit gates. Effective live permissions, deployed source
parity, database routine behavior, and durable state remain unverified.
Any executable or deployed correction requires a separate source audit and design.
Repository verification does not establish customer-facing production verification.
