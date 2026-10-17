#!/usr/bin/env python3
"""Emit an idempotent, metadata-only review request for an audited source mismatch."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

def render(comparison, issue, run_id):
    if not re.fullmatch(r"[1-9][0-9]{0,5}", issue) or not re.fullmatch(r"[0-9]{5,20}", run_id):
        raise ValueError("Invalid issue or run")
    if comparison.get("project_ref") != "zmqlyygzqoidkcwdysok" or comparison.get("schema_version") != 1:
        raise ValueError("Invalid project or schema")
    slug = comparison.get("function_slug")
    if not isinstance(slug, str) or not re.fullmatch(r"sandy-[a-z0-9-]{1,80}", slug):
        raise ValueError("Invalid slug")
    if comparison.get("production_parity_certified") is not False:
        raise ValueError("Unexpected parity certification")
    files = comparison.get("files")
    if not isinstance(files, list) or len(files) > 160:
        raise ValueError("Invalid comparison list")
    allowed = {"hash_match", "hash_mismatch", "missing_in_repository", "not_in_audited_bundle"}
    counts = {name: 0 for name in sorted(allowed)}
    for f in files:
        if not isinstance(f, dict) or f.get("status") not in allowed:
            raise ValueError("Invalid comparison status")
        counts[f["status"]] += 1
    if comparison.get("comparison") == "exact_snapshot_match" and any(v for k,v in counts.items() if k != "hash_match"):
        raise ValueError("Inconsistent comparison")
    marker = f"<!-- sandy-reconciliation-evidence:{issue}:{slug}:{run_id} -->"
    url = f"https://github.com/ausstyle/web-staging/actions/runs/{run_id}"
    body = (f"### Sandy source reconciliation evidence — \`{slug}\`\n\n"
            f"Protected source audit: {url}\n"
            f"Comparison: \`{comparison.get('comparison')}\` (NOT certified production parity).\n\n"
            + "\n".join(f"- {k}: {v}" for k,v in counts.items())
            + "\n\nReview the metadata artifact. A source-change PR is NOT created automatically;"
              " the production bundle requires independent security review before any repository upload."
              " No production deployment or Architect READY decision is implied.\n\n" + marker)
    return marker, body

if __name__ == "__main__":
    comparison = json.loads(Path(sys.argv[1]).read_text())
    issue, run_id = os.environ["ISSUE"], os.environ["GITHUB_RUN_ID"]
    marker, body = render(comparison, issue, run_id)
    repo = os.environ["GITHUB_REPOSITORY"]
    prior = subprocess.run(["gh", "api", "--paginate", f"repos/{repo}/issues/{issue}/comments",
                            "--jq", ".[].body"], check=True, capture_output=True, text=True).stdout
    if marker not in prior:
        subprocess.run(["gh", "issue", "comment", issue, "--body", body], check=True)
        print("Reconciliation evidence linked to engineering issue; no source contents published")
    else:
        print("Existing reconciliation evidence; no duplicate posted")
