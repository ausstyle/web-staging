# First-email canary handoff for the bounded Google trial

Parent assigned the forthcoming Google coding-agent trial ownership of live canary execution. No Google task, access, verified target or deployment currently exists. This handoff does not grant access, remove a protection or authorize a new paid resource. Mail's current branch continues local reader work only. Use a separate trial branch and one existing protected release owner/lock; do not create a competing deployment job.

## Immutable source and artifact

- Repository `ausstyle/web-staging`; authoritative scope PR239 head `b1d499f8dd946b6fda11e0cfcaa1f508ec435a08`, `docs/sandy-mail-architecture-engineering-scope-v1.md`.
- **Canary source: `a135eb69bdcf16d66b9e7e3edf27f9e85c868a33`.** It contains migrations 0001–0003, synthetic fixture, immutable object adapter, `cmd/mail-fixture`, nonroot Dockerfile and `release/run_canary.py`. Do not substitute the newer import/export/UI head or add their grants to this trial.
- Preserved static binary SHA-256: `a796e5406ab16a26f9226b43fad6f4a4784aa6a284a0b28ad854cb37bea57700`. [Build/source evidence](evidence/canary-package-local.json). A rebuilt artifact requires its own real build provenance/hash; never copy this hash onto different bytes.
- Local first receipt `54f8b468-6662-4466-a534-dd921d72ec99` is local evidence only. Cloud receipt/operation IDs must come from the actual cloud execution.

## Reproduce and invoke

Check out the pinned source in an isolated checkout. In `services/sandy-mail`, run `go test -race -count=1 ./...` using `MAIL_TEST_ADMIN_DSN` for a disposable loopback PostgreSQL 17 database named `sandy_mail_test`; run `go vet ./...` and `python3 -m unittest discover -s release -v`. Build the standalone `cmd/mail-fixture` or pinned nonroot Dockerfile, record immutable provenance and actual digest. Local tests must not use a production connection.

The [release contract](../../services/sandy-mail/release/README.md) gives exact manifest and observation schemas. Bind actual project/region/instance/connection/database/bucket/workload identity, approved source and binary digest; obtain fresh canonical provider inventory receipts (maximum 15 minutes old). Validate first:

```sh
python3 release/run_canary.py --manifest manifest.json \
  --observations observations.json --binary /approved/artifacts/mail-fixture \
  --output canary-preconditions.json
```

Only through the existing admitted release execution, provide `MAIL_MIGRATOR_DSN`, `MAIL_RUNTIME_DSN` and ADC via established workload mechanisms, then add `--execute`. Never place credentials in arguments, manifests, repository, logs or this handoff. The runner performs migrate → fixed seed → ingest → read → identical retry → read. It never provisions targets/roles/identities or starts a proxy.

## Exact missing dependencies

Project: `elaborate-haven-511518-a5`. **Instance, region, connection name, existing database, bucket and workload identity are not yet verified.** Prefer owner-approved shared capacity; `sandy_mail_canary` is the proposed dedicated database name, not an observed database. [Deployment request](deployment-request.md) contains inventory URLs, conditional resource/cost proposal and exact scoped SQL grant table; that fallback remains unapproved.

- Authorized inventory: SQL instances/databases list/get; bucket list/get and effective existing access evidence from the resource owner. Do not grant inventory permissions to the ingestion worker merely to discover targets.
- Existing migrator: only dedicated Mail schema/migrations and the three fixed synthetic rows. Existing runtime: non-owner, NOSUPERUSER, NOBYPASSRLS, CONNECT/USAGE and bounded SELECT/INSERT plus ingestion recovery-column UPDATE as documented; no import/export grants.
- Existing connection: verified private network/socket or approved Auth Proxy; `cloudsql.instances.get`, `cloudsql.instances.connect`, and `cloudsql.instances.login` if IAM DB authentication is used, bound to the selected target by the owner.
- GCS: only `storage.objects.create` and `storage.objects.get` in `mail/v1/23900000-0000-4000-8000-000000000001/23900000-0000-4000-8000-000000000002/23900000-0000-4000-8000-000000000003/`; create with generation precondition 0, read exact returned generations. No object listing/deletion/update, bucket administration or shared-service impersonation needed.
- Existing protected executor/release identity, target mapping, owner lock and genuine admission. Any missing credential, persistent access, IAM expansion or paid resource still needs its exact separately authorized action. No live recipient, MX/DNS change or provider mailbox is needed.

## Success and rollback

The synthetic RFC822 raw original must be **1,101 bytes**, SHA-256 `c93407efbafd6a3193d6331b8358ff71d8ae0e0dde72f238d1717b562b921244`; attachment **33 bytes**, SHA-256 `78c696a93e4fcb4a88f4e9581262e928ab70aefc303d38983b6c51d6fc02bbff`. Verify parsed subject/text/HTML, addresses, retained raw MIME and attachment, scoped non-owner isolation, stable receipt under identical replay, one message/receipt/outbox effect and recoverable intake. Keep quarantine pending genuine scanner integration.

Retain actual Cloud SQL instance/database identity, SQL counts/receipt IDs, GCS bucket/key/generations/hash readbacks, source/artifact digest and provider operation IDs. A separate provider readback must verify outcomes; the runner alone leaves `independent_provider_acceptance=false`. Do not relabel local 1,000-message tests as cloud acceptance.

On error/uncertain write, stop and reconcile the same delivery identity and durable receipt before retry; never clear rows to manufacture success. Rollback stops only the canary invocation/consumer and retains SQL, objects, migrations and receipts. No DROP, object deletion, mail import, external send, shared deployment overwrite or DNS/MX switch. No cloud write has been attempted by this Mail branch; current status is **pending target/access mapping**, not a denied operation, queued job or uncertain provider outcome.
