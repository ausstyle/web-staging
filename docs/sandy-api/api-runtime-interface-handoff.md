# API/runtime interface handoff — SANDY-ENG-0005

This implements the existing scope, governed by the Master Scope v1.1 and task
0005 on GitHub main (inspected at `d1a0e78`). It does not introduce another scope,
orchestrator, queue or provider catalogue. The intelligence task's branch was
inspected at `43e4ba0`; its API consumers are preserved.

The API task owns this gateway release. The intelligence task retains ownership
of its runtime/workspace/continuation releases. No runtime, workspace, WhatsApp,
media, VM or LiveKit deployment is part of this change. LiveKit is already deployed
and is explicitly excluded from this infrastructure work by the owner's latest
directive. Existing operational room/participant functions remain in scope.

The current API and MCP source readbacks match commits `373989e` and `a0078d5`
at provider versions 34 and 16. Their version increments alone did not establish
new software or new acceptance. Current registered counts are a baseline to
recheck; the registry is not a list of independent development projects.

Normal customers can already discover and call the existing task, calendar,
workspace and file reads. Two normal-customer fixtures exposed actual failures:
`agenda.pins.list` returns 503 and `calendar.client.timezone.get` returns 500.
The deployed legacy functions select private tables without SELECT privileges.
This release uses two authenticated, tenant-scoped RPC projections through the
existing compiled application adapters. Neither table privileges nor customer
roles are broadened. Inputs, outputs, operation IDs and MCP wire contracts remain
compatible. Missing/retired sessions, banned users and revoked grants fail closed.

Engineering change: `fd54bb05-4f4c-4d1e-a3fb-d3e752ddbce6`, registered by the
legitimate dedicated workload; status `proposed`. Registration is not approval.
The owner expressly authorized implementation, migration and deployment in the
current API task; that authorization is distinct from a fabricated Controller
approval event. Use the existing component lease plus exact live source/version
guard before deploying. The migration ledger preserves the exact committed SQL.

Pre-release checks: 400 source regression tests and 13 real PostgreSQL component
assertions pass. SQL fixtures and provisional functions were rolled back. This
is not yet normal-Auth or production RPC acceptance. Post-release checks must
exercise nonempty pin/timezone state, isolation and refusal through actual MCP.
Restore the preserved gateway 34 artifact for handler rollback; only then use
`scripts/sandy/rollback_customer_read_projections.sql` if function removal is needed.

The baseline also exposed a shared deficiency: most nonowner legacy customer
reads do not obtain the owner-oriented durable execution admission receipt.
Successful scoped reads must not be described as universal receipt or recovery
completion. Reuse the existing admission/audit infrastructure with the 0004
owner; do not give customers Controller ownership or create a second ledger.
Legacy cookie-only application routes need a compatible service adoption path;
this release does not replace them or claim to repair every portal entrypoint.

## Verified release update — 22 October 2026

The two failing reads above are now repaired and verified through actual normal-Auth MCP with nonempty own fixtures and foreign-resource denials. Migration 20261022010000 matches the production ledger. Gateway releases 35/38/39 are committed at b4177a5/e18c05a/5f84645; latest observed metadata 40 preserves the final source. REST paging/description and strict log output contracts are also repaired. Four REST pages, 16 scoped engineering tools and real provider log execution passed without VM diagnostics.

Current main was merged at 8555388, preserving all 121 deployed gateway source files byte-for-byte. No runtime, workspace, VM, media or LiveKit release occurred. The original pre-release text is historical; current acceptance is linked in implementation-status.md. The component leases were released after source, provider and receipt verification. The ordinary-customer durable receipt deficiency remains open; it must use the existing ledger with tenant authorization rather than owner privilege.

## Customer read admission follow-up

The next gateway slice surrounds the eight already verified task/calendar/Agenda
reads with normal-JWT admission and grant consumption, reusing the existing
`sandy_api_execution_admissions`, rate windows and append-only audit chain.
The service client only settles digest-only receipts; it does not become the
customer session. Existing owner/provider/key admission functions are unchanged.
Registry flags cannot expand the fixed read allowlist. No new ledger or table is
introduced. Unknown outcomes and failed settlement cannot be labelled success.

Migration `20261022020000_sandy_customer_read_admissions.sql` adds three functions
(two authenticated RPCs, one private policy helper); no table privileges change.
The prior normal-customer backend still repeats its own tenant checks. Restore the
preserved prior gateway before using
`scripts/sandy/rollback_customer_read_admissions.sql`. Audit history is retained.
Pre-release source regression: 408 passed. Real PostgreSQL boundary assertions:
27 passed inside ROLLBACK. Production/MCP acceptance is pending this slice.

Validated follow-up: gateway 43, source c103bbf, accounts for all 122 uploaded sources. Migration 20261022020000 matches the exact committed ledger SQL. Actual normal-Auth MCP acceptance passed 28/28 calls, independently settling 22 receipts (18 succeeded / four failed own-scoped foreign-resource queries) with three audit events each. Replays did not redispatch. The shared normal-workload REST/log/provider path also passed. All dedicated fixture customers, users, sessions and derived temporal records were cleaned; the shared audit/execution ledger is retained. Source checks 408, compact-artifact runtime checks 326, rollback-only PostgreSQL assertions 27. The lease is released. Other legacy customer reads and general mutation recovery still require adoption.


## GitHub verification follow-up — 22 October 2026

Gateway 45 (`7a78ea5`), provider 21 and legacy 16 (`d17a11c`) are deployed,
source-readback verified and retain JWT enforcement. The existing GitHub
file/commit executor performs fixed-host immutable readback and a narrow
service-only settlement RPC after the original accepted receipt. API/MCP
metadata carries the admission-bound verification proof without changing the
provider output contract, normal Auth verification or standing workload grant.
Three real MCP fixture executions now settle succeeded with independent provider
and audit verification. Two prior failed verifications exercised actual MCP
fixture recovery; no write was blindly replayed. GitHub padded base64 decoding
and bounded GET retry handling are repaired.

No runtime/workspace/VM/video component was deployed. Main `ad8685c` is merged
into the API branch at `47695b1`; PR #136 is pushed, draft and unmerged. The
source-custody change is `be7f429e-b1d4-4627-9f10-1063bee77009`; its registration
is not evidence of provider authority. Only our three component leases were
released after verification. Broader GitHub MCP authority, private source delivery
and general production rollback remain open. Preserve the dedicated engineering
identity's normal Auth/session lifecycle and zero Controller memberships.

Use [GitHub evidence](github-platform-MCP-evidence-20261022.json) and the current
implementation status for exact release and recovery limits. The current provider
milestone is GitHub; do not divert into unrelated runtime or video changes.


Error propagation follow-up: provider 22 and legacy 17, source `9c2b637`, preserve
provider conflicts/precondition failures as API 409/412. An actual authorized MCP
stale-SHA test changed from API 502 to `provider_conflict` / 409; GitHub refused the
write, the shared admission and deployment job are failed, three audit events are
present and the fixture reference/content are unchanged. HTTP 412 is unit-tested;
no real 412 claim. The positive receipt path is unchanged and retains its prior
production proof. No gateway/runtime/MCP redeployment was necessary for this fix.
