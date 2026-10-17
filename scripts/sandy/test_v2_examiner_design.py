"""Sandy Examiner adaptive design contracts. Live OIDC/provider verification remains necessary."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
EDGE = (ROOT / "supabase/functions/sandy-engineering-oidc-ingest/index.ts").read_text()
FLOW = (ROOT / ".github/workflows/sandy-v2-examiner-design.yml").read_text()
MIGRATION = (ROOT / "supabase/migrations/20261017211020_sandy_examiner_ai_test_architect_design_cache.sql").read_text()

class TestExaminerIntelligentDesign(unittest.TestCase):
    def test_restrict_design_to_trusted_workflow_and_command(self):
        self.assertIn('DESIGN_REF = REPO + "/.github/workflows/sandy-v2-examiner-design.yml@refs/heads/main"', EDGE)
        self.assertIn('claims.repository!==REPO', EDGE)
        self.assertIn('claims.ref!=="refs/heads/main"', EDGE)
        self.assertIn('body.operation!=="v2_examiner_design"', EDGE)
        self.assertIn('examiner_design_operation_restricted', EDGE)

    def test_live_state_not_static_prompt(self):
        for tablename in ("sandy_v2_runtime_policy", "sandy_feature_roadmap",
                          "sandy_capability_catalog", "sandy_v2_component_inventory",
                          "sandy_qa_cases", "sandy_v2_qa_executions", "sandy_tasks"):
            self.assertIn(f'db.from("{tablename}")', EDGE)
        self.assertIn('active_mission_count:', EDGE)
        self.assertIn('.contains("metadata",{sandy_mission:true})', EDGE)
        self.assertIn('mission_data_provenance:', EDGE)
        self.assertIn('source_inventory:', EDGE)
        self.assertIn('qa_findings:', EDGE)

    def test_approved_high_reasoning_openai_model(self):
        self.assertIn('gpt-6-astra', EDGE)
        self.assertIn('reasoning:{effort:"high"}', EDGE)
        self.assertIn('api.openai.com/v1/responses', EDGE)
        self.assertIn('eligibility!=="approved"', EDGE)
        self.assertIn('OPENAI_API_KEY', EDGE)

    def test_shadow_no_automatic_execution_or_untrusted_oracle(self):
        self.assertIn('execution_status:"shadow_not_executed"', EDGE)
        self.assertIn('note:"Shadow design only; no generated test has been automatically executed."', EDGE)
        self.assertIn('const allowedKeys=', EDGE)
        self.assertIn('const redFlags=', EDGE)
        self.assertIn('if(!match[key].test(question))continue', EDGE)
        self.assertIn('status:"rejected"', EDGE)
        design_block = EDGE.split('if(designFlow){', 1)[1].split('if(qaFlow){', 1)[0]
        self.assertNotIn('db.from("email_messages")', design_block)
        self.assertNotIn('db.from("sandy_mission_documents")', design_block)
        self.assertNotIn('db.from("sandy_whatsapp_messages")', design_block)

    def test_dedupe_and_receipts(self):
        self.assertIn('snapshotHash', EDGE)
        self.assertIn('sandy_examiner_design_runs', EDGE)
        self.assertIn('unchanged_snapshot_within_20_hours', EDGE)
        self.assertIn('examiner_design_provider_http_', EDGE)
        self.assertIn('source_summary:', EDGE)
        self.assertIn('policy.mode==="disabled"', EDGE)

    def test_workflow_requires_oidc_and_is_daily(self):
        self.assertIn("cron: '17 2 * * *'", FLOW)
        self.assertIn('id-token: write', FLOW)
        self.assertIn('ACTIONS_ID_TOKEN_REQUEST_URL', FLOW)
        self.assertIn('v2_examiner_design', FLOW)
        self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY', FLOW)
        self.assertNotIn('OPENAI_API_KEY', FLOW)

    def test_restricted_schema(self):
        self.assertIn('enable row level security', MIGRATION.lower())
        self.assertIn('revoke all on public.sandy_examiner_design_runs from public,anon,authenticated', MIGRATION)
        self.assertIn("values ('examiner_test_design','shadow'", MIGRATION)

if __name__ == "__main__":
    unittest.main()
