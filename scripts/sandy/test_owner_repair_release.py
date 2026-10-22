"""Release regression: occupied customer migration versions are never reused."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import release_owner_session_repair as release


class Transport:
    holder = 'fixture-holder'
    def __init__(self, evidence):
        self.evidence = evidence
        self.queries = []
        self.uploaded = False
    def admission(self, lease=False):
        pass
    def api(self, method, path):
        if path.endswith('/body'):
            return b'after' if self.uploaded else b'before'
        return json.dumps({'version': 52 if self.uploaded else 51, 'status': 'ACTIVE', 'verify_jwt': False}).encode()
    def sql(self, query):
        self.queries.append(query)
        if 'AS installed' in query: return [{'installed': 0}]
        if "SELECT version FROM" in query: return []
        if 'select count(*)::integer n from pg_proc' in query: return [{'n': 3}]
        return []


class Tests(unittest.TestCase):
    def manifest(self):
        return {'function': {'slug': 'sandy-engineering-control', 'expected_prior_version': 51,
                             'prior_bundle_sha256': release.digest(b'before')}}

    def test_relocated_history_preserves_exact_sql_and_protected_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            transport = Transport(Path(temp)); files = {'index.ts': b'approved source'}
            migration = b"BEGIN;\nSELECT 'immutable approved SQL';\nCOMMIT;"
            def upload(*args):
                transport.uploaded = True
                return b'{}'
            with patch.dict('os.environ', {'GITHUB_ACTIONS': 'true'}), patch.object(release, 'upload', side_effect=upload), patch.object(release, 'original_sources', return_value=files):
                result = release.run(transport, self.manifest(), files, migration, True)
            transaction = next(q for q in transport.queries if q.startswith('BEGIN; SELECT pg_advisory'))
            self.assertIn("VALUES('20261022110000',ARRAY[", transaction)
            self.assertNotIn("VALUES('20261022010000',ARRAY[", transaction)
            self.assertIn("SELECT 'immutable approved SQL';", transaction)
            self.assertEqual(result['migration_sha256'], release.digest(migration))
            self.assertEqual(result['source_commit'], release.SOURCE)
            self.assertEqual(result['manifest_sha256'], release.PIN)
            self.assertFalse(result['approval_status_written'])

    def test_local_release_cannot_spoof_the_protected_path_by_default(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict('os.environ', {'GITHUB_ACTIONS': 'false'}):
            transport = Transport(Path(temp))
            with self.assertRaisesRegex(release.Blocked, 'existing_protected_github_release_required'):
                release.run(transport, self.manifest(), {}, b'BEGIN; COMMIT;', True)
            self.assertFalse(transport.uploaded)
            self.assertTrue(all(q.lower().startswith('select') for q in transport.queries))

    def test_an_occupied_relocated_version_blocks_before_any_schema_or_source_write(self):
        with tempfile.TemporaryDirectory() as temp:
            transport = Transport(Path(temp)); original = transport.sql
            transport.sql = lambda query: [{'version': release.HISTORY_VERSION}] if 'SELECT version FROM' in query else original(query)
            with self.assertRaisesRegex(release.Blocked, 'relocated_migration_version_already_present'):
                release.run(transport, self.manifest(), {}, b'BEGIN; COMMIT;', False)
            self.assertFalse(transport.uploaded)
