# SANDY-ENG-0012 delivery checklist

Authority: [scope v1.0](../sandy-engineering/tasks/SANDY-ENG-0012-sandy-cloud-drive-backup.md)
and [architecture v0.1](architecture.md). Full scope retained; no MVP exception
or acceptance waiver has been approved. Baseline read on 23 October 2026 UTC.

## Source and live reconciliation

- PR [236](https://github.com/ausstyle/web-staging/pull/236) latest head:
  `b1b4d5227493145a87184495b7bca1fc1fa04602`; merged at
  `3c84274c61127f93052c1287c24abafc4d313aee`. Both refs fetched.
- Isolated worktree `/workspace/sandy-cloud-0012`, branch
  `sandy-cloud/deploy-scope-0012`. Other worktrees were not changed.
- Supabase catalogue readback: scope v1.0, DRAFT, source commit
  `7e0e225e64a80eb163575ae66edae9d830a66b81`, synced at
  `2026-10-23T23:51:59.881Z`. Its SHA-256
  `93adf0f017540fe21dc9fc7ae2a83b1dca6c2c42e9e752ef11a2ec4de2f6403b`
  matches the locally hashed complete scope. Synchronization is verified;
  implementation is not.
- Independently fetched deployed `sandy-files` v25, ACTIVE, bundle SHA-256
  `878e3fdd1184bfbe287d37e9e4eec92f54126f63d9d1494871fe2de1db6bb9bb`.
  Its source is absent from the main repository function directory. It validates
  Supabase user, portal account and primary email, then filters files by owner.
  It implements list/history/set_description/set_state/open only. Its state
  update and lifecycle audit are separate operations, not the required atomic
  Drive revision/outbox transaction. Do not overwrite it from an invented stub.
- Independently fetched `sandy-task-files` v16, ACTIVE, bundle SHA-256
  `23072d6f10f38e39b14d9c34ad29f854adccc489d05403afebe8c9f505dddc46`.
  Repository attachment completion checks listed object size; it does not prove
  Sandy Cloud digest, generation, immutable version or protected snapshot behavior.
- `files.library.list` and `.download` are API-exposed but live registry state is
  `deployed_unverified`, `verified=false`. Existing fixed contracts also include
  history, description.set and state.set. Keep these statuses unchanged.
- `sandy_universal_files`, references, links and lifecycle events have RLS enabled;
  no policies or anon/authenticated table grants were returned for these reads.
  The privileged handler remains responsible for tenant authorization. Existing
  lineage includes calendar attachments (24), task attachments (4), knowledge
  documents (64), email attachments (107) and WhatsApp media (13). These are
  aggregate reference counts, not imported private documents or acceptance tests.
- Existing storage registry: `supabase_existing`, verified/default, eu-west-1;
  `gcs_primary`, planned/non-default, no bucket/region/verified timestamp. Private
  Supabase buckets observed: email-ai-attachments, sandy-windows-private,
  sandy-whatsapp-media, sandy-task-artifacts, sandy-knowledge-originals,
  sandy-calendar-private, sandy-generated-images, sandy-task-attachments,
  sandy-spending-private. No bucket/default/data mutations performed.
- Registered GCP target project is `elaborate-haven-511518-a5`, zone
  europe-west1-b. This identifies existing infrastructure, not Cloud storage
  authorization, billing approval or residency approval.
- Existing draft [PR177](https://github.com/ausstyle/web-staging/pull/177), head
  `07bd4655cc74cea751dfa527f1ba9696238eecca`, owns proposed GCS Terraform:
  four private buckets and two service accounts. Read both complete files.
  It is not applied/verified evidence; no CI checks reported. It has no separate
  immutable backup vault; quarantine age deletion is configured, not backup
  retention. Do not apply it wholesale or duplicate its identities under 0012.
- Hosting PR238/203 and provider PR196 are distinct active work. Main advanced
  through runtime PR240 (`15863f9`) during inventory. No runtime, provider,
  gateway, hosting, DNS or shared release changes made. Database leases observed
  for engineering-runtime and legacy compatibility were expired; absence of a
  lease is not permission to take over a shared owner.

## Requirement-to-delivery traceability

“Partial source” is not deployed or independently accepted. All mandatory
acceptance scenarios remain pending. No product feature is newly deployed.

| Requirement | Delivery and canonical integration | Source status | Deployed | Independent acceptance |
|---|---|---|---|---|
| SC-01 namespace/company/tree | WP-1; existing identity + new admitted namespace mutations | Pending metadata ADR, ACL/tree/revision transaction | No | AC-01/02 pending |
| SC-02 transfers/versions | WP-1/2; complete-upload via Sandy API | Partial: streaming digest/generation verification and commit coordinator in `packages/sandy-cloud/integrity.ts`; resumable provider and DB adapter pending | No | AC-03/04 pending |
| SC-03 device sync | WP-4; durable revisions/cursors/conflicts | Pending desktop journal, offline reconciliation and server protocol | No | AC-05 pending |
| SC-04 secure sharing | WP-1/3; scoped version download/share operations | Pending grant/expiry/revoke/audit and exact-version delivery | No | AC-02/06 pending |
| SC-05 independent backup | WP-5; retained manifests/vault | Pending retention decision, snapshot engine, vault and scheduled verification | No | AC-07 pending |
| SC-06 restore | WP-6; restore admission/receipts | Partial: manifest path/tree and independent target hash verifier in `restore.ts`; restore job/client pending | No | AC-08 pending |
| SC-07 AI | WP-7; existing memory ACL/provenance boundary | Pending consent, sandboxed extraction, live ACL recheck and source version citations | No | AC-09 pending |
| SC-08 integrations | WP-1/3/7; stable universal-file references | Existing lineage inventoried; compatible projections/migration still pending | No new release | AC-10 pending |
| SC-09 usage/health | WP-8; existing billing/entitlements | Pending reservation, unique settlement, provider reconciliation, dashboards | No | AC-11 pending |
| SC-10 GCS rollout | WP-0/2/6; existing backend registry | Planned only; default preserved, PR177 reconciled | No | AC-12 pending |
| SC-11 desktop | WP-4; verified device identity | Pending signed macOS/Windows installer, encrypted journal, revocation, OS tests | No | AC-05/13 pending |
| SC-12 truthful recovery | WP-1/6; shared durable receipts/outbox | Partial: lost-ack reconciliation and unknown-outcome handling in integrity module; durable adapter pending | No | AC-04/08/12 pending |
| SC-13 mobile | WP-9, explicitly later in authoritative scope | Pending | No | AC-14 later |
| SC-14 bare-metal images | WP-9, explicitly later in authoritative scope | Pending | No | AC-15 later |

## Dependency order and release gates

1. **WP-0, partial:** complete provider inventory and SC-ADR-01/02/05 decisions.
   Preserve Supabase universal-file authority. Recommendation for owner review:
   keep metadata colocated with current Supabase identity/receipts for the first
   isolated pilot; do not create Cloud SQL without measured need and a separately
   accepted ADR. This recommendation is not a schema deployment approval.
2. **WP-1, partial source:** integrate the integrity module with a real atomic
   domain transaction after the metadata decision. Add namespace/tree/company
   grants, version history, quotas and transaction/outbox tests. Reuse the existing
   gateway owner for allowlist/contract integration; no parallel executor.
3. **WP-2, blocked externally:** resolve actual bucket inventory/ownership, exact
   region and approved spend, then review a source-pinned GCS plan and workload
   bindings. Quarantine/scanning, independent generation readback, resumable 10 GB
   upload, protected vault and provider failure drills must precede activation.
4. **WP-3:** implement Files UI through admitted Sandy API operations; signed-in
   two-tenant UX and 100 real negative cases. Local synthetic cases are insufficient.
5. **WP-4/5/6:** native signed clients, encrypted journal, two-device conflict and
   reconnect tests; independent backup retention; clean-device restore; fault and
   rollback drills. No computer-backup claim before these pass.
6. **WP-7/8:** opt-in ACL-filtered intelligence, malicious-document tests, usage
   and invoice reconciliation, privacy/support/operations and monitored cohort.
7. **WP-9:** mobile and whole-system recovery under their later acceptance gates.

## Verified checks and limitations

- 13 deterministic TypeScript tests passed: streaming size/hash/generation,
  100 synthetic tenant/workspace substitutions, cancellation, disconnected read,
  idempotent replay, lost commit acknowledgement, unknown outcome, malware gate,
  expiry/revocation, receipt mismatch and restore path/tree/corruption checks.
- One local Linux disk integration passed: create a synthetic 32 MiB file,
  independently reopen/hash it, reject one-byte corruption and an extra target
  file. This is not a native restore client, GCS result or AC-08 pass.
- Dedicated CI runs formatting, typecheck and both suites without provider
  credentials. CI receipts are linked from the implementation PR.
- No migrations, user file reads/copies, imports, sharing changes, grants,
  paid resources, deployment or default switch performed. No operation verification
  flags changed. Existing customer data and working routes are preserved.

## Precise external blockers / decisions

| Action / target | Observed result | Required resolution |
|---|---|---|
| Read GCS bucket inventory via `gcp.storage.buckets.list` for registered project | `canonical_operation_unavailable`, `executed=false`; registry is unverified, API-exposed false, permission `infrastructure:write` | 0005 owner supplies an authorized read-only provider inventory path or current provider receipt; do not relabel the operation to bypass policy |
| Read main branch protection on ausstyle/web-staging | GitHub HTTP 403 `Resource not accessible by integration` | Release owner verifies protected branch/rules and permitted merge path; no protection changes requested |
| Select transactional metadata owner | Cloud SQL is only a candidate; no decision recorded | Accept SC-ADR-01 before creating schema or cross-store ownership |
| GCS paid/security provisioning | No approved amount, exact runtime identity, bucket ownership or region evidence | Review exact plan with project, bucket names, region, retention, monthly currency ceiling, expiry, egress/operation limits and identity-to-role bindings; request approval only for that plan |
| Mac/Windows signed release and real two-tenant E2E | No verified signing/notarization identity, OS test agents or consenting pilot pair established | Supply scoped release identity/test devices and synthetic pilot tenants through existing connections; no standing owner tokens |

No action has an uncertain provider-write outcome: no provider writes were issued.
The next milestone is a metadata/provider ownership decision and a real isolated
upload/readback transaction, then MVP-1 Drive acceptance. Scope completion is not
claimed; remaining software requirements above still require implementation.
