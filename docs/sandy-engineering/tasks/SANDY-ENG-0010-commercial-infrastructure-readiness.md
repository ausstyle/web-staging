# SANDY-ENG-0010 — Commercial Infrastructure and Production Readiness

Version: 1.0 · 21 October 2026  
Status: DRAFT — target design; no certification of security, billing or availability  
Priority: P3 commercial rollout; identity, isolation, secrets, audit and spend safety are immediate prerequisites  
Owner: Sandy Platform Operations / Product Engineering / Codex  
Master: §§1.3–1.4, 2.1, 10–12, 14–20; AC-08, AC-10, AC-12  
API requirements: 143–145, 158–159, 161; infrastructure subsets for recovery/operations  
Contracts: SC-01, SC-04–05, SC-07–08 in [shared architecture](../architecture-contracts.md)

## 1. Outcome and boundaries

Sandy can onboard and operate paying customers with correct tenant separation, delegated access, measurable consumption, clear entitlements, reliable support, recoverable data and honest service status. This scope owns commercial/lifecycle facts and operational readiness; the shared API evaluates authorization, the runtime executes work, and the portal renders the customer experience.

Do not introduce real charges, a new pricing plan, a paid infrastructure upgrade, tax promises or unsupported capacity guarantees under this specification alone. Use the existing approved payment provider; choosing/replacing a provider or prices requires a separate product-owner decision. Do not build a card vault or store payment-card secrets in Sandy.

## 2. Baseline investigation

Inspect existing tenant/membership/authentication records, subscription/provider bindings, consent/retention settings, usage ledger, secrets, backups, environment isolation, incident handling and support roles. Identify direct paths that bypass tenant or entitlement checks and quantify current costs/availability from actual traces. Obtain provider plan/entitlement and backup capabilities without revealing secret values. Record missing contractual or commercial decisions explicitly.

Do not infer commercial readiness from API deployment count. A functioning payment link does not establish correct subscription state or secure data lifecycle. Preserve current customer IDs, connected accounts and paid status during changes.

## 3. Architecture

`customer / operator → Sandy API identity + policy → tenant/entitlement services → authorized domain work`

`model/tool/compute receipt → idempotent usage event → reservation settlement → cost ledger → customer usage projection`

`payment provider signed event → durable inbox → current provider-state reconciliation → subscription/entitlement transaction → outbox → runtime/portal invalidation`

`incident/health signal → deduplicated incident → bounded response/runbook → verified recovery`

Use PostgreSQL for canonical tenant, membership, subscription projection and usage state, preserving existing structures. The payment provider owns payment transactions; Sandy owns the reconciled entitlement policy. Cache invalidation includes tenant, grant and entitlement revisions. No separate billing-specific privilege system that can authorize ordinary customer access independently of 0005.

## 4. Functional requirements

| ID | Requirement |
| --- | --- |
| COM-01 | Tenant onboarding, membership, company contexts and verified identity lifecycle |
| COM-02 | Explicit roles/delegation, secure recovery and support access |
| COM-03 | Correct provider-backed subscription and entitlement projection |
| COM-04 | Auditable usage reservation, deduplicated metering and settlement |
| COM-05 | Bounded spend, fair quotas and truthful customer consumption display |
| COM-06 | Secure secrets, rotation, revocation and environment separation |
| COM-07 | Consent/retention-aware export, erasure, suspension and restoration |
| COM-08 | Observable incidents, service objectives, alerting and support runbooks |
| COM-09 | Tested backup/recovery and compatible release rollback |
| COM-10 | Commercial launch evidence, access reviews and customer documentation |

## 5. Tenant, identity and support workflows

Onboarding creates the tenant/account binding idempotently after supported identity verification. Membership invitations bind recipient, role, target company/workspace and expiry; accepting an invite cannot expand unrelated personal data access. Existing OAuth connections are associated with verified owner/tenant and selected company context. Account switching invalidates caches and active client subscriptions.

