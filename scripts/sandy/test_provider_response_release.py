import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import release_provider_response_fix as release
from release_web_canary import Blocked

CHANGE = '11111111-1111-4111-8111-111111111111'


class ProviderRepairReleaseTests(unittest.TestCase):
    def manifest(self):
        return {'kind': 'owner-approved-provider-response-fix-v1', 'function': release.TARGET,
                'project_ref': 'zmqlyygzqoidkcwdysok', 'source_commit': release.SOURCE,
                'expected_prior_version': 30, 'verify_jwt': False,
                'prior_bundle_sha256': release.PRIOR_BUNDLE_SHA,
                'before_files': {release.ENTRY: release.sha(b'old'), '_shared/keep.ts': release.sha(b'keep')},
                'after_files': {release.ENTRY: release.ENTRY_SHA, '_shared/keep.ts': release.sha(b'keep')},
                'rollback': 'Restore the original captured private bundle and preserve JWT configuration.'}

    def test_only_exact_entry_change_is_allowed(self):
        original = self.manifest()
        self.assertEqual(len(release.validate_manifest(original)), 64)
        for edit in ['target', 'source', 'extra', 'other_module', 'digest', 'path']:
            m = copy.deepcopy(original)
            if edit == 'target': m['function'] = 'sandy-operation-api'
            if edit == 'source': m['source_commit'] = '0' * 40
            if edit == 'extra': m['after_files']['new.ts'] = '0' * 64
            if edit == 'other_module': m['after_files']['_shared/keep.ts'] = '0' * 64
            if edit == 'digest': m['prior_bundle_sha256'] = "'; select 1; --"
            if edit == 'path':
                m['before_files']['../escape'] = '0' * 64
                m['after_files']['../escape'] = '0' * 64
            with self.subTest(edit=edit), self.assertRaises(Blocked):
                release.validate_manifest(m)

    def test_preparation_preserves_all_other_bytes_and_auth(self):
        meta = {'slug': release.TARGET, 'status': 'ACTIVE', 'version': 30, 'verify_jwt': False}
        files = {release.ENTRY: b'old', '_shared/keep.ts': b'keep'}
        with patch.object(release, 'original_sources', return_value=files), patch.object(release, 'ENTRY_SHA', release.sha(b'new')), \
             patch.object(release, 'PRIOR_BUNDLE_SHA', release.sha(b'before')):
            m = release.prepare(meta, b'before', b'new')
            self.assertFalse(m['verify_jwt'])
            self.assertEqual(m['before_files']['_shared/keep.ts'], m['after_files']['_shared/keep.ts'])
            self.assertEqual(files[release.ENTRY], b'old')
            release.validate_manifest(m)

    def test_exact_source_independent_CI_is_required(self):
        rows = [{'id': i, 'name': n, 'head_sha': release.SOURCE, 'status': 'completed', 'conclusion': 'success'}
                for i, n in enumerate(sorted(release.CHECKS))]
        release.verify_ci(rows)
        for altered in [rows[:-1], [{**r, 'head_sha': '0' * 40} for r in rows],
                        rows + [{**rows[0], 'id': 100, 'conclusion': 'failure'}]]:
            with self.assertRaises(Blocked): release.verify_ci(altered)

    def test_owner_admission_is_read_only_and_checks_genuine_scoped_audit(self):
        class DB:
            def sql(self, query, read_only=False):
                self.query, self.read_only = query, read_only
                return [{'admitted': False}]
        db = DB()
        with self.assertRaisesRegex(Blocked, 'genuine_Owner_approval'):
            release.owner_admission(db, CHANGE, 'a' * 64)
        self.assertTrue(db.read_only)
        for required in ["a.role='owner'", "c.scope ? 'sandy-provider-operation-api'",
                         "sandy_engineering_test", "e.event_type='status_changed'", 'e.detail']:
            self.assertIn(required, db.query)
        self.assertNotIn('UPDATE', db.query)
        with self.assertRaises(ValueError): release.owner_admission(db, "';update", 'a' * 64)

    def fake(self, out, repeated=False, unknown=False):
        class DB:
            holder = 'test-holder'
            def __init__(self): self.out, self.uploads, self.writes = Path(out), [], []
            def sql(self, query, read_only=False):
                if not read_only: self.writes.append(query)
                if 'AS admitted' in query: return [{'admitted': True}]
                if 'count(*)::integer n' in query: return [{'n': int(repeated)}]
                if 'RETURNING id' in query: return [{'id': CHANGE}]
                if 'count(*)::integer held' in query: return [{'held': 1}]
                return []
            def upload(self, target, files, verify):
                self.uploads.append((target, files, verify))
                if unknown: raise Blocked('management_request_failed_or_unknown_outcome_no_retry')
                return b'{}'
            def api(self, method, path):
                if path.endswith('/body'): return b'after'
                return json.dumps({'version':31,'status':'ACTIVE','verify_jwt':False}).encode()
        return DB()

    def test_prior_dispatch_does_not_upload_or_rewrite_approval(self):
        with tempfile.TemporaryDirectory() as out:
            db = self.fake(out, repeated=True)
            with patch.object(release, 'github_ci'), patch.object(release, 'inspect', return_value=({}, b'before', {})):
                with self.assertRaisesRegex(Blocked, 'read_only_reconciliation'):
                    release.release(db, self.manifest(), CHANGE)
            self.assertEqual(db.uploads, [])
            self.assertFalse(any('approval' in q.lower() or 'control_grants' in q for q in db.writes))

    def test_unapproved_change_stops_before_lease_or_artifact_writes(self):
        with tempfile.TemporaryDirectory() as out:
            db = self.fake(out)
            original = db.sql
            db.sql = lambda q, read_only=False: [{'admitted': False}] if 'AS admitted' in q else original(q, read_only)
            with patch.object(release, 'github_ci'):
                with self.assertRaisesRegex(Blocked, 'genuine_Owner_approval'):
                    release.release(db, self.manifest(), CHANGE)
            self.assertEqual(db.uploads, [])
            self.assertEqual(db.writes, [])

    def test_upload_has_private_rollback_and_durable_intent_and_never_retries(self):
        for unknown in [False, True]:
            with self.subTest(unknown=unknown), tempfile.TemporaryDirectory() as out:
                db = self.fake(out, unknown=unknown)
                before = {release.ENTRY:b'old', '_shared/keep.ts':b'keep'}
                with patch.object(release, 'github_ci'), patch.object(release, 'pinned_entry', return_value=b'new'), \
                     patch.object(release, 'ENTRY_SHA', release.sha(b'new')), \
                     patch.object(release, 'inspect', return_value=({'version':30}, b'before', before)), \
                     patch.object(release, 'original_sources', return_value={**before, release.ENTRY:b'new'}):
                    m = self.manifest()
                    if unknown:
                        with self.assertRaisesRegex(Blocked, 'unknown_outcome'): release.release(db, m, CHANGE)
                    else:
                        result = release.release(db, m, CHANGE)
                        self.assertEqual(result['version'], 31)
                        self.assertFalse(result['functional_acceptance_passed'])
                        self.assertTrue(result['JWT_configuration_preserved'])
                self.assertEqual(len(db.uploads), 1)
                self.assertFalse(db.uploads[0][2])
                self.assertTrue(any('bundle_gzip_base64' in q for q in db.writes))
                self.assertTrue(any('provider_response_fix_upload_started' in q for q in db.writes))
                self.assertFalse(any('UPDATE public.sandy_engineering_changes' in q for q in db.writes))

    def test_source_or_jwt_drift_stops_before_upload(self):
        with tempfile.TemporaryDirectory() as out:
            db = self.fake(out)
            with patch.object(release, 'original_sources', return_value={}):
                with self.assertRaisesRegex(Blocked, 'no_upload'):
                    release.inspect(db, self.manifest())
            self.assertEqual(db.uploads, [])

    def test_rollback_uses_only_digest_verified_private_artifact(self):
        for corrupt in [False, True]:
            with self.subTest(corrupt=corrupt), tempfile.TemporaryDirectory() as out:
                db = self.fake(out)
                original_sql = db.sql
                before = {release.ENTRY:b'old', '_shared/keep.ts':b'keep'}
                with patch.object(release, 'PRIOR_BUNDLE_SHA', release.sha(b'before')):
                    m = self.manifest()
                    recovery = {'manifest_sha256':release.sha(release.canonical(m)),
                                'bundle_gzip_base64':release.base64.b64encode(release.gzip.compress(b'corrupt' if corrupt else b'before')).decode()}
                    db.sql = lambda q, read_only=False: [{'metadata':recovery}] if 'SELECT metadata' in q else original_sql(q, read_only)
                    db.api = lambda method,path: b'restored' if path.endswith('/body') else json.dumps({'version':32,'status':'ACTIVE','verify_jwt':False}).encode()
                    with patch.object(release, 'github_ci'), \
                         patch.object(release, 'inspect', return_value=({'version':31},b'after',{})), \
                         patch.object(release, 'original_sources', return_value=before):
                        if corrupt:
                            with self.assertRaisesRegex(Blocked, 'rollback_digest'):
                                release.release(db,m,CHANGE,CHANGE)
                            self.assertEqual(db.uploads, [])
                        else:
                            result = release.release(db,m,CHANGE,CHANGE)
                            self.assertTrue(result['rollback_exercised'])
                            self.assertEqual(result['version'],32)
                            self.assertEqual(db.uploads[0][1],before)


if __name__ == '__main__':
    unittest.main()
