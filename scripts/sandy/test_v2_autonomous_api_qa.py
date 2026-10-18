"""Source-level QA safety contracts, not live provider acceptance.

Exercise actual operation and budget expressions. Do not confuse old wording,
selection indexes, or obsolete cron schedules with a security requirement.
"""
from pathlib import Path
import json
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
EDGE = ROOT / 'supabase/functions/sandy-engineering-oidc-ingest/index.ts'
WORKFLOW = ROOT / '.github/workflows/sandy-v2-api-qa.yml'

def javascript_value(expression):
    result = subprocess.run(['node','--input-type=module','-e','console.log(JSON.stringify('+expression+'));'],
                            check=True,capture_output=True,text=True,timeout=10)
    return json.loads(result.stdout)

class TestV2APIQA(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.edge = EDGE.read_text()
        cls.flow = WORKFLOW.read_text()

    def test_verified_clock_route(self):
        source=(ROOT/'supabase/functions/sandy-agent-runtime/index.ts').read_text()
        for value in ('clockOnlyRequest','system_clock','time and date'):
            self.assertIn(value,source)
        self.assertNotIn(r'\\\\s',source[source.index('const clockOnlyRequest'):source.index('if(clockOnlyRequest)')])

    def test_exact_main_workflow_with_repo_identity(self):
        for value in ('QA_REF = REPO + "/.github/workflows/sandy-v2-api-qa.yml@refs/heads/main"',
                      'claims.repository!==REPO','String(claims.repository_id)!==REPO_ID',
                      'claims.ref!=="refs/heads/main"','if(!observerFlow&&!inlineFlow)return fail('):
            self.assertIn(value,self.edge)
        qa=self.edge.split('if(qaFlow){',1)[1]
        guard=re.search(r'if\((.*?)\)\s*return fail\("qa_operation_restricted",403\)',qa,re.S)
        self.assertIsNotNone(guard,'An operation/argument deny guard is required')
        cases=[{'operation':'v2_api_qa'},{'operation':'v2_api_qa_targeted_10'},
               {},{'operation':'deploy'},{'operation':'v2_api_qa','customer_id':'other'},
               {'operation':'v2_api_qa_targeted_10','approved':True},
               {'operation':None},{'operation':['v2_api_qa','deploy']}]
        actual=javascript_value('('+json.dumps(cases)+').map(body=>Boolean('+guard.group(1)+'))')
        self.assertEqual(actual,[False,False,True,True,True,True,True,True])

    def test_synthetic_isolation(self):
        for table in ('sandy_v2_qa_account','sandy_composio_connections','email_customer_addresses',
                      'sandy_whatsapp_identities','sandy_memory_portal_accounts'):
            self.assertIn('db.from("'+table+'")',self.edge)
        for value in ('qa_synthetic_identity_is_not_isolated','const customerId=String(account.customer_id)',
                      'customer_id:customerId'):
            self.assertIn(value,self.edge)

    def test_rate_limit_idempotent_qa(self):
        for value in ('sandy_v2_qa_runs','duplicate_run:true','max_calls_per_day','max_calls_per_run',
                      'rolling_24_hour_budget','sandy_v2_qa_executions'):
            self.assertIn(value,self.edge)
        cap=re.search(r'const allowed=(Math\.min\([^;]+\));',self.edge)
        self.assertIsNotNone(cap,'A bounded execution budget is required')
        cases=[{'account':{'max_calls_per_run':10,'max_calls_per_day':80},'used':0,'available':20},
               {'account':{'max_calls_per_run':2,'max_calls_per_day':80},'used':0,'available':20},
               {'account':{'max_calls_per_run':10,'max_calls_per_day':80},'used':79,'available':20},
               {'account':{'max_calls_per_run':10,'max_calls_per_day':80},'used':80,'available':20},
               {'account':{'max_calls_per_run':10,'max_calls_per_day':80},'used':0,'available':0},
               {'account':{'max_calls_per_run':100,'max_calls_per_day':200},'used':0,'available':100}]
        expression=('('+json.dumps(cases)+').map(({account,used,available})=>{'
                    'const dynamicCandidates=Array(available);return '+cap.group(1)+';})')
        self.assertEqual(javascript_value(expression),[10,2,1,0,0,10])
        self.assertIn('qa_no_novel_eligible_generated_cases',self.edge)
        self.assertIn('qa_targeted_budget_or_novelty_insufficient',self.edge)

    def test_response_evidence_and_proposal_only_improvement(self):
        self.assertIn('db.from("sandy_agent_tasks").select("status,tool_trace,model,customer_id")',self.edge)
        self.assertIn('status:"completed"',(ROOT/'supabase/functions/sandy-agent-runtime/index.ts').read_text())
        self.assertIn('sandy_auto_improve',self.edge.replace('-','_'))
        self.assertIn('source_type:"qa_failure"',self.edge)
        self.assertIn('verdict="needs_review"',self.edge)

    def test_test_questions_are_read_only(self):
        for value in ('What time is it?','Which apps are connected','How many web chat messages',
                      'WhatsApp, voice and email','Do you know my exact physical location','How many outstanding tasks'):
            self.assertIn(value,self.edge)
        self.assertNotIn('confirm send ',self.edge)
        self.assertNotIn('send_email"',self.edge)

    def test_synthetic_channel_can_inspect_its_own_history(self):
        agent=(ROOT/'supabase/functions/sandy-agent-runtime/index.ts').read_text()
        self.assertIn('channel==="web"||channel==="test"',agent)
        self.assertIn('.eq("customer_id",customerId)',agent)

    def test_multiturn_and_independent_repeat_verification(self):
        for value in ('followup_investigation','history:context','had("v2_operational_read")',
                      'had("inspect_sandy_operational_state")','scopedInspection','coverage_disclosed:',
                      'const corroborated=','(recent?.length||0)>=2',
                      'recent!.every((x:any)=>x.verdict==="pass")','corroborated?"passed":"retest_pending"'):
            self.assertIn(value,self.edge)

    def test_stalled_run_reconciliation_and_engineering_handoff(self):
        self.assertIn('v2_api_qa_stalled_runner',self.edge)
        self.assertIn('qa_case_persistence_failed',self.edge)
        improve=(ROOT/'supabase/functions/sandy-auto-improve/index.ts').read_text()
        for value in ('sandy_qa_engineering_handoffs','approval_required:true','proposal_only:true'):
            self.assertIn(value,improve)

    def test_only_deterministic_qa_outcomes_train_model_router(self):
        for value in ('sandy_v2_model_decisions','["web_history","task_count"].includes(testcase.key)',
                      'actual_success:verdict==="pass"','source:"sandy_v2_synthetic_api_qa"',
                      '.eq("selected_model",taskModel)','v2_api_qa_model_feedback'):
            self.assertIn(value,self.edge)

    def test_failed_diagnosis_is_retryable_not_silently_deduplicated(self):
        improve=(ROOT/'supabase/functions/sandy-auto-improve/index.ts').read_text()
        for value in ('prior.status==="failed"','3600000',
                      '.eq("status","failed").select("id").maybeSingle()','diagnosis_retry_claim_failed'):
            self.assertIn(value,improve)
        self.assertIn('v2_api_qa_autodiagnosis_unavailable',self.edge)

    def test_workflow_short_lived_oidc_and_schedule(self):
        schedules=re.findall(r"^\s*-\s*cron:\s*['\"]([^'\"]+)['\"]\s*$",self.flow,re.M)
        self.assertEqual(len(schedules),1)
        minute,hour,day,month,weekday=schedules[0].split()
        self.assertTrue(minute.isdigit() and 0 <= int(minute) < 60)
        self.assertEqual((day,month,weekday),('*','*','*'))
        self.assertTrue((hour.isdigit() and 0 <= int(hour) < 24) or
                        (hour.startswith('*/') and hour[2:].isdigit() and 1 <= int(hour[2:]) <= 24))
        for value in ('id-token: write','ACTIONS_ID_TOKEN_REQUEST_URL','"v2_api_qa"'):
            self.assertIn(value,self.flow)
        for value in ('SUPABASE_SERVICE_ROLE_KEY','SANDY_QA_API_TOKEN'):
            self.assertNotIn(value,self.flow)

if __name__ == '__main__':
    unittest.main()
