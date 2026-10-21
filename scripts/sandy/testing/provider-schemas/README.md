# Reviewed provider schema fixtures

These gzip files preserve exact public, official commit-pinned schema bytes
listed in `docs/sandy-api/provider-schema-manifest.json`, including the two
reviewed supplemental Cloud Quotas protobuf documents. Original copyright and
licence notices remain in the decompressed documents. Sources and SHA-256 hashes
are recorded in that manifest. Compression has a fixed zero timestamp.

`provider_schema_fixtures.restore_fixtures` restores them into a temporary test
directory through the existing official-source/checksum validation policy.
Tests require no network, credentials or pre-existing Codex cache. Missing,
changed, oversized or symlinked fixtures fail closed. A schema update requires
reviewing the pinned source, manifest, generated contracts and tests together.
Schema validity and reproducible compilation do not prove provider execution.
