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
        outcome="Architect READY, but no engineering PR was verified. Implementation remains incomplete."
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
    pr_list=gh("pr","list","--repo",REPO,"--state","all","--head",branch,"--json","number,url")
    prs=json.loads(pr_list.stdout)
    pr=prs[0] if isinstance(prs,list) and prs else None
    decision=describe(title,first,pr)
    outcome=event_payload(title,first,run_id,pr)
    if outcome is not None and os.environ.get("SANDY_OUTCOME_FILE"):
        Path(os.environ["SANDY_OUTCOME_FILE"]).write_text(json.dumps(outcome))
    if decision is None:
        return
    marker=f"<!-- sandy-architect-observation:{run_id} -->"
    old=gh("api","--paginate",f"repos/{REPO}/issues/{issue}/comments","--jq",".[].body").stdout
    if marker in old:
        print("Run already observed")
        return
    body=(f"### Sandy autonomous engineering run {run_id}\n\n"
          f"{decision[1]}\n\n"
          f"GitHub workflow conclusion: \`{conclusion}\`. "
          f"Audit: https://github.com/{REPO}/actions/runs/{run_id}\n\n"
          f"No production deployment or verified customer outcome is inferred.\n\n{marker}")
    gh("issue","comment",issue,"--repo",REPO,"--body",body)
    print(f"Recorded Architect run {run_id} against issue #{issue}")

if __name__=="__main__":
    main()
