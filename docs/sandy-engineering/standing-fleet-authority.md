# Sandy — permanent, revocable fleet access for IAP/SSH

**Status (24 October 2026): proposed engineering baseline and source-only policy component, not a live permission or verified SSH session.**

## Decision

Sandy must not request human approval for every routine SSH/IAP action on a server it owns or is explicitly delegated to manage. Replace exact one-off VM/time-limited repair proposals with an **Owner-authorised standing delegation, valid until revoked**, bound to an allowlist of Google Cloud projects and tightly enumerated operation classes.

Do **not** interpret "any server" as authority over unrelated Google Cloud projects or customer infrastructure. A project must be explicitly delegated once. An individual VM can then be **automatically enrolled on provisioning** with provider readback and an auditable source/provisioning receipt. Server deletion/replacement, project revocation and change of attached service account invalidate any stale VM pin. No human authorisation is required for additional instances in an already authorised project when enrolled by Sandy's trusted provisioner.

## Separate Google Cloud identities and enduring permissions

- **Sandy policy administrator:** Existing `sandy-cloud-administrator@elaborate-haven-511518-a5.iam.gserviceaccount.com`. A genuine external project administrator must establish its **standing** IAP policy-management entitlement in each approved project (prefer a reviewed custom role permitting `iap.tunnelInstances.getIamPolicy` and `iap.tunnelInstances.setIamPolicy` rather than broad Owner or unrestricted project administrator). The policy executor may only grant/revoke the fixed technical worker's IAP tunnel access for enrolled VMs, with exact before/candidate policy hashes, etag compare-and-set, one write, readback and independent receipts. The administrator role is never given to the coding worker.
- **Sandy technical computer identity:** Existing `sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com`. It gets IAP-Secured Tunnel User access on **each enrolled instance automatically** when Sandy provisions/enrols it; its IAP access condition limits TCP to SSH port 22. Use OS Login with least-privilege `roles/compute.osLogin`, and `roles/iam.serviceAccountUser` on an attached service account only where Google explicitly requires it. Windows and non-SSH ports require separately reviewed operation classes and an independently verified transport.
- **No permanent keys:** Keep IAM policy bindings durable until revoked, but authenticate workloads using Google metadata/WIF + short-lived service-account impersonation. Refresh credentials automatically. Never store a user-managed service-account key in Supabase, GitHub or an LLM prompt.
- **IAP networking:** Enforce firewall source `35.235.240.0/20`, TCP 22, with VM-specific firewall targeting; avoid broad public ingress. Preserve currently functional SSH paths until a proven migration.

Google IAP currently does **not** support IAM tag-based scoping for IAP TCP access. Therefore Sandy's signed enrolment registry and project permission boundaries are crucial. A **project-wide** IAP Tunnel User grant would grant potential tunnel rights to every VM in the project (even those not Sandy-enrolled); prefer Sandy-administered **instance** IAP bindings automatically as part of provisioning rather than relying on a project IAM condition.

Sources:
- https://docs.cloud.google.com/iap/docs/using-tcp-forwarding
- https://docs.cloud.google.com/iap/docs/managing-access
- https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation

## One canonical Sandy API trust boundary

Reuse existing Sandy `sandy-engineering-control`, `sandy-operation-api`, the protected Cloud Run worker, original shared execution-admission/receipt ledger and `sandy-vm-protocol-api`. No second queue, no public shell executor, no registry flag change without actual acceptance.

**Standing owner grant:** A genuine Controller owner authenticates once for a project's fleet grant and may later revoke or narrow it. The standing grant stores project allowlist, operation classes, approved command/template digests, budgets, revision, service identities and `expiry_mode: until_revoked`. It cannot outlive a revoked parent identity or project delegation. Revocations must propagate at every admission and immediately before remote execution, including after IAP/SSH handshake. It is not a standing permission for arbitrary IAM changes, arbitrary command text, cross-tenant operations or new cloud projects.

**Each execution:** Server obtains actor from verified identity, rechecks current owner delegation, current registry enrolment and fresh Compute provider identity, consumes an idempotent bounded operation, executes a pre-approved command template in a restricted Linux account, and saves real exit code/digests/receipt. The command is not deemed successful from a queue acknowledgement. Unknown provider/write outcomes are held for reconciliation, never retried blindly.

**Server enrolment:** When Sandy provisions a new Linux VM in an approved project, its managed provisioner records the actual Google instance ID, boot generation, service account, project/zone and independent enrolment evidence, performs an instance-level IAP grant using the standing administrator entitlement, enables OS Login only after preserving existing SSH access, confirms IAP port/firewall, pins verified SSH host identity, then marks the machine available. If those checks fail, enrolment remains pending.

## New source: reusable admission guard

`services/sandy-engineering-mcp/src/standing-fleet-authority.mjs` validates current standing authority and immutable fleet membership for the operation classes `gcp.iap.ssh.ensure`, `gcp.vm.ssh.status`, `gcp.vm.ssh.exec`. It has no Google credentials or network calls. It explicitly **does not grant Google IAM access**; that requires the protected provider adapter and live administrator permission.

This code must only receive server-derived `trustedContext`, current policy and Google Compute observations; untrusted user input must never be allowed to construct those trusted objects.

## Production activation / acceptance

1. Register and genuinely approve a **new standing-fleet security-policy change** covering the above declaration and every project. Older change `d22f048a-c961-493b-b155-ea7a8d79af2f` authorises a single VM and cannot be treated as blanket fleet permission.
2. Validate an installed administrator identity has the exact IAP policy-write capability. If absent, an already-authorised Google IAM policy administrator must establish the standing role **once per approved project**. Never bypass the Google policy boundary.
3. Implement the standing delegation with an Owner-authenticated RPC, guarded RLS/private audit, revocation semantics, version checks and verified per-operation worker callbacks.
4. Release only exact source/manifest-pinned components under the existing GitHub `sandy-production` environment with drift check, canary and rollback.
5. Demonstrate both existing `sandy-deploy` and a disposable **new** server enrol automatically, requiring no additional human approval; then independently verify actual SSH command outputs, deny cross-project/unenrolled targets and verify revocation stops new commands.
6. Verify operation registry state only after actual provider receipts; never mark source-only checks as SSH or Antigravity deployment.

**Truthful current state:** This document and guard are source, not a Google IAM grant or a running VM agent.
