# Current verification amendment — 21 October 2026, 23:28 UTC

The approved web source below remains unchanged at current **V4 29 / workspace 46**;
all 28 packaged modules match. The original cutover revisions were 24/41.
The exact pinned Examiner authentication correction is separately deployed as
**sandy-examiner-full-cycle 19**, under owner-approved change
`0bef5a45-bdb8-4279-867b-49507c852317`. Its prior revision 18 had exactly the
reviewed v13 source; the version guard was reconciled while preserving the
approved manifest. Prior source/metadata were captured, all three new modules
matched readback and the lease was released. No production restoration was exercised.

Real Examiner execution produced 12 scored judgments: **1 pass, 9 fail, 2 review**.
Actual signed-in web ingress and two task reads succeeded, but the overdue
follow-up returned zero instead of one. The customer acceptance gate failed.
The existing web ingestion hook ran and skipped both jobs under unchanged memory
settings. No memory-persistence acceptance is claimed. The concrete deadline
repair is proposed as change `07894248-0808-4ae0-a271-2fb850ec054d`, not deployed.

See [Examiner deployment/rollback evidence](p0-examiner-gateway-production-evidence.json)
and [actual web acceptance](p0-web-customer-acceptance.json). The original release
record below preserves its original revisions and earlier test results.

# P0 web canary — approved source deployed, acceptance incomplete

Engineering change: `8ed79487-8eeb-41a6-9e7c-6bc24cee568b` (owner approved).
Parent objective: `7edbee5b-4185-4f6b-b7b1-b41899d4dfc8` (not verified).

The actual authenticated Controller owner approved source
`addfc2ac5b933567c003466a8668a7b864330797` and manifest
`d79833a2643d23ef4b0476517a3899bfd758f255d09602cd342380e4b06c08a9`.
The bounded correction is deployed as **V4 24 and workspace 41**, with all
26 and 2 local modules respectively read back and matched. Only the consenting
web/Gmail pilot is enrolled; its setting hash was independently checked.
The existing renewable workload supplied Controller metadata and evidence. The
configured Management credential performed the explicitly approved uploads under
component leases. No Controller role, workload grant or customer session was
changed. Adding the single pilot setting refreshed deployment revisions: engineering runtime is now 8 and Controller 46. Their newer source is preserved.

See [production evidence](p0-web-canary-production-evidence.json).
The [release helper](../../../scripts/sandy/release_web_canary.py) checks the real
owner event, exact immutable test evidence, source hashes and live configuration,
captures private rollback sources, uses component leases and records Controller
artifacts. It cannot approve a release and never retries an uncertain write.
Its original 22/39 guards make it a one-shot executor for this approved release;
do not rerun it against 24/41 or edit its pins to bypass a new approval.

The whole unified-intelligence program is not verified. Later PR source also
contains a V4 identity-label correction and an email shadow-outcome correction;
**those follow-ups are not part of this deployment**.

## Approved boundary and preserved safeguards

Deploy only `sandy-agent-runtime-v4` and `sandy-workspace` from the pinned approved
commit and transitive source SHA-256 manifest in the change's test evidence.
The captured prior versions were V4 22 and workspace 39.
Reject any changed live version or source digest and reconcile it first.
Acquire their existing component release leases before mutation; notify PR #136
of the exact source/release and release the leases after verification.

The private server allowlist initially contains only the consenting web/Gmail
pilot. An empty or invalid list enrolls nobody. No WhatsApp deployment or other
customer enrollment is included. Keep all runtime/service/customer authorization,
provider execution, operation audit, draft confirmation and send deduplication.
Preserve workspace 39's complete temporal-ingestion hook and the compatible
broader API transport timeout allowlist. The guarded web context also checks existing
memory consent, retains whole subject/source records and reports unavailable/partial
coverage. SC-04 receipt classification fences later writes after unsettled results.
No schema migration or authorization expansion is needed.

## Before and after checks

Post-release Google lab run **39683647772** passed actual Gmail/Drive/Calendar
reads and both runtime probes. Gmail count/subject oracles matched. The existing
full-cycle launch **39683774486** produced 12 real fixed-pilot API requests:
12 HTTP 200 responses, 12 completed tasks and zero mutating tool results. Nine
model-driven turns are identified by the V4 conversation audit (the exact count
and round totals are in the production evidence). These calls use `channel=test`;
they do not certify the authenticated workspace/web adapter or automatic web memory.
All 12 independent quality judgments failed and remain `needs_review`. The
full-cycle's `complete` state records assessment execution, not acceptance.
No 60-case quality score or four-channel pass is claimed.

V4 24's task identity incorrectly inherits a V2 label. The authoritative model
audit and deployed source establish V4 execution; routing settings were not
changed. The separate metadata correction has nine focused tests; the staged
email shadow adapter reuses the shared completion contract with six tests.
Both affected entrypoints type-check. These follow-ups remain undeployed.

The live baseline Google lab run 39676846622 independently verified Google reads
and both existing runtime probes. They use deterministic runtime shortcuts;
they do not measure the new model loop. The frozen 60-case cohort remains unrun.
104 local executive/history/outcome/receipt/context/rollout tests and all three runtime/adapter
entrypoint type checks pass. The separate general API QA run has partial
receipts and a failed workflow; do not turn its counters into acceptance.

After an authorized release, download each uploaded source and compare every
local source file against the pinned manifest. Repeat the existing read-only
pilot lab. Exercise the guarded continuation and final-outcome paths using
properly authenticated consenting/synthetic fixtures; do not mint a human pilot
session. Check stored task/web-turn status and returned completion metadata,
including partial results, expired deadlines, incomplete model envelopes and
uncertain sends. Never send a customer email merely to force a receipt test.

A successful canary does not permit general rollout. Broader release still needs
actual baseline/candidate quality scores and all mandatory isolation, duplicate,
false-completion and same-customer cross-channel evidence.

## Rollback

On an authorization, duplicate-effect, false-completion or material quality
regression, stop enrollment by clearing the canary allowlist. This selects the
captured V4 compatibility loop. Preserve all accepted tasks and operation/send
receipts; never replay sends or queued events as rollback.

With the same release leases and new optimistic version checks, restore the captured
original workspace 39 and V4 22 source snapshots if needed, retaining the original
workspace memory-ingestion block. Read back restored source and run the existing
read-only lab again. Restore a prior allowlist only after resolving the defect.
Keep historical failed evidence and report any unknown external outcomes.
The production source restore has not been exercised; retained snapshots and
source comparisons are rollback preparation evidence, not a successful rollback.

The optional pilot session was skipped by the owner. Do not request it again or
substitute project keys, engineering sessions or a different customer to mark a
browser/customer test passed. Retain authenticated release/acceptance blockers in
[p0-authenticated-test-blockers.json](p0-authenticated-test-blockers.json) and continue
independent work. Pinned source evidence for the current candidate supersedes the
older `ffc68c6` preparation record without altering historical test results.
