# P0 runtime implementation — bounded web canary deployed

Scopes: SANDY-ENG-0001, 0003, 0004 and 0006. The owner-approved source
`addfc2ac5b933567c003466a8668a7b864330797` is deployed as **V4 24 / workspace 41**.
All 28 packaged module entries match the approved manifest. One consenting web/Gmail pilot
is enrolled. Real post-release provider reads and runtime functional tests passed;
production customer-quality and four-channel acceptance remain unverified.
See [production evidence](evaluations/p0-web-canary-production-evidence.json) and
[release/rollback record](evaluations/p0-web-canary-release.md).

The existing OIDC Google lab passed Gmail, Drive and Calendar reads plus both
runtime probes in run 39683647772. Full-cycle run 39683774486 produced 12 HTTP 200
responses and 12 completed tasks with zero mutating tool results. Nine turns used
the V4 model broker, confirmed by 15 successful conversation-audit rounds.
All independent quality judgments failed and remain `needs_review`. `complete`
means the assessment executed; it is not acceptance. These APIs use `channel=test`,
so authenticated workspace/web ingress and automatic web memory remain untested.

Adding the pilot setting refreshed Supabase deployment revisions. Engineering
runtime 8 preserves the newer v7 source; Controller 46, email generator 101,
WhatsApp 157 and voice context 14 likewise retain their captured source.
No additional channel was enrolled. The existing Gmail confirmation and workspace
memory-ingestion code are preserved. No source rollback was exercised.

Commit `69c661a` additionally prepares a V4 identity-label correction and shares
the web/runtime completion contract with the existing email shadow adapter.
Fifteen focused tests and both entrypoint type checks passed. These follow-ups
are **not deployed** and do not migrate the authoritative email delivery path.

The investigation/preparation snapshots below are retained as historical evidence;
their original function revisions are not current deployment claims.

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

The owner skipped optional pilot-session configuration. Continue implementation and
available tests without re-requesting it. The [test blocker ledger](evaluations/p0-authenticated-test-blockers.json)
records the previous Controller HTTP 401 and its resolution. The expired token
was not retried. A real Controller owner approved the immutable source/manifest;
the renewable identity read that approval and recorded release artifacts/tests.
The existing Management credential performed the specifically approved source
uploads; no customer/owner session was minted and no grant was broadened.
The expired personal token no longer blocks this canary release. Customer browser
acceptance remains unrun: the optional session was skipped and no substitute
principal is used. The independent judge failure is a separate unresolved test
infrastructure issue, not evidence of an expired Controller credential.

## Remaining channel acceptance

| Channel | Current verified boundary | Required real acceptance still missing |
| --- | --- | --- |
| Web | V4 24 / workspace 41 source verified; fixed-pilot API checks complete | Signed-in web turns/history, web memory consent/provenance, failure/uncertain outcome cases and full baseline/candidate quality cohort |
| Email | Generator 101 source preserved; shadow 12 remains the prior implementation | Deploy/review the shared shadow outcome adapter; verify inbound sender authority, quoted content, attachments, shared model/tool policy, draft confirmation, deduplication and delivery receipts |
| WhatsApp | Webhook 157 source preserved; existing verified alternative account remains separate | Release the prepared scoped follow-up adapter after web gates; actual verified inbound/replay/follow-up tests and permitted Mission/memory handoffs |
| Voice | Account context 14 / call function 33 observed; context source preserved | Consented active private voice session, actual media/tool loop, interruption/recovery and voice-to-web continuation |

The offered WhatsApp account belongs to a different customer from the web/Gmail
pilot. Do not combine them to claim same-customer continuity. All four channels
must pass the common Executive Orchestrator, memory, model-routing, tool and
Mission contracts before SANDY-ENG-0001 can be marked complete.
