# Hosting control-plane source readiness

Authoritative scope: [hosting architecture v1](../../sandy-cloud-hosting-architecture-engineering-scope-v1.md), PR #234 head `c318e66508243fb756ee159f1eb6ad3db865e4cd`, merged as `0b040c03a461a71ea6df21aa76dab08c8a21295a`. This implements a bounded part of #203 and #226, under SANDY-ENG-0005 and SANDY-ENG-0010; it is not a replacement scope. Reuse registered change `20a92691-558e-4939-8b61-6d777375c765` through the protected release process.

## Source

The canonical PR #203 contract history is merged into this branch. Two logical-account operations extend the existing customer provisioning handler and identity resolver. Accounts are separate from billable provider provisioning. Customer identity is derived from the verified user session, never from caller tenant arguments. The existing receipts and audit events provide atomic idempotency and traceability; replay is bound to the current customer. Requested plan is a preference, not a paid entitlement. There is no Cloud Run, SQL, bucket, DNS, routing, billing or IAM effect.

The offline DNS planner validates full-snapshot preimages and computes a stable tenant/project/zone-bound diff. Initial mutations are A/AAAA/CNAME/TXT/MX; existing mail-related records and dependencies are preserved. Rollback requires the complete current snapshot to match the reviewed postimage. Neither plans nor inverse plans authorize execution. NS/delegation, DNSSEC, CAA/SRV mutations, owner verification, live DNS execution and the editor still require implementation and acceptance.

The generated [scope map](hosting-architecture-coverage.json) records every non-heading source block with its source digest, partial implementation references, acceptance categories and remaining work. Context rows are not completion counts; no live acceptance category is marked passed. Packaging and preview work is separate in draft PR #233 and reuses PR #194.

## Local acceptance

Synthetic tests only: 12 DNS planner tests; 13 existing/new provisioning handler tests; 122 shared gateway compatibility tests. Isolated PostgreSQL 17 tests cover customer isolation, repeated and conflicting idempotency, relinked/revoked identity, direct table/RPC privileges, atomic audit failure and inactive operation registration. The runner creates and removes its own network-isolated local container, using a pinned image. These results do not establish a sandy.chat customer binding, live provider resources or public HTTPS.

## Deployment and release sequence

No migration or function in this change has been deployed. The registry migration deliberately leaves API/UI/AI exposure and verification false. Before release, reconcile current deployed handler and gateway versions and the API programme's release owner/lock. Apply the additive schema and inactive contracts through the existing protected process; deploy the exact reviewed handler and compatible gateway artifact without overwriting concurrent changes. Do not expose either operation until normal customer authorization and live canary evidence pass. The SQL RPC requires the real authenticated customer session; management credentials cannot substitute for customer identity.

For rollback, disable operation exposure and restore the previous compatible handler/gateway artifact through the protected process. Preserve additive tables and account/audit/receipt data; do not drop customer records. Reconcile any in-flight request before retrying. This slice creates no paid resources and has no production traffic/DNS diff.

## Outstanding external evidence

Authorized DNS inventory for `elaborate-haven-511518-a5`, `sandy.chat.` reached the provider after the provider v31 release and returned HTTP 403, `provider_authorization_refused`, `executed: true`. Recorded admission: `0c6bea20-e156-473e-bf40-3dfc2b66888b`; request: `b7ecdc99-448c-4d53-ae3d-59da1019b239`. Outcome is a recorded failed read, not absence of a zone. Do not expand IAM or retry without materially new authorization evidence. Alternate public DNS/HTTP routes were unavailable, so no authoritative baseline, live website contents or current delegation has been independently established.

The next non-billable live milestone is creation/retrieval of the sandy.chat logical account under its existing verified owner, after protected deployment and reconciliation of existing account/site/domain resources. Current source packaging preserves the existing marketing page; public portal and live origin still require verification. Paid infrastructure requires a quantified approved budget and exact resource plan in europe-west8. Customer or sandy.chat DNS/traffic changes require verified owner/tenant authorization and exact reviewed snapshot/diff, email preservation, impact, costs, rollback and receipts. No general hosting ownership handoff is pending.
