import http.client
import io
import json
import unittest
import urllib.error
from contextlib import contextmanager, redirect_stdout
from run_feature_discovery import verify_response,validate_pending,clean_for_public_issue,issue_for,main
from unittest.mock import patch
from pathlib import Path


class FeatureDiscoveryRunnerTests(unittest.TestCase):
    proposal={"key":"unified_task_insights",
              "problem":"Repeated users need faster verified task execution",
              "ideal":"A single task interface that shows verified execution receipts",
              "risk":"low","priority":87}
    marker="<!-- sandy-feature-key:unified_task_insights -->"

    @staticmethod
    def page(start=1):
        return [{"number":number,"body":None} for number in range(start,start+100)]

    @contextmanager
    def execution(self, responses, pending=None, event="schedule"):
        outcome={"ok":True,"created":1,"pending":
                 [self.proposal] if pending is None else pending}
        env={"GITHUB_REPOSITORY":"ausstyle/web-staging","GITHUB_EVENT_NAME":event,
             "ACTIONS_ID_TOKEN_REQUEST_URL":"https://issuer.invalid/token",
             "ACTIONS_ID_TOKEN_REQUEST_TOKEN":"test-token"}
        replies=[io.BytesIO(json.dumps(value).encode())
                 for value in ({"value":"test-assertion"},outcome)]
        with patch.dict("os.environ",env), \
             patch("run_feature_discovery.urllib.request.urlopen",side_effect=replies) as network, \
             patch("run_feature_discovery.github",side_effect=responses) as api, \
             patch("run_feature_discovery.acknowledge") as ack, \
             redirect_stdout(io.StringIO()):
            yield api,ack,network

    def assert_listing_calls(self, api, count):
        self.assertEqual(api.call_count,count)
        for page,request in enumerate(api.call_args_list,1):
            self.assertEqual(request.args,("GET",
                f"issues?state=all&per_page=100&sort=created&direction=asc&page={page}"))

    def assert_scan_fails(self, responses, count):
        with self.execution(responses) as (api,ack,network):
            with self.assertRaises(RuntimeError) as failure:
                main()
            self.assertNotIn("private-detail",str(failure.exception))
            self.assert_listing_calls(api,count)
            ack.assert_not_called()
            self.assertEqual(network.call_count,2)

    def test_page_two_closed_issue_reused_and_pull_request_ignored(self):
        first=self.page()
        first[0].update(body=self.marker,pull_request={})
        second=[{"number":101,"body":self.marker,"state":"closed"}]
        with self.execution([first,second]) as (api,ack,_):
            main()
            self.assert_listing_calls(api,2)
            self.assertEqual(ack.call_args.args[2],101)
            ack.assert_called_once()

    def test_completed_scan_creates_once_for_repeated_pending_key(self):
        created={"number":102,"body":self.marker}
        with self.execution([self.page(),[],created],
                            pending=[self.proposal,self.proposal]) as (api,ack,_):
            main()
            self.assertEqual([call.args[0] for call in api.call_args_list],["GET","GET","POST"])
            self.assertEqual(api.call_args.args[1],"issues")
            self.assertEqual(ack.call_count,2)
            self.assertEqual([call.args[2] for call in ack.call_args_list],[102,102])

    def test_exactly_one_full_page_requires_empty_next_page(self):
        with self.execution([self.page(),[]],pending=[]) as (api,ack,_):
            main()
            self.assert_listing_calls(api,2)
            ack.assert_not_called()

    def test_listing_failures_never_publish_or_acknowledge(self):
        failures=[urllib.error.HTTPError("https://api.invalid",403,"private-detail",{},None),
                  urllib.error.URLError("private-detail"),TimeoutError("private-detail"),
                  OSError("private-detail"),
                  http.client.IncompleteRead(b"private-detail"),
                  json.JSONDecodeError("private-detail","",0),
                  UnicodeDecodeError("utf-8",b"\xff",0,1,"private-detail")]
        for failure in failures:
            for later_page in (False,True):
                with self.subTest(failure=type(failure).__name__,later_page=later_page):
                    first=self.page()
                    first[0]["body"]=self.marker
                    responses=[first,failure] if later_page else [failure]
                    self.assert_scan_fails(responses,2 if later_page else 1)

    def test_malformed_pages_fail_closed(self):
        malformed=[None,{},"private-detail",self.page()+[{"number":101,"body":None}],
                   [None],["private-detail"],[{}],[{"number":1}],
                   [{"number":1,"body":42}]]
        malformed.extend([[{"number":number,"body":None}]
                          for number in (None,True,False,0,-1,1.5,"1")])
        for batch in malformed:
            for later_page in (False,True):
                with self.subTest(batch=batch,later_page=later_page):
                    responses=[self.page(),batch] if later_page else [batch]
                    self.assert_scan_fails(responses,2 if later_page else 1)

    def test_repeated_issue_numbers_fail_closed(self):
        duplicate={"number":1,"body":None}
        self.assert_scan_fails([[duplicate,duplicate]],1)
        self.assert_scan_fails([self.page(),[duplicate]],2)

    def test_five_full_pages_fail_even_with_an_early_match(self):
        pages=[self.page(start) for start in range(1,501,100)]
        pages[0][0]["body"]=self.marker
        self.assert_scan_fails(pages,5)

    def test_push_smoke_skips_github_and_acknowledgement(self):
        with self.execution([],event="push") as (api,ack,network):
            main()
            api.assert_not_called()
            ack.assert_not_called()
            self.assertEqual(network.call_count,2)

    def test_marker_must_match_exact_key(self):
        prior=[{"number":9,"body":"<!-- sandy-feature-key:unified_task_insights_extra -->"}]
        with patch("run_feature_discovery.github",
                   return_value={"number":10,"body":self.marker}) as api:
            self.assertEqual(issue_for(self.proposal,prior),10)
            self.assertEqual(api.call_args.args[0],"POST")

    def test_publication_validation_and_five_proposal_limit_preserved(self):
        with self.execution([[]],pending=[{"key":"bad"}]) as (api,ack,_):
            with self.assertRaisesRegex(RuntimeError,"Unsafe feature proposal"):
                main()
            self.assert_listing_calls(api,1)
            ack.assert_not_called()
        with self.execution([[{"number":1,"body":self.marker}]],
                            pending=[self.proposal]*6) as (api,ack,_):
            main()
            self.assert_listing_calls(api,1)
            self.assertEqual(ack.call_count,5)

    def test_only_high_priority_low_risk_proposals_receive_label(self):
        for risk,priority,labels in (("low",80,["sandy-autonomous-ready"]),
                                     ("low",79,[]),("medium",99,[]),("high",99,[])):
            with self.subTest(risk=risk,priority=priority):
                item={**self.proposal,"risk":risk,"priority":priority}
                with patch("run_feature_discovery.github",
                           return_value={"number":1,"body":self.marker}) as api:
                    issue_for(item,[])
                    self.assertEqual(api.call_args.args[2]["labels"],labels)

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
