# Runtime approved continuation and deferred task guard

Scope: SANDY-ENG-0001/0004 canonical mutation correctness; no replacement runtime or provider path.

## Completed production work

Explicit approval resolved the previous merge denials. PR288 merged at `19c90aff7247df113a34796d52367b8fd19e352b`; PR283 merged at `bfbabd3d01ceabd6924dd20262cb2e05ce046416`.

Protected source-sync run [40052280301](https://github.com/ausstyle/web-staging/actions/runs/40052280301) succeeded. Migration `20261024005700` installed, source and private permissions independently verified, and existing cron completed at 02:05:00 UTC. Durable event 233 (`existing_proposal_cron_resume_verified`) confirms the original clock, cross-channel and task-count proposals resumed to `source_evidence/waiting_evidence` against Runtime38/Examiner23. Original diagnoses/proposals were preserved; no new issues, approvals or paid investigations. Independent Architect review remains required; autonomous code release is not accepted.

## Finite-ten result and diagnosis

Approved acceptance-only run [40052204122](https://github.com/ausstyle/web-staging/actions/runs/40052204122) verified API65/MCP24/worker21 source and skipped installation, memory and narrow-cancellation effects. It failed `task_create_actual_MCP_receipt`; event232 reports zero mutation receipts. Readiness was revoked and fixture sessions retired.

Supabase PostgreSQL log at `2026-10-24T02:01:24.426Z` records SQLSTATE42501, `permission denied for table sandy_tasks`, at COMMIT. Context: `sandy_agenda_task_company_guard()` reads the parent task. Its constraint trigger is `DEFERRABLE INITIALLY DEFERRED`; execution therefore occurs after the canonical SECURITY DEFINER RPC returns to the caller role. Existing tests set JWT claims but did not exercise this deferred trigger under the authenticated database role.

Storage provider logs show both fixture deletions returned200. Independent read-only SQL found zero tasks, calendar events, companies, categories, analysis queue entries, universal files and storage objects for both exact run fixtures. Original report still records incomplete cleanup; this later evidence does not rewrite it. Auth fixture rows are intentionally retained and banned; primary fixture has zero sessions. The precise missing-object response classifier remains unconfirmed because the report artifact download is blocked by the environment proxy (403).

## Draft repair and verification

The additive migration pins live RPC source `2a06079d2ab9a630be5c28b126fb8526b12d6e17750c86500bd6cf7fb42a48db` and guard source `877199298ed083b4afe1a579fc366b1158c5517b7f748d1064d08e10e58e5cd5`. It flushes only the existing task constraint before writing the canonical receipt, within the existing RPC security context. It leaves the constraint immediate for the remainder of that transaction rather than weakening a caller's mode. Trigger defaults, function authority, table grants and tenant checks stay unchanged.

Isolated PostgreSQL regression reproduces the actual42501 commit failure with no receipt, then verifies all ten operations and same-key replays under SET ROLE authenticated after the repair. Inaccessible parent remains denied; direct table reads remain denied; both functions' owners/ACL/security modes remain unchanged. The original ten-operation suite and inherited18 memory/receipt checks also pass. These are local tests, not live acceptance.

This migration is NOT installed. Protected integration now provides `action=repair-task-guard` in `sandy-customer-mutation-certification.yml` on main. It pins the repaired RPC digest `746abc32895b64925f1e2a1aaf7808909b621acaa230d905772018228fceae07`, preserves exact API65/MCP24/worker21 source, locks the component lease inside the SQL transaction, installs only the additive migration, independently reads back source/authority, then runs finite acceptance. It skips API reinstall and prior memory/cancellation effects. Dispatch and unknown outcomes receive durable events; unknown outcomes retain the lease and require reconciliation rather than retry.

An independent read-only reviewer identified and confirmed corrections for exact trigger shape/name uniqueness, explicit task/receipt rollback, actual guard rejection after prevalidation, atomic lease custody, and durable release events. The task constraint stays immediate for the remainder of its transaction; its persistent default stays deferred. Private-readiness rejection and the actual trigger rejection are tested separately. No grant, trigger security mode or persistent authority changed.

Recovery is manual and conditional: the protected artifact captures the original RPC definition/ACL and requires the exact repaired digest before restoration. Preserve mutation receipts/revocations and reconcile migration history; do not perform automatic down migration.

Protected dispatch is blocked by the existing CLI credential returning401. Connected GitHub repository tools cannot dispatch workflows, and Composio discovery confirmed no active GitHub connection. No new connection or credential was created. An existing authorized operator/session must dispatch the exact reviewed main workflow. The original acceptance artifact response classifier remains unresolved; no denied artifact retrieval was retried.

The CLI credential now returns401. Connected GitHub reads/writes remain available; workflow dispatch and artifact download are not currently available through those tools. No credentials were created or broadened to compensate.
