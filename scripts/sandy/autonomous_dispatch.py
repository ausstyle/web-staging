#!/usr/bin/env python3
"""Fail-closed dispatch of Sandy's opted-in engineering issues. Never deploys."""
import datetime as dt
import json
import os
import re
import subprocess

REPO = "ausstyle/web-staging"
WORKFLOW = "sandy-codex-engineering.yml"
LABEL = "sandy-autonomous-ready"
TTL_HOURS = 24
MIN_REPAIR_RETRY_MINUTES = 3
REPAIR_FILES = frozenset({
    '.github/workflows/sandy-codex-engineering.yml',
    '.github/workflows/sandy-autonomous-dispatch.yml',
    'scripts/sandy/autonomous_dispatch.py',
    'supabase/functions/sandy-engineering-oidc-ingest/index.ts',
    'scripts/sandy/observe_architect_run.py',
})
MAX_ATTEMPTS = 3
TITLE = re.compile(r"^Sandy (?:QA|feature|improvement):", re.I)
RUN = re.compile(r"^Sandy engineering issue #([1-9][0-9]{0,5})$")


def utc(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def priority(body):
    m = re.search(r"\bpriority\s*[:=]?\s*(\d{1,3})(?:/100)?\b", body or "", re.I)
    return min(100, int(m.group(1))) if m else 0


def choose(issues, runs, now, repair_verified=None):
    """Select one eligible issue; prevent duplicate, stale and unbounded work."""
    eligible = []
    for issue in issues:
        if issue.get("pull_request") or issue.get("state") != "open":
            continue
        number = issue.get("number")
        if not isinstance(number, int) or not 1 <= number <= 999999:
            continue
        if not TITLE.match(issue.get("title", "")):
            continue
        labels = {l.get("name") for l in issue.get("labels", []) if isinstance(l, dict)}
        if LABEL not in labels or "sandy-autonomous-paused" in labels:
            continue
        history = [r for r in runs if RUN.match(r.get("display_title", ""))
                   and int(RUN.match(r["display_title"]).group(1)) == number]
        if len(history) >= MAX_ATTEMPTS:
            continue
        if history:
            latest = max(history, key=lambda r: r.get("created_at", ""))
            if latest.get("status") != "completed":
                continue
            age = (now - utc(latest["created_at"])).total_seconds()
            repaired = (
                latest.get("conclusion") == "failure"
                and age >= MIN_REPAIR_RETRY_MINUTES * 60
                and callable(repair_verified) and repair_verified(latest)
            )
            if age < TTL_HOURS * 3600 and not repaired:
                continue
            if not repaired and utc(issue["updated_at"]) <= utc(latest["created_at"]):
                continue
        eligible.append(issue)
    return sorted(eligible, key=lambda i: (-priority(i.get("body", "")), i["number"]))[0] if eligible else None


def gh(*args, payload=None):
    completed = subprocess.run(["gh", "api", *args],
                               input=json.dumps(payload) if payload else None,
                               text=True, capture_output=True, check=True)
    return json.loads(completed.stdout) if completed.stdout.strip() else None


def verified_engineering_repair(latest):
    """Allow a bounded prompt retry only when the actual trusted engineering source changed."""
    base = latest.get("head_sha", "")
    head = os.environ.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[a-f0-9]{40}", base) or not re.fullmatch(r"[a-f0-9]{40}", head) or base == head:
        return False
    try:
        data = gh(f"repos/{REPO}/compare/{base}...{head}")
    except subprocess.CalledProcessError:
        return False
    return (
        isinstance(data, dict) and data.get("status") == "ahead"
        and not data.get("too_large", False)
        and any(f.get("filename") in REPAIR_FILES for f in data.get("files", []) if isinstance(f, dict))
    )


def main():
    if os.environ.get("GITHUB_REPOSITORY") != REPO:
        raise SystemExit("Unexpected repository")
    issues = gh(f"repos/{REPO}/issues?state=open&labels={LABEL}&per_page=100")
    result = gh(f"repos/{REPO}/actions/workflows/{WORKFLOW}/runs?per_page=100")
    issue = choose(issues, result.get("workflow_runs", []), dt.datetime.now(dt.timezone.utc), verified_engineering_repair)
    if not issue:
        print("No authorised eligible issue; no dispatch")
        return
    number = issue["number"]
    if os.environ.get("SANDY_DISPATCH_DRY_RUN") == "1":
        print(f"DRY RUN: would dispatch issue #{number}")
        return
    gh("--method", "POST", f"repos/{REPO}/actions/workflows/{WORKFLOW}/dispatches",
       "--input", "-", payload={"ref": "main", "inputs": {"issue_number": str(number)}})
    print(f"Dispatched eligible issue #{number}; no deployment")


if __name__ == "__main__":
    main()
