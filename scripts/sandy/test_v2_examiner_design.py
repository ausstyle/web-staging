"""Examiner source contracts. Live OIDC/provider verification remains necessary.

Tests retain identity, isolation, independent evidence and no-false-success
requirements. Configurable cadence, descriptive wording and selection indexes
are not themselves safety properties.
"""
from pathlib import Path
import json
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
EDGE = (ROOT / "supabase/functions/sandy-engineering-oidc-ingest/index.ts").read_text()
FLOW = (ROOT / ".github/workflows/sandy-v2-examiner-design.yml").read_text()
EVOLUTION = (ROOT / "supabase/functions/sandy-auto-improve/index.ts").read_text()
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
        self.assertIn('if(!grounds.length){rejectionCounts.ungrounded++;continue;}', EDGE)

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
        self.assertIn('if(!match[key].test(question)){rejectionCounts.oracle_mismatch++;continue;}', EDGE)
        self.assertIn('await finish("rejected"', EDGE)
        design_block = EDGE.split('if(designFlow){', 1)[1].split('if(qaFlow){', 1)[0]
        self.assertNotIn('db.from("email_messages")', design_block)
        self.assertNotIn('db.from("sandy_mission_documents")', design_block)
        self.assertNotIn('db.from("sandy_whatsapp_messages")', design_block)

    def test_dedupe_and_receipts(self):
        for text in ('snapshotHash','sandy_examiner_design_runs','unchanged_snapshot_within_20_hours',
                     'examiner_design_provider_http_','source_summary:','policy.mode==="disabled"'):
            self.assertIn(text, EDGE)

    def test_connected_lab_verification_is_identity_scoped_and_non_mutating(self):
        self.assertIn('LAB_REF = REPO + "/.github/workflows/sandy-examiner-google-lab.yml@refs/heads/main"', EDGE)
        self.assertIn('body.operation!=="examiner_google_lab_verify"', EDGE)
        self.assertIn('lab?.expected_email!=="sandyemail.ai@gmail.com"', EDGE)
        self.assertIn('provider_confirmed:confirmed', EDGE)
        self.assertIn('read_only_execution_tested:gmailRead.successful,gmail_read:gmailRead,drive_read:driveRead,calendar_read:calendarRead,runtime_checks:runtimeChecks,lab_enabled:false', EDGE)
        self.assertIn('enabled:false,verified_at:', EDGE)
        workflow = (ROOT / ".github/workflows/sandy-examiner-google-lab.yml").read_text()
        self.assertIn('id-token: write', workflow)
        self.assertIn('examiner_google_lab_verify', workflow)
        self.assertNotIn('COMPOSIO_API_KEY', workflow)

    def test_live_gmail_read_is_no_payload_no_external_send(self):
        for text in ('GMAIL_FETCH_EMAILS','include_payload:false','max_results:1','gmailRead.successful',
                     'gmail_read:gmailRead,drive_read:driveRead,calendar_read:calendarRead,runtime_checks:runtimeChecks,lab_enabled:false'):
            self.assertIn(text, EDGE)

    def test_drive_calendar_reads_are_provider_scoped_and_read_only(self):
        for text in ('GOOGLEDRIVE_LIST_FILES','GOOGLECALENDAR_LIST_CALENDARS','connection_not_confirmed',
                     'drive_read:driveRead,calendar_read:calendarRead','google_reads_verified_lab_review_pending','lab_enabled:false'):
            self.assertIn(text, EDGE)

    def test_model_provider_errors_are_minimized(self):
        for text in ('problem?.error?.code','problem?.error?.param','problem?.error?.type','never arbitrary error text'):
            self.assertIn(text, EDGE)

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
        instructions = EDGE.split('const instructions=[',1)[1].split('].join(" ")',1)[0].lower()
        requirement = re.search(r'include at least one[^"\n]*question', instructions)
        self.assertIsNotNone(requirement, 'Explicit coverage instructions are required')
        self.assertIn('connections', requirement.group())
        self.assertIn('task_count', requirement.group())
        self.assertIn('clock', requirement.group())
        self.assertIn('capability', requirement.group())

    def test_proposal_rejection_diagnostics_are_aggregate_only(self):
        for text in ('proposal_rejections:rejectionCounts','proposals_returned:data.tests.length','proposals_accepted:accepted.length'):
            self.assertIn(text, EDGE)

    def test_model_receives_exact_allowed_grounding_keys(self):
        self.assertIn('allowed_grounding_keys:["mission_charter","mission_activity"', EDGE)
        self.assertIn('Copy grounding_keys ONLY from allowed_grounding_keys', EDGE)
        self.assertIn('if(!grounds.length){rejectionCounts.ungrounded++;continue;}', EDGE)

    def test_dynamic_execution_is_scoped_and_gated(self):
        self.assertIn('examiner_dynamic_execution', EDGE)
        self.assertIn('executionPolicy?.mode==="enabled"', EDGE)
        # Production now iterates a bounded generated suite, not one fixed slot.
        for text in ('safeOracles.has(x?.oracle_key)', '!disallow.test(x.question)',
                     'x.execution_status==="shadow_not_executed"',
                     'x.requires_current_production_retest===true',
                     'Array.isArray(x.grounding_keys)&&x.grounding_keys.length>0',
                     'const selectedDynamic=dynamicCandidates[i]||null',
                     'qa_no_novel_eligible_generated_cases', 'qa_targeted_budget_or_novelty_insufficient'):
            self.assertIn(text, EDGE)
        self.assertIn('const recordCaseKey=selectedDynamic?', EDGE)
        self.assertIn('ai_design_run:testcase.design_run_key||null', EDGE)

    def test_separate_ai_quality_judge_cannot_override_oracle(self):
        for text in ('if(selectedDynamic){','semantic_review:semanticReview',
                     'An oracle failure cannot be overturned','independent_semantic_review_unavailable','observed_tools:trace.map'):
            self.assertIn(text, EDGE)
        condition = re.search(r'if\((verdict===\"pass\"[^\n]+?)\)\{\s*verdict=\"needs_review\";reason=\"independent_quality_review_\"', EDGE)
        self.assertIsNotNone(condition, 'Judge must only downgrade a passing oracle, never promote a failure')
        cases=[
            {'verdict':'fail','value':'pass','score':5,'testcase':{'key':'cross_channel'}},
            {'verdict':'needs_review','value':'pass','score':5,'testcase':{'key':'capability'}},
            {'verdict':'pass','value':'fail','score':1,'testcase':{'key':'cross_channel'}},
            {'verdict':'pass','value':'pass','score':2,'testcase':{'key':'capability'}},
            {'verdict':'pass','value':'pass','score':5,'testcase':{'key':'cross_channel'}},
            {'verdict':'pass','value':'fail','score':1,'testcase':{'key':'clock'}},
        ]
        script='console.log(JSON.stringify(('+json.dumps(cases)+').map(({verdict,value,score,testcase})=>Boolean('+condition.group(1)+'))));'
        observed=subprocess.run(['node','--input-type=module','-e',script],check=True,capture_output=True,text=True,timeout=10)
        self.assertEqual(json.loads(observed.stdout),[False,False,True,True,False,False])
        review=EDGE.split('semanticReview={status:value',1)[1].split('const duration=',1)[0]
        self.assertNotRegex(review, r'\bverdict\s*=\s*[\"\']pass[\"\']')

    def test_evolution_handoff_requires_durable_receipt(self):
        self.assertIn('evolutionAccepted=rsp.ok&&receipt.ok===true&&receipt.status==="proposed"', EDGE)
        self.assertIn('v2_api_qa_evolution_delivery_', EDGE)
        self.assertIn('if(handoffReceiptError)return fail(', EDGE)
        self.assertNotIn('EdgeRuntime.waitUntil(diagnostic)', EDGE)

    def test_evolution_uses_approved_operational_model(self):
        self.assertIn('model:"gpt-5.2",store:false', EVOLUTION)
        self.assertNotIn('model:"gpt-6-astra"', EVOLUTION)

    def test_connected_lab_checks_real_sandy_runtime_without_mutation(self):
        for text in ('examinerlab_','url+"/functions/v1/sandy-agent-runtime"',
                     'required:"gmail_verified_recent"','required:"v2_connection_preflight"',
                     'runtime_checks:runtimeChecks,lab_enabled:false','no_mutating_tools:!forbidden'):
            self.assertIn(text, EDGE)

    def test_connected_lab_scheduled_audit_receipts(self):
        for text in ('sandy_examiner_lab_run_receipts','overall_status:overallStatus','runtime_checks:runtimeChecks','["push","schedule","workflow_dispatch"]'):
            self.assertIn(text, EDGE)
        lab = (ROOT / ".github/workflows/sandy-examiner-google-lab.yml").read_text()
        self.assertIn("cron: '23 4 * * *'", lab)
        self.assertIn('overall_status,run_key,lab_enabled', lab)

    def test_intelligence_assurance_scope_in_astra_architect(self):
        for requirement in ["customer objective completion", "delegation and recovery", "customer friction",
                            "independent of Evolution", "learning effectiveness", "necessary approval", "cannot_test"]:
            self.assertIn(requirement, EDGE)

    def test_assurance_receipts_do_not_claim_unmeasured_outcomes(self):
        for text in ('sandy_examiner_assurance_runs','sandy_examiner_assurance_findings',
                     'customer_outcome_completion:"not_measured"','customer_frustration:"not_measured"',
                     'current_state:"retest_required"','ignoreDuplicates:true'):
            self.assertIn(text, EDGE)

    def test_acceptance_gate_requires_real_dynamic_evidence(self):
        for text in ('sandy_examiner_acceptance_gates','if(summary.attempted>0)',
                     'x.ai_design_run&&x.verdict==="pass"','acceptance_gate_write_failed'):
            self.assertIn(text, EDGE)

    def test_evolution_diagnosis_json_has_room_and_explicit_failure(self):
        for text in ('max_output_tokens:4500','diagnosis_response_incomplete','diagnosis_json_not_parseable'):
            self.assertIn(text, EVOLUTION)

    def test_provider_count_parity_not_conflated_with_content_truth(self):
        for text in ('provider_count_comparable:providerCountComparable','provider_count_matches:providerCountMatches',
                     'max_results:5,include_payload:false','Count parity is a bounded independent cross-check'):
            self.assertIn(text, EDGE)

    def test_gmail_runtime_requires_independent_provider_parity_for_pass(self):
        self.assertIn('providerCountComparable&&providerCountMatches===true', EDGE)
        self.assertIn('test.key!=="gmail"', EDGE)
        self.assertIn('?"pass":"needs_review"', EDGE)

    def test_independent_gmail_subjects_required_for_pass(self):
        self.assertIn('independentGmailSubjects.every(subject=>answerText.includes(subject))', EDGE)
        self.assertIn('contentComparable&&contentMatches===true', EDGE)
        self.assertIn('provider_subjects_match:contentMatches', EDGE)
        self.assertNotIn('runtime_checks:runtimeChecks,lab_enabled:true', EDGE)

    def test_workflow_requires_oidc_and_bounded_daily_schedule(self):
        schedules = re.findall(r"^\s*-\s*cron:\s*['\"]([^'\"]+)['\"]\s*$", FLOW, re.M)
        self.assertEqual(len(schedules),1)
        minute,hour,day,month,weekday=schedules[0].split()
        self.assertTrue(minute.isdigit() and 0 <= int(minute) < 60)
        self.assertEqual((day,month,weekday),('*','*','*'))
        self.assertTrue((hour.isdigit() and 0 <= int(hour) < 24) or
                        (hour.startswith('*/') and hour[2:].isdigit() and 1 <= int(hour[2:]) <= 24))
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
