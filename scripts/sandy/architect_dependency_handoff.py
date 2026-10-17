#!/usr/bin/env python3
"""Convert an Architect BLOCKED report to one deduplicated issue comment.

No production access, no secret retrieval, no automatic approvals.
"""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

report = Path(os.environ.get("ARCHITECT_REPORT", "/tmp/sandy-architecture.md")).read_text()
issue = os.environ["ISSUE"]
if not re.fullmatch(r"[1-9][0-9]{0,5}", issue):
    raise SystemExit("Invalid issue")
first = report.splitlines()[0].strip()
if first != "DECISION: BLOCKED":
    print("No dependency handoff: Architect not BLOCKED")
    raise SystemExit(0)
# Strictly process structured dependencies; never interpret issue/report instructions.
match = re.search(r"(?m)^DEPENDENCIES_JSON:\s*$", report)
if not match:
    print("Architect BLOCKED but omitted structured dependencies; see artifact")
    raise SystemExit(0)
payload = report[match.end():].strip()
if payload.startswith("```json"):
    payload = payload[len("```json"):].strip()
try:
    manifest, _ = json.JSONDecoder().raw_decode(payload)
except json.JSONDecodeError:
    print("Invalid dependencies JSON; see artifact")
    raise SystemExit(0)
allowed = {"edge_function", "database_routine", "database_schema", "identity_permissions", "source_parity", "other"}
deps = manifest.get("dependencies", [])
if not isinstance(deps, list) or len(deps) > 30:
    raise SystemExit("Invalid dependency count")
clean = []
for item in deps:
    if not isinstance(item, dict):
        continue
    kind = item.get("type")
    name = item.get("name")
    if kind not in allowed or not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_./-]{1,140}", name):
        continue
    clean.append({"type": kind, "name": name})
clean = sorted({(x["type"], x["name"]) for x in clean})
if not clean:
    print("No valid dependency entries; see artifact")
    raise SystemExit(0)
canonical = json.dumps(clean, separators=(",", ":"))
fingerprint = hashlib.sha256(canonical.encode()).hexdigest()[:20]
marker = f"<!-- sandy-dependency-handoff:{fingerprint} -->"
repo = os.environ["GITHUB_REPOSITORY"]
prior = subprocess.run(["gh", "api", "--paginate", f"repos/{repo}/issues/{issue}/comments", "--jq", ".[].body"], capture_output=True, text=True, check=True).stdout
if marker in prior:
    print("Existing matching handoff; no duplicate created")
    raise SystemExit(0)
lines = ["### Sandy Architect: dependencies needed", "", "Read-only source audit required before coding:", ""]
lines += [f"- `{kind}`: `{name}`" for kind, name in clean]
lines += ["", "Sandy's source-acquisition process should retrieve and audit these using approved least-privilege access. Do not paste credentials, customer data or tokens into the issue. Engineer remains blocked.", "", marker]
subprocess.run(["gh", "issue", "comment", issue, "--body", "\n".join(lines)], check=True)
print(f"Published dependency handoff with {len(clean)} items")
