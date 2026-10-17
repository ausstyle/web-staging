#!/usr/bin/env python3
"""Observe completed Architect/Engineer runs without assuming a fix was deployed."""
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

REPO="ausstyle/web-staging"
TITLE=re.compile(r"^Sandy engineering issue #([1-9][0-9]{0,5})$")
INCOMPLETE="Architect READY, but no engineering PR was verified. Implementation remains incomplete."
UNVERIFIED="Engineer branch verification unavailable; inspect the workflow run through an authorized process."

def describe(title, first_line, pr):
    match=TITLE.fullmatch(title)
    if not match:
        return None
    issue=match.group(1)
    if first_line == "DECISION: BLOCKED":
        outcome="Architect blocked: missing evidence; Engineer must not deploy."
    elif first_line == "DECISION: READY" and pr:
        outcome=f"Architect READY. Engineer created draft PR #{pr['number']} ({pr['url']}). Human review and real-world production verification remain required."
    elif first_line == "DECISION: READY":
        outcome=INCOMPLETE
    else:
        outcome="No validated Architect decision artifact; do not treat this run as successful engineering."
    return issue,outcome

def event_payload(title, first_line, run_id, pr):
    """Only verified report first lines can enter the Supabase engineering state machine."""
    match = TITLE.fullmatch(title)
    if not match or first_line not in ("DECISION: READY", "DECISION: BLOCKED"):
        return None
    if not re.fullmatch(r"[0-9]{5,20}", run_id):
        return None
    return {
        "issue_number": int(match.group(1)),
        "architecture_run_id": run_id,
        "decision": first_line.removeprefix("DECISION: "),
        "pr_number": int(pr["number"]) if first_line == "DECISION: READY" and pr else None,
    }

def gh(*args,check=True):
    return subprocess.run(["gh",*args],capture_output=True,text=True,check=check)

def branch_observation(run_id, title, branch):
    """Return only fixed text and validated, repository-scoped reference evidence."""
    try:
        run=json.loads(gh("api","--hostname","github.com",f"repos/{REPO}/actions/runs/{run_id}").stdout)
        if not isinstance(run,dict) or not (
            type(run.get("id")) is int and str(run["id"]) == run_id
            and run.get("display_title") == title
            and run.get("repository",{}).get("full_name") == REPO
            and run.get("head_repository",{}).get("full_name") == REPO
            and run.get("head_branch") == "main"
            and run.get("event") == "workflow_dispatch"
            and run.get("path") == ".github/workflows/sandy-codex-engineering.yml"
            and run.get("status") in ("in_progress","completed")
        ):
            return UNVERIFIED
        result=gh("api","--hostname","github.com",f"repos/{REPO}/git/ref/heads/{branch}","--include",check=False)
        headers,separator,body=result.stdout.replace("\r\n","\n").partition("\n\n")
        status=re.fullmatch(r"HTTP/\S+ ([0-9]{3})(?: [^\n]*)?",headers.split("\n")[0])
        if not separator or not status:
            return UNVERIFIED
        if status.group(1) == "404":
            return INCOMPLETE
        if result.returncode or status.group(1) != "200":
            return UNVERIFIED
        ref=json.loads(body)
        if not isinstance(ref,dict):
            return UNVERIFIED
        obj=ref.get("object")
        if not isinstance(obj,dict):
            return UNVERIFIED
        sha=obj.get("sha")
        if not (ref.get("ref") == f"refs/heads/{branch}"
                and ref.get("url") == f"https://api.github.com/repos/{REPO}/git/refs/heads/{branch}"
                and obj.get("type") == "commit" and isinstance(sha,str)
                and re.fullmatch(r"[0-9a-f]{40}",sha)
                and obj.get("url") == f"https://api.github.com/repos/{REPO}/git/commits/{sha}"):
            return UNVERIFIED
        return (f"Engineer code pushed; PR publication blocked or pending\n\n"
                f"Branch: https://github.com/{REPO}/tree/{branch}\n"
                f"Observed commit: `{sha}`\n\n"
                "Inspect the branch and publish a draft PR through an authorized process.")
    except (OSError,subprocess.SubprocessError,ValueError,AttributeError):
        return UNVERIFIED

