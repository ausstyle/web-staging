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

    def test_actual_mission_execution_state_and_grounded_sources(self):
        self.assertIn('db.from("sandy_mission_runs")', EDGE)
        self.assertIn('mission_status_distribution:', EDGE)
        self.assertIn('mission_execution_stage_distribution:', EDGE)
        self.assertIn('mission_execution_state_distribution:', EDGE)
        self.assertIn('const sourceKeys=new Set<string>', EDGE)
        self.assertIn('sourceKeys.has(x)', EDGE)
        self.assertIn('if(!grounds.length)continue', EDGE)

    def test_missing_persisted_evidence_fails_closed(self):
        self.assertIn('throw new Error("examiner_design_receipt_failed_"', EDGE)

    def test_customer_reviews_feed_examiner_without_raw_content(self):
        self.assertIn('db.from("sandy_qa_message_reviews")', EDGE)
        self.assertIn('db.from("sandy_qa_cases")', EDGE)
        self.assertIn('customer_conversation_qa:', EDGE)
        self.assertIn('customer_originated_qa_cases:', EDGE)
        self.assertIn('source_attachment_count', EDGE)
        self.assertIn('customer_qa:', EDGE)
        self.assertIn('customer_issue_reviews:', EDGE)
        self.assertIn('...snapshot.customer_conversation_qa.map', EDGE)
        design = EDGE.split('if(designFlow){',1)[1].split('if(qaFlow){',1)[0]
        self.assertNotIn('.select("reviewer_note', design)
        self.assertNotIn('.select("question,reply', design)
        self.assertNotIn('email_messages").select(', design)
        self.assertNotIn('raw_customer_message:', design)

    def test_historical_issues_require_live_revalidation(self):
        self.assertIn('historical_qa_status:"unverified_until_current_production_retest"', EDGE)
        self.assertIn('current_state_verification_required:true', EDGE)
        self.assertIn('requires_current_production_retest:true', EDGE)
        self.assertIn('A historical QA failure is not evidence', EDGE)
        self.assertIn('resolved_verified, not_reproduced, cannot_test', EDGE)
        self.assertIn('Never mark resolved based solely on a merged PR', EDGE)

    def test_approved_high_reasoning_openai_model(self):
        self.assertIn('const designModel=String((policy.config as any)?.model||"gpt-5.2")', EDGE)
        self.assertIn('approvedModel?.eligibility!=="approved"', EDGE)
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
        self.assertIn('await finish("rejected"', EDGE)
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

    def test_connected_lab_verification_is_identity_scoped_and_non_mutating(self):
        self.assertIn('LAB_REF = REPO + "/.github/workflows/sandy-examiner-google-lab.yml@refs/heads/main"', EDGE)
        self.assertIn('body.operation!=="examiner_google_lab_verify"', EDGE)
        self.assertIn('lab?.expected_email!=="sandyemail.ai@gmail.com"', EDGE)
        self.assertIn('provider_confirmed:confirmed', EDGE)
        self.assertIn('read_only_execution_tested:gmailRead.successful,gmail_read:gmailRead,drive_read:driveRead,calendar_read:calendarRead,lab_enabled:false', EDGE)
        self.assertIn('enabled:false,verified_at:', EDGE)
        workflow = (ROOT / ".github/workflows/sandy-examiner-google-lab.yml").read_text()
        self.assertIn('id-token: write', workflow)
        self.assertIn('examiner_google_lab_verify', workflow)
        self.assertNotIn('COMPOSIO_API_KEY', workflow)

    def test_live_gmail_read_is_no_payload_no_external_send(self):
        self.assertIn('GMAIL_FETCH_EMAILS', EDGE)
        self.assertIn('include_payload:false', EDGE)
        self.assertIn('max_results:1', EDGE)
        self.assertIn('gmailRead.successful', EDGE)
        self.assertIn('gmail_read:gmailRead,drive_read:driveRead,calendar_read:calendarRead,lab_enabled:false', EDGE)

    def test_drive_calendar_reads_are_provider_scoped_and_read_only(self):
        self.assertIn('GOOGLEDRIVE_LIST_FILES', EDGE)
        self.assertIn('GOOGLECALENDAR_LIST_CALENDARS', EDGE)
        self.assertIn('connection_not_confirmed', EDGE)
        self.assertIn('drive_read:driveRead,calendar_read:calendarRead', EDGE)
        self.assertIn('google_reads_verified_lab_review_pending', EDGE)
        self.assertIn('lab_enabled:false', EDGE)

    def test_model_provider_errors_are_minimized(self):
        self.assertIn('problem?.error?.code', EDGE)
        self.assertIn('problem?.error?.param', EDGE)
        self.assertIn('problem?.error?.type', EDGE)
        self.assertIn('never arbitrary error text', EDGE)

    def test_compact_live_model_input(self):
        self.assertIn('roadmap:snapshot.roadmap.slice(0,15)', EDGE)
        self.assertIn('customer_originated_qa_cases:snapshot.customer_originated_qa_cases.slice(0,6)', EDGE)
        self.assertNotIn('instructions,input:JSON.stringify(snapshot)', EDGE)

    def test_structured_responses_input(self):
        self.assertIn('text:"Respond with a valid JSON object containing a tests array.', EDGE)
        self.assertIn('})}]}],text:{format:{type:"json_object"}}', EDGE)

    def test_model_guidance_matches_validation_requirements(self):
        self.assertIn('Mandatory validation: every question must contain language matching its oracle', EDGE)
        self.assertIn('grounding_keys exactly matching source keys', EDGE)
        self.assertIn('include at least one connections question and one task_count question', EDGE)

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
