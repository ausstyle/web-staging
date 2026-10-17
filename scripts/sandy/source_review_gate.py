#!/usr/bin/env python3
"""Fail-closed source publication review. This never authorizes publication."""
import json
import pathlib
import sys

def assess(manifest, comparison, screen, packet):
    slug = manifest.get("function_slug")
    project = "zmqlyygzqoidkcwdysok"
    if any(obj.get("function_slug") != slug for obj in (comparison, screen, packet)):
        raise ValueError("Source identity mismatch")
    if manifest.get("project_ref") != project or comparison.get("project_ref") != project or packet.get("project_ref") != project:
        raise ValueError("Unexpected project")
    if manifest.get("source_contents_included") is not False or screen.get("source_contents_included") is not False:
        raise ValueError("Source confidentiality assertion missing")
    if screen.get("publication_authorized") is not False or packet.get("production_parity_certified") is not False:
        raise ValueError("Untrusted publication or parity claim")
    files = comparison.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("Missing comparison")
    risky = screen.get("risk_screen") != "preliminary_scan_only"
    changed = any(x.get("status") != "hash_match" for x in files)
    return {
        "schema_version": 1,
        "function_slug": slug,
        "review_status": "security_review_required" if risky else ("source_diff_review_required" if changed else "hash_match_review_required"),
        "explicit_source_publication_approval_required": True,
        "independent_sensitive_data_review_required": True,
        "publication_authorized": False,
        "production_parity_certified": False,
        "source_contents_included": False,
        "note": "Metadata screening cannot clear a blocked production-source publication. No source upload, PR creation or deployment permitted by this report."
    }

if __name__ == "__main__":
    manifests=[json.loads(pathlib.Path(p).read_text()) for p in sys.argv[1:5]]
    print(json.dumps(assess(*manifests), indent=2))
