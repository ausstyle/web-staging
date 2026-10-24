import copy
import unittest
from prepare_cloud_run_region_contracts import revise,migration
class RegionContracts(unittest.TestCase):
    def fixtures(self):
        return {'operations':[{'operation':name,'provider':'gcp','method':'GET','contract_sha256':str(i)*64,'input_schema':{'type':'object','properties':{}},'api_exposed':True,'ai_exposed':True,'verified':False} for i,name in enumerate(['gcp.cloud_run.services.list','gcp.cloud_run.services.get','gcp.storage.buckets.list'],1)]}
    def test_only_two_existing_contracts_change_without_flags(self):
        before=self.fixtures();snapshot=copy.deepcopy(before);after,changes=revise(before)
        self.assertEqual(before,snapshot);self.assertEqual(after['operations'][2],before['operations'][2]);self.assertEqual(len(changes),2)
        for old,new in changes:
            for key in ['api_exposed','ai_exposed','verified']:self.assertEqual(old[key],new[key])
            self.assertNotEqual(old['contract_sha256'],new['contract_sha256'])
        self.assertEqual(after['operations'][0]['input_schema']['properties']['region']['enum'],['europe-west1','europe-west8'])
        self.assertNotIn('region',after['operations'][1]['input_schema']['properties'])
    def test_migration_is_guarded_contract_only(self):
        after,changes=revise(self.fixtures());sql=migration(changes)
        self.assertEqual(sql.count('UPDATE public.sandy_operation_registry SET input_schema='),2)
        self.assertEqual(sql.count('cloud_run_contract_baseline_changed'),2)
        for assignment in ['api_exposed=','ai_exposed=','verified=','GRANT ','INSERT INTO']:
            self.assertNotIn(assignment,sql)
        self.assertEqual(revise(after)[0],after)
        with self.assertRaisesRegex(ValueError,'already_revised'):migration(revise(after)[1])
    def test_missing_or_mutating_descriptor_rejected(self):
        before=self.fixtures();before['operations'].pop(0)
        with self.assertRaisesRegex(ValueError,'two_existing'):revise(before)
        before=self.fixtures();before['operations'][0]['method']='POST'
        with self.assertRaisesRegex(ValueError,'read_descriptor'):revise(before)
if __name__=='__main__':unittest.main()
