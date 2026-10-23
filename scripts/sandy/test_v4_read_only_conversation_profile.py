"""Offline V4 Examiner read-only tool-profile regression (no customer/provider calls).

The broker authenticates an actual persisted task and pins exact model tool
schemas. A synthetic QA request must retain the six read-only tools, not the
full customer tool set. All hashes are recomputed from current V4 definitions.
"""
from pathlib import Path
import json
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
V4 = ROOT / "supabase/functions/sandy-agent-runtime-v4/index.ts"
BROKER = ROOT / "supabase/functions/_shared/sandy-agent-operations/runtime_conversation.ts"
TRANSPORT = ROOT / "supabase/functions/_shared/sandy-agent-operations/runtime_conversation_v4_transport.ts"


class TestExaminerV4ReadOnlyConversationProfile(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v4 = V4.read_text()
        cls.broker = BROKER.read_text()
        cls.transport = TRANSPORT.read_text()

    def test_actual_tool_definitions_match_both_pinned_profiles(self):
        start = self.v4.index("const gmailReadTool=")
        end = self.v4.index("Deno.serve(", start)
        declarations = self.v4[start:end]
        match = re.search(r"const readOnlyNames=(\[[^\]]+\]);", self.v4)
        self.assertIsNotNone(match, "Read-only names must be a fixed source list")
        names = json.loads(match.group(1))
        self.assertEqual(names, [
            "sandy_context_lookup", "list_tasks", "search_history",
            "search_connected_gmail", "list_connected_services",
            "inspect_sandy_operational_state",
        ])
        script = 'const crypto=require("node:crypto");\n' + declarations + '''
const offered = [v4ContextTool, ...tools, ...connectedTools,
  gmailReadTool, connectionsTool, selfInspectTool, draftGmailTool];
const readOnlyNames = ''' + json.dumps(names) + ''';
const restricted = offered.filter(t => readOnlyNames.includes(t.name));
const stable = v => JSON.stringify(v && typeof v === "object" ?
  (Array.isArray(v) ? v.map(x => JSON.parse(stable(x))) :
    Object.fromEntries(Object.keys(v).sort().map(k => [k, JSON.parse(stable(v[k]))]))) : v);
const digest = v => crypto.createHash("sha256").update(stable(v)).digest("hex");
console.log(JSON.stringify({
  fullHash: digest(offered),
  restrictedHash: digest(restricted),
  alteredHash: digest(restricted.slice(1)),
  restrictedNames: restricted.map(t => t.name),
  fullNames: offered.map(t => t.name)
}));
'''
        process = subprocess.run(
            ["node", "-e", script], capture_output=True, text=True,
            check=True, timeout=20,
        )
        hashes = json.loads(process.stdout)
        expected_full = re.search(r'toolSchemaSha256: "([a-f0-9]{64})"', self.transport)
        expected_restricted = re.search(
            r'readOnlyToolSchemaSha256: "([a-f0-9]{64})"', self.transport,
        )
        self.assertIsNotNone(expected_full)
        self.assertIsNotNone(expected_restricted)
        self.assertEqual(hashes["fullHash"], expected_full.group(1))
        self.assertEqual(hashes["restrictedHash"], expected_restricted.group(1))
        self.assertEqual(hashes["restrictedNames"], names)
        self.assertNotEqual(hashes["alteredHash"], hashes["restrictedHash"])
        self.assertTrue({"request_client_action", "prepare_gmail_message",
                         "request_image_approval"} <= set(hashes["fullNames"]))
        self.assertFalse({"request_client_action", "prepare_gmail_message",
                          "request_image_approval", "draft_execution_plan",
                          "research_web"} & set(hashes["restrictedNames"]))

    def test_model_broker_pins_exact_read_only_profile(self):
        self.assertIn(
            'const expectedToolHash = runtime === "sandy-agent-runtime-v4" && readOnlyAssessment',
            self.broker,
        )
        self.assertIn(
            '? v4RuntimeConversationSource.readOnlyToolSchemaSha256 : profiles[runtime].tools;',
            self.broker,
        )
        self.assertIn(
            'await sha256(stable(firstRequest.tools)) !== expectedToolHash',
            self.broker,
        )
        self.assertIn(
            'task.customerId === null ? firstRequest.tools.length !== 0',
            self.broker,
        )
        self.assertIn('if (!isRuntimeConversationTask(task))', self.broker)
        self.assertIn('runtime_conversation_tool_profile_invalid', self.broker)
        self.assertIn(
            'bind(task, "sandy-agent-runtime-v4", firstRequest, readOnlyAssessment)',
            self.broker,
        )
        self.assertIn('agent.runtime.conversation.respond', (
            ROOT / "supabase/functions/_shared/sandy-agent-operations/runtime_conversation_contract.ts"
        ).read_text())

    def test_qa_channel_is_server_narrowed_not_customer_selected_tools(self):
        self.assertIn(
            'const readOnlyAssessment=channel==="test"||input.execution_mode==="read_only_assessment";',
            self.v4,
        )
        self.assertIn(
            'const allowed=readOnlyAssessment?offered.filter(t=>readOnlyNames.includes(t.name)):offered;',
            self.v4,
        )
        self.assertIn(
            'conversation=await bindV4RuntimeConversation(task,body,readOnlyAssessment);',
            self.v4,
        )
        self.assertIn('const runtimeProof=await authenticateRuntime(req,db,key);', self.v4)
        self.assertIn('const operationPrincipal=customerId?await bindRuntimeTask(', self.v4)
        self.assertIn('await bindRuntimeConversationTask(runtimeProof,db,', self.v4)
        self.assertNotIn('tools:offered,', self.v4)


if __name__ == "__main__":
    unittest.main()
