"""Contract guard for concurrent Mission planning/execution."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261018004600_sandy_mission_single_active_stage_guard.sql'

class TestMissionSingleflight(unittest.TestCase):
    def test_unique_active_stage_only(self):
        sql = MIGRATION.read_text()
        self.assertIn('CREATE UNIQUE INDEX IF NOT EXISTS sandy_mission_runs_single_active_stage', sql)
        self.assertIn('ON public.sandy_mission_runs(mission_task_id, stage)', sql)
        self.assertIn("WHERE state IN ('queued','running')", sql)
        self.assertNotIn("WHERE state IN ('queued','running','completed')", sql)

if __name__ == '__main__':
    unittest.main()
