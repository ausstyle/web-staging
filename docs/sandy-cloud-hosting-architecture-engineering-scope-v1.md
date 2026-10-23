# Sandy Cloud Hosting — Architecture & Engineering Specification v1.0

**Status:** Proposed engineering baseline; **not deployed or production accepted**  
**Date:** 24 October 2026  
**Repository:** `ausstyle/web-staging`  
**Sandy control plane:** Supabase `zmqlyygzqoidkcwdysok`  
**Target Google Cloud project:** `elaborate-haven-511518-a5` (initial operator project; customer project topology to be decided)  
**Related:** PR #203 (initial hosting API contracts), Issue #226 (DNS rollout), engineering change `20a92691-558e-4939-8b61-6d777375c765`, `docs/sandy-engineering/architecture-contracts.md`, SANDY-ENG-0005/0010.

> This document is a specification, not evidence of deployed APIs, IAM grants, DNS delegations, TLS certificates, customer accounts, or operational readiness. Implementations must independently verify deployed sources and real provider state. Existing protected release and Owner approval requirements remain binding.

## 1. Product mission and boundaries

Build a scalable, multi-tenant, API-first customer website hosting business, controlled through Sandy Cloud and its assistant. Customers can provision websites, databases, object storage, custom domains and HTTPS, deploy content, observe usage, manage bills, make backups and recover prior releases. Sandy acts as the service operator through governed APIs and durable jobs; it is not a separate privilege path.

**Decisions:** Google Cloud Run for containerized sites and applications; Google Cloud SQL for relational databases; Cloud Storage for files/artifacts/backups; Google Cloud DNS for authoritative managed zones; external Application Load Balancer and Certificate Manager for production custom-domain HTTPS; Sandy's existing Supabase for control-plane customer data, jobs, receipts and permissions. No Firebase Hosting and no customer-site Supabase databases in the initial design. These are design choices, not verified service enablement.

**Out of v1 scope:** full email hosting, domain registrar accreditation, reseller registrar purchase/transfer until supported integration, generic VM/VPS and shell root access, custom white-label authoritative NS, unlimited compute/storage, guaranteed global active-active SQL writes. Sandy Mail may consume DNS automation later but operates under a separate product boundary.

## 2. Reference architecture

```text
Customer UI / Sandy Assistant / Public REST API / MCP
           |
Sandy API gateway (Auth, policy, tenant, entitlements, rate limits)
           |
Hosting domain service (desired-state objects + versioning)
           |
Durable admission / outbox / leased provisioning worker / audit / receipts
           |
Short-lived Google Workload Identity / narrowly scoped provider adapters
           |
Google Cloud: Cloud DNS | Certificate Manager | HTTPS Load Balancer
              Cloud Run | Cloud SQL | Cloud Storage | Cloud Logging/Monitoring
```

The existing Sandy API gateway is the only external operation boundary. MCP only adapts the protocol; it never owns cloud credentials. Existing shared engineering contracts SC-01 (verified actor), SC-04 (operation/result), SC-05 (effect evidence), SC-07 (delegated authority) and protected releases govern all work. Reuse canonical relations and release admission infrastructure after schema inspection; avoid parallel ledgers.

### Control plane vs data plane

- **Control plane:** Sandy Supabase keeps tenant/account relationships, domains, desired-state manifests, service plan entitlements, change requests, deploy job state, provider resource IDs, usage, invoice references, reconciliation results, audit and rollback artifacts. Do not store Cloud SQL passwords, Google long-lived keys or raw DNS API credentials in browser or ordinary rows.
- **Data plane:** Google Cloud handles public HTTPS requests, customer workloads, database transactions and object delivery. Hosting jobs must not depend on the customer application being healthy.
- **Provider execution:** workload-identity credentials bound to a verified operator/worker and target service account; per-action least-privilege authorization and explicit immutable release provenance. Cloud project Owner role is not a default requirement and is not to be granted as a shortcut.

## 3. Tenancy and physical isolation

