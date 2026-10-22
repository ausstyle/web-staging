# P0 runtime implementation — deployed, actual web acceptance failed

## Latest owner-session repair disposition — 22 October 2026, Europe/Rome

Normal Auth confirms the exported owner JWT expired (`bad_jwt`); the owner confirms
its refresh session is browser-only. A later database write changed the deadline
change to `approved`, but its administrative event explicitly has no verified
owner session. No genuine owner event exists. The runner preserved that event and
completed a read-only admission rejection; no V4 upload or status reset occurred.

Prepared repair source `f9958d50b4fd4ebd82f97c8e3be76ad49250a192` refreshes the same
real browser session, atomically records genuine owner approval/attestation, and
adds a separately controlled standing routine release policy without workload
self-approval. 175 local tests and 13 isolated PostgreSQL assertions pass. This
security-sensitive source is **not deployed**, its migration is **not applied**,
and its standing policy is **not active**. Automatic policy evaluation currently
requires an active signed-in Controller browser; unattended delegation is not
implemented. [Execution handoff, exact pins and limits](evaluations/p0-owner-session-repair.md)
are reviewable. The original deadline source/manifest and live V4 29 / workspace 46
remain unchanged; the corrected overdue-task result remains untested.


Scopes: SANDY-ENG-0001, 0003, 0004 and 0006. As of the 21 October 2026
23:28 UTC readback, the approved `addfc2ac5b933567c003466a8668a7b864330797`
web source is **V4 29 / workspace 46**. All 26 + 2 local modules still match
its approved manifest. Later published revision refreshes changed revision numbers
without changing the captured source. The single consenting pilot is unchanged.

Owner-approved change `0bef5a45-bdb8-4279-867b-49507c852317` deployed the exact
`5eb1f2c84086db4a067b484cd3de7c5ce6cec182` Examiner caller fix as **full-cycle 19**.
Its actual prior revision was 18, byte-identical to reviewed v13; the release
reconciled that metadata drift, held a component lease, captured rollback source
and verified all three candidate modules. No other source or secret was deployed.
[Actual release evidence](evaluations/p0-examiner-gateway-production-evidence.json)
records the pinned approval, versions, source preservation and live results.

