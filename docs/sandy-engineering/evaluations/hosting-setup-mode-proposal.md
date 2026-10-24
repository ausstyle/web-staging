# Pre-retail hosting setup mode — proposal, not enabled

The user requests fewer repeated approvals while Sandy is being prepared for retail. This document inventories observed gates and defines a narrow action-time proposal. It is not authorization, a new grant, a changed policy, or a substitute for an Owner audit.

## Observed gates (24 October 2026)

| Gate | Observed state | Consequence |
| --- | --- | --- |
| Ordinary source work | Scoped code, tests, pushes and draft PRs are already authorized | Continue without asking again; normal review remains |
| Account release | Change `04fab547-3177-4eb4-ac23-23831152b420` remains proposed/high, exact source and manifest unchanged | Executor requires genuine matching Owner approval; no deployment yet |
| Existing app automatic policy | Enabled; allows low/normal/high/critical and six named operations including GitHub file writes and Supabase function deployment; authenticated admin/change required, test/rollback flags false | This older policy is broader than a safe setup envelope, and does not satisfy the separate exact-Owner executor gate; do not broaden or blindly rely on it |
| Generic live deployment action | Only sandy-operation-api and sandy-api-mcp are allowed by its engineering_release route | No allowlist bypass or shared service overwrite |
| GitHub environment | sandy-production exists; no protection rules or branch policy configured on the environment | Do not claim an environment reviewer gate exists; application Owner admission is separate |
| Main branch protection | Inspection denied with integration HTTP403 | Protection state unknown; no retry/bypass or rule changes |
| Customer identity | Normal authenticated customer/tenant binding required | Management/workload identity cannot impersonate a customer |
| Regional provider binding | Provider v31 fixes region to europe-west1; hosting requires europe-west8 | API owner assessing separate binding; do not change global binding |
| DNS provider read | Recorded provider_authorization_refused HTTP403 | No retry or IAM expansion; exact cause still requires authorized diagnosis |
| Budget and DNS authority | No quantified infrastructure budget or production DNS diff approval found | No new paid resources or DNS/traffic cutover |

## Proposed narrow mode

**Activation requires a specific Owner decision before any security/policy change.** Target only repository `ausstyle/web-staging` and the hosting project, not the concurrent API/Runtime programmes. Reuse the current authenticated Controller Owner and existing renewable workload identity; do not mint credentials or create a new identity.

Duration: at most **7 days from activation**, ending earlier on explicit revocation or retail go-live. Every admission must check expiry and a server-owned retail flag. Missing/unknown flag or unavailable policy storage must deny. Renewal needs a new explicit decision; it must not renew itself. A retail release must invalidate the setup envelope before public traffic promotion, not rely on a checklist or browser state.

Already authorized work needs no new mode: inspect source, implement/test, build locally, push scoped branches, and prepare reviewable PRs and exact release artifacts. These should continue autonomously now.

The proposed additional exemption is **no repeated Owner prompt for reviewed, non-security hosting UI/static-content releases and bounded repairs within an explicitly approved deployment target inventory**, provided all of the following hold:

- A real Owner has approved the finite target/path inventory and the setup expiry once. Initial repository paths: `sandy/hosting/**` excluding Auth/session/transport or credential-related changes; ordinary presentation changes only. Existing Google/Supabase deployment targets must be individually enumerated before inclusion; none is silently included by project membership.
- Normal independent code review, trusted exact-commit CI, source/manifest digests, existing preimage checks, per-component lock, durable admission, effect receipts and rollback remain mandatory. Workflow, executor, schema, RLS, identity, roles, grants, network, registry exposure and provider-scope changes are excluded from automatic admission. Indeterminate classification denies.
- No unapproved billable effect: retain existing resource caps and a separately approved bounded budget. Without such a budget, only operations demonstrably creating no new paid resource/commitment qualify. This proposal provides no monetary authorization.
- A setup admission is single-use and tied to target, commit, manifest, risk classification, tests and prior resource version. Revocation/expiry is rechecked immediately before dispatch. Unknown writes require reconciliation, never repeated automatic approval/dispatch.
- Use a dedicated hosting envelope checked by the existing control boundary. Do not turn off the global Owner check, edit role membership, widen the existing broad automatic policy, disable JWT checks, or expose customer actions as a side effect.

The current account migrations change database structures/privileges and are **outside the routine exemption**. Their exact existing source `1dee65da7b68f12d147d11e3f02befae06416ef2` / manifest `66393dac73a71bc1619c1ecf8350ac902abc1e96acf827cd6dca48ab619e4d37` still need genuine authorization. A future specific setup confirmation may explicitly include that one immutable release, but a generic setup flag must not authorize arbitrary migrations.

## Retained explicit decisions

IAM/security/delegation expansion, new credentials or persistent access, new paid resources without an approved budget, tenant ownership and isolation, production DNS/delegation/traffic changes, destructive deletion, secret/database-credential changes, restore overwrite/cutover, and retail activation stay protected. DNS changes continue to require verified customer authority and exact diff review. No setup mode can turn a failed provider permission check into permission.

## Enforcement, rollback and risks

Implementation would require a reviewed, expiry/revocation-aware authorization predicate and tests in the existing Engineering Control boundary. That is a security-relevant change and has **not** been implemented or deployed by this hosting task. The API/Control owner must review the finite predicate and permitted target inventory before an action-time confirmation.

Rollback is immediate revocation of the setup envelope, not removal of audit records or deletion of deployed customer data. In-flight authorized writes may need reconciliation; revocation cannot reverse an already executed effect. Existing exact-release gates resume for subsequent dispatch. Test expiry, revocation, retail transition, missing policy, target mismatch, security diff, budget exhaustion, stale source and uncertain outcomes before activation.

Residual risk: classifying a code change as non-security is imperfect, static publishing may deliver customer-visible bugs, and a source review is not live acceptance. Keep the allowlist small, fail closed, retain independent review and receipts, and require fresh live acceptance before claiming readiness. No claim is made that any approval requirement has been removed.
