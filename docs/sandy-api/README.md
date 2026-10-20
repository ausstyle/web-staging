# Sandy API — shared engineering handoff

This directory is the canonical **GitHub documentation handoff** between ChatGPT, Codex and Sandy's engineering agents.

## Sources of truth

- **Requirements:** `docs/sandy-api/api-scope-161.md` (161 scoped requirements, including function families).
- **Live implementation and evidence:** Supabase project `zmqlyygzqoidkcwdysok`, table `public.sandy_operation_registry`.
- **Runtime and source:** deployed Edge Functions and corresponding checked-in source, not assumptions derived from registry entries.

The original requirements were also created as `Sandy_Autonomous_Control_API_Specification.pdf` and `Sandy_API_Function_Inventory.xlsx`. The scope document provides architectural context. The Markdown checklist is the convenient in-repo textual reference. Avoid treating the current 90 registry records as equivalent to the 161 requirements.

## Universal API routing rule (mandatory)

All supported Sandy actions—including customer operations, engineering changes, cloud provisioning, database changes and GitHub changes—must be defined and implemented as concrete Sandy API operations. **Sandy MCP is an adapter to Sandy API, not an independent executor.** Its tools discover their contracts from Sandy API's canonical registry-backed catalogue and invoke the corresponding Sandy API handlers. All platform applications use these same contracts; do not add new private operation catalogues or parallel provider executors.

See the normative section **Mandatory universal API and MCP architecture** in `api-scope-161.md`. Implementations must prove real backend effects and update registry evidence; adding a registry row or MCP wrapper alone does not satisfy the requirement.

## What Codex should do

1. Read `docs/sandy-api/api-scope-161.md`.
2. Inspect deployed Sandy Supabase project and GitHub source for each requirement.
3. Map each scope item to existing or newly required executable operations.
4. Implement missing handlers in version-controlled source; run tests and deploy through authorized CI or Supabase tooling.
5. Record deployment version and **actual successful test evidence** in `public.sandy_operation_registry`.
6. Keep requirements and verification separate: registered, implemented, deployed, and verified are different statuses.
7. Follow provider IAM, tenant isolation and security policies; do not broaden executor access just to make tests pass.

## Shared coordination convention

Codex writes progress to `docs/sandy-api/implementation-status.md` and commits code changes to this repository. ChatGPT reads those commits to review or continue work. New requirements go into `docs/sandy-api/api-scope-161.md`, and actual runtime state remains in Supabase. Never store credentials or customer secrets in this repository.

## Last independently observed state (20 October 2026)

- Sandy operation registry: 90 entries, 3 marked verified.
- `sandy-infrastructure-read` deployed v4.
- `sandy-deployment-api` deployed v34.
- `sandy-engineering-control` deployed v35.

These are **historical observations**, not a claim of current production readiness. Requery Supabase before work.