**Initial preferred topology:** shared control plane with a per-tenant resource namespace, quotas, separate Cloud Run services and per-tenant Cloud SQL database/user within guarded SQL instances; separate buckets or prefix/IAM boundaries per tenant as appropriate. Shared managed SQL instances reduce cost but introduce noisy-neighbour/connection and blast-radius risks. Enforce tenant-scoped connection pools, per-database users, backups, limits and admission checks. Premium isolation tier can use dedicated SQL instances, projects, VPC networks or dedicated LBs after economics and IAM are verified.

A customer-supplied tenant ID is never sufficient authorization. Resolve authenticated identity and membership server side. Validate ownership of every target resource at dispatch, before mutation and during reconciliation. Reject cross-tenant listing, guessing of service IDs, domain takeover, stale versions and shared resource alteration. Separate environments (dev, staging, production), encryption keys, service identities and budgets. Define explicit customer deletion and export/grace policies.

## 4. Website and deployment pipeline

1. Customer creates a site with region, runtime/template, resource caps and entitlement.
2. Control plane persists request and idempotency key, validates payment/quotas and reserves capacity.
3. Build uploads/imports Git source or an approved artifact; isolates build; runs malware/dependency scanning, SBOM/provenance checks and secrets detection; stores immutable artifact digest in Artifact Registry/Cloud Storage.
4. Provisioning worker creates/updates Cloud Run service using an immutable digest, service-specific identity, constrained CPU/memory/concurrency, request timeout, autoscaling max instances and egress policy. Reject privileged containers and unapproved container capability.
5. Worker observes Google Cloud service revision, health checks, traffic split, logs and metrics before reporting VERIFIED_SUCCESS.
6. Customer obtains a default Sandy subdomain on a controlled parent zone; custom-domain flow described below.
7. Rollouts use staged revisions, optional traffic-split canary and forward rollback to last-known-good digest, with readback and receipts. Never silently replay uncertain cloud writes.

Support static sites via a minimal immutable web container or a dedicated static-serving strategy evaluated for cost; do not force every static asset through expensive always-on instances.

## 5. Cloud SQL and object storage

Cloud SQL PostgreSQL is the v1 relational offering; database engine/version, instance sharing policy, region and HA tier are plan-specific. Provision dedicated roles and databases, use IAM database authentication where feasible, private connectivity, TLS and Secret Manager for credentials. Never expose database superuser credentials or public SQL network ingress to tenants. Limit max connections and concurrent provisioned tenants per shared instance; design instance sharding/capacity migration before hitting quotas. Test backup restore at database granularity and document point-in-time recovery eligibility/cost.

Cloud Storage holds application objects, customer uploads, backup artifacts and deployment artifacts with distinct buckets or IAM-isolated namespaces. Short-lived signed upload/download URLs, type/size validation, retention, object versioning where purchased, lifecycle rules, deletion protection and regional/data residency controls. Storage encryption, egress and backup costs are billable inputs. No claim of end-to-end zero-knowledge encryption.

## 6. Domains, authoritative DNS and email safety

### Domain choices
1. Sandy-managed public Google Cloud DNS zone: create managed zone for a customer-owned domain only after ownership verification; return the **actual four allocated Google Cloud NS hostnames** and instruct registrar delegation.
2. External DNS provider: generate required records, or execute via customer-authorized registrar/DNS integration with scoped token, confirmation and reconciliation; do not demand nameserver transfer.
3. Sandy default subdomains: assign under a separately controlled zone and avoid collisions, stale CNAME takeover and claim races.

**Vanity nameservers:** `ns1.sandy.chat` CNAME aliases to Google-assigned NS are **not** an acceptable delegation design. Branded NS require a supported white-label authoritative DNS arrangement or Sandy-operated authoritative nameservers and separate evaluation. Do not advertise branded NS at launch.

### DNS change lifecycle
Ownership challenge (TXT/appropriate provider verification) → read and snapshot existing RRsets/NS/SOA/DNSSEC state → show full diff (especially MX/SPF/DKIM/DMARC and CAA) → authorised change with expected version and idempotency → provider operation → authoritative DNS readback → delegation checks against parent zone and multiple resolvers → observe propagation/TTL → report verified, partial or pending. Distinguish provider acceptance from global resolver propagation. Preserve email routing during zone migration and never overwrite unrelated records.

