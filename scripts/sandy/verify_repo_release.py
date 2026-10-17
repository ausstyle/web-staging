#!/usr/bin/env python3
"""Verify an already merged repository-only PR after passing main-branch CI.

Does not deploy or grant production approval. The Supabase receiver independently
validates PR scope, issue marker, merge SHA and GitHub CI outcome.
"""
import json
import os
import re
import urllib.parse
import urllib.request

REPO="ausstyle/web-staging"
AUDIENCE="sandy-repository-release-zmqlyygzqoidkcwdysok"
ENDPOINT="https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-repository-release-verifier"
ISSUE=re.compile(r"(?:close[sd]?|fix(?:e[sd])?|references?)\s+#([1-9][0-9]{0,5})\b",re.I)

def find_repo_only_issue(pulls):
    """Do not attempt to verify unrelated or ambiguous PRs."""
    found=[]
    for pr in pulls:
        if not isinstance(pr,dict) or pr.get("merged_at") is None:
            continue
        if not isinstance(pr.get("number"),int):
            continue
        body=pr.get("body") or ""
        markers=set(ISSUE.findall(body))
        if len(markers)!=1:
            continue
        found.append((pr["number"],int(next(iter(markers)))))
    if len(found)!=1:
        return None
    return found[0]

def get_json(url,headers):
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=20) as r:
        return json.load(r)


def completed_main_runs(payload, limit=12):
    """Bounded, GitHub-proven successful main CI candidates; never infer a release."""
    if not isinstance(payload,dict) or not isinstance(payload.get("workflow_runs"),list):
        raise RuntimeError("Malformed GitHub workflow-run listing")
    runs=[]
    for run in payload["workflow_runs"]:
        if not isinstance(run,dict):
            raise RuntimeError("Malformed workflow-run entry")
        if (run.get("event")!="workflow_dispatch" or run.get("head_branch")!="main"
                or run.get("status")!="completed" or run.get("conclusion")!="success"
                or run.get("path")!=".github/workflows/sandy-regression-checks.yml"):
            continue
        if (type(run.get("id")) is not int or run["id"]<=0 or
                not re.fullmatch(r"[a-f0-9]{40}",str(run.get("head_sha","")))):
            raise RuntimeError("Malformed successful main workflow evidence")
        runs.append((run["head_sha"],run["id"]))
        if len(runs)>=limit:
            break
    return runs


def verify_ci_candidate(sha,ci,api_headers):
    pulls=get_json(f"https://api.github.com/repos/{REPO}/commits/{sha}/pulls?per_page=20",api_headers)
    target=find_repo_only_issue(pulls)
    if target is None:
        return False
    pr_number,issue_number=target
    details=get_json(f"https://api.github.com/repos/{REPO}/pulls/{pr_number}",api_headers)
    if (not isinstance(details,dict)
        or details.get("user",{}).get("login")!="github-actions[bot]"
        or not re.fullmatch(r"sandy/codex-issue-"+str(issue_number)+r"-[0-9]{5,20}",
                            str(details.get("head",{}).get("ref","")))):
        return False
    issue=get_json(f"https://api.github.com/repos/{REPO}/issues/{issue_number}",api_headers)
    if (not isinstance(issue,dict) or issue.get("repository_url")!=f"https://api.github.com/repos/{REPO}"
            or "<!-- sandy-repo-only-engineering -->" not in str(issue.get("body") or "")):
        return False
    token_url=os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    separator="&" if "?" in token_url else "?"
    assertion=get_json(token_url+separator+urllib.parse.urlencode({"audience":AUDIENCE}),
          {"Authorization":"Bearer "+os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})["value"]
    payload=json.dumps({"ci_run_id":int(ci),"pr_number":pr_number,"issue_number":issue_number}).encode()
    request=urllib.request.Request(ENDPOINT,method="POST",data=payload,
          headers={"authorization":"Bearer "+assertion,"content-type":"application/json"})
    with urllib.request.urlopen(request,timeout=30) as response:
        result=json.load(response)
    if result.get("ok") is not True or result.get("scope")!="repository_only":
        raise RuntimeError("Repository release not independently verified")
    print(json.dumps({"issue":issue_number,"pr":pr_number,
                      "repo_only_ci_verified":True,"production_verified":False}))
    return True


def main():
    if os.environ.get("GITHUB_REPOSITORY")!=REPO:
        raise RuntimeError("Unexpected repository")
    sha=os.environ.get("SANDY_MAIN_SHA","")
    ci=os.environ.get("SANDY_CI_RUN_ID","")
    if os.environ.get("SANDY_RELEASE_SCAN")!="1" and (not re.fullmatch(r"[a-f0-9]{40}",sha) or not re.fullmatch(r"[1-9][0-9]{4,19}",ci)):
        raise RuntimeError("Invalid commit or CI run ID")
    api_headers={"authorization":"Bearer "+os.environ["GH_TOKEN"],
                 "accept":"application/vnd.github+json",
                 "user-agent":"sandy-repository-release"}
    if os.environ.get("SANDY_RELEASE_SCAN")=="1":
        listing=get_json(
            f"https://api.github.com/repos/{REPO}/actions/workflows/sandy-regression-checks.yml/runs?branch=main&event=workflow_dispatch&status=completed&per_page=30",
            api_headers)
        candidates=completed_main_runs(listing)
        for candidate_sha,candidate_ci in candidates:
            verify_ci_candidate(candidate_sha,candidate_ci,api_headers)
        print(json.dumps({"scanned_main_ci_runs":len(candidates),"production_verified":False}))
        return
    verify_ci_candidate(sha,ci,api_headers)

if __name__=="__main__":
    main()
