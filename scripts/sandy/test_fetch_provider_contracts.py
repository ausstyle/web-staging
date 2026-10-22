import hashlib
import json
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

    def supplemental_manifest(self):
        raw = b'syntax = "proto3";\npackage google.api.cloudquotas.v1;\nmessage QuotaInfo {}\n'
        source = {"format": "protobuf", "source": "https://raw.githubusercontent.com/googleapis/googleapis/" + "a" * 40 + "/google/api/cloudquotas/v1/resources.proto",
                  "cache_file": "gcp-cloudquotas-v1-resources.proto", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        return [{"provider": "gcp-cloudquotas", "state": "unavailable", "alternative_contract_sources": [source]}], raw

    def test_unavailable_discovery_restores_exact_supplemental_bytes_and_reuses_them(self):
        manifest, raw = self.supplemental_manifest()
        source = manifest[0]["alternative_contract_sources"][0]
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = restore(manifest, root, lambda url: calls.append(url) or raw)
            self.assertEqual(calls, [source["source"]])
            self.assertEqual((root / source["cache_file"]).read_bytes(), raw)
            self.assertEqual(json.loads((root / "manifest.json").read_text()), manifest)
            self.assertEqual(result["restored_supplemental"], [source["cache_file"]])
            self.assertEqual(result["unavailable"], ["gcp-cloudquotas"])
            self.assertFalse(result["complete"])
            restore(manifest, root, lambda url: self.fail("Unexpected network call"))

    def test_supplemental_checksum_and_byte_count_must_both_match(self):
        for corruption in ["checksum", "bytes"]:
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as directory:
                manifest, raw = self.supplemental_manifest()
                source = manifest[0]["alternative_contract_sources"][0]
                if corruption == "checksum":
                    raw = raw.replace(b'QuotaInfo', b'QuotaFake')
                else:
                    source["bytes"] += 1
                with self.assertRaisesRegex(ValueError, "mismatch"):
                    restore(manifest, Path(directory), lambda url: raw)
                self.assertFalse((Path(directory) / source["cache_file"]).exists())

    def test_supplemental_unsafe_paths_mutable_sources_and_missing_lengths_are_rejected(self):
        for change in [{"cache_file": "gcp-cloudquotas-../escape.proto"},
                       {"source": "https://raw.githubusercontent.com/googleapis/googleapis/main/resources.proto"},
                       {"bytes": None}]:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                manifest, _ = self.supplemental_manifest()
                manifest[0]["alternative_contract_sources"][0].update(change)
                with self.assertRaises(ValueError):
                    restore(manifest, Path(directory), lambda url: self.fail("Must reject before network"))

    def test_supplemental_tampered_cache_and_symlinks_are_never_replaced_by_a_fetch(self):
        for state in ["tampered", "symlink"]:
            with self.subTest(state=state), tempfile.TemporaryDirectory() as directory:
                manifest, raw = self.supplemental_manifest()
                root = Path(directory)
                target = root / manifest[0]["alternative_contract_sources"][0]["cache_file"]
                if state == "tampered":
                    target.write_bytes(raw + b'// altered\n')
                else:
                    (root / "other.proto").write_bytes(raw)
                    target.symlink_to(root / "other.proto")
                with self.assertRaises(ValueError):
                    restore(manifest, root, lambda url: self.fail("Must not replace an invalid cache"))


if __name__ == "__main__":
    unittest.main()
