# Codex engineering instructions — Sandy AI

These rules apply when working on **Sandy AI** files, services or engineering tasks in this repository. Do not apply them to unrelated projects.

1. Read [docs/sandy-engineering/README.md](docs/sandy-engineering/README.md) and the complete [Master Software Scope](docs/sandy-engineering/master-scope-v1.md) before substantial Sandy changes. The Master Scope governs architecture, runtime, privacy and acceptance standards.
2. The [161-family API scope](docs/sandy-api/api-scope-161.md) is subordinate to the Master Scope. For API work, review both.
3. Every substantial task must have one numbered scope under `docs/sandy-engineering/tasks/` using `docs/sandy-engineering/templates/engineering-task-scope.md`; register its metadata in `docs/sandy-engineering/scopes.json`. Do not create parallel undocumented scopes.
4. The manifest is synchronized automatically from GitHub `main` to Supabase `public.sandy_engineering_scope_catalogue`. Never edit synchronized fields in Supabase as the source of truth. The workflow is `.github/workflows/sandy-scope-sync.yml`; check its run and latest sync record after merging scope updates.
5. Use `public.sandy_operation_registry` as runtime operation metadata/evidence, distinct from scope requirements. An operation is not verified just because it is registered or deployed.
6. Preserve existing production services and customer data. Deploy progressively, use traceable releases and prove real post-deployment outcomes; maintain rollback and failure evidence.
7. Sandy MCP is an adapter to Sandy API; do not add competing provider executors.
8. For new or changed requirements, update the task scope, acceptance criteria and linked engineering evidence. Never silently change the Master Scope's intent.

First runtime priority: `SANDY-ENG-0001` (reasoning, context, truthful execution and continuity).
