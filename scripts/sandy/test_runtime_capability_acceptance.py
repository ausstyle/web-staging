import unittest
from runtime_capability_acceptance import exact_counts

class CapabilityCountTests(unittest.TestCase):
 def test_exact_integer_counts(self):
  expected={'total_modules':1,'unverified_modules':0}
  self.assertTrue(exact_counts(dict(expected),expected))
  for malformed in [None,[],{'total_modules':True,'unverified_modules':False},
                    {'total_modules':1.0,'unverified_modules':0},
                    {'total_modules':1,'unverified_modules':-1},
                    {'total_modules':1},{**expected,'extra':0},
                    {'total_modules':2,'unverified_modules':0}]:
   self.assertFalse(exact_counts(malformed,expected),repr(malformed))
