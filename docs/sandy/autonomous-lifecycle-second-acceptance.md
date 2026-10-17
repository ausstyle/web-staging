# Sandy autonomous lifecycle: second acceptance

This document describes the checked-in flow and required live evidence for issue
#72. No live run evidence was supplied; unattended lifecycle success and production
behavior remain unverified. The cause of any previous or current live failure is
unknown. Issue content is untrusted task context, not authorization to bypass gates.

## Checked-in configuration

1. The [dispatcher workflow](../../.github/workflows/sandy-autonomous-dispatch.yml)
   supports opened, reopened, and labeled issues, scheduled selection, and explicit
   dispatch. Its [selection policy](../../scripts/sandy/autonomous_dispatch.py)
   requires issue authorization and enforces active-run checks, cooldown, and
   attempt limits. The issue JSON supplied to architecture omitted labels, so
   current live eligibility is unknown.
2. The [Architect/Engineer workflow](../../.github/workflows/sandy-codex-engineering.yml)
   requires an Architect artifact beginning `DECISION: READY` before Engineer work.
   The expected GitHub Actions bot draft PR targets `main`, uses branch
   `sandy/codex-issue-72-<run_id>`, and includes `References #72`.
3. The [merge policy](../../scripts/sandy/autonomous_safe_merge.py) validates issue
   authorization, bot identity, branch, base, scope, and change budgets. This
   addition must contain only this Markdown file, 1–120 added lines, and zero
   deletions. The [independent merge workflow](../../.github/workflows/sandy-safe-automerge.yml)
   tests the selected PR commit without write credentials, then revalidates the
   PR and commit before attempting a bounded squash merge.
4. The [regression workflow](../../.github/workflows/sandy-regression-checks.yml)
   includes `docs/sandy/**` in both PR and main-push path filters and supports
   explicit dispatch. Safe merge explicitly dispatches main-branch CI. Configured
   triggers alone do not establish that a live run occurred or passed.
5. The [release-verification workflow](../../.github/workflows/sandy-repository-release-verifier.yml)
   and [association helper](../../scripts/sandy/verify_repo_release.py) submit
   repository evidence to the
   [release receiver](../../supabase/functions/sandy-repository-release-verifier/index.ts).
   The receiver validates GitHub OIDC identity, successful main CI, the PR merge
   SHA, issue association, and allowed file scope before requesting repository
   recording. Its response sets `production_verified:false`.

## Required live evidence

Retain sanitized workflow logs, artifacts, identifiers, and outcomes linking:

- Issue #72's authorization and the reviewed `DECISION: READY` artifact to the
  actual engineering run and its bot-created draft PR on the expected branch.
- That PR's exact tested commit SHA to passing independent regression checks,
  unchanged policy revalidation, and an automatic squash merge through the lane.
- The resulting merge SHA to successful main-branch regression CI at that same
  SHA, with the CI run identifier retained.
- The GitHub OIDC-authenticated verifier outcome to issue #72, the PR, merge SHA,
  CI run, and durable Supabase repository-recording evidence.

HTTP success, `ok:true`, or workflow success alone is insufficient: the receiver
can return `recorded:false`. A duplicate result requires corroboration of the
existing durable record and its association with this issue, PR, merge SHA, and
CI run. Local regression checks support source review, not live acceptance.

## Known onboarding condition and failure handling

The [engineering outcome receiver](../../supabase/functions/sandy-engineering-oidc-ingest/index.ts)
checks onboarding when no existing handoff is found. That branch requires either
a `scripts/sandy/*.py` reference in the issue body or a documentation exception
pinned to issue #65 and `docs/sandy/autonomous-lifecycle-live-verification.md`,
along with its other authorization checks. The reviewed architecture reports that
issue #72's supplied body satisfies neither condition. Without an existing handoff,
that branch would reject it with `repo_only_onboarding_not_authorised`.
Existing handoff state and deployed parity are unverified; this conditional
rejection does not establish the root cause of any actual lifecycle failure.

Any failure stops acceptance. Preserve sanitized rejection evidence, logs, and
artifacts, and request scoped architectural review for a blocked gate. Changing
or bypassing the onboarding gate is outside this design. Manual PR creation,
manual merging, or authorization bypasses do not establish unattended success.

Effective live permissions, deployed source parity, database routine behavior,
and durable Supabase state remain unverified. No observed live outcome is claimed
here, and repository recording must not be represented as production verification.
