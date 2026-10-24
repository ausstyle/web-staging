# Runtime channel activity evidence — 24 October 2026

Existing scope: SANDY-ENG-0001/0003/0006 (grounded, customer-scoped cross-channel answers).
This is independent of PR301's paused task-count change and the closed finite-ten
mutation acceptance (event250). Neither is rerun or modified.

## User-visible outcome and completion criterion

When asked how many messages Sandy holds across channels, unavailable exact-count
metadata must remain unknown, never an asserted zero. Verified channels remain
usable; genuine empty results remain zero. Incoming customer-linked email is still
separate from mail authored by a verified customer address.

Completion requires: isolated actual SQL→identity→snapshot→inspection tests covering
missing/invalid evidence and tenant boundaries; protected source-preserving release;
then one new normal-customer web question through the real model/inspection route,
with answer compared to independent fixture SQL and actual operation/model receipts.
The live test does not inject a production database failure. The unavailable-count
branch is verified by the isolated integration tests, not claimed as live fault testing.

## Exact baseline and bounded change

Independently retrieved Runtime38's32 modules. Its snapshot collector uses missing
exact counts as zero in web and cross-channel facts. Candidate release replaces only
`_shared/sandy-agent-operations/runtime_snapshot.ts`. All other module bytes, JWT
configuration, entrypoint, API65, task-count module, V1 calendar/tasks and LiveKit are
preserved by the existing release manifest/lease/preimage checks.

`exactCount` now accepts only nonnegative safe integers with no query error. Invalid
counts become null and appear in missing coverage; the originated subset stays null
unless every constituent count and its sum are representable. Malformed or truncated
verified-identity lists cannot become proof of no messages. Complete empty WhatsApp
identity lists still prove zero linked verified-origin messages. Empty email sender
lists remain unknown, as before. No new identity or permission is introduced.

## Integration and release

Four isolated PGlite tests execute real authentication binding, SQL-filtered records,
snapshot collection and operational inspection. They include foreign rows, user vs
assistant voice turns, authored vs linked email, malformed counts, genuine zeros,
malformed identity rows, and persisted task ownership changing after snapshot capture.
The full shared agent-operation suite passes55 tests;16 Python slice/workflow tests pass.

The existing protected `sandy-runtime-slice-release.yml` component `runtime` installs
only the reviewed module and performs independent readback, then invokes the new
bounded web inspection acceptance. It runs one question, at most the runtime's four
model rounds, against newly isolated normal Auth customers. It does not call external
messaging providers or the successful memory/mutation suites. Cleanup bans fixture
Auth, retires sessions, removes mutable fixture data and retains immutable receipts.
No Auth/customer purge, grant, scanner trust or persistent access is added.

Rollback retains the exact Runtime38 bundle and restores it only after checking the
installed candidate modules, via the existing reviewed manual rollback procedure.
Any source drift blocks before deployment; no automatic reinstall or retry.

At source publication, deployment and live answer acceptance are still pending.
The acceptance script appends its actual result to the existing change event ledger;
a provider failure or partial cleanup cannot count as acceptance.
