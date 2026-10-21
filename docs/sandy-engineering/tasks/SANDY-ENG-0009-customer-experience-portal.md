# SANDY-ENG-0009 — Customer Experience, Portal and Controller

Version: 1.0 · 21 October 2026  
Status: DRAFT — target design; customer workflows require acceptance testing  
Priority: P2; critical chat usability or false-state defects feed the P0 reliability work immediately  
Owner: Sandy Product Experience Engineering / Codex  
Master: §§2, 7–11, 13.3, 16–19; AC-07–10, AC-12  
API requirements: 143–145, 148, 150–160 as consumed by the interface  
Contracts: SC-01, SC-03–08 in [shared architecture](../architecture-contracts.md)

## 1. Outcome and scope

Customers should understand what Sandy knows, what she is doing, what needs a decision and what actually completed. Chat, Agenda, Calendar, Missions, People/Companies, Memory and files are consistent views of shared domain records. Controller gives authorized operators evidence-backed engineering and service status. A polished interface must not conceal missing backend functionality or invent progress.

This scope owns presentation, interaction, client state and authenticated read projections. It does not implement another mission ledger, memory database, billing policy or calendar sync engine. Preserve the existing frontend stack unless an ADR proves a targeted migration is necessary. Do not undertake a cosmetic redesign that delays current runtime fixes.

## 2. As-built review

Inspect actual customer and Controller routes, shared sign-in/return flow, navigation, chat streaming, task entry, realtime subscriptions, feature flags and API usage. Previously referenced paths are `sandy/app/` and `sandy/controller/`; verify current routing before changes. Establish which pages make direct database mutations or hold conflicting local catalogues, and migrate them to the shared API service contracts without losing sessions or deep links.

Capture reproducible defects: navigation/login flicker, collapsing task lists, lost typed input, stale connection status, ambiguous approvals, timeline timezone errors, missing attachments, repeated page reloads and falsely successful notifications. Use screenshots/traces from consenting fixtures, not customer secrets.

## 3. Target client architecture

`authenticated route/session → capability-aware API client → normalized entity cache → page/view projections → user intent → Sandy API → durable acknowledgement/receipt → realtime reconciliation`

Keep a single shared API client and session manager. Cache keys include tenant, company/workspace scope, actor and resource revision. Clearing/changing tenant or signing out invalidates relevant caches and aborts streams. UI role checks improve presentation but are never authorization. No server secrets or administrator service keys in browser bundles.

Use stable entity IDs and revision-aware cache updates. Realtime notifications invalidate or incrementally update authorized projections; reconnect resumes from a cursor or refreshes a bounded authoritative snapshot. A local optimistic edit has a client mutation ID and explicit pending state until the durable server acknowledgement; unknown provider results remain visible as pending/uncertain. Do not use a five-second full-page refresh to simulate realtime behavior.

## 4. Information architecture and workflows

**Unified conversation:** retain active mission, source references, tool-progress/result cards and unresolved decisions across navigation. Support safe rendering of rich text and actual attachments; no raw provider HTML injection. Reconnect to the existing run after a network interruption. Scrolling preserves the user's reading position; follow the live tail only when appropriate. User-visible tool traces show useful evidence and status, not private model reasoning.

**Agenda and task tree:** Enter creates a sibling, Tab/Shift-Tab changes hierarchy where valid, drag reorder persists stable positions, and quick due-date/priority editing does not open unrelated dialogs. Preserve owner/delegate versus sharing/visibility. Cascading deletion shows impact and uses the authorized server operation; it is not a client-only removal. Comments/files and company/category context use canonical IDs.

**Timeline/Day in Review:** task rows and time-based views share the same records. Support drag-create/resize, dependencies, zoom, DST-aware dates and undo by an explicit versioned compensating command. Do not infer all-day from missing time. Save input immediately; run AI enrichment asynchronously without collapsing rows or overwriting user edits. Date-only deadlines are displayed as dates, not timezone-shifted instants.

**Missions/Needs You:** show objective, accountable owner, steps, dependencies, actual receipts, next action, blocked reason and required decision. An approval binds exact operation/target/input/version/expiry. Once approved, display submission versus execution versus verification separately; retries must not ask the user to re-enter a whole mission.

**Connections/Calendar:** recognize existing authorized accounts and show permission, sync and health separately. Ask for only missing incremental scopes. Display each event's source/read-only status, pending sync and conflicts. Calendar connectivity and synchronization cannot be green simply because a connection record exists.

**My World/Memory Centre:** source-linked, correctable assertions and relationship views from 0006; time-validity and confidence visible when relevant. Correction/suppression actions show actual propagation state. Do not create a graph-local copy of personal facts.

**Sandy Daily/Companies/Autopilot:** briefings are projections of authorized commitments, source-backed developments, completed receipts and pending decisions. Company workspaces preserve personal/company boundaries. Autopilot controls expose delegated scope, budget, expiry, approval thresholds, pause and revoke; the browser cannot grant itself new authority. 0002 owns proactive detection rules, 0004 commitments, 0006 facts.

**Files/voice/video:** show accessible stored artifacts only after creation/readback. Use permissioned download references and explicit expired/unavailable states. Retain room/call continuity across page navigation where supported; recording/transcript consent remains visible.

## 5. Controller and engineering scope manager

