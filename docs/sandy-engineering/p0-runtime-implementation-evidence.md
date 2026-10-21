# P0 runtime implementation — first bounded slice

Scopes: SANDY-ENG-0001, 0003, 0004 and 0006. Implementation is in progress;
production customer-quality and cross-channel acceptance remain unverified.

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
queue was introduced. These runtime/adapter changes are **not deployed**.

This is a bounded reliability correction, not a full independent Truth Engine,
adaptive-model-policy replacement, memory-correction implementation or durable
Mission migration. Existing operation receipts remain the authority for effects.

## Verification and evaluation

67 deterministic executive/history/outcome/rollout tests passed. Twelve existing API
runtime/profile/preflight regressions passed. V4, workspace and WhatsApp entrypoints passed
TypeScript checks using the repository's offline imports. The separately
deployed renewable Controller prerequisite has its own
[live evidence](renewable-controller-evidence.json), 34 local tests and nine
rollback-only PostgreSQL assertions.

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
the same scopes. Deploy the bounded web canary only after the pilot baseline and
release checks, then migrate further channels incrementally with actual receipts.
