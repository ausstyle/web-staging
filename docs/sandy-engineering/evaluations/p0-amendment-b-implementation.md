# Amendment B — one owner action, then standing authority

Source `5b37a1a3588b3030c9451084724c892ed07574dd`, manifest
`8f67fa1d8c975525c7dfd311d59af9b6e7f049c5bfec90388b559cf1bc5e1569`.

The existing Controller engineering-change panel now has **Approve Amendment B**.
On opening the panel as a signed-in owner, it idempotently registers a separate
high-risk proposal using these exact pins. One click records the owner action
through normal Engineering Control and independently reads its matching audit.
No browser-console code, database edit, token export or individual sub-step
confirmation is required. A status field alone is never treated as owner audit.

The owner also approves the frozen standing-policy declaration. The protected
administrative installer subsequently verifies the real owner event and applies
only that declaration. It records its own Management actor separately; it does
not mint an owner session, invent an approval event or let the workload establish
its own delegation. No owner browser is required after that approval.

Initial delegated authority binds the existing engineering identity, repository,
project, branch and V4/workspace canary. Only low/normal-risk routine releases are
eligible, with ten releases per day and zero new resource spending. The policy
lasts until revoked or the parent identity grant expires. Normal Auth sessions
and release admissions remain short-lived. Dated policy expiry, revocation,
wrong-target, high-risk and source/manifest denials remain enforced and tested.
CI, source verification, component locks, independent readback, idempotency and
rollback remain mandatory. Provider protections remain effective.

The separate owner-session repair change `e6c9fb87-db2c-4ed7-ac63-bbdb60aad127`
has a genuine enabled-owner approval bound to its original `f9958d50…` source and
`24b113ab…` manifest. Independent GitHub CI passed in
[run 39708487801](https://github.com/ausstyle/web-staging/actions/runs/39708487801).
Deployment is waiting at the existing GitHub environment gate: both environment
configuration and deployment-review APIs returned HTTP 403 for this integration.
The Amendment B release checks the exact repair bundle and schema as a prerequisite;
it cannot silently substitute its newer source under the older approval.

Current Control/runtime remain 51/13; V4/workspace remain 30/46. No V4 overdue
probe was repeated and no customer records, channel processing, memory ingestion
or pilot allowlist were changed. The old manual token-copy UI was removed.

Local verification: 196 composed tests, 31 isolated PostgreSQL assertions and five
release-transport tests. Actual grant activation, two unattended production release
cycles and the four-channel SANDY-ENG-0001 acceptance still require production
verification. See [observed exceptions](p0-authority-exceptions.json); optional
customer confirmations are not declared legally mandatory merely because they
exist in historical code.
