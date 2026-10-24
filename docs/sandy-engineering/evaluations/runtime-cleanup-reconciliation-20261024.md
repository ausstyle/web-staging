# Finite customer mutation cleanup reconciliation — 24 October 2026

Scope: SANDY-ENG-0001, 0005; continuation of PR297 and run
[40054539774](https://github.com/ausstyle/web-staging/actions/runs/40054539774).
This is not acceptance of the eight-workstream Runtime programme.

## Deployed and exercised

PR297 merged at `aa4321c627e083a9a46ffcaa32b357ed74b7cafc`.
Event242 verifies migration20261024022000 and canonical RPC SHA256
`746abc32895b64925f1e2a1aaf7808909b621acaa230d905772018228fceae07`.
API65, MCP24 and worker21 stayed installed; no grants or Edge deployments changed.
The run skipped prior successful public-memory and narrow-cancellation effects.

The finite suite passed130 checks with no failed functional assertions and23
immutable receipts covering all ten existing local task/calendar/file metadata
operations. It covered atomic receipt/base-row readback, replay, rejected arguments,
foreign-profile denial, finite budget, literal-task queue completion, and revocation.
Readiness243 was revoked by245. Proof246 remains immutable and **partial** because
cleanup raised RuntimeError. Its report digest is
`43a94bd777ecd4f3a65330d7520aa31e0480695e6faf7f2042a0faf2ab244bcc`.

## Cleanup diagnosis and independent readback

Provider logs show successful DELETE200 and ObjectRemoved:Delete lifecycle events:

- Primary fixture `2e96b3f4-4b04-4197-9428-1fad91d5bf6d`: deletion02:40:11.300UTC,
  lifecycle02:40:11.395UTC, subsequent authenticated GET200 at02:40:11.435UTC.
- Foreign fixture `a23d5660-07ec-46fd-807f-f1ec61d0f472`: deletion02:40:14.503UTC,
  lifecycle02:40:14.563UTC, subsequent authenticated GET200 at02:40:14.662UTC.

Both exact paths end in `a811dfef3c84402fa1c8cdc020813517.docx` under
`sandy-task-artifacts/customer_mutation_fixtures/<customer>/`.
The immediate read-after-delete returned200; the evidence is consistent with delayed
read invalidation. It is not evidence of a malformed missing-object classifier.
Later authenticated GETs on both exact paths returned HTTP400 with the valid provider
`statusCode=404,error=not_found,message=Object not found` payload, SHA256
`9d2505709301f205e4135106c7c92c66a58d85a1009b5b823475c6a047de1a9c`.

Independent SQL found zero tasks, calendar events, file metadata, analysis queue,
companies and categories for **each** fixture, and zero corresponding storage rows.
Both Auth records are banned with zero sessions, refresh tokens and portal accounts.
Synthetic Auth/customer rows are intentionally retained for immutable receipt foreign
keys; they must not be purged. No additional deletion or mutation was performed.

## Reproducible reconciliation and verifier repair

`reconcile_customer_mutation_cleanup_246.py` pins the original proof/artifact/report,
checks all23 receipts still exist, ten-operation coverage, retired readiness, exact
fixture onboarding provenance, zero fixture residuals, banned/retired Auth and actual
provider object absence. It performs reads only unless explicitly given `--record`,
which appends a separate deduplicated `customer_mutation_cleanup_reconciled` evidence
event. It never edits246, changes flags, deploys, deletes, creates fixtures or repeats
the successful mutation suite. Its result accepts only the original finite scope.

The future suite waits for explicit provider absence after a successful delete:
at most seven reads with six10-second waits, plus network latency. It requests
no-cache reads. HTTP200 never passes retirement; auth/transport errors fail closed.
Auth sessions are retired before storage polling, so provider delays cannot defer
fixture account retirement. Failure evidence now retains a bounded safe error code and fixture index.
The change affects test retirement only and can be reverted without database rollback.

Validation:20 local release/acceptance/repair tests passed, including delayed absence,
persistent200, forbidden responses and malformed404 rejection. Live reconciliation
uses original real receipts and current provider/database reads, not test fixtures.
CI status and the separate reconciliation event are reported in the PR/checkpoint.

Independent source review identified delayed Auth retirement during slow storage reads;
the cleanup order now retires Auth before polling storage. Event250 was independently
read back as finite_acceptance_reconciled, with246 still partial and unchanged.
