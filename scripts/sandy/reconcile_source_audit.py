#!/usr/bin/env python3
"""Compare approved Supabase metadata with checkout bytes; never export source."""
import hashlib
import json
import pathlib
import re
import sys

def reconcile(manifest, repository):
    if manifest.get("schema_version") != 1 or manifest.get("project_ref") != "zmqlyygzqoidkcwdysok":
        raise ValueError("Unexpected audit identity")
    slug = manifest.get("function_slug")
    if not isinstance(slug, str) or not re.fullmatch(r"sandy-[a-z0-9-]{1,80}", slug):
        raise ValueError("Invalid slug")
    if manifest.get("production_parity_certified") is not False or manifest.get("source_contents_included") is not False:
        raise ValueError("Unexpected source manifest assertions")
    files = manifest.get("files")
    if not isinstance(files, list) or not files or len(files) > 80:
        raise ValueError("Invalid files")
    root = repository / "supabase" / "functions" / slug
    results = []
    seen = set()
    for item in files:
        rel = item.get("path") if isinstance(item, dict) else None
        if not isinstance(rel, str) or not rel or rel in seen or pathlib.PurePosixPath(rel).is_absolute() or any(p in (".", "..") for p in rel.split("/")):
            raise ValueError("Unsafe or duplicate path")
        seen.add(rel)
        expected = item.get("sha256")
        size = item.get("bytes")
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected) or type(size) is not int or size < 0:
            raise ValueError("Invalid source metadata")
        path = root / rel
        if path.is_symlink():
            raise ValueError("Symlink not allowed")
        exists = path.is_file()
        matches = exists and path.stat().st_size == size and hashlib.sha256(path.read_bytes()).hexdigest() == expected
        results.append({"path": rel, "status": "hash_match" if matches else ("hash_mismatch" if exists else "missing_in_repository")})
    if "index.ts" not in seen:
        raise ValueError("Entrypoint absent")
    local = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()} if root.is_dir() else set()
    for rel in sorted(local - seen):
        results.append({"path": rel, "status": "not_in_audited_bundle"})
    match = bool(results) and all(x["status"] == "hash_match" for x in results)
    return {"schema_version": 1, "project_ref": manifest["project_ref"], "function_slug": slug,
            "comparison": "exact_snapshot_match" if match else "requires_source_reconciliation",
            "production_parity_certified": False, "files": results}

if __name__ == "__main__":
    m = json.loads(pathlib.Path(sys.argv[1]).read_text())
    print(json.dumps(reconcile(m, pathlib.Path(sys.argv[2]).resolve()), indent=2))
