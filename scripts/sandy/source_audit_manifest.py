#!/usr/bin/env python3
"""Produce non-sensitive source metadata; never print or upload source."""
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
if not root.is_dir() or not (root / "index.ts").is_file():
    raise SystemExit("Missing downloaded function")
files = []
for p in sorted(root.rglob("*")):
    if not p.is_file():
        continue
    if p.is_symlink() or len(files) >= 80 or p.stat().st_size > 2_000_000:
        raise SystemExit("Unexpected source bundle")
    files.append({"path":p.relative_to(root).as_posix(),"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()})
print(json.dumps({"schema_version":1,"status":"downloaded_pending_review","production_parity_certified":False,"source_contents_included":False,"files":files},indent=2))
