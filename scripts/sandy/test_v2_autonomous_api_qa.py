"""Sandy V2 direct API QA security and runtime contract tests.

These prove source-level guardrails; live GitHub OIDC and backend results must
still be validated independently using the scheduled workflow.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
EDGE = ROOT / "supabase/functions/sandy-engineering-oidc-ingest/index.ts"
WORKFLOW = ROOT / ".github/workflows/sandy-v2-api-qa.yml"

class TestV2APIQA(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.edge = EDGE.read_text()
        cls.flow = WORKFLOW.read_text()

    def test_verified_clock_route(self):
        source=(ROOT / "supabase/functions/sandy-agent-runtime/index.ts").read_text()
        self.assertIn('clockOnlyRequest',source)
        self.assertIn('system_clock',source)
        self.assertIn('time and date',source)

    def test_exact_main_workflow_with_repo_identity(self):
        self.assertIn('QA_REF = REPO + "/.github/workflows/sandy-v2-api-qa.yml@refs/heads/main"', self.edge)
        self.assertIn('claims.repository!==REPO', self.edge)
        self.assertIn('String(claims.repository_id)!==REPO_ID', self.edge)
        self.assertIn('claims.ref!=="refs/heads/main"', self.edge)
        self.assertIn('if(!observerFlow&&!inlineFlow)return fail(', self.edge)
        self.assertIn('body.operation!=="v2_api_qa"', self.edge)

    def test_synthetic_isolation(self):
        for table in ("sandy_v2_qa_account", "sandy_composio_connections",
                      "email_customer_addresses", "sandy_whatsapp_identities",
                      "sandy_memory_portal_accounts"):
            self.assertIn(f'db.from("{table}")', self.edge)
        self.assertIn('qa_synthetic_identity_is_not_isolated', self.edge)
        self.assertIn('const customerId=String(account.customer_id)', self.edge)
        self.assertIn('customer_id:customerId', self.edge)

    def test_rate_limit_idempotent_qa(self):
        self.assertIn('sandy_v2_qa_runs', self.edge)
        self.assertIn('duplicate_run:true', self.edge)
        self.assertIn('max_calls_per_day', self.edge)
        self.assertIn('max_calls_per_run', self.edge)
        self.assertIn('rolling_24_hour_budget', self.edge)
        self.assertIn('sandy_v2_qa_executions', self.edge)

    def test_response_evidence_and_proposal_only_improvement(self):
        self.assertIn('db.from("sandy_agent_tasks").select("status,tool_trace,model,customer_id")', self.edge)
        self.assertIn('status:"completed"', (ROOT / "supabase/functions/sandy-agent-runtime/index.ts").read_text())
        self.assertIn('sandy_auto_improve', self.edge.replace("-", "_"))
        self.assertIn('source_type:"qa_failure"', self.edge)
        self.assertIn('verdict="needs_review"', self.edge)

    def test_test_questions_are_read_only(self):
        for text in (
            "What time is it?", "Which apps are connected",
            "How many web chat messages", "WhatsApp, voice and email",
            "Do you know my exact physical location",
            "How many outstanding tasks",
        ):
            self.assertIn(text, self.edge)
        self.assertNotIn('confirm send ', self.edge)
        self.assertNotIn('send_email"', self.edge)

    def test_synthetic_channel_can_inspect_its_own_history(self):
        agent = (ROOT / "supabase/functions/sandy-agent-runtime/index.ts").read_text()
        self.assertIn('channel==="web"||channel==="test"', agent)
        self.assertIn('.eq("customer_id",customerId)', agent)

    def test_multiturn_and_independent_repeat_verification(self):
        self.assertIn('followup_investigation', self.edge)
        self.assertIn('history:context', self.edge)
        self.assertIn('followup_scoped_inspection', self.edge)
        self.assertIn('had("v2_operational_read")', self.edge)
        self.assertIn('const corroborated=', self.edge)
        self.assertIn('corroborated?"passed":"retest_pending"', self.edge)
        self.assertIn('Math.min(2,Number(account.max_calls_per_run)', self.edge)

    def test_stalled_run_reconciliation_and_engineering_handoff(self):
        self.assertIn('v2_api_qa_stalled_runner', self.edge)
        self.assertIn('qa_case_persistence_failed', self.edge)
        improve = (ROOT / "supabase/functions/sandy-auto-improve/index.ts").read_text()
        self.assertIn('sandy_qa_engineering_handoffs', improve)
        self.assertIn('approval_required:true', improve)
        self.assertIn('proposal_only:true', improve)

    def test_only_deterministic_qa_outcomes_train_model_router(self):
        self.assertIn('sandy_v2_model_decisions', self.edge)
        self.assertIn('["web_history","task_count"].includes(testcase.key)', self.edge)
        self.assertIn('actual_success:verdict==="pass"', self.edge)
        self.assertIn('source:"sandy_v2_synthetic_api_qa"', self.edge)
        self.assertIn('.eq("selected_model",taskModel)', self.edge)
        self.assertIn('v2_api_qa_model_feedback', self.edge)

    def test_failed_diagnosis_is_retryable_not_silently_deduplicated(self):
        improve = (ROOT / "supabase/functions/sandy-auto-improve/index.ts").read_text()
        self.assertIn('prior.status==="failed"', improve)
        self.assertIn('3600000', improve)
        self.assertIn('.eq("status","failed").select("id").maybeSingle()', improve)
        self.assertIn('diagnosis_retry_claim_failed', improve)
        self.assertIn('v2_api_qa_autodiagnosis_unavailable', self.edge)

    def test_workflow_short_lived_oidc_and_schedule(self):
        self.assertIn("cron: '*/15 * * * *'", self.flow)
        self.assertIn('id-token: write', self.flow)
        self.assertIn('ACTIONS_ID_TOKEN_REQUEST_URL', self.flow)
        self.assertIn('"v2_api_qa"', self.flow)
        self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY', self.flow)
        self.assertNotIn('SANDY_QA_API_TOKEN', self.flow)

if __name__ == "__main__":
    unittest.main()
