# Renewable engineering access — P0 prerequisite

Scope: SANDY-ENG-0001/0003, engineering delivery dependency 0005. This is an
implementation/evidence record, not whole-runtime acceptance.

The configured personal Controller access token returned HTTP 401 on 21 October
2026. The owner explicitly requested permanent renewal through deployed
`sandy-engineering-runtime` v5. Its source was downloaded and matched the API
branch at `81bb9c7dd8fa3e7df1d05c4718af314a6c00dbde` before editing. Controller
v43 also matched. Prior bundles and original source maps are retained privately
in `/workspace/sandy-intelligence-evidence` for compatible redeployment.

The implementation reuses the existing dedicated nonowner Auth workload,
Vault-backed revocable bootstrap, credential epoch/generation, distributed issue
lease, normal Auth OTP session issuer, expiry cache and session retirement. It
adds `engineering/control` to that same private runtime. Sessions are forwarded
to the existing Controller, which still calls Auth.getUser first. Tokens never
leave the runtime.

The additive control grant permits registration, listing/reading its own changes,
and attaching tests/artifacts to those changes. Registration is restricted by
owner-authorized repository/component scopes and low/normal risk; new changes
remain PROPOSED. Workloads cannot approve changes, change status, dispatch jobs,
access another requester's changes or execute rollback. Normal human Controller
authorization is retained. Both existing identity revocation and the new expiring,
revocable grant are checked on every request and audited through the existing
immutable identity events. A grant is not a deployment authorization.

`scripts/sandy/engineering_control_client.py` reads the secure bootstrap binding
`SANDY_ENGINEERING_BOOTSTRAP`, or the explicitly installed private retained file
`/workspace/.cloud-setup/credentials/sandy-engineering-bootstrap`. It rejects a
symlink, nonregular file, foreign owner or group/world-readable credential. It
uses the fixed HTTPS runtime destination, preserves TLS/proxy settings, refuses
redirects and never receives Auth session tokens. Credential content must not be
printed or committed. A retained credential file requires the environment's
normal save/publish process to become available in fresh tasks; current-instance
installation alone does not prove fresh-task restoration.

Local verification: 33 runtime/session/control tests passed. Nine PostgreSQL
assertions passed in a rolled-back production transaction, covering valid active
sessions, forbidden deployment, foreign sessions, stale epochs, revoked/expired
grants, public-role denial and grant constraint checks. These do not establish
the production release or live registration; release evidence is recorded after
actual execution.

Rollback: revoke/disable the control grant immediately, restore the captured
Controller v43 and engineering runtime v5 source bundles, preserving audit and
all registered changes. Additive tables can remain inaccessible; do not delete
operational history or revert provider effects. Release uses a per-component
lease plus a live-source and metadata-version guard.
