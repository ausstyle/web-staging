import unittest
import copy
import io
import json
import os
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch
import observe_architect_run as observer
from observe_architect_run import describe

class ObserverTests(unittest.TestCase):
    def test_blocked_run_never_reports_success(self):
        issue,detail=describe("Sandy engineering issue #1","DECISION: BLOCKED",None)
        self.assertEqual(issue,"1")
        self.assertIn("blocked",detail.lower())
    def test_ready_without_engineer_pr_is_incomplete(self):
        issue,detail=describe("Sandy engineering issue #1","DECISION: READY",None)
        self.assertEqual(issue,"1")
        self.assertIn("incomplete",detail)
    def test_ready_with_pr_requires_review(self):
        issue,detail=describe("Sandy engineering issue #1","DECISION: READY",{"number":92,"url":"https://github.com/ausstyle/web-staging/pull/92"})
        self.assertIn("review",detail.lower())
    def test_unsafe_run_title_ignored(self):
        self.assertIsNone(describe("Sandy engineering issue #1; echo nope","DECISION: READY",None))


class BranchObservationTests(unittest.TestCase):
    def setUp(self):
        self.run_id="12345678"
        self.title="Sandy engineering issue #51"
        self.branch=f"sandy/codex-issue-51-{self.run_id}"
        self.sha="a"*40
        self.first="DECISION: READY"
        self.prs=[]
        self.pages=[[]]
        self.metadata={"id":int(self.run_id),"display_title":self.title,
                       "repository":{"full_name":observer.REPO},
                       "head_repository":{"full_name":observer.REPO},
                       "head_branch":"main","event":"workflow_dispatch",
                       "path":".github/workflows/sandy-codex-engineering.yml","status":"in_progress"}
        self.ref={"ref":f"refs/heads/{self.branch}",
                  "url":f"https://api.github.com/repos/{observer.REPO}/git/refs/heads/{self.branch}",
                  "object":{"type":"commit","sha":self.sha,
                            "url":f"https://api.github.com/repos/{observer.REPO}/git/commits/{self.sha}"}}
        self.status=200
        self.ref_raw=None
        self.ref_error=None
        self.pr_error=None

    def fake_gh(self,*args,**kwargs):
        if args[:2] == ("run","download"):
            Path(args[args.index("--dir")+1],"sandy-architecture.md").write_text(self.first)
            return subprocess.CompletedProcess(args,0,"","")
        if args[:2] == ("pr","list"):
            if self.pr_error:
                raise self.pr_error
            value=self.prs
        elif f"repos/{observer.REPO}/actions/runs/{self.run_id}" in args:
            value=self.metadata
        elif f"repos/{observer.REPO}/git/ref/heads/{self.branch}" in args:
            if self.ref_error:
                raise self.ref_error
            raw=self.ref_raw if self.ref_raw is not None else json.dumps(self.ref)
            return subprocess.CompletedProcess(args,int(self.status != 200),
                f"HTTP/2.0 {self.status} Status\r\nContent-Type: application/json\r\n\r\n{raw}","SECRET stderr")
        elif "--paginate" in args:
            value=self.pages
        else:
            value={}
        return subprocess.CompletedProcess(args,0,json.dumps(value),"")

    def observe(self,env=None):
        with tempfile.TemporaryDirectory() as tmp:
            outcome=Path(tmp)/"outcome.json"
            variables={"ARCHITECT_RUN_ID":self.run_id,"ARCHITECT_RUN_TITLE":self.title,
                       "SANDY_OUTCOME_FILE":str(outcome)}
            variables.update(env or {})
            with patch.dict(os.environ,variables,clear=True), \
                    patch.object(observer,"gh",side_effect=self.fake_gh) as calls, \
                    patch("sys.stdout",new_callable=io.StringIO) as output:
                observer.main()
            payload=json.loads(outcome.read_text()) if outcome.exists() else None
        writes=[c.args for c in calls.call_args_list
                if c.args[:2] == ("issue","comment") or "PATCH" in c.args]
        body=""
        if writes:
            args=writes[0]
            body=args[args.index("--body")+1] if "--body" in args else args[-1].removeprefix("body=")
        return body,payload,calls,writes,output.getvalue()

    def test_verified_branch_and_unchanged_payload(self):
        for status in ("in_progress","completed"):
            with self.subTest(status=status):
                self.metadata["status"]=status
                body,payload,calls,_,_=self.observe()
                self.assertIn("Engineer code pushed; PR publication blocked or pending",body)
                self.assertIn(f"https://github.com/{observer.REPO}/tree/{self.branch}",body)
                self.assertIn(f"https://github.com/{observer.REPO}/actions/runs/{self.run_id}",body)
                self.assertIn(self.sha,body)
                self.assertIn("publish a draft PR through an authorized process",body)
                self.assertNotIn("incomplete",body)
                self.assertEqual(payload,{"issue_number":51,"architecture_run_id":self.run_id,
                                          "decision":"READY","pr_number":None})
                calls.assert_any_call("api","--hostname","github.com",
                    f"repos/{observer.REPO}/git/ref/heads/{self.branch}","--include",check=False)

    def test_only_http_404_means_absence(self):
        for status in (404,401,403,429,500):
            with self.subTest(status=status):
                self.status=status
                body,*_=self.observe()
                self.assertIn(observer.INCOMPLETE if status == 404 else observer.UNVERIFIED,body)
                self.assertNotIn("SECRET",body)
                self.assertNotIn("Engineer code pushed",body)

    def test_bad_reference_never_claims_success(self):
        valid=copy.deepcopy(self.ref)
        mutations=[("ref","refs/heads/other"),("ref",f"refs/heads/{self.branch.replace('51','52')}"),
                   ("ref",f"refs/heads/{self.branch}9"),("url",valid["url"].replace("api.github.com","evil.test")),
                   ("url",valid["url"].replace(observer.REPO,"other/repo")),
                   ("object.type","tag"),("object.sha","A"*40),("object.sha","a"*39),
                   ("object.sha",None),("object.url",valid["object"]["url"]+"0"),
                   ("object.url",valid["object"]["url"].replace("api.github.com","evil.test")),
                   ("object.url",valid["object"]["url"].replace(observer.REPO,"other/repo"))]
        for field,value in mutations:
            with self.subTest(field=field,value=value):
                self.ref=copy.deepcopy(valid)
                target,key=(self.ref["object"],field.split(".")[1]) if "." in field else (self.ref,field)
                target[key]=value
                self.assertIn(observer.UNVERIFIED,self.observe()[0])
        for raw in ("{", "[]", "null", '{"object":null}'):
            with self.subTest(raw=raw):
                self.ref_raw=raw
                self.assertIn(observer.UNVERIFIED,self.observe()[0])

    def test_unverified_run_skips_reference(self):
        valid=copy.deepcopy(self.metadata)
        for key,value in (("id",12345679),("display_title","Sandy engineering issue #52"),
                          ("repository",{"full_name":"other/repo"}),("head_repository",None),
                          ("head_branch","feature"),("event","push"),("path","other.yml"),
                          ("status","queued")):
            with self.subTest(key=key):
                self.metadata={**valid,key:value}
                body,_,calls,_,_=self.observe()
                self.assertIn(observer.UNVERIFIED,body)
                self.assertFalse(any("--include" in c.args for c in calls.call_args_list))

    def test_transport_errors_and_stderr_are_not_absence(self):
        for error in (OSError("SECRET"),subprocess.CalledProcessError(1,["gh"],stderr="SECRET HTTP 404")):
            with self.subTest(error=type(error)):
                self.ref_error=error
                body,_,_,_,output=self.observe()
                self.assertIn(observer.UNVERIFIED,body)
                self.assertNotIn("SECRET",body+output)

    def test_fallback_is_skipped_for_other_decisions_or_pr(self):
        for first,prs in (("DECISION: BLOCKED",[]),("untrusted",[]),
                          ("DECISION: READY",[{"number":92,"url":f"https://github.com/{observer.REPO}/pull/92"}])):
            with self.subTest(first=first,prs=prs):
                self.first,self.prs=first,prs
                body,payload,calls,_,_=self.observe()
                self.assertFalse(any(f"repos/{observer.REPO}/actions/runs/{self.run_id}" in c.args
                                     or "--include" in c.args for c in calls.call_args_list))
                if prs:
                    self.assertIn("Human review",body)
                    self.assertEqual(payload["pr_number"],92)

    def test_invalid_identifiers_and_pr_responses_skip_fallback(self):
        for env in ({"ARCHITECT_RUN_ID":"12345;bad"},{"ARCHITECT_RUN_TITLE":"Sandy engineering issue #51;bad"}):
            _,_,calls,writes,_=self.observe(env)
            calls.assert_not_called()
            self.assertFalse(writes)
        for prs in ({},None,[{"number":92,"url":"https://evil.test"}]):
            self.prs=prs
            _,_,calls,writes,_=self.observe()
            self.assertEqual(len(calls.call_args_list),2)
            self.assertFalse(writes)
        self.pr_error=subprocess.CalledProcessError(1,["gh"],stderr="SECRET")
        self.assertFalse(self.observe()[3])

    def test_paginated_bot_comment_upgrade_and_deduplication(self):
        marker=f"<!-- sandy-architect-observation:{self.run_id} -->"
        comment={"id":99,"user":{"login":"github-actions[bot]","type":"Bot"},
                 "body":observer.INCOMPLETE+"\n"+marker}
        self.pages=[[],[comment]]
        body,_,_,writes,_=self.observe()
        self.assertEqual(len(writes),1)
        self.assertIn("PATCH",writes[0])
        self.assertIn(f"repos/{observer.REPO}/issues/comments/99",writes[0])
        comment["body"]=body
        self.assertFalse(self.observe()[3])
        comment["body"]=observer.INCOMPLETE+marker
        self.status=404
        self.assertFalse(self.observe()[3])
        self.status=200
        comment["user"]={"login":"someone","type":"User"}
        self.assertEqual(self.observe()[3][0][:2],("issue","comment"))
