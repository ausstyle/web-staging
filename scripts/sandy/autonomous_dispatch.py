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
BLOCKED = "sandy-autonomous-blocked"
STATUSES = {"completed", "queued", "in_progress", "waiting", "requested", "pending"}
TITLE = re.compile(r"^Sandy (?:QA|feature|improvement):", re.I)
RUN = re.compile(r"^Sandy engineering issue #([1-9][0-9]{0,5})$")


def utc(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def priority(body):
    m = re.search(r"\bpriority\s*[:=]?\s*(\d{1,3})(?:/100)?\b", body or "", re.I)
    return min(100, int(m.group(1))) if m else 0


def labels(issue):
    return {label["name"] for label in issue["labels"]}


def authorised(issue):
    return ("pull_request" not in issue and issue.get("state") == "open"
            and type(issue.get("number")) is int and 1 <= issue["number"] <= 999999
            and TITLE.match(issue.get("title", "")) and LABEL in labels(issue)
            and "sandy-autonomous-paused" not in labels(issue))


def validate_issue(issue):
    if (not isinstance(issue, dict) or type(issue.get("number")) is not int
            or not 1 <= issue["number"] <= 999999 or issue.get("state") not in {"open", "closed"}
            or not isinstance(issue.get("title"), str) or not isinstance(issue.get("labels"), list)
            or any(not isinstance(l, dict) or not isinstance(l.get("name"), str) for l in issue["labels"])
            or (issue.get("body") is not None and not isinstance(issue["body"], str))):
        raise ValueError("Invalid issue")
    if utc(issue["updated_at"]).tzinfo is None:
        raise ValueError("Invalid timestamp")


def history_for(issue, runs):
    return list({r["id"]: r for r in runs if RUN.fullmatch(r.get("display_title", ""))
                 and int(RUN.fullmatch(r["display_title"]).group(1)) == issue["number"]}.values())


def attempt_budget(issue):
    """Untrusted issue text may reduce the standing cap, never increase it."""
    body = issue.get("body") or ""
    markers = [m.strip() for m in re.findall(r"<!--\s*sandy-dispatch-budget:([^>]*)-->", body)]
    if not markers:
        return 0 if "sandy-dispatch-budget:" in body else MAX_ATTEMPTS
    if len(markers) != 1 or not re.fullmatch(r"[1-9][0-9]{0,5}", markers[0]):
        return 0
    return min(MAX_ATTEMPTS, int(markers[0]))


def dependencies_ready(issue):
    """Unknown dependency evidence withholds this task, not independent work."""
    number = issue["number"]
    try:
        dependencies = pages(f"issues/{number}/dependencies/blocked_by?per_page=100")
        for dependency in dependencies:
            if (type(dependency.get("number")) is not int
                    or dependency.get("state") not in {"open", "closed"}
                    or dependency.get("repository_url") != f"https://api.github.com/repos/{REPO}"):
                raise ValueError("Invalid dependency")
            if dependency["state"] != "closed" or dependency.get("state_reason") != "completed":
                print(f"Issue #{number}: dependency_not_completed; dispatch withheld")
                return False
        return True
    except (subprocess.CalledProcessError, OSError, ValueError, KeyError, TypeError) as error:
        status = re.search(r"HTTP ([1-5][0-9]{2})\b", getattr(error, "stderr", "") or "")
        classification = f"_http_{status[1]}" if status else ""
        print(f"Issue #{number}: dependency_evidence_unavailable{classification}; dispatch withheld")
        return False


def choose(issues, runs, now, repair_verified=None):
    """Select one eligible issue; prevent duplicate, stale and unbounded work."""
    eligible = []
    for issue in issues:
        if not authorised(issue) or BLOCKED in labels(issue):
            continue
        history = history_for(issue, runs)
        if len(history) >= attempt_budget(issue) or any(r.get("conclusion") == "success" for r in history):
            continue
        if history:
            latest = max(history, key=lambda r: r.get("created_at", ""))
            if any(r.get("status") != "completed" for r in history):
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


def pages(endpoint, key=None):
    data = gh("--paginate", "--slurp", f"repos/{REPO}/{endpoint}")
    if not isinstance(data, list) or not data:
        raise ValueError("Missing pages")
    rows = []
    for page in data:
        items = page.get(key) if key and isinstance(page, dict) else page
        if not isinstance(items, list) or any(not isinstance(x, dict) for x in items):
            raise ValueError("Invalid page")
        rows.extend(items)
    if key and any(type(p.get("total_count")) is not int or p["total_count"] != len({r["id"] for r in rows}) for p in data):
        raise ValueError("Incomplete history")
    return rows


def marked(number):
    marker = f"<!-- sandy-autonomous-retry-exhausted:v1:{number} -->"
    comments = pages(f"issues/{number}/comments?per_page=100")
    if any(not isinstance(c.get("body"), str) or not isinstance(c.get("user"), dict)
           or not isinstance(c["user"].get("login"), str) for c in comments):
        raise ValueError("Invalid comments")
    return marker, any(marker in c["body"] and c["user"]["login"] == "github-actions[bot]" for c in comments)


def reconcile(issue, history, marker, recorded, dry):
    number = issue["number"]
    exhausted = len(history) >= attempt_budget(issue) and all(r["status"] == "completed" for r in history)
    if not (recorded or BLOCKED in labels(issue) or exhausted):
        return False
    if dry:
        print(f"DRY RUN: issue #{number} blocked; escalation reconciliation required")
        return True
    current = gh(f"repos/{REPO}/issues/{number}")
    validate_issue(current)
    if current["number"] != number:
        raise ValueError("Issue mismatch")
    if not authorised(current):
        return True
    marker, current_recorded = marked(number)
    recorded = recorded or current_recorded
    if BLOCKED in labels(current):
        if not recorded:
            raise SystemExit(f"Issue #{number}: incomplete escalation; operator review required. Inspect the blocking label and marker comments; do not blindly retry publication.")
        return True
    existing = pages("labels?per_page=100")
    if any(not isinstance(l.get("name"), str) for l in existing):
        raise ValueError("Invalid labels")
    if not any(l.get("name") == BLOCKED for l in existing):
        gh("--method", "POST", f"repos/{REPO}/labels", "--input", "-",
           payload={"name": BLOCKED, "color": "b60205", "description": "Autonomous retry budget requires operator review"})
    gh("--method", "POST", f"repos/{REPO}/issues/{number}/labels", "--input", "-", payload={"labels": [BLOCKED]})
    if BLOCKED in labels(issue) and not recorded:
        raise ValueError("Incomplete escalation")
    if not recorded:
        body = (f"{marker}\nThe bounded scheduler attempt budget is exhausted. Automatic dispatch by this scheduler has stopped; operator review is required.\n\n"
                "This count does not establish an engineering outcome.\n"
                "Record the disposition and close this issue or remove its opt-in. For another bounded cycle, create a linked successor issue with explicit opt-in.\n\n")
        body += "\n".join(f"- https://github.com/{REPO}/actions/runs/{r['id']} ({r['status']})" for r in history)
        gh("--method", "POST", f"repos/{REPO}/issues/{number}/comments", "--input", "-", payload={"body": body})
    print(f"Issue #{number} blocked for operator review")
    return True


def verified_engineering_repair(latest):
    """Allow a bounded prompt retry only when the actual trusted engineering source changed."""
    base = latest.get("head_sha", "")
    head = os.environ.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[a-f0-9]{40}", base) or not re.fullmatch(r"[a-f0-9]{40}", head) or base == head:
        return False
    data = gh(f"repos/{REPO}/compare/{base}...{head}")
    if not isinstance(data, dict) or not isinstance(data.get("files"), list) or "status" not in data:
        raise ValueError("Invalid comparison")
    return (
        isinstance(data, dict) and data.get("status") == "ahead"
        and not data.get("too_large", False)
        and any(f.get("filename") in REPAIR_FILES for f in data.get("files", []) if isinstance(f, dict))
    )


def dispatch():
    if os.environ.get("GITHUB_REPOSITORY") != REPO:
        raise SystemExit("Unexpected repository")
    issues = pages(f"issues?state=open&labels={LABEL}&per_page=100")
    runs = pages(f"actions/workflows/{WORKFLOW}/runs?per_page=100", "workflow_runs")
    for i in issues:
        validate_issue(i)
    seen = {}
    for r in runs:
        if (type(r.get("id")) is not int or not 1 <= r["id"] < 10**20
                or r.get("status") not in STATUSES or not isinstance(r.get("display_title"), str)):
            raise ValueError("Invalid run")
        if utc(r["created_at"]).tzinfo is None or (r["id"] in seen and seen[r["id"]] != r):
            raise ValueError("Inconsistent history")
        if r["id"] in seen:
            print("Duplicate workflow run history; dispatch withheld pending clean evidence")
            return
        seen[r["id"]] = r
    dry = os.environ.get("SANDY_DISPATCH_DRY_RUN") == "1"
    evidence = [(i, history_for(i, runs), *marked(i["number"])) for i in issues if authorised(i)]
    available = [i for i, history, marker, recorded in evidence
                 if not reconcile(i, history, marker, recorded, dry) and dependencies_ready(i)]
    issue = choose(available, runs, dt.datetime.now(dt.timezone.utc), verified_engineering_repair)
    if not issue:
        print("No authorised eligible issue; no dispatch")
        return
    number = issue["number"]
    current = gh(f"repos/{REPO}/issues/{number}")
    validate_issue(current)
    if current["number"] != number:
        raise ValueError("Issue mismatch")
    marker, recorded = marked(number)
    if (not authorised(current) or reconcile(current, history_for(current, runs), marker, recorded, dry)
            or not dependencies_ready(current)):
        print(f"Issue #{number} no longer eligible; no dispatch")
        return
    if dry:
        print(f"DRY RUN: would dispatch issue #{number}")
        return
    gh("--method", "POST", f"repos/{REPO}/actions/workflows/{WORKFLOW}/dispatches",
       "--input", "-", payload={"ref": "main", "inputs": {"issue_number": str(number)}})
    print(f"Dispatched eligible issue #{number}; no deployment")


def main():
    try:
        dispatch()
    except (subprocess.CalledProcessError, OSError, ValueError, KeyError, TypeError, AttributeError):
        raise SystemExit("Dispatcher stopped: incomplete evidence or escalation; operator review required. Inspect blocking labels and marker comments before recovery. No further dispatch attempted.") from None


if __name__ == "__main__":
    main()