Provide a scope tree for Master v1.1 → API specification and numbered engineering scopes. Read the synchronized catalogue through Sandy API. Show source version, immutable Git commit, hash, sync time, design/review status, implementation evidence and last accepted release separately. A synchronized document is not a completed engineering task.

Create/edit scope actions produce a draft/version-controlled Git change through the approved engineering API, validate parent links, update `scopes.json`, and show pending review/sync. Do not edit Git-owned metadata directly in Supabase. Approving a requirement must not mark runtime operations verified. Validate stale revision and concurrent edits; retain history and link release/tests to specific acceptance IDs.

Show connected services, operation eligibility, failures, worker/mission health, source/deployment drift, actual costs and incident ownership. Counts are clickable filtered views, not vanity metrics. Hide sensitive content from ordinary support roles; elevated diagnostic access is bounded and audited.

For engineering credentials, prefer a supported delegated test/service identity workflow from 0005. Do not make repeated exporting of a personal owner token the permanent Controller UX. Never render raw access/refresh tokens in page state, screenshots or telemetry.

## 6. Functional requirements

| ID | Requirement |
| --- | --- |
| UX-01 | One stable session/navigation/client-state model across customer and allowed admin routes |
| UX-02 | Resumable chat/run display without lost input or duplicated submission |
| UX-03 | Fast, persistent task entry, hierarchy, ownership and sharing |
| UX-04 | Correct shared timeline/calendar/day-review semantics and undo |
| UX-05 | Evidence-backed mission/progress/approval states |
| UX-06 | Accurate connection, permission and synchronization status |
| UX-07 | Source-backed memory correction and scoped company views |
| UX-08 | Useful briefing/autonomy controls from shared domain projections |
| UX-09 | Versioned engineering scope and release-evidence management |
| UX-10 | Responsive, accessible, secure rendering and observable errors |

## 7. API, client data and behavior

Consume existing domain operations. New projection contracts, if absent, may include `workspace.summary.get`, `workspace.activity.list`, `briefings.get`, `controller.health.get`, `engineering.scopes.list/get`, scope-change draft/review and sync-status queries. These are proposed contracts to reconcile, not a parallel operation catalogue. Pagination/cursors and tenant-bound filters are mandatory; avoid fetching every task/message on every navigation.

Every mutation carries expected revision and idempotency. On 409 show a recoverable conflict without discarding user input. On auth expiry renew through supported login state and resume safe reads; never automatically repeat an uncertain external write. Offline actions are drafts until confirmed and must revalidate authority/resource state on reconnect.

Use a consistent light, minimal Sandy design, mobile navigation and clear text labels. Keyboard focus, screen-reader announcements, touch targets, reduced motion and contrast require tested accessibility acceptance. Avoid horizontal overflow at common narrow phone widths. Status is not conveyed by color alone. Sanitize rendered content, constrain uploads and prevent open redirects in return/join/download links.

## 8. Proposed performance and observability gates

Optimistic local task placement should normally appear within 100 ms on the tested reference device; durable confirmation is separate and measured. Proposed p95 common cached-view navigation below 500 ms and initial usable workspace below 3 seconds on a declared test network/device, excluding explicit provider waits. Measure rather than claim universal latency. Virtualize large lists where necessary without breaking keyboard or drag interaction.

Record privacy-safe client errors, rejected mutations, reconnects, abandoned drafts, failed uploads, sync lag and unexpected layout resets. Correlate client mutation/run IDs with server receipts. Do not log chat text, tokens or personal document content in analytics.

## 9. Acceptance tests

UX-T01: normal sign-in, sign-out, expired session, return route and unauthorized Controller access. UX-T02: streaming interruption/navigation and resume without duplicate submit or loss of typed draft. UX-T03: Enter/Tab/drag/reorder/delete/comment task flow survives reload. UX-T04: 30-minute timeline task, dependency move, undo and DST case. UX-T05: user entry stays stable during asynchronous AI enrichment/realtime updates. UX-T06: accepted versus verified action and unknown provider outcome are clearly different. UX-T07: connected-but-revoked/read-only/sync-conflicted calendar states. UX-T08: memory correction and company switching cannot leak stale/foreign data. UX-T09: scope draft → Git change → sync → pinned source display, with failed sync shown truthfully. UX-T10: keyboard/screen-reader/mobile layout and hostile Markdown/attachment/redirect tests.

Map to Master SAT-03–05, SAT-08–14 and A5/A8/A10. Include tests at narrow phone and desktop sizes using real supported browsers; no screenshot-only acceptance. Require zero false success states, data loss or tenant leak. A feature without a functioning backend is labelled unavailable rather than a simulated success.

## 10. Delivery, dependencies and rollback

UX-M1: baseline and shared API/session/cache layer; fix chat input/navigation defects needed by 0001. UX-M2: mission/progress/approval and task/timeline consistency. UX-M3: connection/calendar and memory views as their APIs pass canaries. UX-M4: scope manager and Controller evidence. UX-M5: Daily/Companies/Autopilot polish and accessibility/performance acceptance.

Backend contracts can be developed with typed fixtures for UI tests, but production feature flags wait for real backend evidence. Do not make 0003 wait for a complete frontend rebuild. Use one frontend release owner, small version-controlled changes and compatible API revisions. Rollback restores static assets/routes/flags while preserving server mutations; invalidates stale caches without deleting durable data. Record source commit, Pages/app deployment, browser evidence and functional smoke tests before claiming the UI is live.
