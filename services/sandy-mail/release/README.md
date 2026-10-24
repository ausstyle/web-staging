# Protected-owner canary invocation

This is a release **payload**, not another deployment service/job. Hosting/API's existing protected release owner performs admission, actor/target binding, artifact provenance verification and its existing release lock before invoking it. This script never approves itself, creates IAM/credentials, provisions resources, launches an Auth Proxy or changes DNS. Default execution only validates preconditions. JSON observations and receipt IDs are evidence inputs; the script does not cryptographically authenticate them. The canonical owner must fetch and validate them through the existing API.

Build `cmd/mail-fixture` from the approved immutable source commit, record SHA-256, and use the pinned nonroot `Dockerfile` or the standalone static binary. Container has no shell/server and requires no writable root filesystem for Cloud SQL/GCS. Python runner lives outside that image in the existing protected executor; it invokes the standalone binary. These are two packaging alternatives, not two deployments. No registry upload is included.

`manifest.json` must contain exactly:

```json
{
  "version": 1,
  "project": "elaborate-haven-511518-a5",
  "region": "us-central1",
  "instance": "sandy-mail-canary-us1",
  "connection_name": "elaborate-haven-511518-a5:us-central1:sandy-mail-canary-us1",
  "database": "sandy_mail_canary",
  "bucket": "elaborate-haven-511518-a5-sandy-mail-canary-us1",
  "source_commit": "REPLACE_WITH_APPROVED_40_HEX_COMMIT",
  "binary_sha256": "REPLACE_WITH_ACTUAL_64_HEX_HASH",
  "scope": {
    "Tenant": "23900000-0000-4000-8000-000000000001",
    "Account": "23900000-0000-4000-8000-000000000002",
    "Mailbox": "23900000-0000-4000-8000-000000000003"
  },
  "runtime_service_account": "sandy-mail-canary@elaborate-haven-511518-a5.iam.gserviceaccount.com"
}
```

The names above are a **conditional proposal**, not observed resources. Replace with reconciled, approved existing targets where available. `observations.json` binds `observed_at` (UTC, maximum 15 minutes old), provider `instance`, `database`, `bucket` JSON metadata, `runtime_service_account` and `canonical_read_receipt_ids`. Preserve provider fields: instance project/name/region/connectionName/state/databaseVersion/settings.availabilityType; database project/instance/name; bucket name/location/iamConfiguration/versioning. Tests use explicitly mocked observations, not provider evidence.

Validation:

```sh
python3 release/run_canary.py --manifest manifest.json \
  --observations observations.json --binary /approved/artifacts/mail-fixture \
  --output canary-preconditions.json
```

Only after the existing release owner's genuine admission, supply existing scoped `MAIL_MIGRATOR_DSN`, `MAIL_RUNTIME_DSN` and ADC via its established workload mechanisms and add `--execute`. Never include DSNs in JSON/argv. The script passes only the selected DSN to each child, executes migrate → seed-synthetic → ingest → read → same-ID ingest → read, and writes bounded receipts after every stage. Any uncertain write stops without automatic retry. Reconcile the same fixture identity and existing receipt before rerunning. A receipt pinned to a different source commit intentionally fails the source check; do not delete/reset it to manufacture success.

`seed-synthetic` creates only the fixed three fixture rows. Existing conflicting region/provider/mailbox values fail transactionally. Application migrations/seed never create SQL roles or grants. The release owner needs separate existing migrator and non-owner/NOBYPASSRLS runtime privileges; see service README and deployment request.

After success, a separate provider read must confirm actual Cloud SQL instance identity, SQL message/receipt/outbox counts and generation-pinned GCS raw/ledger/attachment hashes. The runner leaves `independent_provider_acceptance=false`. Stop only the invocation to roll back; preserve data and migration history.

Tests: `python3 -m unittest discover -s release -v`. No provider resources or real credentials are used in these tests.
