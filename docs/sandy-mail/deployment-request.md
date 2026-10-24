# Sandy Mail first Cloud SQL/GCS canary — pending resource reconciliation

This is a reviewable request, not an approval or deployment receipt. No action below has been executed in Google Cloud. The requester requires action-time approval for paid resources, credentials, persistent access or IAM expansion.

## Exact currently blocked action

Run the first synthetic ingestion against a verified Cloud SQL PostgreSQL 17+ database and private GCS bucket in `elaborate-haven-511518-a5`, using the canonical protected release owner. No verified instance/database/bucket or Mail workload identity was exposed to this session. On 24 October 2026, `google_cloud.mcp.authenticated_discovery` succeeded but exposed only model readiness/canary, video preflight and change-details tools. The caller-visible operation catalogue offered no SQL/GCS inventory or ingestion operation. This is **missing capability/target evidence**, not a provider write denial, pending job or unknown write outcome. No cloud job was submitted.

First obtain authorized read-only inventory through the API/infrastructure owner: SQL instances and databases; GCS bucket metadata (location, public-access prevention, uniform access, versioning/retention); existing Mail-compatible service identity/grants; approved networking and protected workflow. Proposed provider reads are `GET sqladmin.googleapis.com/sql/v1beta4/projects/elaborate-haven-511518-a5/instances` and `GET storage.googleapis.com/storage/v1/b?project=elaborate-haven-511518-a5`, followed by target metadata. Do not broaden this request into token export or IAM changes.

## Shared ownership reconciliation

PR234 scope head `c318e66508243fb756ee159f1eb6ad3db865e4cd` and PR236 scope head `b1b4d5227493145a87184495b7bca1fc1fa04602` are documentation, not resource-provisioning evidence. Mail owns only `services/sandy-mail`, `core` inside a dedicated Mail database and an approved Mail object namespace. Hosting/DNS thread `01a16b0f-d405-70f7-b54a-998b253fe033` owns shared provisioning/DNS; Cloud storage thread `01a16b2c-8ef7-74c7-8689-b28945fb5021` owns its independent product; API thread `01a16b1f-53e8-7166-b524-b7adba363005` owns canonical authenticated ingress/release integration; Runtime thread `01a15a14-5817-7686-9be6-3f6d663fe051` owns runtime integration. Reuse their verified shared foundation and one release lock. No shared service/workflow/Supabase code is changed by this slice.

## Preferred resource diff

Reuse an **already approved** PostgreSQL 17+ HA shard and private GCS bucket in the selected residency region, after capacity/security/owner verification. Add database `sandy_mail_canary` only if approved and absent; apply the three initial migrations together with the existing authorized migrator. Add only synthetic tenant `23900000-0000-4000-8000-000000000001`, account `23900000-0000-4000-8000-000000000002`, mailbox `23900000-0000-4000-8000-000000000003`; all are fixture IDs, not real customers. Mailbox label `Synthetic Inbox`; envelope `sender@example.invalid` → `first-ingest@example.invalid`. No DNS record or actual address registration is needed. Write only its `mail/v1/<tenant>/<account>/<mailbox>/` prefix. One embedded 1,101-byte email plus a 33-byte attachment and a small recovery ledger; at most 100 synthetic retries and <1 MiB fixture storage.

A SQL runtime role must be non-owner/NOSUPERUSER/NOBYPASSRLS, with the bounded grants in the service README. Reuse a correctly scoped workload identity if one exists. If not, separately approve proposed `sandy-mail-canary@elaborate-haven-511518-a5.iam.gserviceaccount.com`, Cloud SQL connect/instance-user binding to the exact instance, and GCS object create/get restricted to the exact prefix. No bucket admin, object delete, shared service-account impersonation or general project admin. **Do not create that identity or grant those permissions until action-time approval.** The exact existing-role diff remains pending inventory.

## Quantified fallback if no shared capacity exists

Proposed synthetic-only fallback, subject to region and cost approval: instance `sandy-mail-canary-us1`, `us-central1`, PostgreSQL 17 Enterprise, regional HA, 2 vCPU, 7.5 GiB RAM, 20 GiB SSD, private connectivity; database `sandy_mail_canary`; private Standard bucket `elaborate-haven-511518-a5-sandy-mail-canary-us1` (name availability unverified). Enable versioning and public-access prevention, but no irreversible retention lock or lifecycle deletion. No customer residency is selected by this synthetic-only proposal.

Illustrative on-demand USD calculation from Google's published baseline rates, checked 24 October 2026: `(2 × $0.0826 + 7.5 × $0.014) × 730 = $197.25/month` HA compute; `20 × $0.34 = $6.80/month` HA SSD; approximately **$204.05/month or $6.71/day**, before backups/network/logs/tax. A 48-hour canary is approximately **$13.42**, plus a proposed $1 allowance for bounded ancillary usage. Request a **$20 ceiling for 48 hours**, then an approved stop that preserves data; retained SSD continues about $6.80/month plus backups until separately authorized disposal. No committed-use purchase. GCS workload is <1 MiB and <100 class-A / <1,000 class-B operations (published Standard single-region operations total under $0.001). Reprice against the exact regional SKU/instance shape before approval; this is an estimate, not a billing quote or a hard provider-enforced budget.

