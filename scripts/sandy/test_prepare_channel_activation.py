import unittest
from unittest.mock import patch
from prepare_channel_activation import TARGETS, Blocked, check_before, committed_sources


class ChannelActivationTests(unittest.TestCase):
    def test_other_services_and_mutable_refs_cannot_select_source(self):
        for commit, slug in [('main', 'sandy-email-runtime-canary'), ('a' * 40, 'sandy-engineering-control')]:
            with self.assertRaises(Blocked):
                committed_sources(commit, slug)

    def test_newer_deployment_or_additional_live_modules_cannot_be_overwritten(self):
        for slug, expected in TARGETS.items():
            valid = {'version': expected['version'], 'status': 'ACTIVE', 'verify_jwt': False}
            with patch('prepare_channel_activation.digest', return_value=expected['before_source_sha256']):
                check_before(slug, valid, {'index.ts': b'exact-live-fixture'})
                for meta in [{**valid, 'version': expected['version'] + 1}, {**valid, 'verify_jwt': True}]:
                    with self.assertRaises(Blocked):
                        check_before(slug, meta, {'index.ts': b'exact-live-fixture'})
                with self.assertRaises(Blocked):
                    check_before(slug, valid, {'index.ts': b'exact-live-fixture', 'new_module.ts': b'do-not-overwrite'})

    def test_changed_original_source_is_not_a_safe_preimage(self):
        slug = 'sandy-email-runtime-canary'
        with self.assertRaises(Blocked):
            check_before(slug, {'version': 18, 'status': 'ACTIVE', 'verify_jwt': False}, {'index.ts': b'changed'})


if __name__ == '__main__':
    unittest.main()
