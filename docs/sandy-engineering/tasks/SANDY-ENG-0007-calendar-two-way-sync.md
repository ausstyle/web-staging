# SANDY-ENG-0007 — Automatic Two-Way Calendar Synchronization

Version: 1.0 · 21 October 2026  
Status: DRAFT — target design; production bidirectional behavior not certified here  
Priority: P2 customer feature; fix any reproduced data-loss/security defect immediately  
Owner: Sandy Calendar Integration Engineering / Codex  
Master: §§3, 7–10, 12–15, 17–19; AC-06–07, AC-09–10  
API requirements: 145, 148, 153, 157; shared 3–11  
Contracts: SC-01, SC-04, SC-05, SC-07 in [shared architecture](../architecture-contracts.md)

## 1. Definition of done and non-goals

A customer's authorized Google Calendar or Outlook change automatically reaches Sandy Calendar, and an authorized Sandy edit reaches the selected source calendar, without a manual import, page refresh or new prompt. Creates, updates, cancellations, recurrence and timezone semantics remain correct, and retries do not duplicate events or invitations. The customer sees the actual source, direction, last successful sync, conflict and action required.

This is a deterministic synchronization service, not an LLM reasoning loop. Natural-language scheduling uses the orchestrator, but replication does not require a model call or completion of the entire 161-item API scope. A connected Composio account provides authorization context, not proof of sync. Do not copy every event across every connected calendar: Sandy is a unified view with explicit source mappings. Cross-calendar publication is a separately authorized action.

## 2. Existing implementation and ownership

Metadata inspection confirmed `sandy_calendar_connections`, `sandy_calendar_sources`, `sandy_calendar_events`, `sandy_calendar_event_links`, `sandy_calendar_outbox`, `sandy_calendar_sync_jobs`, task links and unified-event projections. Inspect deployed writers, credentials references, triggers, subscriptions, cursors and existing consumers. Reuse the canonical event store and repair its outbox where possible; do not create a second imported-event table with independent truth.

0007 owns calendar normalization, provider mappings, conflict semantics and subscription/cursor state. 0004 provides durable delivery/leases and receipts; 0005 provides authorized provider operations and connection broker; 0009 provides UI. Calendar/source IDs and OAuth accounts must remain stable during migration.

## 3. Architecture

`Google/Graph notification → validated inbox → coalesced calendar sync job → incremental/delta reader → normalized projection + mapping transaction → Sandy event change`

`Sandy edit → validated canonical event revision + outbox transaction → source-specific provider write → readback/receipt → mapping baseline update`

A subscription manager renews watches and handles lifecycle notifications. A scheduled reconciler repairs missed notifications and cursor expiry. A worker lease serializes writes/cursor advancement for each `(tenant, connection, calendar, sync-window)` partition. Use existing 0004 queue contracts, not ad hoc forever-running Edge functions. Persist before webhook acknowledgement; do slow provider reads asynchronously.

### Source connection lifecycle

`DISCONNECTED → AUTHORIZED → DISCOVERING → INITIAL_SYNC → ACTIVE`, with `DEGRADED`, `REAUTH_REQUIRED`, `PAUSED`, `REVOKED` and `ERROR` paths. Discovery, capability checks and sync health are separate. Reuse existing connections after checking actual account, calendar permissions and scopes. Ask for incremental calendar consent only when a required scope is missing; do not request Gmail access just to sync Calendar.

## 4. Provider-specific constraints

Google push messages are change notifications rather than full event bodies, watches are resource-specific, and missed delivery is possible [G1]. Use incremental reads and persist the final sync token only after applying every page; expired tokens require a new full synchronization [G2]. Microsoft calendar-view delta tracks a defined calendar/time window with opaque continuation links; track each calendar/window independently and do not silently depend on beta whole-calendar behavior [M1]. Graph webhook validation, clientState checks and lifecycle renewal need their provider-specific handling [M2, M3].

The following implementation policies are Sandy design choices, not claims of stronger provider guarantees:

