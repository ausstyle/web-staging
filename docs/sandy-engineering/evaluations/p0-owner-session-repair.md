# Controller owner-session repair and routine delegation — prepared, not deployed

The normal Supabase Auth endpoint confirmed that the configured exported owner
JWT is expired (`bad_jwt`). The owner confirmed that the refreshable normal owner
session exists **only in the signed-in Controller browser**. The runner cannot
renew a standalone access JWT or turn its non-owner engineering bootstrap into an
owner. No human OTP was minted, refresh credential exported, workload grant
expanded, or approval status written by this runner.

The existing Controller browser pathway now has a prepared session transport that
refreshes that same Auth identity before expiry and once after a known
pre-dispatch authentication rejection. Unknown transport outcomes and authorization
failures never replay a mutation. A prepared owner UI records the exact tested
release pins and reads back the matching actual actor/audit event. The Controller
migration makes owner approval and its audit insert atomic.

## Current V4 release state

Change `07894248-0808-4ae0-a271-2fb850ec054d` is now `approved` in the database,
but its new `owner_directive_manual_db_approval` entry identifies administrative
SQL access and explicitly records `owner_session_verified: false`. It has no
authenticated owner actor. This is not the requested authenticated owner workflow.
The read-only admission check rejected that state. The administrative record is
preserved; the runner has neither reset the status nor forged a replacement event.
The original V4 source `3734254e872fcb2f0b5270aac43f8540b40726a2` and manifest
`1cd49be83211912bae2fce62bf0f0415a486e5f904a48acc65f4c852b2986017`
remain unchanged and undeployed. Live V4 29 / workspace 46 retain their previously
verified source, pilot configuration, Gmail confirmation and memory-ingestion hook.

The prepared authenticated owner action can attest an already approved but
unattested release without resetting status. It requires the existing source and
manifest pins and records `owner_release_attested` with the actual authenticated
owner actor. An administrative status or self-reported owner identity cannot pass.
The existing engineering workload still cannot invoke approval or policy actions.

## Execute the existing authorization in the real owner browser

This is a technical execution handoff because no tool in this session can access
the owner's browser session. It does not request a replacement token or renewed
consent. The repair is a separately pinned high-risk security change; its
registration request is intentionally outside the engineering workload's low/normal
risk grant.

1. Open the existing [Sandy Controller](https://ausstyle.github.io/web-staging/sandy/controller/)
   in the browser containing the real owner session. Use the existing Sandy sign-in
   if that browser session itself needs renewal.
2. Review [the fixed authentication-repair browser action](p0-owner-authentication-repair-browser-action.js),
   [its owner request](p0-owner-session-delegation-owner-request.json) and
   [the pinned source manifest](p0-owner-session-delegation-source-manifest.json).
   Run that fixed script once in that Controller page's browser console. It uses
   the normal Supabase SDK and the already-deployed authenticated Engineering
   Control owner workflow to register/record the already requested repair. It
   prints only the resulting change ID, status and audit-verification booleans.
   No browser credential is copied or sent to Codex.
3. Return the resulting security-repair change ID. The runner must independently
   verify the genuine enabled-owner event and exact pins before applying this
   migration or deploying the Controller repair. It must not use chat as proof.
4. After that governed repair is deployed, [the fixed deadline owner action](p0-authorized-owner-browser-action.js)
   can record the genuine owner attestation for the already authorized V4 change.
   The runner must re-read the actual owner audit and current source before its
   separately pinned V4 canary upload, then exercise the real overdue-task result.

Neither browser script deploys software, sends customer communications, changes
customer records or enables the standing policy. If a result is uncertain, inspect
the recorded state instead of repeating a mutation. The fixed deadline action
requires the repaired attestation endpoint when the database is already approved
without a real owner event; the legacy endpoint alone rejects that transition.

## Separately prepared standing policy

This extends the existing `sandy_engineering_delegation_policy`; it does not create
another credential or grant approval permission to the renewable workload. Only a
normal current owner can authorize/revoke it. It expires within 30 days, names
bounded routine targets, and requires low/normal risk, exact tested source/manifest,
rollback evidence, an independent trusted GitHub review, a successful actual GitHub
Actions run of the pinned read-only workflow, the identical committed manifest,
and a bounded source diff. Executable browser actions, authorization, credentials,
security, migrations and other protected paths remain outside routine approval.
Revocation, current owner status and policy revision are checked again inside the
approval/audit transaction. Legacy broad implicit approval paths are disabled in
the prepared source; explicit owner actions remain available.

Automatic evaluation currently runs from an **active signed-in owner Controller
browser**, through its normal renewable session. It does not provide unattended
runner/OIDC approval while that browser is closed. That limitation is explicit;
no engineering identity is impersonating the owner. The policy and scheduler are
not deployed or activated. General unattended delegation is not certified.

## Verification and recovery

175 local composed tests passed (112 Executive tests plus 63 owner/session,
workload, routine-policy and browser-action tests), alongside 13 assertions in an
isolated PostgreSQL WASM database. No SQL test used production data. The Controller
entrypoint passed typecheck with the existing offline SDK fallback; frontend and
handoff JavaScript syntax passed. These are implementation checks, not live owner
session, deployment or customer acceptance passes. The composed count includes the
additional evidence-path policy test run after the 174-test suite.

Automatic approval review rejected invoking the real production uploader as a
negative guard test because a failed guard could deploy. A strictly read-only SQL
admission check completed instead; the release helper acquired no lease and ran no
upload. A real release remains blocked by absent authenticated owner evidence.

Recovery must stop the browser scheduler, revoke standing authority through a real
owner session, and preserve all audit rows. Prefer forward repair retaining the
higher-risk gates; do not automatically restore legacy broad approval behavior.
Captured Controller 51 source remains available for controlled recovery.

The high-risk repair source, migration and CI workflow remain unregistered and
undeployed. The frozen 60-case quality gate, consented memory persistence and all
four-channel acceptance remain incomplete. See [implementation evidence](p0-owner-session-delegation-evidence.json).