Support A, AAAA, CNAME, TXT, MX, CAA, SRV, NS where supported, TTL editing, DNSSEC lifecycle and safe record deletions; validate apex CNAME constraints, CNAME coexistence, MX targets, SPF consistency, duplicate/challenge conflicts and customer-specific domain bindings. Record every old value and rollback conditions. For DNSSEC, follow DS delegation order and prevent stale-DS outages.

### Custom domain HTTPS
Prefer global external Application Load Balancer with serverless NEGs for Cloud Run, host-based routing and Cloud Armor protections as warranted, paired with Google Certificate Manager (managed DNS authorisation or supported load-balancer validation). Confirm quota and certificate map limits; use sharding/multi-LB topology when supported limits demand it. Do not report HTTPS live until actual handshake, hostname, SAN, expiry and serving backend pass verification. Support apex and www routing with explicit redirects; preflight CAA, ownership and conflicting bindings.

## 7. API and operation design

Illustrative logical endpoints, **not claims of existing published routes**:

| Capability | Proposed operation | Change class |
| --- | --- | --- |
| Accounts | `hosting.accounts.create/get/suspend/close` | mixed |
| Sites | `hosting.sites.create/get/list/update/delete` | mixed |
| Builds/releases | `hosting.deployments.create/get/rollback` | mixed |
| Databases | `hosting.databases.create/get/credentials.rotate/backup.restore` | privileged |
| Storage | `hosting.storage.create/usage.get/object-sign` | mixed |
| Domains | `hosting.domains.claim/verify/bind/unbind` | mixed |
| DNS zones | `hosting.dns.zones.create/get/list/delete` | mixed |
| DNS RRsets | `hosting.dns.records.list/plan/apply/revert` | mixed |
| TLS | `hosting.tls.certificates.request/get/reconcile` | mixed |
| Routing | `hosting.routing.backends.bind/get` | mixed |
| Billing | `hosting.usage.get/limits.update/invoices.list` | mixed |
| Jobs | `hosting.jobs.get/events.list/reconcile` | read + restricted |

Every mutation carries versioned JSON schemas; tenant and target resolution; risk class; idempotency key; expected state version; rate/cost estimates; provider retry policy; durable job/receipt; approval or standing delegation; and a server-owned handler manifest. Return states such as REJECTED, ADMITTED, RUNNING, WAITING_ON_PROVIDER, VERIFYING, VERIFIED_SUCCESS, FAILED, and RECONCILIATION_REQUIRED; an HTTP 202 or queued job never means deployed.

Do not expose executable or verified registry flags until the actual handler is deployed and provider-level acceptance has passed. Read-only diagnostics and mutation capabilities need separate grants.

## 8. Authorization, safety and security

- Authenticate users with Sandy's existing identity system. Enforce tenant owner/admin/developer/billing/viewer roles and separately scoped support staff access. Maintain immutable audit references and allow revocation.
- Provisioning mutations require target-bound permission, bounded spending, quotas and per-tenant abuse limits. Dangerous domain takeover, deletion, transfer, restoration and broad infrastructure changes need distinct elevated grant/approval.
- Use Google service accounts with least privilege per project, workload identity or signed short-lived token. Do not use static JSON keys in repo/CI. Inspect actual IAM APIs, organization policies, project/host billing authority and DNS ownership before enabling.
- Keep customer build containers sandboxed; restrict network/egress and service identities; defend SSRF/metadata exfiltration, malicious upload, supply-chain compromise, crypto-mining and abuse.
- Shield public frontends with TLS, WAF/rate limits where justified, DDoS protections, log scrubbing, vulnerability patching and incident runbooks.
- Maintain separate audit for user request, policy check, admission, provider effect, independently observed state and rollback. No fabricated confirmations.

## 9. Reliability and disaster recovery

