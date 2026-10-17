import http.client
import io
import json
import os
import unittest
import urllib.error
from contextlib import contextmanager
import run_feature_discovery as runner
from run_feature_discovery import verify_response,validate_pending,clean_for_public_issue,issue_for
from unittest.mock import patch
from pathlib import Path


class FeatureDiscoveryRunnerTests(unittest.TestCase):
    @staticmethod
    def issue_page(start=1):
        return [{"number":number,"body":None} for number in range(start,start+100)]

    @staticmethod
    def proposal(key="unified_task_insights"):
        return {"key":key,"problem":"Repeated users need faster verified task execution",
                "ideal":"A single task interface that shows verified execution receipts",
                "risk":"low","priority":87}

    @staticmethod
    def listing(page):
        return ("GET", "issues?state=all&per_page=100&sort=created&direction=asc&page="+str(page))

    @contextmanager
    def mocked_runner(self, responses, pending=None, event="schedule"):
        outcome={"ok":True,"created":1,"pending":pending or [self.proposal()]}
        env={"GITHUB_REPOSITORY":"ausstyle/web-staging","GITHUB_EVENT_NAME":event,
             "ACTIONS_ID_TOKEN_REQUEST_URL":"https://issuer.invalid/token",
             "ACTIONS_ID_TOKEN_REQUEST_TOKEN":"synthetic-token"}
        with (patch.dict(os.environ,env,clear=True),
              patch.object(runner.urllib.request,"urlopen",side_effect=[
                  io.StringIO(json.dumps({"value":"synthetic-assertion"})),
                  io.StringIO(json.dumps(outcome))]),
              patch.object(runner,"github",side_effect=responses) as api,
              patch.object(runner,"acknowledge") as ack,
              patch("builtins.print")):
            yield api,ack

    def test_later_closed_issue_reused_after_complete_scan(self):
        for page_number in (2,3):
            with self.subTest(page=page_number):
                pages=[self.issue_page(1+100*i) for i in range(page_number-1)]
                pages.append([{"number":301,"state":"closed",
                               "body":"<!-- sandy-feature-key:unified_task_insights -->"}])
                with self.mocked_runner(pages) as (api,ack):
                    runner.main()
                    self.assertEqual([call.args for call in api.call_args_list],
                                     [self.listing(i) for i in range(1,page_number+1)])
                    ack.assert_called_once_with("synthetic-assertion",self.proposal(),301)

    def test_completed_scan_shared_and_new_issue_reused(self):
        proposals=[self.proposal(),self.proposal(),self.proposal("verified_task_receipts")]
        created=[{"number":201,"body":"<!-- sandy-feature-key:unified_task_insights -->"},
                 {"number":202,"body":"<!-- sandy-feature-key:verified_task_receipts -->"}]
        with self.mocked_runner([[],*created],pending=proposals) as (api,ack):
            runner.main()
            self.assertEqual(api.call_args_list[0].args,self.listing(1))
            self.assertEqual([call.args[:2] for call in api.call_args_list[1:]],
                             [("POST","issues"),("POST","issues")])
            self.assertEqual([call.args[2] for call in ack.call_args_list],[201,201,202])

    def test_empty_terminal_page_required_before_creation(self):
        with self.mocked_runner([self.issue_page(),[],{"number":101,"body":"created"}]) as (api,ack):
            runner.main()
            self.assertEqual([call.args for call in api.call_args_list[:2]],
                             [self.listing(1),self.listing(2)])
            self.assertEqual(api.call_args_list[2].args[:2],("POST","issues"))
            self.assertEqual(ack.call_args.args[2],101)

    def test_pull_requests_count_toward_page_size_but_cannot_match(self):
        page=self.issue_page()
        for issue in page:
            issue.update(pull_request={"url":"https://example.invalid/pr"},
                         body="<!-- sandy-feature-key:unified_task_insights -->")
        with self.mocked_runner([page,[],{"number":101,"body":"created"}]) as (api,ack):
            runner.main()
            self.assertEqual(api.call_args_list[1].args,self.listing(2))
            self.assertEqual(api.call_args_list[2].args[:2],("POST","issues"))
            self.assertEqual(ack.call_args.args[2],101)

    def test_later_page_failure_prevents_all_publication(self):
        failures=[
            urllib.error.HTTPError("https://example.invalid/private",429,"private",{},None),
            urllib.error.HTTPError("https://example.invalid/private",500,"private",{},None),
            urllib.error.URLError("private connection details"),
            ConnectionError("private connection details"),
            TimeoutError("private timeout details"),
            http.client.IncompleteRead(b"private response"),
            json.JSONDecodeError("private response","private",0),
            UnicodeDecodeError("utf-8",b"\xff",0,1,"private response"),
            {"message":"private response"},
            [None],
            [{"number":0,"body":None}],
            [{"number":-1,"body":None}],
            [{"number":True,"body":None}],
            [{"number":"101","body":None}],
            [{"body":None}],
            [{"number":101}],
            [{"number":101,"body":{}}],
            [{"number":1,"body":None}],
            [{"number":101,"body":None}]*2,
            self.issue_page(101)+[{"number":201,"body":None}],
        ]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                page=self.issue_page()
                page[0]["body"]="<!-- sandy-feature-key:unified_task_insights -->"
                with self.mocked_runner([page,failure]) as (api,ack):
                    with self.assertRaises(RuntimeError) as caught:
                        runner.main()
                    self.assertEqual(str(caught.exception),
                                     "GitHub issue inventory could not be completed")
                    self.assertTrue(caught.exception.__suppress_context__)
                    self.assertEqual([call.args for call in api.call_args_list],
                                     [self.listing(1),self.listing(2)])
                    ack.assert_not_called()

    def test_five_full_pages_fail_even_with_existing_match(self):
        pages=[self.issue_page(1+100*i) for i in range(5)]
        pages[0][0]["body"]="<!-- sandy-feature-key:unified_task_insights -->"
        with self.mocked_runner(pages) as (api,ack):
            with self.assertRaisesRegex(RuntimeError,"^GitHub issue inventory could not be completed$"):
                runner.main()
            self.assertEqual([call.args for call in api.call_args_list],
                             [self.listing(i) for i in range(1,6)])
            ack.assert_not_called()

    def test_short_fifth_page_completes_inventory(self):
        pages=[self.issue_page(1+100*i) for i in range(4)]
        pages.append([{"number":401,"body":"<!-- sandy-feature-key:unified_task_insights -->"}])
        with self.mocked_runner(pages) as (api,ack):
            runner.main()
            self.assertEqual(api.call_count,5)
            self.assertEqual(ack.call_args.args[2],401)

    def test_push_smoke_skips_github_and_acknowledgement(self):
        with self.mocked_runner([],event="push") as (api,ack):
            runner.main()
            api.assert_not_called()
            ack.assert_not_called()

    def test_success_is_only_a_proposal(self):
        self.assertEqual(verify_response({"ok": True, "created": 1, "assessed": 25}),
                         {"assessed": 25, "created": 1, "proposed_not_deployed": True})

    def test_missing_success_rejected(self):
        with self.assertRaises(RuntimeError):
            verify_response({"status": "queued"})
        with self.assertRaises(RuntimeError):
            verify_response({"ok": False, "created": 0})

    def test_impossible_count_rejected(self):
        with self.assertRaises(RuntimeError):
            verify_response({"ok": True, "created": 99})


    def test_public_issue_redacts_private_identifiers(self):
        scrubbed=clean_for_public_issue("Email bob@example.com URL https://example.com/private account 00000000-0000-0000-0000-000000000000")
        self.assertNotIn("bob@example.com",scrubbed)
        self.assertNotIn("https://example.com/private",scrubbed)
        self.assertNotIn("00000000-0000-0000-0000-000000000000",scrubbed)

    def test_pending_requires_proper_evidence_shape(self):
        self.assertIsNone(validate_pending({"key":"bad"}))
        good={"key":"unified_task_insights","problem":"Repeated users need faster verified task execution",
              "ideal":"A single task interface that shows verified execution receipts",
              "risk":"low","priority":87}
        self.assertEqual(validate_pending(good)["key"],"unified_task_insights")

    def test_issue_creation_idempotent_and_gated(self):
        item=validate_pending({"key":"unified_task_insights",
              "problem":"Repeated users need faster verified task execution",
              "ideal":"A single task interface that shows verified execution receipts",
              "risk":"low","priority":87})
        prior=[{"number":9,"body":"<!-- sandy-feature-key:unified_task_insights -->"}]
        with patch("run_feature_discovery.github") as api:
            self.assertEqual(issue_for(item,prior),9)
            api.assert_not_called()
        with patch("run_feature_discovery.github",return_value={"number":11,"body":"ok"}) as api:
            self.assertEqual(issue_for(item,[]),11)
            self.assertIn("sandy-autonomous-ready",api.call_args.args[2]["labels"])

    def test_smoke_reruns_on_runner_changes_and_reports_safely(self):
        root=Path(__file__).resolve().parents[2]
        runner=(root/"scripts/sandy/run_feature_discovery.py").read_text()
        workflow=(root/".github/workflows/sandy-feature-discovery.yml").read_text()
        self.assertIn("scripts/sandy/run_feature_discovery.py",workflow)
        self.assertIn("except urllib.error.HTTPError as error:",runner)
        self.assertIn("reason=\"unclassified\"",runner)

    def test_push_smoke_never_publishes_public_issue(self):
        worker=(Path(__file__).resolve().parents[2] /
                "scripts/sandy/run_feature_discovery.py").read_text()
        workflow=(Path(__file__).resolve().parents[2] /
                  ".github/workflows/sandy-feature-discovery.yml").read_text()
        self.assertIn('GITHUB_EVENT_NAME")=="push"',worker)
        self.assertIn('"github_publication":False',worker)
        self.assertIn("paths:",workflow)
        self.assertIn("'.github/workflows/sandy-feature-discovery.yml'",workflow)


if __name__=="__main__":
    unittest.main()