Roles distinguish customer owner, member, delegate, viewer, support and platform engineering. Use current server-side membership for consequential access decisions. Support diagnosis defaults to redacted metadata; any exceptional access to content has explicit purpose, authority, duration and audit. No unaudited impersonation or universal customer password. Account/session revoke blocks new operations and scheduled follow-ups; active workers recheck grants at dispatch.

Long-running engineering automation uses the legitimate delegated/workload mechanism in 0005. Renew credentials using supported trust; never bypass normal login/role checks or treat a management token as a customer session. Security prerequisites are P0 and cannot be postponed because commercial rollout is P3.

## 6. Subscription, payment and entitlement semantics

Normalize trialing, active, past-due, cancelled, suspended and provider-error states with effective times and source revisions. These are design states to map to the chosen provider, not a claim every provider has identical statuses. Define grace period, downgrades, cancellation timing, refunds and data retention in an owner-approved policy. A subscription cancel does not silently erase customer data or abandon already authorized irreversible operations.

Verify webhook signatures using the raw body, persist delivery identity, deduplicate, and reconcile authoritative provider state. Handle duplicate and out-of-order notifications without resurrecting an ended subscription. Never grant a plan from a browser success redirect alone. Unknown payment state is pending reconciliation, not paid. Refunds and plan changes require the appropriate actor, policy and provider receipt.

Stripe documentation, as one possible implementation reference, explicitly addresses event delivery/ordering and duplicate handling; use its current supported API/SDK only if Stripe is the approved provider [C1]. Do not create a new paid subscription or charge a real card merely to verify this scope.

## 7. Usage, budgets and billing accuracy

Each cost event carries tenant, mission/run/operation, provider/model, usage category, quantity/unit, estimated versus actual cost, currency, source receipt, price-version reference and idempotent event ID. Use appropriate decimal/integer representations, never binary floating-point arithmetic for customer amounts. Preserve the cost basis and exchange-rate reference when conversion is necessary; do not rewrite historical bills when current prices change.

Reserve before expensive work under SC-08. Settle once when usage is known, release unused reservation and reconcile late/corrected provider usage with explicit adjustment events. A retry may incur real provider cost but must not duplicate the same metering event or incorrectly charge the customer for a duplicated logical task. Distinguish internal cost, customer billable quantity and charged amount under approved pricing.

Apply tenant concurrency/rate/budget limits before dispatch. Essential cancellation, credential revocation, safety alerts and required data access must remain available under a documented degraded/over-budget policy. Do not silently choose an inadequate reasoning model solely to reduce cost; disclose a budget blocker or seek authorization.

## 8. Data lifecycle, privacy and security

Map source data and derived copies across PostgreSQL, object storage, logs, memory/vector indexes, transcripts/recordings, caches, queues and provider connections. Export through a scoped durable job with a manifest, checksums and expiring authorized download. Erasure first prevents new ingestion/retrieval, cancels relevant jobs and revokes tokens, then removes eligible data and derived indexes. Preserve only lawful/minimized audit metadata; legal hold/conflict decisions require the configured accountable policy, not an LLM inference.

A restored backup must replay deletion/revocation markers before serving traffic. Software rollback must not restore deleted personal memory. Retention is documented by record type and provider limitation. Test erasure and restore in an isolated environment with synthetic fixtures.

Maintain secret ownership and rotation without values in source/docs/logs. Separate staging/test and production credentials, targets and datasets. Pin dependencies and scan artifacts; constrain egress and sandbox access. RLS/grants, application authorization and object-storage policies are all tested. Administrative keys never reach customers or browser code.

## 9. API and state contracts

Map to existing canonical operations: tenant create/get/suspend/reactivate; membership invite/update/revoke; entitlement get; subscription checkout/change/cancel/status; usage summary/ledger; budget get/update; customer export/erase/status; consent/retention settings; support case/incident actions; backup/recovery inspect/request/verify.

