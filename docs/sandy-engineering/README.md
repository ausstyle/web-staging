# Sandy Engineering — specification hierarchy and task scopes

## Source of truth

1. **Master Software Scope** — Sandy's governing target architecture and acceptance standards, version 1.0 dated 19 October 2026. The original owner-provided Word document is **Sandy_AI_Master_Software_Scope_v1(1).docx**. A [full searchable text extraction](master-scope-v1.md) is published for Codex; the original DOCX remains the archival source. See [master-scope-reference.md](master-scope-reference.md) for a navigable section index.
2. **API implementation specification** — [../sandy-api/api-scope-161.md](../sandy-api/api-scope-161.md), subordinate to the Master Scope. The original DOCX/PDF source should be attached as the governing archive.
3. **Subtask engineering scopes** — one numbered specification per engineering objective in [tasks/](tasks/), written using [templates/engineering-task-scope.md](templates/engineering-task-scope.md).
4. **Live capabilities and verification** — Supabase project `zmqlyygzqoidkcwdysok`, `public.sandy_operation_registry`. Registered does not mean executable, and deployed does not mean tested.

## Governance

- Master Scope takes precedence for mission, behavior, security, runtime, product requirements and architecture.
- Detailed API spec defines provider-operation contracts; task scopes refine, but cannot silently override, higher-level requirements.
- GitHub holds approved, version-controlled specifications; Supabase holds a searchable catalogue, status, references and evidence. Do not duplicate full mutable document contents in two locations.
- Every task references specific Master Scope sections, API requirement numbers, previous related changes, source paths, environments, dependencies, risks, acceptance criteria, tests and actual deployed release.
- Any conflict must be recorded as an architecture decision with owner approval.
- Do not change or mark master requirements completed simply because a task's PR is merged.
- Codex, Sandy agents and ChatGPT should first read this file and the relevant linked task spec before acting.

## Lifecycle

`DRAFT → REVIEWED → APPROVED → IMPLEMENTING → TESTING → DEPLOYED → VERIFIED → CLOSED`; optional `BLOCKED` with precise reason. State must reflect evidence, not intent.

Task ID format: `SANDY-ENG-0001` etc. Store as `tasks/SANDY-ENG-0001-slug.md`. One owner, one canonical document and source-control history per task.

## Initial priorities

P0: Chat/agent runtime reasoning reliability and accurate tool execution. P1: MCP/API engineering delivery, automatic two-way calendar sync, video infrastructure once remote execution works. Treat priorities as adjustable by product owner.

## Supabase catalogue

Use `public.sandy_engineering_scope_catalogue` to discover document locations, versions, hierarchy and delivery status. Application clients must access it through authenticated Sandy API with tenant and engineering permissions; no anonymous direct table exposure.

## Automatic GitHub → Supabase synchronization

The source for every specification is a GitHub file. The machine-readable document index is [scopes.json](scopes.json). Whenever `main` changes a scope, the [Sandy scope sync workflow](../../.github/workflows/sandy-scope-sync.yml) runs and authenticates with a **short-lived GitHub Actions OIDC token** to the deployed `sandy-engineering-scope-sync` Supabase Edge Function. It also runs daily and can be manually dispatched to repair missed push events. No permanent GitHub-to-Supabase API key is required.

The sync function verifies the exact GitHub repository, branch and workflow, reads `scopes.json` and each referenced Markdown file at the immutable commit SHA, computes a SHA-256 content hash and upserts metadata in `public.sandy_engineering_scope_catalogue`. It records success/failure in `public.sandy_engineering_scope_sync_runs`. Existing verification evidence is preserved.

**To change a document:** edit the Markdown in GitHub, update `scopes.json` when adding/removing/renaming a scope or changing its title, priority, hierarchy or status, merge to `main`, and check the sync workflow plus the database `last_synced_at` and `source_commit_sha`. Merely changing a Markdown document triggers a sync and new content hash even if its manifest metadata is unchanged.

**Authoritative source:** GitHub is authoritative for document text and source metadata; Supabase stores discovery data, linked records and verified operational evidence. There is no two-way document editing or automatic Supabase → GitHub document write. Manual updates to synchronized catalogue fields may be overwritten by the next GitHub sync. A missing file causes the sync to fail visibly; it never silently marks a document as synchronized. Omission from the manifest does not erase historical records.

**Runtime access:** `sandy-engineering-scope-api` provides authenticated list/detail discovery to Controller operators and trusted Sandy services; clients must not query this administrative table anonymously. An authenticated end-to-end user-session test is still required before claiming availability via every Sandy channel.

