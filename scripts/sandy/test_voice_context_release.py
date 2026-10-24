import unittest
from pathlib import Path
from unittest.mock import patch
import release_voice_context_session as s
class VoiceContextReleaseTests(unittest.TestCase):
 def fixture(self):
  m,raw=s.load()
  class Runtime:
   out=Path('/tmp/not-written');holder='fixture';stage='preflight'
   def __init__(self):self.actions=[]
   def sql(self,q,read_only=False):
    self.actions.append(('SQL',q))
    if q.startswith('SELECT count'):return[{'n':3}]
    return[]
   def upload(self,slug,files,jwt):self.actions.append(('upload',slug));return b'{}'
  r=Runtime()
  def read(r,m,slug,installed=False):
   r.actions.append(('read-installed'if installed else'read-before',slug))
   return {'version':m['functions'][slug]['version']+int(installed)},b'source',{}
  return m,raw,r,read
 def test_all_both_source_preimages_must_match_before_any_mutation(self):
  m,raw,r,_=self.fixture()
  with patch.object(s,'read',side_effect=s.Blocked('drift')):
   with self.assertRaises(s.Blocked):s.release(r,m,raw,True)
  self.assertEqual(r.actions,[])
 def run_release(self,failure=None):
  m,raw,r,read=self.fixture()
  def checked_read(*args,**kwargs):
   if failure and args[2]==s.CONTEXT and kwargs.get('installed',args[3]if len(args)>3 else False):raise s.Blocked('secondsource failed')
   return read(*args,**kwargs)
  with patch.object(s,'read',side_effect=checked_read),patch.object(s,'candidate',return_value={}),patch.object(s,'schema'),patch.object(s,'source_check',return_value='a'*40),patch.object(s,'track',return_value='10000000-0000-4000-8000-000000000001'),patch.object(s,'private_write'),patch.object(Path,'mkdir'):
   if failure:
    with self.assertRaises(s.Blocked):s.release(r,m,raw,True)
   else:s.release(r,m,raw,True)
  return r.actions
 def test_issuer_activation_occurs_only_after_both_installed_readbacks(self):
  actions=self.run_release();activation=actions.index(('SQL',s.ACTIVATE))
  for slug in (s.CALL,s.CONTEXT):self.assertIn(('read-installed',slug),actions[:activation])
  held=next(q for kind,q in actions if kind=='SQL'and q.startswith('BEGIN;'))
  self.assertIn(s.HOLD,held);self.assertIn("ARRAY[",held)
  self.assertLess(actions.index(('SQL',held)),actions.index(('upload',s.CALL)))
 def test_second_source_unknown_never_activates_retries_or_releases_custody(self):
  actions=self.run_release(True)
  self.assertNotIn(('SQL',s.ACTIVATE),actions)
  self.assertEqual(sum(kind=='upload'and value==s.CONTEXT for kind,value in actions),1)
  self.assertFalse(any(kind=='SQL'and value.startswith('DELETE FROM public.sandy_engineering_component_leases')for kind,value in actions))
  self.assertTrue(any(kind=='SQL'and 'voice_context_activation_unknown'in value for kind,value in actions))
 def test_fixed_targets_and_committed_main_are_mandatory(self):
  m,_=s.load();self.assertEqual(set(m['functions']),{s.CALL,s.CONTEXT})
  with patch.dict(s.os.environ,{},clear=True),self.assertRaises(s.Blocked):s.source_check(m)
if __name__=='__main__':unittest.main()
