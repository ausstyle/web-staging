# Minimal live activation proposal — inactive

This is a review proposal, not a release request with unresolved targets hidden.
Source integration has passed isolated real PostgreSQL concurrency/RLS checks;
that does not establish live identity, scanner trust or provider readiness.

## Existing-resource reuse stage (no new resource purchase)

Known target: existing Supabase project `zmqlyygzqoidkcwdysok`; preserve existing
universal-file IDs, portal mapping, Sandy API and Runtime workers, default storage
backend and deployed `sandy-files` v25. No Cloud SQL instance, new VM, new queue,
DNS change, customer-file import or default-backend switch is proposed.

Exact candidate source changes for joint review:

- Runtime PR303's private `sandy_artifact_custody` schema (Runtime release owner).
- Cloud `packages/sandy-cloud/postgres/schema.sql` plus `projection.sql`; source
  integrity manifest must be regenerated at the final accepted release commit.
- Bind the existing transaction adapter, canonical identity/reference loader and
  explicit Cloud writer assignment to the already reviewed interfaces. No mapping
  based on equal tenant/customer UUIDs and no implicit assignment of legacy files.
- Route only synthetic, explicitly selected canary identities through the existing
  API. The exact operation/contract hash, admission scope and canary IDs must be
  named by their owners before a deployable diff can be finalized. No fixture
  identity issuer or test operation label may be installed.

This stage has **zero newly proposed paid resources**, not a promise of zero cost
on existing metered services. It does NOT include new role grants, policies,
credentials, trust entries, registry exposure or live migration authority. Those
must be shown as separate exact changes. Current project capacity/backup receipts,
transaction endpoint/principal, canonical relations and release-owner lease are
still missing; consequently no activation command is submitted.

## Access/security changes — separately gated

No proposed new principal or broad standing credential. Request the existing
owners to identify the actual transaction principal, scanner workload/release,
public-key fingerprint, current grant set, canonical revocation writers and
provider binding. Then prepare a before/after SQL/IAM diff confined to those
identities and these private schemas. Required access is not yet known, so an
exact GRANT statement cannot honestly be approved now. Test roles/keys are not
eligible production values. Do not create BYPASSRLS as a shortcut.

The first live effect must remain disabled until source-preserved API/file-reader
compatibility, current scanner trust and exact-generation provider readback are
reviewed. Schema installation alone is not product activation or acceptance.

## New-resource stage — existing USD10 proposal remains unapproved

If authorized inventory shows the existing project cannot supply the required
private staging/Drive/vault boundaries, the separate earlier proposal is three
buckets in `elaborate-haven-511518-a5`, assumed `europe-west1`, with the exact names
and account/bucket matrix in `pilot-approval-request.md`, 30 days and USD10 ceiling.
Neither the region assumption, service identities/bindings nor spend is approved.
Do not provision those buckets merely because the reuse stage is accepted. No new
Cloud SQL compute, scanner/model spend or immutable retention lock is bundled.

## Bounded cutover and rollback

After exact identities/targets and protected release authority are resolved:
install additive private schema under the shared release lease, retain baseline
source/config, run synthetic two-tenant canary upload/readback/restore and negative
access tests, and leave existing storage/default routing unchanged. Any failure
freezes only new Cloud canary writes and restores prior routing/source. Preserve
versions, shared receipts, provider bytes and outbox; reconcile unknown outcomes.
No destructive down migration, user-data deletion or repeat of Runtime event250
mutation/cleanup is authorized by this proposal.

**Activation status: pending exact bindings and reviewed release/access authority;
not attempted, no uncertain live-write outcome.**
