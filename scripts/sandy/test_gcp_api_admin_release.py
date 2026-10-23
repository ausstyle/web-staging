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

class AcceptanceOnly(unittest.TestCase):
    def test_existing_installation_reconciliation_is_read_only_and_fails_on_drift(self):
        import re,copy
        real,helper,migration,contract=r.load()
        bodies=dict(re.findall(r'CREATE FUNCTION public\.(sandy_gcp_admin_read_\w+)\([^$]*? AS \$\$(.*?)\$\$;',migration.decode(),re.S))
        for failure in [None,'source','jwt','history','rpc','privilege','contract','binding']:
            manifest=copy.deepcopy(real)
            for expected in manifest['functions'].values():expected['candidate_files']={'module.ts':r.digest(b'accepted-source')}
            calls=[]
            class Fake:
                def api(self,method,path,*args):
                    self_outer=self;calls.append((method,path));assert method=='GET'
                    if path=='/secrets':return json.dumps([{'name':'SANDY_GCP_ADMIN_WORKER_URL','value':r.digest((r.WORKER if failure!='binding' else 'other').encode())}]).encode()
                    slug=path.split('/')[2]
                    if path.endswith('/body'):return b'fixture-eszip'
                    return json.dumps({'version':manifest['functions'][slug]['version']+2,'verify_jwt':not manifest['functions'][slug]['verify_jwt'] if failure=='jwt' else manifest['functions'][slug]['verify_jwt'],'status':'ACTIVE'}).encode()
                def sql(self,query,read_only=False):
                    calls.append(('readonly_SQL',query));assert read_only is True
                    if 'schema_migrations' in query:return [] if failure=='history' else [{'version':'20261022201500','statements':[migration.decode()]},{'version':'20261023001000','statements':[contract.decode()]}]
                    if 'pg_proc' in query:return [{'proname':name,'prosrc':body+('broken' if failure=='rpc' else ''),'prosecdef':True,'proconfig':['search_path=pg_catalog, pg_temp'],'anon_execute':failure=='privilege','authenticated_execute':False,'service_execute':True} for name,body in bodies.items()]
                    return [{'input_schema':{} if failure=='contract' else {'type':'object','properties':{'connection':{'type':'string','enum':['sandy-gcp-admin']}},'additionalProperties':False},'handler':r.CONTROL,'is_mutation':False,'api_exposed':True,'ai_exposed':True}]
            with mock.object(r,'original_sources',return_value={'module.ts':b'changed' if failure=='source' else b'accepted-source'}):
                if failure:
                    with self.assertRaises(r.Blocked):r.verify_installed(Fake(),manifest,migration,contract)
                else:
                    result=r.verify_installed(Fake(),manifest,migration,contract)
                    self.assertTrue(result['installed_source_verified']);self.assertEqual(result['mutations'],0)
                    self.assertFalse(result['functional_administrator_acceptance_verified'])
            self.assertTrue(all(method in ['GET','readonly_SQL'] for method,path in calls))
