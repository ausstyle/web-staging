import unittest
from build_engineering_operation_classes import build, classify, guest_descriptor

class OperationClasses(unittest.TestCase):
    def op(self, method, path, **kw):
        return dict(provider='github',method=method,path=path,operation='github.test',**kw)
    def test_reviewed_repo_classes(self):
        root='/repos/{owner}/{repo}'
        for method,path,expected in [('GET',root,'metadata_read'),('POST',root+'/pulls','pull_request_write'),('PATCH',root+'/git/refs/{ref}','git_write'),('PUT',root+'/contents/{path}','code_write')]:
            self.assertEqual(classify(self.op(method,path)),expected)
    def test_security_cost_and_unknown_semantics_remain_restricted(self):
        root='/repos/{owner}/{repo}'
        for op in [self.op('DELETE',root),self.op('DELETE',root+'/git/refs/{ref}'),self.op('POST',root+'/pulls/{pull_number}/codespaces'),self.op('PUT',root+'/pulls/{pull_number}/merge-async'),self.op('GET',root,requires_cost_approval=True),self.op('GET',root,sensitive=True),self.op('POST',root+'/actions/workflows/{workflow_id}/dispatches')]:
            self.assertEqual(classify(op),'restricted')
    def test_manifest_is_unique_versioned_classification_not_registry_generation(self):
        rows=build()
        self.assertEqual(len(rows),len({r['operation'] for r in rows}))
        self.assertTrue(all(len(r['contract_sha256'])==64 for r in rows))
        self.assertTrue(all(r['source_path'].startswith('supabase/functions/') for r in rows))
    def test_guest_observation_reuses_metadata_authority_without_mutation_grants(self):
        rows={r['operation']:r for r in build()}
        row=rows['gcp.vm.agent.status']
        self.assertEqual((row['provider'],row['operation_class'],row['is_mutation']),('gcp','metadata_read',False))
        self.assertEqual(row['path'],'/sandy/guest/agent-status')
        for name in ['gcp.vm.access.bootstrap','gcp.vm.access.rotate','gcp.vm.agent.install','gcp.vm.ssh.exec','gcp.vm.winrm.exec']:
            self.assertNotIn(name,rows)
    def test_guest_classes_are_typed_and_do_not_include_security_or_transport(self):
        rows={r['operation']:r for r in build()}
        for operation,expected in [('gcp.vm.files.upload','guest_files_write'),
                                   ('gcp.vm.packages.install','guest_packages_write'),
                                   ('gcp.vm.services.restart','guest_services_write'),
                                   ('gcp.vm.files.download','guest_read'),
                                   ('gcp.vm.services.status','guest_read'),
                                   ('gcp.vm.tasks.get','guest_read')]:
            self.assertEqual(rows[operation]['operation_class'],expected)
        for name in ['gcp.vm.reboot','gcp.vm.firewall_guest.manage','gcp.vm.access.revoke']:
            self.assertNotIn(name,rows)
        self.assertIsNone(guest_descriptor(dict(operation='gcp.vm.files.exec',kind='queue',is_mutation=True)))
        self.assertIsNone(guest_descriptor(dict(operation='gcp.vm.files.download',kind='queue',is_mutation=True)))
        self.assertIsNone(guest_descriptor(dict(operation='gcp.vm.files.upload',kind='unsupported_transport',is_mutation=True)))

if __name__=='__main__':unittest.main()