Mutations bind actor, exact target, expected revision and intended effect. Financial/provider operations include idempotency and actual transaction evidence. Internal billing-webhook and metering ingest are service-authenticated and non-spoofable. A tenant cannot submit its own entitlement or claim a lower usage amount. Customer API replies expose understandable usage and status, not raw secrets or another tenant's bill.

Logical aggregates: tenant/membership, connected account, consent policy, subscription projection, entitlement revision, budget reservation, immutable usage/adjustment event, support incident, lifecycle job, recovery test and retention/deletion marker. Map to existing production objects before migration.

## 10. Reliability and acceptance gates

Retain the Master Scope's proposed 99.9% monthly API availability target for an explicitly agreed pilot surface; this is not current measured availability. Define SLI numerator/denominator, exclusions and independent synthetic journeys. Measure first useful output, job queue lag, connector freshness, unknown effects, false completion, provider errors and cost anomalies. Alert on silent accepted work and missing webhook/worker progress, with an owner and escalation runbook.

Before paid launch, agree RPO/RTO from actual backup entitlements and restore drills; proposed planning targets are RPO at most 15 minutes and RTO at most 60 minutes for core durable records, subject to demonstrated capability and explicit adjustment. Do not claim these targets for provider systems outside Sandy's control. A successful backup listing is not a restore test.

COM-T01: idempotent signup and correct company membership. COM-T02: cross-tenant ID guessing, role downgrade, session/grant revoke and support restrictions. COM-T03: duplicate/out-of-order provider subscription events and forged webhook. COM-T04: cancellation, grace/downgrade and provider outage preserve correct entitlements. COM-T05: duplicate usage, reservation expiry, late cost adjustment and concurrent budget limits reconcile exactly. COM-T06: customer display agrees with ledger and approved prices without hidden costs. COM-T07: secret rotation/revocation and source/log leakage scan. COM-T08: export/erase with derived memory/media copies and revoked connections. COM-T09: isolated restore applies deletion markers and meets measured recovery objectives. COM-T10: release failure, incident alert and rollback retain valid customer/financial state.

Use provider sandbox/test clocks or approved fixtures, not real billing by default. All critical security, tenant, financial duplicate and false-completion tests pass. Measure a sustained pilot soak and publish its duration/sample size; no test should turn green by disabling security or granting owner access to a customer identity.

## 11. Delivery and dependencies

COM-M1: reuse identity/membership/consent and protect exposed data; this is a foundation for all scopes. COM-M2: consistent usage/budget contracts and operational telemetry. COM-M3: approved subscription/entitlement integration in sandbox, then controlled production rollout. COM-M4: lifecycle export/erase and recovery drills. COM-M5: launch scorecard, support playbooks, unit economics and customer documentation.

0005 owns policy enforcement and credentials plumbing; 0004 owns lifecycle jobs/receipts; 0006 and 0008 honor deletion/retention; 0009 renders settings and billing. Commercial launch cannot precede critical safety/recovery proof, but P0 chat fixes need not wait for pricing or subscription design.

## 12. Release and rollback

Backfill entitlement/usage projections in shadow mode, reconcile against authoritative provider records and approve differences before enabling billing enforcement. Feature flags separate metering from charging. Roll back application code without rewinding provider transactions; repair projection/ledger errors through traceable adjustments. Freeze new financial mutations on a detected integrity error while preserving customer visibility, cancellation and incident response.

Deliver tenant/role matrix, data/secret inventory, source/deployment evidence, provider sandbox and live canary receipts, entitlement/meter reconciliation, restore/erasure report, operational dashboard, SLO definitions, cost model, incident and support runbooks. Launch approval is separate from scope-document status.

[C1: Stripe webhook reference](https://docs.stripe.com/webhooks), checked 21 October 2026; an implementation option, not a vendor or pricing approval. Other security and infrastructure references are in the shared architecture document.
