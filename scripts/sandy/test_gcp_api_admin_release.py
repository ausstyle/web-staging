import unittest, tempfile, os, json
from pathlib import Path
from unittest.mock import patch as mock
import release_gcp_admin_read as r

class SourcePreservation(unittest.TestCase):
    def test_control_preserves_every_unrelated_byte_and_module(self):
        entry=b'// prior\n  if(action==="preflight"){\n// preserved\n';files={r.CONTROL+'/index.ts':entry,'shared.json':b'{}'}
        out=r.patch(r.CONTROL,files,b'new-reviewed-helper')
        self.assertEqual(out['shared.json'],files['shared.json']);self.assertEqual(files[r.CONTROL+'/index.ts'],entry)
        self.assertTrue(out[r.CONTROL+'/index.ts'].endswith(b'  if(action==="preflight"){\n// preserved\n'))
        self.assertEqual(out[r.HELPER],b'new-reviewed-helper')
        self.assertIn(b'handleGcpAdminRead(db,user,admin,token',out[r.CONTROL+'/index.ts'])
    def test_gateway_preserves_other_routes_and_normal_owner_auth(self):
        entry=('prior;'+r.OLD_GATEWAY+r.OLD_BODY+';after').encode()
        out=r.patch(r.GATEWAY,{r.GATEWAY+'/index.ts':entry,'unrelated.ts':b'unchanged'},b'helper')
        self.assertEqual(out['unrelated.ts'],b'unchanged')
        self.assertEqual(out[r.GATEWAY+'/index.ts'],('prior;'+r.NEW_GATEWAY+r.NEW_BODY+';after').encode())
        self.assertIn('admin?.role!=="owner"',r.NEW_GATEWAY)
    def test_ambiguous_modified_or_already_installed_source_fails_closed(self):
        for entry in [b'changed', (r.OLD_GATEWAY*2+r.OLD_BODY).encode()]:
            with self.assertRaises(r.Blocked):r.patch(r.GATEWAY,{r.GATEWAY+'/index.ts':entry},b'helper')
        with self.assertRaises(r.Blocked):r.patch(r.CONTROL,{r.CONTROL+'/index.ts':b'',r.HELPER:b'existing'},b'new')
        with self.assertRaises(r.Blocked):r.patch('another-function',{'another-function/index.ts':b''},b'')
    def test_manifest_is_bounded_and_reviewed_modules_are_immutable(self):
        m,h,sql,contract=r.load()
        self.assertEqual(set(m['functions']),{r.GATEWAY,r.CONTROL})
        self.assertEqual(m['functions'][r.GATEWAY]['version'],57)
        self.assertTrue(m['functions'][r.GATEWAY]['verify_jwt'])
        self.assertFalse(m['functions'][r.CONTROL]['verify_jwt'])
        self.assertIn(b'confirmed_current_owner_required',sql)
        self.assertNotIn(b'verified=',contract)
    def test_source_change_is_detected_before_any_write(self):
        class Changed:
            def read(self,*args):raise r.Blocked('live_source_or_version_changed')
            def sql(self,*args):raise AssertionError('write attempted')
        m,h,sql,contract=r.load()
        with self.assertRaisesRegex(r.Blocked,'live_source'):r.run(Changed(),m,h,sql,contract,True)
    def test_local_execution_cannot_deploy_or_write_tracking_records(self):
        class Fake:pass
        m,h,sql,contract=r.load()
        with mock.object(r,'inspect',return_value=({},{})),mock.dict(os.environ,{'GITHUB_ACTIONS':'false'}):
            with self.assertRaisesRegex(r.Blocked,'protected_main'):r.run(Fake(),m,h,sql,contract,True)