Sources: [Cloud SQL pricing](https://cloud.google.com/sql/pricing), [Google's HA rate example](https://docs.cloud.google.com/sql/docs/mysql/cud), [PostgreSQL HA cost boundary](https://docs.cloud.google.com/sql/docs/postgres/high-availability), [GCS pricing](https://cloud.google.com/storage/pricing). Shared existing capacity could avoid new fixed compute charges, but that has not been verified.

## Protected execution, verification and rollback

After resource/cost/access approval where required, integrate the immutable Mail artifact into the **existing** protected release path under its release owner, with target/base checks and source hash. Capture read-only pre-state; apply migrations with the authorized migrator; seed exactly the synthetic rows using that migrator; execute `mail-fixture ingest`, `read`, and same-ID retry under the runtime role. Independently query Cloud SQL message/receipt/outbox rows and fetch generation-pinned GCS objects to recompute hashes. Record provider operation IDs and actual instance/bucket identity. Do not promote deployed/accepted flags from local tests or configured strings.

Rollback: stop only the Mail canary consumer/invocation; preserve new database and fixture objects; retain migrations and receipts. No DROP, bucket removal, source-mail deletion, live DNS/MX switch, mailbox import, external send, or overwrite of shared deployments. If billing stop requires resource mutation, bind it to the approved fallback instance only. Regional recovery, SMTP durability, scanning and full service acceptance remain separate gates.

## Concrete dependency request to the existing API / hosting owners

No generic approval removal is needed. Supply read receipts and a verified existing execution target first; additional access/resources below require their own exact approved diff only if missing. The alternative connected-tool search also exposed no applicable Cloud SQL/GCS action; no connector connection/install flow was started.

| Owner action | Exact operation / target | Required existing permission |
|---|---|---|
| Inventory SQL | `GET https://sqladmin.googleapis.com/sql/v1beta4/projects/elaborate-haven-511518-a5/instances`, then `/instances/INSTANCE` | `cloudsql.instances.list`, `cloudsql.instances.get` |
| Inventory database | Same base `/instances/INSTANCE/databases`, then `/databases/sandy_mail_canary` | `cloudsql.databases.list`, `cloudsql.databases.get` |
| Inventory storage | `GET https://storage.googleapis.com/storage/v1/b?project=elaborate-haven-511518-a5`, then `/b/BUCKET` | `storage.buckets.list`, `storage.buckets.get` |
| Reconcile existing access | Resource owner supplies effective workload grant/SQL role evidence; bucket policy via `/b/BUCKET/iam` if authorized | `storage.buckets.getIamPolicy` for that read; do not grant it to the ingestion worker |
| Existing Auth Proxy workload | Exact approved instance connection; approved private network/socket and existing IAM database user | `cloudsql.instances.get`, `cloudsql.instances.connect`; `cloudsql.instances.login` for IAM DB authentication, plus SQL grants below |
| Immutable fixture write/read | `POST https://storage.googleapis.com/upload/storage/v1/b/BUCKET/o?uploadType=media&name=ENCODED_KEY&ifGenerationMatch=0`; metadata and `alt=media` GET pinned to returned generation | Only `storage.objects.create` and `storage.objects.get` on the exact fixture object prefix |

Fixture prefix: `mail/v1/23900000-0000-4000-8000-000000000001/23900000-0000-4000-8000-000000000002/23900000-0000-4000-8000-000000000003/`. The application does not need object list/delete/update or bucket administration. A broad predefined object-viewer role includes additional listing access; prefer an already approved bounded grant or have the resource owner propose the exact conditional/custom-role diff. Do not create that grant here. Scope Cloud SQL bindings to the selected target through the owner's supported IAM conditions; project-wide Client grants must not be assumed instance-restricted.

SQL runtime: CONNECT to `sandy_mail_canary`, USAGE core; SELECT core facts; INSERT intake_objects, recipients, ingestions, messages, envelopes, bodies, mime_objects, attachments, memberships, inbound_receipts, outbox; UPDATE only ingestions(attempts,last_error,updated_at,state). Runtime must not own tables or inherit their owner, SUPERUSER or BYPASSRLS. Existing migrator owns only Mail migration/schema/seed execution. Separate role provisioning is not performed by the migration runner.

[Google Cloud SQL IAM login requirements](https://docs.cloud.google.com/sql/docs/postgres/iam-logins), [Cloud SQL role permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/cloudsql), and [GCS permission definitions](https://docs.cloud.google.com/storage/docs/access-control/iam-permissions) support this permission mapping. These are proposed requirements, not evidence that a grant exists.

Release payload: [runner and exact manifest contract](../../services/sandy-mail/release/README.md). It can be invoked by the existing protected owner after admission; default is validation only. No duplicate shared release workflow exists. If existing capacity is unavailable, the fallback resource/cost request above remains **unapproved**: proposed instance/bucket/identity, $20/48-hour ceiling, data-preserving stop. No real test recipient, provider mailbox or DNS route is necessary for this synthetic direct ingest.

## Import follow-on does not widen the first-email request

Keep the first deployed-email target mapping and protected execution focused on preserved artifact/source `a135eb69bdcf16d66b9e7e3edf27f9e85c868a33` (migrations 0001–0003). Later source adds migration 0004 and internal offline import workers. Its [separate optional SQL column-grant diff](../../services/sandy-mail/IMPORTS.md#separate-optional-sql-grant-diff) is neither required for the first email nor applied live. Parent/API owner already has the first-email dependency request; no repeated approval or fallback provisioning is requested by this follow-on.

## Export follow-on also remains separate

Migration 0005 and the resumable export worker have a [separate optional SQL grant diff and mandatory authority contract](../../services/sandy-mail/EXPORTS.md#bounds-validation-and-separate-grants). Neither changes the first-email artifact, its fixture namespace, existing target request or required first-email permissions. Local export/restore evidence is not cloud deployment or permission evidence. Shared canonical identity/reauth/revocation, scanner policy and private encrypted customer delivery remain pending integration; this follow-on requests no new provisioned resource, access or approval.