SLOs are **targets for pricing and operational validation, not current SLAs**. Proposed standard paid tier: 99.9% monthly application availability excluding stated customer code failures and exclusions; premium offers higher availability only after multi-zone service design, tests and cost modelling. Use regional Cloud Run with appropriate instance scaling, regional Cloud SQL HA on qualifying plans, Cloud DNS authoritative redundancy, health checks and monitored critical-path dependencies. Database is not globally active-active by default.

Define and measure RPO/RTO by plan: baseline daily backups with clearly stated restore window; premium PITR/HA with documented tested restore; regular isolated restore drills. Separate infrastructure platform failure from DNS delegation error, certificate outage, code release failure and customer billing lapse. Alert on failed provisioning, certificate expiry, DNS drift, SQL saturation, quota exhaustion, 5xx rates, backup failures and uncontrolled spend. Use automatic circuit breakers and blast-radius boundaries rather than unbounded replay.

## 10. Commercial model and metering

**Proposed marketing anchors, not validated prices:** Starter USD 5/month and Plus USD 10/month, subject to real cloud unit economics, regions, billing currency, tax, payment and support costs. These cannot promise unlimited compute, Cloud SQL per-site instances, storage or bandwidth. Define clear hard/soft quotas for request CPU, memory, instance count, SQL database storage/connections, Cloud Storage GB, egress, builds, backups and domains. A free tier, if offered, must be strictly capped with abuse controls.

Sandy records provider usage, cost allocation per tenant and service, price plan version, overage policy, taxes, invoices, trial/failed-payment lifecycle, proration, refunds, suspensions and data export before deletion. Require budgets and alert thresholds at tenant and operator levels. During provisioning estimate incremental worst-case cost and reject unsupported products/regions/quotas. Validate profitability at realistic low utilization and peak burst scenarios before launching price claims.

## 11. Customer experience

Dashboard: sites and their revision/health; attach domain; DNS editor with preview and records; certificates; databases and access rotation; file/storage browser; builds/deployments, logs and rollback; usage/billing; backup/restore; team invitations and roles; audit history; support. Sandy assistant can interpret natural-language requests but must translate them into typed, policy-authorised operations and display consequences and receipts. Provide contextual setup for GoDaddy/other registrars and external DNS; avoid exposing dangerous raw cloud permissions.

## 12. Delivery phases and engineering work packages

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| P0 Discovery | Live source/registry parity, IAM/billing/API quota inventory, exact operator identity, cost baseline | Signed evidence and blockers |
| P1 Control plane | Tenant resources, plans, desired-state DB, auth/RLS, admission, durable jobs, audit, reconciliation | Multi-tenant negative tests |
| P2 Provider core | Cloud Run, Cloud SQL, Cloud Storage adapters and workload identity | Real restricted provider read/write/readback |
| P3 DNS/TLS | Cloud DNS zones/RRsets, ownership, safe import, LB and managed certs | Verified test-domain delegation and HTTPS |
| P4 UI/API | User dashboard, public typed endpoints, MCP discovery and troubleshooting | End-to-end customer journey |
| P5 Commerce & ops | Metering, invoicing, quotas, support, monitoring, restore drills | Measured unit economics and incident drills |
| P6 Canary/release | Protected build, approved release, one real isolated customer/demo deployment | Independent evidence and reversible rollout |

Critical path: API mutation release authority → provider identity/permissions → durable verified workers → real resource canary → DNS/TLS → customer launch. PR #203 is an initial contract only. Issue #226 and the October 2026 engineering change record DNS work; neither is proof of deployment.

### Suggested ownership
- **Sandy API (0005):** operation contracts, provider boundary, permissions, release controls and receipts.
- **Sandy commercial readiness (0010):** plans, customer onboarding, billing, support and acceptance.
- **Sandy operations/mission infrastructure:** long-running job orchestration, lease handling, verification, compensation and monitoring.
- **Customer UI:** dashboard and guided domain/DNS experiences.
Any allocation must follow existing workstream owners and avoid duplicate operation systems.

## 13. Test and production acceptance matrix

