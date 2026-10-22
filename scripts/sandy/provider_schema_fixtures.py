"""Restore reviewed public schemas offline using the production checksum policy.

Fixtures preserve exact official commit-pinned bytes, compressed only for Git.
No provider credentials, network access or catalogue writes are involved.
"""
import gzip
import json
from pathlib import Path
from fetch_provider_contracts import restore

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "scripts/sandy/testing/provider-schemas"
MANIFEST = ROOT / "docs/sandy-api/provider-schema-manifest.json"
MAX_BYTES = 40 * 1024 * 1024


def restore_fixtures(output, manifest_path=MANIFEST, fixture_dir=FIXTURES):
    manifest = json.loads(Path(manifest_path).read_text())
    sources = {}
    for row in manifest:
        if row.get("state") == "downloaded":
            sources[row["source"]] = row["provider"] + ".json"
        for source in row.get("alternative_contract_sources", []):
            sources[source["source"]] = source["cache_file"]

    def offline_bytes(url):
        filename = sources[url]
        # restore() validates official URL, filename and checksum before use.
        path = Path(fixture_dir) / (filename + ".gz")
        if path.is_symlink() or not path.is_file():
            raise ValueError("reviewed_provider_fixture_missing_or_symlink")
        with gzip.open(path, "rb") as stream:
            raw = stream.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("reviewed_provider_fixture_size_limit")
        return raw

    return restore(manifest, Path(output), offline_bytes)
