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
persisted explicitly; they do not promise unscheduled background work.

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

49 deterministic executive/history/rollout tests passed. Twelve existing API
runtime/profile/preflight regressions passed. V4 and WhatsApp entrypoints passed
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

The owner selected `sandyemail.ai@gmail.com`. Metadata confirms its unrevoked
portal binding and an ACTIVE Gmail connection. It has no verified WhatsApp
identity or voice sessions. No customer session was minted or impersonated.
The pilot's normal session is requested securely as `SANDY_PILOT_ACCESS_TOKEN`;
WhatsApp linking and voice consent use their existing verified flows.

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