- Preserve raw provider IDs and versions, source account/calendar binding, normalized fingerprints and last-synced base fields.
- For Google, register expected channel identity and an opaque random channel token before accepting the watch response; handle an initial notification that races that response. Validate channel/resource/token and rate-limit notifications. Do not invent a Google HMAC signature contract.
- For Graph, implement the required validation-token response separately from normal notifications; verify subscription/account mapping and clientState, and use supported richer-token validation only if selecting that notification mode. Prevent unbounded unauthenticated body parsing.
- Renew before provider-returned expiry with jitter and a safety margin. Overlap old/new subscriptions until the replacement is confirmed; duplicates remain harmless.
- Follow returned pagination/delta links only for permitted provider origins and the bound resource; treat them as sensitive opaque cursors, not arbitrary fetch URLs.
- Schedule reconciliation even when webhooks appear healthy. Distinguish notification receipt, cursor application and successful outbound propagation.

## 5. Data model and event identity

Canonical event: tenant, source owner/account/calendar, stable Sandy ID, title/details/location, organizer, attendees/status, timed or all-day representation, recurrence, visibility, revision and cancellation state. Mapping: Sandy event ID, provider event ID, series/master ID, original occurrence identity, provider version/etag, base fingerprint, last inbound/outbound revision and tombstone. Connection: provider scopes/credential reference, account owner, health and consent. Sync partition: cursor/window, lease/epoch, subscription identity/expiry, last success, pending count and error. Outbox: intended effect identity, canonical event revision, base provider version, retry/reconciliation state and receipt.

All-day events are date ranges with exclusive end-date semantics where applicable, not arbitrary midnight UTC timestamps. Timed events preserve UTC instants, IANA timezone, intended local wall time and provider-zone mapping. Do not overwrite a recurring master when editing an occurrence. Store exception/cancellation identity relative to its series; preserve provider-only properties rather than discard them during normalization. Shared calendar or read-only source status must be visible and enforced.

## 6. Synchronization algorithms

**Initial sync:** discover authorized calendars; select scope and write destination explicitly; create subscription/cursor partition; page into a staging generation; normalize/deduplicate; promote only when complete. Preserve pre-existing Sandy edits/outbox. First sync cannot mass-delete events based on an incomplete provider response.

**Inbound incremental:** validate and coalesce wake-ups; claim the partition; fetch every page; apply creates/updates/tombstones idempotently against provider version and source identity; persist cursor after the complete batch. An event leaving a Graph calendar-view window is not automatically a global deletion. Track window membership separately and re-read uncertain records. Extend/move windows with overlap and full reconciliation.

**Outbound:** validate organizer rights, selected calendar, intended invitation effects and expected event revision; enqueue atomically with local save; use supported provider idempotency/correlation markers; conditional update against provider version; read back resulting event; save mapping and receipt. A network timeout after creation becomes UNKNOWN_OUTCOME; reconcile by stable marker/provider ID before a retry. A pending edit is not labelled synced.

**Conflict:** use three-way comparison of last synchronized base, current Sandy fields and current provider fields. Merge disjoint safe field edits; ignore equivalent normalized echoes; create a visible conflict for concurrent incompatible time, recurrence, attendees, organizer or cancellation changes. Never rely on last server arrival time as an implicit user choice. Define deterministic resolution options and preserve both versions until resolved. Provider permission/read-only status overrides outbound intent.

**Deletion/cancellation:** distinguish organizer cancellation, attendee decline, removal from a personal calendar and source disconnect. Retain a bounded tombstone so delayed messages cannot resurrect an event. Do not notify attendees twice. Disconnect stops sync/subscriptions and optionally removes local projections only under the user's chosen policy; it does not delete provider events by default.

**Recovery:** on cursor expiry, rebuild only that source partition with a staged generation, retaining local pending writes and conflict baselines. Backoff on rate limits, pause on revoked auth, handle lifecycle `missed`/removed subscriptions and surface errors. Periodic reconciliation is the safety net, not a substitute for event-driven operation.

## 7. Functional requirements and API contracts

| ID | Requirement |
| --- | --- |
| CAL-01 | Detect existing authorized connections and enumerate selected calendars accurately |
| CAL-02 | Maintain provider watches/subscriptions and automatic renewals |
| CAL-03 | Durable, idempotent incremental inbound sync |
| CAL-04 | Outbound creates/updates/cancellations with readback |
| CAL-05 | Stable identity and echo/duplicate/invitation suppression |
| CAL-06 | Recurrence, exceptions, all-day and DST correctness |
| CAL-07 | Three-way conflict handling and read-only enforcement |
| CAL-08 | Cursor recovery and missed-webhook reconciliation |
| CAL-09 | Immediate revocation and customer/company isolation |
| CAL-10 | Accurate sync status, diagnostics and user controls |

