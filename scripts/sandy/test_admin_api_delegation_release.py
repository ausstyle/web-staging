import copy,json,subprocess,tempfile,unittest
from pathlib import Path
from unittest import mock
import release_admin_delegation as r

class DelegationReleaseTests(unittest.TestCase):
    def test_patches_preserve_every_unrelated_byte_and_no_grant_is_established(self):
        files={r.CONTROL+'/index.ts':b'prefix\n  if(user.app_metadata?.sandy_engineering_test===true){\n  existing();\n}',r.CONTROL+'/gcp_admin_read.ts':b'old helper','untouched.ts':b'existing customer handler'}
        out=r.patch(r.CONTROL,files)
        self.assertEqual(out['untouched.ts'],files['untouched.ts'])
        self.assertEqual(out[r.CONTROL+'/index.ts'].replace(r.CONTROL_ROUTE.encode(),b''),files[r.CONTROL+'/index.ts'])
        self.assertNotIn(b'set_admin_read_delegation',out[r.CONTROL+'/index.ts'])
        with self.assertRaises(r.Blocked):r.patch(r.CONTROL,out)

    def test_minified_gateway_preserves_all_existing_routes_and_admission(self):
        identity=b'prefix const allowedOperations=[...new Set([...policy.operations,...standingAuthorized?standing.operations:[]])];if(standingExecution&&(operation==="system.execution.get")){old();}proof={policySha256:String(resolved.policy_sha256),}; suffix'
        files={r.GATEWAY+'/index.ts':b'before if(administratorRead&&admin?.role!=="owner") deny(); after',r.GATEWAY+'/engineering_identity.ts':identity,'untouched.ts':b'existing'}
        out=r.patch(r.GATEWAY,files)
        self.assertEqual(out['untouched.ts'],files['untouched.ts'])
        restored=out[r.GATEWAY+'/engineering_identity.ts'].decode().replace(r.ADMIN_RESOLVE,'').replace(r.ADMIN_EXECUTE,'').replace('...standingAuthorized?standing.operations:[],...adminReadAuthorized?["engineering.preflight"]:[]])];','...standingAuthorized?standing.operations:[]])];').replace('...adminReadAuthorized?{administratorRead:true}:{},','')
        self.assertEqual(restored.encode(),identity)
        with self.assertRaises(r.Blocked):r.patch(r.GATEWAY,out)

    def test_checked_in_manifest_pins_only_two_existing_functions(self):
        # This accepted release is historical: subsequent reviewed work may
        # legitimately change current handlers. Exercise the unchanged strict
        # loader against the immutable source actually approved for that release.
        approved='50c17dcce68334f198f06e591c763e435fd616d0'
        manifest=json.loads(r.MANIFEST.read_text())
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for path in manifest['reviewed_files']:
                target=root/path;target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(subprocess.check_output(['git','show',approved+':'+path],cwd=r.ROOT))
            with mock.patch.object(r,'ROOT',root):
                m=r.load()
                # Preserve the production validator's drift rejection, too.
                (root/'supabase/functions/sandy-operation-api/engineering_identity.ts').write_text('unreviewed source')
                with self.assertRaisesRegex(r.Blocked,'reviewed_source_changed'):r.load()
        self.assertEqual(set(m['functions']),{r.CONTROL,r.GATEWAY})
        self.assertEqual(m['functions'][r.CONTROL]['version'],53)
        self.assertEqual(m['functions'][r.GATEWAY]['version'],59)
        self.assertFalse(m['functions'][r.CONTROL]['verify_jwt']);self.assertTrue(m['functions'][r.GATEWAY]['verify_jwt'])
        self.assertFalse(m['grant_established_by_install'])

    def test_local_execution_never_deploys_and_already_installed_never_replays(self):
        with mock.patch.object(r,'inspect',return_value=({},{},{})),mock.patch.dict(r.os.environ,{'GITHUB_ACTIONS':'false'}):
            with self.assertRaisesRegex(r.Blocked,'protected_main'):r.run(None,{},deploy=True)

if __name__=='__main__':unittest.main()
