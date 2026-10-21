# Sandy Timeline Lab — interactive staging preview

**Location:** https://ausstyle.github.io/web-staging/sandy/timeline-lab/

**Acceptance tests:** https://ausstyle.github.io/web-staging/sandy/timeline-lab/tests.html

**Environment isolation:** Static application under \`/sandy/timeline-lab/\`. No production Supabase queries, Microsoft Graph calls, email sends, calendar writes, mission execution or customer-file uploads. State is saved only in local browser storage. The fixture tasks and calendar events are synthetic demonstration data.

## Implemented interactive test features

- Visually mapped timeline using a shared timestamp-to-pixel function for task bars, markers and dependency connector endpoints.
- Hour/day/week/month/quarter zoom; horizontal timeline pan/scroll; frozen task names; task search and owner filter.
- Move tasks and milestones; resize start or finish at 15-minute increments; mobile/desktop pointer handling and live date-time bubble above the active edge, clamped to the viewport.
- Hover-only resize and link handles, with keyboard focus support.
- Dependency routes remain visible and selectable; right-click or click to edit/delete; FS/SS/FF/SF types and explicitly configurable lead/lag; no implicit +24-hour delay.
- DAG cycle detection; dependent tasks snap to the latest predecessor boundary preserving their own duration; date constraints; error messages and atomic rollback of failed in-memory edits.
- Inline completion checkboxes update actual task end time and downstream schedules.
- Task grouping, expand/collapse, drag-and-drop reorder/nest and invalid hierarchy prevention.
- Undo and redo, local action history, saved baseline display, longest-path critical highlighting and simple workload summaries.
- Task details, owners, priorities, simulated Mission status, notes, references and comments.
- Sample calendar events, data export to CSV/JSON and browser print-to-PDF.
- Scenario fork/apply/discard and rule-based **demo** commands.
- Browser-based regression tests in tests.html for scheduling logic.

## Not yet production-ready / not actually integrated

- Sandy AI natural-language planning, third-party email and document events, live calendar integration, real Missions/agent execution, approval workflows, shared collaboration and external notifications.
- Tenant-scoped backend persistence, server-side atomic transactions and revision history for the new lab itself.
- Advanced actual critical-path analysis with resource calendars and explicit working-day calendars; resource-level scheduling, slack calculations, probabilistic delivery forecasts.
- Secure collaborative sharing, real uploaded file storage, server-produced exports, real baseline approvals, recurrence service and task template persistence across accounts.
- Accessibility auditing, cross-browser and touch-device interaction validation at production quality, automated end-to-end browser CI, observability, realtime sync and permission checks.

Do not represent mock interactions as real-world execution or data access.

## Proposed implementation architecture for production

1. **Scheduling service:** Canonical DAG state and task relationships, tenant-isolated transactional RPC, revision/version checks, dependency type/lag/constraints, scheduling calendars, dry-run preview and apply.
2. **Client:** Timeline graphics consume immutable authoritative schedules; optimistic previews must not mutate database state before a successful transaction. Maintain one transform for dates, bar edges, milestone center and SVG connectors.
3. **Task and Mission integration:** Use stable task IDs shared with Agenda, Calendar, Missions and Controller; preserve notes, evidence and comments. Mission progress comes from verified execution events.
4. **Inbound event adapters:** Source-attributed incoming email/calendar/WhatsApp changes become suggested task actions subject to consent, not fabricated completions.
5. **Collaboration and audit:** Typed events, actor identity, before/after revision, permissions and idempotency. Undo/redo sends compensating transactions with validation.
6. **Scenario engine:** Immutable branches of schedules; display diff, constraints, critical-path and predicted completion, then merge subject to optimistic concurrency.
7. **Assurance:** Unit tests for duration and cycle invariants, property-based DAG tests, time zone/DST coverage, browser pointer/hit-test suite, authenticated API contract checks, tenant isolation and deployment rollback.

## Production acceptance gates

- Show/hide handles correctly on row hover and keyboard focus.
- Move/resize/milestone with 15-minute snap, active-edge tooltip visible within viewport.
- Dependency start and finish at exactly the same timestamp render on exactly the same X coordinate; no artificial path offset.
- Graph edits cannot produce cycles; cascade preserves durations; multiple predecessors use latest constraint.
- Completion records actual end and updates descendants atomically; failure changes nothing and reports error.
- Task reorder and nesting update shared Agenda structure; no duplicate records.
- Synthetic events distinguish accurately from connected, verified data.
- All browser tests and authenticated API tests pass, including reload persistence and daylight-saving changes.

**Scope status:** The lab is a testable interface and scheduling-engine prototype, **not a claim that all requested integrations are deployed**. Promote features only after the relevant gates are met.