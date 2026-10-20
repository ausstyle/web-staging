import hashlib
from pathlib import Path
import tempfile
import unittest
from fetch_provider_contracts import restore


class FetchProviderContractsTests(unittest.TestCase):
    def manifest(self, source=None):
        return [{"provider": "github", "state": "downloaded", "sha256": hashlib.sha256(b'{}').hexdigest(),
                 "source": source or "https://raw.githubusercontent.com/github/rest-api-description/" + "a" * 40 + "/schema.json"}]

    def test_verified_cache_is_reused_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "github.json").write_bytes(b'{}')
            result = restore(self.manifest(), root, lambda url: self.fail("Unexpected network call"))
            self.assertTrue(result["complete"])

    def test_checksum_failure_never_persists_downloaded_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                restore(self.manifest(), root, lambda url: b'{"tampered":true}')
            self.assertFalse((root / "github.json").exists())

    def test_mutable_or_untrusted_urls_are_rejected(self):
        for url in ["https://raw.githubusercontent.com/github/repo/main/schema.json", "https://untrusted.invalid/schema.json"]:
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
                restore(self.manifest(url), Path(directory), lambda url: self.fail("Must reject before network"))

    def test_unavailable_source_is_explicit_and_blocks_completeness(self):
        with tempfile.TemporaryDirectory() as directory:
            result = restore([{"provider": "gcp-cloudquotas", "state": "unavailable"}], Path(directory))
            self.assertFalse(result["complete"])
            self.assertEqual(result["unavailable"], ["gcp-cloudquotas"])


if __name__ == "__main__":
    unittest.main()
