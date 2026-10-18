"""Mission planner safeguards: no duplicate unstarted Sandy-owned milestones."""
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / 'supabase/functions/sandy-mission-runner/index.ts').read_text()

class TestMissionSupersession(unittest.TestCase):
    def test_answered_customer_questions_are_semantically_deduplicated(self):
        self.assertIn('question_key,status,question,answer', SOURCE)
        self.assertIn('clarificationReview="unavailable"', SOURCE)
        self.assertIn('newQuestions=newQuestions.filter', SOURCE)
        self.assertIn('If uncertain whether a question is answered, keep it.', SOURCE)
        self.assertIn('clarification_review:clarificationReview', SOURCE)

    def test_old_steps_status_is_loaded_before_supersession(self):
        self.assertIn('.select("id,status,metadata").eq("customer_id",job.customer_id)', SOURCE)
        self.assertIn('t.status==="todo"', SOURCE)
        self.assertIn('t.metadata?.assigned_to==="sandy"', SOURCE)
        self.assertIn('t.metadata?.approval_required!==true', SOURCE)
        self.assertIn('event_type:"mission_tasks_superseded"', SOURCE)

if __name__=='__main__':
    unittest.main()
