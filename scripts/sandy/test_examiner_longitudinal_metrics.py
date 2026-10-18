"""Contract tests for privacy-scoped longitudinal Examiner QA comparisons."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
SQL=(ROOT/'supabase/migrations/20261018010200_examiner_longitudinal_cohorts.sql').read_text()
class TestLongitudinalMetrics(unittest.TestCase):
    def test_cohort_isolation(self):
        self.assertIn("JOIN public.sandy_v2_qa_account q ON q.customer_id=e.customer_id AND q.id=1",SQL)
    def test_significance_gate(self):
        self.assertIn("recent_n>=4 AND previous_n>=4",SQL)
        self.assertIn("'insufficient_matched_samples'",SQL)
    def test_private_access(self):
        self.assertIn("FROM public,anon,authenticated",SQL)
        self.assertIn("TO service_role",SQL)
if __name__=="__main__":
    unittest.main()