def main():
    run_id=os.environ["ARCHITECT_RUN_ID"]
    title=os.environ["ARCHITECT_RUN_TITLE"]
    conclusion=os.environ.get("ARCHITECT_RUN_CONCLUSION","unknown")
    if not re.fullmatch(r"[0-9]{5,20}",run_id) or not TITLE.fullmatch(title):
        print("Not an identifiable Sandy engineering issue run")
        return
    issue=TITLE.fullmatch(title).group(1)
    with tempfile.TemporaryDirectory() as tmp:
        result=gh("run","download",run_id,"--repo",REPO,"--name",f"sandy-architecture-{issue}","--dir",tmp,check=False)
        path=Path(tmp)/"sandy-architecture.md"
        first=path.read_text(errors="replace").splitlines()[0].strip() if result.returncode==0 and path.is_file() and path.stat().st_size else ""
    branch=f"sandy/codex-issue-{issue}-{run_id}"
    try:
        pr_list=gh("pr","list","--repo",REPO,"--state","all","--head",branch,"--json","number,url")
        prs=json.loads(pr_list.stdout)
        if not isinstance(prs,list) or any(
            not isinstance(p,dict) or type(p.get("number")) is not int or p["number"] <= 0
            or p.get("url") != f"https://github.com/{REPO}/pull/{p['number']}" for p in prs
        ):
            raise ValueError("Invalid PR response")
    except (OSError,subprocess.SubprocessError,ValueError):
        print("Engineering PR verification unavailable")
        return
    pr=prs[0] if isinstance(prs,list) and prs else None
    decision=describe(title,first,pr)
    outcome=event_payload(title,first,run_id,pr)
    if outcome is not None and os.environ.get("SANDY_OUTCOME_FILE"):
        Path(os.environ["SANDY_OUTCOME_FILE"]).write_text(json.dumps(outcome))
    if decision is None:
        return
    detail=decision[1]
    if first == "DECISION: READY" and not prs:
        detail=branch_observation(run_id,title,branch)
    marker=f"<!-- sandy-architect-observation:{run_id} -->"
    try:
        pages=json.loads(gh("api","--hostname","github.com","--paginate","--slurp",f"repos/{REPO}/issues/{issue}/comments").stdout)
        if not isinstance(pages,list) or any(not isinstance(page,list) for page in pages):
            raise ValueError("Invalid comments response")
        comments=[c for page in pages for c in page]
        old=next((c for c in comments if isinstance(c,dict)
                  and isinstance(c.get("body"),str) and marker in c["body"]
                  and isinstance(c.get("user"),dict)
                  and c["user"].get("login") == "github-actions[bot]"
                  and c["user"].get("type") == "Bot"
                  and type(c.get("id")) is int and c["id"] > 0),None)
    except (OSError,subprocess.SubprocessError,ValueError):
        print("Engineering observation comments unavailable")
        return
    body=(f"### Sandy autonomous engineering run {run_id}\n\n"
          f"{detail}\n\n"
          f"GitHub workflow conclusion: \`{conclusion}\`. "
          f"Audit: https://github.com/{REPO}/actions/runs/{run_id}\n\n"
          f"No production deployment or verified customer outcome is inferred.\n\n{marker}")
    if old:
        if INCOMPLETE in old["body"] and detail.startswith("Engineer code pushed;"):
            gh("api","--hostname","github.com",f"repos/{REPO}/issues/comments/{old['id']}","--method","PATCH","--raw-field",f"body={body}")
        else:
            print("Run already observed")
            return
    else:
        gh("issue","comment",issue,"--repo",REPO,"--body",body)
    print(f"Recorded Architect run {run_id} against issue #{issue}")

if __name__=="__main__":
    main()
