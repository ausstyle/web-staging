import unittest
from pathlib import Path
from unittest.mock import patch
import release_voice_automatic_learning as s

class VoicePrivacyReleaseTests(unittest.TestCase):
 def test_source_is_mandatory_before_any_SQL_mutation(self):
  m,raw,source=s.load()
  class Runtime:
   out=Path('/tmp/not-written');holder='fixture'
   def sql(self,*_args):raise AssertionError('must not mutate before contained source')
  with patch.object(s,'inspect',side_effect=s.Blocked('source missing')),patch.object(s,'schema')as schema:
   with self.assertRaises(s.Blocked):s.release(Runtime(),m,raw,source,True)
  schema.assert_not_called()
 def test_unknown_SQL_acknowledgement_retains_containment_and_lease_without_retry(self):
  m,raw,source=s.load()
  class Runtime:
   out=Path('/tmp/not-written');holder='fixture'
   def __init__(self):self.queries=[]
   def sql(self,query,read_only=False):
    self.queries.append(query)
    if query.startswith('SELECT count'):return[{'held':1}]
    if query.startswith('BEGIN;'):raise s.Blocked('SQL outcome unknown')
    return[]
  r=Runtime()
  with patch.object(s,'inspect',return_value=({'version':26},b'contained',{})),patch.object(s,'schema'),patch.object(s,'source_check',return_value='a'*40),patch.object(s,'track',return_value='10000000-0000-4000-8000-000000000001'),patch.object(s,'private_write'),patch.object(Path,'mkdir'):
   with self.assertRaises(s.Blocked):s.release(r,m,raw,source,True)
  self.assertEqual(sum(q.startswith('BEGIN;')for q in r.queries),1)
  self.assertTrue(any('voice_privacy_SQL_outcome_unknown'in q for q in r.queries))
  self.assertFalse(any('DELETE FROM public.sandy_engineering_component_leases'in q for q in r.queries))
  self.assertFalse(any('UPDATE public.sandy_memory_settings'in q or 'INSERT INTO auth.users'in q for q in r.queries))
 def test_fixed_plan_has_no_Edge_upload_and_preserves_explicit_writer(self):
  m,_,_=s.load();self.assertEqual(set(m['SQL_candidate']),s.NEW)
  self.assertIn('public.sandy_voice_save_explicit_memory(uuid,text,text)',m['SQL_preserved'])
  code=Path(s.__file__).read_text();self.assertNotIn('r.upload(',code)
  with patch.dict(s.os.environ,{},clear=True),self.assertRaises(s.Blocked):s.source_check(m)
if __name__=='__main__':unittest.main()