Real [Examiner run 39693113668](https://github.com/ausstyle/web-staging/actions/runs/39693113668)
completed all 12 pilot API requests: 12 HTTP 200, 12 completed tasks, 12 scored
judgments, zero gateway authentication denials and zero mutating tools. Results
were **1 pass, 9 fail, 2 needs_review**. Its unchanged question/answer-only judge
has no tool/source receipts; unsupported-evidence findings cannot independently
disprove otherwise verified records. The frozen 60-case quality gate is unpassed.
The separate historical thread-review caller still has its legacy auth defect.

The owner submitted two actual signed-in web turns in one conversation. Both
used V4 and successfully called the real task tool; four broker rounds succeeded.
The first task summary was correct. The follow-up incorrectly reported zero
overdue tasks when the unchanged record establishes one. [Web acceptance](evaluations/p0-web-customer-acceptance.json)
is therefore **failed**, despite successful authenticated ingress. Both existing
memory-ingestion jobs were skipped: learning is disabled and memory consent is
not recorded. No consent setting was changed and memory persistence is unverified.

Commit `3734254e872fcb2f0b5270aac43f8540b40726a2` prepares server-computed task
deadline evidence for the existing pilot, including partial/unknown coverage,
and includes the earlier V4 identity-label correction. Eight new regression
tests and the offline entrypoint type check pass. Change
`07894248-0808-4ae0-a271-2fb850ec054d` was legitimately registered through the
renewable workload with HTTP 201 after the old token's expiry. It remains
**proposed, not approved or deployed**. The [exact owner approval request](evaluations/p0-web-deadlines-owner-approval.json)
and [27-module manifest](evaluations/p0-web-deadlines-source-manifest.json) are reviewable.

On 22 October 2026 at 01:56 Europe/Rome, the owner explicitly authorized this
registered correction and asked Codex to record approval through the existing
owner workflow. One request with the configured owner-session binding returned
**HTTP 401 Unauthorized**. Independent database reads before and after show
`proposed` with no authenticated owner approval event. Renewable engineering
metadata still returns HTTP 200; its existing grant excludes owner status actions.
All 27 candidate hashes and the unchanged published V4/workspace source were
rechecked. The correction was **not deployed** and no new customer acceptance pass
is claimed. See the [approval-attempt evidence](evaluations/p0-web-deadlines-approval-attempt.json).
The user's authorization is explicit; working owner authentication is still needed
to persist it through the deployed Controller checks. No SQL approval write,
owner impersonation, grant change or secret substitution was attempted.

Engineering runtime 13 and Controller 51 preserve their captured source; email
generator 106, email shadow 17, WhatsApp 162, voice context 19 and gateway 16
also retain byte-identical source. Voice-call revision 38 is metadata only,
not certification of the actual media host. Gmail confirmation, customer data,
workspace memory ingestion and the pilot boundary are preserved. Rollback source
is captured; production source restoration has not been exercised.

The email shadow outcome correction prepared in `69c661a` remains undeployed.
No email/WhatsApp/voice migration or four-channel acceptance is certified.
SANDY-ENG-0001 remains incomplete. Earlier investigation snapshots below retain
their original versions and test outcomes as historical evidence.

## Inspected serving paths

Inspection used authenticated Supabase Management metadata and downloaded
original-source maps on 21 October 2026, before runtime edits. It did not infer
deployment from GitHub. The isolated branch starts from PR #136 commit
`81bb9c7dd8fa3e7df1d05c4718af314a6c00dbde`, merged with current main's governing
scopes. The API checkout and its uncommitted work remain separate.

| Channel | Observed serving source | Consolidation finding |
| --- | --- | --- |
| Web | `sandy-workspace` 39 → `sandy-agent-runtime` 61 → release-selected V4 22 | V4 enabled; original-source parity established for V4 and imported API modules, except the already newer API transport file |
| WhatsApp | `sandy-whatsapp-webhook` 156 | Some text/Gmail requests use central runtime; other requests use independent gateway/model/tool policy. All five adapter source modules match the pinned API branch |
| Email | `email-ai-generate-draft` 100 | Independent routing, memory/context and tool loop remain; downloaded source is retained privately |
| Voice | `sandy-voice-account-context` 13 plus separate media/runtime host | Context endpoint shares policy/memory metadata; independent voice reasoning/media topology has not been certified |

Active release controls selected V4 with V2 rollback. Last-day conversation-audit
metadata showed actual V4 model requests, but response-envelope success is not
answer adequacy or proof of task completion. No quality percentage is claimed.

## Changes prepared

The existing V4 dispatcher still uses the shared authorized Sandy API application
boundary. Its new guarded loop validates offered schemas, preserves original
tool-call IDs and actual outputs, rejects malformed/replayed calls, suppresses
repeated intended effects, permits fresh readback after a successful write,
enforces call/round/deadline admission budgets, and stops on uncertain results.
Incomplete model output, pending jobs, failed tools and pending calls after the
round limit cannot become a completed result. Partial/unknown outcomes are
persisted explicitly; they do not promise unscheduled background work. The direct
Gmail confirmation shortcut now requires the existing executor's independently
verified Sent Mail receipt within the canary. Web replies preserve these outcome
fields, store partial/unknown answers as failed rather than completed, and retain
their safe response text in later follow-up context. Legacy successful response
shapes remain compatible.

Deployed workspace 39 contains a newer temporal-ingestion hook absent from the
branch baseline. Its full block is preserved byte-for-byte; this change must not
redeploy the older source without it. The existing broader transport timeout
allowlist from the parallel API branch is also preserved.

Service-authenticated channel history is normalized without importing roles or
authority. The WhatsApp canary passes its already sender/phone-scoped recent
history to central reasoning and retains the actual follow-up, replacing the
adapter's hard-coded rewrite of ambiguous retries into a Gmail query.

Rollout is restricted to explicitly configured customer UUIDs in the server-only
`SANDY_EXECUTIVE_CANARY_CUSTOMERS` allowlist, configured consistently for V4 and
the WhatsApp adapter. Empty, wildcard, malformed or oversized configuration
enrolls nobody. The captured compatibility loop uses the same model/API boundary
outside that cohort. No new service, provider executor, memory database or mission
queue was introduced. The V4/workspace portion is now deployed as recorded above;
the WhatsApp adapter follow-up remains **not deployed**.

This is a bounded reliability correction, not a full independent Truth Engine,
adaptive-model-policy replacement, memory-correction implementation or durable
Mission migration. Existing operation receipts remain the authority for effects.

The next guarded-loop correction maps all existing SC-04 truth states explicitly.
Failed, partial and admission-only receipts cannot be overwritten by fluent model
text. Unsettled results fence subsequent mutations in the batch or later rounds;
authorized readback remains possible. An unknown outcome stops immediately without
redispatch. Pending Gmail drafts retain their actual body and explicit confirmation
reference, including when a deadline prevents further model work; no send is implied.
Responses arriving after the execution deadline cannot publish a final
answer. Sixteen of seventeen focused deterministic regressions failed before this
fix; all now pass, with eight additional positive/contract/draft-flow checks.

The enrolled **web** canary now reuses `sandy_memory_settings` and
`sandy_temporal_current` to build whole JSON evidence records. It preserves subject,
fact and source IDs; excludes foreign/sensitive/expired/rejected/unscoped evidence;
retains uncertainty and temporal bounds; and reports partial or unavailable coverage
explicitly. Memory consent is checked before the read and again before returning.
The existing SQL projection remains the correction authority. No new memory writer,
index or store was added; other channels and archive/history tool policies retain
their existing contracts. Global correction/deletion propagation is not certified.

## Verification and evaluation

104 deterministic executive/history/outcome/receipt/context/rollout tests passed. Twelve existing API
runtime/profile/preflight regressions passed. V4, workspace and WhatsApp entrypoints passed
TypeScript checks using the repository's offline imports. The separately
deployed renewable Controller prerequisite has its own
[live evidence](renewable-controller-evidence.json), 34 local tests and nine
rollback-only PostgreSQL assertions. The new temporal integration test passed ten
assertions against the actual RPC in a rolled-back synthetic transaction, and an
independent query confirmed zero retained fixture facts. This tests the database
contract, not customer authentication. See [current slice evidence](evaluations/p0-receipts-context-evidence.json).

The [frozen 60-case cohort](evaluations/p0-cohort-v1.json) covers retrieval,
follow-ups, capabilities, memory correction, multi-step effects, failures and ten
cross-channel handoffs. No customer scenario has been scored yet.
`score_runtime_acceptance.py` rejects missing/mock evidence, duplicate cases,
critical failures and false critical completion claims; it reports unrun cases
instead of treating unit tests as quality measurements. Its seven gate tests
passed. Designated holdouts still require independent reviewer execution/labels.

The real baseline capturer calls the existing web ingress with the pilot's
normal Auth session and verifies that session belongs to the approved pilot.
It starts with five read-only questions, creates their normal chat records,
stores responses privately outside Git and never automatically retries an
uncertain turn. Capture does not supply independent quality labels.

## Remaining concrete prerequisites

The owner authorized pilot API tests and offered an already verified WhatsApp
account on a separate customer. A new WhatsApp test account is not required.
Those identities stay separate; one account's consent does not merge tenants.
The Gmail pilot has an unrevoked portal binding and ACTIVE Google connections.
No customer Auth session was minted or impersonated.

The existing OIDC Google lab profile, inspected from deployed gateway 85, passed
on [run 39676846622](https://github.com/ausstyle/web-staging/actions/runs/39676846622).
Gmail, Drive and Calendar read checks passed. Both actual runtime probes passed;
Gmail subjects and result count matched an independent provider read. The
[metadata-only baseline](evaluations/p0-pilot-api-baseline-20261021.json) records
versions and limitations. These two fixed lab probes do not constitute the frozen
60-case cohort or demonstrate the guarded loop, browser authentication or channel
handoffs. Three external server-credential requests were rejected before task
execution; no runtime security was changed to make them work.

The separate general API QA workflow failed; its database summary remained
running with zero recorded attempts. Six individual receipts later persisted:
one pass and five requiring review. These are useful baseline observations but
do not establish a completed or accepted QA run.
Its inaccessible GitHub log endpoint and missing final receipt remain diagnostic
limitations. Real browser acceptance still needs a normal consenting pilot
session; voice consent and same-customer channel handoffs remain outstanding.

Baseline/candidate comparison, 95% adequacy, 98% routine tool selection, 95%
supported citations and the ten real cross-channel handoffs remain unrun. The
scorer correctly returns an incomplete gate. Consent/identity setup is a required
prerequisite, not a failed customer scenario.

Next slices must map the existing `sandy_mission_runs`/task/receipt workers to
SC-03 leases/checkpoints/continuation and source-backed correction interfaces;
the current model-round operation is not durable mission admission. The inspected
registry has internal runtime operations with exposure/verification disabled;
that does not certify general customer mission operations. Preserve IDs and
existing workers instead of adding competing queues or provider plumbing.

Email and voice migration, source-backed memory/World Model improvement, model
routing evaluation, persistent recovery and proactive triggers remain work under
the same scopes. The bounded web canary has passed source release and functional
checks. Further channel deployments still need measured quality and their own
actual authorization, provider, memory, tool, Mission and continuity evidence.

## Authentication test disposition

The optional pilot secret remains skipped. The old personal Controller token was
not retried, no unrelated credential was substituted, and no owner/customer session
was minted. The existing renewable engineering identity successfully registered
the concrete deadline repair (HTTP 201) and recorded its local test plus the real
failed web acceptance. The earlier canary release was not blocked by Controller expiry. The later deadline
release owner-recording request is now blocked by HTTP 401 from its configured
owner session; this does not invalidate successful scoped engineering renewal.

The actual current Controller owner event independently authorized the pinned
Examiner source and manifest; the existing configured Management credential
performed that approved deployment under its component lease. Twelve actual
scored judgments verify that full-cycle gateway authentication now works without
another secret or changed policy. The historical thread reviewer is a separate,
unchanged function with the same old caller defect and requires its own scoped
correction. See the [current blocker ledger](evaluations/p0-authenticated-test-blockers.json).

## V4 deadline release and Amendment B (22 October 2026)

The existing deadline change `07894248-0808-4ae0-a271-2fb850ec054d` was read as
`approved`. Following the latest explicit owner instruction to proceed with that
record, the guarded release deployed **V4 30**, source
`3734254e872fcb2f0b5270aac43f8540b40726a2`, manifest
`1cd49be83211912bae2fce62bf0f0415a486e5f904a48acc65f4c852b2986017`.
All 27 original modules match. The lease was released and the prior v29 bundle
was captured privately; a live restore was not exercised. The administrative
approval event remains administrative: no owner Auth event or new approval
status was manufactured. Workspace 46 and its memory-ingestion source are unchanged.

The real authenticated fixed-pilot API test returned HTTP 200 and correctly
identified **one outstanding, overdue task**. Its successful `list_tasks` receipt
has complete coverage, fresh `as_of` and `total_overdue: 1`; independent database
readback confirms the task and deadline are unchanged. Engineering Control
recorded this result through the renewable workload (HTTP 201; test
`2375ec4b-d6d7-4e5d-9cbd-cccbeb08fe4b`). The original signed-in follow-up has not
been repeated. See [release evidence](evaluations/p0-web-deadlines-production-evidence.json).

The full real Examiner rerun completed 12 cases: 0 pass, 9 fail, 3 needs review.
Its text-only judge does not receive tool receipts and failed even the independently
verified overdue answer for missing evidence. These scores remain visible and are
not converted into a cohort pass. The frozen 60-case quality gate remains unmet.

Master v1.2 Amendment B now governs routine engineering. The prepared implementation
uses the existing renewable identity and Control grant: administrator-only
provisioning, workload policy admission, exact source/manifest/module checks,
trusted CI, risk/target/expiry/budget checks, revocation, audit, rollback capture,
component lease and a single guarded Management upload. Routine execution has no
owner-browser scheduler or individual approval click. Local verification passed
189 composed tests, 26 isolated PostgreSQL assertions and five transport tests.

**This policy implementation is not deployed or activated.** A real call to the
current runtime returned HTTP 403 `engineering_control_scope_denied`: the existing
live grant has only register/get/list/test/artifact. Amendment B forbids the workload
from creating or expanding its own delegation. The legitimate owner refresh
session is browser-only and inaccessible to this runner. No secret or repeated
individual approval is requested. The security foundation and bounded standing
grant require the existing legitimate administrative provisioning path before the
two unattended production release cycles can be certified. See
[implementation and blocker evidence](evaluations/p0-amendment-b-evidence.json).

## Remaining channel acceptance

| Channel | Current verified boundary | Required real acceptance still missing |
| --- | --- | --- |
| Web | V4 30 / workspace 46 source verified; real API overdue result corrected to one; original signed-in turns retained | Repeat the signed-in same-conversation follow-up; consented web memory/provenance, failure/uncertain outcome cases and full baseline/candidate quality cohort |
| Email | Generator 106 source preserved; shadow 17 remains the prior implementation | Deploy/review the shared shadow outcome adapter; verify inbound sender authority, quoted content, attachments, shared model/tool policy, draft confirmation, deduplication and delivery receipts |
| WhatsApp | Webhook 162 source preserved; existing verified alternative account remains separate | Release the prepared scoped follow-up adapter after web gates; actual verified inbound/replay/follow-up tests and permitted Mission/memory handoffs |
| Voice | Account context 19 / call function 38 observed; context source preserved | Consented active private voice session, actual media/tool loop, interruption/recovery and voice-to-web continuation |

The offered WhatsApp account belongs to a different customer from the web/Gmail
pilot. Do not combine them to claim same-customer continuity. All four channels
must pass the common Executive Orchestrator, memory, model-routing, tool and
Mission contracts before SANDY-ENG-0001 can be marked complete.
