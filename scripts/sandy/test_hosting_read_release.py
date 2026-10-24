import unittest
from prepare_hosting_read_release import PATCHES,PROVIDER,GATEWAY,HELPER,COMMON,REPLACEMENTS,patch_gateway,build_candidate,prepare,assert_stable_metadata
from release_web_canary import Blocked
class HostingReadRelease(unittest.TestCase):
    def gateway(self):return ('import {resolveMemoryCertification} from "./memory_certification.ts";\n'+'\n'.join(old for old,_ in PATCHES)+'\n// Runtime hook and unrelated code preserved exactly\n').encode()
    def test_three_edits_preserve_every_other_byte(self):
        original=self.gateway();after=patch_gateway(original);self.assertIn(b'resolveMemoryCertification',after)
        self.assertEqual(len([1 for old,new in PATCHES if old.encode() not in after and new.encode() in after]),3)
        for old,new in reversed(PATCHES):after=after.replace(new.encode(),old.encode())
        self.assertEqual(after,original)
    def test_missing_duplicate_already_patched_or_invalid_source_refused(self):
        for source in [b'unknown',self.gateway()+PATCHES[0][0].encode(),patch_gateway(self.gateway()),b'\xff']:
            with self.assertRaises(Blocked):patch_gateway(source)
    def test_only_named_modules_change_and_helper_is_added(self):
        for target in (PROVIDER,GATEWAY):
            before={name:b'original' for name in REPLACEMENTS[target]};before.update({'unrelated.ts':b'preserve',GATEWAY+'/index.ts':self.gateway()})
            reviewed={name:b'reviewed' for name in set(REPLACEMENTS[target])|{HELPER}}
            after=build_candidate(target,before,reviewed);self.assertEqual(after['unrelated.ts'],b'preserve');self.assertEqual(len(after),len(before)+1)
            if target==GATEWAY:self.assertEqual(after[GATEWAY+'/index.ts'],patch_gateway(before[GATEWAY+'/index.ts']))
            else:self.assertEqual(after[GATEWAY+'/index.ts'],before[GATEWAY+'/index.ts'])
    def test_customer_mutation_certification_and_runtime_imports_survive(self):
        name=GATEWAY+'/customer_mutation_certification.ts'
        entry=b'import {certify} from "./customer_mutation_certification.ts";\n'+self.gateway()
        before={n:b'prior' for n in REPLACEMENTS[GATEWAY]}
        before.update({GATEWAY+'/index.ts':entry,name:b'// Runtime-owned certification bytes\n'})
        reviewed={n:b'reviewed' for n in set(REPLACEMENTS[GATEWAY])|{HELPER}}
        after=build_candidate(GATEWAY,before,reviewed)
        self.assertEqual(after[name],before[name])
        self.assertIn(b'import {certify} from "./customer_mutation_certification.ts";',after[GATEWAY+'/index.ts'])
        restored=after[GATEWAY+'/index.ts']
        for old,new in reversed(PATCHES):restored=restored.replace(new.encode(),old.encode())
        self.assertEqual(restored,entry)
    def test_unrecognized_target_missing_modules_and_repeat_preparation_refused(self):
        for target,before,reviewed in [('other',{},{}),(GATEWAY,{},{}),(PROVIDER,{HELPER:b'installed'}, {})]:
            with self.assertRaises(Blocked):build_candidate(target,before,reviewed)
    def test_changed_version_JWT_or_bundle_cannot_be_prepared(self):
        for metadata in [{'slug':PROVIDER,'version':32,'status':'ACTIVE','verify_jwt':True},{'slug':GATEWAY,'version':61,'status':'ACTIVE','verify_jwt':False},{'slug':GATEWAY,'version':61,'status':'ACTIVE','verify_jwt':True}]:
            with self.assertRaises(Blocked):prepare(metadata,b'not-captured-bundle',{})
    def test_capture_detects_concurrent_release_without_automatic_retry(self):
        original={'slug':GATEWAY,'version':63,'status':'ACTIVE','verify_jwt':True,'import_map':False}
        assert_stable_metadata(original,dict(original))
        for key,value in [('version',64),('status','DEPLOYING'),('verify_jwt',False),('import_map',True),('import_map_path','other'),('slug',PROVIDER)]:
            changed={**original,key:value}
            with self.assertRaises(Blocked):assert_stable_metadata(original,changed)
if __name__=='__main__':unittest.main()
