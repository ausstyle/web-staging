#!/usr/bin/env python3
"""Fail-closed independent gate for unattended, NON-executable Sandy improvements.

Only add-only tests and non-executable documentation qualify. Production code,
workflow files, integration secrets, deletions and core safety controls do not.
"""
import json
import os
import re
import subprocess

REPO="ausstyle/web-staging"
RUN_TITLE=re.compile(r"^Sandy engineering issue #([1-9][0-9]{0,5})$")
HEX=re.compile(r"^[a-f0-9]{40}$")
BOT="github-actions[bot]"

def allowed_file(file):
    path=file.get("filename","")
    if not isinstance(path,str) or not 0<=file.get("deletions",-1)==0:
        return False
    if type(file.get("additions")) is not int or not 1<=file["additions"]<=120:
        return False
    if file.get("status")=="added" and re.fullmatch(r"scripts/sandy/test_[a-z0-9_]+\.py",path):
        return True
    if file.get("status") in ("added","modified") and re.fullmatch(r"docs/sandy/[a-z0-9_./-]+\.md",path):
        return "/../" not in "/"+path and "//" not in path
    return False

def eligible(run,issue,pr,files):
    m=RUN_TITLE.fullmatch(str(run.get("display_title","")))
    if not m or run.get("conclusion")!="success" or run.get("status")!="completed":
        return False
    number=int(m.group(1))
    branch=f"sandy/codex-issue-{number}-{run.get('id')}"
    labels={x.get("name") for x in issue.get("labels",[]) if isinstance(x,dict)}
    if issue.get("number")!=number or issue.get("state")!="open" or (
        "sandy-autonomous-ready" not in labels or "sandy-autonomous-paused" in labels or
        "sandy-autonomous-blocked" in labels or
        "<!-- sandy-repo-only-engineering -->" not in (issue.get("body") or "")
    ):
        return False
    if pr.get("state")!="open" or pr.get("draft") is not True or (
        pr.get("user",{}).get("login")!=BOT or pr.get("base",{}).get("ref")!="main" or
        pr.get("head",{}).get("ref")!=branch or
        pr.get("head",{}).get("repo",{}).get("full_name")!=REPO or
        not HEX.fullmatch(str(pr.get("head",{}).get("sha","")))
    ):
        return False
    if not re.search(r"\bReferences\s+#"+str(number)+r"\b",pr.get("body") or "",re.I):
        return False
    if not isinstance(files,list) or not 1<=len(files)<=3:
        return False
    if sum(f.get("additions",0) for f in files)>200 or not all(allowed_file(f) for f in files):
        return False
    return True

def gh(path):
    result=subprocess.run(["gh","api",f"repos/{REPO}/{path}"],
                          capture_output=True,text=True,check=True)
    return json.loads(result.stdout)

def get_evidence(run_id):
    run=gh(f"actions/runs/{run_id}")
    m=RUN_TITLE.fullmatch(str(run.get("display_title","")))
    if not m or run.get("conclusion")!="success" or run.get("head_branch")!="main":
        return None
    n=int(m.group(1))
    issue=gh(f"issues/{n}")
    head=f"ausstyle:sandy/codex-issue-{n}-{run_id}"
    prs=gh(f"pulls?state=open&head={head}&per_page=10")
    if not isinstance(prs,list) or len(prs)!=1:
        return None
    pr=gh(f"pulls/{prs[0]['number']}")
    files=gh(f"pulls/{pr['number']}/files?per_page=10")
    if not eligible(run,issue,pr,files):
        return None
    return {"issue_number":n,"pr_number":pr["number"],"head_sha":pr["head"]["sha"]}

def main():
    if os.environ.get("GITHUB_REPOSITORY")!=REPO:
        raise SystemExit("Wrong repository")
    run=os.environ.get("SANDY_ENGINEER_RUN_ID","")
    if not re.fullmatch(r"[1-9][0-9]{4,19}",run):
        raise SystemExit("Wrong engineering run")
    evidence=get_evidence(run)
    if not evidence:
        print("No strictly eligible autonomous docs/tests PR; no merge")
        return
    f=os.environ.get("GITHUB_OUTPUT")
    if f:
        with open(f,"a",encoding="utf-8") as out:
            out.write("eligible=true\n")
            for name,value in evidence.items():
                out.write(f"{name}={value}\n")
    print("Validated strictly safe, repository-only additive improvement")


if __name__=="__main__":
    main()
