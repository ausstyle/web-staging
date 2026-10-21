import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from provider_schema_fixtures import restore_fixtures


class ProviderSchemaFixtures(unittest.TestCase):
    def fixture(self, root):
        source = root / "source"
        source.mkdir()
        raw = b'{"openapi":"3.0.0","paths":{}}'
        manifest = root / "manifest.json"
        manifest.write_text(json.dumps([{"provider": "github", "state": "downloaded",
            "source": "https://raw.githubusercontent.com/github/rest-api-description/" + "a" * 40 + "/api.json",
            "sha256": hashlib.sha256(raw).hexdigest()}]))
        (source / "github.json.gz").write_bytes(gzip.compress(raw, mtime=0))
        return manifest, source, raw

    def test_offline_restore_preserves_bytes_and_never_uses_network(self):
        with tempfile.TemporaryDirectory() as directory, patch("urllib.request.urlopen", side_effect=AssertionError("network_forbidden")):
            root = Path(directory)
            manifest, source, raw = self.fixture(root)
            self.assertTrue(restore_fixtures(root / "out", manifest, source)["complete"])
            self.assertEqual((root / "out/github.json").read_bytes(), raw)

    def test_corrupt_reviewed_schema_fails_without_persisting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, source, _ = self.fixture(root)
            (source / "github.json.gz").write_bytes(gzip.compress(b'{}', mtime=0))
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                restore_fixtures(root / "out", manifest, source)
            self.assertFalse((root / "out/github.json").exists())

    def test_missing_or_symlink_fixture_fails_closed(self):
        for symlink in (False, True):
            with self.subTest(symlink=symlink), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                manifest, source, _ = self.fixture(root)
                fixture = source / "github.json.gz"
                fixture.unlink()
                if symlink:
                    fixture.symlink_to(manifest)
                with self.assertRaisesRegex(ValueError, "missing_or_symlink"):
                    restore_fixtures(root / "out", manifest, source)

    def test_decompression_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest, source, _ = self.fixture(root)
            with patch("provider_schema_fixtures.MAX_BYTES", 2), self.assertRaisesRegex(ValueError, "size_limit"):
                restore_fixtures(root / "out", manifest, source)