Map target behaviors to canonical Sandy API IDs: calendar connection discovery/status; source selection; event list/get/create/update/cancel; sync enable/pause/resume/reconcile/status; subscription inspect/renew; conflict list/resolve. Inputs bind connection/calendar/event, expected version, intended attendee effects, idempotency and actor. Results include pending/synced/conflicted state, canonical/provider versions, cursor age and receipts. Internal webhook ingress and scheduler callbacks are authenticated by their appropriate provider/workload mechanism, not customer API keys embedded in callback URLs.

## 8. Security and UX

Encrypt credential/cursor references and redact event content from logs. Revalidate selected source ACLs before writes and after connection changes. No cross-tenant calendar enumeration through guessed IDs. User-facing UI shows source calendar, writable/read-only status, last successful inbound/outbound sync, pending work, conflict and reconnect action. “Connected” must not be used as a synonym for “sync healthy.” Task-to-event linkage must not change task ownership or duplicate the task when a provider event changes.

## 9. Verification and operating targets

Use `sandyemail.ai@gmail.com` only through its existing authorized Google connection and an explicitly authorized Outlook fixture account; no guessed customer identity or external attendee invitation. Clean up only test resources created by the suite.

CAL-T01–T04: create, update and cancel in Google→Sandy, Sandy→Google, Outlook→Sandy and Sandy→Outlook, with actual provider/client observations. CAL-T05: repeat duplicate/out-of-order notifications and timeout-after-create; zero duplicate events/invitations. CAL-T06: recurring master, occurrence exception, cancelled occurrence and all-day event. CAL-T07: DST gap/fold and cross-timezone move. CAL-T08: incompatible concurrent edits produce a visible conflict. CAL-T09: subscription expiry/renewal, lost notifications, cursor invalidation and process crash mid-page. CAL-T10: revoke connection, foreign-tenant ID and read-only calendar refusal. CAL-T11: Graph window roll without false deletions. CAL-T12: existing connection reuse without unrelated scopes and correct connection/sync UI states.

Proposed pilot target: p95 notification-receipt-to-canonical-apply within 30 seconds and accepted-local-edit-to-provider-readback within 60 seconds for a defined authorized cohort under healthy providers; separately measure provider delivery latency. Reconcile missed changes within a configured five-minute pilot interval subject to quotas. These are measured targets, not promises of instant external delivery. All correctness/isolation/duplicate gates are mandatory; SAT-04, SAT-05 and A8 must pass.

## 10. Delivery, rollback and evidence

CAL-M1: as-built ownership and read-only source/cursor audit; reproduce a real missing event. CAL-M2: one Google source inbound then outbound behind a flag; real canary. CAL-M3: Outlook adapter and delta/window handling; real canary. CAL-M4: renewal/reconciliation/conflicts/recurrence and full failure suite. CAL-M5: migrate existing customers gradually with explicit source selections and monitoring.

Only foundational identity, provider contracts and durable outbox interfaces from 0004/0005 are required; calendar sync need not wait for full orchestrator or provider catalogue completion. Rollback pauses outbound dispatch and renewals, fences workers, preserves mappings/cursors/tombstones/unsent edits and restores compatible readers. Do not clear provider calendars or replay all local events. Reconcile in-flight outcomes before switching adapters.

Deliver connection/source map, migration/backfill evidence, exact subscription/cursor handling, provider test IDs, latency distribution, conflict UX tests, permissions matrix, deployed source version and rollback exercise. No claim of two-way sync based solely on importer success.

## 11. Primary implementation references

Checked 21 October 2026; pin supported API versions and revalidate before coding.

- [G1 Google Calendar push](https://developers.google.com/workspace/calendar/api/guides/push)
- [G2 Google incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync)
- [M1 Microsoft calendar-view delta](https://learn.microsoft.com/en-us/graph/delta-query-events)
- [M2 Microsoft webhook delivery/validation](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)
- [M3 Microsoft notification lifecycle](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events)