**A. Authorization:** human tenant owner can operate own test site; other tenant, read-only user, unauthenticated user and expired delegated token denied before provider effect. Verify no credential leak and no broad project privilege.

**B. Provisioning:** one API request creates one durable job and Cloud Run site, matching immutable image and service identity; replay with same key returns same receipt; mismatched replay conflicts; timeout/unknown state reconciles before retry.

**C. SQL/storage:** isolated DB/user and storage resource; cross-tenant data reads denied; quota/connection limits demonstrated; backup creation and actual restore readback tested.

**D. DNS:** domain claim challenge; zone creation; actual allocated NS returned; parent-zone NS verification; A/AAAA/CNAME/TXT/MX/CAA plan/apply/readback; conflict/TTL/DNSSEC negative tests; no unrelated MX/SPF/DKIM/DMARC changes; rollback respects concurrent changes.

**E. Routing/TLS:** domain binding and load balancer; active certificate readback; public HTTPS test validates domain/SAN/chain; correct tenant backend, redirects, revoke/unbind and stale takeover prevention.

**F. Operations:** release revision/source hashes, protected approval record, deployment receipts, alert test, quota failure, automatic reconciliation after provider uncertainty, recovery from failed deployment, tested restore and cost dashboard.

**G. Customer journey:** signup → payment eligibility → create site → upload/deploy → attach domain → DNS + TLS verified → observe usage → rollback → export/delete. No claims of completion without independent observation.

**Required evidence:** immutable action/job IDs, provider request/response digests, observed resource names/versions, audit timestamps, tenant-bound identity, test case outputs, source digest, live registered operation status, negative control results, rollback results and documented residual risks. All seven test categories must pass for production acceptance.

## 14. Release and change management

Build from reviewed source under `ausstyle/web-staging`. Require automated lint/typecheck/unit/security and integration tests; real provider canary with bounded test domain/project; approved exact release manifest with source digest, function/deployment target and rollback; protected CI environment/one-use authorization; source-to-production and post-release provider readback. Use existing Sandy protected release control, not ad-hoc mutation via MCP registry or unreviewed Supabase function publication. Production DNS delegation or nameserver change always needs customer domain authority and planned safety checks.

Do not claim deployment when a PR is merged, operation registered, job queued or policy approved. Verify output and retain reproducible receipts. If release authority is unavailable, leave implementation staged and report exact missing approval.

## 15. Open decisions requiring explicit design records

1. Shared Cloud SQL architecture: database-per-tenant on shared instances versus dedicated tier, along with minimum profitable plans.
2. Customer Google Cloud project isolation level, region/data sovereignty and whether operator project may host billable customer resources.
3. API resource names, permanent schema/migration names and compatibility with the canonical Sandy operation registry.
4. External registrar partner and supported DNS APIs; ownership transfer and renewal policy.
5. Default Sandy subdomain namespace, abuse prevention and platform domain posture.
6. Cloud Load Balancer routing/certificate architecture and per-project quota/sharding calculations.
7. Tax/currency/geography, pricing, payments and SLA terms.
8. Tenant data retention, incident notification, export and deletion policies.

## 16. Current evidence and truth status (24 October 2026)

- V2 MCP operation discovery and registered `sandy-deploy` VM were observed working; VM was RUNNING in `europe-west1-b`. Registered target is not a production DNS executor.
- Live operation discovery showed no customer hosting or DNS provider-domain operations.
- PR #203 defines bounded Cloud Run/Cloud SQL hosting API contracts and expressly does not implement or deploy provisioning.
- Issue #226 tracks DNS automation work. Engineering change `20a92691-558e-4939-8b61-6d777375c765` was **proposed**, not approved or released.
- No actual Cloud DNS assigned nameserver set, tenant website deployment, TLS certificate or production DNS change was verified for customer hosting.

**Next action:** reconcile this scope with the existing SANDY-ENG-0005 and 0010 work plans; complete P0 source/IAM discovery, then implement P1–P3 on a protected engineering branch and demonstrate the first real test-domain canary with release receipts.
