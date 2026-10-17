import io
import json
import unittest
from unittest.mock import call, patch

import run_feature_discovery as runner


PENDING = {
    "key": "synthetic_feature",
    "problem": "Synthetic users need a clear view of pending tasks.",
    "ideal": "Show synthetic pending tasks in a single clear view.",
    "risk": "low",
    "priority": 85,
}
FULL_PAGE = [{"number": number, "body": ""} for number in range(1, 101)]


def get_calls(count):
    return [call("GET", f"issues?state=all&per_page=100&page={page}")
            for page in range(1, count + 1)]


class FeatureDiscoveryPaginationBoundariesTests(unittest.TestCase):
    def assert_scan_blocks_publication(self, pages, message, count=2):
        responses = [io.BytesIO(json.dumps(data).encode()) for data in (
            {"value": "synthetic-assertion"},
            {"ok": True, "created": 1, "pending": [PENDING]},
        )]
        environment = {
            "GITHUB_REPOSITORY": "ausstyle/web-staging",
            "GITHUB_EVENT_NAME": "schedule",
            "ACTIONS_ID_TOKEN_REQUEST_URL": "https://oidc.invalid/token",
            "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "synthetic-request-token",
        }
        with patch.dict(runner.os.environ, environment, clear=True), \
                patch.object(runner.urllib.request, "urlopen", side_effect=responses) as http, \
                patch.object(runner, "github", side_effect=pages) as api, \
                patch.object(runner, "acknowledge") as acknowledge:
            with self.assertRaisesRegex(RuntimeError, message) as raised:
                runner.main()
            self.assertEqual(api.mock_calls, get_calls(count))
            self.assertEqual(http.call_count, 2)
            acknowledge.assert_not_called()
        return raised.exception

    def test_exactly_one_full_page_requires_empty_second_page(self):
        with patch.object(runner, "github", side_effect=[FULL_PAGE, []]) as api:
            self.assertEqual(runner.load_all_existing_issues(), FULL_PAGE)
            self.assertEqual(api.mock_calls, get_calls(2))

    def test_second_page_api_error_propagates_before_publication(self):
        error = RuntimeError("synthetic API failure")
        self.assertIs(self.assert_scan_blocks_publication(
            [FULL_PAGE, error], "synthetic API failure"), error)

    def test_malformed_second_page_blocks_publication(self):
        for malformed, message in (
            ({"items": []}, "Incomplete GitHub issues response"),
            ([None], "Malformed GitHub issue list"),
            ([{"body": "synthetic"}], "Malformed GitHub issue list"),
            ([{"number": "101"}], "Malformed GitHub issue list"),
        ):
            with self.subTest(response=malformed):
                self.assert_scan_blocks_publication([FULL_PAGE, malformed], message)

    def test_pr_marker_does_not_replace_matching_real_issue(self):
        marker = "<!-- sandy-feature-key:synthetic_feature -->"
        pull_request = {"number": 201, "body": marker,
                        "pull_request": {"url": "https://github.invalid/pulls/201"}}
        issue = {"number": 202, "body": marker}
        with patch.object(runner, "github", return_value=issue) as api:
            self.assertEqual(runner.issue_for(PENDING, [pull_request]), 202)
            api.assert_called_once_with("POST", "issues", unittest.mock.ANY)
        with patch.object(runner, "github") as api:
            self.assertEqual(runner.issue_for(PENDING, [pull_request, issue]), 202)
            api.assert_not_called()

    def test_twelve_full_pages_exhaust_cap_before_publication(self):
        self.assert_scan_blocks_publication(
            [FULL_PAGE] * 12, "GitHub issues exceed bounded scan", count=12)


if __name__ == "__main__":
    unittest.main()
