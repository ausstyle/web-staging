import json
import unittest
from check_computer_access import canonical_read_result


def response():
    payload = {"executed": True, "provider_http_status": 200,
               "result": {"id": "6831598645020395570", "name": "sandy-video", "status": "RUNNING"}}
    api = {"ok": True, "executed": True,
           "admission_id": "9cc15888-c779-4677-be38-02d2626203ad", "result": payload}
    return {"result": {"isError": False, "structuredContent": payload,
                       "content": [{"text": json.dumps({"status": 200, "result": api})}]}}


class CanonicalComputerReadEvidenceTests(unittest.TestCase):
    def test_provider_identity_and_durable_admission_are_required_not_http_success_alone(self):
        self.assertTrue(canonical_read_result(200, response())["passed"])
        for field, value in [("provider_http_status", None), ("executed", False)]:
            item = response()
            item["result"]["structuredContent"][field] = value
            self.assertFalse(canonical_read_result(200, item)["passed"])
        for field, value in [("id", "8120150462304566315"), ("name", "sandy-windows")]:
            item = response()
            item["result"]["structuredContent"]["result"][field] = value
            self.assertFalse(canonical_read_result(200, item)["passed"])

    def test_mcp_error_failed_api_or_missing_admission_never_passes(self):
        item = response()
        item["result"]["isError"] = True
        self.assertFalse(canonical_read_result(200, item)["passed"])
        for patch in [{"ok": False}, {"executed": False}, {"admission_id": None}, {"admission_id": "invalid"}]:
            item = response()
            envelope = json.loads(item["result"]["content"][0]["text"])
            envelope["result"].update(patch)
            item["result"]["content"][0]["text"] = json.dumps(envelope)
            self.assertFalse(canonical_read_result(200, item)["passed"])
        self.assertFalse(canonical_read_result(502, response())["passed"])

    def test_malformed_or_private_error_payload_is_not_printed_as_evidence(self):
        for item in [{}, None, {"result": {"content": []}}]:
            self.assertFalse(canonical_read_result(200, item)["passed"])
        item = response()
        envelope = json.loads(item["result"]["content"][0]["text"])
        envelope["result"].update({"ok": False, "error": "Bearer private-credential"})
        item["result"]["content"][0]["text"] = json.dumps(envelope)
        proof = canonical_read_result(200, item)
        self.assertFalse(proof["passed"])
        self.assertNotIn("private-credential", json.dumps(proof))


if __name__ == "__main__":
    unittest.main()
