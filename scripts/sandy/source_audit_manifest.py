#!/usr/bin/env python3
"""Produce non-sensitive source metadata; never print or upload source."""
import hashlib
import json
import pathlib
import sys
import os
import re

root = pathlib.Path(sys.argv[1]).resolve()
if not root.is_dir() or not (root / "index.ts").is_file():
    raise SystemExit("Missing downloaded function")
slug = os.environ.get("SLUG", root.name)
if not re.fullmatch(r"sandy-[a-z0-9-]{1,80}", slug) or root.name != slug:
    raise SystemExit("Invalid function identity")
files = []
for p in sorted(root.rglob("*")):
    if p.is_symlink():
        raise SystemExit("Symlink in source bundle")
    if not p.is_file():
        continue
    if p.is_symlink() or len(files) >= 80 or p.stat().st_size > 2_000_000:
        raise SystemExit("Unexpected source bundle")
    files.append({"path":p.relative_to(root).as_posix(),"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()})
print(json.dumps({"schema_version":1,"project_ref":"zmqlyygzqoidkcwdysok","function_slug":slug,"status":"downloaded_pending_review","production_parity_certified":False,"source_contents_included":False,"files":files},indent=2))
