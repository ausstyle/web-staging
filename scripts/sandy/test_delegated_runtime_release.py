"""Fault and authority tests for the existing governed release transport."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import release_delegated_runtime as release

class Transport:
    credential='fixture-never-a-real-credential'
    holder='fixture-holder'
    def __init__(self): self.uploads=0; self.queries=[]; self.before=b'prior'; self.files={'sandy-agent-runtime-v4/index.ts':b'candidate'}
    def api(self,method,path,data=None,mime=None):
        if method=='POST':self.uploads+=1;return b'{"version":2}'
        if path.endswith('/body'):return b'after' if self.uploads else self.before
        return json.dumps({'slug':'sandy-agent-runtime-v4','status':'ACTIVE','version':2 if self.uploads else 1,'verify_jwt':False}).encode()
    def sql(self,q):self.queries.append(q);return [{'held':1}]

class Tests(unittest.TestCase):
    def setUp(self):
        self.change='30000000-0000-4000-8000-000000000003';self.pin='b'*64
        self.manifest={'function':'sandy-agent-runtime-v4','source_commit':'a'*40,'expected_prior_version':1,'prior_bundle_sha256':release.digest(b'prior'),'verify_jwt':False,'rollback':'Restore captured original source under the component lease.'}
        self.auth={'id':'40000000-0000-4000-8000-000000000004','change_id':self.change,'source_commit':'a'*40,'manifest_sha256':self.pin,'state':'authorized_by_policy','grant_revision':1}
    def reply(self,b,c):return (201,{'artifact':{'id':'fixture'}}) if b['action']=='artifact' else (200,{'ok':True,'authorization':self.auth})
    def execute(self,r,control):
        with tempfile.TemporaryDirectory() as path,patch.object(release,'control',side_effect=control),patch.object(release,'original_sources',return_value=r.files):
            return release.release(r,self.change,self.manifest,r.files,self.pin,Path(path))
    def test_two_separate_routine_releases_need_no_owner_session_or_approval_call(self):
        actions=[]
        def control(b,c):actions.append(b['action']);return self.reply(b,c)
        for _ in range(2):
            r=Transport();result=self.execute(r,control);self.assertEqual(r.uploads,1);self.assertTrue(result['all_original_modules_verified']);self.assertFalse(result['functional_acceptance_passed'])
        self.assertEqual(actions,['authorize_release','authorize_release','artifact']*2)
    def test_policy_denial_performs_no_lease_or_upload(self):
        r=Transport()
        with self.assertRaises(release.Blocked):self.execute(r,lambda b,c:(403,{'state':'policy_blocked'}))
        self.assertEqual(r.uploads,0);self.assertEqual(r.queries,[])
    def test_revocation_after_preflight_prevents_dispatch(self):
        r=Transport();calls=0
        def control(b,c):
            nonlocal calls
            calls+=1;return self.reply(b,c) if calls==1 else (403,{'state':'policy_blocked'})
        with self.assertRaises(release.Blocked):self.execute(r,control)
        self.assertEqual(r.uploads,0);self.assertTrue(r.queries[-1].startswith('DELETE'))
    def test_source_manifest_and_changed_authorization_fail_closed(self):
        r=Transport();self.auth['source_commit']='c'*40
        with self.assertRaises(release.Blocked):self.execute(r,self.reply)
        self.assertEqual(r.uploads,0)
    def test_unknown_upload_outcome_is_never_replayed(self):
        r=Transport()
        def upload(*args):r.uploads+=1;raise TimeoutError('fixture outcome unknown')
        with patch.object(release,'upload',side_effect=upload),self.assertRaises(TimeoutError):self.execute(r,self.reply)
        self.assertEqual(r.uploads,1);self.assertTrue(r.queries[-1].startswith('DELETE'))
if __name__=='__main__':unittest.main()
