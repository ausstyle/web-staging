# PR306 review and remediation — independent verdict pending

Reviewed source: `b5a146ea744148b381810a10af7476b8a9fb6d69` against its main
base, with Runtime `cd6f6cf659e924bd0c9090445a7794ae122746ab` unchanged.

## Conclusion

One reproducible integrity defect was found and fixed during author source
inspection. The independent review runner did not initialize, so this report is
**not an independent approval** and the PR remains draft pending that review.
`codex review --base origin/main` exited before review with:
`failed to initialize in-process app-server client: Read-only file system (os error 30)`.
No review finding or approval is attributed to that failed invocation. No sandbox
expansion, credential change or retry through an alternate privilege was made.

## Fixed finding: mutable commit input across await (high)

`PostgresCommitBoundary` validated a byte proof and stored intent, then continued
to use the caller's mutable intent after awaiting the scanner. TypeScript
`Readonly` did not freeze the runtime object. A caller retaining its reference
could replace `ref.generation` after verification; the immutable version and
receipt then stored the unverified generation without rechecking the input digest.

The regression test reproduced this on the reviewed source: expected generation
`1`, actual `unverified-generation`. The fix snapshots and freezes intent/ref and
byte proof/ref at each public boundary before any await, snapshots admitted
facts, and freezes the version receipt/ref before handing it to projection.
An additional test mutates actor and tenant during preparation and checks all
four entry points retain the original identity. No caller object is mutated.

Affected validation passed after remediation: 15 isolated PostgreSQL transaction
cases, 8 canonical API/projection cases, 8 actual Runtime composition cases,
9 PostgreSQL 17.6 multi-session cases with three backend PIDs, 52 Deno tests and
type checking. The disposable localhost database was removed after tests.
These are source/fixture evidence, not live provider acceptance.

## Read-only existing-resource inventory

On 2026-10-24, connected Supabase `get_project` and metadata-only `execute_sql`
queries observed the following for `zmqlyygzqoidkcwdysok`:

- Project `Email AI`, region `eu-west-1`, status `ACTIVE_HEALTHY`, PostgreSQL
  `17.11.0.003`. This is existing Supabase inventory, not authority to choose the
  different proposed GCS region or incur its charges.
- No ordinary tables were returned in `sandy_cloud` or
  `sandy_artifact_custody`; candidate schema installation has not been established.
- `public.sandy_api_execution_admissions` and `public.sandy_universal_files`
  are owned by `postgres`, have RLS enabled and FORCE RLS disabled.
- The actual portal table is `public.sandy_memory_portal_accounts`, with
  `auth_user_id uuid`, `customer_id uuid`, `enrolled_at timestamptz`, and
  `revoked_at timestamptz`, matching the existing Cloud validator source.
- Admission metadata includes actor/tenant/operation, input/contract/scope hashes,
  state and expiry expected by the Runtime seam.
- `information_schema.role_table_grants` returned full table privileges for
  `postgres` on these three public tables and for `service_role` on portal/files,
  but no `service_role` admission-table grant in that view. This limited inventory
  does not enumerate effective role inheritance, function-mediated access, or
  authorize selecting either principal for Cloud.
- A table-name search for writer assignments and tenant/customer relations found
  no named matches. This does not establish that no canonical relation exists
  under a different name; production mapping remains unestablished.

Queries read catalogues and column/grant metadata only: no customer records,
files, secret values, role memberships or trust material were read or changed.
No previously denied branch-protection, artifact, provider-list or log-download
operation was retried. No release, IAM, credentials, trust or paid resource was
activated. The single activation decision list remains
`minimal-activation-proposal-20261024.md`; this inventory narrows evidence but
cannot supply the missing installation identities or approval receipts.
