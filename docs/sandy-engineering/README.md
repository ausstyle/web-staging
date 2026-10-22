# Sandy Engineering — specification hierarchy and task scopes

## Start here

The governing target is **Master Software Scope v1.2**: the original baseline, Amendment A and Amendment B. Routine engineering uses standing, revocable policy authorization without a per-release owner click. The amendment itself does not provision a grant. The stable filename remains `master-scope-v1.md`.

Read the [implementation program and eleven-scope index](implementation-program.md), then [shared architecture contracts](architecture-contracts.md) and the relevant numbered task. The [Sandy Learn browser skills scope](tasks/SANDY-ENG-0011-browser-workflow-learning.md) adds opt-in passive, explicit active and execution-based learning. **P0 is Sandy chat reasoning and runtime reliability**, not growing the API operation count. Eight detailed implementation scopes, 0003–0010, now complement 0001 and 0002 with explicit ownership, dependencies, API contracts, tests and recovery requirements.

## Sources of truth

1. **Master Software Scope** — [full searchable text with v1.2 amendments](master-scope-v1.md), governing mission, architecture, safety and acceptance. The original owner-supplied `Sandy_AI_Master_Software_Scope_v1(1).docx` is the archival v1.0 source; it is not a regenerated v1.1 Word file. See [section index](master-scope-reference.md).
2. **API specification** — [161 requirement families](../sandy-api/api-scope-161.md), subordinate to the Master Scope. Families expand into concrete actions; registry totals are not requirement completion counts.
3. **Engineering implementation program** — [program/dependencies](implementation-program.md), [shared contracts](architecture-contracts.md) and one numbered [task scope](tasks/) per objective. Supporting files refine the Master Scope; they do not silently override it.
4. **Live implementation and evidence** — Supabase project `zmqlyygzqoidkcwdysok`, `public.sandy_operation_registry`, release records and real provider/customer acceptance evidence.

## Governance and ownership

GitHub holds version-controlled requirements. Supabase holds searchable references, source hashes, status metadata and linked operational evidence. Do not edit the same document independently in both locations. Preserve existing customer state and working services; map existing implementation before adding tables, runtimes or queues.

0001 owns runtime-quality acceptance; 0003 the orchestrator; 0004 durability/truth; 0005 API/MCP and release control; 0006 knowledge; 0007 calendar; 0008 video; 0009 UI; 0010 commercial readiness. 0002 coordinates autonomy and owns bounded computer/proactive work. The [ownership map](architecture-contracts.md) prevents duplicate implementations.

Scope [0011](tasks/SANDY-ENG-0011-browser-workflow-learning.md) is a subordinate feature scope; merely observing a workflow does not confer execution permission or certify the skill.

Each substantial task references Master sections, API requirements, existing source/deployed state, dependencies, risks, acceptance IDs, migrations/releases and evidence. Use the [task scope template](templates/engineering-task-scope.md) and [acceptance evidence template](templates/acceptance-evidence.md). Any architectural deviation requires an ADR and the applicable owner review. Do not change master completion status because a task PR is merged.

## Lifecycle

`DRAFT → REVIEWED → APPROVED → IMPLEMENTING → TESTING → DEPLOYED → VERIFIED → CLOSED`, with explicit `BLOCKED` and precise reason as needed. These are engineering workflow states, not proof from document publication. A scope may contain independently accepted slices while the overall scope remains incomplete; record both accurately.

Task IDs are `SANDY-ENG-0001` etc., with one canonical file in `tasks/`. New IDs and document metadata are added to `scopes.json`. Scope 0005's engineering foundations and scope 0006's context foundations support P0 even though their full programs are P1. Calendar/video are P2; safety and tenant isolation are never deferred to P3 commercial launch.

## Automatic GitHub → Supabase synchronization

The source for every specification is a GitHub file. The machine-readable index is [scopes.json](scopes.json). Changes on `main` under the scope directories trigger the existing [scope sync workflow](../../.github/workflows/sandy-scope-sync.yml). It uses a short-lived GitHub Actions OIDC identity to invoke `sandy-engineering-scope-sync`; it also has a daily reconciliation schedule and manual dispatch.

The service verifies its allowed workflow identity, reads the manifest and each referenced Markdown at an immutable commit, computes content hashes and updates `public.sandy_engineering_scope_catalogue`. It records runs in `public.sandy_engineering_scope_sync_runs`. Metadata/source synchronization does not deploy the architecture or certify an API operation. Existing implementation evidence must be preserved.

To change a scope, edit its Markdown; update the manifest for a version/title/priority/status/path/hierarchy change; commit/merge to main; inspect the workflow and the catalogue's source commit/hash/time. The source_version must match the document's engineering version. A filename need not change for a new version. Supporting architecture/program/template files are resolved at the same pinned commit for reproducibility.

GitHub is the one-way authority for document content/metadata; Supabase is not a parallel editor. Missing sources must fail visibly. Omission from the manifest is not silent deletion of historical records. Stale/out-of-order commits must not overwrite newer accepted state; inspect and log sync defects rather than masking them with manual catalogue edits.

## Runtime access

`sandy-engineering-scope-api` supplies authenticated scope discovery for eligible Controller operators and trusted services; ordinary users must not receive privileged engineering information via anonymous direct tables. A database catalogue entry is not proof that every Sandy channel reads it correctly. Scope retrieval, API/MCP exposure and agent usage each need their own real integration evidence under 0005/0003.

## Immediate Codex work

Follow [AGENTS.md](../../AGENTS.md). Reproduce the 0001 failure cohort and implement the minimum 0003/0004/0005/0006 slices needed for accurate, contextual, truthful chat. Reuse verified work, commit source, stage/canary and record real outcomes. Do not start an unrelated frontend rebuild or wait for all provider families before fixing current runtime defects.
