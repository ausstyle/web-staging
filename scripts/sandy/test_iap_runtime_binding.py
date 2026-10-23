import copy,unittest
from bind_iap_transport_runtime import validate,Blocked,IDENTITY
class RuntimeBinding(unittest.TestCase):
 def fixture(self):
  sha='a'*40;manifest={'source_sha256':'b'*64};url='https://sandy-engineering-mcp-fixture-ew.a.run.app';run='40000000000';attempt='1'
  old={'revisionName':'sandy-engineering-mcp-api-39849886412-4','tag':'sandy-api-review','url':url.replace('https://','https://sandy-api-review---')}
  traffic=[{'revisionName':'production-preserved','percent':100},old]
  before={'service':'sandy-engineering-mcp','project':'elaborate-haven-511518-a5','url':url,'source_commit_candidate':sha,'verified_runtime_identity':IDENTITY,'traffic':copy.deepcopy(traffic)}
  name='sandy-engineering-mcp-iap-'+run+'-'+attempt
  after={'status':{'traffic':traffic+[{'revisionName':name,'tag':'sandy-iap-repair-review','url':url.replace('https://','https://sandy-iap-repair-review---')}]}}
  revision={'revision':name,'runtime_identity':IDENTITY,'source_commit':sha,'source_sha256':manifest['source_sha256'],'transport_enabled':'true','ready':True,'image_digest':'europe-west1-docker.pkg.dev/elaborate-haven-511518-a5/repo/image@sha256:'+'c'*64}
  return before,after,revision,sha,run,attempt,manifest
 def test_valid_source_revision_preserves_production_and_original_candidate(self):
  p=validate(*self.fixture());self.assertTrue(p['production_traffic_unchanged']);self.assertTrue(p['original_candidate_tag_preserved'])
 def test_source_identity_traffic_or_old_candidate_drift_is_never_repaired_implicitly(self):
  changes=[lambda f:f[1]['status']['traffic'][0].update(percent=0),lambda f:f[1]['status']['traffic'][1].update(revisionName='moved-old-tag'),lambda f:f[2].update(runtime_identity='administrator@example.invalid'),lambda f:f[2].update(source_sha256='d'*64),lambda f:f[2].update(ready=False),lambda f:f[0].update(url='https://evil.invalid')]
  for mutate in changes:
   f=list(self.fixture());mutate(f)
   with self.assertRaises(Blocked):validate(*f)
if __name__=='__main__':unittest.main()
