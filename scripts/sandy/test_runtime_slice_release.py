import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import release_runtime_slice as s


class Fake:
    def __init__(self, meta, body):
        self.meta, self.body = meta, body
        self.calls = []
        self.holder = 'test-holder'
        self.out = Path('/tmp/test-not-written')

    def api(self, method, path):
        self.calls.append((method, path))
        return json.dumps(self.meta).encode() if not path.endswith('/body') else self.body


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.module = 'sandy-vm-protocol-api/winrm.ts'
        self.files = {'sandy-vm-protocol-api/index.ts': b'entry', self.module: b'old'}
        self.m = {'kind':'reviewed-runtime-slice-v1','function':'sandy-vm-protocol-api',
                  'version':2,'verify_jwt':True,'body_sha256':s.digest(b'bundle'),
                  'before_files':s.hashes(self.files),'replacements':{self.module:s.digest(b'new')}}
        self.meta = {'slug':self.m['function'],'version':2,'verify_jwt':True,'status':'ACTIVE'}

    def test_manifest_cannot_select_other_function_or_security_module(self):
        for field, value in [('function','sandy-engineering-control'), ('replacements',{'sandy-vm-protocol-api/auth.ts':'a'*64}), ('before_files',{'../escape.ts':'a'*64})]:
            m = copy.deepcopy(self.m); m[field] = value
            with self.assertRaises(s.Blocked): s.validate(m)

    def test_auth_configuration_and_every_original_module_are_checked(self):
        for change in [{'verify_jwt':False},{'version':3},{'import_map':True}]:
            r = Fake({**self.meta, **change}, b'bundle')
            with patch.object(s, 'original_sources', return_value=self.files):
                with self.assertRaises(s.Blocked): s.inspect(r,self.m)
            self.assertTrue(all(method=='GET' for method,_ in r.calls))
        with patch.object(s,'original_sources',return_value={**self.files,'unreviewed.ts':b'new'}):
            with self.assertRaises(s.Blocked): s.inspect(Fake(self.meta,b'bundle'),self.m)

    def test_installed_readback_checks_complete_candidate_not_only_changed_file(self):
        expected = {**self.files,self.module:b'new'}
        with patch.object(s,'original_sources',return_value=expected):
            s.inspect(Fake({**self.meta,'version':3},b'newbundle'),self.m,True)
        with patch.object(s,'original_sources',return_value={**expected,'sandy-vm-protocol-api/index.ts':b'changed'}):
            with self.assertRaises(s.Blocked): s.inspect(Fake({**self.meta,'version':3},b'newbundle'),self.m,True)

    def test_unknown_provider_result_is_not_retried_and_retains_lease(self):
        r = Fake(self.meta,b'bundle'); sql=[]
        def query(q, read_only=False):
            sql.append(q)
            return [{'held':1}]
        r.sql=query
        uploads=[]
        def upload(*args):
            uploads.append(args)
            raise s.Blocked('unknown_provider_result')
        r.upload=upload
        manifest = Path('/tmp/m.json')
        with patch.object(s,'inspect',return_value=(self.meta,b'bundle',self.files)), \
             patch.object(s,'candidate',return_value={**self.files,self.module:b'new'}), \
             patch.object(s,'source_check',return_value='a'*40), \
             patch.object(s,'track',return_value='00000000-0000-0000-0000-000000000001'), \
             patch.object(s,'private_write'), patch.object(Path,'mkdir'):
            with self.assertRaises(s.Blocked): s.release(r,self.m,True,manifest)
        self.assertEqual(len(uploads),1)
        self.assertTrue(any('runtime_slice_outcome_unknown' in q for q in sql))
        self.assertFalse(any('DELETE FROM public.sandy_engineering_component_leases' in q for q in sql))

    def test_main_manifest_and_harness_are_immutable(self):
        with patch.dict(s.os.environ,{'GITHUB_ACTIONS':'true','GITHUB_REF':'refs/heads/main','GITHUB_SHA':'a'*40}):
            with self.assertRaises(s.Blocked): s.source_check(self.m,Path('/tmp/unreviewed.json'))


if __name__=='__main__': unittest.main()
