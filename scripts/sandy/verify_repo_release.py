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

def main():
    if os.environ.get("GITHUB_REPOSITORY")!=REPO:
        raise RuntimeError("Unexpected repository")
    sha=os.environ.get("SANDY_MAIN_SHA","")
    ci=os.environ.get("SANDY_CI_RUN_ID","")
    if not re.fullmatch(r"[a-f0-9]{40}",sha) or not re.fullmatch(r"[1-9][0-9]{4,19}",ci):
        raise RuntimeError("Invalid commit or CI run ID")
    api_headers={"authorization":"Bearer "+os.environ["GH_TOKEN"],
                 "accept":"application/vnd.github+json",
                 "user-agent":"sandy-repository-release"}
    pulls=get_json(f"https://api.github.com/repos/{REPO}/commits/{sha}/pulls?per_page=20",api_headers)
    target=find_repo_only_issue(pulls)
    if target is None:
        print("No uniquely associated repository-only PR; no verification recorded")
        return
    pr_number,issue_number=target
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

if __name__=="__main__":
    main()
