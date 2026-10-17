#!/usr/bin/env python3
"""Assess whether audited production source can be considered for review.
No raw production source is emitted. Detection is conservative, not a security guarantee.
"""
import json
import pathlib
import re
import sys

PATTERNS = [
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    re.compile(rb"(?i)(?:service_role|SUPABASE_ACCESS_TOKEN|OPENAI_API_KEY|client_secret|password)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
    re.compile(rb"(?i)\b(?:sk-proj-|sk_live_|ghp_|github_pat_|sbp_)[A-Za-z0-9_-]{12,}"),
]

def review(directory, comparison):
    slug = comparison.get("function_slug")
    if not isinstance(slug, str) or not re.fullmatch(r"sandy-[a-z0-9-]{1,80}", slug):
        raise ValueError("Invalid function slug")
    if comparison.get("project_ref") != "zmqlyygzqoidkcwdysok":
        raise ValueError("Unexpected project")
    paths = []
    root = pathlib.Path(directory).resolve()
    if root.name != slug:
        raise ValueError("Source identity mismatch")
    for file in root.rglob("*"):
        if file.is_symlink():
            raise ValueError("Symlink found")
        if not file.is_file():
            continue
        if file.stat().st_size > 2_000_000:
            raise ValueError("Oversize source")
        data = file.read_bytes()
        paths.append({"path": file.relative_to(root).as_posix(),
                      "sensitive_pattern_detected": any(p.search(data) for p in PATTERNS)})
    risky = any(x["sensitive_pattern_detected"] for x in paths)
    return {"schema_version": 1, "function_slug": slug,
            "risk_screen": "review_required_sensitive_pattern" if risky else "preliminary_scan_only",
            "publication_authorized": False, "production_parity_certified": False,
            "source_contents_included": False, "files": paths}

if __name__ == "__main__":
    result = review(sys.argv[1], json.loads(pathlib.Path(sys.argv[2]).read_text()))
    print(json.dumps(result, indent=2))
