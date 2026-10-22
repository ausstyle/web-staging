# Amendment B implementation and current production boundary

Master v1.2 and AD-08 govern this change. Source
`24252d51c8d46089e5aa7cbc834e6feff40bd254`, manifest
`ab75f021eb275ba6be41944474cac0605f870ece04d1c30776d9126598e9dd85`.

The V4 correction is deployed and its real overdue-task API probe passes. The
standing-policy foundation is implemented locally, not deployed or activated.
The [machine-readable evidence](p0-amendment-b-evidence.json) distinguishes those
outcomes and records the live 403 scope denial.

Routine releases use the existing renewable workload session through Engineering
Control. The new `authorize_release` action evaluates the current actor-bound
grant, repository, branch, canary project/environment, target, low/normal risk,
expiry, revocation and daily release budget. It independently reads the committed
manifest, module hashes, import closure, trusted CI and source diff from GitHub.
Protected security, identity, pilot and confirmation changes are excluded. No
individual human review is required by Sandy's routine gate; active requested
changes and external provider protections still apply. Admission and its audit
commit atomically with the actual workload actor and grant revision. An existing
approved record retains its status and historical provenance.

`release_delegated_runtime.py` consumes that policy result, captures the original
bundle privately, holds a component lease, rechecks policy and source immediately
before one Management upload, reads back all original modules and records the
artifact through Control. It does not mark customer functional acceptance or the
whole scope complete. Timeout or uncertain provider results are never blindly
replayed; reconcile observed source/version first.

The Controller preserves the newer published engineering panel and refresh
behavior. Routine rows display authorization and evidence rather than an Approve
button. The draft's active-owner-browser approval scheduler is removed. The
standing-policy settings call normal authenticated administrator provisioning;
they do not export an owner token or authorize the workload to grant itself access.

The additive migrations install inactive capability. They do not seed a grant,
update historical approvals, backdate owner events or widen customer authority.
Before any security-foundation release, use its pinned administrative change
request and the existing legitimate restricted-administration process. Apply the
owner-session additive migration before the Amendment B migration, capture each
prior source bundle under its release lock and preserve exact version/source
optimistic guards. Existing grants remain unchanged until legitimate policy
provisioning. No such administrative caller is available to this runner: the
owner refresh session is browser-only, while the workload's existing grant
excludes releases. The new design itself is explicitly not a grant.

After legitimate provisioning, certify two distinct unattended routine releases,
revocation, expiry, wrong target, high risk, source mismatch and source-to-provider
readback in production. The 189 composed tests, 26 isolated PostgreSQL assertions
and five transport tests are local evidence, including two mocked release cycles;
they are not substitutes for those production canaries. Whole-scope completion
also requires all four channels and the frozen quality cohort.
