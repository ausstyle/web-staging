# Sandy autonomous lifecycle: live verification

This document describes the checked-in repository flow for issue #65 and the
evidence required to establish an unattended lifecycle result.
It does not establish that any PR, merge, CI run, or Supabase record exists.
This document does not verify any customer-facing production release.

## Configured flow

1. The [dispatcher](../../scripts/sandy/autonomous_dispatch.py) selects opted-in
   issues subject to authorization, cooldown, active-run checks, and attempt limits.
2. The [Architect/Engineer workflow](../../.github/workflows/sandy-codex-engineering.yml)
   requires an explicit Architect READY artifact before independent Engineer work.
   It is configured to create a bot draft PR on `sandy/codex-issue-65-<run_id>`.
3. The [merge policy](../../scripts/sandy/autonomous_safe_merge.py) checks issue
   authorization, bot PR identity, branch, base, and scope. This Markdown path is
   allowed with zero deletions and at most 120 added lines per file.
4. The [independent merge workflow](../../.github/workflows/sandy-safe-automerge.yml)
   tests the selected PR commit without write credentials, revalidates its identity
   and commit, and attempts a bounded squash merge through the existing lane.
   After merging, it explicitly dispatches main-branch regression checks.
5. The [regression workflow](../../.github/workflows/sandy-regression-checks.yml)
   supports explicit dispatch. Its PR/push path filters omit documentation, so this
   addition alone does not promise automatically triggered CI.
6. The [release-verification workflow](../../.github/workflows/sandy-repository-release-verifier.yml)
   uses the [release association helper](../../scripts/sandy/verify_repo_release.py)
   to submit repository verification evidence. The
   [receiver](../../supabase/functions/sandy-repository-release-verifier/index.ts)
   validates GitHub OIDC identity, successful main CI, merge-commit association,
   issue reference, and file scope before requesting a repository verification record.
   Its response explicitly sets `production_verified:false`.

## Required live evidence

- An actual GitHub Actions bot draft PR from the approved engineering run,
  targeting `main`, containing `References #65`, on the expected run-specific branch.
- Passing independent regression checks at the exact PR commit, followed by policy
  revalidation and automatic merge through the existing bounded lane.
- Successful main-branch regression checks whose commit equals the PR merge commit.
- Evidence of an OIDC-authenticated repository verification request and durable
  Supabase recording scoped to repository verification. An HTTP success or
  `ok:true` alone is insufficient: the receiver can return `recorded:false`.
- Retained workflow runs and artifacts that associate the issue, engineering run,
  PR commit, merge commit, CI run, and durable repository verification record.

Local regression results support source review; they do not establish live acceptance.
No manual PR creation or merging qualifies as unattended lifecycle evidence.
On failure, retain visible workflow/artifact evidence and stop without expanding scope.

## Known uncertainty

The [engineering outcome receiver](../../supabase/functions/sandy-engineering-oidc-ingest/index.ts)
requires a `scripts/sandy/*.py` reference in the issue body when onboarding an issue
without an existing handoff. The reviewed architecture reports that issue #65's
supplied body has no such reference. Whether a handoff already exists is unverified;
if none exists, onboarding would be rejected. The root cause of any live lifecycle
failure is unknown. This document does not bypass that check.

Workflow permission declarations do not establish effective live permissions.
Deployed source parity, database routine behavior, and durable Supabase state remain
unverified. Repository verification must not be represented as production verification.
