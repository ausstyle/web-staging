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

    def test_flat_channels_preserve_their_existing_auth_settings(self):
        for slug in ['sandy-email-runtime-canary','sandy-voice-account-context']:
            m={**self.m,'function':slug,'version':s.FLAT_REVISIONS[slug][0],
               'verify_jwt':False,'source_layout':s.FLAT_INDEX_LAYOUT,
               'before_files':{'index.ts':'a'*64},
               'replacements':{p:'b'*64 for p in s.MODULES[slug]}}
            s.validate(m)
            self.assertNotIn('index.ts',s.installed_hashes(m))
            m['verify_jwt']=True
            with self.assertRaises(s.Blocked):s.validate(m)

    def test_subsequent_namespaced_release_preserves_all_other_modules_and_auth(self):
        slug='sandy-engineering-oidc-ingest'
        m={**self.m,'function':slug,'version':93,'verify_jwt':False,
           'before_files':{slug+'/index.ts':'a'*64,slug+'/examiner_scope.ts':'c'*64},
           'replacements':{slug+'/index.ts':'b'*64}}
        s.validate(m)
        self.assertEqual(s.installed_hashes(m)[slug+'/examiner_scope.ts'],'c'*64)
        m['verify_jwt']=True
        with self.assertRaises(s.Blocked):s.validate(m)


class GraphicalFlatReleaseTests(unittest.TestCase):
    def setUp(self):
        self.slug = 'sandy-master-computer'
        self.before = {'index.ts': b'preserved-flat-master-v27'}
        self.after = {p: (s.ROOT / 'supabase/functions' / p).read_bytes()
                      for p in s.MODULES[self.slug]}
        self.m = {'kind':'reviewed-runtime-slice-v1','function':self.slug,
                  'version':27,'verify_jwt':True,'body_sha256':s.digest(b'flatbundle'),
                  'source_layout':s.FLAT_INDEX_LAYOUT,
                  'before_files':s.hashes(self.before),'replacements':s.hashes(self.after)}
        self.meta = {'slug':self.slug,'version':27,'verify_jwt':True,'status':'ACTIVE'}

    def test_only_exact_reviewed_flat_master_layout_is_permitted(self):
        s.validate(self.m)
        cases = [
            {'source_layout':'arbitrary-layout'}, {'version':28}, {'verify_jwt':False},
            {'before_files':{**self.m['before_files'],'extra.ts':'a'*64}},
            {'before_files':{self.slug+'/index.ts':'a'*64}},
            {'replacements':{self.slug+'/index.ts':'a'*64}},
        ]
        for change in cases:
            with self.subTest(change=change), self.assertRaises(s.Blocked):
                s.validate({**self.m,**change})

    def test_packaging_transition_preserves_preimage_and_adds_only_reviewed_dependency(self):
        before = dict(self.before)
        candidate = s.candidate(self.m,before)
        self.assertEqual(before,self.before)
        self.assertEqual(candidate,self.after)
        self.assertNotIn('index.ts',candidate)
        self.assertEqual(s.hashes(candidate),s.installed_hashes(self.m))
        with self.assertRaises(s.Blocked):
            s.candidate(self.m,{'index.ts':b'unreviewed-live-change'})

    def test_independent_installed_readback_refuses_leftover_flat_source_or_missing_dependency(self):
        r=Fake({**self.meta,'version':28},b'candidatebundle')
        with patch.object(s,'original_sources',return_value=self.after):
            s.inspect(r,self.m,True)
        for files in [{**self.before,**self.after},
                      {self.slug+'/index.ts':self.after[self.slug+'/index.ts']}]:
            with patch.object(s,'original_sources',return_value=files), self.assertRaises(s.Blocked):
                s.inspect(r,self.m,True)

    def test_flat_source_preflight_is_read_only_and_preserves_jwt_configuration(self):
        r=Fake(self.meta,b'flatbundle')
        with patch.object(s,'original_sources',return_value=self.before):
            result=s.release(r,self.m)
        self.assertTrue(result['preflight_passed'])
        self.assertFalse(result['deployed'])
        self.assertTrue(all(method=='GET' for method,_ in r.calls))
        with patch.object(s,'original_sources',return_value=self.before), self.assertRaises(s.Blocked):
            s.inspect(Fake({**self.meta,'verify_jwt':False},b'flatbundle'),self.m)


class MissionTruthReleaseTests(unittest.TestCase):
    def test_mission_releases_cannot_replace_auth_entrypoint_or_provider_transport(self):
        for slug, worker in [('sandy-mission-executor', 'worker_mission.ts'), ('sandy-mission-runner', 'worker_mission_planning.ts')]:
            before = {slug+'/index.ts': b'private renewal authentication entrypoint',
                      '_shared/sandy-agent-operations/runtime_responses_transport.ts': b'actual deployed transport differs from main',
                      '_shared/sandy-agent-operations/'+worker: b'old worker'}
            replacements = {p:s.digest((s.ROOT/'supabase/functions'/p).read_bytes()) for p in s.MODULES[slug]}
            manifest = {'kind':'reviewed-runtime-slice-v1','function':slug,'version':21 if slug.endswith('executor') else 31,
                        'verify_jwt':False,'body_sha256':s.digest(b'original bundle'),
                        'before_files':s.hashes(before),'replacements':replacements}
            candidate = s.candidate(manifest, before)
            self.assertEqual(candidate[slug+'/index.ts'], before[slug+'/index.ts'])
            self.assertEqual(candidate['_shared/sandy-agent-operations/runtime_responses_transport.ts'], before['_shared/sandy-agent-operations/runtime_responses_transport.ts'])
            for module in [slug+'/index.ts', '_shared/sandy-agent-operations/runtime_responses_transport.ts']:
                with self.assertRaises(s.Blocked):
                    s.validate({**manifest,'replacements':{module:'a'*64}})
            with self.assertRaises(s.Blocked):
                s.candidate(manifest,{**before,'unreviewed-live-module.ts':b'new source'})


if __name__=='__main__': unittest.main()
