"""Offline architectural contracts for Sandy V2 shadow upgrade.
These checks do not replace authenticated end-to-end tests.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "supabase/functions/sandy-agent-runtime/index.ts"
GATEWAY = ROOT / "supabase/functions/sandy-composio-gateway/index.ts"

class TestV2ArchitecturalContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.agent = RUNTIME.read_text()
        cls.gateway = GATEWAY.read_text()

    def test_authenticated_identity_is_not_from_prompt(self):
        self.assertIn('const customerId=account.customer_id;', self.gateway)
        self.assertIn('.eq("auth_user_id",identity.user.id)', self.gateway)
        self.assertIn('.eq("customer_id",customerId)', self.gateway)

    def test_connection_status_is_database_and_provider_evidenced(self):
        self.assertIn('operation==="v2_awareness"', self.gateway)
        self.assertIn('provider_not_confirmed', self.gateway)
        self.assertIn('sandy_v2_awareness_audit', self.gateway)
        self.assertIn('sandy_supervisor_findings', self.gateway)

    def test_no_unrestricted_composio_execution(self):
        self.assertIn('operation_not_enabled', self.gateway)
        self.assertIn('tool_execution_enabled:false', self.gateway)
        self.assertIn('customer_connection_required:true', self.gateway)

    def test_agent_preflight_and_email_confirmation_update_defined(self):
        self.assertIn('v2_connection_preflight', self.agent)
        self.assertIn('sandy_v2_model_decisions', self.agent)
        self.assertLess(self.agent.index('const update=async'), self.agent.index('const confirmation='))

    def test_chat_contradictions_feed_self_diagnosis(self):
        self.assertIn('mismatched.length?"contradiction"', self.agent)
        self.assertIn('sandy_supervisor_findings', self.agent)
        self.assertIn('source_type:"system_awareness"', self.agent)
        self.assertIn('task_completion:"not_independently_verified"', self.agent)

    def test_shadow_routing_guarded(self):
        self.assertIn('v2ModelMode==="enabled"', self.agent)
        self.assertIn('registry?.eligibility==="approved"', self.agent)
        self.assertIn('const defaultModel=complex?', self.agent)

    def test_customer_data_not_returned_as_raw_account_id(self):
        v2_slice = self.gateway.split('if(operation==="v2_awareness")',1)[1].split('if(operation==="status")',1)[0]
        self.assertNotIn('connected_account_id:c.connected_account_id', v2_slice)
        self.assertIn('customer_scope:"authenticated_customer_only"', v2_slice)

if __name__ == "__main__":
    unittest.main()
