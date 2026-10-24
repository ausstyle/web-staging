# Conservative mission restart reconciliation — SOURCE ONLY

Implements an isolated subset of SANDY-ENG-0004 MTR-T01/T02/T07. No migration, live grant, role, credential, scheduler, API route or isolation deployment is included. Existing Runtime41/executor24 milestones remain closed.

The immutable canonical audit UUID is the non-reassignable attempt fence. Recovery requires exact audit/run/customer/mission/source bindings and follows canonical audit → run → parent locking. It never creates another attempt or redispatches model/provider work.

- A committed succeeded receipt is accepted only with matching completed run, product and review links. Return historical `draft_recorded` with stable IDs; repeated recovery produces no new rows. It does not claim current customer approval, mission completion or external execution.
- A canonical waiting receipt remains waiting across restart.
- An active claim returns running plus its deadline. It never changes ownership merely because a process restarted.
- After five minutes from immutable receipt creation, or parent cancellation/archive, an unresolved started claim is terminally fenced using the existing unknown-receipt RPC. Another run for that unresolved milestone remains blocked. Late finishers cannot replace terminal unknown.
- Insufficient/mismatched terminal links stay unresolved. Current authorization is not inferred from historical receipts; the private candidate returns `execution_allowed=false` throughout.

The five-minute watchdog threshold is a proposed conservative bound for the existing fixed80-second internal draft request, not a production SLO or authority grant. No renewal, reassignment, caller clock or automatic provider replay exists. Paid work whose response was lost remains unknown. Resolution beyond existing canonical receipts requires separately supported read-only provider evidence; absence of evidence cannot prove that an effect did not happen.

## Transaction-boundary limitation

The additional constraint trigger checks deadline at default deferred evaluation, including a finalization transaction that waits past its deadline. PostgreSQL allows a caller to use `SET CONSTRAINTS ... IMMEDIATE`, evaluate before expiry, and commit afterward. The cohort deliberately reproduces this; it is not hidden or asserted to fail.

Consequently this candidate **does not provide an unconditional deadline-at-COMMIT guarantee for arbitrary caller-managed transactions**. The terminal row lock/state fence still linearizes watchdog and finisher and prevents duplicate publication. Future activation must bind the private recovery/finish calls to the reviewed fixed single-RPC transaction path, or replace the time-fence design if arbitrary transactions are required. Existing PostgREST RPC usage suggests a candidate boundary; this test does not certify it as an isolated production fault route. Do not grant general SQL execution to make it work.

## Evidence and remaining work

The extended disposable PostgreSQL17.6 cohort uses actual killed Deno clients, canonical receipt SQL and real lock waits. It checks terminal recovery exactly once, active restart observation, watchdog fencing versus a late finisher, cross-run/foreign refusal, cancellation order, durable waits, default deferred expiry and the explicit IMMEDIATE-mode limitation. Synthetic clock setup changes only the disposable table's insert default and restores it; receipt guards are never disabled. Fixture RPC/provider identities are not real provider receipts. Surrounding domain tables and owner privileges remain fixtures.

Source can be reviewed and tested without activating it. Before live use: verify exact installed SQL preimages and all domain triggers; prove the fixed transaction boundary and existing dedicated worker identity; define the bounded watchdog scan/admission route; review any exact required grants separately. All functions here are revoked from PUBLIC, anon, authenticated and service_role. There is no automatic polling or deployment hook.

Live fault injection remains unattempted. The shared executor has no verified synthetic-only queue/process partition. That boundary must isolate server-validated fixture IDs, owned processes/connections, observation and cleanup without admitting unrelated/customer jobs. No public fault switch or shared-worker termination is proposed.
