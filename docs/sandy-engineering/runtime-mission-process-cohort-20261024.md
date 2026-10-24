# Mission process-death, wait and cancellation cohort

Supporting SANDY-ENG-0004 MTR-T01/T02/T07 evidence. Source-only test addition; it neither changes worker behavior nor certifies full mission recovery.

## Isolated environment and exact coverage

Pinned PostgreSQL17.6 image `sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929`, fixed loopback55432, database mission_ci and literal disposable fixture identity. The test refuses a nonempty public schema. It loads the unchanged receipt table, guard and RPC portion of migration20261021010060 plus the existing single-active-stage index. Registry publication is excluded. Surrounding customer/task/run/product tables are minimal domain fixtures, not a reproduction of every production trigger/RLS policy.

The test starts real Deno child clients, observes an explicit transaction checkpoint, kills only that child with SIGKILL and inspects persisted state through a new connection. There are no model or external provider calls, no real customer records and no shared worker termination.

| Case | Required observation |
| --- | --- |
| Kill before claim COMMIT | Transaction rolls back; fresh client can claim once |
| Kill after claim COMMIT | Durable started receipt fences another claim; no draft/review appears |
| Kill during finalization before COMMIT | Draft/review writes roll back; original started claim stays fenced |
| Kill after finalization COMMIT | One terminal receipt, draft and review survive reconnect; duplicate claim refused |
| Concurrent duplicate claim | Second client visibly waits on PostgreSQL lock and then refuses duplicate claim |
| Durable dependency wait | Waiting receipt survives reconnect; original run cannot replay; a new run still waits before prerequisite completion, then a subsequent run becomes eligible after completion |
| Cancellation wins | Finish visibly waits behind parent cancellation, then refuses; zero draft/review rows |
| Draft commit wins | Cancellation visibly waits behind atomic finish, then cancels parent; exactly one historical draft/review survives and finish replay is refused |

Lock races use pg_blocking_pids observations rather than timing assumptions. SQL statements and child readiness are bounded. Fixture initialization and child cleanup close their own resources on failure.

## What this proves and does not prove

These are real database/process failure tests of canonical receipt SQL. The client runs as the disposable database owner; this does not prove production service-role/RLS behavior. Cancellation is a synthetic direct status update and does not certify the public customer cancellation handler. Wait persistence/eligibility does not certify timer-driven resumption or a multi-step mission. Synthetic provider receipt strings are test data, never real provider evidence.

Post-claim process death is safely fenced but remains state=started. There is no automatic liveness/restart recovery in this result. The remaining implementation requirement is a governed stale-attempt reconciliation/watchdog path that preserves uncertain provider effects and fences late finishers; simply requeueing these rows would risk duplicate paid work. Full MTR-T01, lease epochs,20-mission cohort and24-hour soak remain open.

## Live injection decision: stopped, no attempt

Read-only inspection confirmed live sandy-mission-executor24 selects the oldest two queued execute runs across the shared queue. Its dedicated renewal authentication does not supply a synthetic fixture selector or isolated worker. The existing protected slice route deploys/verifies source; it does not create a safe fault-isolation boundary. Killing or faulting that live worker could affect unrelated work.

Required before live injection: an existing authorized isolated canary worker/queue partition with server-enforced fixture IDs, bounded faults affecting only that process/connection, separate observation and cleanup, and proof that shared scheduler/customer jobs cannot enter the cohort. No such route was verified. Do not widen worker credentials, add public fault switches or disable the shared timer to manufacture isolation. Continue isolated acceptance until that boundary is concretely available and authorized.

Runtime41 and executor24 accepted/source-verified milestones remain unchanged. PR301's denied transition stays stopped. Cloud PR306 merge736cf169 is source integration, not custody activation or resource authority.
