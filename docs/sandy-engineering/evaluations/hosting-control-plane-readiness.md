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

## Exact account release candidate (23 October 2026, 23:56 UTC)

Read-only reconciliation confirmed customer provisioning v10, JWT verification enabled, and the candidate entrypoint baseline equals the deployed entrypoint. Existing JSON contract/manifest files have formatting differences but identical parsed contents; the candidate preserves their deployed bytes rather than replacing them. No hosting account table, matching migration history or two operation rows exists in the live database.

[Exact candidate manifest](hosting-logical-account-release-candidate.json) pins source `1dee65da7b68f12d147d11e3f02befae06416ef2` and manifest SHA256 `66393dac73a71bc1619c1ecf8350ac902abc1e96acf827cd6dca48ab619e4d37`. It overlays only the account handler entrypoint, gateway contract module inside that handler bundle, and new account JSON; it does not deploy the shared gateway service. The offline verifier checks immutable source/migration digests, preserved module set and JWT verification. It is not an executor or admission receipt.

The deployed generic release action permits only sandy-operation-api and sandy-api-mcp. Its allowlist was not modified. A bounded executor is now implemented in `scripts/sandy/release_hosting_accounts.py` and its dedicated workflow, pending review and deployment; the runtime/provider-specific executors must not be repurposed by bypassing their target checks or JWT configuration.

Registered separate proposed change `04fab547-3177-4eb4-ac23-23831152b420` for this exact handler/migration scope, because the existing DNS/provider record does not name these targets. Original DNS rollout record remains unchanged. Owner action is review of this exact source/manifest under **Release logical hosting accounts without provider provisioning**, via [Controller Changes](https://ausstyle.github.io/web-staging/sandy/controller/#changes), **Review & approve**. Repository source confirms that route and action; GitHub Pages configuration confirms its base URL, but an authenticated browser interaction has not been independently exercised. The authenticated Sandy AI Operations V2 approval action is an alternative supported route. No approval was requested through another person's session or manufactured by this task. Registration is confirmed proposed, not approved. Owner-session customer acceptance remains pending; never mint or borrow a customer session through Management APIs.


## Executor and approval route validation

The bounded workflow supports read-only preflight/reconciliation, deployment and guarded function rollback. It does not modify the generic release allowlist. It checks a genuine enabled Owner audit for this change and the pinned source/manifest, exact live v10 files and JWT settings, independent source CI, a component lease, private verified recovery artifacts, additive migration preconditions and inactive contract postconditions. Persisted intent precedes schema/upload effects; repeated or uncertain dispatch stops for reconciliation. Rollback requires the exact candidate v11 and captured verified original bundle, preserves JWT verification and leaves account/audit/schema data intact. Product source and manifest pins remain unchanged.

Read-only inspection found Engineering Control v54 implements Owner approval directly; the newer repository approval RPC is absent live. The captured actual v54 status branch is tested with synthetic Owner/engineering/cancelled cases. It permits proposed high-risk records for Owner and records a matching actor/reason event. The executor requires that event even if the older handler returned success without a durable audit. UI source has the matching high-risk proposed Review & approve action. These are source/handler tests, not a claimed real Owner login.

The existing `sandy-production` GitHub environment exists but currently has **no configured protection rules or deployment branch policy**. The workflow restricts execution to main and the executor independently enforces genuine exact Owner approval. Do not describe the environment itself as enforcing a human reviewer gate, and do not add protection rules or grants under this release.
