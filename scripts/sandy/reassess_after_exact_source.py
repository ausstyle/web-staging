#!/usr/bin/env python3
"""Dispatch Architect only for new exact source snapshots; never assert broad parity."""
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

def eligibility(manifest, comparison):
    if manifest.get("schema_version") != 1 or comparison.get("schema_version") != 1:
        raise ValueError("Invalid audit schema")
    if manifest.get("project_ref") != "zmqlyygzqoidkcwdysok" or comparison.get("project_ref") != manifest["project_ref"]:
        raise ValueError("Unexpected project")
    slug = manifest.get("function_slug")
    if not isinstance(slug, str) or not re.fullmatch(r"sandy-[a-z0-9-]{1,80}", slug) or comparison.get("function_slug") != slug:
        raise ValueError("Function mismatch")
    files = manifest.get("files")
    entries = comparison.get("files")
    if not isinstance(files, list) or not files or not isinstance(entries, list):
        raise ValueError("Missing evidence")
    if manifest.get("production_parity_certified") is not False or comparison.get("production_parity_certified") is not False:
        raise ValueError("Unexpected parity claim")
    if comparison.get("comparison") != "exact_snapshot_match" or len(files) != len(entries) or any(x.get("status") != "hash_match" for x in entries):
        return None
    attested = sorted((f["path"], f["sha256"], f["bytes"]) for f in files)
    fingerprint = hashlib.sha256(json.dumps(attested, separators=(",", ":")).encode()).hexdigest()[:24]
    return slug, fingerprint

def act(manifest, comparison, issue, repo, prior, runner):
    if not re.fullmatch(r"[1-9][0-9]{0,5}", issue) or repo != "ausstyle/web-staging":
        raise ValueError("Invalid issue/repository")
    decision = eligibility(manifest, comparison)
    if not decision:
        return "Source mismatch: no automatic Architect rerun"
    slug, fingerprint = decision
    marker = f"<!-- sandy-exact-source-reassessment:{issue}:{slug}:{fingerprint} -->"
    if marker in prior:
        return "This exact source snapshot was already submitted for reassessment"
    runner(["gh", "workflow", "run", "sandy-codex-engineering.yml", "--ref", "main",
            "-f", f"issue_number={issue}"])
    runner(["gh", "issue", "comment", issue, "--body",
            f"New exact snapshot hash match for \`{slug}\` (not full production parity). Requested Architect reassessment.\\n\\n{marker}"])
    return "Requested Architect reassessment for new exact source snapshot"

if __name__ == "__main__":
    m=json.loads(Path(sys.argv[1]).read_text())
    c=json.loads(Path(sys.argv[2]).read_text())
    issue=os.environ["ISSUE"]
    repo=os.environ["GITHUB_REPOSITORY"]
    prior=subprocess.run(["gh","api","--paginate",f"repos/{repo}/issues/{issue}/comments",
                          "--jq",".[].body"],check=True,capture_output=True,text=True).stdout
    print(act(m,c,issue,repo,prior,lambda args: subprocess.run(args,check=True)))
